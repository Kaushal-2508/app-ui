/**
 * Decorative on-demand chunks: code that downloads in the background, unasked, for a
 * purely decorative feature. Today that is only the 3D dashboard banner's engine
 * (`banner3d/engine/bannerEngine.ts`, three.js plus the scene).
 *
 * main.tsx answers every `vite:preloadError` by reloading the page, which is right for a
 * stale PAGE chunk after a deploy. For a decorative chunk it is wrong: the user never
 * asked for it, and the feature already has a fallback (the banner keeps its SVG). So
 * main.tsx asks `isDecorativeLoadError()` first and lets such an import fail normally.
 */

// Chrome and Firefox name the file in the import error; the chunk's name comes from the
// module's file name, so keep this in step with bannerEngine.ts.
const DECORATIVE_FILE = /\/bannerEngine\.[\w-]+\.js/;
const NAMES_A_FILE = /:\/\/|\/assets\//;

let pending = 0;

/** Run a decorative `import()`. While it is in flight, a nameless import error counts as its. */
export async function importDecorative<T>(load: () => Promise<T>): Promise<T> {
  pending++;
  try {
    return await load();
  } finally {
    pending--;
  }
}

/**
 * True when a `vite:preloadError` payload belongs to a decorative chunk. WebKit names no
 * file ("Importing a module script failed."), so there an error counts as decorative only
 * while a decorative import is in flight. The cost of a wrong guess is small: a page chunk
 * failing in that same moment shows the ErrorBoundary's Reload button instead of reloading.
 */
export function isDecorativeLoadError(payload: unknown): boolean {
  const text = payload instanceof Error ? payload.message : String(payload ?? "");
  if (NAMES_A_FILE.test(text)) return DECORATIVE_FILE.test(text);
  return pending > 0;
}
