import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BookMarked, CalendarClock, Check, ChevronDown, Circle } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClassName, cn } from "@/lib/utils";
import {
  useTeacherSyllabusChapters,
  syllabusCoveragePct,
  type SyllabusChapter,
  type SyllabusSubjectDetail,
} from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.8 — syllabus coverage.
 *
 * An earlier version listed all 30 chapters as two flat lists with a status chip
 * on every row. It was accurate and unreadable: seventeen identical "Done" chips
 * tell a teacher nothing they can act on.
 *
 * This version answers three questions in order of usefulness:
 *   1. How far through am I?          -> one percentage + a segmented bar
 *   2. What have I taught but NOT tested?  -> the actionable gap, opened by default
 *   3. What is left to teach?         -> collapsed until wanted
 *
 * "Taught but not tested" is the insight the raw chapter list buried: a chapter
 * marked complete with zero exams covering it is the one thing here a teacher can
 * fix this week.
 *
 * Still no "on track / behind" language: there is no per-chapter due date in the
 * schema to judge against, so coverage and recency are all we can honestly claim.
 */
export function TeacherSyllabusCoverage() {
  const { data, isLoading, isError } = useTeacherSyllabusChapters();

  if (isLoading) {
    return (
      <Shell>
        <Skeleton className="h-32 w-full rounded-2xl" />
      </Shell>
    );
  }

  if (isError) {
    return (
      <Shell>
        <EmptyState
          icon={<BookMarked className="h-7 w-7" />}
          title="Couldn't load syllabus coverage"
          description="Something went wrong. Refresh to try again."
          reason="error"
          tone="rose"
          size="sm"
        />
      </Shell>
    );
  }

  const subjects = data?.subjects ?? [];

  if (subjects.length === 0) {
    return (
      <Shell>
        <EmptyState
          icon={<BookMarked className="h-7 w-7" />}
          title="No subjects to track yet"
          description="Coverage appears once you have a class and subject assignment."
          tone="teal"
          size="sm"
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-4">
        {subjects.map((s) => (
          <SubjectBlock key={`${s.class_id}:${s.subject_id}`} subject={s} />
        ))}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink-900">Syllabus coverage</h3>
        <span className="shrink-0 rounded-full bg-[hsl(var(--ink-400)/0.1)] px-2.5 py-1 text-[12px] font-medium text-ink-600">
          Your subjects only
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SubjectBlock({ subject: s }: { subject: SyllabusSubjectDetail }) {
  const navigate = useNavigate();
  // Collapses the whole block — bar, groups and action — leaving the headline
  // percentage. A teacher with several subjects can fold the ones they are not
  // working on rather than scrolling past each in full.
  const [open, setOpen] = React.useState(true);

  const taught = s.chapters.filter((c) => c.status === "completed" || c.status === "partial");
  const untested = taught.filter((c) => c.exams_count === 0);
  const tested = taught.filter((c) => c.exams_count > 0);
  const scheduled = s.chapters.filter((c) => c.status === "scheduled");
  const notStarted = s.chapters.filter((c) => c.status === "not_started");

  // The headline uses the Command Center's rule (a partly-done chapter counts
  // as half), so the teacher and the principal see one number. The bar keeps
  // its two plain segments: finished share in green, partly-done share in amber.
  const pctCoverage = syllabusCoveragePct(s);
  const pctDone = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  const pctPartial = s.total > 0 ? Math.round((s.partial / s.total) * 100) : 0;

  const lastLogged = s.chapters
    .map((c) => c.last_logged_on)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <div className="rounded-2xl border border-[hsl(var(--surface-stroke))] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
      >
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-ink-900">
            {s.subject_name} · {formatClassName(s.class_name, s.section)}
          </span>
          <span className="mt-2 flex items-baseline gap-2">
            <span className="text-[28px] font-bold leading-none tabular-nums text-ink-900">
              {pctCoverage}%
            </span>
            <span className="text-[13px] text-ink-500">
              {s.completed} of {s.total} chapters
              {s.partial > 0 ? `, ${s.partial} in progress` : ""}
              {lastLogged ? ` · last logged ${fmt(lastLogged)}` : " · never logged"}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            "mt-1 h-5 w-5 shrink-0 text-ink-400 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {/* One segmented bar replaces the old bar-plus-four-chips: the same facts,
          read in a single glance instead of five. Stays visible when collapsed so
          the headline still carries the shape of the progress. */}
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[hsl(var(--ink-400)/0.14)]">
        <div className="h-full bg-emerald-500" style={{ width: `${pctDone}%` }} />
        <div className="h-full bg-yellow-400" style={{ width: `${pctPartial}%` }} />
      </div>

      {open && (
      <div className="mt-3 space-y-2">
        {/* The one genuinely actionable group, so it opens by default. */}
        <Group
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="bg-amber-500/10 text-amber-600"
          title="Taught but not tested"
          hint="No exam for this class has covered these yet"
          chapters={untested}
          defaultOpen
        />
        <Group
          icon={<Check className="h-4 w-4" />}
          tone="bg-emerald-500/10 text-emerald-600"
          title="Taught and tested"
          hint="Covered in class and in at least one exam"
          chapters={tested}
        />
        {scheduled.length > 0 && (
          <Group
            icon={<CalendarClock className="h-4 w-4" />}
            tone="bg-sky-500/10 text-sky-600"
            title="Scheduled"
            hint="A lesson is planned for these"
            chapters={scheduled}
          />
        )}
        <Group
          icon={<Circle className="h-4 w-4" />}
          tone="bg-slate-500/10 text-slate-600"
          title="Not started"
          hint="Nothing logged against these yet"
          chapters={notStarted}
        />
      </div>
      )}

      {open && (
        /* Chapter progress is recorded against a timetable slot in My Week (the
           lesson-completion flow), not in /school/syllabus — that page is the
           curriculum editor and has no per-class logging. */
        <button
          type="button"
          onClick={() => navigate("/teacher/my-week")}
          className="mt-3 flex w-full items-center justify-between border-t border-[hsl(var(--surface-stroke))] pt-3 text-[13px] font-semibold text-brand-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
        >
          Log chapter progress <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}

/**
 * A count-first row that expands into its chapters. The count is the headline —
 * a teacher decides whether to open it from the number alone.
 */
function Group({
  icon,
  tone,
  title,
  hint,
  chapters,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  hint: string;
  chapters: SyllabusChapter[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [showAll, setShowAll] = React.useState(false);

  if (chapters.length === 0) return null;

  const rows = showAll ? chapters : chapters.slice(0, 5);
  const hidden = chapters.length - rows.length;

  return (
    <div className="rounded-xl bg-[hsl(var(--ink-400)/0.04)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 p-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
      >
        <span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", tone)}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-ink-900">
            {chapters.length} {title.toLowerCase()}
          </span>
          <span className="block truncate text-[11.5px] text-ink-500">{hint}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="px-2.5 pb-2.5">
          <ul className="list-none divide-y divide-[hsl(var(--surface-stroke))] p-0">
            {rows.map((c) => (
              <li key={c.topic_id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">{c.name}</span>
                {c.exams_count > 0 && (
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-500">
                    {c.exams_count} exam{c.exams_count === 1 ? "" : "s"}
                  </span>
                )}
                {c.status === "scheduled" && c.next_planned_on && (
                  <span className="shrink-0 text-[11.5px] text-ink-500">
                    {fmt(c.next_planned_on)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-1.5 text-[12px] font-semibold text-brand-primary hover:underline"
            >
              Show {hidden} more
            </button>
          )}
          {showAll && chapters.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-1.5 text-[12px] font-semibold text-ink-500 hover:underline"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function fmt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
