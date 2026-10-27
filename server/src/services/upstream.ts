/**
 * Upstream client — the ADFC code servers.
 * Transport: POST multipart with ISO-8859-1 field values for cold lookups,
 * GET follow-up (semicolon params, latin1 percent-encoding) once the city is resolved.
 * Response bodies are ISO-8859-1, parsed with cheerio (HTML5 semantics).
 */

import { randomUUID } from 'node:crypto';
import * as cheerio from 'cheerio';

export type UpstreamResult =
  | {
      state: 'single';
      city: string;
      plateCode: string;
      subCode: string;
      ags: string;
      street?: { code: string; name: string };
    }
  | {
      state: 'street_candidates';
      city: string;
      plateCode: string;
      subCode: string;
      ags: string;
      candidates: { name: string; ags: string }[];
    }
  | { state: 'city_candidates'; candidates: { display: string; kz: string; ags: string }[] }
  | { state: 'not_found' };

/** All upstream URLs failed (network, timeout, HTTP >= 400, oversized/unparseable body). */
export class UpstreamUnavailableError extends Error {
  constructor() {
    super('upstream unavailable');
    this.name = 'UpstreamUnavailableError';
  }
}
const BODY_CAP = 1_048_576; // ~1 MB response size cap
const ATTEMPT_TIMEOUT_MS = 30_000;

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse an upstream response page. Returns null when the page has no <form>
 * (the request is then treated as failed and the next URL is tried).
 */
export function parseUpstreamHtml(html: string): UpstreamResult | null {
  const $ = cheerio.load(html);
  const form = $('form').first();
  if (form.length === 0) return null;

  const ort = form.find('input[name="ort"]').attr('value');
  const kz = form.find('input[name="kz"]').attr('value');
  const ags = form.find('input[name="ags"]').attr('value');

  // Scoping rule: only the FIRST table[border="0"] inside the form is the
  // result table — single-state pages embed further border="0" tables (EIN preview).
  const rows = form.find('table[border="0"]').first().find('tr');

  if (ort && kz && ags) {
    const [plateCode, subCodeRaw] = kz.split(' ', 2);
    const subCode = plateCode === 'B' || plateCode === 'HH' ? '-' : (subCodeRaw ?? '');
    let street: { code: string; name: string } | undefined;
    const candidates: { name: string; ags: string }[] = [];
    for (const row of rows) {
      const cells = $(row).find('td');
      const firstCellText = $(cells[0]).text().trim();
      if (firstCellText === 'Straße') {
        const texts = $(cells[3])
          .contents()
          .map((_i, el) => $(el).text().trim())
          .get()
          .filter(Boolean);
        if (/^\d{3,5}$/.test(texts[0])) street = { code: texts[0], name: texts[1] };
      } else if (firstCellText === kz) {
        // candidate name = the second cell's text (never parsed out of the href);
        // in the live HTML the anchor is self-closed, so the name sits after it —
        // the cell text is the parser-independent extraction.
        const name = $(cells[1]).text().trim();
        const href = $(cells[1]).find('a').attr('href') ?? '';
        const m = href.match(/ags=(\d+)/);
        if (name && m) candidates.push({ name, ags: m[1] });
      }
    }
    if (street) {
      return { state: 'single', city: ort, plateCode, subCode, ags, street };
    }
    return { state: 'street_candidates', city: ort, plateCode, subCode, ags, candidates };
  }

  const list: { display: string; kz: string; ags: string }[] = [];
  for (const row of rows) {
    const a = $(row).find('td').eq(0).find('a');
    if (a.length === 0) continue;
    // stray \r before the PLZ closing paren — stripped here.
    // parse5 normalizes \r to \n in text content, so strip both line endings.
    const display = $(row).find('td').eq(1).text().replace(/[\r\n]+/g, '').trim();
    const m = a.attr('href')?.match(/ags=(\d+)/);
    if (display && m) list.push({ kz: a.text().trim(), display, ags: m[1] });
  }
  if (list.length > 0) return { state: 'city_candidates', candidates: list };
  return { state: 'not_found' };
}

// ── splitOrtPlz (plz digits captured server-side) ──

export interface OrtPlz {
  /** full display string incl. (PLZ: …) — the cmp0 sort key */
  display: string;
  /** name without the PLZ parenthetical */
  name: string;
  /** the digits captured from the PLZ parenthetical ('' if absent) */
  plz: string;
}

export function splitOrtPlz(display: string): OrtPlz {
  const m = display.match(/\s*\(PLZ:[^)]+\)$/);
  if (!m) return { display, name: display, plz: '' };
  const digits = m[0].match(/\d+/);
  return {
    display,
    name: display.slice(0, m.index).trim(),
    plz: digits ? digits[0] : '',
  };
}

