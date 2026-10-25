import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  BookMarked,
  CalendarClock,
  CalendarDays,
  Check,
  Circle,
  CircleDot,
  ClipboardCheck,
  FileText,
  Pencil,
  RefreshCw,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SyllabusDaySheet } from "@/components/lesson-completion/SyllabusDaySheet";
import { DashboardScopeProvider } from "@/hooks/dashboard/DashboardScope";
import {
  useTeacherSyllabusChapters,
  syllabusCoveragePct,
  type SyllabusChapter,
  type SyllabusExam,
  type SyllabusSubjectDetail,
} from "@/hooks/dashboard/useTeacherDashboardData";
import { compareChapterOrder } from "@/lib/syllabusEntry";
import { ChapterStatusTag } from "@/components/lesson-completion/ChapterStatusTag";
import {
  CHAPTER_ROW_TINT,
  type ChapterTagStatus,
} from "@/components/lesson-completion/chapterStatusStyle";
import { cn, formatClassName } from "@/lib/utils";

/**
 * /teacher/my-syllabus: every chapter a teacher teaches, class by class, with
 * what has been logged against it and which held papers tested it.
 *
 * It reads dash_teacher_syllabus_chapters, the SAME call (and cache entry) as
 * the teacher dashboard's "Syllabus coverage" card, so the two can never
 * disagree. That function uses the platform's one chapter-set rule and counts
 * every held paper for the class, whoever set it: the same papers the Command
 * Center counts (migration 20260925150000).
 */
export default function TeacherSyllabusPage() {
  // The hook serves the teacher scope only; the provider is what says so.
  return (
    <DashboardScopeProvider scope="teacher">
      <SyllabusBody />
    </DashboardScopeProvider>
  );
}

type Filter = "all" | "untested" | "not-started";

const isTaught = (c: SyllabusChapter) => c.status === "completed" || c.status === "partial";
const isNotStarted = (c: SyllabusChapter) => c.status === "not_started" || c.status === "scheduled";

function subjectKey(s: SyllabusSubjectDetail) {
  return `${s.class_id}:${s.subject_id}`;
}

