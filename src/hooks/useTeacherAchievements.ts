import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
// Local use; the re-export below is what callers import. A bare `export type
// { ... } from` does not bind the name inside this module.
import type { TeacherAchievements } from "@/components/achievements/teacher/teacherTypes";

/**
 * Teacher achievements: the read side of the teacher badge set.
 *
 * The deliberate mirror of `useStudentAchievements`, with one shape difference
 * that is not an oversight: there is NO STREAK. Students have an activity spine
 * (`student_activity_days`) that makes "14 day streak" a measured fact; teachers
 * have none, so the key is absent rather than present-and-zero. A zero streak is
 * a claim, a missing streak is the truth.
 *
 * Shapes are declared here rather than imported from
 * `@/components/achievements/types`: that module is the STUDENT vocabulary
 * (categories `streak_ranks` | `quest_log` | ...), and reusing it would let a
 * teacher badge typecheck against a category that cannot exist in the teacher
 * catalog.
 */

/* ────────────────────────────────────────────────────────────────────────
   Vocabulary

   Every name below is the LOCKED teacher catalog. A previous parallel build
   had two agents invent different metric names and twelve badges became
   permanently un-awardable, so the metric list is exported as a typed constant
   and nothing should reach for a string literal that is not in it.
   ──────────────────────────────────────────────────────────────────────── */

/** `badge_definitions.tier` values present in the teacher catalog. */
export type TeacherBadgeTier = "bronze" | "silver" | "gold" | "platinum";

/**
 * The rank shown in the header. Shares `badge_rank_for_points()` with students
 * so "gold" means the same thing on every surface, which is why it reaches one
 * rung higher than any single teacher badge tier.
 */
export type TeacherRank = TeacherBadgeTier | "diamond";

/** `badge_definitions.category` values for the teacher set. Exactly five. */
export type TeacherBadgeCategory =
  | "classroom"
  | "assessment"
  | "marking"
  | "homework"
  | "teamwork";

/**
 * Categories in catalog order (display_order 210, 220, 230, 240, 250), so a
 * grouped view does not have to invent an ordering or derive one from the
 * badges it happens to have loaded.
 */
export const TEACHER_BADGE_CATEGORIES: readonly TeacherBadgeCategory[] = [
  "classroom",
  "assessment",
  "marking",
  "homework",
  "teamwork",
];

/**
 * The seven metrics are declared ONCE, in
 * `@/components/achievements/teacher/teacherTypes`, and re-exported here so a
 * caller can reach them from either side.
 *
 * They are not redeclared. Two copies of a metric list is precisely how the
 * first parallel build left twelve badges permanently un-awardable: both copies
 * typecheck, both look authoritative, and they only disagree once somebody edits
 * one of them. teacherTypes.ts owns them because it also binds them to
 * `CumulativeMetric` at compile time, and because it carries no react-query
 * import, so a component reading the list does not pull the query client into
 * its chunk (§23).
 */
export type { TeacherMetric } from "@/components/achievements/teacher/teacherTypes";
export {
  TEACHER_METRIC_LIST,
  isTeacherMetric,
} from "@/components/achievements/teacher/teacherTypes";

/* ────────────────────────────────────────────────────────────────────────
   Payload shapes
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The badge row and the payload envelope are declared once, alongside the
 * components that render them, and re-exported here. Same reason as the metric
 * list above: a second structurally-compatible copy typechecks fine right up to
 * the day the two disagree.
 *
 * `TeacherBadgeShape` is aliased to `TeacherBadge` for callers that read more
 * naturally that way.
 */
export type {
  TeacherAchievements,
  TeacherBadgeShape,
  TeacherBadgeShape as TeacherBadge,
} from "@/components/achievements/teacher/teacherTypes";

/** One entry of `teacher_badge_rarity()`, keyed by badge id. */
export interface TeacherBadgeRarity {
  holders: number;
  /** Percent of TEACHERS in the same institution, or null when the cohort is empty. */
  percent: number | null;
}

/**
 * Everything the teacher achievements surface renders, in ONE round trip.
 *
 * Catalog, earned rows, progress, points and rank as four separate queries, each
 * re-summing points in the browser, is the exact shape that collapsed the
 * platform at 60 concurrent users (§23), so the whole payload is assembled and
 * aggregated server-side by `teacher_achievements()`.
 *
 * The payload is teacher-shaped (`badge_type='teacher'`), so callers on a shared
 * surface pass `enabled` to keep it from firing for students. The query key is
 * identical either way, so a page and the view inside it share one request
 * rather than issuing two.
 */
export function useTeacherAchievements(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["teacher-achievements", user?.id],
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<TeacherAchievements> => {
      // Generated types lag these new RPCs - narrow structural cast per §5a,
      // never `as any`. Drop at the next `supabase gen types` run.
      const client = supabase as unknown as {
        rpc(fn: "teacher_achievements"): PromiseLike<{
          data: TeacherAchievements | null;
          error: { message: string } | null;
        }>;
      };
      const { data, error } = await client.rpc("teacher_achievements");
      if (error) throw error;
      if (!data) throw new Error("No achievements payload returned.");
      // The catalog is exactly what the server returns. The frontend mirror
      // that used to append not-yet-migrated badges here was deleted on
      // 2026-10-05 (Task 10) once 20260904160000 was applied: left in place it
      // would have resurrected any badge later deactivated server-side.
      return data;
    },
  });
}

/**
 * Per-badge rarity for the "earned by N% of teachers" line.
 *
 * Calls `teacher_badge_rarity()`, NOT the existing `badge_rarity()`: that one
 * hardcodes its denominator to students in the institution (2,498 against 265
 * teachers in production), so a badge a third of the staffroom holds would
 * report three percent.
 *
 * Deliberately a SEPARATE query from the payload above: rarity is cohort-wide
 * and moves far more slowly than one teacher's own progress, so it caches for
 * much longer and an award of your own never forces it to refetch.
 */
export function useTeacherBadgeRarity(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["teacher-badge-rarity", user?.id],
    enabled: enabled && !!user?.id,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Record<string, TeacherBadgeRarity>> => {
      const client = supabase as unknown as {
        rpc(fn: "teacher_badge_rarity"): PromiseLike<{
          data: Record<string, TeacherBadgeRarity> | null;
          error: { message: string } | null;
        }>;
      };
      const { data, error } = await client.rpc("teacher_badge_rarity");
      if (error) throw error;
      return data ?? {};
    },
  });
}
