import { useQuery } from "@tanstack/react-query";

import {
  CUMULATIVE_METRIC_LIST,
  type AchievementBadgeShape,
  type AchievementCategory,
  type BadgeProgressShape,
  type BadgeRarityShape,
  type EarnedBadgeShape,
  type ShieldTier,
} from "@/components/achievements/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useScopedStudentId } from "@/contexts/StudentScopeContext";

/**
 * Row shapes live in `@/components/achievements/types`, a dependency-free
 * vocabulary module, so there is exactly ONE definition of each and the
 * components cannot drift from the hook. Re-exported here for callers that
 * already import from this hook.
 */
export type BadgeCategory = AchievementCategory;
export type BadgeTier = ShieldTier;
export type AchievementBadge = AchievementBadgeShape;
export type EarnedBadge = EarnedBadgeShape;
export type BadgeRarity = BadgeRarityShape;

export interface StreakState {
  current: number;
  as_of: string | null;
  active_today: boolean;
}

export interface StudentAchievements {
  points: number;
  rank: BadgeTier;
  /** Points needed for the next rank, or null at the top. */
  next_rank_at: number | null;
  streak: StreakState;
  catalog: AchievementBadge[];
  /** An ARRAY, not a map: Player of the Month is held once per month. */
  earned: EarnedBadge[];
  /** badge_id -> cumulative progress, written server-side by the evaluator. */
  progress: Record<string, BadgeProgressShape>;
}

/**
 * Everything the Achievements tab renders, in ONE round trip.
 *
 * The page previously needed the catalog, earned badges, progress and stats as
 * four separate queries, each re-counting points in the browser. That is the
 * exact shape that collapsed the platform at 60 concurrent users (§23), so the
 * whole payload is assembled and aggregated server-side by student_achievements().
 */
export function useStudentAchievements(enabled = true) {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-achievements", user?.id, scopedId ?? "self"],
    // The payload is student-shaped (badge_type='student'), so callers on a
    // shared surface pass `enabled` to keep it from firing for teachers and
    // coordinators. The query key is identical either way, so a page and the
    // view inside it share one request rather than issuing two.
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentAchievements> => {
      // Generated types lag these new RPCs - narrow structural cast per §5a,
      // never `as any`. Drop at the next `supabase gen types` run.
      const client = supabase as unknown as {
        rpc(fn: "student_achievements"): PromiseLike<{
          data: StudentAchievements | null;
          error: { message: string } | null;
        }>;
      };
      const { data, error } = await client.rpc("student_achievements");
      if (error) throw error;
      if (!data) throw new Error("No achievements payload returned.");
      return data;
    },
  });
}

/**
 * Just the streak, for surfaces that need the number and nothing else (the
 * dashboard status strip).
 *
 * Deliberately NOT reusing useStudentAchievements: that payload carries the
 * whole badge catalog, every earned row and all progress, which is a lot to
 * ship to a dashboard tile showing one integer.
 *
 * student_streak() answers only for the caller (20260813190000 added that
 * guard). Staff viewing a student go through student_streak_for, which is
 * authorised by can_edit_student_details instead (20260824130000).
 */
export function useStudentStreak() {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-streak", user?.id, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<StreakState> => {
      const client = supabase as unknown as {
        rpc(
          fn: "student_streak" | "student_streak_for",
          args?: { p_student_id: string },
        ): PromiseLike<{
          data: StreakState | null;
          error: { message: string } | null;
        }>;
      };
      const { data, error } = scopedId
        ? await client.rpc("student_streak_for", { p_student_id: scopedId })
        : await client.rpc("student_streak");
      if (error) throw error;
      return data ?? { current: 0, as_of: null, active_today: false };
    },
  });
}

/**
 * Per-badge rarity for the Legendary tier's "earned by N% of students" line.
 *
 * Deliberately a SEPARATE query from the payload above: rarity is cohort-wide
 * and changes far more slowly than one student's own progress, so it caches for
 * much longer and a student's own award never forces it to refetch.
 */
export function useBadgeRarity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["badge-rarity", user?.id],
    enabled: !!user?.id,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Record<string, BadgeRarity>> => {
      const client = supabase as unknown as {
        rpc(fn: "badge_rarity"): PromiseLike<{
          data: Record<string, BadgeRarity> | null;
          error: { message: string } | null;
        }>;
      };
      const { data, error } = await client.rpc("badge_rarity");
      if (error) throw error;
      return data ?? {};
    },
  });
}

/**
 * Badges whose progress is a running count, so they get a progress bar.
 *
 * These are exactly the six metrics of the LOCKED contract, and no others:
 *
 *   streak_days            streak ranks   (Hat-trick .. Legacy)
 *   exams_completed        quest log      (Debut, Regular Starter, Iron Man, First XI)
 *   study_materials_opened quest log      (Playbook Pro)
 *   exams_at_90            clutch plays   (In Form)
 *   perfect_score_count    legendary      (Double Century)
 *   active_days_in_month   monthly form   (Player of the Month)
 *
 * Note `perfect_score_count`, NOT `perfect_scores`. The browser awarder in
 * useAutoBadgeAward.ts dispatches on `perfect_scores`, and the rename is what
 * stops the client handing out the 200-point Double Century. Never rename it.
 *
 * Threshold metrics (exam_percentage), event metrics (streak_comeback_hours,
 * score_improvement) and aggregate metrics (all_exams_completed,
 * subject_avg_min, class_first_place_count, streak_percentile,
 * streak_full_year) are deliberately absent: a bar for any of them would
 * present a historical maximum or a rank as accumulated progress.
 *
 * The list itself lives in the components' vocabulary module so this set and
 * the adapter's unit table are typechecked against each other.
 */
export const CUMULATIVE_METRICS: ReadonlySet<string> = new Set<string>(CUMULATIVE_METRIC_LIST);
