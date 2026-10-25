import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { SUPPORT_PRIORITY_LABEL, type SupportPriority } from "@/lib/supportSop";

/**
 * The two things the Support Executive records on a ticket under the
 * Ticket Resolution SOP: its priority (P1 / P2 / P3 / Enhancement) and, when
 * it has been handed to a technical team member, who that is. The "escalated
 * to" mark is a reminder of who is working on it; the actual task is raised
 * by hand in Task Management and is not linked from here.
 *
 * Both live in columns Tushar adds to reported_issues (NEEDS DB, spec
 * docs/superpowers/specs/2026-09-18-support-sop-design.md). Until they exist
 * `useSupportSopReady()` is false and the controls stay hidden, so the inbox
 * keeps working exactly as before.
 */

type PgError = { message: string; code?: string };

/** The SOP columns on reported_issues, as the client reads and writes them. */
export interface SopTicketColumns {
  triage_priority: SupportPriority | null;
  triaged_at: string | null;
  escalated_to: string | null;
  escalated_to_name: string | null;
  escalated_at: string | null;
}

// reported_issues' generated type predates these columns; this narrow view of
// the client is the one place that names them (the pushDevices.ts pattern).
type SopClient = {
  from(table: "reported_issues"): {
    select(columns: "id, triage_priority"): { limit(n: number): PromiseLike<{ error: PgError | null }> };
    update(values: Partial<SopTicketColumns>): {
      eq(column: "id", value: string): { select(columns: "id"): PromiseLike<{ data: { id: string }[] | null; error: PgError | null }> };
    };
  };
};
const sopClient = supabase as unknown as SopClient;

function isMissingColumnError(error: PgError | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist/i.test(error.message);
}

/**
 * Feature probe: do the SOP columns exist yet? One bounded read of one column,
 * cached for the session. "Column does not exist" is the expected NO; any
 * other failure is also NO, because the inbox must never break on the probe.
 * Super admins only (the table's SELECT policy), so callers pass `enabled`.
 */
export function useSupportSopReady(enabled = true) {
  return useQuery({
    queryKey: ["support-sop-ready"],
    queryFn: async (): Promise<boolean> => {
      const { error } = await sopClient.from("reported_issues").select("id, triage_priority").limit(1);
      if (!error) return true;
      return isMissingColumnError(error) ? false : false;
    },
    enabled,
    // A schema change is a deploy, not a minute-by-minute event.
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export interface SalciStaffMember {
  id: string;
  name: string;
  email: string | null;
}

/**
 * The SALCI team a ticket can be escalated to: every super admin. Two bounded
 * reads a super admin is already allowed (user_roles, then profiles), the same
 * shape UsersPage uses. Sorted by name.
 */
export function useSalciStaff(enabled = true) {
  return useQuery({
    queryKey: ["support-salci-staff"],
    queryFn: async (): Promise<SalciStaffMember[]> => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "super_admin")
        .limit(200);
      if (rolesError) throw rolesError;
      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (ids.length === 0) return [];
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids)
        .limit(200);
      if (profilesError) throw profilesError;
      return (profiles ?? [])
        .map((p) => ({ id: p.id, name: p.full_name?.trim() || p.email || "SALCI team member", email: p.email }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface SetTicketTriageInput {
  ticketId: string;
  priority?: SupportPriority | null;
  /** null clears the mark; undefined leaves it alone. */
  escalatedTo?: { id: string; name: string } | null;
}

/**
 * Writes the priority and/or the "escalated to" mark. A direct UPDATE under
 * the table's existing super-admin UPDATE policy: no thread row, no
 * notification, because neither is a message to the reporter. Idempotent
 * (setting the same value twice is a no-op), and the row is re-selected so an
 * RLS-blocked update reads as the error it is, not as success (§6).
 */
export function useSetTicketTriage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, priority, escalatedTo }: SetTicketTriageInput) => {
      const now = new Date().toISOString();
      const values: Partial<SopTicketColumns> = {};
      if (priority !== undefined) {
        values.triage_priority = priority;
        values.triaged_at = priority ? now : null;
      }
      if (escalatedTo !== undefined) {
        values.escalated_to = escalatedTo?.id ?? null;
        values.escalated_to_name = escalatedTo?.name ?? null;
        values.escalated_at = escalatedTo ? now : null;
      }
      const { data, error } = await sopClient.from("reported_issues").update(values).eq("id", ticketId).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("This request could not be updated.");
      return values;
    },
    onSuccess: (values, variables) => {
      if (variables.priority !== undefined) {
        toast.success(
          variables.priority ? `Priority set to ${SUPPORT_PRIORITY_LABEL[variables.priority]}` : "Priority cleared",
        );
      }
      if (variables.escalatedTo !== undefined) {
        toast.success(variables.escalatedTo ? `Escalated to ${variables.escalatedTo.name}` : "Escalation cleared");
      }
      for (const key of ["support-inbox", "support-inbox-ticket", "support-inbox-stats"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      return values;
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't update this support request.",
        context: "setSupportTicketTriage",
      }),
  });
}
