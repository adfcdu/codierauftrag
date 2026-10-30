import { describe, expect, it } from 'vitest';
import {
  formatConfigErrors,
  formatConfigWarnings,
  parseConfig,
} from '../src/config/parseConfig.js';
import { envFixture } from './helpers/fixtures.js';

const vollstaendig = envFixture('kv-beispielstadt.env');

describe('parseConfig — valid fixtures', () => {
  it('accepts the generic full-key .env with no errors and no warnings', () => {
    const result = parseConfig(vollstaendig);
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.warnings).toEqual([]);
    const c = result.config;
    expect(c.kreisVerband).toBe('KV Beispielstadt');
    expect(c.logoText).toBe('Beispielstadt');
    expect(c.ortInitial).toBe('Beispielstadt');
    expect(c.zeigeAkku).toBe(true);
    expect(c.zeigeEmail).toBe(true);
    expect(c.emailAdresse).toBe('codierung@beispielstadt.example'); // mailto:-Präfix entfernt
    expect(c.zeigeTelefon).toBe(true);
    expect(c.telefonNummer).toBe('0123 456789'); // tel:-Präfix entfernt
    expect(c.zeigePreise).toBe(true);
    expect(c.preisMitglied).toBe(5);
    expect(c.preisNichtMitglied).toBe(20);
    expect(c.aufpreisAkkuMitglied).toBe(2.5); // '2,5' → 2.5 (German decimal)
    expect(c.zeigeUmsatzsteuer).toBe(false);
    expect(c.umsatzsteuerProzent).toBe(0);
    expect(c.zeigeBarzahlung).toBe(true);
    expect(c.zeigeKartenzahlung).toBe(false);
    expect(c.pdfNurEineSeite).toBe(false);
    expect(c.zeigeCodierungBuchen).toBe(true);
    expect(c.banner1Text).toBe('Angebots-Hinweis 1');
    expect(c.banner2Text).toBe('Angebots-Hinweis 2');
    expect(c.banner1Url).toBe('https://beispielstadt.example/hinweis-1');
    expect(c.banner2Url).toBe('');
    expect(c.barcodeTyp).toBe('code128');
    expect(c.includeBarcodeCheck).toBe(false);
    expect(c.umlauteImBarcode).toBe(false);
    expect(c.inklusiveJahr).toBe(true);
    expect(c.zeitzone).toBe('Europe/Berlin');
    expect(c.cacheMaxAgeDays).toBe(90);
    expect(c.cacheTypoDays).toBe(90);
    expect(c.cachePurgeMaxAgeDays).toBe(365);
    expect(c.cachePurgeIntervalHours).toBe(720);
    expect(c.rateLimitPerMinute).toBe(20);
  });

  it('applies defaults on a minimal valid env', () => {
    const result = parseConfig(envFixture('minimal-valid.env'));
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    const c = result.config;
    expect(c.zeigeAkku).toBe(true); // default true (01 table)
    expect(c.zeigeCarbonRahmen).toBe(true); // default true
    expect(c.inklusiveJahr).toBe(true);
    expect(c.port).toBe(8080);
    expect(c.zeitzone).toBe('Europe/Berlin'); // silent default
    expect(c.upstreamUrls).toEqual([
      'https://fa-technik-adfc.de/fein',
      'https://codierung.adfc-hessen.de/code/ein',
    ]);
    expect(c.barcodeTyp).toBe('code128');
    expect(c.banner1Text).toBe(''); // default: Banner ausgeblendet
    expect(c.banner2Text).toBe('');
    expect(c.banner1Url).toBe('');
    expect(c.banner2Url).toBe('');
    expect(c.serverBasisUrl).toBe('');
    expect(c.ortInitial).toBe('');
  });

  it('sets process.env.TZ on success before returning', () => {
    const result = parseConfig({ ...envFixture('minimal-valid.env'), TZ: 'Europe/Berlin' });
    expect('errors' in result).toBe(false);
    expect(process.env.TZ).toBe('Europe/Berlin');
  });

  it('strips optional mailto:/tel: prefixes case-insensitively and stores the plain values', () => {
    const base = envFixture('kv-beispielstadt.env');
    const result = parseConfig({
      ...base,
      EMAIL_ADRESSE: 'MAILTO:codierung@beispielstadt.example',
      TELEFON_NUMMER: 'TEL:0123 456789',
    });
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.config.emailAdresse).toBe('codierung@beispielstadt.example');
    expect(result.config.telefonNummer).toBe('0123 456789');
  });

  it('rejects a foreign scheme in EMAIL_ADRESSE (mailto:-Präfix erzwungen)', () => {
    const base = envFixture('kv-beispielstadt.env');
    const result = parseConfig({ ...base, EMAIL_ADRESSE: 'https://beispielstadt.example' });
    expect('errors' in result).toBe(true);
  });
});

