/**
 * Platform probe and plugin access for the native (Capacitor) shell.
 *
 * The shell project lives OUTSIDE this repo (docs/mobile/README.md), so no
 * `@capacitor/*` package is bundled here. The native side injects a bridge
 * object (`window.Capacitor`) into its WebView with two low-level calls:
 *
 *   nativePromise(pluginName, methodName, options)            -> Promise
 *   nativeCallback(pluginName, methodName, options, callback) -> callbackId
 *
 * Capacitor's own JS runtime builds every plugin proxy on exactly these two
 * (`@capacitor/core/dist/index.js`, createPluginMethodWrapper). `nativePlugin`
 * does the same in a dozen lines, so plugins installed in the shell are usable
 * without an import. Each adapter declares the slice of the plugin API it
 * needs as a structural type.
 *
 * Rule: nothing outside `src/lib/native/` reads `window.Capacitor`.
 */

type BridgeOptions = Record<string, unknown> | null | undefined;

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  nativePromise?: (plugin: string, method: string, options?: BridgeOptions) => Promise<unknown>;
  nativeCallback?: (
    plugin: string,
    method: string,
    options: BridgeOptions,
    callback: (data: unknown) => void,
  ) => string;
  /** Injected by the native side: the plugins compiled into this build. */
  PluginHeaders?: Array<{ name: string }>;
};

function bridge(): CapacitorBridge | null {
  if (typeof window === "undefined") return null;
  const c = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor;
  return c ?? null;
}

/** True inside the Android or iOS app; false in every browser, PWA included. */
export function isNativePlatform(): boolean {
  return bridge()?.isNativePlatform?.() ?? false;
}

export type NativePlatform = "ios" | "android";

/** Which app, or null on the web. */
export function nativePlatform(): NativePlatform | null {
  if (!isNativePlatform()) return null;
  const p = bridge()?.getPlatform?.();
  return p === "ios" || p === "android" ? p : null;
}

/** Capacitor listener handles resolve asynchronously; this normalises removal. */
export type ListenerHandle = { remove: () => Promise<void> | void };
export type ListenerHandleLike = ListenerHandle | Promise<ListenerHandle>;

export function removeListener(handle: ListenerHandleLike | null | undefined): void {
  if (!handle) return;
  void Promise.resolve(handle).then((h) => h?.remove?.()).catch(() => {});
}

const pluginCache = new Map<string, unknown>();

function pluginCompiledIn(cap: CapacitorBridge, name: string): boolean {
  // Without the header list (older bridge) assume yes; a missing plugin then
  // rejects its first call, which every adapter already treats as "web path".
  return cap.PluginHeaders ? cap.PluginHeaders.some((h) => h.name === name) : true;
}

/**
 * A plugin installed in the shell, typed by the caller to the methods it
 * needs, or null on the web / when the shell lacks that plugin. Callers must
 * treat null as "fall back to the web behaviour", never as an error.
 *
 * Any method name becomes `nativePromise(name, method, options)`;
 * `addListener(event, cb)` becomes the callback flow and returns a handle
 * whose `remove()` unregisters it, the same shape the official runtime gives.
 */
export function nativePlugin<T>(name: string): T | null {
  const cap = bridge();
  if (!cap || !cap.isNativePlatform?.() || !cap.nativePromise || !cap.nativeCallback) return null;
  if (!pluginCompiledIn(cap, name)) return null;
  if (pluginCache.has(name)) return pluginCache.get(name) as T;

  const call = cap.nativePromise;
  const callback = cap.nativeCallback;
  const proxy = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") return undefined; // never mistaken for a thenable
      if (prop === "addListener") {
        return (eventName: string, listener: (data: unknown) => void): ListenerHandle => {
          const callbackId = callback(name, "addListener", { eventName }, listener);
          return {
            remove: () => call(name, "removeListener", { eventName, callbackId }).then(() => undefined),
          };
        };
      }
      return (options?: BridgeOptions) => call(name, prop, options ?? undefined);
    },
  });
  pluginCache.set(name, proxy);
  return proxy as T;
}
