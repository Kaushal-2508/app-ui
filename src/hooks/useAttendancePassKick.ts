import { useEffect } from "react";
import { format } from "date-fns";

import { useRunAttendancePass } from "@/hooks/useRunAttendancePass";

/** One sessionStorage flag per school per day, shared by Workday and the dashboards. */
export function attendancePassKey(institutionId: string, now: Date = new Date()): string {
  return `salci:att-pass:${institutionId}:${format(now, "yyyy-MM-dd")}`;
}

export interface AttendancePassKickOptions {
  /**
   * Wait a random 20 to 60 s first. Every admin and coordinator dashboard of a school turns
   * due at the same cutoff, which is also a 15-minute cron tick, and two passes for one
   * school at once can collide on UNIQUE(staff_id, date): the pass's absent-row insert has
   * no ON CONFLICT (20260925140000), so the loser raises 23505.
   */
  spread?: boolean;
  /** No error toast: the kick ran without the person asking, and the cron is the safety net. */
  quiet?: boolean;
}

/**
 * Runs tt_run_attendance_pass_for_institution once per browser session per school per day
 * once `due` turns true, instead of waiting up to 15 minutes for the cron: today's
 * auto-absent staff rows and pending substitutions then exist when an admin or coordinator
 * looks. Callers decide `due` (admin or coordinator view, past the cutoff); the server
 * refuses everyone else with 42501, so never pass true for a teacher view.
 *
 * The flag is set right before the call; if the call fails the flag stays and the cron is
 * the safety net. Storage that throws (a locked-down WebView, a private window) skips the
 * kick for the same reason.
 */
export function useAttendancePassKick(
  institutionId: string | null,
  due: boolean,
  opts: AttendancePassKickOptions = {},
): void {
  // `mutate` is referentially stable across renders (TanStack Query).
  const { mutate: runPass } = useRunAttendancePass({ quiet: opts.quiet === true });
  const spread = opts.spread === true;
  useEffect(() => {
    if (!due || !institutionId) return;
    const fire = () => {
      const key = attendancePassKey(institutionId);
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        return;
      }
      runPass(institutionId);
    };
    if (!spread) {
      fire();
      return;
    }
    const id = window.setTimeout(fire, 20_000 + Math.floor(Math.random() * 40_000));
    return () => window.clearTimeout(id);
  }, [due, institutionId, spread, runPass]);
}
