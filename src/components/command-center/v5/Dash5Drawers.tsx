import { useState } from "react";

import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  useDash5NeverSignedIn,
  useDash5PaperDetail,
  useDash5StudentContext,
  useDash5SubjectChapters,
  useDash5CreateTask,
  useDash5SubjectRoster,
} from "@/hooks/dashboard/useDash5";

import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { toastError } from "@/lib/toast";

import { AssignPanel, type AssignScope } from "./AssignPanel";
import {
  Dash5Drawer, DrawerActions, DrawerHint, DrawerNote, DrawerSection, DrawerTabs,
  MiniStats, type MiniStat,
} from "./Drawer";
import { CH_STATE, pct0, pct1 } from "./format";
import {
  BandPill, BarRow, BarsH, TradTable, V5Empty, V5Error, V5Loading, tdBase, thBase,
} from "./primitives";

/**
 * The detail panels of public/report_reference/salci-admin-dashboard-v5.html.
 *
 * The reference has seven; they collapse to five here because a subject's
 * coverage, its roster and its assign panel are three views of the same
 * (class, subject) pair and belong in one drawer rather than three.
 *
 * Each one only fetches while it is open, so a page that renders six drawers
 * costs six requests the first time each is opened and none before that.
 */

const CRIT = "hsl(var(--dash-critical))";
const WARN = "hsl(var(--dash-warning))";
const EXC = "hsl(var(--dash-exc))";

/** The same cuts dash5_band uses, so a pill here matches a pill anywhere. */
function bandOf(v: number) {
  if (v >= 82) return "exc" as const;
  if (v >= 74) return "good" as const;
  if (v >= 66) return "watch" as const;
  return "att" as const;
}

/** Marks below the 35% pass line are red, below 60 amber, otherwise plain. */
function markTone(v: number | null | undefined) {
  if (v == null) return undefined;
  if (v < 35) return CRIT;
  if (v < 60) return WARN;
  return undefined;
}

/* ============================================================ assign ====== */

export function AssignDrawer({
  open, onOpenChange, scope, title, subtitle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: AssignScope | null;
  title: string;
  subtitle?: string;
}) {
  return (
    <Dash5Drawer open={open} onOpenChange={onOpenChange} title={title} subtitle={subtitle}>
      {scope && <AssignPanel scope={scope} />}
    </Dash5Drawer>
  );
}

/* =========================================================== subject ====== */

type SubjectView = "coverage" | "students" | "assign";

/**
 * One subject in one class: the fourth level of the performance tree. Coverage
 * is the landing view because that is what the row above it was showing.
 */
export function SubjectDrawer({
  open, onOpenChange, classId, classLabel, subjectId, subjectName, teacher,
  initialView = "coverage",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  classId: string | null;
  classLabel: string | null;
  subjectId: string | null;
  subjectName: string;
  teacher?: string | null;
  /** Which tab to land on. The adoption table opens straight onto the roster,
   *  because that is the question the row it came from was about. */
  initialView?: SubjectView;
}) {
  const [view, setView] = useState<SubjectView>(initialView);

  return (
    <Dash5Drawer
      open={open}
      onOpenChange={(v) => {
        if (!v) setView(initialView);
        onOpenChange(v);
      }}
      title={subjectName}
      subtitle={[classLabel, teacher].filter(Boolean).join(" · ") || undefined}
    >
      <DrawerTabs
        value={view}
        // Passing setView directly would make TypeScript infer the tab union
        // from SetStateAction rather than from `value`, and widen it to string.
        onChange={(v) => setView(v)}
        items={[
          { value: "coverage", label: "Coverage" },
          { value: "students", label: "Students" },
          { value: "assign", label: "Assign" },
        ]}
      />
      {view === "coverage" && <SubjectCoverage classId={classId} subjectId={subjectId} />}
      {view === "students" && <SubjectRoster classId={classId} subjectId={subjectId} />}
      {view === "assign" && classId && subjectId && (
        <AssignPanel scope={{ classId, subjectId }} />
      )}
    </Dash5Drawer>
  );
}

