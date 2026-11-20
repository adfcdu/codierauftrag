/**
 * Typed subset of GET /api/config.
 * CONFIG is fetched once in main.ts and frozen for the session.
 */

export interface AppConfig {
  kreisVerband: string;
  logoText: string;
  kvWebUrl: string;
  ortInitial: string;
  datenschutzUrl: string;
  zeigeAkku: boolean;
  zeigeCarbonRahmen: boolean;
  zeigeEmail: boolean;
  emailAdresse: string;
  /** false = „Fehler per E-Mail melden“ hidden (default true) */
  zeigeFehlerEmail: boolean;
  /** recipient of „Fehler per E-Mail melden“; server default: project address */
  fehlerEmailAdresse: string;
  zeigeTelefon: boolean;
  telefonNummer: string;
  zeigePreise: boolean;
  preisMitglied: number;
  preisNichtMitglied: number;
  preisAnhaengerMitglied: number;
  preisAnhaengerNichtMitglied: number;
  aufpreisAkkuMitglied: number;
  aufpreisAkkuNichtMitglied: number;
  /** Sicherheitsetiketten included in the sticker base price (default 2). */
  etikettenAnzahl: number;
  zeigeUmsatzsteuer: boolean;
  umsatzsteuerProzent: number;
  zeigeBarzahlung: boolean;
  zeigeKartenzahlung: boolean;
  zeigeEigentumsnachweis: boolean;
  pdfNurEineSeite: boolean;
  zeigeCodierungBuchen: boolean;
  codierungBuchenUrl: string;
  zeigeCodierungInfo: boolean;
  codierungInfoUrl: string;
  banner1Text: string;
  banner2Text: string;
  banner3Text: string;
  banner1Url: string;
  banner2Url: string;
  banner3Url: string;
  barcodeTyp: 'code128' | 'code39' | 'code39ext';
  includeBarcodeCheck: boolean;
  umlauteImBarcode: boolean;
  inklusiveJahr: boolean;
  zeitzone: string;
  version: string;
}

/** Set once by main.ts before the form is wired. */
export let CONFIG: AppConfig = null as unknown as AppConfig;

export function setConfig(config: AppConfig): void {
  CONFIG = config;
}
