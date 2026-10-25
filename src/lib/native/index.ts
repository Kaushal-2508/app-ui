/**
 * The native adapter layer. Web behaviour by default; inside the Capacitor
 * shell (a separate project, see docs/mobile/README.md) each module talks to
 * the shell's plugins through the injected bridge. No `@capacitor/*` import
 * and no `window.Capacitor` read may exist outside this directory.
 */
export { isNativePlatform, nativePlatform, type NativePlatform } from "./platform";
export { saveBlob, saveDataUrl, saveText } from "./download";
export { preparePrint, printHtml, type PendingPrint, type PrintOptions } from "./print";
export { openExternal } from "./openExternal";
export { onAppStateChange, type AppStateListener } from "./appState";
export { useIsOnline } from "./network";
export {
  hideSplash,
  applyStatusBarTheme,
  onAndroidBack,
  ensureViewportFitCover,
  markNativeShell,
} from "./shell";
export {
  isPushSupported,
  getPushPermission,
  registerForPush,
  unregisterFromPush,
  onPushEvents,
  pushTargetUrl,
  type PushPermission,
  type PushMessage,
  type PushRegistration,
  type PushEventHandlers,
} from "./push";
