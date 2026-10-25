import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { useDashboardScope } from "./DashboardScope";
import type {
  AttendanceCompliance,
  ClassPerformance,
  DigestItem,
  RecheckQueue,
  RecheckStats,
  ResolveRecheckResult,
  StudentPortalAdoption,
  TaskQueue,
  TaskStats,
  TeacherAdoption,
  WingStanding,
} from "./coordinatorTypes";

/**
 * Hooks for the coordinator wing dashboard.
 *
 * Every RPC here resolves its own scope server-side from `auth.uid()` via
 * `dash_resolve_scoped_classes()`, so none of them takes a wing or class
 * argument and there is nothing to branch on client-side. `scope` still goes
 * into each query key so an admin and a coordinator can never share a cache
 * entry if these ever mount under a different provider.
 *
 * Per CLAUDE.md §23 every query carries an explicit `staleTime` of 60s and
 * every list RPC is called with an explicit page size. None of them polls.
 */

const STALE = 60_000;

export function useWingStanding() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "wingStanding"],
    staleTime: STALE,
    queryFn: async (): Promise<WingStanding> => {
      const { data, error } = await supabase.rpc("dash_scoped_wing_standing");
      if (error) throw error;
      return data as unknown as WingStanding;
    },
  });
}

export function useWingDigest() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "digest"],
    staleTime: STALE,
    queryFn: async (): Promise<DigestItem[]> => {
      const { data, error } = await supabase.rpc("dash_scoped_digest");
      if (error) throw error;
      return (data ?? []) as unknown as DigestItem[];
    },
  });
}

export function useStudentPortalAdoption(limit = 8) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "studentAdoption", limit],
    staleTime: STALE,
    queryFn: async (): Promise<StudentPortalAdoption> => {
      const { data, error } = await supabase.rpc("dash_scoped_student_portal_adoption", {
        p_limit: limit,
      });
      if (error) throw error;
      return data as unknown as StudentPortalAdoption;
    },
  });
}

export function useTeacherAdoption(limit = 15) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherAdoption", limit],
    staleTime: STALE,
    queryFn: async (): Promise<TeacherAdoption> => {
      const { data, error } = await supabase.rpc("dash_scoped_teacher_adoption", {
        p_limit: limit,
      });
      if (error) throw error;
      return data as unknown as TeacherAdoption;
    },
  });
}

export function useScopedClassPerformance() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "classPerformance"],
    staleTime: STALE,
    queryFn: async (): Promise<ClassPerformance> => {
      const { data, error } = await supabase.rpc("dash_scoped_class_performance");
      if (error) throw error;
      return data as unknown as ClassPerformance;
    },
  });
}

export function useAttendanceCompliance(days = 14) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "attendanceCompliance", days],
    staleTime: STALE,
    queryFn: async (): Promise<AttendanceCompliance> => {
      const { data, error } = await supabase.rpc("dash_scoped_attendance_compliance", {
        p_days: days,
      });
      if (error) throw error;
      return data as unknown as AttendanceCompliance;
    },
  });
}

export function useRecheckStats() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "recheckStats"],
    staleTime: STALE,
    queryFn: async (): Promise<RecheckStats> => {
      const { data, error } = await supabase.rpc("dash_scoped_recheck_stats");
      if (error) throw error;
      return data as unknown as RecheckStats;
    },
  });
}

export function useRecheckQueue(status = "pending", limit = 10, offset = 0) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "recheckQueue", status, limit, offset],
    staleTime: STALE,
    queryFn: async (): Promise<RecheckQueue> => {
      const { data, error } = await supabase.rpc("dash_scoped_recheck_queue", {
        p_status: status,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      return data as unknown as RecheckQueue;
    },
  });
}

export function useTaskStats() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "taskStats"],
    staleTime: STALE,
    queryFn: async (): Promise<TaskStats> => {
      const { data, error } = await supabase.rpc("dash_scoped_task_stats");
      if (error) throw error;
      return data as unknown as TaskStats;
    },
  });
}

export function useTaskQueue(limit = 10, offset = 0) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "taskQueue", limit, offset],
    staleTime: STALE,
    queryFn: async (): Promise<TaskQueue> => {
      const { data, error } = await supabase.rpc("dash_scoped_task_queue", {
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      return data as unknown as TaskQueue;
    },
  });
}

/**
 * Approve or reject one recheck request.
 *
 * The RPC is a single transaction guarded on `status = 'pending'`, so a double
 * submit resolves to `already_resolved` rather than overwriting the first
 * decision. `isPending` still gates the button as the first line of defence.
 */
export function useResolveRecheck() {
  const queryClient = useQueryClient();
  const scope = useDashboardScope();

  return useMutation({
    mutationFn: async (vars: {
      id: string;
      approve: boolean;
      newMarks?: number | null;
      notes?: string | null;
    }): Promise<ResolveRecheckResult> => {
      const { data, error } = await supabase.rpc("dash_scoped_resolve_recheck", {
        p_id: vars.id,
        p_approve: vars.approve,
        p_new_marks: vars.newMarks ?? undefined,
        p_notes: vars.notes ?? undefined,
      });
      if (error) throw error;
      return data as unknown as ResolveRecheckResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dash", scope, "recheckQueue"] });
      queryClient.invalidateQueries({ queryKey: ["dash", scope, "recheckStats"] });
      queryClient.invalidateQueries({ queryKey: ["dash", scope, "digest"] });
      // The institution-wide recheck page reads its own key; keep it honest too.
      queryClient.invalidateQueries({ queryKey: ["institution-rechecks"] });
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't record that decision.",
        context: "resolveRecheck",
      }),
  });
}
