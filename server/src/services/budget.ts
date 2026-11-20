/**
 * Persisted daily budget for REAL upstream calls.
 *
 * One aggregate row per day (`upstream_budget`) — no IPs, no lookup strings, so
 * the counter carries no personal data. Unlike the per-IP rate limiter (RAM
 * only), this counter must survive restarts: it is the instance's contribution
 * to the upstream's nationwide daily limit.
 *
 * Only calls that actually reach the upstream are counted — cache hits and
 * single-flight collapses are free.
 */

import { Database, Statement } from 'node:sqlite';

export interface DailyBudget {
  /** true = consumed (also when the budget is off or the DB write failed); false = exhausted today. */
  tryConsume(): boolean;
  /** calls consumed today (0 when the budget is off) */
  used(): number;
  /** drop day rows older than the retention window; returns the deleted count */
  purge(): number;
  close(): void;
}

export interface BudgetDeps {
  dbPath: string;
  limitPerDay: number; // 0 = off
  zeitzone: string; // day boundary follows the instance timezone, not UTC
  now?: () => number;
  /** called when a counter write fails (the budget then fails open) */
  onError?: (err: unknown) => void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS upstream_budget (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
`;

/** Day rows kept for diagnostics; older rows are purged. */
const KEEP_DAYS = 7;

/** `YYYY-MM-DD` in the given IANA timezone (sv-SE renders ISO order). */
export function dayKey(now: number, zeitzone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zeitzone }).format(new Date(now));
}

export function createDailyBudget(deps: BudgetDeps): DailyBudget {
  const now = deps.now ?? Date.now;
  if (deps.limitPerDay <= 0) {
    return { tryConsume: () => true, used: () => 0, purge: () => 0, close: () => {} };
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: deps.zeitzone });
  const today = (): string => formatter.format(new Date(now()));

  const db = new Database(deps.dbPath, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);

  const stGet: Statement = db.prepare('SELECT count FROM upstream_budget WHERE day = ?');
  const stIncrement: Statement = db.prepare(
    `INSERT INTO upstream_budget (day, count) VALUES (?, 1)
     ON CONFLICT (day) DO UPDATE SET count = count + 1`,
  );
  const stPurge: Statement = db.prepare('DELETE FROM upstream_budget WHERE day < ?');

  const readCount = (day: string): number => {
    const row = stGet.get(day) as { count: number } | undefined;
    return row?.count ?? 0;
  };

  return {
    tryConsume(): boolean {
      const day = today();
      try {
        // node:sqlite is synchronous, so read-then-increment cannot interleave
        // with another request in this process
        if (readCount(day) >= deps.limitPerDay) return false;
        stIncrement.run(day);
        return true;
      } catch (err) {
        // fail open: the budget is a courtesy toward the upstream, not a
        // security control — a broken counter must not take the form down
        deps.onError?.(err);
        return true;
      }
    },

    used(): number {
      try {
        return readCount(today());
      } catch (err) {
        deps.onError?.(err);
        return 0;
      }
    },

    purge(): number {
      const cutoff = dayKey(now() - KEEP_DAYS * 86_400_000, deps.zeitzone);
      return stPurge.run(cutoff).changes;
    },

    close(): void {
      db.close();
    },
  };
}
