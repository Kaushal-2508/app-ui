import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { reportSupportIntakeFailure } from "@/hooks/useSupportHealth";

/**
 * Salci Support tickets are real `tasks` rows, but they are created through a
 * SECURITY DEFINER RPC rather than a client insert, for two reasons:
 *
 *   - `can_create_tasks()` excludes students and super admins, and students are
 *     the majority of real reporters;
 *   - the `tasks` INSERT policy pins `institution_id` to the caller's own
 *     school, so the row could never land in the SALCI Support institution.
 *
 * The reporter is recorded as the ASSIGNER (so the ticket shows under
 * "Assigned BY Me"), while a RESTRICTIVE policy plus a guard trigger stop them
 * changing, cancelling or deleting it.
 *
 * Design: docs/superpowers/specs/2026-08-14-salci-support-task-design.md
 */

export const SUPPORT_CATEGORIES = [
  "Exams",
  "Attendance",
  "Homework",
  "Login and access",
  "Results",
  "Something else",
] as const;

/**
 * Same 1..3 scale the Assign Task dialog writes, so a support ticket carries
 * the same priority semantics as any other task.
 */
export const SUPPORT_URGENCIES = [
  { value: "1", label: "Low" },
  { value: "2", label: "Medium" },
  { value: "3", label: "High" },
] as const;

export interface SupportRequestInput {
  subject: string;
  description: string;
  category: string;
  priority: number;
  pageUrl?: string;
}

export function useCreateSupportRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SupportRequestInput) => {
      const { data, error } = await supabase.rpc("create_support_task", {
        p_subject: input.subject,
        p_description: input.description,
        p_category: input.category,
        p_priority: input.priority,
        p_page_url: input.pageUrl,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Support request sent", {
        description: "SALCI has it. Track it and reply under Salci Support.",
      });
      // The copy names the DESTINATION, not "this page": SupportRequestSheet is
      // mounted from two places, SupportPage (/support) and the Salci Support
      // chip in the TasksPage header, and /tasks has no reply surface. Naming
      // the sidebar entry is true from both.
      //
      // /support is the reporter's tracking surface now, so a ticket raised
      // behind that sheet must appear in the list underneath immediately. The
      // task plane still exists (the ticket is also a `tasks` row assigned to
      // the support owner), so the legacy "Assigned BY Me" list is invalidated
      // too, which is what keeps the /tasks mount correct.
      queryClient.invalidateQueries({ queryKey: ["support-my-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-assigned-by-me"] });
    },
    onError: (error: Error) => {
      // A failure the reporter sees must also become a row SALCI can see. On
      // 2026-09-02 intake died for seven days and nothing recorded it: a failed
      // RPC leaves no row, and the error lived only on the reporter's screen.
      reportSupportIntakeFailure("create_support_task", error, window.location.pathname);
      toastError(error, {
        fallback: "Couldn't send your support request.",
        context: "createSupportTask",
      });
    },
  });
}

export interface ResolveSupportInput {
  taskId: string;
  outcome: "completed" | "rejected";
  note?: string;
}

export function useResolveSupportRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, outcome, note }: ResolveSupportInput) => {
      const { error } = await supabase.rpc("resolve_support_task", {
        p_task_id: taskId,
        p_outcome: outcome,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: (_result, variables) => {
      toast.success(
        variables.outcome === "completed"
          ? "Support request resolved"
          : "Support request closed",
      );
      // resolve_support_task now routes through _support_apply_status, so it
      // moves the ticket, writes a kind='system' message and notifies the
      // reporter. Every support surface is stale afterwards, not just /tasks.
      for (const key of [
        "my-tasks",
        "tasks-assigned-by-me",
        "task-detail",
        "support-inbox",
        "support-inbox-counts",
        "support-inbox-stats",
        "support-inbox-ticket",
        "support-thread",
        "support-my-tickets",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't update this support request.",
        context: "resolveSupportTask",
      }),
  });
}

/**
 * Id of the SALCI Support institution, used to tell a support ticket apart
 * from an ordinary task. Effectively static, so it is cached hard rather than
 * refetched: one row, one value, changes never.
 */
export function useSupportInstitutionId() {
  return useQuery({
    queryKey: ["support-institution-id"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_support_institution_id");
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}