describe('parseConfig — error classes (German messages, aggregated, sorted by key)', () => {
  const errorCases: Array<[string, string, string]> = [
    ['error-kreis-verband-chars.env', 'KREIS_VERBAND', 'darf nur Buchstaben (inkl. Umlaute und ß), Leerzeichen, - und / enthalten'],
    ['error-kreis-verband-empty.env', 'KREIS_VERBAND', 'darf nicht leer sein'],
    ['error-logo-text-chars.env', 'LOGO_TEXT', 'darf nur Buchstaben (inkl. Umlaute und ß), Leerzeichen, - und / enthalten'],
    ['error-kv-web-url-missing.env', 'KV_WEB_URL', 'darf nicht leer sein'],
    ['error-kv-web-url-invalid.env', 'KV_WEB_URL', 'muss eine gültige http(s)-URL sein'],
    ['error-server-basis-url-path.env', 'SERVER_BASIS_URL', 'erwartet z. B. https://example.org, ohne Pfad'],
    ['error-email-required.env', 'EMAIL_ADRESSE', 'darf nicht leer sein, wenn ZEIGE_EMAIL=true'],
    ['error-email-invalid.env', 'EMAIL_ADRESSE', 'ist keine gültige E-Mail-Adresse'],
    ['error-telefon-required.env', 'TELEFON_NUMMER', 'darf nicht leer sein, wenn ZEIGE_TELEFON=true'],
    ['error-telefon-invalid.env', 'TELEFON_NUMMER', 'darf nur Ziffern, Leerzeichen und + / ( ) . - enthalten'],
    ['error-buchen-required.env', 'CODIERUNG_BUCHEN_URL', 'darf nicht leer sein, wenn ZEIGE_CODIERUNG_BUCHEN=true'],
    ['error-buchen-invalid-url.env', 'CODIERUNG_BUCHEN_URL', 'muss eine gültige http(s)-URL sein'],
    ['error-info-required.env', 'CODIERUNG_INFO_URL', 'darf nicht leer sein, wenn ZEIGE_CODIERUNG_INFO=true'],
    ['error-banner-too-long.env', 'BANNER_1_TEXT', 'darf höchstens 300 Zeichen lang sein'],
    ['error-barcode-c128a.env', 'BARCODE_TYP', 'C128A wird nicht mehr unterstützt — bitte CODE128 verwenden.'],
    ['error-barcode-c39plus.env', 'BARCODE_TYP', 'C39+ wird nicht mehr unterstützt — bitte CODE39EXT verwenden.'],
    ['error-barcode-unknown.env', 'BARCODE_TYP', 'muss CODE128, CODE39 oder CODE39EXT sein'],
    ['error-boolean-legacy-ja.env', 'ZEIGE_AKKU', 'migrieren'],
    ['error-boolean-invalid.env', 'ZEIGE_EMAIL', `muss 'true' oder 'false' sein`],
    ['error-tz-invalid.env', 'TZ', 'muss eine gültige Zeitzone sein (z. B. Europe/Berlin)'],
    ['error-port-range.env', 'PORT', 'muss zwischen 1 und 65535 liegen'],
    ['error-int-invalid.env', 'CACHE_MAX_AGE_DAYS', 'muss eine ganze Zahl sein'],
    ['error-cache-typo-gt-purge.env', 'CACHE_TYPO_DAYS', 'muss kleiner oder gleich CACHE_PURGE_MAX_AGE_DAYS sein'],
  ];

  it.each(errorCases)('%s → %s: %s', (fixture, key, reasonPart) => {
    const result = parseConfig(envFixture(fixture));
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    const err = result.errors.find((e) => e.key === key);
    expect(err).toBeDefined();
    expect(err!.reason).toContain(reasonPart);
  });

  it('ORT_INITIAL: accepts valid names, rejects invalid ones', () => {
    const base = envFixture('minimal-valid.env');
    expect('errors' in parseConfig({ ...base, ORT_INITIAL: 'St. Augustin' })).toBe(false);
    expect('errors' in parseConfig({ ...base, ORT_INITIAL: 'Bad Homburg v.d. Höhe' })).toBe(false);
    expect('errors' in parseConfig({ ...base, ORT_INITIAL: 'st. Augustin' })).toBe(true);
    expect('errors' in parseConfig({ ...base, ORT_INITIAL: 'Beispielstadt ' })).toBe(false); // trimmed before the regex
    expect('errors' in parseConfig({ ...base, ORT_INITIAL: '7Stadt' })).toBe(true);
    expect('errors' in parseConfig({ ...base, ORT_INITIAL: 'Beispielstadt 7' })).toBe(true);
  });

  it('SERVER_BASIS_URL accepts an origin without path and trims trailing slash', () => {
    const base = envFixture('minimal-valid.env');
    const result = parseConfig({ ...base, SERVER_BASIS_URL: 'https://example.org/' });
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.config.serverBasisUrl).toBe('https://example.org');
  });

  it('requires all six prices when PREISE_ANZEIGEN=true', () => {
    const result = parseConfig(envFixture('error-prices-required.env'));
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    const keys = result.errors.map((e) => e.key);
    expect(keys).toEqual([
      'PREIS_ANHAENGER_MITGLIED',
      'PREIS_ANHAENGER_NICHT_MITGLIED',
      'AUFPREIS_AKKU_MITGLIED',
      'AUFPREIS_AKKU_NICHT_MITGLIED',
      'PREIS_NICHT_MITGLIED',
    ].sort()); // sorted by key
  });

  it('rejects invalid German decimals and negatives', () => {
    const result = parseConfig(envFixture('error-price-invalid.env'));
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors.some((e) => e.key === 'PREIS_NICHT_MITGLIED' && e.reason === 'muss eine Dezimalzahl sein (z. B. 12,50)')).toBe(true);
    expect(result.errors.some((e) => e.key === 'AUFPREIS_AKKU_NICHT_MITGLIED' && e.reason === 'muss eine Dezimalzahl sein (z. B. 12,50)')).toBe(true);
  });

  it('accepts German decimal edge cases (20, 12,50, 2,5, 20.50)', () => {
    const base = envFixture('minimal-valid.env');
    const withPrices = {
      ...base,
      PREISE_ANZEIGEN: 'true',
      PREIS_MITGLIED: '20',
      PREIS_NICHT_MITGLIED: '12,50',
      PREIS_ANHAENGER_MITGLIED: '2,5',
      PREIS_ANHAENGER_NICHT_MITGLIED: '20.50',
      AUFPREIS_AKKU_MITGLIED: '0',
      AUFPREIS_AKKU_NICHT_MITGLIED: '5',
    };
    const result = parseConfig(withPrices);
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.config.preisMitglied).toBe(20);
    expect(result.config.preisNichtMitglied).toBe(12.5);
    expect(result.config.preisAnhaengerMitglied).toBe(2.5);
    expect(result.config.preisAnhaengerNichtMitglied).toBe(20.5);
  });

  it('requires UMSATZSTEUER_PROZENT iff VAT on (and prices on); range 0–100', () => {
    const required = parseConfig(envFixture('error-vat-percent-required.env'));
    expect('errors' in required).toBe(true);
    if ('errors' in required) {
      expect(required.errors.some((e) => e.key === 'UMSATZSTEUER_PROZENT' && e.reason === 'darf nicht leer sein, wenn ZEIGE_UMSATZSTEUER=true')).toBe(true);
    }
    const range = parseConfig(envFixture('error-vat-percent-range.env'));
    expect('errors' in range).toBe(true);
    if ('errors' in range) {
      expect(range.errors.some((e) => e.key === 'UMSATZSTEUER_PROZENT' && e.reason === 'muss zwischen 0 und 100 liegen')).toBe(true);
    }
  });

  it('CACHE_PURGE_MAX_AGE_DAYS equal to CACHE_MAX_AGE_DAYS is rejected (stale fallback would be destroyed)', () => {
    const result = parseConfig(envFixture('error-cache-knobs-equal.env'));
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors).toContainEqual({
      key: 'CACHE_PURGE_MAX_AGE_DAYS',
      reason: 'CACHE_PURGE_MAX_AGE_DAYS muss deutlich über CACHE_MAX_AGE_DAYS liegen, sonst entfällt der Ausfalls-Fallback',
    });
  });

  it('breaker knobs: defaults 5 / 60000, custom values accepted, < 1 rejected', () => {
    const base = envFixture('minimal-valid.env');
    const defaults = parseConfig(base);
    expect('errors' in defaults).toBe(false);
    if ('errors' in defaults) return;
    expect(defaults.config.breakerFailureThreshold).toBe(5);
    expect(defaults.config.breakerCooldownMs).toBe(60_000);

    const custom = parseConfig({ ...base, BREAKER_FAILURE_THRESHOLD: '3', BREAKER_COOLDOWN_MS: '120000' });
    expect('errors' in custom).toBe(false);
    if ('errors' in custom) return;
    expect(custom.config.breakerFailureThreshold).toBe(3);
    expect(custom.config.breakerCooldownMs).toBe(120_000);

    const bad = parseConfig({ ...base, BREAKER_FAILURE_THRESHOLD: '0', BREAKER_COOLDOWN_MS: '0' });
    expect('errors' in bad).toBe(true);
    if (!('errors' in bad)) return;
    expect(bad.errors).toContainEqual({ key: 'BREAKER_FAILURE_THRESHOLD', reason: 'muss 1 oder größer sein' });
    expect(bad.errors).toContainEqual({ key: 'BREAKER_COOLDOWN_MS', reason: 'muss 1 oder größer sein' });
  });

  it('C128B and C39E+ are accepted', () => {
    const c128b = parseConfig(envFixture('valid-barcode-c128b.env'));
    expect('errors' in c128b).toBe(false);
    if ('errors' in c128b) return;
    expect(c128b.config.barcodeTyp).toBe('code128');
    expect(c128b.config.includeBarcodeCheck).toBe(false);

    const c39eplus = parseConfig(envFixture('valid-barcode-c39eplus.env'));
    expect('errors' in c39eplus).toBe(false);
    if ('errors' in c39eplus) return;
    expect(c39eplus.config.barcodeTyp).toBe('code39ext');
    expect(c39eplus.config.includeBarcodeCheck).toBe(true); // C39E+ adds the check character
  });

  it('reports multiple errors at once, sorted by key', () => {
    const result = parseConfig(envFixture('error-multiple.env'));
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    const keys = result.errors.map((e) => e.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('BARCODE_TYP');
    expect(keys).toContain('TZ');
    expect(keys).toContain('KREIS_VERBAND');
    expect(keys).toContain('EMAIL_ADRESSE');
    expect(keys).toContain('CACHE_PURGE_MAX_AGE_DAYS');
    expect(keys.filter((k) => k.startsWith('PREIS_') || k.startsWith('AUFPREIS_')).length).toBe(6);
  });

  it('formats all errors as Konfigurationsfehler lines with the key order', () => {
    const result = parseConfig(envFixture('error-multiple.env'));
    if (!('errors' in result)) throw new Error('expected errors');
    const lines = formatConfigErrors(result.errors);
    expect(lines[0]).toMatch(/^Konfigurationsfehler: [A-Z_]+ — /);
    expect(lines.length).toBe(result.errors.length);
  });
});

