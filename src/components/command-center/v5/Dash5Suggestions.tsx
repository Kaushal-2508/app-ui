import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  useDash5ApproveSuggestion, useDash5ExamPipeline, useDash5TaskSuggestions,
  type Dash5Pipeline,
  type Dash5Suggestion,
} from "@/hooks/dashboard/useDash5";

import {
  BarRow, BarsH, LevelTag, V5Card, V5CardHead, V5Empty, V5Error, V5Loading,
} from "./primitives";
import { FilterLabel, FilterSelect, FilterStrip } from "./FilterBar";
import { pct1 } from "./format";
import { useScopeFilter } from "./useScopeFilter";

/* ---------------------------------------------------------- exam pipeline - */

/**
 * The four places a paper can sit, in the order the reference stacks them.
 * Declared once and read by both the stacked bar and the list under it, so the
 * two can never fall out of step.
 */
const SEGMENTS: {
  key: string; label: string; color: string; get: (p: Dash5Pipeline) => number;
}[] = [
  { key: "out", label: "Held, results out", color: "hsl(var(--dash-exc))",
    get: (p) => p.held_results_out },
  { key: "pending", label: "Held, results pending", color: "hsl(var(--dash-warning))",
    get: (p) => p.held_results_pending },
  { key: "cal", label: "On the calendar", color: "hsl(var(--brand-secondary))",
    get: (p) => p.on_calendar },
  { key: "draft", label: "Paper still in draft", color: "hsl(var(--dash-teal))",
    get: (p) => p.in_draft },
];

