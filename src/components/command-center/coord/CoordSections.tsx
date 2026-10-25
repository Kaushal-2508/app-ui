import * as React from "react";
import { useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";
import {
  useCoordAttendanceByClass, useCoordCommunication, useCoordMyTasks, useCoordSubjects,
  useCoordSuggestions,
} from "@/hooks/dashboard/useCoord";

import { toast } from "sonner";

import { toastError } from "@/lib/toast";
import { useDash5ApproveSuggestion } from "@/hooks/dashboard/useDash5";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

import { PriorityPill } from "../v5/Drawer";
import { FilterLabel, FilterSelect, FilterStrip } from "../v5/FilterBar";
import { useScopeFilter } from "../v5/useScopeFilter";
import {
  BarRow, BarsH, LevelTag, V5Card, V5CardHead, V5Empty, V5Error, V5Loading,
} from "../v5/primitives";

/**
 * The remaining coordinator sections: attendance by class, the wing's own task
 * suggestions, the tasks pushed down from the principal, and the hand-off to
 * Communication.
 *
 * Reference: public/report_reference/salci-coordinator-dashboard2.html.
 */

/* ------------------------------------------------- attendance by class ---- */

/**
 * The admin console compares wings; a coordinator has one, so the same card
 * compares the classes inside it. The "not marked today" line beside it is the
 * point: a class with no register contributes nothing to any figure above.
 */
export function CoordAttendanceByClass() {
  const q = useCoordAttendanceByClass();
  const d = q.data;
  const rows = d?.rows ?? [];

  return (
    <V5Card className="mb-8">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Attendance by class
          </h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            The last {d?.days_in_window ?? 20} days your wing took a register. Weakest first.
          </p>
        </div>
        {d && (
          <LevelTag>
            {d.wing_pct != null ? `${d.wing_pct.toFixed(1)}% wing` : "Nothing marked"}
            {d.unmarked_today > 0 ? ` · ${d.unmarked_today} unmarked today` : " · all marked today"}
          </LevelTag>
        )}
      </V5CardHead>
      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load attendance by class." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="No register has been taken in your wing"
            sub="Attendance appears here the first time a class is marked."
          />
        ) : (
          <BarsH>
            {rows.map((r) => (
              <BarRow
                key={r.class_id}
                label={r.label}
                pct={r.pct ?? 0}
                value={r.pct != null ? `${r.pct.toFixed(1)}%` : "N/A"}
                color={
                  r.pct == null ? "hsl(var(--ink-400))"
                    : r.pct >= 90 ? "hsl(var(--dash-exc))"
                      : r.pct >= 75 ? "hsl(var(--dash-warning))" : "hsl(var(--dash-critical))"
                }
                /* A class that skipped today is the actionable fact on this
                   card, so it is said in words rather than left to the eye. */
                sub={
                  `${r.students} students · ${r.days_marked} of ${d?.days_in_window ?? 20} days marked`
                  + (r.marked_today ? "" : " · not marked today")
                }
                title={`${r.label}: ${r.present} present of ${r.marked} marked`}
              />
            ))}
          </BarsH>
        )}
      </div>
    </V5Card>
  );
}

/* --------------------------------------------------- subject performance -- */

/**
 * Subject-wise performance for the wing, weakest first.
 *
 * Not the admin card. Dash5SubjectPerformance reads dash_school_subject_
 * performance and dash_subject_performance, both gated on
 * dash_resolve_institution, which raises for a coordinator; and its school-wide
 * default would be the wrong question anyway. This runs on dash5_coord_subjects,
 * built from the same atoms as the performance tree.
 */
