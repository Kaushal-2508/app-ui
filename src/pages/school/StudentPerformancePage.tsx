import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, UserX, BarChart3 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";
import { DownloadReportButton } from "@/components/student/DownloadReportButton";
import { StudentReportView } from "@/components/student/StudentReportView";
import { StudentScopeProvider } from "@/contexts/StudentScopeContext";
import {
  StudentStatusStrip,
  AttendanceDonut,
  ScoreTrendCard,
  SubjectSnapshotCard,
  SuggestionsCard,
  AchievementsSection,
} from "@/components/student/dashboard";
import { useStudentYearReport } from "@/hooks/useStudentYearReport";
import { formatClassName } from "@/lib/utils";

/**
 * Staff view of ONE student's academic record (/school/student/:studentId).
 *
 * Renders from public.student_year_report_for, the SAME payload the downloadable
 * PDF is built from, so what a teacher reads on screen and what the parent
 * receives on paper cannot disagree. Authorisation is enforced by that RPC
 * (migration 20260824120000), not by this page: reaching an admin screen is not
 * a permission, and an unauthorised student id returns an error here rather
 * than data.
 *
 * REPLACES the previous implementation, which read useStudentPerformanceDetail
 * and printed via src/lib/pdf/studentReport.ts. That surface showed OVERALL
 * ACCURACY, AVG TIME/QUESTION and AVG EFFICIENCY, all derived from per-question
 * timing that is recorded on ~17% of attempts, so it displayed 0.0% / 0s / 0.00
 * for most students. Both of those modules are now unused by any page.
 */
export default function StudentPerformancePage() {
  const { studentId } = useParams();
  const navigate = useNavigate();

  // Identity only. Every number on the page comes from the report payload.
  const { data: student, isLoading: idLoading } = useQuery({
    queryKey: ["student-identity", studentId],
    enabled: !!studentId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!studentId) return null;
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, roll_number, admission_number")
        .eq("id", studentId)
        .maybeSingle();
      if (error) throw error;
      if (!profile) return null;

      const { data: enrolment } = await supabase
        .from("class_assignments")
        .select("classes:class_id(name, section)")
        .eq("user_id", studentId)
        .eq("role", "student")
        .limit(1)
        .maybeSingle();

      type ClassRow = { name: string | null; section: string | null };
      const raw = (enrolment as { classes: ClassRow | ClassRow[] | null } | null)?.classes ?? null;
      const cls = Array.isArray(raw) ? (raw[0] ?? null) : raw;

      return {
        id: profile.id,
        name: profile.full_name ?? "Student",
        email: profile.email ?? null,
        rollNumber: profile.roll_number ?? null,
        admissionNumber: profile.admission_number ?? null,
        className: cls?.name ?? null,
        section: cls?.section ?? null,
      };
    },
  });

  const {
    data: report,
    isLoading: reportLoading,
    isError,
    error,
  } = useStudentYearReport(!!studentId, studentId);

  if (idLoading) {
    return (
      <PageShell>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64 rounded-card" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 rounded-card" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-card" />
        </div>
      </PageShell>
    );
  }

  if (!student) {
    return (
      <PageShell>
        <EmptyState
          icon={<UserX className="h-7 w-7" />}
          title="Student not found"
          description="No profile exists for this id."
          action={{ label: "Go back", onClick: () => navigate(-1) }}
        />
      </PageShell>
    );
  }

  const classLine = student.className
    ? formatClassName(student.className, student.section)
    : null;

  return (
    <PageShell>
      <div className="space-y-6">
        <div className="space-y-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard?tab=students")}
            className="-ml-2 text-ink-700 hover:text-ink-900"
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
          </Button>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary text-xl font-bold">
                {student.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-[26px] leading-[32px] font-bold text-ink-900 sm:text-[32px] sm:leading-[40px] tracking-tight">
                  {student.name}
                </h1>
                <p className="mt-1.5 text-sm sm:text-[15px] text-ink-600 line-clamp-2">
                  {[classLine, student.email].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>

            <DownloadReportButton
              studentId={student.id}
              student={{
                name: student.name,
                className: student.className,
                section: student.section,
                rollNumber: student.rollNumber,
                admissionNumber: student.admissionNumber,
              }}
              label="Download Report"
              className="shrink-0 w-full sm:w-auto"
            />
          </div>
        </div>

        {/* Error BEFORE empty (§6): an authorisation failure must never read as
            "this student has no results". */}
        {isError ? (
          <EmptyState
            icon={<UserX className="h-7 w-7" />}
            tone="rose"
            title="Couldn't load this student's record"
            description={
              /not authorized/i.test(String((error as Error)?.message ?? ""))
                ? "You don't have access to this student. Teachers see the students they teach; coordinators see their wing."
                : "Please try again in a moment."
            }
          />
        ) : reportLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-28 rounded-card" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-card" />
          </div>
        ) : !report || report.snapshot.n_assessments === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-7 w-7" />}
            title="No published results in this period"
            description={`${student.name} has no published assessments yet, so there is nothing to summarise.`}
          />
        ) : (
          /*
           * The student's OWN dashboard, rendered for staff.
           *
           * StudentScopeProvider makes the subject ambient, so every section
           * below is the identical component the student sees rather than a
           * staff-only re-implementation that could drift from it. The scoped
           * hooks call the `_for` RPC variants, which are authorised
           * server-side - setting the scope is a request, not a permission.
           *
           * Deliberately omitted: NeedsAttentionCard and ImportantNoticesCard.
           * Both surface the student's personal message and notice inbox, which
           * is correspondence rather than academic record, so it is not opened
           * up to every teacher by default.
           */
          <StudentScopeProvider studentId={student.id}>
            <div className="space-y-4 sm:space-y-5 lg:space-y-6">
              <StudentStatusStrip />
              <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 lg:gap-6">
                <AttendanceDonut />
                <ScoreTrendCard />
              </div>
              <SubjectSnapshotCard />
              <SuggestionsCard />
              <AchievementsSection />

              <details className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
                <summary className="cursor-pointer text-sm font-semibold text-ink-900">
                  Full record and report detail
                </summary>
                <div className="mt-4">
                  <StudentReportView report={report} />
                </div>
              </details>
            </div>
          </StudentScopeProvider>
        )}
      </div>
    </PageShell>
  );
}
