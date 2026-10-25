import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

/**
 * Support intake health, for SALCI's inbox.
 *
 * Exists because of the 2026-09-02 incident: the SALCI Support container
 * institution was deleted during a cleanup and every submission failed for
 * seven days with an error that only the reporter ever saw. Failed intakes left
 * no row anywhere, so nothing on SALCI's side changed.
 *
 * Three pieces close that gap:
 *   - `support_health()` is one read the inbox renders as a banner;
 *   - `reportSupportIntakeFailure()` sends a hard client-side failure to the
 *     server as a `support_health_events` row (never blocking, never surfaced
 *     to the reporter as a second error);
 *   - `support_backfill_mirror_tasks()` re-links open tickets to the tasks
 *     plane after a container loss.
 */

export type SupportHealthStatus = "ok" | "degraded" | "down";

export interface SupportHealthEvent {
  kind: string;
  detail: string | null;
  ticket_id: string | null;
  at: string;
}

export interface SupportHealth {
  status: SupportHealthStatus;
  institution_ok: boolean;
  institution_id: string | null;
  owner_ok: boolean;
  owner_id: string | null;
  last_intake_at: string | null;
  intakes_24h: number;
  failures_24h: number;
  degraded_7d: number;
  open_tickets_without_task: number;
  recent_events: SupportHealthEvent[];
}

export function useSupportHealth(enabled = true) {
  return useQuery({
    queryKey: ["support-health"],
    queryFn: async (): Promise<SupportHealth> => {
      const { data, error } = await supabase.rpc("support_health");
      if (error) throw error;
      return data as unknown as SupportHealth;
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useBackfillSupportMirrors() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("support_backfill_mirror_tasks");
      if (error) throw error;
      return data as unknown as { created: number; failed: number };
    },
    onSuccess: (result) => {
      const created = result?.created ?? 0;
      const failed = result?.failed ?? 0;
      toast.success(
        created > 0
          ? `Re-linked ${created} support request${created === 1 ? "" : "s"} to tasks`
          : "Every open support request already has a task",
        {
          description:
            failed > 0 ? `${failed} could not be re-linked. See the health events.` : undefined,
        },
      );
      for (const key of [
        "support-health",
        "support-inbox",
        "support-inbox-counts",
        "support-inbox-stats",
        "support-inbox-ticket",
        "my-tasks",
        "tasks-assigned-by-me",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't re-link support requests.",
        context: "supportBackfillMirrorTasks",
      }),
  });
}

/**
 * Fire-and-forget. Called from the intake mutation's onError so a failure the
 * reporter sees also becomes a row SALCI can see. Swallows its own errors: a
 * telemetry failure must never become a second toast on a screen that already
 * has one.
 */
export function reportSupportIntakeFailure(stage: string, error: unknown, pageUrl?: string): void {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
  void Promise.resolve(
    supabase.rpc("log_support_intake_failure", {
      p_stage: stage.slice(0, 40),
      p_error: message.slice(0, 500),
      p_page_url: pageUrl?.slice(0, 300),
    }),
  ).then(
    () => undefined,
    () => undefined,
  );
}
