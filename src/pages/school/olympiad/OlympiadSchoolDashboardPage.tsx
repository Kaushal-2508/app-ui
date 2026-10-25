import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  Loader2,
  Banknote,
  BookOpen,
  UserPlus,
  GraduationCap,
  Share2,
  CalendarDays,
  KeyRound,
  BarChart3,
  Lock,
  UserX,
} from "lucide-react";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { useUserRole } from "@/hooks/useUserRole";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadSchoolDashboard } from "@/hooks/olympiad/useOlympiadSchoolDashboard";
import { useOlympiadTeachers } from "@/hooks/olympiad/useOlympiadTeachers";
import { useOlympiadBatchesNoPin } from "@/hooks/olympiad/useOlympiadBatchesNoPin";
import { OlympiadPhasePill } from "@/components/olympiad/school/OlympiadPhasePill";
import {
  resolveOlympiadStage,
  type OlympiadStage,
} from "@/components/olympiad/school/olympiadStage";
import {
  OlympiadAiSuggestionCard,
  type AiSuggestion,
} from "@/components/olympiad/school/OlympiadAiSuggestionCard";
import { PublishResultsDialog } from "@/components/olympiad/school/PublishResultsDialog";
import type { OlympiadShellOutletContext } from "./OlympiadSchoolShell";

