/**
 * Upstream-Hinweis: Der echte Upstream (z. B. https://fa-technik-adfc.de/fein) ist
 * langsam und hat strenge Rate-Limits. Tests dürfen ihn NICHT direkt erreichen.
 * createUpstreamClient immer mit fetchFn-Stub und Stub-URLs (z. B. https://stub/fein)
 * aufrufen; Antworten aus den recorded Fixtures (server/test/fixtures/upstream/) speisen.
 */

import { describe, expect, it } from 'vitest';
import {
  buildFollowUpQuery,
  buildMultipart,
  parseUpstreamHtml,
  percentEncodeLatin1,
  splitOrtPlz,
  createUpstreamClient,
  UpstreamUnavailableError,
} from '../src/services/upstream.js';
import { upstreamFixture, upstreamFixtureHtml } from './helpers/fixtures.js';

describe('parseUpstreamHtml — frozen fixture map (07)', () => {
  it('single: Königstraße / Altstadt / Dellviertel (Duisburg)', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-koenigstrasse-altstadt.html'));
    expect(r).toEqual({
      state: 'single',
      city: 'Duisburg',
      plateCode: 'DU',
      subCode: '00',
      ags: '05112000',
      street: { code: '01944', name: 'Königstraße / Altstadt / Dellviertel' },
    });
  });

  it('single via plain POST (no ags in the request): hidden ags present — AGS gate check 1', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-koenigstrasse-altstadt-post.html'));
    expect(r).toMatchObject({
      state: 'single',
      plateCode: 'DU',
      subCode: '00',
      ags: '05112000',
    });
    expect(r && r.state === 'single' && r.street).toEqual({
      code: '01944',
      name: 'Königstraße / Altstadt / Dellviertel',
    });
  });

  it('single via GET follow-up without ort in the request — AGS gate check 4', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-get-followup-probe.html'));
    expect(r).toMatchObject({ state: 'single', plateCode: 'DU', subCode: '00', ags: '05112000' });
    expect(r && r.state === 'single' && r.street).toEqual({
      code: '01944',
      name: 'Königstraße / Altstadt / Dellviertel',
    });
  });

  it('single: Friedberg Hauptstraße via ags', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-friedberg-hauptstrasse-ags.html'));
    expect(r).toMatchObject({
      state: 'single',
      city: 'Friedberg (Hessen)',
      plateCode: 'FB',
      subCode: '08',
      ags: '06440008',
    });
    expect(r && r.state === 'single' && r.street?.code).toBe('00426');
  });

  it('street_candidates: 4 Duisburg Königstraße variants, all ags 05112000, names from the second cell', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-koenigstrasse.html'));
    expect(r).toMatchObject({ state: 'street_candidates', city: 'Duisburg', plateCode: 'DU', subCode: '00', ags: '05112000' });
    if (!r || r.state !== 'street_candidates') return;
    expect(r.candidates.map((c) => c.name)).toEqual([
      'Königstraße / Altstadt / Dellviertel',
      'Königstraße / Alt-Homberg',
      'Königstraße / Friemersheim',
      'Königstraße / Alt-Walsum / Vierlinden',
    ]);
    expect(r.candidates.every((c) => c.ags === '05112000')).toBe(true); // AGS gate check 2
  });

  it('street_candidates for the ASCII spelling: same 4 entries (upstream umlaut normalization)', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-ascii-koenigstrasse.html'));
    expect(r).toMatchObject({ state: 'street_candidates' });
    if (!r || r.state !== 'street_candidates') return;
    expect(r.candidates.map((c) => c.name)).toEqual([
      'Königstraße / Altstadt / Dellviertel',
      'Königstraße / Alt-Homberg',
      'Königstraße / Friemersheim',
      'Königstraße / Alt-Walsum / Vierlinden',
    ]);
  });

  it('street_candidates with hint text: ≥ 5 fuzzy entries', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-str-notfound.html'));
    expect(r).toMatchObject({ state: 'street_candidates' });
    if (!r || r.state !== 'street_candidates') return;
    expect(r.candidates.length).toBeGreaterThanOrEqual(5);
  });

  it('city_candidates: name/plz split source, \\r stripped, ags in hrefs — AGS gate check 3', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-friedberg-ortselection.html'));
    expect(r).toEqual({
      state: 'city_candidates',
      candidates: [
        { kz: 'FB 08', display: 'Friedberg (Hessen) (PLZ: 61169)', ags: '06440008' },
        { kz: 'AIC 130', display: 'Friedberg, Bayern (PLZ: 86316)', ags: '09771130' },
      ],
    });
  });

  it('not_found: no hidden inputs, no candidate rows', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-ort-notfound.html'));
    expect(r).toEqual({ state: 'not_found' });
  });

  it('redirect pages have no form → null (the request counts as failed, next URL is tried)', () => {
    expect(parseUpstreamHtml(upstreamFixtureHtml('resp-hessen-codeein-redirect.html'))).toBeNull();
    expect(parseUpstreamHtml(upstreamFixtureHtml('hessen-form.html'))).toBeNull();
  });

  it('form contracts: POST multipart to /fein (fa-fein-form) and /ein (fa-form)', () => {
    const feinHtml = upstreamFixtureHtml('fa-fein-form.html');
    expect(feinHtml).toMatch(/<form[^>]*method="post"[^>]*action="\/fein"[^>]*enctype="multipart\/form-data"/);
    for (const field of ['name', 'str', 'hsnr', 'n1', 'n2', 'suchen']) {
      expect(feinHtml).toContain(`name="${field}"`);
    }
    const publicHtml = upstreamFixtureHtml('fa-form.html');
    expect(publicHtml).toMatch(/action="\/ein"/);
    expect(publicHtml).toContain('enctype="multipart/form-data"');
  });

  it('EIN-preview-table scoping: single fixtures yield no phantom candidates', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-koenigstrasse-altstadt.html'));
    expect(r?.state).toBe('single'); // not street_candidates
    const r2 = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-friedberg-hauptstrasse-ags.html'));
    expect(r2?.state).toBe('single');
  });
});