// ── Transport building ──────────────────────────────────────────────────────

/**
 * Hand-built multipart body with raw ISO-8859-1 field values.
 * FormData must NOT be used — it encodes strings as UTF-8.
 */
export function buildMultipart(fields: Record<string, string>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = 'codierauftrag-' + randomUUID();
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`, 'latin1'),
    );
    parts.push(Buffer.from(value, 'latin1')); // UTF-8 → ISO-8859-1
    parts.push(Buffer.from('\r\n', 'latin1')); // end the value before the next boundary
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Percent-encode each latin1 byte except the unreserved set [A-Za-z0-9-._~]. */
export function percentEncodeLatin1(value: string): string {
  const bytes = Buffer.from(value, 'latin1');
  let out = '';
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

/** GET follow-up: ?ags=<ags>;str=<enc>;hsnr=1;n1=x;n2=x (semicolon-separated params). */
export function buildFollowUpQuery(ags: string, street: string): string {
  return `?ags=${ags};str=${percentEncodeLatin1(street)};hsnr=1;n1=x;n2=x`;
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface UpstreamClient {
  /** One POST carrying city + street together (cold lookup). */
  post(city: string, street: string): Promise<{ result: UpstreamResult; urlIndex: number }>;
  /** GET follow-up within a resolved city (ags known). */
  get(ags: string, street: string): Promise<{ result: UpstreamResult; urlIndex: number }>;
}

export interface UpstreamClientDeps {
  urls: string[]; // primary first
  version: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => number; // circuit-breaker clock (tests)
  /** Consecutive failures before the breaker opens (BREAKER_FAILURE_THRESHOLD, default 5). */
  breakerFailureThreshold?: number;
  /** Cool-off window in ms while the breaker stays open (BREAKER_COOLDOWN_MS, default 60 s). */
  breakerCooldownMs?: number;
}

/** Circuit breaker: after N consecutive failures, fail fast. */

async function readBodyCapped(res: Response): Promise<Buffer> {
  if (!res.body) {
    return Buffer.from(await res.arrayBuffer());
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_CAP) {
      await reader.cancel();
      throw new Error('upstream body exceeds size cap');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export function createUpstreamClient(deps: UpstreamClientDeps): UpstreamClient {
  const doFetch = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const userAgent = `codierauftrag/${deps.version}`;
  const now = deps.now ?? Date.now;
  const breakerFailureThreshold = deps.breakerFailureThreshold ?? 5;
  const breakerCooldownMs = deps.breakerCooldownMs ?? 60_000;
  let consecutiveFailures = 0;
  let openUntil = 0; // epoch ms; 0 = closed

  async function attempt(url: string, init: RequestInit): Promise<UpstreamResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
      // Response body ISO-8859-1 → UTF-8 (upstream contract).
      const body = await readBodyCapped(res);
      const result = parseUpstreamHtml(body.toString('latin1'));
      if (result === null) throw new Error('upstream page has no form');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  interface UpstreamRequest {
    url: string;
    init: RequestInit;
  }

  async function run(
    makeRequest: (base: string) => UpstreamRequest,
  ): Promise<{ result: UpstreamResult; urlIndex: number }> {
    // circuit open: skip upstream entirely — the resolver serves the stale
    // fallback chain (cache still answers from disk while upstream is down)
    if (now() < openUntil) {
      throw new UpstreamUnavailableError();
    }
    for (let i = 0; i < deps.urls.length; i++) {
      try {
        const { url, init } = makeRequest(deps.urls[i]);
        const result = await attempt(url, init);
        consecutiveFailures = 0;
        return { result, urlIndex: i };
      } catch {
        // try the next URL in order
      }
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= breakerFailureThreshold) {
      openUntil = now() + breakerCooldownMs;
    }
    throw new UpstreamUnavailableError();
  }

  return {
    async post(city: string, street: string) {
      const { body, contentType } = buildMultipart({
        name: city,
        str: street,
        hsnr: '1',
        n1: 'x',
        n2: 'x',
        suchen: 'suchen',
      });
      return run((base) => ({
        url: base,
        init: {
          method: 'POST',
          headers: { 'content-type': contentType, 'user-agent': userAgent },
          body: new Uint8Array(body),
        },
      }));
    },
    async get(ags: string, street: string) {
      const query = buildFollowUpQuery(ags, street);
      return run((base) => ({
        url: base + query,
        init: { method: 'GET', headers: { 'user-agent': userAgent } },
      }));
    },
  };
}
