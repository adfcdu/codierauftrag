/**
 * Upstream-Hinweis: Der echte Upstream (z. B. https://fa-technik-adfc.de/fein) ist
 * langsam und hat strenge Rate-Limits. Tests dürfen ihn NICHT direkt erreichen.
 * Immer den injizierten fetchFn-Stub verwenden und UPSTREAM_URLS auf einen
 * Stub-Host (z. B. https://stub/fein) setzen; Antworten aus den recorded
 * Fixtures (server/test/fixtures/upstream/) speisen.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppHandle, CreateAppResult } from '../src/app.js';
import { envFixture, upstreamFixture } from './helpers/fixtures.js';
import { fold } from '../src/services/fold.js';
import type { CitySinglePayload, StreetSinglePayload } from '../src/services/cache.js';

const DAY = 86_400_000;

// ── fixture-backed upstream stub ──

function multipartField(body: Buffer, name: string): string {
  const marker = Buffer.from(`name="${name}"\r\n\r\n`, 'latin1');
  const idx = body.indexOf(marker);
  if (idx < 0) return '';
  const start = idx + marker.length;
  const end = body.indexOf(Buffer.from('\r\n--', 'latin1'), start);
  return body.subarray(start, end < 0 ? undefined : end).toString('latin1');
}

function decodePercentLatin1(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%' && i + 2 < s.length + 1 && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(s.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('latin1');
}

interface StubCall {
  method: string;
  url: string;
  city?: string;
  street?: string;
  ags?: string;
}

function makeStub() {
  const calls: StubCall[] = [];
  let failing = false;
  const fixtureResponse = (name: string): Response =>
    new Response(new Uint8Array(upstreamFixture(name)), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
    });

  // city-only upstream response (POST with empty str): resolved city, no Straße row
  const cityOnlyHtml =
    '<form method="post" action="/fein" enctype="multipart/form-data">' +
    '<input type="hidden" name="ort" value="Duisburg"/>' +
    '<input type="hidden" name="kz" value="DU 00"/>' +
    '<input type="hidden" name="ags" value="05112000"/>' +
    '<table border="0"><tr><td><b>Ort</b></td><td><input type="text" name="name" value="Duisburg"/></td><td><b>DU 00</b></td><td>Duisburg</td></tr></table></form>';

  function fixtureForPost(city: string, street: string): string | null {
    if (city === 'Duisburg' && street === '') {
      return null; // served from cityOnlyHtml
    }
    if (city === 'Duisburg' && street === ALTSTADT) {
      return 'resp-fa-fein-duisburg-koenigstrasse-altstadt.html';
    }
    if (city === 'Duisburg' && street === 'Königstraße') {
      return 'resp-fa-fein-duisburg-koenigstrasse.html';
    }
    if (city === 'Duisburg' && street === 'Koenigstrasse') {
      return 'resp-fa-fein-duisburg-ascii-koenigstrasse.html';
    }
    if (city === 'Friedberg') {
      return 'resp-fa-fein-friedberg-ortselection.html';
    }
    return 'resp-fa-fein-ort-notfound.html';
  }

  function fixtureForGet(street: string): string {
    if (street.includes('Altstadt / Dellviertel')) {
      return 'resp-fa-fein-duisburg-koenigstrasse-altstadt.html';
    }
    if (street === 'Königstraße') {
      return 'resp-fa-fein-duisburg-koenigstrasse.html';
    }
    return 'resp-fa-fein-ort-notfound.html';
  }

  const fetchFn: typeof fetch = async (url, init) => {
    if (failing) throw new Error('upstream down');
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      const body = Buffer.from(init?.body as Uint8Array);
      const city = multipartField(body, 'name');
      const street = multipartField(body, 'str');
      calls.push({ method, url: u, city, street });
      const fixture = fixtureForPost(city, street);
      return fixture
        ? fixtureResponse(fixture)
        : new Response(new Uint8Array(Buffer.from(cityOnlyHtml, 'latin1')), {
            status: 200,
            headers: { 'content-type': 'text/html; charset=iso-8859-1' },
          });
    }
    const ags = u.match(/ags=(\d+)/)?.[1] ?? '';
    const street = decodePercentLatin1(u.match(/[?;]str=([^;]*)/)?.[1] ?? '');
    calls.push({ method, url: u, street, ags });
    return fixtureResponse(fixtureForGet(street));
  };

  return {
    calls,
    fail() {
      failing = true;
    },
    fetchFn,
  };
}

// ── app factory ──

let appToClose: AppHandle | null = null;
let dirs: string[] = [];

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codierauftrag-streetcode-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
}

async function makeApp(
  envOverrides: Record<string, string | undefined> = {},
  opts: { now?: () => number; fetchFn?: typeof fetch } = {},
): Promise<Extract<CreateAppResult, { ok: true }>> {
  const env = {
    ...envFixture('minimal-valid.env'),
    CACHE_DB_PATH: tmpDb(),
    ...envOverrides,
  };
  const handle = await createApp({ env, fetchFn: opts.fetchFn, now: opts.now });
  if (!handle.ok) throw new Error('app failed to start: ' + JSON.stringify(handle.errors));
  appToClose = handle;
  return handle;
}

afterEach(async () => {
  if (appToClose) await appToClose.close();
  appToClose = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const q = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

const ALTSTADT = 'Königstraße / Altstadt / Dellviertel';

describe('GET /api/streetcode — states', () => {
  it('cold lookup: ONE POST carrying city + street resolves both', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      state: 'single',
      city: 'Duisburg',
      plateCode: 'DU',
      subCode: '00',
      ags: '05112000',
      street: ALTSTADT,
      streetCode: '01944',
      normalizedCity: false,
      normalizedStreet: false,
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].method).toBe('POST');
    expect(stub.calls[0].city).toBe('Duisburg');
    expect(stub.calls[0].street).toBe(ALTSTADT);
  });

  it('fresh cache hit: no upstream call at all', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    expect(stub.calls).toHaveLength(1);
    const res2 = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    expect(res2.statusCode).toBe(200);
    expect(stub.calls).toHaveLength(1); // unchanged
    expect(res2.json().state).toBe('single');
  });

  it('folded keys: case/whitespace variants share one row and one upstream call; normalized flags use the RAW input', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    const res2 = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'duisburg ', street: ALTSTADT })}` });
    expect(res2.statusCode).toBe(200);
    const body = res2.json();
    expect(body.state).toBe('single');
    expect(body.normalizedCity).toBe(true); // canonical 'Duisburg' !== raw 'duisburg '
    expect(stub.calls).toHaveLength(1); // same cache row — no new upstream call
  });

  it('city-only lookup: single with city fields, no street', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: '' })}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('single');
    expect(res.json().street).toBeUndefined();
  });

  it('street_candidates: sorted case-insensitively on the full district-qualified name', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: 'Königstraße' })}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('street_candidates');
    expect(body.city).toBe('Duisburg');
    expect(body.candidates.map((c: { street: string }) => c.street)).toEqual([
      'Königstraße / Alt-Homberg',
      'Königstraße / Alt-Walsum / Vierlinden',
      'Königstraße / Altstadt / Dellviertel',
      'Königstraße / Friemersheim',
    ]);
  });

  it('city_candidates: name/plz split server-side, sorted on the full display string', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Friedberg', street: '' })}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      state: 'city_candidates',
      candidates: [
        { name: 'Friedberg (Hessen)', plz: '61169', kz: 'FB 08', ags: '06440008' },
        { name: 'Friedberg, Bayern', plz: '86316', kz: 'AIC 130', ags: '09771130' },
      ],
    });
  });

  it('not_found: 404 with scope city (cold POST)', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Xyzhausen', street: 'x' })}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ state: 'not_found', scope: 'city' });
  });
});

describe('GET /api/streetcode — ags follow-up (verified gate design)', () => {
  it('ags param: street-only resolution via the GET follow-up, percent-encoded latin1', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT, ags: '05112000' })}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('single');
    expect(res.json().streetCode).toBe('01944');
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].method).toBe('GET');
    expect(stub.calls[0].url).toContain(
      'str=K%F6nigstra%DFe%20%2F%20Altstadt%20%2F%20Dellviertel;hsnr=1;n1=x;n2=x',
    );
    expect(stub.calls[0].ags).toBe('05112000');
  });

  it('ags param with fresh street cache hit: no upstream call', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT, ags: '05112000' })}`,
    });
    const res2 = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT, ags: '05112000' })}`,
    });
    expect(res2.statusCode).toBe(200);
    expect(stub.calls).toHaveLength(1);
  });

  it('fresh city cache hit but street miss: GET follow-up, never a re-POST', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    // resolve the city (city-only POST), then resolve a street within it
    await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: '' })}` });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('single');
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1].method).toBe('GET'); // follow-up, not a second POST
  });

  it('ags without street: 400 invalid_request', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Duisburg', street: '', ags: '05112000' })}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().state).toBe('invalid_request');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('GET /api/streetcode — single-flight, limits, validation', () => {
  it('N concurrent identical cold requests → ONE upstream call', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const url = `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => app.app.inject({ method: 'GET', url })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(stub.calls).toHaveLength(1);
  });

  it('rate limit: 429 { state: "rate_limited" } on excess', async () => {
    const stub = makeStub();
    const app = await makeApp(
      { UPSTREAM_URLS: 'https://stub/fein', RATE_LIMIT_PER_MINUTE: '3' },
      { fetchFn: stub.fetchFn },
    );
    const url = `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}`;
    const r1 = await app.app.inject({ method: 'GET', url });
    const r2 = await app.app.inject({ method: 'GET', url });
    const r3 = await app.app.inject({ method: 'GET', url });
    const r4 = await app.app.inject({ method: 'GET', url });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(200);
    expect(r4.statusCode).toBe(429);
    expect(r4.json()).toEqual({ state: 'rate_limited' });
  });

  it('400 TypeBox shapes: missing/overlong city, bad ags pattern', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const missing = await app.app.inject({ method: 'GET', url: '/api/streetcode?street=x' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().state).toBe('invalid_request');
    expect(Array.isArray(missing.json().details)).toBe(true);

    const whitespace = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: '  ' })}` });
    expect(whitespace.statusCode).toBe(400);
    expect(whitespace.json().state).toBe('invalid_request');

    const badAgs = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Duisburg', street: 'x', ags: '05112' })}`,
    });
    expect(badAgs.statusCode).toBe(400);
    expect(badAgs.json().state).toBe('invalid_request');

    expect(stub.calls).toHaveLength(0);
  });
});

describe('GET /api/streetcode — stale fallback', () => {
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
    street: ALTSTADT,
    streetCode: '01944',
  };

  it('all upstream URLs fail + empty cache → 502 { state: "upstream_unavailable" }', async () => {
    const stub = makeStub();
    stub.fail();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein,https://stub2/code/ein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ state: 'upstream_unavailable' });
  });

  it('stale city + stale street are served with stale: true and NO cache write on the stale path', async () => {
    const stub = makeStub();
    let t = 1_700_000_000_000;
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn, now: () => t });
    // seed at t0
    app.cache.writeCitySingle('duisburg', 'duisburg', cityPayload);
    const streetKey = fold(ALTSTADT);
    app.cache.writeStreetSingle('05112000', streetKey, streetKey, streetPayload);
    const seededAt = app.cache.getCityStale('duisburg')!.lastCheck;

    t += 91 * DAY; // rows go stale (freshness window 90 d)
    stub.fail();
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      state: 'single',
      city: 'Duisburg',
      plateCode: 'DU',
      subCode: '00',
      ags: '05112000',
      street: ALTSTADT,
      streetCode: '01944',
      stale: true,
    });
    // no cache write on the stale path — last_check unchanged
    expect(app.cache.getCityStale('duisburg')!.lastCheck).toBe(seededAt);
    expect(app.cache.getStreetStale('05112000', fold(ALTSTADT))!.lastCheck).toBe(seededAt);
  });

  it('partial stale hit: stale city without stale street → single with city fields only, stale: true', async () => {
    const stub = makeStub();
    let t = 1_700_000_000_000;
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn, now: () => t });
    app.cache.writeCitySingle('duisburg', 'duisburg', cityPayload);
    t += 91 * DAY;
    stub.fail();
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: 'Unbekannte Straße' })}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('single');
    expect(body.city).toBe('Duisburg');
    expect(body.street).toBeUndefined();
    expect(body.stale).toBe(true);
  });

  it('stale city LIST is served as city_candidates with stale: true (third step of the chain)', async () => {
    const stub = makeStub();
    let t = 1_700_000_000_000;
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn, now: () => t });
    app.cache.writeCityList('friedberg', {
      state: 'city_candidates',
      candidates: [{ name: 'Friedberg (Hessen)', plz: '61169', kz: 'FB 08', ags: '06440008' }],
    });
    t += 91 * DAY;
    stub.fail();
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Friedberg', street: '' })}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('city_candidates');
    expect(body.stale).toBe(true);
    expect(body.candidates).toEqual([
      { name: 'Friedberg (Hessen)', plz: '61169', kz: 'FB 08', ags: '06440008' },
    ]);
  });

  it('no stale rows at all → 502', async () => {
    const stub = makeStub();
    stub.fail();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    const res = await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    expect(res.statusCode).toBe(502);
  });
});

describe('circuit breaker', () => {
  it('after 5 consecutive upstream failures, calls are skipped during the cool-off', async () => {
    let t = 1_700_000_000_000;
    const calls: string[] = [];
    const fetchFn: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      // cold lookups POST the city in the multipart body; follow-ups carry it in the URL
      const city =
        init?.method === 'POST' && init.body
          ? multipartField(Buffer.from(init.body as Uint8Array), 'name')
          : decodeURIComponent(url.match(/city=([^&]*)/)?.[1] ?? '');
      if (city.startsWith('Failburg')) throw new Error('down');
      return new Response(new Uint8Array(upstreamFixture('resp-fa-fein-duisburg-koenigstrasse-altstadt.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      });
    }) as typeof fetch;
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn, now: () => t });

    // 5 consecutive failing lookups → breaker opens
    for (let i = 0; i < 5; i++) {
      const res = await app.app.inject({
        method: 'GET',
        url: `/api/streetcode?${q({ city: `Failburg${i}`, street: 'x' })}`,
      });
      expect(res.statusCode).toBe(502);
    }
    expect(calls.length).toBe(5);

    // circuit open → the next request never reaches upstream, still 502
    const blocked = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Failburg99', street: 'x' })}`,
    });
    expect(blocked.statusCode).toBe(502);
    expect(calls.length).toBe(5); // no fetch call

    // after the 60 s cool-off, upstream is tried again
    t += 61_000;
    const retried = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Failburg100', street: 'x' })}`,
    });
    expect(retried.statusCode).toBe(502);
    expect(calls.length).toBe(6);
  });

  it('BREAKER_FAILURE_THRESHOLD and BREAKER_COOLDOWN_MS are configurable', async () => {
    let t = 1_900_000_000_000;
    const calls: string[] = [];
    const fetchFn: typeof fetch = (async () => {
      calls.push('call');
      throw new Error('down');
    }) as typeof fetch;
    const app = await makeApp(
      {
        UPSTREAM_URLS: 'https://stub/fein',
        BREAKER_FAILURE_THRESHOLD: '3',
        BREAKER_COOLDOWN_MS: '5000',
      },
      { fetchFn, now: () => t },
    );

    // 3 consecutive failures (threshold configurable, not 5) → breaker opens
    for (let i = 0; i < 3; i++) {
      const res = await app.app.inject({
        method: 'GET',
        url: `/api/streetcode?${q({ city: `Failburg${i}`, street: 'x' })}`,
      });
      expect(res.statusCode).toBe(502);
    }
    expect(calls.length).toBe(3);

    // circuit open → the next request never reaches upstream
    const blocked = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Failburg99', street: 'x' })}`,
    });
    expect(blocked.statusCode).toBe(502);
    expect(calls.length).toBe(3); // no fetch call

    // after the configured 5 s cool-off (not 60 s), upstream is tried again
    t += 5_001;
    const retried = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Failburg100', street: 'x' })}`,
    });
    expect(retried.statusCode).toBe(502);
    expect(calls.length).toBe(4);
  });

  it('a successful upstream call resets the failure counter', async () => {
    const t = 1_800_000_000_000;
    const calls: string[] = [];
    const fetchFn: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      // cold lookups POST the city in the multipart body; follow-ups carry it in the URL
      const city =
        init?.method === 'POST' && init.body
          ? multipartField(Buffer.from(init.body as Uint8Array), 'name')
          : decodeURIComponent(url.match(/city=([^&]*)/)?.[1] ?? '');
      if (city.startsWith('Failburg')) throw new Error('down');
      return new Response(new Uint8Array(upstreamFixture('resp-fa-fein-duisburg-koenigstrasse-altstadt.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      });
    }) as typeof fetch;
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn, now: () => t });

    // 4 failures, then a success → counter reset
    for (let i = 0; i < 4; i++) {
      const res = await app.app.inject({
        method: 'GET',
        url: `/api/streetcode?${q({ city: `Failburg${i}`, street: 'x' })}`,
      });
      expect(res.statusCode).toBe(502);
    }
    const ok = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Duisburg', street: 'Königstraße / Altstadt / Dellviertel' })}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(calls.length).toBe(5);

    // 4 more failures: the circuit must NOT open (counter was reset)
    for (let i = 10; i < 14; i++) {
      const res = await app.app.inject({
        method: 'GET',
        url: `/api/streetcode?${q({ city: `Failburg${i}`, street: 'x' })}`,
      });
      expect(res.statusCode).toBe(502);
    }
    expect(calls.length).toBe(9);
    // the 5th CONSECUTIVE failure opens it
    const open = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Failburg99', street: 'x' })}`,
    });
    expect(open.statusCode).toBe(502);
    expect(calls.length).toBe(10);
    const blocked = await app.app.inject({
      method: 'GET',
      url: `/api/streetcode?${q({ city: 'Failburg98', street: 'x' })}`,
    });
    expect(blocked.statusCode).toBe(502);
    expect(calls.length).toBe(10); // skipped — circuit open
  });
});

describe('GET /api/streetcode — privacy logging', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('log lines are fixed-field JSON: no query params, no IPs, no looked-up strings', async () => {
    const stub = makeStub();
    const app = await makeApp({ UPSTREAM_URLS: 'https://stub/fein' }, { fetchFn: stub.fetchFn });
    await app.app.inject({ method: 'GET', url: `/api/streetcode?${q({ city: 'Duisburg', street: ALTSTADT })}` });
    const lines = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('"msg":"streetcode"'));
    expect(lines.length).toBeGreaterThan(0);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry).toMatchObject({ lvl: 'info', msg: 'streetcode', state: 'single', status: 200 });
    expect(typeof entry.durMs).toBe('number');
    expect(typeof entry.upstream).toBe('number');
    const logged = lines.join('');
    expect(logged).not.toContain('Königstraße');
    expect(logged).not.toContain('Duisburg');
    expect(logged).not.toContain('127.0.0.1');
    expect(logged).not.toContain('fa-technik');
  });
});
