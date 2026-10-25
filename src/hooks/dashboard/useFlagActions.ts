import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { useDashboardScope, isScopedDashboard, type DashboardScope } from "./DashboardScope";

// Query keys touched by every flag mutation + the on-open kick. The dashboard
// data hooks namespace their keys by scope (`["dash", scope, "flags"]` /
// `["dash", scope, "kpi"]`), so the invalidators below are built per-scope.
const flagsKey = (scope: DashboardScope) => ["dash", scope, "flags"] as const;
const kpiKey = (scope: DashboardScope) => ["dash", scope, "kpi"] as const;

/** Stable hour bucket (institution-local doesn't matter for the throttle — the
 * guard only needs to be coarse and monotonic). Format: YYYY-MM-DD-HH. */
function hourBucket(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}`;
}

/**
 * On-open kick: recompute the flag set once per institution per hour. Mirrors
 * the §24 attendance page-view kick — a `sessionStorage` guard keyed on
 * `salci:dash-flags:{institutionId}:{YYYY-MM-DD-HH}` so a fresh tab / hour
 * triggers a single `dash_evaluate_flags` write, and the 15-min cron remains the
 * fallback. Never blocks render and swallows errors quietly (the next open or
 * the cron retries). On success it invalidates the flags feed + the
 * "Decisions waiting" KPI so both refresh with the freshly-merged set.
 *
 * Scope: this is the INSTITUTION-WIDE evaluator. Coordinators/teachers
 * (`isScopedDashboard(scope)`) must NOT run it — their flag set is materialized
 * server-side by the scoped RPCs — so the hook no-ops in that scope.
 */
export function useEvaluateFlagsOnOpen(institutionId?: string | null) {
  const queryClient = useQueryClient();
  const scope = useDashboardScope();

  useEffect(() => {
    if (isScopedDashboard(scope)) return;
    if (!institutionId) return;
    if (typeof window === "undefined") return;

    const key = `salci:dash-flags:${institutionId}:${hourBucket()}`;
    let cancelled = false;

    try {
      if (sessionStorage.getItem(key)) return;
      // Claim the bucket BEFORE the await so a fast remount can't double-fire.
      sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage unavailable (private mode quota etc.) — fall through and
      // still kick; the cron is the ultimate backstop either way.
    }

    void (async () => {
      try {
        const { error } = await supabase.rpc("dash_evaluate_flags", {});
        if (error) throw error;
        const { error: syError } = await supabase.rpc("dash_evaluate_syllabus_flags", {});
        if (syError) throw syError;
        if (cancelled) return;
        void queryClient.invalidateQueries({ queryKey: flagsKey("institution") });
        void queryClient.invalidateQueries({ queryKey: kpiKey("institution") });
      } catch {
        // Swallow: next open / cron retries. Drop the guard so a later mount
        // this hour can retry instead of being suppressed by a failed run.
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scope, institutionId, queryClient]);
}

/**
 * The three flag → task lifecycle actions, each a SECURITY DEFINER RPC:
 * - `createTask`   → `dash_create_task_from_flag(p_flag_id, p_assignee_id?)`
 * - `reassignTask` → `dash_reassign_flag_task(p_flag_id, p_assignee_id)`
 * - `cancelTask`   → `dash_cancel_flag_task(p_flag_id)`
 *
 * Every mutation invalidates the flags feed + the KPI strip on success (§23),
 * toasts success via `toast.success`, and routes failures through `toastError`.
 *
 * Scope: when `isScopedDashboard(scope)` the three lifecycle RPCs are the parallel
 * `dash_scoped_*` variants (same args), and invalidation targets the scoped
 * cache keys. The admin Command Center (default `"institution"`) is unchanged.
 */
export function useFlagActions() {
  const queryClient = useQueryClient();
  const scope = useDashboardScope();
  const isScoped = isScopedDashboard(scope);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: flagsKey(scope) });
    void queryClient.invalidateQueries({ queryKey: kpiKey(scope) });
  };

  const createTask = useMutation({
    mutationFn: async (vars: { flagId: string; assigneeId?: string | null }): Promise<string> => {
      const args = {
        p_flag_id: vars.flagId,
        ...(vars.assigneeId ? { p_assignee_id: vars.assigneeId } : {}),
      };
      const { data, error } = isScoped
        ? await supabase.rpc("dash_scoped_create_task_from_flag", args)
        : await supabase.rpc("dash_create_task_from_flag", args);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Task created");
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't create the task.", context: "dashCreateTaskFromFlag" }),
  });

  const reassignTask = useMutation({
    mutationFn: async (vars: { flagId: string; assigneeId: string }): Promise<void> => {
      const args = { p_flag_id: vars.flagId, p_assignee_id: vars.assigneeId };
      const { error } = isScoped
        ? await supabase.rpc("dash_scoped_reassign_flag_task", args)
        : await supabase.rpc("dash_reassign_flag_task", args);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Task reassigned");
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't reassign the task.", context: "dashReassignFlagTask" }),
  });

  const cancelTask = useMutation({
    mutationFn: async (vars: { flagId: string }): Promise<void> => {
      const args = { p_flag_id: vars.flagId };
      const { error } = isScoped
        ? await supabase.rpc("dash_scoped_cancel_flag_task", args)
        : await supabase.rpc("dash_cancel_flag_task", args);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Task cancelled");
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't cancel the task.", context: "dashCancelFlagTask" }),
  });

  return { createTask, reassignTask, cancelTask };
}

export interface AssignableStaff {
  id: string;
  name: string;
}

/**
 * Teachers + coordinators of the institution, for the reassign picker. One
 * round-trip for the role rows, one for the profile names (the `user_roles →
 * profiles` join isn't a declared FK, so PostgREST can't embed it). Explicit
 * column lists, `staleTime` 5 min — the staff roster barely changes within a
 * session (§23). Names sorted client-side; the list is small (a school's staff).
 */
export function useAssignableStaff(institutionId?: string | null) {
  return useQuery({
    queryKey: ["dash", "assignableStaff", institutionId],
    enabled: !!institutionId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AssignableStaff[]> => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("institution_id", institutionId as string)
        .in("role", ["teacher", "coordinator"]);
      if (rolesError) throw rolesError;

      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (ids.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      if (profilesError) throw profilesError;

      return (profiles ?? [])
        .map((p) => ({ id: p.id, name: p.full_name?.trim() || p.email || "Unnamed" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
