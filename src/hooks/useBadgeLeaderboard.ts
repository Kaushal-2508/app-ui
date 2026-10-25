import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BadgeTier } from "./useBadges";
import { useUserRole, AppRole } from "./useUserRole";
import { getDisplayName } from "@/lib/displayName";

export interface LeaderboardEntry {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  totalBadges: number;
  totalPoints: number;
  tierCounts: Record<BadgeTier, number>;
  latestBadgeAt: string | null;
  avatarUrl: string | null;
  className?: string;
}

export type LeaderboardFilter = "peers" | "all";

/**
 * Role-based leaderboard filtering logic:
 * - Students: See only students from the same class
 * - Teachers: See only teachers from the same institution
 * - Coordinators: See only coordinators from the same institution
 * - School Admins: See all users from their institution
 * - Super Admins: See all users across all institutions
 */
export function useBadgeLeaderboard(limit: number = 20) {
  const { data: roleInfo } = useUserRole();

  return useQuery({
    queryKey: ["badge-leaderboard", limit, roleInfo?.primaryRole, roleInfo?.institutionId],
    // Leaderboard freshness is non-critical; this was the #2 total-DB-time
    // query platform-wide before being made server-side + cached (§23).
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      // Server-side aggregate (badge_leaderboard RPC, SECURITY DEFINER):
      // one round-trip returning only the top N rows, with the role-based
      // peer-visibility rules applied in SQL. Replaces the old client-side
      // pipeline, which pulled EVERY user_badges row in the institution
      // (silently capped at 1000 by PostgREST — wrong results for large
      // schools) plus all roles and chunked profiles on every mount.
      type Row = {
        user_id: string;
        full_name: string | null;
        email: string | null;
        avatar_url: string | null;
        role: string | null;
        total_badges: number;
        total_points: number;
        bronze: number;
        silver: number;
        gold: number;
        platinum: number;
        diamond: number;
        latest_badge_at: string | null;
      };

      const { data, error } = await supabase.rpc(
        "badge_leaderboard" as never,
        { _limit: limit } as never,
      );
      if (error) throw error;

      return ((data ?? []) as unknown as Row[]).map((r) => ({
        userId: r.user_id,
        fullName: getDisplayName({ full_name: r.full_name, email: r.email }),
        email: r.email || "",
        avatarUrl: r.avatar_url,
        role: r.role || "student",
        totalBadges: r.total_badges,
        totalPoints: r.total_points,
        tierCounts: {
          bronze: r.bronze,
          silver: r.silver,
          gold: r.gold,
          platinum: r.platinum,
          diamond: r.diamond,
        } as Record<BadgeTier, number>,
        latestBadgeAt: r.latest_badge_at,
      }));
    },
    enabled: !!roleInfo,
  });
}

/**
 * One earned ACHIEVEMENT, not one badge. The ladders award every rung passed,
 * so a 15 day streak yields Hat-trick, Flame and Blaze; those arrive here as a
 * single row with topValue 15 and badgeCount 3.
 */
export interface BadgeBreakdownRow {
  metric: string;
  criteriaType: string;
  /** Highest rung reached for this metric. */
  topValue: number;
  /** Rungs passed. For the one re-earnable badge this is months won instead. */
  badgeCount: number;
  topBadge: string;
  topTier: string;
  /** Points this group contributed to the score. */
  points: number;
  latestAt: string | null;
}

/**
 * How one person on the leaderboard earned their badges, grouped by metric.
 *
 * Goes through a SECURITY DEFINER RPC rather than querying user_badges: RLS on
 * that table lets a student read only their OWN rows, so a direct query for a
 * classmate returns zero rows and NO error, and the UI would confidently report
 * that everyone else has earned nothing. The RPC re-applies the leaderboard's
 * visibility rules and returns nothing when the viewer may not see the target.
 *
 * `enabled` is passed false until the popover actually opens: 50 leaderboard
 * rows must not fire 50 breakdown queries on mount (§23).
 */
export function useLeaderboardBadgeBreakdown(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["leaderboard-badge-breakdown", userId],
    enabled: enabled && !!userId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BadgeBreakdownRow[]> => {
      type Row = {
        metric: string;
        criteria_type: string;
        top_value: number;
        badge_count: number;
        top_badge: string;
        top_tier: string;
        points: number;
        latest_at: string | null;
      };
      const { data, error } = await supabase.rpc(
        "leaderboard_badge_breakdown" as never,
        { _user_id: userId } as never,
      );
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        metric: r.metric,
        criteriaType: r.criteria_type,
        topValue: r.top_value,
        badgeCount: r.badge_count,
        topBadge: r.top_badge,
        topTier: r.top_tier,
        points: r.points,
        latestAt: r.latest_at,
      }));
    },
  });
}

export interface AchievementLine {
  /** What the student actually did. */
  title: string;
  /** Where the badge count and points came from. */
  note: string;
}

