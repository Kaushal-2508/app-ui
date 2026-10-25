import { nativePlugin, removeListener, type ListenerHandleLike } from "./platform";

/**
 * Device-side push notifications through the shell's PushNotifications
 * plugin (`@capacitor/push-notifications`, installed in ~/salci-app-shell).
 * This module only talks to the phone: permission, the FCM/APNs device token,
 * and the received/tapped events. Storing the token against the user lives in
 * src/lib/pushDevices.ts. On the web every function here reports
 * "unsupported" or is a no-op; the website keeps its own Web Push flow.
 */

export type PushPermission = "unsupported" | "prompt" | "granted" | "denied";

export interface PushMessage {
  id?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied";

type PushPlugin = {
  checkPermissions(): Promise<{ receive: PermissionState }>;
  requestPermissions(): Promise<{ receive: PermissionState }>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  addListener(event: string, cb: (data: unknown) => void): ListenerHandleLike;
};

const plugin = () => nativePlugin<PushPlugin>("PushNotifications");

/** True inside an app build that carries the plugin. */
export function isPushSupported(): boolean {
  return plugin() !== null;
}

function toPermission(state: PermissionState): PushPermission {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "prompt";
}

export async function getPushPermission(): Promise<PushPermission> {
  const p = plugin();
  if (!p) return "unsupported";
  try {
    return toPermission((await p.checkPermissions()).receive);
  } catch {
    return "unsupported";
  }
}

export interface PushRegistration {
  permission: PushPermission;
  /** The FCM (Android) or APNs (iOS) device token, null when none was issued. */
  token: string | null;
  /** Why there is no token although permission was granted. */
  error?: string;
}

// APNs and FCM normally answer within a second; a phone with no network never
// answers at all, and the caller must not hang on it.
const REGISTRATION_TIMEOUT_MS = 15_000;

/**
 * Ask for permission if the phone has not been asked yet, then register with
 * the platform's push service and wait for the device token. Never throws.
 */
export async function registerForPush(): Promise<PushRegistration> {
  const p = plugin();
  if (!p) return { permission: "unsupported", token: null };

  let state: PermissionState;
  try {
    state = (await p.checkPermissions()).receive;
    if (state !== "granted" && state !== "denied") {
      state = (await p.requestPermissions()).receive;
    }
  } catch (e) {
    return { permission: "unsupported", token: null, error: e instanceof Error ? e.message : String(e) };
  }
  const permission = toPermission(state);
  if (permission !== "granted") return { permission, token: null };

  return new Promise<PushRegistration>((resolve) => {
    let settled = false;
    const handles: ListenerHandleLike[] = [];
    const finish = (result: PushRegistration) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      handles.forEach(removeListener);
      resolve(result);
    };
    const timer = window.setTimeout(
      () => finish({ permission, token: null, error: "The push service did not answer." }),
      REGISTRATION_TIMEOUT_MS,
    );
    handles.push(
      p.addListener("registration", (d) => finish({ permission, token: (d as { value: string }).value })),
    );
    handles.push(
      p.addListener("registrationError", (d) =>
        finish({ permission, token: null, error: (d as { error?: string }).error ?? "Registration failed." }),
      ),
    );
    p.register().catch((e: unknown) =>
      finish({ permission, token: null, error: e instanceof Error ? e.message : String(e) }),
    );
  });
}

/** Invalidate this device's token with the push service. Never throws. */
export async function unregisterFromPush(): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.unregister();
  } catch {
    /* the token is already dropped server-side by the caller */
  }
}

export interface PushEventHandlers {
  /** A message arrived while the app was in the foreground (the OS shows nothing). */
  onReceived?: (message: PushMessage) => void;
  /** The user tapped a notification; the app is now in the foreground. */
  onTap?: (message: PushMessage) => void;
}

/** Subscribe to push events; returns the cleanup. No-op on the web. */
export function onPushEvents(handlers: PushEventHandlers): () => void {
  const p = plugin();
  if (!p) return () => {};
  const received = handlers.onReceived
    ? p.addListener("pushNotificationReceived", (d) => handlers.onReceived?.(d as PushMessage))
    : null;
  const tapped = handlers.onTap
    ? p.addListener("pushNotificationActionPerformed", (d) =>
        handlers.onTap?.((d as { notification: PushMessage }).notification),
      )
    : null;
  return () => {
    removeListener(received);
    removeListener(tapped);
  };
}

/**
 * The in-app route a message points at (`data.url`, the same field the web
 * push payload carries), or null. Only same-app paths are honoured: a push
 * payload must never be able to send the WebView to an arbitrary origin.
 */
export function pushTargetUrl(message: PushMessage): string | null {
  const url = message.data?.url;
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : null;
}
