/**
 * Link-preview metadata: server-side placeholder rendering for index.html.
 *
 * Messenger link previews (WhatsApp, Telegram, Discord, iMessage, social
 * networks) fetch the page without executing JavaScript, so the Open-Graph
 * tags must be part of the initial HTML response. The built index.html
 * contains {{PLACEHOLDER}} tokens; they are substituted per instance from
 * the frozen boot config (KREIS_VERBAND, SERVER_BASIS_URL) — no new env keys.
 */

import type { ParsedConfig } from './config/parseConfig.js';

export interface IndexPageRenderer {
  /** index.html with all placeholders replaced for the given base URL.
   *  Memoized only for the configured SERVER_BASIS_URL; a derived base URL
   *  is rendered fresh per call (unbounded key space — see app.ts wiring). */
  render(baseUrl: string): string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function createIndexPageRenderer(
  config: ParsedConfig,
  indexHtml: string,
): IndexPageRenderer {
  // Memoize only the configured base URL (single key). When SERVER_BASIS_URL
  // is empty, the key derives from a client-supplied Host header — unbounded
  // key space, so render fresh per request instead.
  const configured = config.serverBasisUrl !== '' ? new Map<string, string>() : null;

  const kv = config.kreisVerband;
  const title = `Fahrradcodierung - ADFC ${kv}`;
  const siteName = `ADFC ${kv}`;
  const description =
    `Codierauftrag für die Fahrradcodierung des ADFC ${kv}: ` +
    'Eigentümer- und Fahrraddaten eingeben, persönliche Codier-Nummer (EIN) ' +
    'erhalten und den Auftrag als PDF ausdrucken. Alle Daten bleiben im Browser.';

  function renderFor(baseUrl: string): string {
    // Callback replacements: a function is never scanned for `$` patterns —
    // a Host-derived baseUrl could contain `$&`, which would inject the token.
    return indexHtml
      .replaceAll('{{TITLE}}', () => escapeHtml(title))
      .replaceAll('{{SITE_NAME}}', () => escapeHtml(siteName))
      .replaceAll('{{OG_TITLE}}', () => escapeHtml(title))
      .replaceAll('{{DESCRIPTION}}', () => escapeHtml(description))
      .replaceAll('{{OG_URL}}', () => escapeHtml(`${baseUrl}/`))
      .replaceAll('{{OG_IMAGE}}', () => escapeHtml(`${baseUrl}/img/og-preview.png`));
  }

  return {
    render(baseUrl: string): string {
      if (configured === null) {
        return renderFor(baseUrl);
      }
      let html = configured.get(baseUrl);
      if (html === undefined) {
        html = renderFor(baseUrl);
        configured.set(baseUrl, html);
      }
      return html;
    },
  };
}
