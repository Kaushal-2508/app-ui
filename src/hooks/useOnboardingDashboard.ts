import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useInstitutionOnboardingProgress,
  type InstitutionOnboardingRow,
} from "@/hooks/useOnboardingJourney";
import {
  computeDeltas,
  buildZeroDayMap,
  deriveAlerts,
  distributionByTier,
  newlyCompletedToday,
  type Deltas,
  type DashboardAlert,
  type SnapshotRow,
  type Tier,
} from "@/lib/onboardingDashboardMath";

export interface OnboardingDashboardData {
  live: InstitutionOnboardingRow[];
  baseline: SnapshotRow | null;
  trend: SnapshotRow[];
  deltas: Deltas;
  alerts: DashboardAlert[];
  zeroDayMap: Map<string, number>;
  distribution: Record<Tier, number>;
  newlyCompleted: Set<string>;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Wraps the live onboarding query and snapshot reads. Fires the SECURITY
 * DEFINER ensure_onboarding_snapshot RPC once on mount to materialise
 * today's snapshot (idempotent — first-of-day wins).
 */
export function useOnboardingDashboard(
  institutionId: string | null | undefined,
): OnboardingDashboardData {
  const queryClient = useQueryClient();

  const liveQuery = useInstitutionOnboardingProgress(institutionId, !!institutionId);

  const baselineQuery = useQuery({
    queryKey: ["onboarding-dashboard", "baseline", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<SnapshotRow | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("onboarding_snapshots")
        .select("*")
        .eq("institution_id", institutionId)
        .lt("snapshot_date", new Date().toISOString().slice(0, 10))
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as SnapshotRow | null) ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const trendQuery = useQuery({
    queryKey: ["onboarding-dashboard", "trend", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<SnapshotRow[]> => {
      if (!institutionId) return [];
      const thirty = new Date();
      thirty.setDate(thirty.getDate() - 30);
      const { data, error } = await supabase
        .from("onboarding_snapshots")
        .select("*")
        .eq("institution_id", institutionId)
        .gte("snapshot_date", thirty.toISOString().slice(0, 10))
        .order("snapshot_date", { ascending: true });
      if (error) throw error;
      return (data as unknown as SnapshotRow[] | null) ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const ensureMutation = useMutation({
    mutationFn: async (): Promise<SnapshotRow | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase.rpc(
        "ensure_onboarding_snapshot",
        { _institution_id: institutionId },
      );
      if (error) throw error;
      if (Array.isArray(data)) return ((data as unknown[])[0] as SnapshotRow) ?? null;
      return (data as unknown as SnapshotRow | null) ?? null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-dashboard", "trend", institutionId] });
    },
  });

  // Fire snapshot ensure once per institutionId change. ensureMutation is a
  // stable handle from React Query; adding it to deps would re-fire every
  // render. This is the standard "fire once on mount/key change" pattern.
  useEffect(() => {
    if (!institutionId) return;
    ensureMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  const live = liveQuery.data ?? [];
  const baseline = baselineQuery.data ?? null;
  const trend = trendQuery.data ?? [];

  const deltas = computeDeltas(live, baseline);
  const zeroDayMap = buildZeroDayMap(live, trend);
  const alerts = deriveAlerts({ live, deltas, zeroDayMap });
  const distribution = distributionByTier(live);
  const newlyCompleted = newlyCompletedToday(live, baseline);

  return {
    live,
    baseline,
    trend,
    deltas,
    alerts,
    zeroDayMap,
    distribution,
    newlyCompleted,
    isLoading: liveQuery.isLoading || baselineQuery.isLoading || trendQuery.isLoading,
    isError: liveQuery.isError || baselineQuery.isError || trendQuery.isError,
  };
}
