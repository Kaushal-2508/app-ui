/**
 * Cross-browser fullscreen helpers.
 *
 * Why this exists: iPhone Safari does not implement the Fullscreen API on
 * arbitrary elements (only on `<video>`), and on those iOS builds
 * `el.requestFullscreen` is `undefined` — calling it raises
 * "requestFullscreen is not a function" synchronously, before any `.catch()`
 * can intercept it. macOS Safari implements the API but only under the
 * `webkit` vendor prefix.
 *
 * These helpers feature-detect both spellings and resolve to a no-op when
 * neither is available, so call-sites can `await requestFullscreen(el)`
 * without guarding for platform.
 */

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

/**
 * Whether we're on an Apple device (iPhone/iPad/iPod or a Mac). Exam fullscreen
 * enforcement is disabled on these: iPhone Safari has no element Fullscreen API
 * at all, and iPadOS/macOS Safari's webkit implementation is unreliable enough
 * that the fullscreen gate blocked students from starting exams. Note iPadOS
 * 13+ reports platform "MacIntel", so the Mac check intentionally covers iPads.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    /Macintosh|Mac OS X/.test(ua) ||
    navigator.platform === "MacIntel"
  );
}

/** Whether the platform supports requesting fullscreen on arbitrary elements. */
export function isFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const proto = HTMLElement.prototype as unknown as FullscreenElement;
  return Boolean(
    proto.requestFullscreen || proto.webkitRequestFullscreen || proto.msRequestFullscreen,
  );
}

/** Currently fullscreen element, or null. Reads webkit/ms variants too. */
export function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FullscreenDocument;
  return d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement || null;
}

/**
 * Request fullscreen on an element. Resolves silently when the API is
 * unavailable (e.g. iPhone Safari) so callers can `await` without crashing.
 * Rejects only when the user/browser denies a supported request.
 */
export function requestFullscreen(el: HTMLElement | null | undefined): Promise<void> {
  if (!el) return Promise.resolve();
  const target = el as FullscreenElement;
  const fn =
    target.requestFullscreen ||
    target.webkitRequestFullscreen ||
    target.msRequestFullscreen;
  if (!fn) return Promise.resolve();
  try {
    const result = fn.call(target);
    return result instanceof Promise ? result : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

/** Exit fullscreen. Resolves silently when not in fullscreen or unsupported. */
export function exitFullscreen(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (!getFullscreenElement()) return Promise.resolve();
  const d = document as FullscreenDocument;
  const fn = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
  if (!fn) return Promise.resolve();
  try {
    const result = fn.call(d);
    return result instanceof Promise ? result : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * Subscribe to fullscreen state changes. Returns an unsubscribe function.
 * Listens to all vendor variants so a single handler fires on Safari too.
 */
export function onFullscreenChange(handler: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const events = ["fullscreenchange", "webkitfullscreenchange", "MSFullscreenChange"];
  events.forEach((e) => document.addEventListener(e, handler));
  return () => {
    events.forEach((e) => document.removeEventListener(e, handler));
  };
}
