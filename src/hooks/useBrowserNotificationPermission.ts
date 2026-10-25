import { useState, useCallback, useEffect } from "react";

export function useBrowserNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof Notification === "undefined") return false;

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === "granted";
    } catch {
      return false;
    }
  }, []);

  const showBrowserNotification = useCallback(
    (title: string, body: string, icon?: string) => {
      if (permission !== "granted") return;
      // if (document.hasFocus()) return; // Only show when tab not focused

      try {
        new Notification(title, {
          body,
          icon: icon || "/favicon.ico",
          tag: `notification-${Date.now()}`,
        });
      } catch (e) {
        console.warn("Failed to show browser notification:", e);
      }
    },
    [permission],
  );

  return {
    permission,
    isSupported: typeof Notification !== "undefined",
    isGranted: permission === "granted",
    requestPermission,
    showBrowserNotification,
  };
}
