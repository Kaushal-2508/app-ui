import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import type { LeaveStatus } from "@/hooks/useStudentLeave";

/**
 * Staff leave: teachers, coordinators and school admins apply for leave the
 * way students do, and a request is reviewed one step up the ladder
 * (product rule, 2026-09-26):
 *
 *   teacher      -> a coordinator of a wing that holds one of the teacher's
 *                   classes (a school admin can also decide, so a teacher
 *                   with no wing is never stuck)
 *   coordinator  -> a school admin
 *   school admin -> another school admin (never yourself)
 *
 * The table is `staff_leave_requests` (HR module, 20260226094405). Applying
 * and withdrawing are plain inserts/deletes on the requester's own row,
 * which today's RLS already allows. DECIDING goes through the
 * `review_staff_leave` RPC once it exists: the ladder above, the reviewer
 * SELECT policy for coordinators, and the on-leave attendance rows an
 * approval must write are all database work, specified in
 * docs/superpowers/specs/2026-09-26-staff-leave-workflow-design.md.
 *
 * INTERIM, while `useStaffLeaveReviewAvailable` reports the RPC missing
 * (2026-09-28): school admins decide from the Workday Staff Leaves tab with
 * the same direct UPDATE the HR & Payroll panel makes today, allowed by the
 * existing "Admins full access staff leave requests" policy, hardened with a
 * status guard, a re-read and a no-own-row filter. It writes no attendance
 * rows and no balances (neither does HR). Coordinators cannot see anyone
 * else's request until the SELECT policy lands, so their queue stays empty
 * and says so. The direct path is dead code the moment the probe flips to
 * true. Ordering for the database side: create the RPC BEFORE narrowing the
 * admin policy, and move the HR panel onto the RPC before narrowing it.
 */

export type StaffLeaveType = "annual" | "sick" | "casual" | "maternity" | "paternity" | "unpaid" | "other";

/** The seven `staff_leave_requests.leave_type` values, in display order. */
export const STAFF_LEAVE_TYPES: readonly StaffLeaveType[] = [
  "casual",
  "sick",
  "annual",
  "maternity",
  "paternity",
  "unpaid",
  "other",
] as const;

export const STAFF_LEAVE_TYPE_LABEL: Record<StaffLeaveType, string> = {
  casual: "Casual",
  sick: "Sick",
  annual: "Annual",
  maternity: "Maternity",
  paternity: "Paternity",
  unpaid: "Unpaid",
  other: "Other",
};

export const STAFF_LEAVE_PAGE_SIZE = 20;

/** The requester's standing in the ladder, as the reviewer sees it. */
export type StaffRole = "teacher" | "coordinator" | "admin";

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  teacher: "Teacher",
  coordinator: "Coordinator",
  admin: "Admin",
};

const COLS =
  "id, user_id, institution_id, leave_type, start_date, end_date, reason, status, reviewed_by, reviewed_at, reviewer_notes, created_at";

export interface StaffLeaveRow {
  id: string;
  user_id: string;
  institution_id: string;
  leave_type: StaffLeaveType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface StaffLeaveQueueRow extends StaffLeaveRow {
  requesterName: string | null;
  requesterRole: StaffRole | null;
}

export interface StaffLeaveBalance {
  academic_year: string;
  annual_total: number;
  annual_used: number;
  sick_total: number;
  sick_used: number;
  casual_total: number;
  casual_used: number;
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Which rung of the ladder the signed-in account applies from. */
export function useMyStaffRole(): StaffRole | null {
  const { data: roleInfo } = useUserRole();
  if (!roleInfo) return null;
  if (roleInfo.isSchoolAdmin) return "admin";
  if (roleInfo.isCoordinator) return "coordinator";
  if (roleInfo.isTeacher) return "teacher";
  return null;
}

/** Who will review this account's requests, in words for the apply sheet. */
export const REVIEWER_LABEL: Record<StaffRole, string> = {
  teacher: "Your wing coordinator or a school admin",
  coordinator: "Your school admin",
  admin: "Another school admin",
};

/** The signed-in staff member's own requests, newest first, one page. */
export function useMyStaffLeaveRequests(page = 0) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-staff-leave-requests", user?.id, page],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<StaffLeaveRow[]> => {
      if (!user?.id) return [];
      const from = page * STAFF_LEAVE_PAGE_SIZE;
      const { data, error } = await supabase
        .from("staff_leave_requests")
        .select(COLS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, from + STAFF_LEAVE_PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as unknown as StaffLeaveRow[];
    },
  });
}

