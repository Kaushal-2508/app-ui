/**
 * Normalizes problematic Unicode characters that come from Word, PDFs,
 * Google Docs, Excel, or AI-generated text.
 */
export function normalizeText(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")       // Smart single quotes → '
    .replace(/[\u201C\u201D]/g, '"')                     // Smart double quotes → "
    .replace(/[\u2013\u2014]/g, '-')                     // En/em dash → -
    .replace(/\u00A0/g, ' ')                              // Non-breaking space
    .replace(/[\u200B\uFEFF\u200C\u200D]/g, '')          // Zero-width chars
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // Control chars
    .replace(/\uFFFD/g, '"');                                  // Replacement char → double quote
}
