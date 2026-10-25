import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import {
  useDash5Tree,
  useDash5TreeTargets,
  type Dash5Level,
  type Dash5Row,
  type Dash5TargetPair,
} from "@/hooks/dashboard/useDash5";

import type { AssignScope } from "./AssignPanel";
import { AssignDrawer, SubjectDrawer } from "./Dash5Drawers";
import { pct0, pct1 } from "./format";
import {
  BandPill, Crumbs, Frac, LevelTag, SubjectsCell, TargetCell,
  TradTable, V5Card, V5CardHead, V5Empty, V5Error, V5Loading,
  tdBase, thBase,
} from "./primitives";
import { useWingDrill } from "./useWingDrill";

/**
 * School performance: wings -> classes -> subjects, with the subject drawer as
 * the fourth level. One `dash5_tree` call per level; the rows and the footer
 * under them come from the same SQL aggregate, so they cannot disagree.
 *
 * The Action column writes a REAL task through create_task_group. It waited
 * until that write existed, because a button that looks like it assigns work
 * and does not is worse than one that has not arrived yet.
 */

const HEAD: Record<Dash5Level, string[]> = {
  wings: ["Wing", "Classes", "Students", "Subjects", "Attendance", "Syllabus coverage",
          "Lesson plans taught", "Papers conducted", "Average score", "Performance", "Action"],
  // No Action at CLASS level, on Tushar's instruction. A class is a stop on the
  // way down, not somewhere work gets handed over: the wing above it owns the
  // whole set and the subject below it owns the specific ask.
  classes: ["Class", "Students", "Subjects", "Attendance", "Syllabus coverage",
            "Lesson plans taught", "Papers conducted", "Average score", "Performance"],
  subjects: ["Subject", "Teacher", "Syllabus coverage", "Lesson plans taught",
             "Papers conducted", "Average score", "Homework submitted", "Performance", "Action"],
};

