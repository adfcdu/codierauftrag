/**
 * Upstream-Hinweis: Der echte Upstream (z. B. https://fa-technik-adfc.de/fein) ist
 * langsam und hat strenge Rate-Limits. Tests dürfen ihn NICHT direkt erreichen.
 * makeApp hier reicht keinen fetchFn-Stub durch — deshalb nur Endpunkte testen,
 * die keinen Upstream-Lookup auslösen (/api/config, /healthz, Fehlerseiten, Static).
 * Für Lookup-Tests: streetcode.test.ts (dort mit fetchFn-Stub + UPSTREAM_URLS auf
 * einen Stub-Host, z. B. https://stub/fein).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppHandle, CreateAppResult } from '../src/app.js';
import { envFixture } from './helpers/fixtures.js';
import { buildPublicConfig } from '../src/routes/config.js';
import { renderErrorPage } from '../src/errorPage.js';
import { parseConfig } from '../src/config/parseConfig.js';

let appToClose: AppHandle | null = null;
let dirs: string[] = [];

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codierauftrag-api-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
}

async function makeApp(
  envOverrides: Record<string, string | undefined> = {},
): Promise<Extract<CreateAppResult, { ok: true }>> {
  const env = {
    ...envFixture('kv-beispielstadt.env'),
    CACHE_DB_PATH: tmpDb(),
    ...envOverrides,
  };
  const handle = await createApp({ env, version: '1.0.0-test' });
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

describe('GET /api/config', () => {
  it('serves exactly the public subset — no infra keys, ortInitial + zeitzone present', async () => {
    const app = await makeApp();
    const res = await app.app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      kreisVerband: 'KV Beispielstadt',
      logoText: 'Beispielstadt',
      kvWebUrl: 'https://beispielstadt.adfc.de',
      ortInitial: 'Beispielstadt',
      datenschutzUrl: 'https://beispielstadt.example/datenschutz',
      zeigeAkku: true,
      zeigeEmail: true,
      emailAdresse: 'codierung@beispielstadt.example',
      zeigeTelefon: true,
      telefonNummer: '0123 456789',
      zeigePreise: true,
      preisMitglied: 5,
      preisNichtMitglied: 20,
      preisAnhaengerMitglied: 5,
      preisAnhaengerNichtMitglied: 20,
      aufpreisAkkuMitglied: 2.5,
      aufpreisAkkuNichtMitglied: 5,
      zeigeUmsatzsteuer: false,
      umsatzsteuerProzent: 0,
      zeigeBarzahlung: true,
      zeigeKartenzahlung: false,
      pdfNurEineSeite: false,
      zeigeCodierungBuchen: true,
      codierungBuchenUrl: 'https://beispielstadt.example/codiertermin',
      zeigeCodierungInfo: true,
      codierungInfoUrl: 'https://beispielstadt.example/codierung',
      barcodeTyp: 'code128',
      includeBarcodeCheck: false,
      umlauteImBarcode: false,
      inklusiveJahr: true,
      zeitzone: 'Europe/Berlin',
      version: '1.0.0-test',
    });
    for (const forbidden of [
      'serverBasisUrl',
      'upstreamUrls',
      'cacheDbPath',
      'cacheEnabled',
      'port',
      'rateLimitPerMinute',
      'cacheMaxAgeDays',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns byte-identical bodies on repeat calls (frozen at boot)', async () => {
    const app = await makeApp();
    const r1 = await app.app.inject({ method: 'GET', url: '/api/config' });
    const r2 = await app.app.inject({ method: 'GET', url: '/api/config' });
    expect(r1.body).toBe(r2.body);
  });
});

describe('security headers', () => {
  it('CSP, nosniff, no-referrer, X-Frame-Options: DENY on every response surface', async () => {
    const app = await makeApp();
    for (const url of ['/', '/api/config', '/healthz', '/gibtsnicht', '/api/unknown']) {
      const res = await app.app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy'], url).toBe(
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
      );
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['referrer-policy'], url).toBe('no-referrer');
      expect(res.headers['x-frame-options'], url).toBe('DENY');
    }
  });

  it('static cache-control: hashed assets immutable, everything else no-cache', async () => {
    const app = await makeApp();
    const asset = '/assets/index.js';
    const res = await app.app.inject({ method: 'GET', url: asset });
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const page = await app.app.inject({ method: 'GET', url: '/' });
    expect(page.headers['cache-control']).toBe('no-cache');
    const config = await app.app.inject({ method: 'GET', url: '/api/config' });
    expect(config.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /healthz', () => {
  it('returns 200 text/plain "ok"', async () => {
    const app = await makeApp();
    const res = await app.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });
});

describe('error surfaces', () => {
  it('unknown path → HTML error page with status 404 (title, contacts, local Datenschutz link)', async () => {
    const app = await makeApp();
    const res = await app.app.inject({ method: 'GET', url: '/gibtsnicht' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>Codierformular - Fehler</title>');
    expect(res.body).toContain('Es ist ein interner Fehler aufgetreten');
    expect(res.body).toContain('Bitte versuchen Sie es später erneut.');
    expect(res.body).toContain('E-Mail: <a href="mailto:codierung@beispielstadt.example">codierung@beispielstadt.example</a>');
    expect(res.body).toContain('Telefon: <a href="tel:0123456789">0123 456789</a>');
    expect(res.body).toContain('href="impressum_datenschutz.html"');
    expect(res.body).toContain('Impressum und Datenschutz');
  });

  it('contact lines appear iff the toggles are on', () => {
    const base = envFixture('kv-beispielstadt.env');
    const withContacts = parseConfig(base);
    if ('errors' in withContacts) throw new Error('fixture invalid');
    const html = renderErrorPage(withContacts.config);
    expect(html).toContain('<a href="mailto:codierung@beispielstadt.example">codierung@beispielstadt.example</a>');
    expect(html).toContain('<a href="tel:0123456789">0123 456789</a>');

    const noContacts = parseConfig({
      ...envFixture('minimal-valid.env'),
    });
    if ('errors' in noContacts) throw new Error('fixture invalid');
    const html2 = renderErrorPage(noContacts.config);
    expect(html2).not.toContain('E-Mail:');
    expect(html2).not.toContain('Telefon:');
    expect(html2).toContain('Impressum und Datenschutz');
  });

  it('unknown /api path → structured JSON 404', async () => {
    const app = await makeApp();
    const res = await app.app.inject({ method: 'GET', url: '/api/unknown' });
    expect(res.statusCode).toBe(404);
    expect(res.json().state).toBe('invalid_request');
  });

  it('unhandled API error → JSON 500; unhandled page error → HTML error page 500', async () => {
    const app = await makeApp();
    app.app.get('/api/boom', async () => {
      throw new Error('boom');
    });
    app.app.get('/boom', async () => {
      throw new Error('boom');
    });
    const apiRes = await app.app.inject({ method: 'GET', url: '/api/boom' });
    expect(apiRes.statusCode).toBe(500);
    expect(apiRes.json().state).toBe('internal_error');
    const pageRes = await app.app.inject({ method: 'GET', url: '/boom' });
    expect(pageRes.statusCode).toBe(500);
    expect(pageRes.headers['content-type']).toContain('text/html');
    expect(pageRes.body).toContain('<title>Codierformular - Fehler</title>');
  });
});

describe('buildPublicConfig — the generic example body', () => {
  it('matches the generic example body', () => {
    const parsed = parseConfig(envFixture('kv-beispielstadt.env'));
    if ('errors' in parsed) throw new Error('fixture invalid');
    const c = parsed.config;
    expect(buildPublicConfig(c, '1.0.0')).toMatchObject({
      kreisVerband: 'KV Beispielstadt',
      logoText: 'Beispielstadt',
      kvWebUrl: 'https://beispielstadt.adfc.de',
      ortInitial: 'Beispielstadt',
      datenschutzUrl: 'https://beispielstadt.example/datenschutz',
      zeigeAkku: true,
      zeigeEmail: true,
      emailAdresse: 'codierung@beispielstadt.example',
      zeigeTelefon: true,
      telefonNummer: '0123 456789',
      zeigePreise: true,
      preisMitglied: 5,
      preisNichtMitglied: 20,
      preisAnhaengerMitglied: 5,
      preisAnhaengerNichtMitglied: 20,
      aufpreisAkkuMitglied: 2.5,
      aufpreisAkkuNichtMitglied: 5,
      zeigeUmsatzsteuer: false,
      umsatzsteuerProzent: 0,
      zeigeBarzahlung: true,
      zeigeKartenzahlung: false,
      pdfNurEineSeite: false,
      zeigeCodierungBuchen: true,
      codierungBuchenUrl: 'https://beispielstadt.example/codiertermin',
      zeigeCodierungInfo: true,
      codierungInfoUrl: 'https://beispielstadt.example/codierung',
      barcodeTyp: 'code128',
      includeBarcodeCheck: false,
      umlauteImBarcode: false,
      inklusiveJahr: true,
      zeitzone: 'Europe/Berlin',
      version: '1.0.0',
    });
  });
});
