import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import {
  ESCALATION_MARKER,
  formatEscalationClearedNote,
  formatEscalationNote,
  parseEscalationNote,
  type EscalationMark,
} from "@/lib/supportEscalation";

/**
 * Reading and writing the escalation mark. The mark itself, and why it lives
 * in an internal message rather than on the ticket row, are in
 * src/lib/supportEscalation.ts.
 */

/** One bounded scan covers far more escalations than the inbox has tickets. */
const ESCALATION_SCAN_RANGE: [number, number] = [0, 499];
const ESCALATION_STALE_TIME = 60_000;

/**
 * A Map on purpose, and knowingly: queryPersist refuses Set/Map results rather
 * than flattening them to `{}` (the 2026-09-18 attendance bug), so this query
 * is simply never restored from localStorage and refetches after a reload.
 * That is the right trade for a mark that changes during a shift.
 */
export type EscalationMap = Map<string, EscalationMark>;

export interface SupportEscalations {
  /** The current mark per ticket. */
  marks: EscalationMap;
  /**
   * Every name escalated to before, newest first. Most of the technical team
   * hold no super admin account and some hold no account at all, so the picker
   * cannot be the super admin list alone. A name typed once comes back here for
   * everyone, with nowhere new to store it.
   */
  names: string[];
}

/**
 * Every ticket's current mark, in ONE read rather than one per ticket: the
 * newest escalation note per ticket, newest first, so the first row seen for a
 * ticket wins and everything older is history. A withdrawn mark leaves the
 * ticket out of the map without letting the mark before it come back.
 *
 * Super admins only: `support_messages` lets the reporter read their own
 * ticket's PUBLIC rows only, so this returns nothing for anyone else. Callers
 * pass `enabled` rather than relying on an empty result.
 */
export function useSupportEscalations(enabled = true) {
  return useQuery({
    queryKey: ["support-escalations"],
    queryFn: async (): Promise<SupportEscalations> => {
      const { data, error } = await supabase
        .from("support_messages")
        .select("ticket_id, body, created_at")
        .eq("is_internal", true)
        .like("body", `${ESCALATION_MARKER}%`)
        .order("created_at", { ascending: false })
        .range(...ESCALATION_SCAN_RANGE);
      if (error) throw error;

      const marks: EscalationMap = new Map();
      const seen = new Set<string>();
      const names: string[] = [];
      for (const row of data ?? []) {
        const parsed = parseEscalationNote(row.body);
        if (parsed === null) continue;
        // The newest row per ticket wins; the rest are history. Names come from
        // the history too, so someone escalated to and then cleared is still
        // one tap away next time.
        if (parsed !== "cleared") {
          if (!names.includes(parsed.staffName)) names.push(parsed.staffName);
          if (!seen.has(row.ticket_id)) marks.set(row.ticket_id, parsed);
        }
        seen.add(row.ticket_id);
      }
      return { marks, names };
    },
    enabled,
    staleTime: ESCALATION_STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

export interface SetEscalationInput {
  ticketId: string;
  /** The whole mark, or null to withdraw it. Never a partial update. */
  mark: EscalationMark | null;
}

/**
 * Writes the mark as an internal note through `post_support_message`, the
 * single write path for anything in the thread. One write, never two: the
 * ticket's status is deliberately left alone, because moving it as well would
 * be two dependent writes and would need an RPC (CLAUDE.md section 9a).
 *
 * The whole mark is rewritten every time, so saving the same thing twice
 * changes nothing. The caller's `isPending` is the single-flight guard; the
 * RPC also throttles a caller at 30 messages an hour.
 */
export function useSetEscalation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, mark }: SetEscalationInput) => {
      const { error } = await supabase.rpc("post_support_message", {
        p_ticket_id: ticketId,
        p_body: mark ? formatEscalationNote(mark) : formatEscalationClearedNote(),
        p_is_internal: true,
        p_client_token: crypto.randomUUID(),
      });
      if (error) throw error;
      return mark;
    },
    onSuccess: (mark, variables) => {
      toast.success(mark ? `Escalated to ${mark.staffName}` : "Escalation cleared");
      queryClient.invalidateQueries({ queryKey: ["support-escalations"] });
      queryClient.invalidateQueries({ queryKey: ["support-thread", variables.ticketId] });
      for (const key of ["support-inbox", "support-inbox-ticket"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't update who is working on this request.",
        context: "setSupportEscalation",
      }),
  });
}
