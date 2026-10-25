/**
 * Loads the web fonts without blocking first paint.
 *
 * The stylesheet used to `@import` these from Google Fonts on its first lines,
 * which made the browser hold back EVERY rule until that request answered: on
 * a phone connection, and inside the native shell, the app sat unstyled for
 * seconds. Now the page renders in the system font at once and the link is
 * added after the first frame; `font-display: swap` in the Google CSS swaps
 * the faces in when they arrive. Offline, the system font simply stays.
 */
const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700" +
  "&family=Noto+Sans+Devanagari:wght@400;500;600;700" +
  "&family=Noto+Sans+Gurmukhi:wght@400;500;600;700&display=swap";

export function loadWebFonts(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[data-salci-fonts="true"]')) return;

  const add = () => {
    for (const href of ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]) {
      const pre = document.createElement("link");
      pre.rel = "preconnect";
      pre.href = href;
      pre.crossOrigin = "anonymous";
      document.head.appendChild(pre);
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_CSS;
    link.dataset.salciFonts = "true";
    // media=print keeps the fetch off the render path; it becomes active on load.
    link.media = "print";
    link.onload = () => {
      link.media = "all";
    };
    document.head.appendChild(link);
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.setTimeout(add, 0));
  } else {
    add();
  }
}
