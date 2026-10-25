import { useState, useMemo } from "react";
import { NavLink } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadReviewQuestions } from "@/hooks/olympiad/useOlympiadReviewQuestions";
import { ReviewQuestionItem } from "@/components/olympiad/student/ReviewQuestionItem";

export default function OlympiadStudentReviewPage() {
  const { data: dashboardCtx } = useOlympiadStudentDashboard();
  const attemptId = dashboardCtx?.ok ? dashboardCtx.attempt?.id : undefined;
  const { data: questions, isLoading } = useOlympiadReviewQuestions(attemptId);
  const subjects = dashboardCtx?.ok ? dashboardCtx.subjects : [];
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);

  const filteredQuestions = useMemo(() => {
    if (!activeSubjectId) return questions ?? [];
    return (questions ?? []).filter((q) => q.subject_id === activeSubjectId);
  }, [questions, activeSubjectId]);

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      </PageShell>
    );
  }

  if (!dashboardCtx?.ok || !attemptId) {
    return (
      <PageShell>
        <p className="py-6 text-sm text-ink-600">No attempt to review.</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <NavLink
        to="/student/olympiad"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader
        title="Review your answers"
        subtitle={`${filteredQuestions.length} questions`}
      />

      <nav className="flex gap-2 overflow-x-auto scrollbar-hide py-2" role="tablist">
        <button
          onClick={() => setActiveSubjectId(null)}
          className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
            activeSubjectId === null
              ? "bg-brand-primary text-white"
              : "bg-surface-card text-ink-700"
          }`}
        >
          All
        </button>
        {subjects.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSubjectId(s.id)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeSubjectId === s.id
                ? "bg-brand-primary text-white"
                : "bg-surface-card text-ink-700"
            }`}
          >
            {s.name}
          </button>
        ))}
      </nav>

      <div className="space-y-4 py-4">
        {filteredQuestions.map((q) => (
          <ReviewQuestionItem key={q.snapshot_id} question={q} />
        ))}
      </div>
    </PageShell>
  );
}
