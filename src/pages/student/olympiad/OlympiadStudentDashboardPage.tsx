import { useNavigate, NavLink } from "react-router-dom";
import { Loader2, BookOpen, ChevronRight, CheckCircle2 } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadStudentStudyMaterials } from "@/hooks/olympiad/useOlympiadStudentStudyMaterials";
import { useOlympiadPublishedResult } from "@/hooks/olympiad/useOlympiadPublishedResult";
import { BatchCountdown } from "@/components/olympiad/student/BatchCountdown";
import { StudyMaterialItem } from "@/components/olympiad/student/StudyMaterialItem";
import { PublishedResultCard } from "@/components/olympiad/student/PublishedResultCard";
import { StudentPerformanceAnalysis } from "@/components/olympiad/student/StudentPerformanceAnalysis";

export default function OlympiadStudentDashboardPage() {
  const navigate = useNavigate();
  const { data: ctx, isLoading } = useOlympiadStudentDashboard();
  const subjectIds = ctx?.ok ? ctx.student.subject_ids : undefined;
  const gradeLevelId = ctx?.ok ? ctx.student.grade_level_id : undefined;
  const { data: materials } = useOlympiadStudentStudyMaterials(subjectIds, gradeLevelId);
  const { data: publishedResult } = useOlympiadPublishedResult();

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      </PageShell>
    );
  }
  if (!ctx?.ok) {
    return (
      <PageShell>
        <PageHeader title="SALCI Olympiad" />
        <p className="py-6 text-sm text-ink-600">No active Olympiad enrollment for your account.</p>
      </PageShell>
    );
  }

  // Use IST date comparison — toDateString() uses browser local timezone which
  // produces wrong results for non-IST devices on an India-only exam.
  const istDate = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const isExamDay =
    ctx.batch !== null &&
    istDate(new Date(ctx.batch.scheduled_at)) === istDate(new Date());

  // Whether the exam is behind the student. While it is still ahead, study
  // material is the priority and moves to the top; once done it sits below the
  // result + analysis.
  const attemptSubmitted = !!ctx.attempt && ctx.attempt.status !== "in_progress";
  const examOver = (publishedResult?.ok ?? false) || attemptSubmitted;

  const studyZone = (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="eyebrow">Your subjects</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ctx.subjects.map((s) => (
            <NavLink
              key={s.id}
              to={`/student/olympiad/study/${s.id}`}
              className="group flex items-center justify-between gap-2 rounded-xl border border-surface-stroke bg-surface-card px-3.5 py-3 transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/[0.05]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <BookOpen className="h-4 w-4 shrink-0 text-brand-primary" />
                <span className="truncate text-sm font-semibold text-ink-900">{s.name}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-400 transition-colors group-hover:text-brand-primary" />
            </NavLink>
          ))}
        </div>
      </section>

      {(materials ?? []).length > 0 && (
        <section className="space-y-2">
          <p className="eyebrow">Study material</p>
          <div className="space-y-2">
            {(materials ?? []).map((m) => (
              <StudyMaterialItem key={m.id} material={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle={`${ctx.school_name} · Roll ${ctx.student.roll_number}`}
      />
      <div className="space-y-4 py-4">
        {publishedResult?.ok ? (
          <PublishedResultCard result={publishedResult} />
        ) : (
          <div className="surface-card frosted-shadow rounded-card p-6 text-center">
            <p className="eyebrow">Your exam</p>
            {ctx.attempt && ctx.attempt.status !== "in_progress" ? (
              <div className="space-y-2 mt-3">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
                <p className="text-base font-semibold text-ink-900">Exam submitted</p>
                {ctx.attempt.submitted_at && (
                  <p className="text-xs text-ink-500">
                    Submitted on {new Date(ctx.attempt.submitted_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </p>
                )}
                <p className="text-sm text-ink-700 mt-2">
                  Your results will be published by your school soon.
                </p>
              </div>
            ) : ctx.attempt && ctx.attempt.status === "in_progress" ? (
              <div className="space-y-3 mt-3">
                <p className="text-sm text-ink-700">You have an exam in progress.</p>
                <Button
                  className="w-full"
                  onClick={() => navigate("/student/olympiad/exam")}
                >
                  Resume exam
                </Button>
              </div>
            ) : ctx.batch ? (
              <>
                <p className="text-sm text-ink-700 mt-1">
                  {new Date(ctx.batch.scheduled_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "full",
                    timeStyle: "short",
                  })}
                </p>
                <div className="mt-4">
                  <BatchCountdown scheduledAt={ctx.batch.scheduled_at} />
                </div>
                <Button
                  className="w-full mt-4"
                  onClick={() => navigate("/student/olympiad/pin-entry")}
                  disabled={!isExamDay}
                  title={isExamDay ? undefined : "Available on exam day"}
                >
                  {isExamDay ? "Start exam" : "Available on exam day"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-ink-600 mt-2">Your batch will be announced by your school.</p>
            )}
          </div>
        )}

        {/* Exam still ahead → study material is the priority, show it first. */}
        {!examOver && studyZone}

        {/* Performance intelligence — per-topic accuracy, benchmark and time
            analysis from the published attempt */}
        {publishedResult?.ok && publishedResult.certificate_tier !== "absent" && (
          <StudentPerformanceAnalysis />
        )}

        {/* Exam done → study material sits below the result + analysis. */}
        {examOver && studyZone}
      </div>
    </PageShell>
  );
}
