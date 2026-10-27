/**
 * Barcode rendering via bwip-js (frozen options).
 * Named encoder imports only (tree-shaking); renders to an offscreen canvas.
 * QR-capacity guard: ECC M → retry once at ECC L → caller renders the page
 * without QR image and QR note.
 */

import { code128, code39, code39ext, qrcode } from '@bwip-js/browser';
import type { AppConfig } from '../configTypes.js';

/** Minimal canvas surface bwip-js needs (DOM canvas in the app, node canvas in tests). */
export interface BarcodeCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2D;
  toDataURL(type: string): string;
}

export interface BarcodeDeps {
  createCanvas?: () => BarcodeCanvas;
}

const ENCODERS: Record<AppConfig['barcodeTyp'], (canvas: never, opts: unknown) => void> = {
  code128: code128 as unknown as (canvas: never, opts: unknown) => void,
  code39: code39 as unknown as (canvas: never, opts: unknown) => void,
  code39ext: code39ext as unknown as (canvas: never, opts: unknown) => void,
};

function makeCanvas(deps?: BarcodeDeps): BarcodeCanvas {
  if (deps?.createCanvas) return deps.createCanvas();
  return document.createElement('canvas') as unknown as BarcodeCanvas;
}

/**
 * The frozen 1D render options — bars only, NO label: bwip-js's text engine
 * offers its built-in OCR fonts or a TTF registered via `loadFont`, but the
 * label must use jsPDF's helvetica — a base-14 PDF font with no font file —
 * so pdf.ts draws the label itself.
 */
export function build1DOptions(config: AppConfig, barcodeContent: string): Record<string, unknown> {
  return {
    text: barcodeContent,
    height: 15,
    width: 65,
    scale: 4,
    ...(config.includeBarcodeCheck ? { includecheck: true } : {}), // C39E+ check character
  };
}

/** 1D barcode: frozen render options. */
export function render1DBarcode(
  config: AppConfig,
  barcodeContent: string,
  deps?: BarcodeDeps,
): string {
  const canvas = makeCanvas(deps);
  ENCODERS[config.barcodeTyp](canvas as never, build1DOptions(config, barcodeContent));
  return canvas.toDataURL('image/png');
}

export interface QrRenderResult {
  dataUrl: string;
  eclevel: 'M' | 'L';
}

/**
 * QR code: ECC M first; on bwip-js' capacity error one retry at ECC L; null
 * when the payload exceeds the format entirely.
 * Quiet zone = 4 modules via padding* (NOT border*).
 *//**
 * QR options — quiet zone 4 modules via padding* (NOT border*):
 * the bwip-js padding unit is scale px while a QR module is 2·scale px
 * → 8 units = 4 modules.
 */
export function buildQrOptions(url: string, eclevel: 'M' | 'L'): Record<string, unknown> {
  // eclevel is a qrcode-encoder option the bwip-js types don't declare (passes through)
  return {
    text: url,
    eclevel,
    paddingleft: 8,
    paddingright: 8,
    paddingtop: 8,
    paddingbottom: 8,
    scale: 4,
  };
}

export function renderQrCode(url: string, deps?: BarcodeDeps): QrRenderResult | null {
  for (const eclevel of ['M', 'L'] as const) {
    try {
      const canvas = makeCanvas(deps);
      qrcode(canvas as never, buildQrOptions(url, eclevel) as unknown as Parameters<typeof qrcode>[1]);
      return { dataUrl: canvas.toDataURL('image/png'), eclevel };
    } catch {
      // capacity error → try the next level
    }
  }
  return null;
}