/**
 * Plain-language description of one grouped achievement.
 *
 * The phrasing follows criteria_type, and that distinction is the whole point:
 *
 *   threshold  ONE occasion, measured at its best. Clean Hit / MVP Round / Ace
 *              / Century are all rungs of the same 0-100 scale, so a single
 *              100% exam awards all four at once. Phrasing them as "scored
 *              100% in an exam - 4 badges" read as four separate perfect exams,
 *              which is exactly the misreading this fixes. Stated as a personal
 *              best, with the note saying it came from one exam.
 *   event      happened, once, in the past. Phrased in the past tense, because
 *              "beat their previous score by 15 points or more" is the badge's
 *              RULE and reads as a standing habit rather than a thing they did.
 *   count      genuinely accumulated over time, so the rung count is honest and
 *              the note says the badges came "along the way".
 *   streak     one continuous run that passed several rungs.
 *
 * An unknown metric falls back to the badge's own name rather than rendering a
 * raw column value at a student.
 */
export function describeAchievement(row: BadgeBreakdownRow): AchievementLine {
  const n = row.topValue;
  const k = row.badgeCount;
  const pts = `${row.points} pts`;
  const ladder = k > 1 ? `${k} badges along the way · ${pts}` : pts;
  const plain = k > 1 ? `${k} badges · ${pts}` : pts;

  switch (row.metric) {
    // ── streak: one continuous run ──────────────────────────────────────────
    case "streak_days":
      return {
        title: `Reached a ${n} day activity streak`,
        note: k > 1 ? `one streak, ${k} badges along the way · ${pts}` : pts,
      };

    // ── threshold: one occasion, at its best ────────────────────────────────
    case "exam_percentage":
      return {
        title: `Best exam score: ${n}%`,
        note: k > 1 ? `one exam cleared ${k} badges · ${pts}` : pts,
      };

    // ── event: happened once, in the past ───────────────────────────────────
    case "score_improvement":
      return {
        title: `Improved on a previous exam score by ${n} points`,
        note: pts,
      };
    case "streak_comeback_hours":
      return {
        title: `Came back within ${n} hours of losing a streak`,
        note: pts,
      };

    // ── count: genuinely accumulated ────────────────────────────────────────
    case "exams_completed":
      return {
        title: n === 1 ? "Sat their first exam" : `Completed ${n} exams`,
        note: ladder,
      };
    case "homework_submitted":
      return {
        title: n === 1 ? "Handed in their first homework" : `Handed in ${n} pieces of homework`,
        note: ladder,
      };
    case "study_materials_opened":
      return { title: `Opened study material on ${n} different days`, note: ladder };
    case "exams_at_90":
      return { title: `Scored 90% or higher in ${n} separate exams`, note: plain };
    case "perfect_score_count":
      return { title: `Scored 100% in ${n} separate exams`, note: plain };

    // ── periodic: re-earnable, so the count is months won ───────────────────
    case "active_days_in_month":
      return {
        title: k === 1 ? "Won Player of the Month" : `Won Player of the Month ${k} times`,
        note: pts,
      };

    // ── aggregate: decided at the end of the year ───────────────────────────
    case "all_exams_completed":
      return { title: "Sat every exam scheduled this year", note: pts };
    case "subject_avg_min":
      return { title: `Averaged ${n}% or higher in every subject`, note: pts };
    case "class_first_place_count":
      return { title: "Topped the class more often than anyone else", note: pts };
    case "streak_percentile":
      return { title: `Reached the top ${n}% of the school streak leaderboard`, note: pts };
    case "streak_full_year":
      return { title: "Held an unbroken streak for the whole year", note: pts };

    default:
      return { title: row.topBadge, note: plain };
  }
}

/**
 * Get the display title for the leaderboard based on viewer's role
 */
export function getLeaderboardTitle(role: AppRole | null): { title: string; subtitle: string } {
  switch (role) {
    case "student":
      return {
        title: "Class Leaderboard",
        subtitle: "Top badge earners in your class"
      };
    case "teacher":
      return {
        title: "Teacher Leaderboard",
        subtitle: "Top badge earners among teachers in your institution"
      };
    case "coordinator":
      return {
        title: "Coordinator Leaderboard",
        subtitle: "Top badge earners among coordinators in your institution"
      };
    case "school_admin":
      return {
        title: "Institution Leaderboard",
        subtitle: "Top badge earners across your institution"
      };
    case "super_admin":
      return {
        title: "Global Leaderboard",
        subtitle: "Top badge earners across all institutions"
      };
    default:
      return {
        title: "Badge Leaderboard",
        subtitle: "Top badge earners"
      };
  }
}

// Get top 3 for mini leaderboard display
export function useTopBadgeEarners() {
  return useBadgeLeaderboard(3);
}