describe('parseConfig — warnings (non-fatal)', () => {
  it('ZEIGE_UMSATZSTEUER=true without PREISE_ANZEIGEN=true: VAT ignored, warning printed, process starts', () => {
    const result = parseConfig(envFixture('warning-vat-without-prices.env'));
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.config.zeigeUmsatzsteuer).toBe(false);
    expect(result.config.umsatzsteuerProzent).toBe(0);
    expect(formatConfigWarnings(result.warnings)).toContain(
      'Warnung: ZEIGE_UMSATZSTEUER=true ohne PREISE_ANZEIGEN=true — Umsatzsteuer wird nicht angezeigt',
    );
  });

  it('unused-but-present UMSATZSTEUER_PROZENT=0 with VAT off: no error, no warning', () => {
    const result = parseConfig(envFixture('valid-vat-unused-percent.env'));
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.warnings).toEqual([]);
  });

  it('BANNER_1_URL without BANNER_1_TEXT: warning, process starts', () => {
    const base = envFixture('kv-beispielstadt.env');
    const result = parseConfig({ ...base, BANNER_1_TEXT: '', BANNER_1_URL: 'https://beispielstadt.example/leer' });
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.config.banner1Url).toBe('https://beispielstadt.example/leer');
    expect(formatConfigWarnings(result.warnings)).toContain(
      'Warnung: BANNER_1_URL ohne BANNER_1_TEXT — das Banner wird nicht angezeigt — der Link ist wirkungslos',
    );
  });

  it('BANNER_1_URL with an invalid URL: error (https only)', () => {
    const base = envFixture('kv-beispielstadt.env');
    for (const url of ['ftp://beispielstadt.example', 'http://beispielstadt.example', 'nicht-eine-url']) {
      const result = parseConfig({ ...base, BANNER_1_URL: url });
      expect('errors' in result).toBe(true);
      if (!('errors' in result)) return;
      const err = result.errors.find((e) => e.key === 'BANNER_1_URL');
      expect(err).toBeDefined();
      expect(err!.reason).toContain('muss eine gültige https-URL sein');
    }
  });

  it('unused-but-present values are still format-validated', () => {
    const base = envFixture('minimal-valid.env');
    const result = parseConfig({ ...base, UMSATZSTEUER_PROZENT: 'abc' });
    expect('errors' in result).toBe(true);
  });
});
