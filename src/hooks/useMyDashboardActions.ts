import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { useAuth } from "@/hooks/useAuth";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useInstitutionTimezone } from "@/hooks/useInstitutionTimezone";
import { useUserRole } from "@/hooks/useUserRole";
import { onAppStateChange } from "@/lib/native";
import {
  parseDashboardActions,
  refreshDelayMs,
  schoolClock,
  type DashboardActions,
} from "@/lib/dashboardActions";
import { DASHBOARD_ACTIONS_KEY } from "@/lib/dashboardActionsKey";

export interface MyDashboardActions {
  /** Roles or features are still loading: show the plain sky, not the 3D scene yet. */
  gatePending: boolean;
  /** A staff view with the attendance feature on: the cards apply to this dashboard. */
  enabled: boolean;
  data: DashboardActions | undefined;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

/**
 * Today's action cards for the dashboard being shown (spec 2026-10-03), from ONE read-only
 * RPC that counts on the server (§23). `view` is that dashboard's own view, never the raw
 * activeViewRole (it reads "teacher" for single-role accounts); the server can only narrow
 * it (§25). Students and super admins never call it.
 *
 * Safe to call from several components on one dashboard: they share one cache entry. Mount
 * useDashboardActionsRefresh once per dashboard for the clock and return-to-app refreshes.
 */
export function useMyDashboardActions(view: ViewRole | null): MyDashboardActions {
  const { user } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { isFeatureEnabled, isLoading: featuresLoading } = useInstitutionFeatures();
  const timeZone = useInstitutionTimezone();

  const isStaff =
    !!roleInfo && !roleInfo.isSuperAdmin && (roleInfo.isSchoolAdmin || roleInfo.isCoordinator || roleInfo.isTeacher);
  const gatePending = !!view && (roleLoading || featuresLoading);
  const enabled = !!view && !!user?.id && !gatePending && isStaff && isFeatureEnabled("attendance");
  // The school's date is part of the key: the query cache is persisted for a day, and a
  // date-less key would hand this morning yesterday's cards until the refetch landed.
  const schoolDate = schoolClock(new Date(), timeZone).date;

  const query = useQuery({
    queryKey: [...DASHBOARD_ACTIONS_KEY, user?.id ?? null, view, schoolDate],
    queryFn: async (): Promise<DashboardActions> => {
      const { data, error } = await supabase.rpc("my_dashboard_actions", { p_view: view ?? undefined });
      if (error) throw error;
      return parseDashboardActions(data);
    },
    enabled,
    staleTime: 60_000,
  });

  const { refetch } = query;
  return {
    gatePending,
    enabled,
    data: query.data,
    isError: query.isError,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: () => {
      void refetch();
    },
  };
}

/**
 * Keeps one dashboard's cards in step with the clock and with the person coming back:
 *   - one timer to the moment the server named (check-out time, a period ending, the
 *     cutoff, the school's midnight), measured from when that answer arrived (a restored
 *     answer is already partly through its wait) and re-armed by every new answer. Every
 *     dashboard of a school shares those moments, so each one adds its own 0 to 20 s
 *     spread instead of all asking in the same second;
 *   - a refetch on return to the tab or the app when the answer is over a minute old.
 *     onAppStateChange also covers the native shell; plain window focus/blur is ignored
 *     because a tab return also fires visibilitychange (one request, not two).
 * cancelRefetch: false makes a second call join the fetch already in flight. No polling and
 * no realtime channel (§23); both listeners are cleaned up on unmount.
 */
export function useDashboardActionsRefresh(actions: MyDashboardActions): void {
  const queryClient = useQueryClient();
  const { enabled, dataUpdatedAt } = actions;
  const delay = refreshDelayMs(actions.data);
  const updatedAt = useRef(dataUpdatedAt);
  const [spread] = useState(() => Math.floor(Math.random() * 20_000));

  useEffect(() => {
    updatedAt.current = dataUpdatedAt;
  }, [dataUpdatedAt]);

  useEffect(() => {
    if (!enabled || delay === null) return;
    const wait = Math.max(30_000, delay - (Date.now() - dataUpdatedAt)) + spread;
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_ACTIONS_KEY }, { cancelRefetch: false });
    }, wait);
    return () => window.clearTimeout(id);
  }, [enabled, delay, dataUpdatedAt, spread, queryClient]);

  useEffect(() => {
    if (!enabled) return;
    return onAppStateChange((active, source) => {
      if (!active || source === "focus" || Date.now() - updatedAt.current < 60_000) return;
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_ACTIONS_KEY }, { cancelRefetch: false });
    });
  }, [enabled, queryClient]);
}
