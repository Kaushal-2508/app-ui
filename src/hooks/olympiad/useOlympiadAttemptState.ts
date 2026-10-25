import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AttemptState = {
  attempt_id: string;
  status: "in_progress" | "submitted" | "auto_submitted_timer" | "auto_submitted_violation" | "auto_submitted_disconnect";
  remaining_seconds: number;
  expired: boolean;
  proctoring_violations: number;
  section_switches: number;
  submit_reason: string | null;
};

export function useOlympiadAttemptState(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "attempt-state", attemptId],
    queryFn: async (): Promise<AttemptState | null> => {
      if (!attemptId) return null;
      const { data, error } = await supabase.rpc("oly_get_attempt_state", { p_attempt_id: attemptId });
      if (error) throw error;
      return data as AttemptState;
    },
    enabled: !!attemptId,
    // §23.2: refetchInterval=30s justified — keeps client timer synced to server,
    // detects timer expiry for auto-submit trigger. Stops once attempt is closed.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && s !== "in_progress" ? false : 30_000;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,  // always refetch — timer is the hottest data point
  });
}
