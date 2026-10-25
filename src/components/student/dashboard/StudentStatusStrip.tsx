import { useNavigate } from "react-router-dom";
import { Flame, GraduationCap, ClipboardList, Award } from "lucide-react";

import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudentStreak } from "@/hooks/useStudentAchievements";
import { useStudentScoreTrend, useStudentClassStanding } from "@/hooks/useStudentClassComparison";
import { useStudentHomework } from "@/hooks/useStudentHomework";
import { percentileToBand } from "@/lib/performanceLabels";

/** The compact KPI strip at the top of the dashboard. Every tile is rule-based;
 *  the homework tile is feature-gated where the module can be turned off. */
export function StudentStatusStrip() {
  const navigate = useNavigate();
  const { isFeatureEnabled } = useInstitutionFeatures();

  const homeworkOn = isFeatureEnabled("homework");

  const { data: streak, isLoading: streakLoading } = useStudentStreak();
  const { data: trend, isLoading: trendLoading } = useStudentScoreTrend(8);
  const { data: homework, isLoading: hwLoading } = useStudentHomework();
  const { data: standing, isLoading: standingLoading } = useStudentClassStanding();

  const isLoading = streakLoading || trendLoading || standingLoading || (homeworkOn && hwLoading);

  if (isLoading) {
    return (
      <StatTileGrid cols={2} mdCols={4}>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </StatTileGrid>
    );
  }

  // (a) Current activity streak, in days.
  //
  // This slot used to hold "Attendance this month". The Attendance card further
  // down now defaults to the same calendar-month window and shows present/absent
  // days, the percentage and a plain-language verdict, so the tile was repeating
  // a weaker version of what was already on screen. The streak is the one number
  // on this dashboard a student can act on today.
  const streakDays = streak?.current ?? 0;
  const activeToday = streak?.active_today ?? false;

  // (b) Average score across the last 5 tests
  const points = trend ?? [];
  const lastFive = points.slice(-5);
  const avgScore =
    lastFive.length > 0
      ? lastFive.reduce((sum, p) => sum + (p.percentage ?? 0), 0) / lastFive.length
      : null;

  // (c) Homework pending count
  const pendingHomework = (homework ?? []).filter(
    (r) => !r.submission && r.status !== "checked",
  ).length;

  // (d) Class standing — the student's overall percentile band vs classmates
  const band = percentileToBand(standing?.student_percentile, standing?.cohort_size);
  const hasStanding = !!standing?.has_data;

  return (
    <StatTileGrid cols={2} mdCols={4}>
      <StatTile
        label="Current streak"
        value={streakDays === 1 ? "1 day" : `${streakDays} days`}
        icon={<Flame className="h-5 w-5" />}
        // Peach once a streak is running, sky at zero: a cold tile for a cold
        // streak reads as "nothing to lose yet" rather than as a warning.
        tone={streakDays > 0 ? "peach" : "sky"}
        // Deep-links to Streak Ranks, where the ladder and the next rung live.
        onClick={() => navigate("/achievements")}
        delta={
          streakDays > 0 && !activeToday
            ? { value: "Keep it alive today", direction: "down" }
            : undefined
        }
      />

      <StatTile
        label="Avg of last 5 tests"
        value={avgScore == null ? "N/A" : `${Math.round(avgScore)}%`}
        icon={<GraduationCap className="h-5 w-5" />}
        tone="violet"
      />

      {homeworkOn && (
        <StatTile
          label="Homework pending"
          value={pendingHomework}
          icon={<ClipboardList className="h-5 w-5" />}
          tone={pendingHomework > 0 ? "peach" : "sky"}
          onClick={() => navigate("/student/homework")}
        />
      )}

      <StatTile
        label="Class standing"
        value={hasStanding ? band.short : "N/A"}
        icon={<Award className="h-5 w-5" />}
        tone={hasStanding ? band.tone : "sky"}
        onClick={() => navigate("/student/results")}
      />
    </StatTileGrid>
  );
}
