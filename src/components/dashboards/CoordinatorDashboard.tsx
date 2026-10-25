import {
  Eye,
  Users,
  BookOpen,
  Layers,
  ClipboardList,
  Trophy,
  Award,
  GraduationCap,
  FileText,
  RefreshCcw,
  Camera,
  FilePlus2,
  ClipboardCheck,
  CalendarCheck,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileData } from "@/hooks/useProfileData";
import { useRotatingGreeting } from "@/hooks/useRotatingGreeting";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";

import { PageShell, PageHeader } from "@/components/shared/page";
import { FeatureTile } from "@/components/shared/surfaces";
import { DashboardTopSlot } from "./actions/DashboardTopSlot";
import { MedalChip } from "./MedalChip";
import { StaffCheckInCard } from "@/components/attendance/StaffCheckInCard";

export function CoordinatorDashboard() {
  const { data: profile, isLoading: profileLoading } = useProfileData();
  const greeting = useRotatingGreeting();
  const { isFeatureEnabled } = useInstitutionFeatures();

  if (profileLoading) {
    return <DashboardSkeleton />;
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const institutionName = profile?.institution?.name;

  return (
    <PageShell>
      {/* The day's action cards when something is due, else the Clay School banner. */}
      <DashboardTopSlot view="coordinator" />

      <PageHeader
        title={`${greeting}, ${firstName}!`}
        subtitle={institutionName ? `${institutionName} · Coordinator` : "Coordinator"}
        /* The same one small teal check-in button the teacher dashboard has
           (2026-09-26), in the header's action slot: right of the greeting on
           a laptop, under it on a phone. Gated like the Attendance tile below
           so both appear and disappear together. */
        extras={isFeatureEnabled("attendance") ? <StaffCheckInCard compact view="coordinator" /> : undefined}
      />

      {/* Coordinators share the teacher badge ladder (the evaluator admits both
          roles since 20260904150000), so they get the same small medal chip
          under the greeting as the teacher hub (2026-10-12). Nothing when the
          set is off. */}
      <MedalChip className="mt-3" />

      {/* One clay tone per section (2026-09-29), from the banner's palette, the same
          way the teacher hub colours its groups: jacaranda for the wing and its
          people, teal roofs for academics, lawn green for operations, marigold for
          growth. */}
      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-ink-400">MY WING</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <FeatureTile
          to="/school/snapshot"
          icon={<Camera className="h-5 w-5" />}
          title="Dashboard"
          description="Live overview of your wing with charts & KPIs"
          tone="violet"
        />
        <FeatureTile
          to="/school/workforce"
          icon={<Eye className="h-5 w-5" />}
          title="Workforce"
          description="Track teachers and wings"
          tone="violet"
        />
        <FeatureTile
          to="/coordinator/classes"
          icon={<Layers className="h-5 w-5" />}
          title="My Classes"
          description="View & manage your wing classes"
          tone="violet"
        />
        <FeatureTile
          to="/coordinator/students"
          icon={<Users className="h-5 w-5" />}
          title="Students"
          description="Browse students in your wing"
          tone="violet"
        />
        <FeatureTile
          to="/coordinator/teachers"
          icon={<GraduationCap className="h-5 w-5" />}
          title="Teachers"
          description="Wing teaching staff overview"
          tone="violet"
        />
      </div>

      <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">ACADEMIC</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <FeatureTile
          to="/coordinator/exams"
          icon={<FileText className="h-5 w-5" />}
          title="Class Exams"
          description="All exams in your wing"
          tone="teal"
        />
        <FeatureTile
          to="/coordinator/rechecks"
          icon={<RefreshCcw className="h-5 w-5" />}
          title="Rechecks"
          description="Review recheck submissions"
          tone="teal"
        />
        {/* Feature-gated tiles — mirror AppSidebar's FEATURE_URL_MAP gating so a
            disabled module never shows here as a ghost entry point (ui-invariants §2). */}
        {isFeatureEnabled("syllabus") && (
          <FeatureTile
            to="/school/syllabus"
            icon={<BookOpen className="h-5 w-5" />}
            title="Syllabus"
            description="Curriculum & syllabus mapping"
            tone="teal"
          />
        )}
        {isFeatureEnabled("question_bank") && (
          <FeatureTile
            to="/question-bank"
            icon={<Layers className="h-5 w-5" />}
            title="Question Bank"
            description="Browse & manage question pool"
            tone="teal"
          />
        )}
        {isFeatureEnabled("exams") && (
          <FeatureTile
            to="/exams/create"
            icon={<FilePlus2 className="h-5 w-5" />}
            title="Create Exam"
            description="Author a new exam from scratch"
            tone="teal"
          />
        )}
        {isFeatureEnabled("homework") && (
          <FeatureTile
            to="/homework"
            icon={<ClipboardList className="h-5 w-5" />}
            title="Homework and Assignment"
            description="Create and grade homework"
            tone="teal"
          />
        )}
      </div>

      <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">OPERATIONS</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <FeatureTile
          to="/coordinator/tasks"
          icon={<ClipboardList className="h-5 w-5" />}
          title="Tasks"
          description="Track assigned work items"
          tone="mint"
        />
        {isFeatureEnabled("attendance") && (
          <FeatureTile
            to="/school/attendance"
            icon={<ClipboardCheck className="h-5 w-5" />}
            title="Attendance"
            description="Your wing's class attendance"
            tone="mint"
          />
        )}
        {isFeatureEnabled("attendance") && (
          <FeatureTile
            to="/staff/workday"
            icon={<CalendarCheck className="h-5 w-5" />}
            title="Workday"
            description="Check in, staff attendance, and leave"
            tone="mint"
          />
        )}
      </div>

      <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">GROWTH</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <FeatureTile
          to="/achievements"
          icon={<Trophy className="h-5 w-5" />}
          title="Achievements"
          description="Badges & milestones earned"
          tone="peach"
        />
        <FeatureTile
          to="/leaderboard"
          icon={<Award className="h-5 w-5" />}
          title="Leaderboard"
          description="Rankings & standings"
          tone="peach"
        />
      </div>
    </PageShell>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6 p-4 sm:p-6">
      <div>
        <Skeleton className="h-7 sm:h-8 w-48 sm:w-64" />
        <Skeleton className="h-4 w-40 sm:w-48 mt-2" />
      </div>
      <Skeleton className="h-36 w-full rounded-3xl" />
      <div className="grid gap-3 grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
