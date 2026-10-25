import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { DASHBOARD_ACTIONS_KEY } from "@/lib/dashboardActionsKey";

/**
 * Shared plumbing for the two places a substitute gets assigned:
 *   * the class workspace's Substitute mode (`useUpsertSubstitution`), and
 *   * the Attendance page's Substitutions tab (`useAssignSubstitute`, via the
 *     `tt_assign_substitute` RPC).
 *
 * They used to carry their own invalidation lists and only the first one sent
 * the notification, so a cover assigned from the Substitutions tab (the main
 * auto-flow path) never told the substitute they were covering anything.
 */

/** Today in the browser's local calendar, as yyyy-mm-dd (not UTC). */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Every query that reads tt_substitutions. A cover written from one surface
 * must clear the others, or the coordinator's "Periods needing substitution"
 * list keeps showing a period that was just covered.
 */
export function invalidateSubstitutionCaches(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["timetable-v2", "substitutions"] });
  queryClient.invalidateQueries({ queryKey: ["substitutions"] });
  queryClient.invalidateQueries({ queryKey: ["dash5", "coord", "cover"] });
  // the dashboard's substitution card (useMyDashboardActions)
  queryClient.invalidateQueries({ queryKey: DASHBOARD_ACTIONS_KEY });
}

/**
 * Fire-and-forget in-app notification to the substitute and the original
 * teacher. The substitution itself is already saved, so a failure here only
 * warns the admin to message them directly.
 *
 * supabase.functions.invoke RESOLVES with {data, error} on non-2xx; it does
 * NOT reject, so the real error body is pulled off error.context.
 */
export function notifySubstituteAssigned(substitutionId: string): void {
  void (async () => {
    const { error: notifyErr } = await supabase.functions.invoke(
      "tt-notify-substitute",
      { body: { substitution_id: substitutionId } },
    );
    if (!notifyErr) return;
    let msg = notifyErr.message ?? "Notification failed";
    const ctx = (notifyErr as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === "function") {
      try {
        const body = await (ctx as Response).clone().json();
        if (
          body && typeof body === "object" &&
          typeof (body as { error?: unknown }).error === "string"
        ) {
          msg = (body as { error: string }).error;
        }
      } catch {
        // body wasn't JSON, keep the generic message
      }
    }
    console.warn("[tt-notify-substitute] failed:", msg);
    toast.warning(
      "Substitute saved, but the notification didn't send. You may need to message them directly.",
    );
  })();
}
