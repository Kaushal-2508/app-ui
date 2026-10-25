import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateAttendanceCaches } from "@/lib/attendanceCache";

export type LeaveStatus = "pending" | "approved" | "rejected";
export type LeaveType = "sick" | "personal" | "family" | "other";
/**
 * Who created the leave record. `student` is an application the student
 * submitted (the original flow); `staff` is a leave a teacher, coordinator
 * or admin marked straight from the attendance roster, which is born
 * already approved. Mirrors `leave_requests.source`.
 */
export type LeaveSource = "student" | "staff";

/** The four `leave_requests.leave_type` values, in display order. */
export const LEAVE_TYPES: readonly LeaveType[] = ["sick", "personal", "family", "other"] as const;

/** Single source of truth for leave-type copy (apply form, roster sheet, review list). */
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  sick: "Sick",
  personal: "Personal",
  family: "Family",
  other: "Other",
};

export const LEAVE_PAGE_SIZE = 20;

const LEAVE_COLS =
  "id, student_id, class_id, institution_id, leave_type, start_date, end_date, reason, status, source, reviewed_by, reviewed_at, reviewer_notes, created_at";

export interface LeaveRequestRow {
  id: string;
  student_id: string;
  class_id: string;
  institution_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  source: LeaveSource;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface ScopedLeaveRow extends LeaveRequestRow {
  studentName: string | null;
  studentRoll: string | null;
  className: string | null;
  classSection: string | null;
}

function pickOne<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** The signed-in student's own leave requests, newest first, paginated. */
export function useMyLeaveRequests(page = 0) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-leave-requests", user?.id, page],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<LeaveRequestRow[]> => {
      if (!user?.id) return [];
      const from = page * LEAVE_PAGE_SIZE;
      const { data, error } = await supabase
        .from("leave_requests")
        .select(LEAVE_COLS)
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, from + LEAVE_PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as unknown as LeaveRequestRow[];
    },
  });
}

/** Apply for leave. class_id / institution_id are passed in from the caller. */
export function useApplyLeave() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      class_id: string;
      institution_id: string;
      leave_type: LeaveType;
      start_date: string;
      end_date: string;
      reason: string;
    }) => {
      if (!user?.id) throw new Error("You must be signed in to apply for leave.");
      const { error } = await supabase.from("leave_requests").insert({
        student_id: user.id,
        class_id: input.class_id,
        institution_id: input.institution_id,
        leave_type: input.leave_type,
        start_date: input.start_date,
        end_date: input.end_date,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      toast.success("Leave request submitted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't submit your leave request.", context: "applyLeave" }),
  });
}

/** Withdraw one of the student's own PENDING requests. */
export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leave_requests").delete().eq("id", id);
      if (error) throw error;
      // A PostgREST DELETE blocked by RLS (the row is no longer 'pending' — a
      // reviewer decided it in the meantime) returns 0 rows and NO error, i.e.
      // looks identical to success. Re-SELECT and treat "row gone" as the only
      // success signal (CLAUDE.md §6).
      const { data, error: checkError } = await supabase
        .from("leave_requests")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (checkError) throw checkError;
      if (data) {
        throw new Error("This request can no longer be withdrawn. It may have already been reviewed.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      toast.success("Leave request withdrawn");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't withdraw the request.", context: "cancelLeave" }),
  });
}

/**
 * Staff-scoped leave list. RLS filters to the reviewer's classes/wing/
 * institution, as a UNION of every role the account holds. `classIds`
 * narrows that union to one view's classes for a dual-role user (§25): pass
 * the active view's class ids and an empty list means "no classes, no rows".
 */
export function useScopedLeaveRequests(opts: {
  classId?: string | null;
  classIds?: string[] | null;
  status?: LeaveStatus | "all";
  page?: number;
  enabled?: boolean;
}) {
  const { user } = useAuth();
  const page = opts.page ?? 0;
  const status = opts.status ?? "pending";
  const classId = opts.classId ?? null;
  const classIds = opts.classIds ?? null;
  return useQuery({
    queryKey: ["scoped-leave-requests", user?.id, classId, classIds, status, page],
    enabled: (opts.enabled ?? true) && !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ScopedLeaveRow[]> => {
      const from = page * LEAVE_PAGE_SIZE;
      let q = supabase
        .from("leave_requests")
        .select(
          `${LEAVE_COLS}, student:profiles!leave_requests_student_id_fkey(full_name, roll_number), class:classes!leave_requests_class_id_fkey(name, section)`,
        )
        .order("created_at", { ascending: false })
        .range(from, from + LEAVE_PAGE_SIZE - 1);
      if (classId) q = q.eq("class_id", classId);
      else if (classIds) q = q.in("class_id", classIds);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      type Joined = LeaveRequestRow & {
        student: { full_name: string | null; roll_number: string | null } | { full_name: string | null; roll_number: string | null }[] | null;
        class: { name: string | null; section: string | null } | { name: string | null; section: string | null }[] | null;
      };
      return ((data ?? []) as unknown as Joined[]).map((r) => {
        const s = pickOne(r.student);
        const c = pickOne(r.class);
        return {
          ...r,
          studentName: s?.full_name ?? null,
          studentRoll: s?.roll_number ?? null,
          className: c?.name ?? null,
          classSection: c?.section ?? null,
        } as ScopedLeaveRow;
      });
    },
  });
}

/** Server-side pending count for badges (never fetch rows to count them). */
export function usePendingLeaveCount(classId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pending-leave-count", user?.id, classId ?? "all"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      let q = supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (classId) q = q.eq("class_id", classId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export interface LeaveDecisionResult {
  status: LeaveStatus;
  /** Dates an attendance row was written for. */
  dates_marked: number;
  /** School holidays inside the range, which never get a mark. */
  dates_skipped: number;
  /**
   * Dates a REJECTION left alone because they have not happened yet. "Not on
   * leave" is not "absent", so the roster marks those days when they arrive.
   */
  dates_deferred: number;
}

/** Approve/reject via the single-write-path RPC. */
export function useReviewLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; decision: "approved" | "rejected"; notes?: string }) => {
      const { data, error } = await supabase.rpc("review_student_leave", {
        p_request_id: input.requestId,
        p_decision: input.decision,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as unknown as LeaveDecisionResult;
    },
    onSuccess: (result, input) => {
      // A decision rewrites attendance for every date in the range, so it must
      // refresh exactly what a roster save refreshes — same shared list
      // (src/lib/attendanceCache.ts).
      invalidateAttendanceCaches(qc);
      toast.success(input.decision === "approved" ? "Leave approved" : "Leave rejected");
      // A rejection leaves dates that have not happened yet unmarked: "not on
      // leave" is not "absent", so the roster marks them on the day.
      if ((result?.dates_deferred ?? 0) > 0) {
        toast.info(
          "Dates still in the future were left unmarked. They will be marked as usual on the day.",
        );
      }
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update the leave request.", context: "reviewLeave" }),
  });
}
