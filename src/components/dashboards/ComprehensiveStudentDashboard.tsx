import { useAuth } from "@/hooks/useAuth";
import { useProfileData } from "@/hooks/useProfileData";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useRotatingGreeting } from "@/hooks/useRotatingGreeting";
import { formatClassName } from "@/lib/utils";

import { PageShell } from "@/components/shared/page";
import { DownloadReportButton } from "@/components/student/DownloadReportButton";
import { SchoolSceneIllustration } from "@/components/shared/illustrations";
import { PromotionCelebration } from "@/components/passport/PromotionCelebration";
import {
  StudentStatusStrip,
  NeedsAttentionCard,
  AttendanceDonut,
  ScoreTrendCard,
  SubjectSnapshotCard,
  SuggestionsCard,
  AchievementsSection,
  UpNextCard,
  NoticeStoriesRow,
} from "@/components/student/dashboard";

interface ComprehensiveStudentDashboardProps {
  studentId?: string;
  studentName?: string;
}

/**
 * The consolidated student dashboard (live at /dashboard via RoleBasedDashboard).
 *
 * Single-scroll, phone-first layout for parents/students with low chart
 * literacy. Every visual carries a short plain-language label from the
 * deterministic label engine (src/lib/performanceLabels.ts) and reads from the
 * REAL class-aggregate RPCs (useStudentClassComparison) — the old fabricated
 * avg*0.95 analytics (useComprehensiveStudentAnalytics) is no longer used here.
 */
export function ComprehensiveStudentDashboard({
  studentName,
}: ComprehensiveStudentDashboardProps) {
  const greeting = useRotatingGreeting();
  const { user } = useAuth();
  const { isFeatureEnabled } = useInstitutionFeatures();
  const { data: profile } = useProfileData();

  const displayName = profile?.full_name || studentName || "Student";
  const studentClass = profile?.studentClass;
  const institutionId = profile?.institution_id ?? null;
  const studentClassIds = (profile?.classAssignments ?? [])
    .filter((ca) => ca.role === "student")
    .map((ca) => ca.class_id);

  return (
    <PageShell>
      <PromotionCelebration studentName={displayName} />

      <div className="space-y-4 sm:space-y-5 lg:space-y-6">
        {/* Greeting banner — illustrated scene + rotating multilingual greeting. */}
        <SchoolSceneIllustration />

        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between pt-1 pb-2 sm:pt-2 sm:pb-3 lg:pt-4 lg:pb-6">
          <div className="min-w-0">
            <p className="eyebrow">Welcome back</p>
            <h1 className="text-[28px] sm:text-[34px] lg:text-[42px] xl:text-[46px] leading-tight font-bold tracking-tight text-ink-900 mt-1.5">
              {greeting}, {displayName}!
            </h1>
            {studentClass?.name && (
              <p className="mt-2 text-sm sm:text-[15px] text-ink-600">
                {formatClassName(studentClass.name, studentClass.section)}
              </p>
            )}
          </div>

          <DownloadReportButton />
        </header>

        {/* "Today" layout (2026-10-14): what to do now comes first, the
            report comes after. Same data and colours as before, reordered. */}

        {/* 1 — Notices as story circles (notice_board-gated). Relevance is
            decided server-side by notice_inbox. */}
        {isFeatureEnabled("notice_board") && <NoticeStoriesRow />}

        {/* 2 — Current or next class from the published timetable. */}
        <UpNextCard />

        {/* 3 — Homework, exams and fees due this week, soonest first. */}
        <NeedsAttentionCard />

        {/* 4 — Streak, average, homework pending, class standing. */}
        <StudentStatusStrip />

        {/* 5 — What to do next, from the deterministic suggestion engine */}
        <SuggestionsCard />

        {/* 6-8 — Your progress: the academic report */}
        <section className="space-y-4 sm:space-y-5 lg:space-y-6">
          <p className="eyebrow pt-2">Your progress</p>
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 lg:gap-6">
            <AttendanceDonut />
            <ScoreTrendCard />
          </div>
          <SubjectSnapshotCard />
        </section>

        {/* 9 — Achievements (collapsed, intentionally quiet) */}
        <AchievementsSection />
      </div>
    </PageShell>
  );
}