function SyllabusBody() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch, isRefetching } = useTeacherSyllabusChapters();
  const subjects = useMemo(() => data?.subjects ?? [], [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const active = subjects.find((s) => subjectKey(s) === picked) ?? subjects[0] ?? null;

  const header = (
    <PageHeader
      icon={<BookMarked className="h-5 w-5" />}
      title="My syllabus"
      subtitle="Every chapter you teach, what you have logged, and which exams tested it."
      primaryAction={{
        label: "Log progress",
        icon: <CalendarClock className="h-4 w-4" />,
        onClick: () => navigate("/teacher/my-week"),
      }}
    />
  );

  if (isLoading) {
    return (
      <PageShell>
        {header}
        <div className="space-y-4">
          <Skeleton className="h-10 w-full rounded-full" />
          <Skeleton className="h-28 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      </PageShell>
    );
  }

  // Error BEFORE empty (CLAUDE.md section 6): a failed call must never read as
  // "you have no subjects".
  if (isError) {
    return (
      <PageShell>
        {header}
        <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
          <EmptyState
            icon={<BookMarked className="h-7 w-7" />}
            title="Couldn't load your syllabus"
            description="Something went wrong reaching the server. This is not a change to your subjects."
            reason="error"
            tone="rose"
            action={{
              label: isRefetching ? "Trying again..." : "Try again",
              icon: <RefreshCw className="h-4 w-4" />,
              onClick: () => void refetch(),
            }}
          />
        </section>
      </PageShell>
    );
  }

  if (!active) {
    return (
      <PageShell>
        {header}
        <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
          <EmptyState
            icon={<BookMarked className="h-7 w-7" />}
            title="No subjects to show yet"
            description="Your syllabus appears here once you are assigned a class and subject."
            reason="noData"
          />
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {header}
      <div className="space-y-4">
        {subjects.length > 1 && (
          <MobileTabs
            value={subjectKey(active)}
            onValueChange={(v) => {
              setPicked(v);
              setFilter("all");
            }}
            options={subjects.map((s) => ({
              value: subjectKey(s),
              label: `${s.subject_name} · ${formatClassName(s.class_name, s.section)}`,
            }))}
          />
        )}
        <SubjectView subject={active} filter={filter} onFilter={setFilter} />
      </div>
    </PageShell>
  );
}

function SubjectView({
  subject: s,
  filter,
  onFilter,
}: {
  subject: SyllabusSubjectDetail;
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  // The same order as every chapter picker: syllabus order, then name.
  const chapters = useMemo(
    () =>
      [...s.chapters].sort((a, b) =>
        compareChapterOrder(
          { order: a.display_order, name: a.name },
          { order: b.display_order, name: b.name },
        ),
      ),
    [s.chapters],
  );

  const tested = chapters.filter((c) => c.exams_count > 0).length;
  const untested = chapters.filter((c) => isTaught(c) && c.exams_count === 0);
  const notStarted = chapters.filter(isNotStarted);
  const pct = syllabusCoveragePct(s);
  const pctDone = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  const pctPartial = s.total > 0 ? Math.round((s.partial / s.total) * 100) : 0;
  const lastLogged = chapters
    .map((c) => c.last_logged_on)
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  const shown = filter === "untested" ? untested : filter === "not-started" ? notStarted : chapters;
  const untagged = s.untagged_exams ?? [];
  const classLabel = formatClassName(s.class_name, s.section);

  // The day being edited: undefined = sheet closed, null = open on today with
  // the date field free, a date = open on that logged day.
  const [editDay, setEditDay] = useState<string | null | undefined>(undefined);
  const todayIso = localIso(new Date());

  return (
    <>
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="eyebrow">{s.subject_name} · {classLabel}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditDay(null)}>
            <CalendarDays className="h-4 w-4 mr-1" />
            Edit a past day
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[32px] font-bold leading-none tabular-nums text-ink-900">{pct}%</span>
          <span className="text-[13px] text-ink-500">
            covered
            {s.papers != null ? ` · ${s.papers} paper${s.papers === 1 ? "" : "s"} held this year` : ""}
            {lastLogged ? ` · last logged ${fmt(lastLogged)}` : " · nothing logged yet"}
          </span>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[hsl(var(--ink-400)/0.14)]">
          <div className="h-full bg-emerald-500" style={{ width: `${pctDone}%` }} />
          <div className="h-full bg-yellow-400" style={{ width: `${pctPartial}%` }} />
        </div>
        <p className="mt-2 text-[11.5px] text-ink-500">
          A chapter in progress counts as half a finished one, the same rule the Command Center uses.
        </p>
      </section>

      <StatTileGrid cols={2} mdCols={4}>
        <StatTile label="Completed" value={`${s.completed} of ${s.total}`} icon={<Check className="h-5 w-5" />} tone="mint" />
        <StatTile label="In progress" value={s.partial} icon={<CircleDot className="h-5 w-5" />} tone="peach" />
        <StatTile label="Not started" value={notStarted.length} icon={<Circle className="h-5 w-5" />} tone="rose" />
        <StatTile label="Tested in an exam" value={`${tested} of ${s.total}`} icon={<ClipboardCheck className="h-5 w-5" />} tone="teal" />
      </StatTileGrid>

      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <MobileTabs
          variant="segmented"
          value={filter}
          onValueChange={(v) => onFilter(v as Filter)}
          options={[
            { value: "all", label: "All chapters", count: chapters.length },
            { value: "untested", label: "Taught, not tested", count: untested.length },
            { value: "not-started", label: "Not started", count: notStarted.length },
          ]}
        />

        {shown.length === 0 ? (
          <EmptyState
            icon={<Check className="h-6 w-6" />}
            title={filter === "untested" ? "Every taught chapter has been tested" : "Every chapter has been started"}
            reason="noResults"
            tone="mint"
            size="sm"
          />
        ) : (
          <ul className="mt-3 list-none space-y-1.5 p-0">
            {shown.map((c) => (
              <ChapterRow key={c.topic_id} chapter={c} onOpenDay={setEditDay} />
            ))}
          </ul>
        )}
      </section>

      {/* A held paper that tags no chapter would otherwise vanish from a page
          that lists exams BY chapter. */}
      {untagged.length > 0 && (
        <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink-900">Papers with no chapter tagged</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Held for this class, but not linked to any chapter above.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {untagged.map((e) => (
              <ExamChip key={e.id} exam={e} />
            ))}
          </div>
        </section>
      )}

      <SyllabusDaySheet
        open={editDay !== undefined}
        onOpenChange={(o) => { if (!o) setEditDay(undefined); }}
        classId={s.class_id}
        subjectId={s.subject_id}
        className={classLabel}
        subjectName={s.subject_name}
        date={editDay ?? null}
        todayIso={todayIso}
      />
    </>
  );
}