export function Dash5Tree() {
  // Starts at "All wings" for a principal and inside the wing for a
  // coordinator, who has only one (see useWingDrill).
  const { drill, setDrill, reset, up, canGoUp, rootLabel } = useWingDrill();
  const [openSubject, setOpenSubject] =
    useState<{ id: string; name: string; teacher: string | null } | null>(null);
  const [assign, setAssign] =
    useState<{ scope: AssignScope; title: string; subtitle?: string } | null>(null);

  const level: Dash5Level = drill.classId ? "subjects" : drill.wingId ? "classes" : "wings";
  const tree = useDash5Tree(level, drill.wingId, drill.classId);
  // The denominators for the two publication columns. A separate call so a
  // school with the targets feature off pays for it once and gets zeros, rather
  // than the tree itself carrying a column it does not own.
  const tgt = useDash5TreeTargets(level, drill.wingId, drill.classId);

  const EMPTY: Dash5TargetPair = { done: 0, target: 0, ytd: 0, teachers: 0 };
  const targetsFor = (id: string) => tgt.data?.rows?.[id];

  const crumbs = useMemo(() => {
    // With a wing locked the root crumb IS the wing, so it is never repeated
    // as a second crumb and never links anywhere above itself.
    const atRoot = !canGoUp;
    const out = [{ label: rootLabel, onClick: atRoot ? undefined : reset }];
    if (drill.wingId && rootLabel === "All wings") {
      out.push({
        label: drill.wingName ?? "Wing",
        onClick: drill.classId
          ? () => setDrill((d) => ({ ...d, classId: null, classLabel: null }))
          : undefined,
      });
    }
    if (drill.classId) out.push({ label: drill.classLabel ?? "Class", onClick: undefined });
    return out;
  }, [drill, canGoUp, rootLabel, reset, setDrill]);

  const rows = tree.data?.rows ?? [];
  const total = tree.data?.total;

  const onRowClick = (r: Dash5Row) => {
    if (level === "wings") setDrill({ wingId: r.id, wingName: r.name, classId: null, classLabel: null });
    else if (level === "classes") setDrill((d) => ({ ...d, classId: r.id, classLabel: r.name }));
    else setOpenSubject({ id: r.id, name: r.name, teacher: r.teacher });
  };

  // What the Action column sends work about, at whichever level the row sits.
  const onAssignClick = (r: Dash5Row) => {
    if (level === "wings") {
      setAssign({ scope: { wingId: r.id }, title: `Assign a task: ${r.name}`, subtitle: r.sub ?? undefined });
    } else if (level === "classes") {
      setAssign({ scope: { classId: r.id }, title: `Assign a task: ${r.name}`, subtitle: r.sub ?? undefined });
    } else {
      setAssign({
        scope: { classId: drill.classId, subjectId: r.id },
        title: `Assign a task: ${r.name}`,
        subtitle: [drill.classLabel, r.teacher].filter(Boolean).join(" · ") || undefined,
      });
    }
  };

  const levelTag =
    level === "wings" ? `${rows.length} ${rows.length === 1 ? "wing" : "wings"}`
      : level === "classes" ? `${rows.length} ${rows.length === 1 ? "class" : "classes"}`
        : `${rows.length} ${rows.length === 1 ? "subject" : "subjects"}`;

  // Counts only once the level has landed: while it loads (or after it fails)
  // a "0 students across 0 classes" beside the spinner reads as an empty wing.
  const subtitle =
    level === "wings"
      ? "Click any wing to open its classes. Click a class to open its subjects. Every number below a row is the sum of the rows inside it."
      : level === "classes"
        ? `${total ? `${total.students} students across ${total.class_count} classes. ` : ""}Click a class for its subject breakdown.`
        : `${total ? `${total.students} students · attendance ${pct0(total.attendance_pct)}. ` : ""}Click a subject for its coverage, its students and its assign panel.`;

  return (
    <V5Card className="mb-6">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[280px]">
          <Crumbs items={crumbs} />
          <p className="mt-1.5 text-xs font-medium text-ink-500">{subtitle}</p>
        </div>
        {tree.data && <LevelTag>{levelTag}</LevelTag>}
        {canGoUp && (
          <button
            type="button"
            onClick={up}
            className="rounded-[10px] border border-surface-stroke px-3 py-1.5 text-[12.5px] font-semibold text-ink-600 hover:bg-surface-stroke/50 hover:text-ink-900"
          >
            ↑ Up one level
          </button>
        )}
      </V5CardHead>

      <div className="px-4 sm:px-[18px]">
        {tree.isLoading ? (
          <V5Loading label="Loading the performance tree…" />
        ) : tree.isError ? (
          <V5Error label="Couldn't load school performance." onRetry={() => void tree.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title={level === "wings" ? "No wings set up yet" : "Nothing mapped here yet"}
            sub={level === "wings"
              ? "Map your classes into wings to see the school broken down this way."
              : "Map subjects to this class to see its breakdown."}
          />
        ) : (
          <TradTable>
            <thead>
              <tr>
                {HEAD[level].map((h, i) => (
                  <th key={h} className={cn(thBase, i > 0 && i < HEAD[level].length - 1 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  onClick={() => onRowClick(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(r); } }}
                  className={cn(
                    "cursor-pointer",
                    i % 2 === 1 && "bg-surface-stroke/25",
                    "hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary",
                  )}
                >
                  <td className={tdBase}>
                    <div className="flex items-center gap-2 font-bold tracking-[-0.01em] text-ink-900">
                      <span className="text-[11px] text-ink-400" aria-hidden>▸</span>
                      {r.name}
                    </div>
                    {r.sub && <div className="mt-px pl-[19px] text-[11.5px] font-medium text-ink-500">{r.sub}</div>}
                    {level === "subjects" && (
                      <div className="mt-px pl-[19px] text-[11.5px] font-medium text-ink-500">
                        {r.chapters ? `${r.chapters_done ?? 0} of ${r.chapters} chapters done` : "No chapters loaded"}
                        {r.chapters_partial ? ", 1 partly done" : ""}
                        {" · "}
                        {r.pending_grading
                          ? `${r.pending_grading} paper${r.pending_grading > 1 ? "s" : ""} awaiting results`
                          : "results up to date"}
                      </div>
                    )}
                  </td>

                  {level === "wings" && <td className={cn(tdBase, "text-right tabular-nums")}>{r.class_count}</td>}
                  {level !== "subjects" && <td className={cn(tdBase, "text-right tabular-nums")}>{r.students}</td>}
                  {level !== "subjects" && (
                    <td className={cn(tdBase, "text-right")}>
                      <SubjectsCell pairs={r.subject_pairs} distinct={r.subject_count} showDistinct={level === "wings"} />
                    </td>
                  )}
                  {level === "subjects" && <td className={tdBase}>{r.teacher ?? <span className="text-ink-400">Unassigned</span>}</td>}
                  {level !== "subjects" && <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(r.attendance_pct)}</td>}
                  <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(r.syllabus_pct)}</td>
                  <td className={cn(tdBase, "text-right")}><Frac a={r.lessons_taught} b={r.lessons_planned} /></td>
                  <td className={cn(tdBase, "text-right")}>
                    {/* Blank until the targets call lands. The tree usually
                        arrives first, and EMPTY printed "0 / 0" on every row. */}
                    {tgt.data && (
                      <TargetCell
                        {...(targetsFor(r.id)?.exams ?? EMPTY)}
                        unit="published"
                      />
                    )}
                  </td>
                  <td className={cn(tdBase, "text-right tabular-nums font-bold")}>
                    {r.accuracy == null ? <span className="font-medium text-ink-400">No papers yet</span> : pct1(r.accuracy)}
                  </td>
                  {level === "subjects" && (
                    <td className={cn(tdBase, "text-right")}>
                      <span className="inline-block text-right leading-[1.25]">
                        <span className="block whitespace-nowrap text-sm font-bold tabular-nums">
                          {pct1(r.homework_pct)}
                        </span>
                        {tgt.data && (
                          <span className="mt-px block whitespace-nowrap text-[10.5px] font-medium text-ink-400">
                            set{" "}
                            <b className="text-ink-600">{targetsFor(r.id)?.homework.done ?? 0}</b>
                            {" / "}
                            {targetsFor(r.id)?.homework.target ?? 0}
                          </span>
                        )}
                      </span>
                    </td>
                  )}
                  <td className={tdBase}><BandPill band={r.band} /></td>
                  {level !== "classes" && (
                    <td className={cn(tdBase, "text-right")}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onAssignClick(r); }}
                        className="whitespace-nowrap rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-bold text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/10"
                      >
                        Assign
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot>
                <tr className="bg-surface-stroke/50 font-bold">
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400")}>
                    {level === "wings" ? `School total, ${rows.length} wings`
                      : level === "classes" ? `${drill.wingName} total`
                        : `${drill.classLabel} total, ${rows.length} subjects`}
                  </td>
                  {level === "wings" && <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right tabular-nums")}>{total.class_count}</td>}
                  {level !== "subjects" && <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right tabular-nums")}>{total.students}</td>}
                  {level !== "subjects" && (
                    <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right")}>
                      <SubjectsCell pairs={total.subject_pairs} distinct={total.subject_count} showDistinct />
                    </td>
                  )}
                  {level === "subjects" && <td className={cn(tdBase, "border-t-2 border-t-ink-400")} />}
                  {level !== "subjects" && <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right tabular-nums")}>{pct1(total.attendance_pct)}</td>}
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right tabular-nums")}>{pct1(total.syllabus_pct)}</td>
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right")}><Frac a={total.lessons_taught} b={total.lessons_planned} /></td>
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right")}>
                    {tgt.data && <TargetCell {...tgt.data.total.exams} unit="published" />}
                  </td>
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right tabular-nums")}>{pct1(total.accuracy)}</td>
                  {level === "subjects" && (
                    <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right")}>
                      <span className="inline-block text-right leading-[1.25]">
                        <span className="block whitespace-nowrap text-sm font-bold tabular-nums">
                          {pct1(total.homework_pct)}
                        </span>
                        {tgt.data && (
                          <span className="mt-px block whitespace-nowrap text-[10.5px] font-medium text-ink-400">
                            set <b className="text-ink-600">{tgt.data.total.homework.done}</b>
                            {" / "}{tgt.data.total.homework.target}
                          </span>
                        )}
                      </span>
                    </td>
                  )}
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400")}><BandPill band={total.band} /></td>
                  {level !== "classes" && (
                    <td className={cn(tdBase, "border-t-2 border-t-ink-400")} />
                  )}
                </tr>
              </tfoot>
            )}
          </TradTable>
        )}

        <p className="py-3 text-[11.5px] leading-[1.55] text-ink-500">
          {level === "subjects"
            ? "Papers conducted is what the teachers here published against their Teacher Target for the current period, with the year total below; homework shows what students handed in, and underneath it what the teacher set against target. A subject with no paper is left out of the average score rather than counted as zero, which is why a class can show more subjects than papers."
            : "Papers conducted is what the teachers in each row published against their Teacher Target for the current period, with the year total below. Average score is weighted by exam attempts, not a mean of means. Syllabus coverage counts chapters, a partly-done one worth half a finished one. Attendance rolls up weighted by roster size."}
          {/* Only a landed answer may say "no target is set"; a slow or failed
              targets call is not evidence that nobody set one. */}
          {!tgt.data
            ? tgt.isError
              ? " Teacher Targets couldn't be loaded, so the publication columns are blank."
              : ""
            : tgt.data.has_targets
                ? " A teacher's target is one total across everything they teach, so it counts in full against every row they appear in: rows do not add up to the line below them, and the total counts each teacher once."
                : " No Teacher Target is set here, so the publication columns show the year's total against zero."}
        </p>
      </div>

      <SubjectDrawer
        open={!!openSubject}
        onOpenChange={(v) => !v && setOpenSubject(null)}
        classId={drill.classId}
        classLabel={drill.classLabel}
        subjectId={openSubject?.id ?? null}
        subjectName={openSubject?.name ?? ""}
        teacher={openSubject?.teacher}
      />

      <AssignDrawer
        open={!!assign}
        onOpenChange={(v) => !v && setAssign(null)}
        scope={assign?.scope ?? null}
        title={assign?.title ?? "Assign a task"}
        subtitle={assign?.subtitle}
      />
    </V5Card>
  );
}
