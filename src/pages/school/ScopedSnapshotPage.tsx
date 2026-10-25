import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";

import { PageShell } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { DashboardScopeProvider } from "@/hooks/dashboard/DashboardScope";

import { KpiStrip } from "@/components/command-center/KpiStrip";
import { FlagsFeed } from "@/components/command-center/FlagsFeed";
import { SubjectsByPerformanceWidget } from "@/components/command-center/widgets/SubjectsByPerformanceWidget";
import {
  StudentDistributionWidget,
  type DistributionBand,
} from "@/components/command-center/widgets/StudentDistributionWidget";
import { AttendanceTrendWidget } from "@/components/command-center/widgets/AttendanceTrendWidget";
import { ExamPerformanceTrendWidget } from "@/components/command-center/widgets/ExamPerformanceTrendWidget";
import { ClassSubjectHeatmapWidget } from "@/components/command-center/widgets/ClassSubjectHeatmapWidget";
import { TeacherActionQueue } from "@/components/command-center/widgets/TeacherActionQueue";
import { TeacherClassSubjects } from "@/components/command-center/widgets/TeacherClassSubjects";
import { TeacherWeakChapters } from "@/components/command-center/widgets/TeacherWeakChapters";
import { TeacherStudentsAttention } from "@/components/command-center/widgets/TeacherStudentsAttention";
import { TeacherPortalAdoption } from "@/components/command-center/widgets/TeacherPortalAdoption";
import { TeacherSyllabusCoverage } from "@/components/command-center/widgets/TeacherSyllabusCoverage";
import { TeacherDashboardBanner } from "@/components/command-center/widgets/TeacherDashboardBanner";
import { TeacherPortalLaggards } from "@/components/command-center/widgets/TeacherPortalLaggards";
import { TeacherStandingStrip } from "@/components/command-center/widgets/TeacherStandingStrip";
import { SyllabusCoverageWidget } from "@/components/command-center/widgets/SyllabusCoverageWidget";
// Coordinator-only panels. Each is backed by a dash_scoped_* RPC that resolves
// the caller's wing server-side, so none of them takes a wing or class prop.
import { WingStandingStrip } from "@/components/command-center/widgets/WingStandingStrip";
import { WingJumpNav, type JumpTarget } from "@/components/command-center/widgets/WingJumpNav";
import { StartHereStrip } from "@/components/command-center/widgets/StartHereStrip";
import { WingDigestCard } from "@/components/command-center/widgets/WingDigestCard";
import { StudentAdoptionWidget } from "@/components/command-center/widgets/StudentAdoptionWidget";
import { TeacherAdoptionWidget } from "@/components/command-center/widgets/TeacherAdoptionWidget";
import { ClassPerformanceWidget } from "@/components/command-center/widgets/ClassPerformanceWidget";
import { AttendanceComplianceWidget } from "@/components/command-center/widgets/AttendanceComplianceWidget";
import { RecheckQueueWidget } from "@/components/command-center/widgets/RecheckQueueWidget";
import { TaskQueueWidget } from "@/components/command-center/widgets/TaskQueueWidget";
import { ClassesTable } from "@/components/command-center/tables/ClassesTable";
import { StudentsAttentionTable } from "@/components/command-center/tables/StudentsAttentionTable";
import { TeachersTable } from "@/components/command-center/tables/TeachersTable";
import { RecentExamsTable } from "@/components/command-center/tables/RecentExamsTable";
import { DashboardSnapshotReport } from "@/components/command-center/DashboardSnapshotReport";

const CoordinatorConsolePage = lazy(() => import("./CoordinatorConsolePage"));

/**
 * The coordinator / teacher scoped snapshot — the same command-center surface as
 * the admin Command Center, but every panel runs the `dash_scoped_*` RPCs (which
 * resolve the caller's wing / taught classes server-side). Wrapping the tree in
 * `<DashboardScopeProvider scope="scoped">` flips every shared hook + filter list
 * to its scoped variant; the components themselves are reused verbatim.
 *
 * Intentionally lighter than the admin page: a plain header (no DashboardHeader,
 * no realtime "last updated" signal, no AutoCreatedBanner, no CBSE reports). The
 * "Download Report" button opens the same `DashboardSnapshotReport`, which auto-
 * scopes because it consumes the scope-aware hooks from inside the provider.
 */
/**
 * Section divider for the coordinator page, and the anchor the jump-nav scrolls
 * to. The teacher view is short enough to read as one list; the coordinator view
 * is not, and an unbroken column of fifteen cards gives no sense of where
 * "students" ends and "teachers" begins.
 */
