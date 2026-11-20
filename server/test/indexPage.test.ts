/**
 * Unit tests for the index.html placeholder renderer (server-side OG tags).
 * The renderer only reads kreisVerband + serverBasisUrl — tests cast a partial
 * object to ParsedConfig.
 */

import { describe, expect, it } from 'vitest';
import { createIndexPageRenderer } from '../src/indexPage.js';
import type { ParsedConfig } from '../src/config/parseConfig.js';

function partialConfig(overrides: Partial<Pick<ParsedConfig, 'kreisVerband' | 'serverBasisUrl'>>): ParsedConfig {
  return { kreisVerband: 'KV Beispielstadt', serverBasisUrl: '', ...overrides } as unknown as ParsedConfig;
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title>{{TITLE}}</title>
    <meta name="description" content="{{DESCRIPTION}}">
    <meta property="og:site_name" content="{{SITE_NAME}}">
    <meta property="og:url" content="{{OG_URL}}">
    <meta property="og:title" content="{{OG_TITLE}}">
    <meta property="og:image" content="{{OG_IMAGE}}">
  </head>
  <body></body>
</html>
`;

describe('indexPage renderer', () => {
  it('replaces every placeholder — result contains no {{', () => {
    const renderer = createIndexPageRenderer(partialConfig({}), TEMPLATE);
    const html = renderer.render('https://codierformular.invalid');
    expect(html).not.toContain('{{');
  });

  it('exact strings for KV Duisburg (ASCII hyphen in the title)', () => {
    const renderer = createIndexPageRenderer(partialConfig({ kreisVerband: 'KV Duisburg' }), TEMPLATE);
    const html = renderer.render('https://codierformular.invalid');
    expect(html).toContain('<title>Fahrradcodierung - ADFC KV Duisburg</title>');
    expect(html).toContain('content="Fahrradcodierung - ADFC KV Duisburg"'); // og:title + twitter:title
    expect(html).toContain('content="ADFC KV Duisburg"'); // og:site_name
    expect(html).toContain(
      'Codierauftrag für die Fahrradcodierung des ADFC KV Duisburg: ' +
        'Eigentümer- und Fahrraddaten eingeben, persönliche Codier-Nummer (EIN) ' +
        'erhalten und den Auftrag als PDF ausdrucken. Alle Daten bleiben im Browser.',
    );
  });

  it('og:title equals the <title> element', () => {
    const renderer = createIndexPageRenderer(partialConfig({}), TEMPLATE);
    const html = renderer.render('https://codierformular.invalid');
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    expect(title).toBe('Fahrradcodierung - ADFC KV Beispielstadt');
    expect(html).toContain(`og:title" content="${title}"`);
  });

  it('og:url gets the trailing slash, og:image none beyond the img path', () => {
    const renderer = createIndexPageRenderer(partialConfig({}), TEMPLATE);
    const html = renderer.render('https://codierformular.invalid');
    expect(html).toContain('og:url" content="https://codierformular.invalid/"');
    expect(html).toContain('og:image" content="https://codierformular.invalid/img/og-preview.png"');
  });

  it('escapes &, ", < and > in config values', () => {
    const renderer = createIndexPageRenderer(
      partialConfig({ kreisVerband: 'KV A&B <X>"Y"' }),
      TEMPLATE,
    );
    const html = renderer.render('https://codierformular.invalid');
    expect(html).toContain('<title>Fahrradcodierung - ADFC KV A&amp;B &lt;X&gt;&quot;Y&quot;</title>');
    expect(html).not.toContain('KV A&B');
  });

  it('does not treat $ patterns in a derived base URL as replacement patterns', () => {
    const renderer = createIndexPageRenderer(partialConfig({}), TEMPLATE);
    const html = renderer.render('https://example.invalid/x$&y');
    expect(html).toContain('og:url" content="https://example.invalid/x$&amp;y/"');
    expect(html).not.toContain('{{OG_URL}}');
  });

  it('repeat renders with the configured base URL are stable', () => {
    const renderer = createIndexPageRenderer(
      partialConfig({ serverBasisUrl: 'https://codierformular.invalid' }),
      TEMPLATE,
    );
    const first = renderer.render('https://codierformular.invalid');
    const second = renderer.render('https://codierformular.invalid');
    // String identity is not observable in JS (toBe compares by value); the
    // memoization itself is enforced by the renderer's per-URL Map.
    expect(second).toBe(first);
  });

  it('renders fresh per call when SERVER_BASIS_URL is empty — each host gets its own URLs', () => {
    const renderer = createIndexPageRenderer(partialConfig({ serverBasisUrl: '' }), TEMPLATE);
    const a = renderer.render('https://a.invalid');
    const b = renderer.render('https://b.invalid');
    expect(a).toContain('og:url" content="https://a.invalid/"');
    expect(b).toContain('og:url" content="https://b.invalid/"');
    expect(a).not.toContain('b.invalid');
    expect(b).not.toContain('a.invalid');
  });
});