export default function OlympiadSchoolDashboardPage() {
  const navigate = useNavigate();
  const { openCloseEnrollment } = useOutletContext<OlympiadShellOutletContext>();
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: stats, isLoading: statsLoading } = useOlympiadSchoolDashboard(school?.id);
  const { data: teachers } = useOlympiadTeachers(school?.id);
  const { data: roleInfo } = useUserRole();
  const [publishOpen, setPublishOpen] = useState(false);

  // Stage as derived BEFORE hooks that depend on it would break the rules of
  // hooks, so resolve it leniently here (school may still be loading).
  const stage: OlympiadStage | null = school ? resolveOlympiadStage(school) : null;
  // Batch schedule only matters from the Schedule stage onwards — don't fetch
  // it while enrollment is still open.
  const { data: batches, isLoading: batchesLoading } = useOlympiadBatchesNoPin(
    stage !== null && stage >= 2 ? school?.id : undefined,
  );

  if (schoolLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (!school || stage === null) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
        This institution is not currently enrolled in the SALCI Olympiad. Please contact SALCI to onboard.
      </div>
    );
  }

  const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;
  const isAdmin = roleInfo?.isSchoolAdmin === true || roleInfo?.isSuperAdmin === true;
  const isOnboarded = school.is_existing_salci_school === false;

  const closesAt = school.enrollment_closes_at ? new Date(school.enrollment_closes_at) : null;
  const closesDateLabel = closesAt
    ? closesAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
    : null;

  // ---- AI suggestion engine -------------------------------------------------
  // One recommendation at a time, first matching rule wins. Driven entirely by
  // live query data, so completing a task (enrolling a student, closing
  // enrollment, locking the schedule, …) invalidates the cache and the card
  // advances to the next task on its own.
  const teacherCount = (teachers ?? []).length;
  const enrolled = stats?.totalEnrolled ?? 0;
  const teachersDone = `${teacherCount} teacher${teacherCount === 1 ? "" : "s"} ${isOnboarded ? "onboarded" : "assigned"}`;
  const studentsDone = `${enrolled} student${enrolled === 1 ? "" : "s"} enrolled`;

  let suggestion: AiSuggestion;
  if (stage === 1 && teacherCount === 0) {
    suggestion = {
      id: "onboard-teacher",
      title: isOnboarded ? "Start by onboarding a teacher" : "Start by assigning your teachers",
      reason: isOnboarded
        ? "Teachers enroll students from their class pages and supervise on exam day. Create their accounts first. Each gets login credentials to hand over."
        : "Pick the SALCI teachers who will run cash enrollment from their class pages and supervise on exam day.",
      done: [],
      actions: [
        {
          label: isOnboarded ? "Add a teacher" : "Assign teachers",
          icon: <GraduationCap className="h-4 w-4 mr-1" />,
          onClick: () => navigate("/school/olympiad/teachers", isOnboarded ? { state: { openAdd: true } } : undefined),
        },
      ],
    };
  } else if (stage === 1 && enrolled === 0) {
    suggestion = {
      id: "enroll-students",
      title: "Enroll your first student",
      reason: isOnboarded
        ? "Teachers are ready. Now get students in. Enroll them yourself, or share the online link so parents can enroll and pay from home."
        : "Teachers are ready. Now get students in. Teachers run cash enrollment from their class pages, or share the online link so parents can enroll from home.",
      done: [teachersDone],
      actions: [
        ...(isOnboarded
          ? [{
              label: "Enroll a student",
              icon: <UserPlus className="h-4 w-4 mr-1" />,
              onClick: () => navigate("/school/olympiad/students", { state: { openEnroll: true } }),
            }]
          : []),
        {
          label: "Share enrollment link",
          icon: <Share2 className="h-4 w-4 mr-1" />,
          onClick: () => navigate("/school/olympiad/marketing"),
        },
      ],
    };
  } else if (stage === 1) {
    suggestion = {
      id: "close-enrollment",
      title: "Close enrollment when everyone is in",
      reason:
        `${enrolled} student${enrolled === 1 ? " is" : "s are"} enrolled. Keep enrolling until every participant is in, then close enrollment to unlock exam scheduling.` +
        (closesDateLabel ? ` Enrollment is set to close on ${closesDateLabel}.` : ""),
      done: [teachersDone, studentsDone],
      actions: [
        {
          label: closesDateLabel ? "Manage closing date" : "Close enrollment",
          icon: <Lock className="h-4 w-4 mr-1" />,
          onClick: openCloseEnrollment,
        },
        {
          label: "Enroll more students",
          icon: <UserPlus className="h-4 w-4 mr-1" />,
          onClick: () => navigate("/school/olympiad/students", isOnboarded ? { state: { openEnroll: true } } : undefined),
        },
      ],
    };
  } else if (stage === 2) {
    const hasDraftBatches = (batches ?? []).length > 0;
    suggestion = {
      id: hasDraftBatches ? "lock-schedule" : "build-batches",
      title: hasDraftBatches ? "Lock the exam schedule" : "Build the exam batches",
      reason: hasDraftBatches
        ? "Your batches are drafted. Lock the schedule to generate the entry PINs students will use on exam day."
        : "Enrollment is closed. Build exam batches class by class and set a date and time for each. Your lab capacity caps the seats per batch.",
      done: ["Enrollment closed", studentsDone],
      actions: [
        {
          label: hasDraftBatches ? "Lock the schedule" : "Schedule batches",
          icon: <CalendarDays className="h-4 w-4 mr-1" />,
          onClick: () => navigate("/school/olympiad/batches"),
        },
      ],
    };
  } else if (stage === 3) {
    const now = Date.now();
    const upcoming = (batches ?? []).find(
      (b) => b.status !== "completed" && b.status !== "cancelled" && new Date(b.scheduled_at).getTime() > now,
    );
    const examDone = !batchesLoading && (batches ?? []).length > 0 && !upcoming;
    if (examDone) {
      suggestion = {
        id: "publish-results",
        title: "Publish the results",
        reason:
          "Every batch has run. Mark any remaining absentees (you can reschedule them into a new batch), then publish. Students get their results, certificates and emails.",
        done: ["Enrollment closed", "Schedule locked", "All batches run"],
        actions: [
          {
            label: "Publish results",
            variant: "destructive",
            onClick: () => setPublishOpen(true),
          },
          {
            label: "Mark absentees",
            icon: <UserX className="h-4 w-4 mr-1" />,
            onClick: () => navigate("/school/olympiad/absentees"),
          },
        ],
      };
    } else {
      const nextBatchLabel = upcoming
        ? new Date(upcoming.scheduled_at).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
          })
        : null;
      suggestion = {
        id: "exam-day",
        title: "Get ready for exam day",
        reason:
          (nextBatchLabel ? `Next batch runs on ${nextBatchLabel} (IST). ` : "") +
          "On the day, reveal each batch's entry PIN to its supervisor, and mark any no-shows afterwards.",
        done: ["Enrollment closed", "Schedule locked"],
        actions: [
          ...(isAdmin
            ? [{
                label: "Exam PINs",
                icon: <KeyRound className="h-4 w-4 mr-1" />,
                onClick: () => navigate("/school/olympiad/pin-custody"),
              }]
            : []),
          {
            label: "Mark absentees",
            icon: <UserX className="h-4 w-4 mr-1" />,
            onClick: () => navigate("/school/olympiad/absentees"),
          },
        ],
      };
    }
  } else {
    suggestion = {
      id: "results-out",
      title: "Explore how your students did",
      reason:
        "Results are live. Students can sign in for their results and certificates. Open Analytics for the full picture: average scores, where students lag by subject and concept, medals and toppers.",
      done: ["Exam completed", "Results published"],
      actions: [
        {
          label: "View analytics",
          icon: <BarChart3 className="h-4 w-4 mr-1" />,
          onClick: () => navigate("/school/olympiad/report"),
        },
        {
          label: "Publishing status",
          onClick: () => navigate("/school/olympiad/publish-status"),
        },
      ],
    };
  }

  return (
    <div className="space-y-5 py-4">
      {/* KPIs */}
      <section className="space-y-3">
        <header>
          <p className="eyebrow">At a glance</p>
        </header>
        {statsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
        ) : stats && (
          <StatTileGrid cols={2} mdCols={4}>
            {/* Action-first tiles: each opens its destination (sheets auto-open
                on the onboard/enroll pair for onboarded schools). */}
            <StatTile label="Onboard Teacher" value={(teachers ?? []).length.toString()} icon={<GraduationCap className="h-4 w-4" />} tone="violet"
              onClick={() => navigate("/school/olympiad/teachers", isOnboarded ? { state: { openAdd: true } } : undefined)} />
            <StatTile label="Enroll Student" value={stats.totalEnrolled.toString()} icon={<UserPlus className="h-4 w-4" />} tone="teal"
              onClick={() => navigate("/school/olympiad/students", isOnboarded ? { state: { openEnroll: true } } : undefined)} />
            <StatTile label="Classes Participating" value={school.participating_grade_level_ids.length.toString()} icon={<BookOpen className="h-4 w-4" />} tone="peach"
              onClick={() => navigate("/school/olympiad/students")} />
            <StatTile label="Total Revenue" value={rupees(stats.totalRupees)} icon={<Banknote className="h-4 w-4" />} tone="mint"
              onClick={() => navigate("/school/olympiad/revenue")} />
          </StatTileGrid>
        )}
      </section>

      {stats && stats.byClass.length > 0 && (
        <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
          <header>
            <p className="eyebrow">By class</p>
            <h3 className="text-base font-semibold text-ink-900">Enrollment breakdown</h3>
          </header>
          <ul className="divide-y divide-surface-stroke">
            {stats.byClass.map((c) => (
              <li key={c.grade_level_id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink-900">{c.grade_name}</span>
                <span className="text-ink-600">{c.count} student{c.count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OlympiadAiSuggestionCard
        suggestion={suggestion}
        badge={<OlympiadPhasePill phase={school.status} />}
      />

      {publishOpen && (
        <PublishResultsDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          olySchoolId={school.id}
          schoolName={school.institution_name}
          onSuccess={() => navigate("/school/olympiad/publish-status")}
        />
      )}
    </div>
  );
}