function GroupHeading({
  id,
  title,
  caption,
}: {
  id: string;
  title: string;
  caption: string;
}) {
  return (
    <div id={id} className="scroll-mt-32 pt-2">
      <h2 className="text-[19px] font-bold text-ink-900">{title}</h2>
      <p className="mt-1 text-[13px] text-ink-500">{caption}</p>
    </div>
  );
}

/** Section strip order, mirroring the reference mockup's jump nav. */
const JUMP_TARGETS: JumpTarget[] = [
  { id: "grp-overview", label: "Overview" },
  { id: "grp-students", label: "Students" },
  { id: "grp-academics", label: "Academics" },
  { id: "grp-teachers", label: "Teachers & SALCI adoption" },
  { id: "grp-attendance", label: "Attendance" },
  { id: "grp-decisions", label: "Rechecks & tasks" },
  { id: "grp-attention", label: "Needs attention" },
];

function ScopedSnapshotContent({ isTeacherScope }: { isTeacherScope: boolean }) {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId ?? null;
  const { isFeatureEnabled } = useInstitutionFeatures();
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [band, setBand] = useState<DistributionBand | null>(null);

  const { data: inst } = useQuery({
    queryKey: ["dash", "scoped", "institution", institutionId],
    enabled: !!institutionId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("institutions")
        .select("name")
        .eq("id", institutionId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const institutionName = inst?.name ?? "Your school";

  const handleSelectBand = (b: DistributionBand) => {
    setBand(b);
    document.getElementById("dash-students")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <PageShell>
      <div className="space-y-6 pb-10">
        {isTeacherScope ? (
          /* No Download Report for teachers: DashboardSnapshotReport renders the
             shared command-center panels, none of which are subject-scoped, so
             the PDF would contradict the page it sits on. Coordinators keep it. */
          <div className="pt-2">
            <TeacherDashboardBanner institutionName={institutionName} />
          </div>
        ) : (
          <header className="flex flex-wrap items-end justify-between gap-3 pt-2">
            <div>
              <p className="eyebrow">Dashboard</p>
              <h1 className="text-[28px] font-bold text-ink-900 sm:text-[34px]">
                Your wing
              </h1>
              <p className="mt-2 text-sm text-ink-600 sm:text-[15px]">
                The classes and students you&apos;re responsible for at {institutionName}.
              </p>
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => setSnapshotOpen(true)}
            >
              <FileText className="mr-2 h-4 w-4" />
              Download Report
            </Button>
          </header>
        )}

        {/* Coordinators lead with their wing's own standing and the two or three
            things worth doing right now; the KPI tiles and the digest follow.
            Teachers keep the monthly standing strip in place of the four KPI
            tiles: "school average" and "students who need help" are cohort
            numbers they cannot act on. */}
        {isTeacherScope ? (
          <TeacherStandingStrip />
        ) : (
          <>
            <WingJumpNav targets={JUMP_TARGETS} />
            <div id="grp-overview" className="scroll-mt-32 space-y-6">
              <div id="dash-wing-standing" className="scroll-mt-32">
                <WingStandingStrip />
              </div>
              <StartHereStrip />
              <KpiStrip />
              <WingDigestCard />
            </div>
          </>
        )}

        {/* Teacher-only, and deliberately ABOVE the shared widgets: "what do I
            have to do today" and "how are my own pairs doing" outrank the
            cohort charts for a teacher. Coordinators keep the original order. */}
        {isTeacherScope && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <TeacherActionQueue />
              <TeacherClassSubjects />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <TeacherWeakChapters />
              <TeacherStudentsAttention />
            </div>
            {/* Subjects / distribution / exam trend sit here rather than at the
                foot of the page: they answer "how is my teaching landing" and
                belong beside the pupil panels, not after the portal-adoption
                block. Attendance trend stays below with the shared widgets. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <SubjectsByPerformanceWidget />
              {/* No band drill-down for teachers: StudentsAttentionTable (the
                  scroll target) is coordinator-only, so passing the handler
                  would leave a clickable band that goes nowhere. */}
              <StudentDistributionWidget />
            </div>
            <ExamPerformanceTrendWidget />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <TeacherPortalAdoption />
              <TeacherPortalLaggards />
            </div>
            <TeacherSyllabusCoverage />
          </>
        )}

        {/* Teachers keep the original flat order. The COORDINATOR page is
            grouped and action-first: the two duties the PRD makes theirs
            (rechecks, tasks) and the adoption gaps they can actually close come
            before the cohort analytics, because a coordinator opens this page to
            do something, not to browse charts. */}
        {isTeacherScope && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <AttendanceTrendWidget />
          </div>
        )}

        {!isTeacherScope && (
          <>
            <GroupHeading
              id="grp-students"
              title="Students"
              caption="Who is turning up, who is using the portal, and where they stand"
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <StudentAdoptionWidget />
              <StudentDistributionWidget onSelectBand={handleSelectBand} />
            </div>

            <GroupHeading
              id="grp-academics"
              title="Academics"
              caption="Average score by class and subject, and how the wing is trending"
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <ClassPerformanceWidget />
              <SubjectsByPerformanceWidget />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <ExamPerformanceTrendWidget />
              {/* dash_scoped_subject_heatmap joins exam_subjects as a GROUP BY
                  axis rather than a filter, which leaked every subject in a
                  class to a single-subject teacher. A coordinator's scope IS the
                  whole class, so it stays correct here — hence coordinator-only,
                  with the RPC itself unchanged. */}
              <ClassSubjectHeatmapWidget />
            </div>
            {/* Syllabus Coverage — wing (coordinator); gated on timetable.
                Renders its own empty state where nothing has been logged, which
                for most wings is the honest answer. */}
            {isFeatureEnabled("timetable") && <SyllabusCoverageWidget />}

            <GroupHeading
              id="grp-teachers"
              title="Teachers & SALCI adoption"
              caption="Your biggest lever: a teacher who isn't in the system is a teacher whose students probably aren't either"
            />
            <TeacherAdoptionWidget />

            <GroupHeading
              id="grp-attendance"
              title="Attendance"
              caption="The wing over time, and which classes are actually logging it"
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <AttendanceTrendWidget />
              <AttendanceComplianceWidget />
            </div>

            <GroupHeading
              id="grp-decisions"
              title="Rechecks & tasks"
              caption="Rechecks and tasks are yours to clear, nobody else in the school can"
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <RecheckQueueWidget />
              <TaskQueueWidget />
            </div>

            <GroupHeading
              id="grp-attention"
              title="Needs attention"
              caption="Everything flagged across the wing, most severe first"
            />
            <FlagsFeed />

            {/* Drill-down tables */}
            <div className="space-y-6">
              <ClassesTable />
              <StudentsAttentionTable bandFilter={band} />
              <TeachersTable />
              <RecentExamsTable />
            </div>
          </>
        )}

        {/* The footer note mirrors the header's promise, so the guarantee is
            visible whichever end of a long page you are at. Coordinators used to
            be excluded from this by a `hidden` class even though their page is
            the longer of the two. */}
        <p className="rounded-2xl bg-[hsl(var(--ink-400)/0.06)] px-4 py-3 text-[13px] leading-[18px] text-ink-600">
          {isTeacherScope
            ? "This page only ever shows your own assigned classes, subjects and students. Nothing school-wide, and no other teacher's data."
            : "Every number on this page is resolved server-side from your wing assignment. No other wing's students or teachers appear anywhere above, including in the ranking strip, which shows your own position and score only."}
        </p>
      </div>

      {snapshotOpen && (
        <DashboardSnapshotReport
          open={snapshotOpen}
          onOpenChange={setSnapshotOpen}
          institutionName={institutionName}
        />
      )}
    </PageShell>
  );
}

