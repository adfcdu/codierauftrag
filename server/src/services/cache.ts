/**
 * SQLite cache + purge. Two tables (city_lookup, street_lookup); the
 * `response` column holds the full parsed state object as JSON.
 * This module is the ONLY one importing node:sqlite.
 */

import { Database, Statement } from 'node:sqlite';

export interface CitySinglePayload {
  state: 'single';
  city: string;
  plateCode: string;
  subCode: string;
  ags: string;
}

export interface CityCandidate {
  name: string;
  plz: string;
  kz: string;
  ags: string;
}

export interface CityListPayload {
  state: 'city_candidates';
  candidates: CityCandidate[];
}

export type CityPayload = CitySinglePayload | CityListPayload;

export interface StreetSinglePayload {
  state: 'single';
  city: string;
  plateCode: string;
  subCode: string;
  ags: string;
  street: string;
  streetCode: string;
}

export interface StreetListPayload {
  state: 'street_candidates';
  city: string;
  plateCode: string;
  subCode: string;
  ags: string;
  candidates: { street: string }[];
}

export type StreetPayload = StreetSinglePayload | StreetListPayload;

export interface CachedRow<P> {
  response: P;
  isCanonical: boolean;
  lastCheck: number;
}

export interface CacheDeps {
  enabled: boolean;
  maxAgeDays: number; // freshness/revalidation window ONLY — never a purge age
  typoDays: number;
  purgeMaxAgeDays: number;
  now?: () => number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS city_lookup (
  lookup       TEXT PRIMARY KEY,
  response     TEXT NOT NULL,
  is_canonical INTEGER NOT NULL,
  last_check   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS street_lookup (
  ags          TEXT NOT NULL,
  lookup       TEXT NOT NULL,
  response     TEXT NOT NULL,
  is_canonical INTEGER NOT NULL,
  last_check   INTEGER NOT NULL,
  PRIMARY KEY (ags, lookup)
);
CREATE INDEX IF NOT EXISTS idx_city_purge   ON city_lookup (last_check);
CREATE INDEX IF NOT EXISTS idx_street_purge ON street_lookup (last_check);
`;

interface RawRow {
  response: string;
  is_canonical: number;
  last_check: number;
}

export class StreetcodeCache {
  private readonly deps: CacheDeps;
  private readonly db: Database | null = null;

  // prepared statements (created once at open; only when enabled)
  private readonly stGetCityFresh!: Statement;
  private readonly stGetCityStale!: Statement;
  private readonly stGetStreetFresh!: Statement;
  private readonly stGetStreetStale!: Statement;
  private readonly stUpsertCity!: Statement;
  private readonly stUpsertStreet!: Statement;
  private readonly stDeleteCityList!: Statement;
  private readonly stDeleteStreetList!: Statement;
  private readonly stPurgeCityTypo!: Statement;
  private readonly stPurgeCityOld!: Statement;
  private readonly stPurgeStreetTypo!: Statement;
  private readonly stPurgeStreetOld!: Statement;

  constructor(dbPath: string, deps: CacheDeps) {
    this.deps = deps;
    if (!deps.enabled) return; // CACHE_ENABLED=false bypasses read + write entirely

    // node:sqlite defaults: journal_mode=delete, busy_timeout=0 — both must be
    // set explicitly.
    this.db = new Database(dbPath, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec(SCHEMA);

    this.stGetCityFresh = this.db.prepare(
      'SELECT response, is_canonical, last_check FROM city_lookup WHERE lookup = ? AND last_check >= ?',
    );
    this.stGetCityStale = this.db.prepare(
      'SELECT response, is_canonical, last_check FROM city_lookup WHERE lookup = ?',
    );
    this.stGetStreetFresh = this.db.prepare(
      'SELECT response, is_canonical, last_check FROM street_lookup WHERE ags = ? AND lookup = ? AND last_check >= ?',
    );
    this.stGetStreetStale = this.db.prepare(
      'SELECT response, is_canonical, last_check FROM street_lookup WHERE ags = ? AND lookup = ?',
    );
    this.stUpsertCity = this.db.prepare(
      `INSERT INTO city_lookup (lookup, response, is_canonical, last_check) VALUES (?,?,?,?)
       ON CONFLICT (lookup) DO UPDATE SET response=excluded.response, is_canonical=excluded.is_canonical, last_check=excluded.last_check`,
    );
    this.stUpsertStreet = this.db.prepare(
      `INSERT INTO street_lookup (ags, lookup, response, is_canonical, last_check) VALUES (?,?,?,?,?)
       ON CONFLICT (ags, lookup) DO UPDATE SET response=excluded.response, is_canonical=excluded.is_canonical, last_check=excluded.last_check`,
    );
    this.stDeleteCityList = this.db.prepare('DELETE FROM city_lookup WHERE lookup = ?');
    this.stDeleteStreetList = this.db.prepare(
      'DELETE FROM street_lookup WHERE ags = ? AND lookup = ?',
    );
    this.stPurgeCityTypo = this.db.prepare(
      'DELETE FROM city_lookup WHERE is_canonical = 0 AND last_check < ?',
    );
    this.stPurgeCityOld = this.db.prepare('DELETE FROM city_lookup WHERE last_check < ?');
    this.stPurgeStreetTypo = this.db.prepare(
      'DELETE FROM street_lookup WHERE is_canonical = 0 AND last_check < ?',
    );
    this.stPurgeStreetOld = this.db.prepare('DELETE FROM street_lookup WHERE last_check < ?');
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private freshCutoff(): number {
    return this.now() - this.deps.maxAgeDays * 86_400_000;
  }

  // ── Reads ──

  getCityFresh(lookup: string): CachedRow<CityPayload> | undefined {
    if (!this.db) return undefined;
    const row = this.stGetCityFresh.get(lookup, this.freshCutoff()) as RawRow | undefined;
    return row ? this.toRow<CityPayload>(row) : undefined;
  }

  getCityStale(lookup: string): CachedRow<CityPayload> | undefined {
    if (!this.db) return undefined;
    const row = this.stGetCityStale.get(lookup) as RawRow | undefined;
    return row ? this.toRow<CityPayload>(row) : undefined;
  }

  /** Stale city LIST row only (third step of the stale-fallback chain). */
  getCityListStale(lookup: string): CachedRow<CityListPayload> | undefined {
    const row = this.getCityStale(lookup);
    if (row && row.response.state === 'city_candidates') {
      return row as CachedRow<CityListPayload>;
    }
    return undefined;
  }

  getStreetFresh(ags: string, lookup: string): CachedRow<StreetPayload> | undefined {
    if (!this.db) return undefined;
    const row = this.stGetStreetFresh.get(ags, lookup, this.freshCutoff()) as RawRow | undefined;
    return row ? this.toRow<StreetPayload>(row) : undefined;
  }

  getStreetStale(ags: string, lookup: string): CachedRow<StreetPayload> | undefined {
    if (!this.db) return undefined;
    const row = this.stGetStreetStale.get(ags, lookup) as RawRow | undefined;
    return row ? this.toRow<StreetPayload>(row) : undefined;
  }

  // ── Writes (only on the upstream-success path — failures never write cache) ──

  /** Exact single city hit: dual-write the folded variant + canonical keys. */
  writeCitySingle(lookup: string, canonicalName: string, payload: CitySinglePayload): void {
    if (!this.db) return;
    const now = this.now();
    const json = JSON.stringify(payload);
    this.stUpsertCity.run(lookup, json, lookup === canonicalName ? 1 : 0, now);
    // usually the same row after folding — write both anyway (is_canonical bookkeeping)
    this.stUpsertCity.run(canonicalName, json, 1, now);
  }

  /** City candidate list: delete-and-rewrite per key inside a transaction. */
  writeCityList(lookup: string, payload: CityListPayload): void {
    if (!this.db) return;
    const now = this.now();
    this.db.exec('BEGIN');
    try {
      this.stDeleteCityList.run(lookup);
      this.stUpsertCity.run(lookup, JSON.stringify(payload), 1, now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Exact single street hit within a resolved city: dual-write both keys. */
  writeStreetSingle(
    ags: string,
    lookup: string,
    canonicalName: string,
    payload: StreetSinglePayload,
  ): void {
    if (!this.db) return;
    const now = this.now();
    const json = JSON.stringify(payload);
    this.stUpsertStreet.run(ags, lookup, json, lookup === canonicalName ? 1 : 0, now);
    this.stUpsertStreet.run(ags, canonicalName, json, 1, now);
  }

  /** Street candidate list: delete-and-rewrite per key inside a transaction. */
  writeStreetList(ags: string, lookup: string, payload: StreetListPayload): void {
    if (!this.db) return;
    const now = this.now();
    this.db.exec('BEGIN');
    try {
      this.stDeleteStreetList.run(ags, lookup);
      this.stUpsertStreet.run(ags, lookup, JSON.stringify(payload), 1, now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ── Purge (three knobs; CACHE_MAX_AGE_DAYS is never a purge age) ──

  purge(): { city: number; street: number } {
    if (!this.db) return { city: 0, street: 0 };
    const typoCutoff = this.now() - this.deps.typoDays * 86_400_000;
    const oldCutoff = this.now() - this.deps.purgeMaxAgeDays * 86_400_000;
    let city = 0;
    let street = 0;
    try {
      this.db.exec('BEGIN');
      city += this.stPurgeCityTypo.run(typoCutoff).changes;
      city += this.stPurgeCityOld.run(oldCutoff).changes;
      street += this.stPurgeStreetTypo.run(typoCutoff).changes;
      street += this.stPurgeStreetOld.run(oldCutoff).changes;
      this.db.exec('COMMIT');
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // no transaction active (BEGIN itself failed) — nothing to roll back
      }
      throw e;
    }
    return { city, street };
  }

  /** EXPLAIN QUERY PLAN for tests (asserts no full-scan plan anywhere). */
  explain(sql: string): unknown[] {
    if (!this.db) return [];
    return this.db.prepare('EXPLAIN QUERY PLAN ' + sql).all() as unknown[];
  }

  close(): void {
    this.db?.close();
  }

  private toRow<P>(row: RawRow): CachedRow<P> {
    return {
      response: JSON.parse(row.response) as P,
      isCanonical: row.is_canonical === 1,
      lastCheck: row.last_check,
    };
  }
}
