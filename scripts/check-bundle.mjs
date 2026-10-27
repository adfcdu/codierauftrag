#!/usr/bin/env node
/**
 * Bundle check (07 § PDF / 00 § performance budgets): the initial client bundle
 * must contain no jsPDF/bwip-js bytes — the whole PDF stack lives in the lazy
 * pdf/ chunk that is only imported on "PDF erzeugen". Run after `vite build`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../client/dist', import.meta.url).pathname;

const assets = readdirSync(join(dist, 'assets'));
const jsChunks = assets.filter((f) => f.endsWith('.js'));
if (jsChunks.length === 0) {
  console.error('bundle check: no built assets found — run `npm run build` first');
  process.exit(1);
}

// the pdf chunk (jsPDF + bwip-js) and its own sub-chunks (html2canvas, dompurify —
// jsPDF canvas helpers) form the lazy stack; every other chunk is initial
const pdfStack = /bwipp|jspdf|html2canvas|purify/i;
const markers = ['bwipp', 'bwip-js', 'jsPDF', 'jspdf'];
const initial = [];
const lazy = [];
for (const chunk of jsChunks) {
  const content = readFileSync(join(dist, 'assets', chunk), 'utf8');
  if (pdfStack.test(content) || pdfStack.test(chunk)) {
    lazy.push(chunk);
    continue;
  }
  initial.push(chunk);
  for (const marker of markers) {
    if (content.includes(marker)) {
      console.error(`bundle check FAILED: initial chunk ${chunk} contains "${marker}"`);
      process.exit(1);
    }
  }
}

if (lazy.length === 0) {
  console.error('bundle check FAILED: no lazy pdf/ chunk found — the dynamic import is missing');
  process.exit(1);
}

console.log(
  `bundle check OK: ${initial.length} initial chunk(s) without jsPDF/bwip-js bytes; ` +
    `lazy pdf chunk: ${lazy.join(', ')}`,
);