export function CoordSubjects() {
  const { classId, setClassId, classOptions } = useScopeFilter();
  const q = useCoordSubjects(classId);
  const d = q.data;
  const rows = d?.rows ?? [];
  const [all, setAll] = React.useState(false);

  // Never-assessed subjects are listed but not charted: a 0% bar reads as
  // failing when the truth is that nothing has been measured.
  const assessed = rows.filter((r) => r.accuracy != null);
  const unassessed = rows.filter((r) => r.accuracy == null);
  const shown = all ? assessed : assessed.slice(0, 8);

  return (
    <V5Card className="mb-8">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Subject-wise performance
          </h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Average score per subject across {d?.scope === "class" ? d.class_label : "your wing"},
            weakest first.
          </p>
        </div>
        {d && (
          <LevelTag>
            {d.assessed} of {d.total} assessed
            {d.wing_avg != null ? ` · ${d.wing_avg.toFixed(1)}% average` : ""}
          </LevelTag>
        )}
      </V5CardHead>
      <FilterStrip>
        <FilterLabel>Class</FilterLabel>
        <FilterSelect
          value={classId}
          onChange={setClassId}
          options={classOptions}
          allLabel="All my classes"
          width="w-[190px]"
        />
      </FilterStrip>
      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load subject performance." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="No subjects are mapped here yet"
            sub="Map subjects to your classes and their averages appear as papers are marked."
          />
        ) : (
          <>
            {assessed.length === 0 ? (
              <V5Empty
                title="No paper has been marked in your wing yet"
                sub="Every subject below is mapped but unassessed, so there is nothing to average."
              />
            ) : (
              <BarsH>
                {shown.map((r) => (
                  <BarRow
                    key={r.subject_key}
                    label={r.name}
                    pct={r.accuracy ?? 0}
                    value={`${(r.accuracy ?? 0).toFixed(1)}%`}
                    color={
                      (r.accuracy ?? 0) >= 84 ? "hsl(var(--dash-exc))"
                        : (r.accuracy ?? 0) >= 75.5 ? "hsl(var(--dash-good))"
                          : (r.accuracy ?? 0) >= 66 ? "hsl(var(--dash-warning))"
                            : "hsl(var(--dash-critical))"
                    }
                    /* The wing average as a reference line, so a bar can be
                       read against what it should be clearing. */
                    marker={d?.wing_avg ?? null}
                    sub={
                      (r.teachers > 1 ? `${r.teachers} teachers` : r.teacher ?? "Unassigned")
                      + ` · ${r.papers} ${r.papers === 1 ? "paper" : "papers"}`
                      + (r.coverage != null ? ` · ${r.coverage.toFixed(0)}% covered` : "")
                    }
                    title={`${r.name}: ${r.attempts} attempts across ${r.classes} classes`}
                  />
                ))}
              </BarsH>
            )}
            {assessed.length > 8 && (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="mt-3 w-full rounded-[10px] border border-surface-stroke py-2 text-[12.5px] font-semibold text-ink-600 hover:bg-surface-stroke/50 hover:text-ink-900"
              >
                {all ? "Show less" : `Show all ${assessed.length} assessed subjects`}
              </button>
            )}
            {unassessed.length > 0 && (
              <p className="mt-3 text-[11.5px] font-medium text-ink-400">
                Not charted, because nothing has been examined in them yet:{" "}
                <b className="text-ink-600">{unassessed.map((r) => r.name).join(", ")}</b>.
              </p>
            )}
          </>
        )}
      </div>
    </V5Card>
  );
}

/* ------------------------------------------------------ task suggestions -- */

/**
 * Drafts until approved. Every assignee is a teacher in the wing: the reference
 * is explicit that a coordinator cannot assign upward or sideways, so a
 * suggestion with no teacher to carry it is dropped server-side rather than
 * defaulted back to the coordinator.
 */