/** The signed-in staff member's leave balance for the latest academic year, if the school keeps one. */
export function useMyStaffLeaveBalance() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-staff-leave-balance", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StaffLeaveBalance | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("staff_leave_balances")
        .select("academic_year, annual_total, annual_used, sick_total, sick_used, casual_total, casual_used")
        .eq("user_id", user.id)
        .order("academic_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as StaffLeaveBalance | null) ?? null;
    },
  });
}

/** Apply for leave. One insert on the requester's own row; RLS enforces ownership. */
export function useApplyStaffLeave() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      institution_id: string;
      leave_type: StaffLeaveType;
      start_date: string;
      end_date: string;
      reason: string;
    }) => {
      if (!user?.id) throw new Error("You must be signed in to apply for leave.");
      const { error } = await supabase.from("staff_leave_requests").insert({
        user_id: user.id,
        institution_id: input.institution_id,
        leave_type: input.leave_type,
        start_date: input.start_date,
        end_date: input.end_date,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-staff-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["staff-leave-queue"] });
      toast.success("Leave request submitted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't submit your leave request.", context: "applyStaffLeave" }),
  });
}

/** Withdraw one of the signed-in staff member's own PENDING requests. */
export function useWithdrawStaffLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Only a PENDING request can be withdrawn. The status filter is what
      // keeps a stale list (approved or rejected a minute ago) from deleting
      // a reviewed row; the re-read below then reports it as already reviewed.
      const { error } = await supabase
        .from("staff_leave_requests")
        .delete()
        .eq("id", id)
        .eq("status", "pending");
      if (error) throw error;
      // A DELETE refused by RLS returns no rows and no error, exactly like
      // success (§6). Re-read and treat "row gone" as the only success.
      const { data, error: checkError } = await supabase
        .from("staff_leave_requests")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (checkError) throw checkError;
      if (data) throw new Error("This request can no longer be withdrawn. It may have already been reviewed.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-staff-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["staff-leave-queue"] });
      toast.success("Leave request withdrawn");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't withdraw the request.", context: "withdrawStaffLeave" }),
  });
}

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

/**
 * `review_staff_leave` is not in the generated types yet (the RPC is Tushar's
 * side of this feature), so it is called through a narrow structural view of
 * the client rather than `as any`. Calling it as a method keeps `this`.
 */
function callReviewRpc(args: { p_request_id: string; p_decision: string; p_notes?: string | null }) {
  const client = supabase as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<RpcResult>;
  };
  return client.rpc("review_staff_leave", args);
}

const isMissingRpc = (code?: string) => code === "PGRST202" || code === "42883";

export const STAFF_LEAVE_PROBE_KEY = ["staff-leave-review-available"] as const;

/**
 * Feature probe: does the review RPC exist on this database yet? One call
 * with an invalid decision, which the RPC rejects before it reads or writes
 * anything (the decision check is its first statement, by contract), so the
 * probe has no side effects. Missing function -> false; any other Postgres
 * answer -> true. A transport failure (postgrest reports it with an empty
 * `code`) is a query ERROR, never a cached verdict: caching `true` for the
 * session would send every admin decision down the RPC path and lock them
 * out of the interim direct path. With no data the query is stale, so it
 * retries on the next mount.
 */
export function useStaffLeaveReviewAvailable(enabled = true) {
  return useQuery({
    queryKey: STAFF_LEAVE_PROBE_KEY,
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const { error } = await callReviewRpc({
        p_request_id: "00000000-0000-0000-0000-000000000000",
        p_decision: "probe",
      });
      if (!error) return true;
      if (isMissingRpc(error.code)) return false;
      if (!error.code) throw new Error(error.message);
      return true;
    },
  });
}

/**
 * Requests waiting on the signed-in reviewer, newest first, one page. RLS
 * returns only the rows this account may decide (the ladder above), so the
 * client does no authority filtering of its own; it only leaves out the
 * reviewer's own requests, which nobody may self-approve.
 */