export default function ScopedSnapshotPage() {
  const { data: roleInfo } = useUserRole();

  // A teacher who is ALSO a coordinator keeps the coordinator (wing) view:
  // that is the wider of the two. Only someone who teaches without
  // coordinating gets the subject-scoped variant.
  //
  // This deliberately reads the raw roles rather than activeViewRole. An admin
  // who also teaches reaches this page ONLY in teacher view (SchoolSnapshotPage
  // routes them here), and holds no coordinator role, so the same expression
  // already hands them the teacher scope. Switching this to the view role would
  // also flip every existing teacher+coordinator out of their wing view, which
  // is a change nobody asked for.
  const isTeacherScope = !!roleInfo?.isTeacher && !roleInfo?.isCoordinator;

  // Coordinators get the Coordinator Console (2026-09-22), built to
  // public/report_reference/salci-coordinator-dashboard2.html. It runs on the
  // dash5_* plane, which now clamps itself to the caller's wing, rather than on
  // the dash_scoped_* family the teacher view below still uses. Lazily loaded
  // so a teacher never downloads it, and vice versa.
  //
  // The teacher branch is deliberately untouched: a teacher's scope is a set of
  // SUBJECTS, not a wing, and no part of the console's wing arithmetic applies
  // to them. Rebuilding that view is its own piece of work.
  if (roleInfo && !isTeacherScope) {
    return (
      <Suspense fallback={<PageShell><p className="pt-6 text-sm text-ink-500">Loading…</p></PageShell>}>
        <CoordinatorConsolePage />
      </Suspense>
    );
  }

  return (
    <DashboardScopeProvider scope={isTeacherScope ? "teacher" : "scoped"}>
      <ScopedSnapshotContent isTeacherScope={isTeacherScope} />
    </DashboardScopeProvider>
  );
}
