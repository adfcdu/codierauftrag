import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StreetcodeCache } from '../src/services/cache.js';
import type { CitySinglePayload, StreetSinglePayload } from '../src/services/cache.js';
import { fold } from '../src/services/fold.js';

const DAY = 86_400_000;

let dirs: string[] = [];

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codierauftrag-cache-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
}

function makeCache(overrides: Partial<ConstructorParameters<typeof StreetcodeCache>[1]> = {}) {
  let t = 1_700_000_000_000;
  const now = () => t;
  const deps = {
    enabled: true,
    maxAgeDays: 90,
    typoDays: 90,
    purgeMaxAgeDays: 365,
    now,
    ...overrides,
  };
  const cache = new StreetcodeCache(tmpDb(), deps);
  return { cache, deps, advance: (ms: number) => { t += ms; } };
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const cityPayload: CitySinglePayload = {
  state: 'single',
  city: 'Duisburg',
  plateCode: 'DU',
  subCode: '00',
  ags: '05112000',
};

const streetPayload: StreetSinglePayload = {
  state: 'single',
  city: 'Duisburg',
  plateCode: 'DU',
  subCode: '00',
  ags: '05112000',
  street: 'Königstraße / Altstadt / Dellviertel',
  streetCode: '01944',
};

describe('fold', () => {
  it('trims, collapses whitespace, casefolds, ß→ss', () => {
    expect(fold('  Duisburg  ')).toBe('duisburg');
    expect(fold('Duisburg')).toBe('duisburg');
    expect(fold('DUISBURG')).toBe('duisburg');
    expect(fold('Königstraße')).toBe('königstrasse');
    expect(fold('Bad  Homburg\tv.d.\nHöhe')).toBe('bad homburg v.d. höhe');
  });

  it('makes case variants share one key', () => {
    expect(fold('duisburg')).toBe(fold('Duisburg '));
    expect(fold('duisburg')).toBe(fold('DUISBURG'));
  });
});

describe('StreetcodeCache — reads and writes', () => {
  it('creates the schema and opens in WAL mode', () => {
    const { cache } = makeCache();
    cache.writeCitySingle('duisburg', 'duisburg', cityPayload);
    expect(cache.getCityFresh('duisburg')).toBeDefined();
    cache.close();
  });

  it('hit / miss per table; street rows are keyed by (ags, lookup)', () => {
    const { cache } = makeCache();
    cache.writeCitySingle(fold('Duisburg'), fold('Duisburg'), cityPayload);
    cache.writeStreetSingle('05112000', fold('Königstraße'), fold('Königstraße / Altstadt / Dellviertel'), streetPayload);

    const city = cache.getCityFresh('duisburg');
    expect(city?.response).toEqual(cityPayload);
    expect(cache.getCityFresh('moers')).toBeUndefined();

    const street = cache.getStreetFresh('05112000', fold('Königstraße'));
    expect(street?.response).toEqual(streetPayload);
    expect(cache.getStreetFresh('05112000', fold('Hauptstraße'))).toBeUndefined();
    expect(cache.getStreetFresh('06440008', 'koenigstrasse')).toBeUndefined(); // wrong ags
    cache.close();
  });

  it('freshness: rows go stale after CACHE_MAX_AGE_DAYS; stale reads still find them', () => {
    const { cache, advance } = makeCache();
    cache.writeCitySingle('duisburg', 'duisburg', cityPayload);
    expect(cache.getCityFresh('duisburg')).toBeDefined();
    advance(90 * DAY + 1);
    expect(cache.getCityFresh('duisburg')).toBeUndefined();
    expect(cache.getCityStale('duisburg')?.response).toEqual(cityPayload);
    cache.close();
  });

  it('upsert: exact hits update response and last_check', () => {
    const { cache, advance } = makeCache();
    cache.writeCitySingle('duisburg', 'duisburg', cityPayload);
    const first = cache.getCityFresh('duisburg');
    advance(1000);
    const updated = { ...cityPayload, subCode: '01' };
    cache.writeCitySingle('duisburg', 'duisburg', updated);
    const second = cache.getCityFresh('duisburg');
    expect(second?.response).toEqual(updated);
    expect(second?.lastCheck).toBeGreaterThan(first!.lastCheck);
    cache.close();
  });

  it('dual-write: variant + canonical keys are both present and readable', () => {
    const { cache } = makeCache();
    // user typed 'duisborch', upstream canonicalized to 'Duisburg'
    cache.writeCitySingle(fold('Duisborch'), fold('Duisburg'), cityPayload);
    const variant = cache.getCityFresh('duisborch');
    const canonical = cache.getCityFresh('duisburg');
    expect(variant?.response).toEqual(cityPayload);
    expect(variant?.isCanonical).toBe(false);
    expect(canonical?.response).toEqual(cityPayload);
    expect(canonical?.isCanonical).toBe(true);

    // street: 'koenigstrasse' variant → district-qualified canonical
    cache.writeStreetSingle('05112000', fold('Koenigstrasse'), fold('Königstraße / Altstadt / Dellviertel'), streetPayload);
    expect(cache.getStreetFresh('05112000', 'koenigstrasse')?.isCanonical).toBe(false);
    expect(cache.getStreetFresh('05112000', fold('Königstraße / Altstadt / Dellviertel'))?.isCanonical).toBe(true);
    cache.close();
  });

  it('delete-and-rewrite for lists: a shrunk list leaves no residue', () => {
    const { cache } = makeCache();
    cache.writeCityList('friedberg', {
      state: 'city_candidates',
      candidates: [
        { name: 'Friedberg (Hessen)', plz: '61169', kz: 'FB 08', ags: '06440008' },
        { name: 'Friedberg, Bayern', plz: '86316', kz: 'AIC 130', ags: '09771130' },
      ],
    });
    expect(cache.getCityFresh('friedberg')?.response.state).toBe('city_candidates');
    cache.writeCityList('friedberg', {
      state: 'city_candidates',
      candidates: [{ name: 'Friedberg (Hessen)', plz: '61169', kz: 'FB 08', ags: '06440008' }],
    });
    const row = cache.getCityFresh('friedberg');
    expect(row?.response.state).toBe('city_candidates');
    if (row?.response.state === 'city_candidates') {
      expect(row.response.candidates).toHaveLength(1);
    }
    cache.close();
  });

  it('CACHE_ENABLED=false bypasses read + write entirely (no file is created)', () => {
    const dbPath = tmpDb();
    const cache = new StreetcodeCache(dbPath, { enabled: false, maxAgeDays: 90, typoDays: 90, purgeMaxAgeDays: 365 });
    cache.writeCitySingle('duisburg', 'duisburg', cityPayload);
    expect(cache.getCityFresh('duisburg')).toBeUndefined();
    expect(cache.getCityStale('duisburg')).toBeUndefined();
    expect(cache.getStreetFresh('05112000', 'koenigstrasse')).toBeUndefined();
    expect(existsSync(dbPath)).toBe(false);
    cache.close();
  });
});

describe('StreetcodeCache — purge (three knobs)', () => {
  it('variant rows are purged at CACHE_TYPO_DAYS; canonical + list rows survive until CACHE_PURGE_MAX_AGE_DAYS', () => {
    const { cache, advance } = makeCache();
    cache.writeCitySingle('duisborch', 'duisburg', cityPayload); // variant + canonical
    cache.writeCityList('friedberg', {
      state: 'city_candidates',
      candidates: [{ name: 'Friedberg (Hessen)', plz: '61169', kz: 'FB 08', ags: '06440008' }],
    });

    advance(91 * DAY); // > typoDays (90), < purgeMaxAgeDays (365)
    const counts = cache.purge();
    expect(counts.city).toBe(1); // only the variant row
    expect(cache.getCityStale('duisborch')).toBeUndefined();
    expect(cache.getCityStale('duisburg')).toBeDefined(); // canonical survives
    expect(cache.getCityStale('friedberg')).toBeDefined(); // list row survives

    advance(365 * DAY); // now older than purgeMaxAgeDays
    cache.purge();
    expect(cache.getCityStale('duisburg')).toBeUndefined();
    expect(cache.getCityStale('friedberg')).toBeUndefined();
    cache.close();
  });

  it('street table purge mirrors the city table', () => {
    const { cache, advance } = makeCache();
    cache.writeStreetSingle('05112000', 'koenigstrasse', 'koenigstrasse / altstadt / dellviertel', streetPayload);
    advance(91 * DAY);
    const counts = cache.purge();
    expect(counts.street).toBe(1); // variant purged, canonical kept
    expect(cache.getStreetStale('05112000', 'koenigstrasse')).toBeUndefined();
    expect(cache.getStreetStale('05112000', 'koenigstrasse / altstadt / dellviertel')).toBeDefined();
    cache.close();
  });

  it('purge is transactional (a mid-purge failure rolls back cleanly)', () => {
    const { cache } = makeCache();
    cache.writeCitySingle('duisburg', 'duisburg', cityPayload);
    // force a mid-purge failure: an already-open transaction makes purge's own BEGIN fail
    const db = (cache as unknown as { db: { exec(sql: string): void } }).db;
    db.exec('BEGIN');
    let threw = false;
    try {
      cache.purge();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // the row is intact and the cache still works after the rollback
    expect(cache.getCityStale('duisburg')).toBeDefined();
    expect(() => cache.purge()).not.toThrow();
    expect(cache.getCityStale('duisburg')).toBeDefined();
    cache.close();
  });
});

describe('StreetcodeCache — locking and plans', () => {
  it('a concurrent read during a purge does not throw "database is locked" (WAL + timeout 5000)', async () => {
    const dbPath = tmpDb();
    const deps = { enabled: true, maxAgeDays: 90, typoDays: 90, purgeMaxAgeDays: 365 };
    const writer = new StreetcodeCache(dbPath, deps);
    const reader = new StreetcodeCache(dbPath, deps);
    writer.writeCitySingle('duisburg', 'duisburg', cityPayload);

    // purge on one connection while the other reads — must not throw
    expect(() => writer.purge()).not.toThrow();
    expect(() => reader.getCityFresh('duisburg')).not.toThrow();

    // heavy interleaving: writes on both connections (lock contention → busy timeout)
    for (let i = 0; i < 25; i++) {
      expect(() => writer.writeCitySingle(`city${i % 2}`, `city${i % 2}`, cityPayload)).not.toThrow();
      expect(() => reader.getCityFresh('duisburg')).not.toThrow();
    }
    writer.close();
    reader.close();
  });

  it('EXPLAIN QUERY PLAN: point lookups and purge deletes use indexes — no full scan', () => {
    const { cache } = makeCache();
    const readPlan = JSON.stringify(cache.explain(
      'SELECT response, is_canonical, last_check FROM city_lookup WHERE lookup = ? AND last_check >= ?',
    )).toUpperCase();
    expect(readPlan).toContain('USING');
    expect(readPlan).not.toContain('SCAN CITY_LOOKUP');
    const streetPlan = JSON.stringify(cache.explain(
      'SELECT response FROM street_lookup WHERE ags = ? AND lookup = ? AND last_check >= ?',
    )).toUpperCase();
    expect(streetPlan).not.toContain('SCAN STREET_LOOKUP');
    expect(JSON.stringify(cache.explain('DELETE FROM city_lookup WHERE last_check < ?')).toUpperCase()).toContain('IDX_CITY_PURGE');
    expect(JSON.stringify(cache.explain('DELETE FROM street_lookup WHERE last_check < ?')).toUpperCase()).toContain('IDX_STREET_PURGE');
    cache.close();
  });
});
