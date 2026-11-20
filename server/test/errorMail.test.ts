/**
 * Fehlerbericht-Mail — draft body and mailto: URI (client/src/errorMail.ts).
 * Pure functions, no CONFIG / DOM / clock needed.
 */

import { describe, expect, it } from 'vitest';

import { buildErrorMailBody, buildErrorMailto } from '../../client/src/errorMail.js';
import type { FormValues } from '../../client/src/values.js';

const CTX = { to: 'codierung@beispielstadt.example', version: '1.0.5', url: 'https://example.org/' };

function values(overrides: Partial<FormValues> = {}): FormValues {
  return {
    vorname: 'Erika',
    nachname: 'Mustermann',
    ort: 'Beispielstadt',
    strasse: 'Hauptstraße',
    hausnr: '12a',
    marke: 'Velo',
    modell: 'City 7',
    farbe: 'rot',
    typ: 'Trekkingrad',
    art: 'Damenrad',
    schaltung: 'Kette',
    anzGaenge: '21',
    rahmenNr: 'R-12345',
    nrPos: 'Sattelrohr',
    verkaeufer: 'Zweirad Meier',
    kaufOrt: 'Beispielstadt',
    kaufDatum: '2016-06-15',
    mitglied: true,
    ebike: false,
    carbonRahmen: false,
    akku: true,
    beleg: true,
    ...overrides,
  };
}

describe('buildErrorMailBody — content', () => {
  it('lists the text fields and toggles with their German labels', () => {
    const body = buildErrorMailBody(values(), CTX);
    expect(body).toContain('Ort: Beispielstadt');
    expect(body).toContain('Straße: Hauptstraße');
    expect(body).toContain('Marke: Velo');
    expect(body).toContain('Modell: City 7');
    expect(body).toContain('Farbe: rot');
    expect(body).toContain('Radtyp (bzw. Anhänger): Trekkingrad');
    expect(body).toContain('Radart: Damenrad');
    expect(body).toContain('Schaltung: Kette');
    expect(body).toContain('Anzahl Gänge: 21');
    expect(body).toContain('Rahmennummer: R-12345');
    expect(body).toContain('Position Rahmennummer: Sattelrohr');
    expect(body).toContain('Verkäufer: Zweirad Meier');
    expect(body).toContain('Kaufort: Beispielstadt');
    expect(body).toContain('ADFC-Mitglied: ja');
    expect(body).toContain('Pedelec/E-Bike: nein');
    expect(body).toContain('Carbon-Rahmen: nein');
    expect(body).toContain('Akku codieren: ja');
    expect(body).toContain('Kaufbeleg vorhanden: ja');
  });

  it('never carries Vorname, Nachname or Hausnummer', () => {
    const body = buildErrorMailBody(values(), CTX);
    expect(body).not.toContain('Erika');
    expect(body).not.toContain('Mustermann');
    expect(body).not.toContain('12a');
    // no field rows for the three excluded fields (the header line names them)
    expect(body).not.toContain('Vorname:');
    expect(body).not.toContain('Nachname:');
    expect(body).not.toContain('Hausnummer:');
  });

  it('prints the Kaufdatum as TT.MM.JJJJ', () => {
    expect(buildErrorMailBody(values(), CTX)).toContain('Kaufdatum: 15.06.2016');
  });

  it('marks empty text fields as (leer)', () => {
    const body = buildErrorMailBody(values({ marke: '', modell: '   ' }), CTX);
    expect(body).toContain('Marke: (leer)');
    expect(body).toContain('Modell: (leer)');
  });

  it('carries version and page URL', () => {
    const body = buildErrorMailBody(values(), CTX);
    expect(body).toContain('Version: 1.0.5');
    expect(body).toContain('URL: https://example.org/');
  });

  it('uses CRLF line breaks', () => {
    const body = buildErrorMailBody(values(), CTX);
    expect(body).toContain('\r\n');
    expect(body.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('buildErrorMailto — URI', () => {
  it('addresses the recipient and encodes subject and body', () => {
    const href = buildErrorMailto(values(), CTX);
    expect(href.startsWith('mailto:codierung@beispielstadt.example?')).toBe(true);
    expect(href).toContain('subject=Fehlerbericht%20Codierauftrag%20V1.0.5');
    expect(href).toContain('body=');
    // no raw spaces or line breaks in the URI
    expect(href).not.toContain(' ');
    expect(href).not.toContain('\n');
  });

  it('round-trips the body through the URI', () => {
    const href = buildErrorMailto(values(), CTX);
    const body = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('body');
    expect(body).toBe(buildErrorMailBody(values(), CTX));
  });
});
