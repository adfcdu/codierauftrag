/**
 * Boot-rendered HTML error page. Rendered ONCE at startup from the
 * validated config — a running server implies valid config.
 */

import type { ParsedConfig } from './config/parseConfig.js';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderErrorPage(config: ParsedConfig): string {
  const contactLines: string[] = [];
  // href wird aus dem validierten Anzeigewert gebaut (optional mailto:/tel:-Präfix
  // wurde beim Parsen entfernt) — das Schema ist hier fest, nie env-gesteuert.
  if (config.zeigeEmail && config.emailAdresse !== '') {
    const addr = escapeHtml(config.emailAdresse);
    contactLines.push(`E-Mail: <a href="mailto:${addr}">${addr}</a>`);
  }
  if (config.zeigeTelefon && config.telefonNummer !== '') {
    const nr = escapeHtml(config.telefonNummer);
    const href = escapeHtml(config.telefonNummer.replace(/\s+/g, ''));
    contactLines.push(`Telefon: <a href="tel:${href}">${nr}</a>`);
  }

  const contactHtml = contactLines.map((l) => `    <span>${l}</span>\n`).join('');

  return `<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/x-icon" href="img/favicon.ico">
    <link rel="stylesheet" href="css/coding.css">
    <title>Codierformular - Fehler</title>
  </head>
  <body><div>
    <h2>Es ist ein interner Fehler aufgetreten</h2>
    <p>Bitte versuchen Sie es später erneut.</p>
    <hr class="header-divider">
    <div class="page-footer">
${contactHtml}    <a href="impressum_datenschutz.html">Impressum und Datenschutz</a>
    </div>
  </div></body>
</html>
`;
}
