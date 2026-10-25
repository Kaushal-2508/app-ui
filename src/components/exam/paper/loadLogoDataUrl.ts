import { loadImageAsDataUrl } from "@/lib/pdf/studentReport";

const cache = new Map<string, string | null>();

/**
 * Fetches a logo URL once and caches the resulting data: URL for the lifetime
 * of the tab. Used by the print/HTML builders so the logo is embedded into the
 * exported document and survives `window.open` + `html2pdf` invocations
 * without re-issuing a network request.
 *
 * Returns null on any failure or when `url` is null/empty.
 */
export async function loadLogoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;
  const dataUrl = await loadImageAsDataUrl(url);
  cache.set(url, dataUrl);
  return dataUrl;
}
