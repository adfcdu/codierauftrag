import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Parse a .env fixture into a plain env record (no inline-comment handling — fixtures avoid it). */
export function parseEnvFile(path: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function envFixture(name: string): Record<string, string | undefined> {
  return parseEnvFile(join(import.meta.dirname, '..', 'fixtures', 'env', name));
}

/** Read a frozen upstream capture as a latin1 buffer (never re-stringify the raw bytes). */
export function upstreamFixture(name: string): Buffer {
  return readFileSync(join(import.meta.dirname, '..', 'fixtures', 'upstream', name));
}

export function upstreamFixtureHtml(name: string): string {
  return upstreamFixture(name).toString('latin1');
}
