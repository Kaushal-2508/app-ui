import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

interface AttendancePassResult {
  institution_id: string;
  staff_marked: number;
  subs_generated: number;
}

/**
 * Materialize today's auto-absent rows + pending substitutions for a
 * single institution. Wraps the DB function
 * `tt_run_attendance_pass_for_institution` which is idempotent
 * (UNIQUE(staff_id,date) + UNIQUE(slot_id,date)).
 *
 * Used by the Workday page (src/pages/staff/WorkdayPage.tsx) to skip the
 * 15-min cron lag when an admin or coordinator opens the staff side past the
 * institution-local cutoff. Cron continues to fire as a fallback.
 */
export function useRunAttendancePass(opts: { quiet?: boolean } = {}) {
  const qc = useQueryClient();
  const quiet = opts.quiet === true;
  return useMutation({
    mutationFn: async (institutionId: string): Promise<AttendancePassResult[]> => {
      const { data, error } = await supabase.rpc(
        "tt_run_attendance_pass_for_institution" as never,
        { p_institution_id: institutionId } as never,
      );
      if (error) throw error;
      return (data ?? []) as AttendancePassResult[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-list"] });
      qc.invalidateQueries({ queryKey: ["substitutions"] });
      qc.invalidateQueries({ queryKey: ["staff-attendance"] });
    },
    onError: (err: Error) => {
      // The dashboard's kick runs without the person asking and the 15-minute cron is the
      // safety net, so it only logs; Workday's kick still says so on screen.
      if (quiet) {
        console.warn("[attendance pass]", err.message);
        return;
      }
      toastError(err, { fallback: "Couldn't sync attendance.", context: "runAttendancePass" });
    },
  });
}