export function Dash5ExamPipeline() {
  const { wingId, wingLocked, classId, setClassId, chooseWing, wingOptions, classOptions,
          subjectOptions } = useScopeFilter();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const q = useDash5ExamPipeline(wingId, classId, subjectId);
  const p = q.data;

  return (
    <V5Card className="mb-6">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Exam pipeline</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Papers the year implies, against what has actually been held.
          </p>
        </div>
        <LevelTag>
          {[wingOptions.find((o) => o.value === wingId)?.label ?? "All school",
            classOptions.find((o) => o.value === classId)?.label,
            subjectOptions.find((o) => o.value === subjectId)?.label]
            .filter(Boolean).join(" · ")}
        </LevelTag>
      </V5CardHead>
      <FilterStrip>
        <FilterLabel>Scope</FilterLabel>
        {!wingLocked && (
          <FilterSelect value={wingId} onChange={chooseWing} options={wingOptions} allLabel="All school" />
        )}
        <FilterSelect value={classId} onChange={setClassId} options={classOptions}
                      allLabel="All classes in scope" width="w-[190px]" />
        <FilterSelect value={subjectId} onChange={setSubjectId} options={subjectOptions}
                      allLabel="All subjects in scope" width="w-[170px]" />
      </FilterStrip>
      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load the exam pipeline." onRetry={() => void q.refetch()} />
        ) : !p || p.pairs === 0 ? (
          <V5Empty title="No subjects mapped yet, so there is no plan to measure against" />
        ) : (
          <>
            <div className="rounded-[12px] border border-surface-stroke bg-surface-stroke/30 px-4 py-3.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[26px] font-extrabold tabular-nums tracking-[-0.03em] text-ink-900">
                  {p.held.toLocaleString()}
                </span>
                <span className="text-[15px] font-bold text-ink-400">of about {p.planned.toLocaleString()}</span>
                <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-400">papers held</span>
                <span
                  className="ml-auto text-[13px] font-extrabold tabular-nums"
                  style={{
                    color: (p.on_pace ?? 0) >= p.year_elapsed_pct
                      ? "hsl(var(--dash-exc))" : "hsl(var(--dash-warning))",
                  }}
                >
                  {pct1(p.on_pace)}
                </span>
              </div>

              {/* The pace marker sits INSIDE the track: the track clips overflow,
                  so a taller marker is cut away entirely and never appears. */}
              <div className="relative mt-2.5 flex h-3.5 overflow-hidden rounded-[7px] bg-surface-stroke">
                {SEGMENTS.map((seg) => (
                  <span
                    key={seg.key}
                    className="block h-full"
                    style={{
                      width: `${Math.min(100, (seg.get(p) / Math.max(1, p.planned)) * 100)}%`,
                      background: seg.color,
                    }}
                  />
                ))}
                <i
                  className="absolute top-0 z-10 block h-full w-[3px] bg-ink-900"
                  style={{ left: `${Math.min(99, p.year_elapsed_pct)}%` }}
                  title={`${p.year_elapsed_pct}% of the session has passed`}
                  aria-hidden
                />
              </div>

              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-ink-600">
                {SEGMENTS.map((seg) => (
                  <span key={seg.key} className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-[9px] w-[9px] rounded-sm" style={{ background: seg.color }} aria-hidden />
                    {seg.label} {seg.get(p).toLocaleString()}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5">
                  <i className="inline-block h-[9px] w-[9px] rounded-sm bg-surface-stroke" aria-hidden />
                  Not written yet {p.not_written.toLocaleString()}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <i className="inline-block h-[9px] w-[3px] bg-ink-900" aria-hidden />
                  Pace marker {p.year_elapsed_pct}%
                </span>
              </div>
            </div>

            {/* "Where those papers sit", the reference's second half of this
                card. The same four numbers as the bar above, given their own
                length so a reader can compare them to each other rather than
                to the plan. */}
            <h4 className="mb-2.5 mt-5 text-xs font-extrabold uppercase tracking-[0.06em] text-ink-400">
              Where those papers sit
            </h4>
            <BarsH>
              {[...SEGMENTS.map((seg) => ({ label: seg.label, v: seg.get(p), color: seg.color })),
                { label: "Not written yet", v: p.not_written, color: "hsl(var(--ink-400))" }].map((r) => (
                <BarRow
                  key={r.label}
                  label={r.label}
                  // Scaled against the LARGEST of the four, not against the
                  // whole plan. The question this list answers is "where are
                  // the papers", which is a comparison between these four.
                  pct={(r.v / Math.max(1, p.held_results_out, p.held_results_pending,
                                       p.on_calendar, p.in_draft, p.not_written)) * 100}
                  color={r.color}
                  value={r.v.toLocaleString()}
                />
              ))}
            </BarsH>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { l: "Pairs with no paper", v: p.pairs_with_no_paper, of: p.pairs },
                { l: "Written, not published", v: p.pending_publication },
                { l: "Still to come", v: p.remaining },
              ].map((c) => (
                <div key={c.l} className="rounded-[12px] border border-surface-stroke px-3.5 py-3">
                  <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-400">{c.l}</p>
                  <p className="m-0 mt-0.5 text-xl font-extrabold tabular-nums tracking-[-0.03em] text-ink-900">
                    {c.v.toLocaleString()}
                    {c.of != null && <span className="text-[13px] font-bold text-ink-400"> of {c.of.toLocaleString()}</span>}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-500">
              {p.pairs.toLocaleString()} subject-class rows in scope. Held papers are at{" "}
              <b className="text-ink-700">{pct1(p.on_pace)}</b> of the year's plan against{" "}
              {p.year_elapsed_pct}% of the year elapsed
              {p.on_pace != null && p.on_pace >= p.year_elapsed_pct - 3
                ? ", which is on pace."
                : `. The gap is ${Math.max(0, Math.round(((p.year_elapsed_pct - (p.on_pace ?? 0)) / 100) * p.planned))} papers behind schedule.`}
            </p>
            <p className="mt-2 text-[11.5px] leading-[1.55] text-ink-500">
              The plan is what this school's own pace implies for a full session, not a target handed
              down: papers held divided by the share of the year gone. A subject with nothing held
              still owes the year one, which is why it shows as a gap.
            </p>
          </>
        )}
      </div>
    </V5Card>
  );
}

/* ------------------------------------------------------ task suggestions -- */

const PRIORITY: Record<number, { label: string; glyph: string; varName: string }> = {
  1: { label: "High",   glyph: "■", varName: "--dash-critical" },
  2: { label: "Medium", glyph: "◆", varName: "--dash-warning" },
  3: { label: "Low",    glyph: "●", varName: "--ink-400" },
  4: { label: "Low",    glyph: "●", varName: "--ink-400" },
};

const TOP = 3;

export function Dash5TaskSuggestions() {
  const q = useDash5TaskSuggestions();
  const { institutionId } = useEffectiveInstitution();
  const approve = useDash5ApproveSuggestion(institutionId);
  const [open, setOpen] = useState(false);
  // Dismissals are for this sitting only: the suggestion is derived from live
  // numbers, so it should come back tomorrow if the number is still true.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [approved, setApproved] = useState<string[]>([]);

  const rows = (q.data?.rows ?? []).filter((r) => !dismissed.includes(r.code));
  const shown = open ? rows : rows.slice(0, TOP);

  const onApprove = (s: Dash5Suggestion) => {
    approve.mutate(s, {
      onSuccess: () => {
        setApproved((a) => [...a, s.code]);
        toast.success(`Assigned to ${s.assignee_name ?? "the school admin"}`);
      },
      onError: (e: Error) =>
        toastError(e, { fallback: "Couldn't create that task.", context: "dash5ApproveSuggestion" }),
    });
  };

  return (
    <V5Card className="mb-6">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[260px]">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Suggested tasks</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Drafts until you approve them. Approving creates a real task for the person named.
          </p>
        </div>
        {q.data && <LevelTag>{q.data.high} high · {rows.length} drafts</LevelTag>}
      </V5CardHead>

      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading label="Working out what to suggest…" />
        ) : q.isError ? (
          <V5Error label="Couldn't build task suggestions." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="Nothing to suggest right now"
            sub="Suggestions appear when a number on this page crosses a line worth acting on."
          />
        ) : (
          <>
            <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
              {shown.map((s) => {
                const pr = PRIORITY[s.priority] ?? PRIORITY[3];
                const done = approved.includes(s.code);
                return (
                  <li key={s.code} className="flex flex-wrap items-start gap-3 py-3">
                    <span
                      className="mt-0.5 inline-flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11.5px] font-bold"
                      style={{
                        color: `hsl(var(${pr.varName}))`,
                        background: `hsl(var(${pr.varName}) / 0.12)`,
                        borderColor: `hsl(var(${pr.varName}) / 0.26)`,
                      }}
                    >
                      <span className="text-[9px] leading-none" aria-hidden>{pr.glyph}</span>
                      {pr.label}
                    </span>
                    <span className="min-w-0 flex-1 basis-[220px]">
                      <span className="block text-[13px] font-semibold tracking-[-0.01em] text-ink-900">{s.title}</span>
                      <span className="mt-0.5 block text-[11.5px] font-medium text-ink-500">
                        {s.assignee_name ?? "Unassigned"} · due in {s.due_days} days
                      </span>
                      <span className="mt-0.5 block text-[11.5px] font-medium text-ink-400">{s.detail}</span>
                    </span>
                    <span className="ml-auto flex flex-none gap-2">
                      {done ? (
                        <span className="self-center text-[12px] font-bold" style={{ color: "hsl(var(--dash-exc))" }}>
                          Assigned
                        </span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => onApprove(s)}
                            disabled={approve.isPending || !s.assignee_id}
                          >
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDismissed((d) => [...d, s.code])}>
                            Dismiss
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {rows.length > TOP && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                  "mt-3 w-full border-t border-surface-stroke pt-3 text-center text-[12.5px] font-bold",
                  "text-brand-primary hover:underline",
                )}
              >
                {open ? "Show less" : `Show all ${rows.length} suggestions`}
              </button>
            )}
            <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-500">
              These are read off the numbers already on this page, not generated by a model, so each
              one can be traced to the figure that produced it. Dismissing hides a suggestion for this
              sitting only: if the number is still true tomorrow, it comes back.
            </p>
          </>
        )}
      </div>
    </V5Card>
  );
}
