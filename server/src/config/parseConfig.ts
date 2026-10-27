/**
 * Startup guard + warnings.
 * Called once at boot in app.ts, before anything uses dates (the guard applies TZ).
 * All keys are validated and all errors aggregated.
 */

export interface ParsedConfig {
  // instance
  kreisVerband: string;
  logoText: string;
  kvWebUrl: string;
  serverBasisUrl: string; // '' = unused
  ortInitial: string; // '' = unset
  datenschutzUrl: string; // default: local impressum_datenschutz.html
  zeigeAkku: boolean;
  zeigeEmail: boolean;
  emailAdresse: string;
  zeigeTelefon: boolean;
  telefonNummer: string;
  zeigePreise: boolean;
  preisMitglied: number;
  preisNichtMitglied: number;
  preisAnhaengerMitglied: number;
  preisAnhaengerNichtMitglied: number;
  aufpreisAkkuMitglied: number;
  aufpreisAkkuNichtMitglied: number;
  zeigeUmsatzsteuer: boolean;
  umsatzsteuerProzent: number; // 0 when off
  zeigeBarzahlung: boolean;
  zeigeKartenzahlung: boolean;
  pdfNurEineSeite: boolean;
  zeigeCodierungBuchen: boolean;
  codierungBuchenUrl: string;
  zeigeCodierungInfo: boolean;
  codierungInfoUrl: string;
  barcodeTyp: 'code128' | 'code39' | 'code39ext';
  includeBarcodeCheck: boolean; // true iff C39E+
  umlauteImBarcode: boolean;
  inklusiveJahr: boolean;
  // infra
  port: number;
  zeitzone: string; // validated IANA name
  upstreamUrls: string[]; // primary first
  cacheEnabled: boolean;
  cacheDbPath: string;
  cacheMaxAgeDays: number;
  cacheTypoDays: number;
  cachePurgeMaxAgeDays: number;
  cachePurgeIntervalHours: number;
  breakerFailureThreshold: number;
  breakerCooldownMs: number;
  rateLimitPerMinute: number; // 0 = off
}

export interface ConfigError {
  key: string;
  reason: string; // German
}

export interface ConfigWarning {
  key: string;
  reason: string; // German
}

export type ParseConfigResult =
  | { config: ParsedConfig; warnings: ConfigWarning[] }
  | { errors: ConfigError[] };