export function CoordSuggestions() {
  const q = useCoordSuggestions();
  const { institutionId } = useEffectiveInstitution();
  const approve = useDash5ApproveSuggestion(institutionId);
  // Dismissals last for this sitting only. Every suggestion is derived from a
  // live number, so it should come back tomorrow if the number is still true.
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [assigned, setAssigned] = React.useState<string[]>([]);

  const rows = (q.data?.rows ?? []).filter((r) => !dismissed.includes(r.code));

  return (
    <>
      <V5Card className="mb-8">
        <V5CardHead>
          <div className="flex-1">
            <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
              Suggested tasks
            </h3>
            <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
              Approve to assign, or ignore. Each one names the teacher who owns the work.
            </p>
          </div>
          {q.data && <LevelTag>{q.data.total} drafts · {q.data.pace}% of the year gone</LevelTag>}
        </V5CardHead>
        <div className="px-4 pb-4 sm:px-[18px]">
          {q.isLoading ? (
            <V5Loading />
          ) : q.isError ? (
            <V5Error label="Couldn't load task suggestions." onRetry={() => void q.refetch()} />
          ) : rows.length === 0 ? (
            <V5Empty
              title="Nothing to suggest"
              sub="Every class in your wing is on pace, marked up to date and logging its periods."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
              {rows.map((r) => (
                <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <PriorityPill priority={r.priority} />
                  <span className="min-w-0 flex-1 basis-[240px]">
                    <span className="block text-[13px] font-semibold text-ink-900">{r.title}</span>
                    <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                      {r.detail}
                    </span>
                    <span className="mt-1 block text-[11.5px] font-semibold text-ink-600">
                      {r.assignee} · due in {r.due_days} {r.due_days === 1 ? "day" : "days"}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    {assigned.includes(r.code) ? (
                      <span
                        className="whitespace-nowrap rounded-[9px] px-2.5 py-1 text-[12px] font-bold"
                        style={{
                          color: "hsl(var(--dash-exc))",
                          background: "hsl(var(--dash-exc) / 0.12)",
                        }}
                      >
                        Assigned
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={approve.isPending}
                        onClick={() => approve.mutate(
                          {
                            code: r.code, title: r.title, detail: r.detail,
                            priority: r.priority, task_type: r.task_type,
                            due_days: r.due_days, assignee_id: r.assignee_id,
                            assignee_name: r.assignee,
                          },
                          {
                            onSuccess: () => {
                              setAssigned((a) => [...a, r.code]);
                              toast.success(`Assigned to ${r.assignee}`);
                            },
                            onError: (e: Error) => toastError(e, {
                              fallback: "Couldn't create that task.",
                              context: "coordApproveSuggestion",
                            }),
                          },
                        )}
                        className="whitespace-nowrap rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-bold text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/10 disabled:opacity-50"
                      >
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDismissed((x) => [...x, r.code])}
                      className="whitespace-nowrap rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-semibold text-ink-500 transition-colors duration-200 hover:text-ink-900"
                    >
                      Dismiss
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </V5Card>
    </>
  );
}

/* -------------------------------------------------- tasks from above ------ */

/**
 * A coordinator sits between two task planes: what they assign downward, and
 * what lands on them from the principal. Only the second belongs here, so the
 * card can never be confused with their own outbox.
 */
export function CoordMyTasks() {
  const q = useCoordMyTasks();
  const [open, setOpen] = React.useState(false);
  const rows = q.data?.rows ?? [];
  const shown = open ? rows : rows.slice(0, 4);
  const nav = useNavigate();

  return (
    <V5Card className="mb-8">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Assigned to you
          </h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Tasks the principal and the system have pushed down to you. Soonest due first.
          </p>
        </div>
        {q.data && (
          <LevelTag>
            {q.data.total} open
            {q.data.overdue > 0 ? ` · ${q.data.overdue} overdue` : ""}
          </LevelTag>
        )}
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load your tasks." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty title="Nothing is assigned to you" sub="Your task list is clear." />
        ) : (
          <>
            <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
              {shown.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <PriorityPill priority={t.priority ?? 2} />
                  <span className="min-w-0 flex-1 basis-[240px]">
                    <span className="block text-[13px] font-semibold text-ink-900">{t.title}</span>
                    {t.detail && (
                      <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                        {t.detail}
                      </span>
                    )}
                    <span className="mt-1 block text-[11.5px] font-medium text-ink-400">
                      {t.from}
                    </span>
                  </span>
                  <span
                    className="shrink-0 whitespace-nowrap text-[11.5px] font-bold tabular-nums"
                    style={{
                      color: t.due_in_days != null && t.due_in_days < 0
                        ? "hsl(var(--dash-critical))" : "hsl(var(--ink-500))",
                    }}
                  >
                    {t.due_in_days == null
                      ? "No due date"
                      : t.due_in_days < 0
                        ? `${Math.abs(t.due_in_days)}d overdue`
                        : t.due_in_days === 0 ? "Due today" : `in ${t.due_in_days}d`}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {rows.length > 4 && (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="flex-1 rounded-[10px] border border-surface-stroke py-2 text-[12.5px] font-semibold text-ink-600 hover:bg-surface-stroke/50 hover:text-ink-900"
                >
                  {open ? "Show less" : `Show all ${rows.length}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => nav("/tasks")}
                className="flex-1 rounded-[10px] border border-surface-stroke py-2 text-[12.5px] font-semibold text-brand-primary hover:border-brand-primary hover:bg-brand-primary/10"
              >
                Open your task list
              </button>
            </div>
          </>
        )}
      </div>
    </V5Card>
  );
}

/* -------------------------------------------------------- communication --- */

/**
 * A hand-off, matching what the admin console settled on: /school/communication
 * already owns notices, the diary, PTM and messages in full, and repeating a
 * slice here was a second place to keep in step. The figures are wing-scoped so
 * the row says whether the click is worth it.
 */
export function CoordCommunication() {
  const q = useCoordCommunication();
  const d = q.data;
  const nav = useNavigate();

  const chips: string[] = [];
  if (d) {
    if (d.notices.total > 0) {
      chips.push(`${d.notices.total} notice${d.notices.total === 1 ? "" : "s"} reached your wing`);
      if (d.notices.sent > 0) {
        chips.push(`${Math.round((d.notices.opened * 100) / d.notices.sent)}% opened`);
      }
    }
    if (d.ptm.total > 0) {
      chips.push(`${d.ptm.total} meeting${d.ptm.total === 1 ? "" : "s"} in the next 30 days`);
      if (d.ptm.bookings > 0) chips.push(`${d.ptm.bookings.toLocaleString()} slots booked`);
    }
    if (chips.length === 0) chips.push("Nothing has been sent to your wing this year");
  }

  return (
    <V5Card className="mb-8 overflow-hidden">
      <button
        type="button"
        onClick={() => nav("/school/communication")}
        className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-stroke/40 sm:px-[18px]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Communication
          </span>
          <span className="mt-0.5 block text-xs font-medium text-ink-500">
            Notices and meetings, counted over your classes only.
          </span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span
                key={c}
                className={cn(
                  "inline-flex items-center rounded-full border border-surface-stroke",
                  "px-2.5 py-1 text-[11px] font-semibold text-ink-600",
                )}
              >
                {c}
              </span>
            ))}
          </span>
        </span>
      </button>
    </V5Card>
  );
}
