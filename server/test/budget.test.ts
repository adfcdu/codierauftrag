import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDailyBudget, dayKey } from '../src/services/budget.js';

const DAY = 86_400_000;
let dirs: string[] = [];

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codierauftrag-budget-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('dayKey', () => {
  it('follows the instance timezone, not UTC', () => {
    const t = Date.parse('2026-02-14T23:30:00Z');
    expect(dayKey(t, 'UTC')).toBe('2026-02-14');
    expect(dayKey(t, 'Europe/Berlin')).toBe('2026-02-15');
  });
});

describe('createDailyBudget', () => {
  it('limit 0 = off: always allows, counts nothing, opens no database', () => {
    const dbPath = tmpDb();
    const budget = createDailyBudget({ dbPath, limitPerDay: 0, zeitzone: 'Europe/Berlin' });
    for (let i = 0; i < 1000; i++) expect(budget.tryConsume()).toBe(true);
    expect(budget.used()).toBe(0);
    expect(existsSync(dbPath)).toBe(false);
    budget.close();
  });

  it('consumes up to the limit, then refuses — the counter never exceeds the limit', () => {
    const budget = createDailyBudget({ dbPath: tmpDb(), limitPerDay: 3, zeitzone: 'Europe/Berlin' });
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.used()).toBe(3);
    budget.close();
  });

  it('survives a restart: a new instance on the same file sees the spent budget', () => {
    const dbPath = tmpDb();
    const first = createDailyBudget({ dbPath, limitPerDay: 2, zeitzone: 'Europe/Berlin' });
    expect(first.tryConsume()).toBe(true);
    expect(first.tryConsume()).toBe(true);
    first.close();

    const second = createDailyBudget({ dbPath, limitPerDay: 2, zeitzone: 'Europe/Berlin' });
    expect(second.used()).toBe(2);
    expect(second.tryConsume()).toBe(false);
    second.close();
  });

  it('resets at the instance-timezone midnight, not at UTC midnight', () => {
    let t = Date.parse('2026-02-14T22:30:00Z'); // 23:30 in Berlin
    const budget = createDailyBudget({
      dbPath: tmpDb(),
      limitPerDay: 1,
      zeitzone: 'Europe/Berlin',
      now: () => t,
    });
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);

    t = Date.parse('2026-02-14T23:30:00Z'); // 00:30 in Berlin — a new day
    expect(budget.used()).toBe(0);
    expect(budget.tryConsume()).toBe(true);
    budget.close();
  });

  it('purge drops day rows older than the retention window', () => {
    let t = Date.parse('2026-02-01T12:00:00Z');
    const budget = createDailyBudget({
      dbPath: tmpDb(),
      limitPerDay: 5,
      zeitzone: 'Europe/Berlin',
      now: () => t,
    });
    expect(budget.tryConsume()).toBe(true);
    t += 10 * DAY;
    expect(budget.purge()).toBe(1);
    expect(budget.used()).toBe(0);
    budget.close();
  });

  it('fails open when the counter cannot be written', () => {
    const errors: unknown[] = [];
    const budget = createDailyBudget({
      dbPath: tmpDb(),
      limitPerDay: 1,
      zeitzone: 'Europe/Berlin',
      onError: (err) => errors.push(err),
    });
    expect(budget.tryConsume()).toBe(true);
    budget.close(); // every statement now throws
    expect(budget.tryConsume()).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
  });
});