describe('encoding (ISO-8859-1 both ways)', () => {
  it('latin1 decoding of the captures yields proper umlauts', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-koenigstrasse-altstadt.html'));
    expect(r && r.state === 'single' && r.street?.name).toBe('Königstraße / Altstadt / Dellviertel');
  });

  it('UTF-8 decoding of the same bytes yields mojibake (the response must NOT be parsed as UTF-8)', () => {
    const wronglyDecoded = upstreamFixture('resp-fa-fein-duisburg-koenigstrasse-altstadt.html').toString('utf8');
    const r = parseUpstreamHtml(wronglyDecoded);
    expect(r && r.state === 'single' && r.street?.name).not.toBe('Königstraße / Altstadt / Dellviertel');
  });

  it('the utf8test capture documents the mojibake the wrong request encoding produces', () => {
    const r = parseUpstreamHtml(upstreamFixtureHtml('resp-fa-fein-duisburg-utf8test.html'));
    // the request was sent with UTF-8 bytes → the upstream saw garbage
    expect(r).not.toBeNull();
    if (r && r.state === 'street_candidates') {
      expect(r.candidates.some((c) => c.name === 'Königstraße / Altstadt / Dellviertel')).toBe(false);
    }
  });

  it('buildMultipart produces latin1 bytes (ö → single byte 0xF6, never the UTF-8 pair)', () => {
    const { body } = buildMultipart({ name: 'Duisburg', str: 'Königstraße' });
    const marker = Buffer.from('name="str"\r\n\r\n', 'latin1');
    const strPart = body.indexOf(marker);
    expect(strPart).toBeGreaterThan(0);
    const valueStart = strPart + marker.length;
    expect(body[valueStart]).toBe(0x4b); // K
    expect(body[valueStart + 1]).toBe(0xf6); // ö as a single latin1 byte
    expect(body.subarray(valueStart, valueStart + 11).toString('latin1')).toBe('Königstraße');
    expect(body.subarray(valueStart, valueStart + 3)).toEqual(Buffer.from([0x4b, 0xf6, 0x6e]));
  });

  it('percentEncodeLatin1: latin1 bytes percent-encoded, unreserved untouched', () => {
    expect(percentEncodeLatin1('Königstraße / Altstadt / Dellviertel')).toBe(
      'K%F6nigstra%DFe%20%2F%20Altstadt%20%2F%20Dellviertel',
    );
    expect(percentEncodeLatin1('abcXYZ0-._~')).toBe('abcXYZ0-._~');
  });

  it('buildFollowUpQuery: semicolon-separated params', () => {
    expect(buildFollowUpQuery('05112000', 'Königstraße / Altstadt / Dellviertel')).toBe(
      '?ags=05112000;str=K%F6nigstra%DFe%20%2F%20Altstadt%20%2F%20Dellviertel;hsnr=1;n1=x;n2=x',
    );
  });
});