export function parseConfig(env: Record<string, string | undefined>): ParseConfigResult {
  const errors: ConfigError[] = [];
  const warnings: ConfigWarning[] = [];

  const raw = (key: string): string | undefined => env[key];
  const isUnset = (key: string): boolean => {
    const v = env[key];
    return v === undefined || v.trim() === '';
  };

  const err = (key: string, reason: string): void => {
    errors.push({ key, reason });
  };

  // ── Booleans first (a false toggle suppresses the dependent-key requirement) ──

  function bool(key: string, def: boolean): boolean {
    if (isUnset(key)) return def;
    const v = raw(key)!.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^(ja|nein)$/i.test(v)) {
      err(
        key,
        `muss 'true' oder 'false' sein ('${v}' stammt noch aus der config.ini — bitte zu 'true'/'false' migrieren)`,
      );
    } else {
      err(key, `muss 'true' oder 'false' sein`);
    }
    return def;
  }

  const zeigeAkku = bool('ZEIGE_AKKU', true);
  const zeigeEmail = bool('ZEIGE_EMAIL', false);
  const zeigeTelefon = bool('ZEIGE_TELEFON', false);
  const zeigePreise = bool('PREISE_ANZEIGEN', false);
  const zeigeUmsatzsteuerRaw = bool('ZEIGE_UMSATZSTEUER', false);
  const zeigeBarzahlung = bool('ZEIGE_BARZAHLUNG', false);
  const zeigeKartenzahlung = bool('ZEIGE_KARTENZAHLUNG', false);
  const pdfNurEineSeite = bool('PDF_NUR_EINE_SEITE', false);
  const zeigeCodierungBuchen = bool('ZEIGE_CODIERUNG_BUCHEN', false);
  const zeigeCodierungInfo = bool('ZEIGE_CODIERUNG_INFO', false);
  const umlauteImBarcode = bool('UMLAUTE_IM_BARCODE', false);
  const inklusiveJahr = bool('INKLUSIVE_JAHR', true);
  const cacheEnabled = bool('CACHE_ENABLED', true);

  // ── German decimals ──

  function decimal(key: string): number | undefined {
    if (isUnset(key)) return undefined;
    const v = raw(key)!.trim();
    if (!/^\d+([.,]\d+)?$/.test(v)) {
      err(key, `muss eine Dezimalzahl sein (z. B. 12,50)`);
      return undefined;
    }
    return Number(v.replace(',', '.'));
  }

  // ── URLs ──

  function url(key: string): string | undefined {
    if (isUnset(key)) return undefined;
    const v = raw(key)!.trim();
    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      err(key, `muss eine gültige http(s)-URL sein`);
      return undefined;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      err(key, `muss eine gültige http(s)-URL sein`);
      return undefined;
    }
    return v;
  }

  // ── Instance keys ──

  function name(key: string): string {
    if (isUnset(key)) {
      err(key, `darf nicht leer sein`);
      return '';
    }
    const v = raw(key)!.trim();
    if (!/^[A-Za-zäöüÄÖÜß\-\/ ]+$/.test(v)) {
      err(key, `darf nur Buchstaben (inkl. Umlaute und ß), Leerzeichen, - und / enthalten`);
      return '';
    }
    return v;
  }

  const kreisVerband = name('KREIS_VERBAND');
  const logoText = name('LOGO_TEXT');

  if (isUnset('KV_WEB_URL')) err('KV_WEB_URL', `darf nicht leer sein`);
  const kvWebUrl = url('KV_WEB_URL') ?? '';

  let serverBasisUrl = '';
  if (!isUnset('SERVER_BASIS_URL')) {
    const v = raw('SERVER_BASIS_URL')!.trim();
    const trimmed = v.replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      parsed = null as unknown as URL;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      err('SERVER_BASIS_URL', `muss eine gültige http(s)-URL sein`);
    } else if (parsed.pathname !== '/') {
      err('SERVER_BASIS_URL', `erwartet z. B. https://example.org, ohne Pfad`);
    } else {
      serverBasisUrl = trimmed;
    }
  }

  let ortInitial = '';
  if (!isUnset('ORT_INITIAL')) {
    const v = raw('ORT_INITIAL')!.trim();
    if (!/^[A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ'\.\- ]*[a-zäöüßA-ZÄÖÜ]$/.test(v)) {
      err('ORT_INITIAL', `muss mit einem Großbuchstaben beginnen und mit einem Buchstaben enden`);
    } else {
      ortInitial = v;
    }
  }

  let datenschutzUrl = 'impressum_datenschutz.html';
  if (!isUnset('DATENSCHUTZ_URL')) {
    const v = raw('DATENSCHUTZ_URL')!.trim();
    if (/^https?:\/\//.test(v) || v.includes('://')) {
      const u = url('DATENSCHUTZ_URL');
      if (u !== undefined) datenschutzUrl = u;
    } else {
      datenschutzUrl = v; // local page path (e.g. the default impressum_datenschutz.html)
    }
  }

  let emailAdresse = '';
  if (!isUnset('EMAIL_ADRESSE')) {
    const v = raw('EMAIL_ADRESSE')!.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      err('EMAIL_ADRESSE', `ist keine gültige E-Mail-Adresse`);
    } else {
      emailAdresse = v;
    }
  } else if (zeigeEmail) {
    err('EMAIL_ADRESSE', `darf nicht leer sein, wenn ZEIGE_EMAIL=true`);
  }

  let telefonNummer = '';
  if (!isUnset('TELEFON_NUMMER')) {
    const v = raw('TELEFON_NUMMER')!.trim();
    if (!/^[\d\s+\/().-]+$/.test(v)) {
      err('TELEFON_NUMMER', `darf nur Ziffern, Leerzeichen und + / ( ) . - enthalten`);
    } else {
      telefonNummer = v;
    }
  } else if (zeigeTelefon) {
    err('TELEFON_NUMMER', `darf nicht leer sein, wenn ZEIGE_TELEFON=true`);
  }

  // Prices: all six required iff PREISE_ANZEIGEN=true; format-validated even when unused.
  const priceKeys = [
    'PREIS_MITGLIED',
    'PREIS_NICHT_MITGLIED',
    'PREIS_ANHAENGER_MITGLIED',
    'PREIS_ANHAENGER_NICHT_MITGLIED',
    'AUFPREIS_AKKU_MITGLIED',
    'AUFPREIS_AKKU_NICHT_MITGLIED',
  ] as const;
  const prices: Record<string, number> = {};
  for (const key of priceKeys) {
    const value = decimal(key);
    if (value === undefined && zeigePreise) {
      err(key, `darf nicht leer sein, wenn PREISE_ANZEIGEN=true`);
    }
    prices[key] = value ?? 0;
  }

  // VAT: 'true' without prices → silent degradation + boot warning.
  let zeigeUmsatzsteuer = false;
  let umsatzsteuerProzent = 0;
  if (!zeigePreise && zeigeUmsatzsteuerRaw) {
    warnings.push({
      key: 'ZEIGE_UMSATZSTEUER=true ohne PREISE_ANZEIGEN=true',
      reason: `Umsatzsteuer wird nicht angezeigt`,
    });
  } else if (zeigePreise && zeigeUmsatzsteuerRaw) {
    zeigeUmsatzsteuer = true;
    const pct = decimal('UMSATZSTEUER_PROZENT');
    if (pct === undefined) {
      err('UMSATZSTEUER_PROZENT', `darf nicht leer sein, wenn ZEIGE_UMSATZSTEUER=true`);
    } else if (pct < 0 || pct > 100) {
      err('UMSATZSTEUER_PROZENT', `muss zwischen 0 und 100 liegen`);
    } else {
      umsatzsteuerProzent = pct;
    }
  } else {
    decimal('UMSATZSTEUER_PROZENT'); // format-only validation when unused
  }

  let codierungBuchenUrl = '';
  if (zeigeCodierungBuchen) {
    if (isUnset('CODIERUNG_BUCHEN_URL')) {
      err('CODIERUNG_BUCHEN_URL', `darf nicht leer sein, wenn ZEIGE_CODIERUNG_BUCHEN=true`);
    } else {
      codierungBuchenUrl = url('CODIERUNG_BUCHEN_URL') ?? '';
    }
  }

  let codierungInfoUrl = '';
  if (zeigeCodierungInfo) {
    if (isUnset('CODIERUNG_INFO_URL')) {
      err('CODIERUNG_INFO_URL', `darf nicht leer sein, wenn ZEIGE_CODIERUNG_INFO=true`);
    } else {
      codierungInfoUrl = url('CODIERUNG_INFO_URL') ?? '';
    }
  }

  // Barcode type → bwip-js bcid.
  let barcodeTyp: ParsedConfig['barcodeTyp'] = 'code128';
  let includeBarcodeCheck = false;
  if (!isUnset('BARCODE_TYP')) {
    const v = raw('BARCODE_TYP')!.trim().toUpperCase();
    if (v === 'C128' || v === 'CODE128' || v === 'C128B') {
      barcodeTyp = 'code128';
    } else if (v === 'CODE39') {
      barcodeTyp = 'code39';
    } else if (v === 'C39E' || v === 'CODE39EXT') {
      barcodeTyp = 'code39ext';
    } else if (v === 'C39E+') {
      barcodeTyp = 'code39ext';
      includeBarcodeCheck = true;
    } else if (v === 'C128A') {
      err('BARCODE_TYP', `C128A wird nicht mehr unterstützt — bitte CODE128 verwenden.`);
    } else if (v === 'C39+') {
      err('BARCODE_TYP', `C39+ wird nicht mehr unterstützt — bitte CODE39EXT verwenden.`);
    } else {
      err('BARCODE_TYP', `muss CODE128, CODE39 oder CODE39EXT sein`);
    }
  }

  // ── Infra keys ──

  function integer(key: string): number | undefined {
    if (isUnset(key)) return undefined;
    const v = raw(key)!.trim();
    if (!/^\d+$/.test(v)) {
      err(key, `muss eine ganze Zahl sein`);
      return undefined;
    }
    return Number(v);
  }

  let port = integer('PORT');
  if (port === undefined) port = 8080;
  else if (port < 1 || port > 65535) err('PORT', `muss zwischen 1 und 65535 liegen`);

  let zeitzone = 'Europe/Berlin';
  if (!isUnset('TZ')) {
    const v = raw('TZ')!.trim();
    try {
      new Intl.DateTimeFormat('de-DE', { timeZone: v });
      zeitzone = v;
    } catch {
      err('TZ', `muss eine gültige Zeitzone sein (z. B. Europe/Berlin)`);
    }
  }

  let upstreamUrls = ['https://fa-technik-adfc.de/fein', 'https://codierung.adfc-hessen.de/code/ein'];
  if (!isUnset('UPSTREAM_URLS')) {
    const list = raw('UPSTREAM_URLS')!
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    const valid = list.length > 0 && list.every((u) => {
      try {
        const p = new URL(u);
        return p.protocol === 'http:' || p.protocol === 'https:';
      } catch {
        return false;
      }
    });
    if (valid) {
      upstreamUrls = list;
    } else {
      err('UPSTREAM_URLS', `muss eine Komma-Liste gültiger http(s)-URLs sein`);
    }
  }

  let cacheDbPath = '/data/codierauftrag-cache.sqlite';
  if (!isUnset('CACHE_DB_PATH')) cacheDbPath = raw('CACHE_DB_PATH')!.trim();

  let cacheMaxAgeDays = integer('CACHE_MAX_AGE_DAYS');
  if (cacheMaxAgeDays === undefined) cacheMaxAgeDays = 90;
  else if (cacheMaxAgeDays < 1) err('CACHE_MAX_AGE_DAYS', `muss 1 oder größer sein`);

  let cacheTypoDays = integer('CACHE_TYPO_DAYS');
  if (cacheTypoDays === undefined) cacheTypoDays = 90;
  else if (cacheTypoDays < 1) err('CACHE_TYPO_DAYS', `muss 1 oder größer sein`);

  let cachePurgeMaxAgeDays = integer('CACHE_PURGE_MAX_AGE_DAYS');
  if (cachePurgeMaxAgeDays === undefined) cachePurgeMaxAgeDays = 365;
  else if (cachePurgeMaxAgeDays < 1) err('CACHE_PURGE_MAX_AGE_DAYS', `muss 1 oder größer sein`);

  let cachePurgeIntervalHours = integer('CACHE_PURGE_INTERVAL_HOURS');
  if (cachePurgeIntervalHours === undefined) cachePurgeIntervalHours = 720;
  else if (cachePurgeIntervalHours < 1) err('CACHE_PURGE_INTERVAL_HOURS', `muss 1 oder größer sein`);

  let breakerFailureThreshold = integer('BREAKER_FAILURE_THRESHOLD');
  if (breakerFailureThreshold === undefined) breakerFailureThreshold = 5;
  else if (breakerFailureThreshold < 1) err('BREAKER_FAILURE_THRESHOLD', `muss 1 oder größer sein`);
  let breakerCooldownMs = integer('BREAKER_COOLDOWN_MS');
  if (breakerCooldownMs === undefined) breakerCooldownMs = 60_000;
  else if (breakerCooldownMs < 1) err('BREAKER_COOLDOWN_MS', `muss 1 oder größer sein`);

  // Cache-knob ordering rules — evaluated after both sides parse as integers.
  if (
    errors.every((e) => e.key !== 'CACHE_MAX_AGE_DAYS' && e.key !== 'CACHE_PURGE_MAX_AGE_DAYS') &&
    cachePurgeMaxAgeDays <= cacheMaxAgeDays
  ) {
    err(
      'CACHE_PURGE_MAX_AGE_DAYS',
      `CACHE_PURGE_MAX_AGE_DAYS muss deutlich über CACHE_MAX_AGE_DAYS liegen, sonst entfällt der Ausfalls-Fallback`,
    );
  }
  if (
    errors.every((e) => e.key !== 'CACHE_TYPO_DAYS' && e.key !== 'CACHE_PURGE_MAX_AGE_DAYS') &&
    cacheTypoDays > cachePurgeMaxAgeDays
  ) {
    err('CACHE_TYPO_DAYS', `muss kleiner oder gleich CACHE_PURGE_MAX_AGE_DAYS sein`);
  }

  let rateLimitPerMinute = integer('RATE_LIMIT_PER_MINUTE');
  if (rateLimitPerMinute === undefined) rateLimitPerMinute = 20;

  if (errors.length > 0) {
    errors.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { errors };
  }

  // Apply TZ before returning — the guard runs first in app.ts, before any date use.
  process.env.TZ = zeitzone;

  const config: ParsedConfig = {
    kreisVerband,
    logoText,
    kvWebUrl,
    serverBasisUrl,
    ortInitial,
    datenschutzUrl,
    zeigeAkku,
    zeigeEmail,
    emailAdresse,
    zeigeTelefon,
    telefonNummer,
    zeigePreise,
    preisMitglied: prices['PREIS_MITGLIED'],
    preisNichtMitglied: prices['PREIS_NICHT_MITGLIED'],
    preisAnhaengerMitglied: prices['PREIS_ANHAENGER_MITGLIED'],
    preisAnhaengerNichtMitglied: prices['PREIS_ANHAENGER_NICHT_MITGLIED'],
    aufpreisAkkuMitglied: prices['AUFPREIS_AKKU_MITGLIED'],
    aufpreisAkkuNichtMitglied: prices['AUFPREIS_AKKU_NICHT_MITGLIED'],
    zeigeUmsatzsteuer,
    umsatzsteuerProzent,
    zeigeBarzahlung,
    zeigeKartenzahlung,
    pdfNurEineSeite,
    zeigeCodierungBuchen,
    codierungBuchenUrl,
    zeigeCodierungInfo,
    codierungInfoUrl,
    barcodeTyp,
    includeBarcodeCheck,
    umlauteImBarcode,
    inklusiveJahr,
    port,
    zeitzone,
    upstreamUrls,
    cacheEnabled,
    cacheDbPath,
    cacheMaxAgeDays,
    cacheTypoDays,
    cachePurgeMaxAgeDays,
    cachePurgeIntervalHours,
    breakerFailureThreshold,
    breakerCooldownMs,
    rateLimitPerMinute,
  };

  return { config, warnings };
}

/** Boot output lines for guard errors (German, one per line, sorted by key). */
export function formatConfigErrors(errors: ConfigError[]): string[] {
  return errors.map((e) => `Konfigurationsfehler: ${e.key} — ${e.reason}`);
}

/** Boot output lines for warnings (non-fatal). */
export function formatConfigWarnings(warnings: ConfigWarning[]): string[] {
  return warnings.map((w) => `Warnung: ${w.key} — ${w.reason}`);
}
