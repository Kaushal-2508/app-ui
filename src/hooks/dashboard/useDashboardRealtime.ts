import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/** Connection-trust signal. `live` when Realtime is healthy, `reconnecting`
 * when the channel errors / times out / closes. */
export type DashboardRealtimeStatus = "live" | "reconnecting";

export interface DashboardRealtime {
  status: DashboardRealtimeStatus;
  /** When the dashboard data was last confirmed fresh (first SUBSCRIBED or last
   * received change). `null` until the first successful subscribe. */
  lastUpdatedAt: Date | null;
  /** Tear down + recreate the channel (manual reconnect). */
  retry: () => void;
}

type DashboardFlagRow = Database["public"]["Tables"]["dashboard_flags"]["Row"];

// Query keys the dashboard reads from — invalidated on every received change so
// the flags feed + KPI strip refresh. Must match useDashboardData / useFlagActions.
const FLAGS_KEY = ["dash", "flags"] as const;
const KPI_KEY = ["dash", "kpi"] as const;

/**
 * The dashboard's single Supabase Realtime channel (§23.4 — ONE channel per
 * feature, never per component). Subscribes to `postgres_changes` on
 * `public.dashboard_flags` scoped to the institution. On any change it
 * invalidates the flags + KPI query keys and stamps `lastUpdatedAt`. The
 * `.subscribe` callback maps the channel status into a simple `live` /
 * `reconnecting` union that the header surfaces as the connection-trust signal.
 *
 * Cleans up the channel on unmount via `supabase.removeChannel` (§23.4). Only
 * active while `institutionId` is set.
 */
export function useDashboardRealtime(institutionId?: string | null): DashboardRealtime {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [status, setStatus] = useState<DashboardRealtimeStatus>("reconnecting");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  // Bumping this re-runs the subscribe effect so retry() recreates the channel.
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setStatus("reconnecting");
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!institutionId) return;

    // Defensive: tear down any prior channel before creating a new one so a
    // retry / institution switch never leaves a dangling subscription.
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`dashboard:${institutionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dashboard_flags",
          filter: `institution_id=eq.${institutionId}`,
        },
        (_payload: RealtimePostgresChangesPayload<DashboardFlagRow>) => {
          void queryClient.invalidateQueries({ queryKey: FLAGS_KEY });
          void queryClient.invalidateQueries({ queryKey: KPI_KEY });
          setLastUpdatedAt(new Date());
        }
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") {
          setStatus("live");
          // First healthy subscribe seeds the timestamp so the header shows a
          // concrete "Updated …" instead of "Updating…".
          setLastUpdatedAt((prev) => prev ?? new Date());
        } else if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT" ||
          channelStatus === "CLOSED"
        ) {
          setStatus("reconnecting");
        }
      });

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [institutionId, queryClient, nonce]);

  return { status, lastUpdatedAt, retry };
}
