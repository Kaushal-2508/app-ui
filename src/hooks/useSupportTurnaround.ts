import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { workingSecondsBetween, WORKING_HOURS_PER_DAY } from "@/lib/workingHours";
import { useSupportStatsSince } from "@/hooks/useReportedIssues";

/**
 * Turnaround on the SOP's clock, not the wall clock.
 *
 * The Ticket Resolution SOP measures a ticket over working hours only, 10:00 to
 * 18:00, Monday to Saturday: "a student ticket filed at 20:30 and closed at
 * 10:15 is a 15-minute ticket, not a 14-hour one". `support_inbox_stats` counts
 * calendar hours instead, so its `tat_*` keys read three days where the desk saw
 * three hours, and they disagree with the row ages on the same page, which have
 * been on the working clock since the SOP shipped.
 *
 * Scale Gate item 2, stated rather than skipped: this is the one aggregate in
 * the module computed from rows on the client. A working-hours median cannot be
 * expressed in the existing RPC without `support_working_seconds()` in SQL,
 * which is a database change (spec 2026-09-18 §4.3, NEEDS DB). Until that
 * lands, the cohort is held to two bounded reads of a small table: 60 days of
 * finished tickets, hard-capped at 500 rows, against roughly 22 resolutions a
 * month in production. When the SQL twin exists this hook is deleted and the
 * card reads the RPC again.
 */

/** Rows scanned at most. A WHERE clause is not a bound (CLAUDE.md §23). */
const TURNAROUND_RANGE: [number, number] = [0, 499];
const TURNAROUND_STALE_TIME = 60_000;
const DAY_MS = 86_400_000;

/** One working week on the desk's calendar: six days of eight hours. */
export const RESOLVE_WITHIN_WORKING_HOURS = WORKING_HOURS_PER_DAY * 6;
/** One working day. */
export const REPLY_WITHIN_WORKING_HOURS = WORKING_HOURS_PER_DAY;

export interface SupportTurnaround {
  /** Median working hours from raised to resolved, last 30 days. */
  resolveMedianWorkingHours: number | null;
  resolveSample: number;
  resolveWithinWeek: number;
  /** The 30 days before that, for the trend line. */
  resolveMedianWorkingHoursPrev: number | null;
  resolveSamplePrev: number;
  /** Median working hours from raised to SALCI's first public reply. */
  firstReplyMedianWorkingHours: number | null;
  firstReplySample: number;
  firstReplyWithinDay: number;
  /** Test-school and SALCI-raised tickets that would otherwise be in a cohort. */
  excluded: number;
  /** True when the inbox is filtered to a school that is itself a test school. */
  institutionIsDemo: boolean;
}

/** percentile_cont(0.5): the middle value, or the mean of the middle two. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function workingHoursBetween(from: string, to: string): number {
  return workingSecondsBetween(from, to) / 3600;
}

/**
 * The same cohorts `support_inbox_stats` uses, measured on the working clock.
 * A ticket counts as school-raised when its reporter is not a super admin AND
 * its institution is not flagged `is_demo`; the resolve cohort is keyed on
 * `resolved_at` and takes status 'resolved' only, because `_support_apply_status`
 * stamps `resolved_at` on closed tickets too and a bulk close would otherwise
 * read as a burst of resolutions.
 */
export function useSupportTurnaround(
  institutionId: string | null,
  role: string | null,
  enabled = true,
) {
  const { data: since = null, isPending: sincePending } = useSupportStatsSince();
  return useQuery({
    queryKey: ["support-turnaround", institutionId, role, since],
    queryFn: async (): Promise<SupportTurnaround> => {
      const now = Date.now();
      const since30 = new Date(now - 30 * DAY_MS).toISOString();
      const since60 = new Date(now - 60 * DAY_MS).toISOString();

      const [staffRes, demoRes] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "super_admin").limit(200),
        supabase.from("institutions").select("id").eq("is_demo", true).limit(200),
      ]);
      if (staffRes.error) throw staffRes.error;
      if (demoRes.error) throw demoRes.error;
      const salciIds = new Set((staffRes.data ?? []).map((r) => r.user_id));
      const demoIds = new Set((demoRes.data ?? []).map((r) => r.id));

      let query = supabase
        .from("reported_issues")
        .select("id, status, created_at, resolved_at, first_response_at, reporter_id, institution_id")
        // Everything that can fall in either cohort, and nothing else.
        .or(`resolved_at.gte.${since60},first_response_at.gte.${since30}`)
        .range(...TURNAROUND_RANGE);
      // The reporting cutoff, the same one the cards beside this one obey.
      // A second .or() is ANDed with the cohort one above, which is what we
      // want: (in a cohort) AND (after the cutoff OR pinned).
      if (since) query = query.or(`created_at.gte.${since},pinned_to_inbox.is.true`);
      if (institutionId) query = query.eq("institution_id", institutionId);
      if (role) query = query.eq("reporter_role", role);

      const { data, error } = await query;
      if (error) throw error;

      const resolve: number[] = [];
      const resolvePrev: number[] = [];
      const reply: number[] = [];
      let resolveWithinWeek = 0;
      let firstReplyWithinDay = 0;
      let excluded = 0;

      for (const row of data ?? []) {
        const schoolRaised =
          !(row.reporter_id && salciIds.has(row.reporter_id)) &&
          !(row.institution_id && demoIds.has(row.institution_id));

        const resolvedIn30 =
          row.status === "resolved" && Boolean(row.resolved_at) && row.resolved_at! >= since30;
        const resolvedInPrev30 =
          row.status === "resolved" &&
          Boolean(row.resolved_at) &&
          row.resolved_at! >= since60 &&
          row.resolved_at! < since30;
        const repliedIn30 = Boolean(row.first_response_at) && row.first_response_at! >= since30;

        if (!schoolRaised) {
          if (resolvedIn30 || repliedIn30) excluded += 1;
          continue;
        }

        if (resolvedIn30) {
          const hours = workingHoursBetween(row.created_at, row.resolved_at!);
          resolve.push(hours);
          if (hours <= RESOLVE_WITHIN_WORKING_HOURS) resolveWithinWeek += 1;
        } else if (resolvedInPrev30) {
          resolvePrev.push(workingHoursBetween(row.created_at, row.resolved_at!));
        }

        if (repliedIn30) {
          const hours = workingHoursBetween(row.created_at, row.first_response_at!);
          reply.push(hours);
          if (hours <= REPLY_WITHIN_WORKING_HOURS) firstReplyWithinDay += 1;
        }
      }

      return {
        resolveMedianWorkingHours: median(resolve),
        resolveSample: resolve.length,
        resolveWithinWeek,
        resolveMedianWorkingHoursPrev: median(resolvePrev),
        resolveSamplePrev: resolvePrev.length,
        firstReplyMedianWorkingHours: median(reply),
        firstReplySample: reply.length,
        firstReplyWithinDay,
        excluded,
        institutionIsDemo: Boolean(institutionId && demoIds.has(institutionId)),
      };
    },
    // Hold the first read until the cutoff is known, so the card never shows
    // a median computed over pre-cutoff tickets and then corrects itself.
    enabled: enabled && !sincePending,
    staleTime: TURNAROUND_STALE_TIME,
    refetchOnWindowFocus: false,
  });
}
