import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  useDash5AtRisk, useDash5ScoreDistribution, useDash5StudentSubjects,
  useDash5StudentTree,
} from "@/hooks/dashboard/useDash5";

import { NeverSignedInDrawer, StudentDrawer, SubjectDrawer } from "./Dash5Drawers";
import { ChartTip, TipHit, TipLine, TipTitle } from "./ChartTip";
import { useChartTip } from "./useChartTip";
import { pct1 } from "./format";
import { FilterLabel, FilterSelect, FilterStrip } from "./FilterBar";
import { useScopeFilter } from "./useScopeFilter";
import { useWingDrill } from "./useWingDrill";
import { useWingLock } from "./useWingLock";
import {
  BandPill, Crumbs, LevelTag, TradTable, V5Card, V5CardHead,
  V5Empty, V5Error, V5Loading, tdBase, thBase,
} from "./primitives";

/**
 * The Students section of the v5 reference: the never-signed-in alert, the
 * adoption drill, where students stand, and the queue of students who need
 * attention.
 *
 * Every figure here is a mean over the students inside the row, computed in SQL
 * from one per-student atom, so a wing and its classes cannot disagree.
 */

/* ----------------------------------------------------------- the alert ---- */

export function Dash5AdoptionAlert() {
  // Under a wing lock, read the key Dash5StudentTree below opens at
  // ("classes", wing) so the two cards share one cache entry and the heavy
  // per-student aggregate runs once, not twice. Safe because dash5_student_tree
  // computes `total` over the whole wing-clamped student set whatever p_level
  // is, so never_in, students and adopt_pct are identical at either level.
  // Unlocked (the admin page), both cards already share ("wings", null).
  const locked = useWingLock();
  const tree = useDash5StudentTree(locked ? "classes" : "wings", locked);
  const [open, setOpen] = useState(false);

  if (tree.isLoading) return <V5Loading />;
  if (tree.isError) {
    return <V5Error label="Couldn't load portal adoption." onRetry={() => void tree.refetch()} />;
  }
  const t = tree.data?.total;
  // No total is not good news, and neither is an empty roster: "every student
  // has opened their account" over zero students is a false claim. Say
  // nothing rather than celebrate.
  if (!t || t.students === 0) return null;
  if (t.never_in === 0) {
    return (
      <div
        className="mb-3.5 rounded-card border p-4"
        style={{ borderColor: "hsl(var(--dash-exc) / 0.3)", background: "hsl(var(--dash-exc) / 0.08)" }}
      >
        <p className="m-0 text-[14.5px] font-extrabold tracking-[-0.015em]" style={{ color: "hsl(var(--dash-exc))" }}>
          Every student has opened their account
        </p>
        <p className="m-0 mt-0.5 text-[12.5px] font-medium text-ink-600">
          {t.adopt_pct != null ? `${t.adopt_pct.toFixed(1)}% were active in the last 7 days.` : ""}
        </p>
      </div>
    );
  }

  const share = t.students > 0 ? (t.never_in / t.students) * 100 : 0;
  return (
    <>
      <div
        className="mb-3.5 flex flex-wrap items-center gap-3 rounded-card border p-4"
        style={{ borderColor: "hsl(var(--dash-critical) / 0.3)", background: "hsl(var(--dash-critical) / 0.08)" }}
      >
        <div className="min-w-0 flex-1 basis-[240px]">
          <p className="m-0 text-[14.5px] font-extrabold tracking-[-0.015em]" style={{ color: "hsl(var(--dash-critical))" }}>
            {t.never_in.toLocaleString()} students have never signed in
          </p>
          <p className="m-0 mt-0.5 text-[12.5px] font-medium text-ink-600">
            {share.toFixed(1)}% of the roster. Nothing they do is measured until they do.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-[10px] border border-brand-primary bg-brand-primary px-3.5 py-2 text-[12.5px] font-bold text-white transition-colors duration-200 hover:bg-brand-primary/90"
        >
          Break it down
        </button>
      </div>
      <NeverSignedInDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}

/* ------------------------------------------------------ the adoption drill */

const STU_HEAD = ["", "Students", "Portal adoption", "Test submission", "Average score",
                  "Homework submitted", "Attendance"];

export function Dash5StudentTree() {
  // A coordinator opens inside their wing: they have one, so a wing level would
  // be a single row whose only purpose is to be clicked. useWingDrill holds the
  // rule; this card keeps its own {id,name} shape and reads the lock off it.
  const { locked, rootLabel, drill } = useWingDrill();
  const [wing, setWing] = useState<{ id: string; name: string } | null>(null);
  const [cls, setCls] = useState<{ id: string; name: string } | null>(null);

  // The lock is known before its name is, so this settles once the filter
  // options land. Never clears a drill the user has started.
  const lockedWing = locked ? { id: locked, name: drill.wingName ?? rootLabel } : null;
  const effWing = lockedWing ?? wing;
  // The fourth level: one subject's student list, opened from a subject row.
  const [subject, setSubject] = useState<{ id: string; name: string; teacher: string | null } | null>(null);

  const level = cls ? "subjects" : effWing ? "classes" : "wings";
  const tree = useDash5StudentTree(level === "subjects" ? "classes" : level, effWing?.id ?? null);
  // Only fetched once a class is open, so the first two levels cost one call.
  const subs = useDash5StudentSubjects(cls?.id ?? null);

  const rows = level === "subjects" ? [] : tree.data?.rows ?? [];
  const total = level === "subjects" ? undefined : tree.data?.total;
  const busy = level === "subjects" ? subs.isLoading : tree.isLoading;
  const failed = level === "subjects" ? subs.isError : tree.isError;

  const cells = (o: { adopt_pct: number | null; submission_pct: number | null; score_pct: number | null;
                      homework_pct: number | null; attendance_pct: number | null }) => (
    <>
      <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(o.adopt_pct)}</td>
      <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(o.submission_pct)}</td>
      <td className={cn(tdBase, "text-right font-bold tabular-nums")}>
        {o.score_pct == null ? <span className="font-medium text-ink-400">No papers yet</span> : pct1(o.score_pct)}
      </td>
      <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(o.homework_pct)}</td>
      <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(o.attendance_pct)}</td>
    </>
  );

  return (
    <V5Card className="mb-6">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[280px]">
          <Crumbs
            items={[
              { label: rootLabel,
                onClick: locked
                  ? (cls ? () => setCls(null) : undefined)
                  : (wing ? () => { setWing(null); setCls(null); } : undefined) },
              ...(!locked && wing ? [{ label: wing.name, onClick: cls ? () => setCls(null) : undefined }] : []),
              ...(cls ? [{ label: cls.name }] : []),
            ]}
          />
          <p className="mt-1.5 text-xs font-medium text-ink-500">
            {level === "subjects"
              ? `${subs.data ? `${subs.data.students} students. ` : ""}Click a subject for the student list behind it.`
              : level === "classes"
                ? "Click a class for its subject breakdown."
                : "Click a wing for its classes, a class for its subjects, a subject for the student list."}
          </p>
        </div>
        {/* No count until the level has landed: "0 CLASSES" beside the spinner
            read as an empty wing on a slow load. */}
        {(level === "subjects" ? subs.data : tree.data) && (
          <LevelTag>
            {level === "subjects"
              ? `${subs.data?.total ?? 0} subjects`
              : `${rows.length} ${level === "wings" ? "wings" : "classes"}`}
          </LevelTag>
        )}
        {(locked ? !!cls : !!wing) && (
          <button
            type="button"
            onClick={() => (cls ? setCls(null) : setWing(null))}
            className="rounded-[10px] border border-surface-stroke px-3 py-1.5 text-[12.5px] font-semibold text-ink-600 hover:bg-surface-stroke/50 hover:text-ink-900"
          >
            ↑ Up one level
          </button>
        )}
      </V5CardHead>

      <div className="px-4 pb-4 sm:px-[18px]">
        {busy ? (
          <V5Loading />
        ) : failed ? (
          <V5Error
            label="Couldn't load student activity."
            onRetry={() => void (level === "subjects" ? subs.refetch() : tree.refetch())}
          />
        ) : level === "subjects" ? (
          (subs.data?.rows.length ?? 0) === 0 ? (
            <V5Empty
              title="No subjects mapped to this class"
              sub="Map subjects to the class to see how its students are doing in each."
            />
          ) : (
            <>
              <TradTable>
                <thead>
                  <tr>
                    <th className={thBase}>Subject</th>
                    <th className={thBase}>Teacher</th>
                    {["Students sat", "Test submission", "Average score", "Homework submitted"].map((h) => (
                      <th key={h} className={cn(thBase, "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subs.data?.rows.map((r, i) => (
                    <tr
                      key={r.id}
                      onClick={() => setSubject({ id: r.id, name: r.name, teacher: r.teacher })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSubject({ id: r.id, name: r.name, teacher: r.teacher });
                        }
                      }}
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
                        <div className="mt-px pl-[19px] text-[11.5px] font-medium text-ink-500">
                          {r.papers
                            ? `${r.papers} paper${r.papers === 1 ? "" : "s"} · click for the student list`
                            : "no paper conducted yet"}
                        </div>
                      </td>
                      <td className={tdBase}>
                        {r.teacher ?? <span className="text-ink-400">Unassigned</span>}
                      </td>
                      <td className={cn(tdBase, "text-right tabular-nums")}>
                        {r.students_sat} <span className="font-medium text-ink-400">/ {r.students}</span>
                      </td>
                      <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(r.submission_pct)}</td>
                      <td className={cn(tdBase, "text-right font-bold tabular-nums")}>
                        {r.score_pct == null
                          ? <span className="font-medium text-ink-400">No papers yet</span>
                          : pct1(r.score_pct)}
                      </td>
                      <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(r.homework_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </TradTable>
              <p className="py-3 text-[11.5px] leading-[1.55] text-ink-500">
                Students sat counts heads, not attempts: one student sitting three papers is one
                student. Test submission is papers sat against papers set to the whole class.
              </p>
            </>
          )
        ) : rows.length === 0 ? (
          <V5Empty title="No students mapped here yet" />
        ) : (
          <TradTable>
            <thead>
              <tr>
                <th className={thBase}>{level === "wings" ? "Wing" : "Class"}</th>
                {STU_HEAD.slice(1).map((h) => (
                  <th key={h} className={cn(thBase, "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const clickable = true;
                const go = () => (level === "wings"
                  ? setWing({ id: r.id, name: r.name })
                  : setCls({ id: r.id, name: r.name }));
                return (
                  <tr
                    key={r.id}
                    onClick={go}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
                    }}
                    className={cn(
                      i % 2 === 1 && "bg-surface-stroke/25",
                      clickable && "cursor-pointer hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary",
                    )}
                  >
                    <td className={tdBase}>
                      <div className="flex items-center gap-2 font-bold tracking-[-0.01em] text-ink-900">
                        {clickable && <span className="text-[11px] text-ink-400" aria-hidden>▸</span>}
                        {r.name}
                      </div>
                      <div className={cn("mt-px text-[11.5px] font-medium text-ink-500", clickable && "pl-[19px]")}>
                        {r.at_risk} needing attention
                        {r.never_in > 0 && ` · ${r.never_in} never signed in`}
                      </div>
                    </td>
                    <td className={cn(tdBase, "text-right tabular-nums")}>{r.students}</td>
                    {cells(r)}
                  </tr>
                );
              })}
            </tbody>
            {total && (
              <tfoot>
                <tr className="bg-surface-stroke/50 font-bold">
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400")}>
                    {wing ? `${wing.name} total` : "School total"}
                  </td>
                  <td className={cn(tdBase, "border-t-2 border-t-ink-400 text-right tabular-nums")}>{total.students}</td>
                  {cells(total)}
                </tr>
              </tfoot>
            )}
          </TradTable>
        )}

        {level !== "subjects" && (
          <p className="py-3 text-[11.5px] leading-[1.55] text-ink-500">
            Portal adoption is students active in the last 7 days. Test submission is papers sat
            divided by papers set. Every column is the mean over the students inside the row, so a
            wing is weighted by how many students it actually has.
          </p>
        )}
      </div>

      <SubjectDrawer
        open={!!subject}
        onOpenChange={(v) => !v && setSubject(null)}
        classId={cls?.id ?? null}
        classLabel={cls?.name ?? null}
        subjectId={subject?.id ?? null}
        subjectName={subject?.name ?? ""}
        teacher={subject?.teacher}
        initialView="students"
      />
    </V5Card>
  );
}

/** Wing colours, shared by the distribution stack and the at-risk chips so one
 *  wing is the same colour everywhere on the Students section. */
const WING_TONES = ["--dash-teal", "--brand-secondary", "--dash-exc", "--dash-warning", "--dash-critical"];

/* --------------------------------------------------- score distribution --- */

export function Dash5ScoreDistribution() {
  const { wingId, wingLocked, chooseWing, wingOptions } = useScopeFilter();
  const q = useDash5ScoreDistribution(wingId);
  const tip = useChartTip(640, 280);

  return (
    <V5Card className="mb-6">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Score distribution</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Every student's year average, stacked by wing.
          </p>
        </div>
      </V5CardHead>
      {!wingLocked && (
        <FilterStrip>
          <FilterLabel>Wing</FilterLabel>
          <FilterSelect value={wingId} onChange={chooseWing} options={wingOptions} allLabel="All wings" />
        </FilterStrip>
      )}
      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load the score distribution." onRetry={() => void q.refetch()} />
        ) : (q.data?.scored ?? 0) === 0 ? (
          <V5Empty title="No student has a graded result yet" sub="Bands appear once papers are marked and published." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {q.data?.wings.map((w, i) => (
                <span key={w.id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600">
                  <i
                    className="inline-block h-[11px] w-[11px] rounded-[3px]"
                    style={{ background: `hsl(var(${WING_TONES[i % WING_TONES.length]}))` }}
                    aria-hidden
                  />
                  {w.name}
                </span>
              ))}
            </div>
            {/* Stacked columns, as the reference draws them: the score bucket
                runs along the bottom so the shape of the school reads left to
                right, and each column is split by wing. Drawn as one SVG at the
                reference's geometry and centred, matching `svg.chart`. */}
            {(() => {
              const bands = q.data?.bands ?? [];
              const W = 640, H = 280, L = 46, R = 14, T = 22, B = 46;
              const ph = H - T - B, pw = W - L - R;
              const raw = Math.max(1, ...bands.map((b) => b.total));
              // Rounded up to a clean step so the axis labels are whole numbers.
              const step = Math.max(1, Math.ceil(raw / 4 / 25) * 25);
              const hi = step * 4;
              const Y = (v: number) => T + ph - (v / hi) * ph;
              const colW = pw / Math.max(1, bands.length);
              const bw = Math.min(58, colW * 0.56);
              const scoped = bands.reduce((a, b) => a + b.total, 0);
              return (
                <div ref={tip.wrapRef} className="relative">
                <svg
                  ref={tip.svgRef}
                  viewBox={`0 0 ${W} ${H}`}
                  className="mx-auto block h-auto w-full max-w-[720px] overflow-visible"
                  role="img"
                  aria-label={`Students in each score band, stacked by wing`}
                >
                  {[0, 1, 2, 3, 4].map((t) => (
                    <g key={t}>
                      <line x1={L} x2={W - R} y1={Y(step * t)} y2={Y(step * t)}
                            stroke="hsl(var(--surface-stroke))" strokeWidth={1} />
                      <text x={L - 8} y={Y(step * t) + 3.5} textAnchor="end"
                            className="fill-ink-400 text-[10.5px] font-semibold">{step * t}</text>
                    </g>
                  ))}
                  <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)}
                        stroke="hsl(var(--ink-400))" strokeWidth={1} opacity={0.55} />

                  {bands.map((b, i) => {
                    const cx = L + colW * (i + 0.5);
                    let acc = 0;
                    return (
                      <g key={b.label}>
                        {b.by_wing.map((seg, wi) => {
                          const y0 = Y(acc);
                          acc += seg.n;
                          const y1 = Y(acc);
                          if (seg.n === 0) return null;
                          return (
                            <rect
                              key={seg.wing_id}
                              x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)}
                              fill={`hsl(var(${WING_TONES[wi % WING_TONES.length]}))`}
                            />
                          );
                        })}
                        <TipHit
                          x={cx - colW / 2} y={T} width={colW} height={Y(0) - T}
                          onShow={() => tip.show(cx, Y(b.total), (
                            <>
                              <TipTitle>{b.label}%</TipTitle>
                              <TipLine>
                                {b.total.toLocaleString()} students ·{" "}
                                {scoped > 0 ? `${Math.round((b.total / scoped) * 100)}%` : "0%"} of scope
                              </TipLine>
                              {b.by_wing.filter((x) => x.n > 0).map((x, wi) => (
                                <TipLine key={x.wing_id}>
                                  <i
                                    className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] align-[-1px]"
                                    style={{ background: `hsl(var(${WING_TONES[wi % WING_TONES.length]}))` }}
                                  />
                                  {q.data?.wings.find((wg) => wg.id === x.wing_id)?.name ?? "Wing"}{" "}
                                  {x.n.toLocaleString()}
                                </TipLine>
                              ))}
                            </>
                          ))}
                          onHide={tip.hide}
                        />
                        <text x={cx} y={Y(b.total) - 6} textAnchor="middle"
                              className="fill-ink-900 text-[10.5px] font-extrabold">{b.total}</text>
                        <text x={cx} y={H - 24} textAnchor="middle"
                              className="fill-ink-400 text-[10.5px] font-semibold">{b.label}</text>
                      </g>
                    );
                  })}
                  <text x={L + pw / 2} y={H - 6} textAnchor="middle"
                        className="fill-ink-400 text-[10.5px] font-bold">
                    Year average →
                  </text>
                </svg>
                <ChartTip tip={tip.tip} />
                </div>
              );
            })()}
            <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-500">
              {q.data?.scored.toLocaleString()} students have at least one graded result. Students with
              none are left out rather than banded at zero.
            </p>
          </>
        )}
      </div>
    </V5Card>
  );
}

