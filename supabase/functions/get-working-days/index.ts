// supabase/functions/get-working-days/index.ts
//
// Input  : { institution_id, academic_year, month? (1-12) }
// Output : {
//            academic_year,
//            month,                              // echo of input (or null)
//            range: { start, end },              // ISO dates covered
//            working_days: string[],             // ISO dates, Mon-Sat by default,
//                                                //   minus holidays/exam_blocks
//            holidays:    string[],
//            exam_blocks: string[],
//            total_working_days: number,
//            total_holidays: number,
//            total_exam_block_days: number,
//          }
//
// Used by the timetable module — only working_days get timetable
// slots; holidays + exam_blocks auto-grey the grid.
//
// Rules:
//   * Academic year spans Apr 1 of the first year → Mar 31 of the
//     second year (e.g. "2025-26" ⇒ 2025-04-01 … 2026-03-31).
//   * Sundays are always non-working. Saturdays are also treated
//     as non-working by default (Indian school convention for
//     CBSE/ICSE alternate-saturdays can be overridden by explicitly
//     inserting `working_day` rows on those dates).
//   * A date is a working day if the weekday is Mon–Fri AND it is
//     not covered by a holiday/exam_block span, OR if the calendar
//     explicitly has a `working_day` event_type row for it
//     (manual override that beats the weekend rule).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  institution_id: string;
  academic_year: string; // "YYYY-YY"
  month?: number;        // 1 - 12
}

interface CalendarRow {
  date: string;
  end_date: string | null;
  event_type:
    | "working_day"
    | "holiday"
    | "exam_block"
    | "term_start"
    | "term_end"
    | "ptm"
    | "special_event";
}

function parseAcademicYear(year: string): { start: Date; end: Date } {
  // "2025-26" → Apr 1 2025 ... Mar 31 2026
  const [startYearStr, endYearSuffix] = year.split("-");
  const startYear = parseInt(startYearStr, 10);
  if (!startYear || isNaN(startYear)) {
    throw new Error(`Invalid academic_year format: "${year}" — expected "YYYY-YY"`);
  }
  const endYear =
    endYearSuffix && endYearSuffix.length === 2
      ? Math.floor(startYear / 100) * 100 + parseInt(endYearSuffix, 10)
      : startYear + 1;
  return {
    start: new Date(Date.UTC(startYear, 3, 1)),      // Apr 1
    end:   new Date(Date.UTC(endYear,   2, 31)),     // Mar 31
  };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function enumerateDates(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    out.push(toIsoDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function expandSpan(row: CalendarRow): string[] {
  const start = new Date(row.date + "T00:00:00Z");
  const end = new Date((row.end_date ?? row.date) + "T00:00:00Z");
  return enumerateDates(start, end);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth + institution-scoping gate: previously this function ran with
    // service-role credentials and trusted the caller's institution_id —
    // anyone could query any institution's calendar by guessing UUIDs.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const jwt = authHeader.slice("Bearer ".length);
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: userData, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = (await req.json()) as Body;
    const { institution_id, academic_year, month } = body;

    if (!institution_id || !academic_year) {
      return new Response(
        JSON.stringify({ error: "institution_id and academic_year are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller belongs to the requested institution (or is super_admin).
    const { data: profileRow } = await anonClient
      .from("profiles")
      .select("institution_id")
      .eq("id", userData.user.id)
      .maybeSingle();
    const { data: roleRows } = await anonClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .limit(10);
    const isSuperAdmin = (roleRows ?? []).some((r) => r.role === "super_admin");
    if (!isSuperAdmin && profileRow?.institution_id !== institution_id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { start: ayStart, end: ayEnd } = parseAcademicYear(academic_year);

    // Narrow to a specific month within the academic year if provided.
    let rangeStart = ayStart;
    let rangeEnd = ayEnd;
    if (month && month >= 1 && month <= 12) {
      const monthYear =
        month >= 4 ? ayStart.getUTCFullYear() : ayStart.getUTCFullYear() + 1;
      rangeStart = new Date(Date.UTC(monthYear, month - 1, 1));
      rangeEnd = new Date(Date.UTC(monthYear, month, 0));   // last day of month
    }

    // Read from cal_events (new schema). Column mapping:
    //   starts_on/ends_on ← date/end_date (ends_on never null)
    //   kind              ← event_type (holiday / exam_block only;
    //                        working_day + term_start/end + ptm dropped
    //                        in the rebuild, collapsed into 'event')
    const { data: rows, error } = await supabase
      .from("cal_events")
      .select("starts_on, ends_on, kind")
      .eq("institution_id", institution_id)
      .eq("academic_year", academic_year)
      .lte("starts_on", toIsoDate(rangeEnd))
      .gte("ends_on", toIsoDate(rangeStart));

    if (error) throw error;

    const holidays = new Set<string>();
    const examBlocks = new Set<string>();
    // 'working_day' override rows no longer exist in the rebuilt
    // schema; this set stays empty. Weekend rule below is the only
    // override source.
    const explicitWorkingDays = new Set<string>();

    type CalEventRow = { starts_on: string; ends_on: string; kind: string };
    for (const row of (rows ?? []) as CalEventRow[]) {
      const dates = expandSpan({
        date: row.starts_on,
        end_date: row.ends_on,
        event_type: row.kind,
      });
      for (const d of dates) {
        if (d < toIsoDate(rangeStart) || d > toIsoDate(rangeEnd)) continue;
        if (row.kind === "holiday")         holidays.add(d);
        else if (row.kind === "exam_block") examBlocks.add(d);
        // 'event' rows (ex-PTM / ex-special_event) never change
        // working-day status.
      }
    }

    const allDates = enumerateDates(rangeStart, rangeEnd);
    const workingDays: string[] = [];

    for (const iso of allDates) {
      const dow = new Date(iso + "T00:00:00Z").getUTCDay(); // 0 Sun ... 6 Sat
      const isWeekend = dow === 0 || dow === 6;
      const isBlocked = holidays.has(iso) || examBlocks.has(iso);
      const isExplicit = explicitWorkingDays.has(iso);

      if (isExplicit) {
        workingDays.push(iso);
      } else if (!isWeekend && !isBlocked) {
        workingDays.push(iso);
      }
    }

    return new Response(
      JSON.stringify({
        academic_year,
        month: month ?? null,
        range: { start: toIsoDate(rangeStart), end: toIsoDate(rangeEnd) },
        working_days: workingDays,
        holidays: Array.from(holidays).sort(),
        exam_blocks: Array.from(examBlocks).sort(),
        total_working_days: workingDays.length,
        total_holidays: holidays.size,
        total_exam_block_days: examBlocks.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("get-working-days error:", err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
