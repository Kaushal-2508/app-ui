import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type EventType =
  | "section_switch" | "flag" | "unflag"
  | "proctoring_violation_fullscreen" | "proctoring_violation_tab_switch"
  | "disconnect" | "reconnect" | "auto_save";

export type RecordEventResult = { ok: true; total_violations?: number; attempt_closed?: boolean };

export function useOlympiadRecordEvent() {
  return useMutation({
    mutationFn: async (input: { attempt_id: string; event_type: EventType; payload?: Record<string, unknown> }): Promise<RecordEventResult> => {
      const { data, error } = await supabase.rpc("oly_record_event", {
        p_attempt_id: input.attempt_id,
        p_event_type: input.event_type,
        p_payload: (input.payload ?? {}) as Json,
      });
      if (error) throw error;
      return data as RecordEventResult;
    },
    // Fire-and-forget — telemetry failures shouldn't block exam UX
    retry: 0,
  });
}