describe('kz split + splitOrtPlz (ports)', () => {
  it('kz B/HH → subCode "-" (unit level)', () => {
    const berlin = `<form><input type="hidden" name="ort" value="Berlin"/><input type="hidden" name="kz" value="B 01"/><input type="hidden" name="ags" value="11000000"/><table border="0"><tr><td>Straße</td><td></td><td></td><td><b>01234</b> Teststraße</td></tr></table></form>`;
    const r = parseUpstreamHtml(berlin);
    expect(r).toMatchObject({ state: 'single', plateCode: 'B', subCode: '-' });
    const hamburg = berlin.replace('value="B 01"', 'value="HH 02"');
    expect(parseUpstreamHtml(hamburg)).toMatchObject({ plateCode: 'HH', subCode: '-' });
  });

  it('splitOrtPlz: strips the PLZ parenthetical, keeps the full display, captures the digits', () => {
    expect(splitOrtPlz('Friedberg (Hessen) (PLZ: 61169)')).toEqual({
      display: 'Friedberg (Hessen) (PLZ: 61169)',
      name: 'Friedberg (Hessen)',
      plz: '61169',
    });
    expect(splitOrtPlz('Friedberg, Bayern (PLZ: 86316)')).toEqual({
      display: 'Friedberg, Bayern (PLZ: 86316)',
      name: 'Friedberg, Bayern',
      plz: '86316',
    });
    expect(splitOrtPlz('Duisburg')).toEqual({ display: 'Duisburg', name: 'Duisburg', plz: '' });
  });

  it('stray \\r in PLZ parentheticals is stripped by the parser', () => {
    expect(splitOrtPlz('Friedberg (Hessen) (PLZ: 61169\r)')).toEqual({
      display: 'Friedberg (Hessen) (PLZ: 61169\r)',
      name: 'Friedberg (Hessen)',
      plz: '61169',
    });
  });
});

describe('upstream client transport', () => {
  const fixtureResponse = (name: string): Response =>
    new Response(new Uint8Array(upstreamFixture(name)), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
    });

  it('posts multipart with latin1 values and parses the latin1 response', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return fixtureResponse('resp-fa-fein-duisburg-koenigstrasse-altstadt.html');
    };
    const client = createUpstreamClient({ urls: ['https://stub/fein'], version: '1.0.0', fetchFn });
    const { result, urlIndex } = await client.post('Duisburg', 'Königstraße / Altstadt / Dellviertel');
    expect(urlIndex).toBe(0);
    expect(result).toMatchObject({ state: 'single', city: 'Duisburg' });
    expect(calls.length).toBe(1);
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=codierauftrag-/);
    expect(headers['user-agent']).toBe('codierauftrag/1.0.0');
    const body = Buffer.from(calls[0].init.body as Uint8Array);
    expect(body.includes(Buffer.from('Königstraße / Altstadt / Dellviertel', 'latin1'))).toBe(true);
  });

  it('builds the GET follow-up with percent-encoded latin1 street', async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url));
      return fixtureResponse('resp-fa-fein-duisburg-koenigstrasse-altstadt.html');
    };
    const client = createUpstreamClient({ urls: ['https://stub/fein', 'https://stub2/code/ein'], version: '1.0.0', fetchFn });
    const { urlIndex } = await client.get('05112000', 'Königstraße / Altstadt / Dellviertel');
    expect(urlIndex).toBe(0);
    expect(urls[0]).toBe(
      'https://stub/fein?ags=05112000;str=K%F6nigstra%DFe%20%2F%20Altstadt%20%2F%20Dellviertel;hsnr=1;n1=x;n2=x',
    );
  });

  it('tries URLs in order and throws UpstreamUnavailableError when all fail', async () => {
    const tried: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      tried.push(String(url));
      if (tried.length === 1) return new Response('gone', { status: 500 });
      return new Response('no form here', { status: 200 });
    };
    const client = createUpstreamClient({ urls: ['https://stub/a', 'https://stub/b'], version: '1', fetchFn });
    await expect(client.post('Xyzhausen', '')).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(tried).toEqual(['https://stub/a', 'https://stub/b']);
  });

  it('aborts on a body over the ~1 MB cap and tries the next URL', async () => {
    const big = Buffer.alloc(1_200_000, 0x61);
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response(new Uint8Array(big), { status: 200 });
      return fixtureResponse('resp-fa-fein-ort-notfound.html');
    };
    const client = createUpstreamClient({ urls: ['https://stub/a', 'https://stub/b'], version: '1', fetchFn });
    const { result } = await client.post('Xyzhausen', '');
    expect(result).toEqual({ state: 'not_found' });
    expect(calls).toBe(2);
  });
});
