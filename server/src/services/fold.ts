/**
 * Shared key normalization for cache lookups:
 * trim → collapse runs of whitespace to single spaces → casefold → ß→ss
 */
export function fold(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss');
}
