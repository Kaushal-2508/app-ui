import { nativePlugin, removeListener, type ListenerHandleLike } from "./platform";

/**
 * "Did the user leave this screen?" as one event, for the exam-integrity
 * listeners (tab switch, window blur) and anything else that cares.
 *
 * Web: `visibilitychange` plus `blur`/`focus`, exactly what the exam pages
 * subscribed to before. Native: the `App` plugin's `appStateChange`, because
 * in a WebView `blur` fires for the notification shade and a phone call,
 * which are not cheating; only the app going to the background counts.
 *
 * Returns the unsubscribe function; every subscribing effect must call it.
 */
export type AppStateListener = (active: boolean, source: "visibility" | "focus" | "native") => void;

type AppPlugin = {
  addListener(event: "appStateChange", cb: (s: { isActive: boolean }) => void): ListenerHandleLike;
};

export function onAppStateChange(listener: AppStateListener): () => void {
  if (typeof document === "undefined") return () => {};

  const app = nativePlugin<AppPlugin>("App");
  if (app) {
    const handle = app.addListener("appStateChange", ({ isActive }) => listener(isActive, "native"));
    return () => removeListener(handle);
  }

  const onVisibility = () => listener(document.visibilityState === "visible", "visibility");
  const onBlur = () => listener(false, "focus");
  const onFocus = () => listener(true, "focus");

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
  };
}
