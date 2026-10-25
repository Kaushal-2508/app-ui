import { BookOpen } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeacherWeakChapters } from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.5 — "Weak chapters": one ranked list across EVERY subject the teacher
 * teaches, each row tagged with its subject. No per-subject tabs, by design.
 *
 * SOURCE NOTE: the spec named concept_mastery + student_topic_performance. Both
 * are empty in prod with no writer, so this reads exam_questions.tags joined
 * through the teacher's own graded answers instead. That means a chapter only
 * appears once the teacher has actually examined it — which is the honest
 * boundary, and why the empty state says so rather than showing zero bars.
 */
export function TeacherWeakChapters() {
  const { data, isLoading, isError } = useTeacherWeakChapters();

  if (isLoading) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <Skeleton className="h-6 w-40" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  const chapters = data?.chapters ?? [];

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink-900">Weak chapters</h3>
        {chapters.length > 0 && (
          <span className="shrink-0 rounded-full bg-[hsl(var(--ink-400)/0.1)] px-2.5 py-1 text-[12px] font-medium text-ink-600">
            By topic mastery
          </span>
        )}
      </div>

      {isError ? (
        <div className="mt-4">
          <EmptyState
            icon={<BookOpen className="h-7 w-7" />}
            title="Couldn't load chapter mastery"
            description="Something went wrong. Refresh to try again."
            reason="error"
            tone="rose"
          />
        </div>
      ) : chapters.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<BookOpen className="h-7 w-7" />}
            title="Not enough graded questions yet"
            description="Chapter mastery is built from tagged questions on exams you created and graded. It fills in once a few of your papers are marked."
            tone="teal"
            size="sm"
          />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-500">
            What to re-teach next. Every subject you teach, one list, weakest first.
          </p>
          <ul className="mt-4 list-none space-y-2.5 p-0">
            {chapters.map((ch) => (
              <li
                key={`${ch.subject_name}:${ch.tag}`}
                className="rounded-2xl border border-[hsl(var(--surface-stroke))] p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium capitalize text-ink-900">
                    {ch.tag}
                  </p>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink-900">
                    {ch.mastery_pct}%
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] leading-[18px] text-ink-500">
                  {ch.subject_name} · {ch.below_50} of {ch.students} students below 50%
                </p>
                {/* Track with a 50% threshold marker, per the mockup. */}
                <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--ink-400)/0.12)]">
                  <div
                    className="h-full rounded-full bg-brand-primary"
                    style={{ width: `${Math.max(2, Math.min(100, ch.mastery_pct))}%` }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-[hsl(var(--ink-900)/0.35)]"
                    style={{ left: "50%" }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
