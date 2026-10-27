/**
 * GET /api/config — the validated instance subset as typed JSON,
 * built ONCE at boot: a frozen string, identical bytes per request.
 */

import type { ParsedConfig } from '../config/parseConfig.js';

export interface PublicConfig {
  kreisVerband: string;
  logoText: string;
  kvWebUrl: string;
  ortInitial: string;
  datenschutzUrl: string;
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
  umsatzsteuerProzent: number;
  zeigeBarzahlung: boolean;
  zeigeKartenzahlung: boolean;
  pdfNurEineSeite: boolean;
  zeigeCodierungBuchen: boolean;
  codierungBuchenUrl: string;
  zeigeCodierungInfo: boolean;
  codierungInfoUrl: string;
  barcodeTyp: 'code128' | 'code39' | 'code39ext';
  includeBarcodeCheck: boolean;
  umlauteImBarcode: boolean;
  inklusiveJahr: boolean;
  zeitzone: string;
  version: string;
}

export function buildPublicConfig(config: ParsedConfig, version: string): PublicConfig {
  return {
    kreisVerband: config.kreisVerband,
    logoText: config.logoText,
    kvWebUrl: config.kvWebUrl,
    ortInitial: config.ortInitial,
    datenschutzUrl: config.datenschutzUrl,
    zeigeAkku: config.zeigeAkku,
    zeigeEmail: config.zeigeEmail,
    emailAdresse: config.emailAdresse,
    zeigeTelefon: config.zeigeTelefon,
    telefonNummer: config.telefonNummer,
    zeigePreise: config.zeigePreise,
    preisMitglied: config.preisMitglied,
    preisNichtMitglied: config.preisNichtMitglied,
    preisAnhaengerMitglied: config.preisAnhaengerMitglied,
    preisAnhaengerNichtMitglied: config.preisAnhaengerNichtMitglied,
    aufpreisAkkuMitglied: config.aufpreisAkkuMitglied,
    aufpreisAkkuNichtMitglied: config.aufpreisAkkuNichtMitglied,
    zeigeUmsatzsteuer: config.zeigeUmsatzsteuer,
    umsatzsteuerProzent: config.umsatzsteuerProzent,
    zeigeBarzahlung: config.zeigeBarzahlung,
    zeigeKartenzahlung: config.zeigeKartenzahlung,
    pdfNurEineSeite: config.pdfNurEineSeite,
    zeigeCodierungBuchen: config.zeigeCodierungBuchen,
    codierungBuchenUrl: config.codierungBuchenUrl,
    zeigeCodierungInfo: config.zeigeCodierungInfo,
    codierungInfoUrl: config.codierungInfoUrl,
    barcodeTyp: config.barcodeTyp,
    includeBarcodeCheck: config.includeBarcodeCheck,
    umlauteImBarcode: config.umlauteImBarcode,
    inklusiveJahr: config.inklusiveJahr,
    zeitzone: config.zeitzone,
    version,
  };
}
