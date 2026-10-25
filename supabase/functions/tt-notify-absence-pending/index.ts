// -------------------------------------------------------------
// tt-notify-absence-pending: RETIRED 2026-09-25
//
// It was meant to run nightly: for every covered period whose date had
// passed, flip the original teacher's lesson plan from 'planned' to
// 'pending' and notify them to "mark it done or reschedule". It was
// never scheduled, and it could not have worked if it had been:
//   * the lesson plan dialog no longer has status controls, so a plan
//     flipped to 'pending' could never be cleared by the teacher;
//   * it swept ALL of tt_substitutions with no status filter, so it
//     would have hit PostgREST's 1,000-row cap (18,984 rows then) and
//     treated uncovered and cancelled rows as covers;
//   * it ran one query per row, and .maybeSingle() on tt_lesson_plans,
//     which is keyed per subject since 2026-09-10, so basket periods
//     would have errored and been skipped.
//
// What it was for now happens directly: tt-notify-substitute tells the
// original teacher their period is covered, and My Week shows
// "Covered by <name>" on that period (tt_my_covers). Coordinator
// backlogs already exclude covered periods (dash5_coord_log_backlog).
//
// Kept deployed as an explicit 410 so a stale schedule fails loudly
// instead of silently rewriting lesson plans.
// -------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error: "tt-notify-absence-pending is retired. Covered periods are shown in My Week and notified by tt-notify-substitute.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