/** Device-local YYYY-MM-DD (IST-only deployment, as the week page). */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The shared pill/row look: scheduled is still "Not started", with its plan date below. */
function tagStatus(c: SyllabusChapter): ChapterTagStatus {
  return c.status === "completed" ? "completed" : c.status === "partial" ? "partial" : "untouched";
}

/** The date line under the name. The pill already says the status in words. */
function dateLine(c: SyllabusChapter): string | null {
  switch (c.status) {
    case "completed":
      return c.first_completed_on ? `Finished ${fmt(c.first_completed_on)}` : null;
    case "partial":
      return c.last_logged_on ? `Last logged ${fmt(c.last_logged_on)}` : null;
    case "scheduled":
      return c.next_planned_on ? `Planned for ${fmt(c.next_planned_on)}` : null;
    default:
      return null;
  }
}

function ChapterRow({
  chapter: c,
  onOpenDay,
}: {
  chapter: SyllabusChapter;
  /** Open the day editor on one of this chapter's logged dates. */
  onOpenDay: (date: string) => void;
}) {
  const status = tagStatus(c);
  const line = dateLine(c);
  const exams = c.exams ?? [];
  const logs = c.logs ?? [];
  return (
    <li className={cn("rounded-lg border px-3 py-2.5", CHAPTER_ROW_TINT[status])}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 break-words text-sm font-medium text-ink-900">
            {c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.name}
          </p>
          <ChapterStatusTag status={status} />
        </div>
        {line && <p className="mt-0.5 text-xs text-ink-500">{line}</p>}
        {/* Every day this chapter was logged; tap one to change or remove it. */}
        {logs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-ink-500">Logged:</span>
            {logs.map((l) => (
              <Button
                key={l.date}
                type="button" size="sm" variant="outline"
                onClick={() => onOpenDay(l.date)}
                title="Change or remove this day's log"
                className={cn(
                  "h-6 gap-1 rounded-full px-2 text-[11px] font-medium",
                  l.action === "completed"
                    ? "border-emerald-300 bg-[hsl(var(--surface-card))] text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-200"
                    : "border-yellow-300 bg-[hsl(var(--surface-card))] text-yellow-800 dark:border-yellow-400/40 dark:text-yellow-200",
                )}
              >
                {l.action === "completed" ? <Check className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                {fmt(l.date)}
                <Pencil className="h-2.5 w-2.5 opacity-60" />
              </Button>
            ))}
          </div>
        )}
        {exams.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {exams.map((e) => (
              <ExamChip key={e.id} exam={e} />
            ))}
          </div>
        ) : isTaught(c) ? (
          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            Not tested in any exam yet
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ExamChip({ exam: e }: { exam: SyllabusExam }) {
  return (
    // surface-card, not a translucent tint: the chip sits on a status-tinted row.
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] px-2 py-0.5 text-[11px] text-ink-700">
      <FileText className="h-3 w-3 shrink-0 text-ink-500" />
      <span className="truncate">{e.title}</span>
      <span className="shrink-0 text-ink-500">· {fmt(e.held_on)}</span>
    </span>
  );
}

function fmt(iso: string): string {
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, "d MMM");
}
