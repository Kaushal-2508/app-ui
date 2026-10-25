import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  applyStatusBarTheme,
  getPushPermission,
  isNativePlatform,
  onAndroidBack,
  onPushEvents,
  pushTargetUrl,
  useIsOnline,
} from "@/lib/native";
import { nativePlugin, removeListener, type ListenerHandleLike } from "@/lib/native/platform";
import { appLinkPath } from "@/lib/appLinks";
import { resolveNotificationTarget } from "@/lib/notificationLink";
import { enablePushOnThisDevice } from "@/lib/pushDevices";

import { LaunchIntro } from "./LaunchIntro";

// Routes where Android back means "leave the app", not "go to the previous
// screen": the roots a signed-in or signed-out user lands on.
const ROOT_PATHS = new Set(["/", "/login", "/dashboard"]);

// The App plugin's link event. The adapter would normally live in
// src/lib/native/, which only Tushar edits (CLAUDE.md section 28), so it is
// declared here and reaches the plugin through the same `nativePlugin` bridge.
type AppLinkPlugin = {
  addListener(event: "appUrlOpen", cb: (e: { url?: unknown }) => void): ListenerHandleLike;
};

/**
 * Mounted once inside BrowserRouter (App.tsx). Renders nothing on the web.
 * Inside the shell it plays the launch intro on a cold start (which also
 * hands over from the system splash, see LaunchIntro), keeps the status bar
 * in step with the theme, maps the Android back button onto router history,
 * and shows an offline banner under the app bar.
 */
export function NativeBootstrap() {
  const native = isNativePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  // useNavigate() hands back a new function on every route change; a listener
  // that must stay registered for the app's lifetime reads it from here.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Status bar follows the `dark` class on <html>, which the theme code toggles.
  useEffect(() => {
    if (!native) return;
    const root = document.documentElement;
    const apply = () => applyStatusBarTheme(root.classList.contains("dark"));
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [native]);

  // Android back: an open Radix layer (sheet, dialog, menu) closes itself on
  // Escape, so send one; otherwise walk history, and exit from a root screen.
  useEffect(() => {
    if (!native) return;
    return onAndroidBack(() => {
      const openLayer = document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"]');
      if (openLayer) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return true;
      }
      if (ROOT_PATHS.has(pathRef.current) || window.history.length <= 1) return false;
      navigate(-1);
      return true;
    });
  }, [native, navigate]);

  // A link the phone hands the app (the PTM feedback QR, scanned with the
  // camera) opens the screen the website would; signed out, ProtectedRoute
  // sends it through /login and back. A cold start's link arrives here too,
  // held by the plugin until this listener registers. App.getLaunchUrl() is
  // left out on purpose: it returns the launch link for the life of the app,
  // so every in-app reload (sign-out does one) would reopen an old QR. The
  // login screen a cold start boots on is replaced, not kept under the form.
  // Registered once, not per route: re-subscribing on every navigation left a
  // moment with two listeners (one link, two navigations) or none.
  useEffect(() => {
    if (!native) return;
    const app = nativePlugin<AppLinkPlugin>("App");
    if (!app) return;
    const handle = app.addListener("appUrlOpen", (event) => {
      const path = typeof event?.url === "string" ? appLinkPath(event.url) : null;
      const here = pathRef.current;
      if (!path || path === here) return;
      navigateRef.current(path, { replace: here === "/" || here === "/login" });
    });
    return () => removeListener(handle);
  }, [native]);

  // Push: register this phone for the signed-in user. Runs once per sign-in
  // (keyed on the user id), asks the OS permission the first time, and stays
  // silent about the outcome: the Settings toggle is where a user reads and
  // changes the state. A user who switched push off in Settings is not
  // re-prompted here; a phone that already said no is left alone.
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (!native || !userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("push_notifications")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled || data?.push_notifications === false) return;
      const permission = await getPushPermission();
      if (cancelled || permission === "unsupported" || permission === "denied") return;
      await enablePushOnThisDevice();
    })().catch(() => {
      /* registration is retried on the next sign-in; Settings shows the state */
    });
    return () => {
      cancelled = true;
    };
  }, [native, userId]);

  // A message in the foreground refreshes the bell (the OS shows nothing then);
  // a tapped notification opens the screen its payload names.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!native) return;
    return onPushEvents({
      onReceived: () => {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        void queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });
      },
      onTap: (message) => {
        const url = pushTargetUrl(message);
        if (!url) return;
        // Land on the payload's screen at once, then refine. The payload only
        // carries the row's bare `link`; the row's metadata names the exact
        // task or thread, so read it and replace the entry (never a second
        // history step). Any failure simply leaves the reader on `url`.
        navigate(url);
        const notificationId = message.data?.notificationId;
        if (typeof notificationId !== "string" || !notificationId) return;
        void supabase
          .from("notifications")
          .select("type, link, metadata")
          .eq("id", notificationId)
          .maybeSingle()
          .then(
            ({ data }) => {
              const target = data ? resolveNotificationTarget(data) : null;
              if (target && target !== url) navigate(target, { replace: true });
            },
            () => undefined,
          );
      },
    });
  }, [native, navigate, queryClient]);

  const online = useIsOnline();
  if (!native) return null;

  return (
    <>
      <LaunchIntro />
      {!online && (
        <div className="pointer-events-none fixed inset-x-0 top-[var(--app-bar-height,61px)] z-30 px-3 pt-2">
          <Alert className="pointer-events-auto mx-auto max-w-md surface-card frosted-shadow border-ink-400/50 py-2">
            <WifiOff className="h-4 w-4" />
            <AlertDescription className="text-sm text-ink-900">
              You're offline. Changes will not save until the connection is back.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}