function SubjectCoverage({ classId, subjectId }: { classId: string | null; subjectId: string | null }) {
  const q = useDash5SubjectChapters(classId, subjectId);

  if (q.isLoading) return <V5Loading label="Loading chapters…" />;
  if (q.isError) {
    return <V5Error label="Couldn't load this subject's chapters." onRetry={() => void q.refetch()} />;
  }

  const chapters = q.data?.chapters ?? [];
  if (chapters.length === 0) {
    return (
      <V5Empty
        title="No syllabus loaded for this subject"
        sub="Coverage cannot be measured until its chapters are added under Syllabus."
      />
    );
  }

  const done = chapters.filter((c) => c.state === "done").length;
  const partial = chapters.filter((c) => c.state === "partial").length;
  const notStarted = chapters.length - done - partial;
  const cov = ((done * 2 + partial) / (chapters.length * 2)) * 100;
  const inProgress = chapters.find((c) => c.state === "partial");

  const st = q.data?.stats ?? null;

  const stats: MiniStat[] = [
    { label: "Average score", value: pct0(st?.accuracy), tone: markTone(st?.accuracy) },
    { label: "Coverage", value: `${Math.round(cov)}%`, tone: cov < 40 ? CRIT : cov < 70 ? WARN : EXC },
    { label: "Homework", value: pct0(st?.homework_pct), tone: markTone(st?.homework_pct) },
  ];
  // The reference's second row: the raw counts behind the percentages above.
  const counts: MiniStat[] = [
    { label: "Chapters done", value: `${done} / ${chapters.length}`, small: true },
    { label: "Lesson plans", value: `${st?.lessons_taught ?? 0} / ${st?.lessons_planned ?? 0}`, small: true },
    { label: "Papers", value: st?.papers ?? 0, small: true },
  ];

  const gap = st?.accuracy != null && st.class_accuracy != null
    ? Math.round((st.accuracy - st.class_accuracy) * 10) / 10
    : null;

  return (
    <>
      {st?.accuracy == null && (
        <p className="mb-3 text-[11.5px] font-medium text-ink-400">Not assessed yet</p>
      )}
      <MiniStats items={stats} />
      <MiniStats items={counts} />

      <DrawerSection title="Chapter coverage">
        <TradTable>
          <thead>
            <tr>
              <th className={cn(thBase, "w-10")}>#</th>
              <th className={thBase}>Chapter</th>
              <th className={cn(thBase, "w-[128px]")}>Status</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((c, i) => {
              const st = CH_STATE[c.state];
              return (
                <tr key={c.topic_id} className={i % 2 === 1 ? "bg-surface-stroke/25" : undefined}>
                  <td className={cn(tdBase, "text-right font-bold tabular-nums text-ink-400")}>
                    {c.chapter_number ?? i + 1}
                  </td>
                  <td className={cn(tdBase, c.state === "none" && "text-ink-400")}>{c.name}</td>
                  <td className={tdBase}>
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-bold"
                      style={{
                        color: `hsl(var(${st.varName}))`,
                        background: `hsl(var(${st.varName}) / 0.12)`,
                        borderColor: `hsl(var(${st.varName}) / 0.26)`,
                      }}
                    >
                      <span className="text-[9px] leading-none" aria-hidden>{st.glyph}</span>
                      {st.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-stroke/50 font-bold">
              <td className={cn(tdBase, "border-t-2 border-t-ink-400")} />
              <td className={cn(tdBase, "border-t-2 border-t-ink-400")}>
                {done} done · {partial} partly done · {notStarted} not started
              </td>
              <td className={cn(tdBase, "border-t-2 border-t-ink-400 tabular-nums")}>
                {Math.round(cov)}%
              </td>
            </tr>
          </tfoot>
        </TradTable>
        <DrawerHint>
          A partly-done chapter counts as half a finished one, which is how {Math.round(cov)}% is
          arrived at: ({done} × 1 + {partial} × ½) ÷ {chapters.length}.
        </DrawerHint>
      </DrawerSection>

      <DrawerSection title="Where this lands">
        <DrawerNote tone={cov < 40 ? "critical" : cov < 70 ? "warning" : "brand"}>
          {/* The comparison is the point of this note. A subject's 8.5% says
              nothing until it sits beside the class it is part of. */}
          {st?.accuracy == null ? (
            <>
              No paper has been conducted in <b>{q.data?.subject_name}</b> for{" "}
              {q.data?.class_label} this year, so it contributes nothing to the class average. That
              figure of <b>{pct0(st?.class_accuracy)}</b> rests on{" "}
              {st?.class_subjects_assessed ?? 0} of {st?.class_subjects ?? 0} subjects.
            </>
          ) : (
            <>
              <b>{q.data?.subject_name}</b> sits{" "}
              {gap == null || Math.abs(gap) < 1
                ? "level with"
                : gap > 0
                  ? `${gap} points above`
                  : `${Math.abs(gap)} points below`}{" "}
              the {q.data?.class_label} average of {pct0(st.class_accuracy)}, on{" "}
              {(st.attempts ?? 0).toLocaleString()} attempts across {st.papers ?? 0} paper
              {st.papers === 1 ? "" : "s"}.
            </>
          )}
          {inProgress ? (
            <>
              {" "}Currently teaching <b>{inProgress.name}</b>.
            </>
          ) : null}
          {notStarted > 0 && (
            <>
              {" "}
              {notStarted} chapter{notStarted === 1 ? " has" : "s have"} not been started yet.
            </>
          )}
        </DrawerNote>
      </DrawerSection>
    </>
  );
}

function SubjectRoster({ classId, subjectId }: { classId: string | null; subjectId: string | null }) {
  const q = useDash5SubjectRoster(classId, subjectId);

  if (q.isLoading) return <V5Loading label="Loading the roster…" />;
  if (q.isError) {
    return <V5Error label="Couldn't load the students for this subject." onRetry={() => void q.refetch()} />;
  }
  const d = q.data;
  if (!d || d.total === 0) {
    return <V5Empty title="Nobody is on this class roster" sub="Add students to the class to see them here." />;
  }
  if (d.scored === 0) {
    return (
      <>
        <DrawerNote tone="warning">
          No paper has been marked in this subject this year, so there is nothing to rank{" "}
          {d.total} students by. The class average you drilled from rests on the subjects
          that have been examined.
        </DrawerNote>
        <DrawerHint>Open the Assign tab to ask for the first paper.</DrawerHint>
      </>
    );
  }

  const stats: MiniStat[] = [
    { label: "Lowest", value: pct0(d.lowest), tone: markTone(d.lowest) },
    { label: "Median", value: pct0(d.median), tone: markTone(d.median) },
    { label: "Highest", value: pct0(d.highest) },
  ];

  return (
    <>
      <MiniStats items={stats} />

      <DrawerSection title="Worst performing first">
        <TradTable>
          <thead>
            <tr>
              <th className={thBase}>Student</th>
              <th className={cn(thBase, "text-right")}>This subject</th>
              <th className={cn(thBase, "text-right")}>Year average</th>
              <th className={cn(thBase, "text-right")}>Attendance</th>
              <th className={cn(thBase, "text-right")}>Homework</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={r.student_id} className={i % 2 === 1 ? "bg-surface-stroke/25" : undefined}>
                <td className={tdBase}>
                  <div className="font-semibold text-ink-900">{r.name}</div>
                  <div className="mt-px text-[11.5px] font-medium text-ink-500">
                    {r.roll ? `Roll ${r.roll}` : "No roll number"}
                    {r.never_in ? " · never signed in" : ""}
                  </div>
                </td>
                <td className={cn(tdBase, "text-right tabular-nums")}>
                  {r.subject_pct == null ? (
                    <span className="font-medium text-ink-400">Not sat</span>
                  ) : (
                    <b style={{ color: markTone(r.subject_pct) }}>{pct0(r.subject_pct)}</b>
                  )}
                </td>
                <td className={cn(tdBase, "text-right tabular-nums")}>{pct0(r.score)}</td>
                <td className={cn(tdBase, "text-right tabular-nums")}>{pct0(r.attendance_pct)}</td>
                <td className={cn(tdBase, "text-right tabular-nums")}>{pct0(r.homework_pct)}</td>
              </tr>
            ))}
          </tbody>
        </TradTable>
        <DrawerHint>
          {d.count < d.total
            ? `Showing the ${d.count} lowest of ${d.total} students. ${d.total - d.scored} have no mark in this subject yet and sort last.`
            : `All ${d.total} students. ${d.total - d.scored} have no mark in this subject yet and sort last.`}
        </DrawerHint>
      </DrawerSection>
    </>
  );
}

/* ============================================================== paper ===== */

export function PaperDrawer({
  open, onOpenChange, examId, classId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  examId: string | null;
  classId: string | null;
}) {
  const q = useDash5PaperDetail(open ? examId : null, classId);
  const d = q.data;

  return (
    <Dash5Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={d?.title?.trim() || "Paper"}
      subtitle={
        d ? [d.class_label, d.subjects, d.date].filter(Boolean).join(" · ") : undefined
      }
    >
      {q.isLoading ? (
        <V5Loading label="Loading this paper…" />
      ) : q.isError ? (
        <V5Error label="Couldn't load this paper." onRetry={() => void q.refetch()} />
      ) : !d ? (
        <V5Empty title="This paper is no longer there" />
      ) : (
        <PaperBody d={d} />
      )}
    </Dash5Drawer>
  );
}

function PaperBody({ d }: { d: NonNullable<ReturnType<typeof useDash5PaperDetail>["data"]> }) {
  const maxBand = Math.max(1, ...d.bands.map((b) => b.n));
  const missing = d.roster - d.appeared - d.absent;

  const stats: MiniStat[] = [
    { label: "Average", value: pct1(d.avg_pct), tone: markTone(d.avg_pct) },
    { label: "Median", value: pct1(d.median_pct), tone: markTone(d.median_pct) },
    { label: "Passed", value: pct0(d.pass_pct), tone: d.pass_pct != null && d.pass_pct < 60 ? CRIT : undefined },
  ];

  const vsClass = d.avg_pct != null && d.class_avg_pct != null
    ? Math.round((d.avg_pct - d.class_avg_pct) * 10) / 10 : null;
  const vsSchool = d.avg_pct != null && d.school_avg_pct != null
    ? Math.round((d.avg_pct - d.school_avg_pct) * 10) / 10 : null;

  return (
    <>
      {/* The reference leads with two pills: how this paper did, and how it was
          delivered. Mode matters: an offline paper's average is a marking
          exercise, an online one's is not. */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <BandPill band={d.avg_pct == null ? null : bandOf(d.avg_pct)} />
        <span className="rounded-full border border-surface-stroke px-2.5 py-[3px] text-[11.5px] font-bold text-ink-600">
          {d.mode}
        </span>
        {d.exam_type && (
          <span className="rounded-full border border-surface-stroke px-2.5 py-[3px] text-[11.5px] font-bold text-ink-600">
            {d.exam_type}
          </span>
        )}
        {d.teacher && (
          <span className="text-[11.5px] font-medium text-ink-500">{d.teacher}</span>
        )}
      </div>

      <MiniStats items={stats} />
      <MiniStats
        items={[
          { label: "Appeared", value: `${d.appeared} / ${d.roster}`, small: true },
          { label: "Absent", value: d.absent, small: true },
          { label: "Out of", value: d.total_marks ?? "N/A", small: true },
        ]}
      />

      <DrawerSection title="How it sits">
        <DrawerNote tone={vsClass != null && vsClass < -5 ? "warning" : "brand"}>
          This paper's <b>{pct1(d.avg_pct)}</b> is{" "}
          {vsClass == null
            ? "not comparable, the class has no other marked paper"
            : Math.abs(vsClass) < 1
              ? `level with the ${d.class_label ?? "class"} average`
              : `${Math.abs(vsClass)} points ${vsClass > 0 ? "above" : "below"} the ${d.class_label ?? "class"} average of ${pct1(d.class_avg_pct)}`}
          {vsSchool != null && (
            <>
              , and {Math.abs(vsSchool) < 1 ? "level with" : `${Math.abs(vsSchool)} points ${vsSchool > 0 ? "above" : "below"}`}{" "}
              the school average of {pct1(d.school_avg_pct)}
            </>
          )}
          .
          {d.absent > 0 && (
            <>
              {" "}
              <b>{d.absent} student{d.absent === 1 ? "" : "s"} missed it</b>, and their marks are
              excluded rather than counted as zero, which lifts this average.
            </>
          )}
        </DrawerNote>
      </DrawerSection>

      <DrawerSection title="How the marks fell">
        <BarsH>
          {d.bands.map((b) => (
            <BarRow
              key={b.label}
              label={b.label}
              pct={(b.n / maxBand) * 100}
              color={b.label === "Below 35%" ? CRIT : b.label === "35 to 49%" ? WARN : EXC}
              value={b.n}
            />
          ))}
        </BarsH>
        <DrawerHint>
          Bars are scaled against the largest band, not the class size, so a small
          band stays visible.
        </DrawerHint>
      </DrawerSection>

      {d.bottom.length > 0 && (
        <DrawerSection title="Lowest five">
          <TradTable>
            <tbody>
              {d.bottom.map((s, i) => (
                <tr key={`${s.name}-${i}`} className={i % 2 === 1 ? "bg-surface-stroke/25" : undefined}>
                  <td className={tdBase}>{s.name}</td>
                  <td className={cn(tdBase, "w-[120px] text-right tabular-nums")}>
                    <b style={{ color: markTone(s.pct) }}>{pct0(s.pct)}</b>
                    {s.obtained != null && s.max != null && (
                      <span className="ml-1.5 text-[11.5px] font-medium text-ink-400">
                        {s.obtained} of {s.max}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TradTable>
        </DrawerSection>
      )}

      {d.top.length > 0 && (
        <DrawerSection title="Highest five">
          <TradTable>
            <tbody>
              {d.top.map((s, i) => (
                <tr key={`${s.name}-${i}`} className={i % 2 === 1 ? "bg-surface-stroke/25" : undefined}>
                  <td className={tdBase}>{s.name}</td>
                  <td className={cn(tdBase, "w-[120px] text-right tabular-nums")}>
                    <b>{pct0(s.pct)}</b>
                    {s.obtained != null && s.max != null && (
                      <span className="ml-1.5 text-[11.5px] font-medium text-ink-400">
                        {s.obtained} of {s.max}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TradTable>
        </DrawerSection>
      )}

      <DrawerSection title="Actions">
        <DrawerActions>
          <a
            href={`/exams/${d.exam_id}/results`}
            className="rounded-[10px] bg-brand-primary px-3.5 py-2 text-[12.5px] font-bold text-white transition-colors duration-200 hover:bg-brand-primary/90"
          >
            Open the results
          </a>
          {d.unpublished > 0 && (
            <a
              href={`/exams/${d.exam_id}/results`}
              className="rounded-[10px] border border-surface-stroke px-3.5 py-2 text-[12.5px] font-bold text-ink-700 transition-colors duration-200 hover:border-brand-primary hover:text-brand-primary"
            >
              Publish {d.unpublished} result{d.unpublished === 1 ? "" : "s"}
            </a>
          )}
        </DrawerActions>
      </DrawerSection>

      <DrawerSection title="What is outstanding">
        <DrawerNote tone={d.unpublished > 0 ? "warning" : "brand"}>
          {d.unpublished > 0 ? (
            <>
              <b>
                {d.unpublished} result{d.unpublished === 1 ? " is" : "s are"} still unpublished
              </b>
              , so students and parents cannot see this paper yet and it does not count
              towards any published report.
            </>
          ) : (
            <>Every result on this paper is published.</>
          )}
          {missing > 0 && (
            <>
              {" "}
              {missing} student{missing === 1 ? " on the roster has" : "s on the roster have"} no
              record against it at all, neither a mark nor an absence.
            </>
          )}
        </DrawerNote>
      </DrawerSection>
    </>
  );
}

/* ================================================== never signed in ======= */

export function NeverSignedInDrawer({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const q = useDash5NeverSignedIn(null, open);
  const [assignWing, setAssignWing] = useState<{ id: string; name: string } | null>(null);
  const [assignAll, setAssignAll] = useState(false);
  const d = q.data;

  return (
    <>
      <Dash5Drawer
        open={open && !assignWing}
        onOpenChange={onOpenChange}
        title={d ? `${d.total} students have never signed in` : "Never signed in"}
        subtitle="Accounts created, never used. Onboarding belongs to the wing coordinator."
      >
        {q.isLoading ? (
          <V5Loading label="Counting accounts…" />
        ) : q.isError ? (
          <V5Error label="Couldn't load the sign-in figures." onRetry={() => void q.refetch()} />
        ) : !d ? (
          <V5Empty title="Nothing came back" />
        ) : d.total === 0 ? (
          <V5Empty
            title="Every student has signed in at least once"
            sub={`All ${d.students} accounts have been used.`}
          />
        ) : (
          <>
            <MiniStats
              items={[
                { label: "Never used", value: d.total, tone: CRIT },
                { label: "Of roster", value: pct1((d.total / Math.max(d.students, 1)) * 100) },
                { label: "Students", value: d.students, small: true },
              ]}
            />

            <DrawerSection title="By wing">
              <BarsH>
                {d.wings.map((w) => (
                  <BarRow
                    key={w.wing_id}
                    label={w.wing_name}
                    pct={(w.never_in / Math.max(d.total, 1)) * 100}
                    color={CRIT}
                    value={w.never_in}
                    title={`${w.wing_name}: ${w.never_in} of ${w.students} students`}
                  />
                ))}
              </BarsH>
            </DrawerSection>

            <DrawerSection title="Assign onboarding">
              <div className="flex flex-col">
                {d.wings
                  .filter((w) => w.never_in > 0)
                  .map((w) => (
                    <div
                      key={w.wing_id}
                      className="flex items-center gap-3 border-b border-surface-stroke py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-ink-900">
                          {w.coordinator ?? "No coordinator assigned"}
                        </div>
                        <div className="mt-0.5 text-[11.5px] font-medium text-ink-500">
                          {w.wing_name} · {w.never_in} of {w.students} students ·{" "}
                          {pct1(w.pct)} of the wing
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAssignWing({ id: w.wing_id, name: w.wing_name })}
                        className="shrink-0 rounded-[9px] border border-brand-primary bg-brand-primary px-3 py-1.5 text-xs font-bold text-white transition-colors duration-200 hover:bg-brand-primary/90"
                      >
                        Assign
                      </button>
                    </div>
                  ))}
              </div>
              {/* One press, one task per coordinator. create_task_group is a
                  fan-out (CLAUDE.md 11), so this is N rows in one transaction,
                  not N sequential writes from the browser. */}
              {d.wings.filter((w) => w.never_in > 0 && w.coordinator_id).length > 1 && (
                <button
                  type="button"
                  onClick={() => setAssignAll(true)}
                  className="mt-3 w-full rounded-[10px] border border-brand-primary bg-brand-primary px-3.5 py-2 text-[12.5px] font-bold text-white transition-colors duration-200 hover:bg-brand-primary/90"
                >
                  Assign to all {d.wings.filter((w) => w.never_in > 0 && w.coordinator_id).length} coordinators
                </button>
              )}
            </DrawerSection>

            <DrawerSection title="Where this bites">
              <DrawerNote tone="warning">
                {d.wings[0] && d.wings[0].never_in > 0 && (
                  <>
                    <b>
                      {d.wings[0].wing_name} carries {d.wings[0].never_in} of {d.total}
                    </b>
                    .{" "}
                  </>
                )}
                Until these students sign in they hand in no homework, sit no online
                paper and produce no engagement signal, so every adoption figure on this
                page is measured against a roster that still counts them.
                {d.unmapped > 0 && (
                  <>
                    {" "}
                    {d.unmapped} of them sit in no wing at all, so no coordinator owns
                    them.
                  </>
                )}
              </DrawerNote>
            </DrawerSection>
          </>
        )}
      </Dash5Drawer>

      <AssignDrawer
        open={!!assignWing}
        onOpenChange={(v) => !v && setAssignWing(null)}
        scope={assignWing ? { wingId: assignWing.id } : null}
        title={`Assign onboarding · ${assignWing?.name ?? ""}`}
        subtitle="Getting unused accounts signed in for the first time."
      />

      <BulkOnboardingDrawer
        open={assignAll}
        onOpenChange={setAssignAll}
        wings={(d?.wings ?? []).filter((w) => w.never_in > 0 && w.coordinator_id)}
      />
    </>
  );
}

/* ============================================================ student ===== */

/** One student: where they stand and who to contact about it. */
export function StudentDrawer({
  open, onOpenChange, studentId,
}: { open: boolean; onOpenChange: (v: boolean) => void; studentId: string | null }) {
  const q = useDash5StudentContext(open ? studentId : null);
  const d = q.data;

  return (
    <Dash5Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={d?.name ?? "Student"}
      subtitle={
        d
          ? [d.class_label, d.roll ? `Roll ${d.roll}` : null].filter(Boolean).join(" · ")
          : undefined
      }
    >
      {q.isLoading ? (
        <V5Loading label="Loading this student…" />
      ) : q.isError ? (
        <V5Error label="Couldn't load this student." onRetry={() => void q.refetch()} />
      ) : !d ? (
        <V5Empty title="This student is no longer on the roster" />
      ) : (
        <StudentBody d={d} />
      )}
    </Dash5Drawer>
  );
}

function StudentBody({ d }: { d: NonNullable<ReturnType<typeof useDash5StudentContext>["data"]> }) {
  const att = d.attendance_pct;
  const short = att == null ? null : Math.max(0, 75 - att);
  const contact = d.guardian.phone ?? d.guardian.email;

  return (
    <>
      <MiniStats
        items={[
          {
            label: "Attendance",
            value: pct0(att),
            tone: att != null && att < 75 ? CRIT : undefined,
          },
          { label: "Homework", value: pct0(d.homework_pct), tone: markTone(d.homework_pct) },
          { label: "Year average", value: pct0(d.score), tone: markTone(d.score) },
        ]}
      />

      <DrawerSection title="Who to contact">
        {contact ? (
          <DrawerNote>
            {d.guardian.name ? (
              <>
                <b>{d.guardian.name}</b> is the guardian on record.{" "}
              </>
            ) : (
              <>No guardian name is on record. </>
            )}
            {d.guardian.phone ? (
              <>
                The number held is <b>{d.guardian.phone}</b>.
              </>
            ) : (
              <>
                The only contact held is <b>{d.guardian.email}</b>.
              </>
            )}{" "}
            {d.class_teacher
              ? `The class teacher is ${d.class_teacher.name}.`
              : "This class has no class teacher assigned."}
          </DrawerNote>
        ) : (
          <DrawerNote tone="critical">
            <b>No guardian contact is on record for this student.</b> Nothing can be sent
            home until a number or an email is added under the student's personal
            details.{" "}
            {d.class_teacher
              ? `${d.class_teacher.name} is the class teacher and can collect one.`
              : "This class has no class teacher assigned to collect one."}
          </DrawerNote>
        )}
      </DrawerSection>

      {short != null && short > 0 && (
        <DrawerSection title="Suggested wording">
          <DrawerNote tone="warning">
            Dear Parent, {d.name} ({d.class_label ?? "this class"}) is currently at{" "}
            <b>{pct0(att)} attendance</b>, which is {short > 25 ? "well " : ""}below the
            75% floor board eligibility requires. Please contact
            {d.class_teacher ? ` the class teacher, ${d.class_teacher.name},` : " the school"} to
            agree a plan before the year ends.
          </DrawerNote>
          <DrawerHint>
            SALCI has no parent login and no outbound message channel is switched on, so
            this is wording to send yourself, not a button that sends it.
          </DrawerHint>
          <DrawerActions>
            <a
              href="/school/communication?tab=ptm"
              className="mt-2.5 rounded-[10px] border border-surface-stroke px-3.5 py-2 text-[12.5px] font-bold text-ink-700 transition-colors duration-200 hover:border-brand-primary hover:text-brand-primary"
            >
              Request a meeting slot instead
            </a>
          </DrawerActions>
        </DrawerSection>
      )}

      {d.class_id ? (
        // The panel brings its own section headings, so it sits under a rule
        // rather than inside a heading of its own. Its stats are suppressed:
        // the three at the top of this drawer are about the student, and a
        // second row about the class would read as a contradiction.
        <div className="mt-[22px] border-t border-surface-stroke pt-4">
          <AssignPanel scope={{ classId: d.class_id }} showStats={false} />
        </div>
      ) : (
        <DrawerSection title="Assign follow-up">
          <DrawerNote tone="critical">
            This student is not in a class, so there is nobody to assign follow-up to.
          </DrawerNote>
        </DrawerSection>
      )}
    </>
  );
}

/* ================================================= bulk onboarding ======== */

/**
 * "Assign to all coordinators" from the never-signed-in panel.
 *
 * One task per wing, each addressed to that wing's own coordinator, written
 * through the same create_task_group path as every other assign control. It is
 * a loop of independent RPC calls rather than one call with N assignees on
 * purpose: the wings do not share a task, they each get their own with their
 * own numbers in it, and a failure on one should not silently swallow the rest.
 */
function BulkOnboardingDrawer({
  open, onOpenChange, wings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  wings: { wing_id: string; wing_name: string; never_in: number; students: number;
           coordinator_id: string | null; coordinator: string | null }[];
}) {
  const { institutionId } = useEffectiveInstitution();
  const create = useDash5CreateTask(institutionId);
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [failed, setFailed] = useState<string[]>([]);

  const total = wings.reduce((a, w) => a + w.never_in, 0);

  async function run() {
    setState("working");
    const bad: string[] = [];
    for (const w of wings) {
      try {
        await create.mutateAsync({
          title: `Onboard ${w.never_in} students who have never signed in`,
          detail:
            `${w.never_in} of ${w.wing_name}'s ${w.students} students have never opened their `
            + "SALCI account. Until they do they hand in no homework, sit no online paper and "
            + "produce no engagement signal, so every adoption figure for this wing is measured "
            + "against a roster that still counts them.",
          assignee_id: w.coordinator_id,
          priority: 2,
          task_type: "student_support",
          due_days: 10,
        });
      } catch {
        bad.push(w.wing_name);
      }
    }
    setFailed(bad);
    setState("done");
    if (bad.length === 0) toast.success(`Assigned to ${wings.length} coordinators`);
    else toastError(new Error(`Could not assign for ${bad.join(", ")}.`),
                    { fallback: "Some wings could not be assigned.", context: "dash5BulkOnboarding" });
  }

  return (
    <Dash5Drawer
      open={open}
      onOpenChange={(v) => {
        if (!v) { setState("idle"); setFailed([]); }
        onOpenChange(v);
      }}
      title="Assign onboarding to every coordinator"
      subtitle={`${total.toLocaleString()} students across ${wings.length} wings.`}
    >
      <DrawerSection title="What each of them gets">
        <div className="flex flex-col">
          {wings.map((w) => (
            <div
              key={w.wing_id}
              className="flex items-center gap-3 border-b border-surface-stroke py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink-900">{w.coordinator}</span>
                <span className="mt-0.5 block text-[11.5px] font-medium text-ink-500">
                  {w.wing_name} · {w.never_in} of {w.students} students
                </span>
              </span>
              {failed.includes(w.wing_name) ? (
                <span className="text-[12px] font-bold" style={{ color: CRIT }}>Failed</span>
              ) : state === "done" ? (
                <span className="text-[12px] font-bold text-ink-400">Assigned</span>
              ) : null}
            </div>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="Before you send">
        <DrawerNote>
          This writes <b>{wings.length} separate tasks</b>, one per wing, each addressed to that
          wing's own coordinator with its own figures. Wings with no coordinator are left out
          rather than sent to somebody who cannot act on them.
        </DrawerNote>
      </DrawerSection>

      <div className="mt-[22px]">
        <button
          type="button"
          onClick={() => void run()}
          disabled={state !== "idle" || wings.length === 0}
          className="w-full rounded-[10px] bg-brand-primary px-3.5 py-2.5 text-[13px] font-bold text-white transition-colors duration-200 hover:bg-brand-primary/90 disabled:opacity-60"
        >
          {state === "done"
            ? failed.length ? `Assigned, ${failed.length} failed` : "Assigned"
            : state === "working"
              ? "Working…"
              : `Assign ${wings.length} tasks`}
        </button>
      </div>
    </Dash5Drawer>
  );
}