/* ---------------------------------------------------------- needs help ---- */

export function Dash5AtRisk() {
  const [open, setOpen] = useState(false);
  // Which student the detail drawer is showing. The list says what is wrong;
  // the drawer says who to call about it.
  const [student, setStudent] = useState<string | null>(null);
  const { wingId, wingLocked, classId, setClassId, chooseWing, wingOptions, classOptions } =
    useScopeFilter();
  const q = useDash5AtRisk(wingId, classId, 25);

  return (
    <V5Card className="mb-8 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-stroke/40 sm:px-[18px]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
              Students who need attention
            </span>
            {q.data && (
              <span className="rounded-md bg-brand-secondary/12 px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-brand-secondary">
                {q.data.total.toLocaleString()} students
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs font-medium text-ink-500">
            {q.data
              ? "Failing marks, heavy absence or work not handed in. Worst first."
              : "Failing marks, heavy absence or missed work."}
          </span>

          {/* Where the flagged students are, before anyone opens the list. The
              split counts EVERY flagged student, not the page of rows below,
              so a chip and the list cannot disagree. */}
          {q.data && q.data.total > 0 && (
            <>
              <span className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-surface-stroke" aria-hidden>
                {q.data.by_wing.map((w, i) => (
                  <span
                    key={w.wing_id}
                    style={{
                      width: `${(w.n / Math.max(1, q.data.total)) * 100}%`,
                      background: `hsl(var(${WING_TONES[i % WING_TONES.length]}))`,
                    }}
                  />
                ))}
              </span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                {q.data.by_wing.filter((w) => w.n > 0).map((w, i) => (
                  <span
                    key={w.wing_id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600"
                  >
                    <i
                      className="inline-block h-[9px] w-[9px] rounded-[3px]"
                      style={{ background: `hsl(var(${WING_TONES[i % WING_TONES.length]}))` }}
                      aria-hidden
                    />
                    {w.wing_name} {w.n}
                  </span>
                ))}
                {q.data.unmapped > 0 && (
                  <span className="inline-flex items-center rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-500">
                    In no wing {q.data.unmapped}
                  </span>
                )}
              </span>
            </>
          )}
        </span>
        <span className={cn("text-xs text-ink-400 transition-transform", open && "rotate-90")} aria-hidden>▸</span>
      </button>

      {open && (
        <>
          <FilterStrip>
            <FilterLabel>Where</FilterLabel>
            {!wingLocked && (
              <FilterSelect value={wingId} onChange={chooseWing} options={wingOptions} allLabel="All wings" />
            )}
            <FilterSelect value={classId} onChange={setClassId} options={classOptions}
                          allLabel="All classes in scope" width="w-[190px]" />
            {q.data && (
              <span className="text-[11.5px] font-medium text-ink-500">
                {q.data.total.toLocaleString()} students in view · lowest risk index first
                (0.5 × score + 0.3 × attendance + 0.2 × homework)
              </span>
            )}
          </FilterStrip>
        <div className="border-t border-surface-stroke px-4 py-4 sm:px-[18px]">
          {q.isLoading ? (
            <V5Loading />
          ) : q.isError ? (
            <V5Error label="Couldn't load this queue." onRetry={() => void q.refetch()} />
          ) : (q.data?.rows.length ?? 0) === 0 ? (
            <V5Empty title="Nobody crosses the attention threshold right now" />
          ) : (
            <>
              <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
                {q.data?.rows.map((s, i) => (
                  <li key={s.student_id} className="p-0">
                  <button
                    type="button"
                    onClick={() => setStudent(s.student_id)}
                    className="flex w-full flex-wrap items-start gap-3 py-3 text-left transition-colors duration-200 hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
                  >
                    {/* The index the queue is ordered by, on the row. A ranked
                        list that hides its own ranking key asks to be taken on
                        trust. */}
                    <span
                      className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] leading-none"
                      style={{
                        color: "hsl(var(--dash-critical))",
                        background: "hsl(var(--dash-critical) / 0.1)",
                      }}
                      aria-hidden
                    >
                      <span className="text-[13px] font-extrabold tabular-nums">
                        {s.rank_score == null ? "N/A" : Math.round(s.rank_score)}
                      </span>
                      <span className="text-[8.5px] font-bold uppercase tracking-[0.06em] opacity-80">risk</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-ink-900">
                        <span className="text-ink-400">{i + 1}.</span> {s.name}
                      </span>
                      <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                        {s.class_label}
                        {s.roll && ` · roll ${s.roll}`}
                        {s.class_teacher && ` · ${s.class_teacher}`}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {[
                          { k: "score", v: s.score, label: "score" },
                          { k: "att", v: s.attendance_pct, label: "attendance" },
                          { k: "hw", v: s.homework_pct, label: "homework" },
                          { k: "sat", v: s.submission_pct, label: "papers sat" },
                        ].map((c) => (
                          <span
                            key={c.k}
                            className="rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600"
                          >
                            {c.v == null ? "N/A" : `${Math.round(c.v)}%`}{" "}
                            <span className="font-medium text-ink-400">{c.label}</span>
                          </span>
                        ))}
                        {s.reasons.map((r) => (
                          <span
                            key={r}
                            className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                            style={{
                              color: "hsl(var(--dash-critical))",
                              background: "hsl(var(--dash-critical) / 0.09)",
                              borderColor: "hsl(var(--dash-critical) / 0.18)",
                            }}
                          >
                            {r}
                          </span>
                        ))}
                      </span>
                    </span>
                    <BandPill band={s.band} />
                  </button>
                  </li>
                ))}
              </ul>
              {(q.data?.total ?? 0) > (q.data?.rows.length ?? 0) && (
                <p className="mt-3 text-center text-[12.5px] font-medium text-ink-500">
                  Showing the {q.data?.rows.length} worst of {q.data?.total.toLocaleString()}.
                </p>
              )}
              <StudentDrawer
                open={!!student}
                onOpenChange={(v) => !v && setStudent(null)}
                studentId={student}
              />
            </>
          )}
        </div>
        </>
      )}
    </V5Card>
  );
}