export function useStaffLeaveQueue(opts: { status: LeaveStatus | "all"; page?: number; enabled?: boolean }) {
  const { user } = useAuth();
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const page = opts.page ?? 0;
  return useQuery({
    queryKey: ["staff-leave-queue", institutionId, user?.id, opts.status, page],
    enabled: (opts.enabled ?? true) && !!institutionId && !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<StaffLeaveQueueRow[]> => {
      if (!institutionId || !user?.id) return [];
      const from = page * STAFF_LEAVE_PAGE_SIZE;
      let q = supabase
        .from("staff_leave_requests")
        .select(`${COLS}, requester:profiles!staff_leave_requests_user_id_fkey(full_name)`)
        .eq("institution_id", institutionId)
        .neq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, from + STAFF_LEAVE_PAGE_SIZE - 1);
      if (opts.status !== "all") q = q.eq("status", opts.status);
      const { data, error } = await q;
      if (error) throw error;

      type Raw = StaffLeaveRow & { requester: { full_name: string | null } | { full_name: string | null }[] | null };
      const rows = (data ?? []) as unknown as Raw[];
      const ids = [...new Set(rows.map((r) => r.user_id))];

      // The rung each requester stands on, for the chip beside the name. One
      // bounded read for the page's requesters (at most 20 ids).
      const roleByUser = new Map<string, StaffRole>();
      if (ids.length > 0) {
        const { data: roles, error: rolesError } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("institution_id", institutionId)
          .in("user_id", ids)
          .limit(200);
        if (rolesError) throw rolesError;
        const rank: Record<StaffRole, number> = { teacher: 1, coordinator: 2, admin: 3 };
        for (const r of roles ?? []) {
          const mapped: StaffRole | null =
            r.role === "school_admin" || r.role === "super_school_admin"
              ? "admin"
              : r.role === "coordinator"
                ? "coordinator"
                : r.role === "teacher"
                  ? "teacher"
                  : null;
          if (!mapped) continue;
          const current = roleByUser.get(r.user_id);
          if (!current || rank[mapped] > rank[current]) roleByUser.set(r.user_id, mapped);
        }
      }

      return rows.map(({ requester, ...row }) => ({
        ...row,
        requesterName: pickOne(requester)?.full_name ?? null,
        requesterRole: roleByUser.get(row.user_id) ?? null,
      }));
    },
  });
}

export type StaffLeaveDecision = "approved" | "rejected";

/**
 * Approve or reject. Through `review_staff_leave` when it exists; while the
 * probe says it is missing, a school admin decides with the same direct
 * UPDATE the HR & Payroll panel makes (see the header). No role check here:
 * the buttons are the client's job, the database decides the write (§27),
 * and the re-read is the only success signal (§6).
 *
 * `fromStatus` is the status the button was rendered against. A stale list
 * (another admin decided a minute ago) then updates zero rows instead of
 * silently flipping the other admin's decision, and the re-read explains.
 */
export function useReviewStaffLeave() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      decision: StaffLeaveDecision;
      fromStatus: LeaveStatus;
      notes?: string;
    }) => {
      // 1. The RPC, unless the probe already knows it is missing. A stale
      //    `true` costs one wasted call, never a session: a missing-RPC
      //    answer corrects the cache and falls through.
      const probe = qc.getQueryData<boolean>(STAFF_LEAVE_PROBE_KEY);
      if (probe !== false) {
        const { error } = await callReviewRpc({
          p_request_id: input.requestId,
          p_decision: input.decision,
          p_notes: input.notes ?? null,
        });
        if (!error) return;
        if (!isMissingRpc(error.code)) throw new Error(error.message);
        qc.setQueryData(STAFF_LEAVE_PROBE_KEY, false);
      }

      // 2. Interim direct path. "Admins full access staff leave requests" is
      //    FOR ALL with only USING, so Postgres applies USING as the WITH
      //    CHECK too; the row keeps its institution_id, so an admin's write
      //    passes. The only failure mode is the silent zero-row update when
      //    USING filters the row out, which the re-read below catches.
      //    Writes no on_leave attendance rows and no balances, like HR today.
      if (!user?.id) throw new Error("Please sign in again to record a decision.");
      const { error } = await supabase
        .from("staff_leave_requests")
        .update({
          status: input.decision,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          reviewer_notes: input.notes ?? null,
        })
        .eq("id", input.requestId)
        .eq("status", input.fromStatus)
        .neq("user_id", user.id);
      if (error) throw error;

      const { data, error: checkError } = await supabase
        .from("staff_leave_requests")
        .select("id, status")
        .eq("id", input.requestId)
        .maybeSingle();
      if (checkError) throw checkError;
      if (!data) throw new Error("This request no longer exists, or you can't decide it from here.");
      if (data.status === input.decision) return; // done (a duplicate submit lands here too)
      if (data.status === input.fromStatus) throw new Error("You don't have permission to decide this request.");
      qc.invalidateQueries({ queryKey: ["staff-leave-queue"] });
      throw new Error("Someone else reviewed this request a moment ago. The list has been refreshed.");
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["staff-leave-queue"] });
      qc.invalidateQueries({ queryKey: ["my-staff-leave-requests"] });
      // The HR & Payroll panel lists the same rows under its own key.
      qc.invalidateQueries({ queryKey: ["staff-leave-requests"] });
      // An RPC approval writes on-leave attendance rows for the requester.
      qc.invalidateQueries({ queryKey: ["staff-attendance"] });
      qc.invalidateQueries({ queryKey: ["attendance-list"] });
      toast.success(input.decision === "approved" ? "Leave approved" : "Leave rejected");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't record the decision.", context: "reviewStaffLeave" }),
  });
}
