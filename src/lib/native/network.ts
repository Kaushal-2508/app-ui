import { useEffect, useState } from "react";

import { nativePlugin, removeListener, type ListenerHandleLike } from "./platform";

/**
 * Online/offline as a hook. Web: `navigator.onLine` plus the online/offline
 * events. Native: the `Network` plugin, because a WebView's
 * `navigator.onLine` is unreliable.
 */

type NetworkPlugin = {
  getStatus(): Promise<{ connected: boolean }>;
  addListener(event: "networkStatusChange", cb: (s: { connected: boolean }) => void): ListenerHandleLike;
};

export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const network = nativePlugin<NetworkPlugin>("Network");
    if (network) {
      let cancelled = false;
      void network.getStatus().then((s) => {
        if (!cancelled) setOnline(s.connected);
      }).catch(() => {});
      const handle = network.addListener("networkStatusChange", (s) => setOnline(s.connected));
      return () => {
        cancelled = true;
        removeListener(handle);
      };
    }

    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
