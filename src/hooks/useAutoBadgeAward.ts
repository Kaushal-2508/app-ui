import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { headCount } from "@/lib/headCount";
import type { Json } from "@/integrations/supabase/types";

type CriteriaType = "count" | "threshold" | "streak" | "percentage";
type CriteriaMetric = "exams_completed" | "exams_passed" | "perfect_scores" | "login_days" | "exams_created" | "evaluations_done" | "questions_generated" | "portal_visits";

interface BadgeDefinition {
  id: string;
  name: string;
  badge_type: string;
  criteria_type: CriteriaType;
  criteria_value: number;
  criteria_metric: CriteriaMetric;
  points: number;
  tier: string;
}

export function useAutoBadgeAward() {
  const queryClient = useQueryClient();

  const checkAndAwardBadges = useCallback(async (
    userId: string,
    institutionId: string | null,
    eventType: "exam_completed" | "exam_passed" | "perfect_score" | "login" | "exam_created" | "evaluation_done" | "question_generated",
    metadata?: Record<string, string | number | boolean>
  ) => {
    try {
      // Map event type to criteria metrics to check
      const metricsToCheck: CriteriaMetric[] = [];
      
      switch (eventType) {
        case "exam_completed":
          metricsToCheck.push("exams_completed");
          break;
        case "exam_passed":
          metricsToCheck.push("exams_passed");
          break;
        case "perfect_score":
          metricsToCheck.push("perfect_scores");
          break;
        case "login":
          metricsToCheck.push("login_days", "portal_visits");
          break;
        case "exam_created":
          metricsToCheck.push("exams_created");
          break;
        case "evaluation_done":
          metricsToCheck.push("evaluations_done");
          break;
        case "question_generated":
          metricsToCheck.push("questions_generated");
          break;
      }

      if (metricsToCheck.length === 0) return;

      // Gate: teachers and coordinators must complete their onboarding journey
      // before any badges are awarded. Incomplete journey = silently skip.
      // Students and admins are unaffected — they don't have an onboarding journey.
      const onboardingBlocked = await isOnboardingIncomplete(userId);
      if (onboardingBlocked) {
        return;
      }

      // Fetch applicable badge definitions
      // Teacher badges are awarded server-side by evaluate_teacher_badges (see
      // 20260818120000_teacher_badges.sql), so they are excluded here rather
      // than being awarded twice by two engines that disagree. This browser
      // path is the one that handed a demo teacher all three exam badges for
      // zero exams: getUserStats reads counts the caller is allowed to see, and
      // its `evaluations_done` branch queries teacher_overrides.teacher_id, a
      // column that does not exist. The trigger reads the same tables as the
      // owner, on the write that actually happened.
      const { data: badges, error: badgeError } = await supabase
        .from("badge_definitions")
        .select("*")
        .eq("is_active", true)
        .neq("badge_type", "teacher")
        .in("criteria_metric", metricsToCheck);

      if (badgeError || !badges?.length) return;

      // Get current user stats based on event type
      const currentStats = await getUserStats(userId, metricsToCheck);
      
      // Get already earned badges
      const { data: earnedBadges } = await supabase
        .from("user_badges")
        .select("badge_id")
        .eq("user_id", userId);

      const earnedBadgeIds = new Set(earnedBadges?.map(b => b.badge_id) || []);

      // Check each badge
      for (const badge of badges as BadgeDefinition[]) {
        // Skip if already earned
        if (earnedBadgeIds.has(badge.id)) continue;

        const currentValue = currentStats[badge.criteria_metric] || 0;
        let shouldAward = false;

        switch (badge.criteria_type) {
          case "count":
          case "threshold":
            shouldAward = currentValue >= badge.criteria_value;
            break;
          case "streak":
            shouldAward = currentValue >= badge.criteria_value;
            break;
          case "percentage":
            shouldAward = currentValue >= badge.criteria_value;
            break;
        }

        if (shouldAward) {
          // Award the badge
          const { error: awardError } = await supabase
            .from("user_badges")
            .insert([{
              user_id: userId,
              badge_id: badge.id,
              institution_id: institutionId,
              source_entity_type: eventType,
              metadata: (metadata || {}) as Json,
            }]);

          if (!awardError) {
            // Show notification
            toast.success(`🎉 Badge Earned: ${badge.name}!`, {
              description: `+${badge.points} points`,
              duration: 5000,
            });

            // Create in-app notification for badge earned
            await supabase.from("notifications").insert({
              user_id: userId,
              type: "badge_earned",
              title: `🏆 Badge Earned: ${badge.name}!`,
              message: `Congratulations! You earned the "${badge.name}" badge (+${badge.points} points).`,
              link: "/badges",
              metadata: { badge_id: badge.id, badge_name: badge.name, points: badge.points } as Json,
            });

            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ["user-badges"] });
            queryClient.invalidateQueries({ queryKey: ["badge-stats"] });
            queryClient.invalidateQueries({ queryKey: ["badge-leaderboard"] });
          }
        }
      }
    } catch (error) {
      console.error("Error checking badges:", error);
    }
  }, [queryClient]);

  return { checkAndAwardBadges };
}

