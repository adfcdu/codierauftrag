/**
 * Feld-Abhängigkeiten im Abschnitt „Fahrrad/Anhänger“ (client/src/values.ts
 * → fieldAvailability): bei Radtyp „Anhänger“ sind Carbon-Rahmen,
 * Pedelec/E-Bike und Akku codieren nicht nutzbar, Radart, Schaltung und
 * Anzahl Gänge werden gesperrt und geleert; „Akku codieren“ setzt zusätzlich
 * ein Pedelec/E-Bike voraus. Reine Funktion, kein CONFIG/DOM.
 */

import { describe, expect, it } from 'vitest';

import { fieldAvailability } from '../../client/src/values.js';

const bike = {
  carbonRahmen: true,
  ebike: true,
  akku: false,
  art: true,
  schaltung: true,
  anzGaenge: true,
};

const trailer = {
  carbonRahmen: false,
  ebike: false,
  akku: false,
  art: false,
  schaltung: false,
  anzGaenge: false,
};

describe('fieldAvailability', () => {
  it('enables every field for a bike without E-Bike', () => {
    expect(fieldAvailability('Trekkingrad', false)).toEqual(bike);
  });

  it('enables the Akku toggle once a Pedelec/E-Bike is set', () => {
    expect(fieldAvailability('Trekkingrad', true)).toEqual({ ...bike, akku: true });
  });

  it('disables and empties all bike-only fields for a trailer', () => {
    expect(fieldAvailability('Anhänger', false)).toEqual(trailer);
    // a stale E-Bike checkmark must not re-enable the Akku toggle
    expect(fieldAvailability('Anhänger', true)).toEqual(trailer);
  });

  it('matches the trailer spelling tolerantly (case, surrounding blanks)', () => {
    expect(fieldAvailability('  anhänger ', false)).toEqual(trailer);
    expect(fieldAvailability('ANHÄNGER', false)).toEqual(trailer);
  });

  it('keeps the fields usable for an empty or unknown Radtyp', () => {
    expect(fieldAvailability('', false)).toEqual(bike);
    expect(fieldAvailability('Lastenrad', false)).toEqual(bike);
  });
});