/**
 * Returns true when the user has a teacher/coordinator role AND their onboarding
 * journey is not yet complete. Students, admins, and anyone without those roles
 * return false (no gate). Errors are treated as "not blocked" to avoid breaking
 * the award flow for unrelated issues.
 */
async function isOnboardingIncomplete(userId: string): Promise<boolean> {
  try {
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["teacher", "coordinator"]);

    if (!roleRows || roleRows.length === 0) return false;

    const { data: progress, error } = await supabase.rpc("get_user_onboarding_progress", {
      _user_id: userId,
    });
    if (error) return false;
    // Narrow structural type rather than any[] (§5a): only the one flag is read.
    const row = (progress as { is_journey_completed: boolean }[] | null)?.[0];
    if (!row) return false;
    return !row.is_journey_completed;
  } catch (e) {
    console.error("Onboarding gate check failed:", e);
    return false;
  }
}

async function getUserStats(
  userId: string,
  metrics: CriteriaMetric[]
): Promise<Record<CriteriaMetric, number>> {
  const stats: Partial<Record<CriteriaMetric, number>> = {};

  // This runs on EVERY login and EVERY exam submit for EVERY user — each
  // metric must be a server-side head count, never a row pull counted with
  // .length (§23). The old code also issued raw fetch()es against PostgREST
  // (bypassing supabase-js) and a stray get_exam_institution RPC per check.
  for (const metric of metrics) {
    try {
      switch (metric) {
        case "exams_completed": {
          stats[metric] = await headCount("student_exam_attempts", {
            student_id: userId,
            is_submitted: true,
          });
          break;
        }
        case "exams_passed": {
          stats[metric] = await headCount("final_results", {
            student_id: userId,
            is_pass: true,
          });
          break;
        }
        case "perfect_scores": {
          // Column-to-column comparison isn't expressible in PostgREST, so
          // fetch the two mark columns (bounded per student) and compare here.
          // final_results' generated builder types trip TS2589 on this chain
          // (same reason src/lib/headCount.ts exists) — narrow structural
          // cast per §5a, runtime call unchanged.
          const resultsClient = supabase as unknown as {
            from(table: "final_results"): {
              select(cols: string): {
                eq(col: string, val: string): {
                  limit(n: number): PromiseLike<{
                    data: Array<{
                      total_marks_obtained: number | null;
                      total_max_marks: number | null;
                    }> | null;
                    error: { message: string } | null;
                  }>;
                };
              };
            };
          };
          const { data } = await resultsClient
            .from("final_results")
            .select("total_marks_obtained, total_max_marks")
            .eq("student_id", userId)
            .limit(500);
          stats[metric] = (data ?? []).filter(
            (r) => r.total_marks_obtained === r.total_max_marks && (r.total_max_marks ?? 0) > 0
          ).length;
          break;
        }
        case "login_days":
        case "portal_visits": {
          stats[metric] = await headCount("user_activity_log", {
            user_id: userId,
            activity_type: "login",
          });
          break;
        }
        case "exams_created": {
          stats[metric] = await headCount("exams", { created_by: userId });
          break;
        }
        case "evaluations_done": {
          stats[metric] = await headCount("teacher_overrides", { teacher_id: userId });
          break;
        }
        case "questions_generated": {
          const { data } = await supabase
            .from("ai_daily_usage")
            .select("questions_generated")
            .eq("user_id", userId)
            .limit(500);
          stats[metric] = (data ?? []).reduce(
            (sum, u) => sum + (u.questions_generated || 0),
            0
          );
          break;
        }
      }
    } catch (e) {
      console.error(`Error fetching ${metric}:`, e);
      stats[metric] = 0;
    }
  }

  return stats as Record<CriteriaMetric, number>;
}
