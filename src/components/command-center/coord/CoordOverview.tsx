import * as React from "react";
import { useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";
import {
  useCoordCards, useCoordDesk, useCoordLeave, useCoordRechecks,
  type CoordScope,
} from "@/hooks/dashboard/useCoord";

import { Dash5Drawer, DrawerHint, DrawerSection, MiniStats } from "../v5/Drawer";
import { V5Empty, V5Error, V5Loading } from "../v5/primitives";

/**
 * The top of the coordinator console: what this page counts, the four numbers
 * that matter this morning, and the four queues that close on this account.
 *
 * Reference: public/report_reference/salci-coordinator-dashboard2.html,
 * the scope bar, `.cards4` and `.deskgrid`.
 */

/* ------------------------------------------------------------ scope bar --- */

/**
 * "Your scope: 9 classes, 253 students, 171 subject-class pairs, 30 teachers."
 *
 * The reference puts this above everything because the first question a
 * coordinator asks a dashboard is what it is counting. Every figure comes from
 * the same rule the performance table uses, so the bar and the table agree by
 * construction rather than by coincidence.
 */
export function CoordScopeBar({ scope }: { scope: CoordScope | undefined }) {
  if (!scope) return null;
  const bits = [
    `${scope.classes} ${scope.classes === 1 ? "class" : "classes"}`,
    `${scope.students.toLocaleString()} students`,
    `${scope.subject_pairs} subject-class pairs`,
    `${scope.teachers} teachers`,
  ];
  return (
    <div className="mb-3.5 rounded-[13px] border border-surface-stroke bg-surface-stroke/30 px-4 py-2.5">
      <p className="m-0 text-[12.5px] leading-[1.5] font-medium text-ink-600">
        <b className="font-extrabold text-ink-900">Your scope:</b> {bits.join(" · ")}.{" "}
        <span className="text-ink-500">
          Everything on this page is computed over those rows only. Other wings are not
          hidden from view, they are not returned to you at all.
        </span>
      </p>
      {scope.other_wings.length > 0 && (
        /* Named out loud rather than silently merged. Adding two wings together
           under a heading that says "your wing" would be the worse answer. */
        <p className="m-0 mt-1.5 text-[11.5px] font-semibold text-ink-500">
          You are also assigned to {scope.other_wings.map((w) => w.name).join(", ")}. This page
          shows {scope.wing_name} only.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ KPI cards --- */

function Card({
  label, value, of, pct, caption, good,
}: {
  label: string; value: string; of?: string;
  pct: number | null; caption: string; good: boolean;
}) {
  const tone = good ? "var(--dash-exc)" : "var(--dash-warning)";
  return (
    <div className="surface-card frosted-shadow rounded-[13px] border border-surface-stroke px-4 py-3">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-400">{label}</p>
      <p className="m-0 mt-1 text-[28px] font-extrabold leading-[1.1] tracking-[-0.035em] text-ink-900 tabular-nums">
        {value}
        {of && <span className="text-[15px] font-bold text-ink-400">/{of}</span>}
      </p>
      <div className="mb-2 mt-0.5 flex flex-wrap items-baseline gap-x-2">
        {pct != null && (
          <span className="text-[13px] font-extrabold tabular-nums" style={{ color: `hsl(${tone})` }}>
            {pct.toFixed(1)}%
          </span>
        )}
        <span className="text-[11.5px] font-medium text-ink-500">{caption}</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-[3px] bg-surface-stroke">
        <span
          className="block h-full rounded-[3px]"
          style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: `hsl(${tone})` }}
        />
      </div>
    </div>
  );
}

/**
 * The fourth card is deliberately not one of the admin's four. A principal's
 * daily number is the school average; a coordinator's is whether the day was
 * recorded at all, because every other figure on this page stays understated
 * until it is.
 */
export function CoordCards() {
  const q = useCoordCards();

  if (q.isLoading) return <V5Loading label="Loading today's numbers…" />;
  // Error before empty, always: a failed read must never render as four zeros.
  if (q.isError || !q.data) {
    return <V5Error label="Couldn't load today's numbers." onRetry={() => void q.refetch()} />;
  }
  const d = q.data;

  return (
    <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        label="Students present today"
        value={d.students.marked > 0 ? d.students.present.toLocaleString() : "N/A"}
        of={d.students.marked > 0 ? d.students.marked.toLocaleString() : undefined}
        pct={d.students.pct}
        /* Before anyone takes a register the honest caption is that nobody has,
           not "0%". A dashboard that reports an unmarked morning as an empty
           school is how a coordinator learns to ignore it. */
        caption={
          d.students.marked > 0
            ? `${d.students.roll.toLocaleString()} on the roll${
                d.students.school_pct != null ? ` · school ${d.students.school_pct.toFixed(1)}%` : ""}`
            : "No register taken in your wing yet today"
        }
        good={(d.students.pct ?? 0) >= 90}
      />
      <Card
        label="Your teachers present"
        value={d.teachers.present.toLocaleString()}
        of={d.teachers.roll.toLocaleString()}
        pct={d.teachers.pct}
        caption={
          d.teachers.marked === 0
            ? "Nobody has checked in yet"
            : `${d.teachers.roll - d.teachers.marked} still unmarked`
        }
        good={d.teachers.present === d.teachers.roll}
      />
      <Card
        label="Wing average score"
        value={d.score.wing != null ? `${d.score.wing.toFixed(1)}%` : "N/A"}
        pct={d.score.wing}
        caption={
          d.score.delta != null && d.score.school != null
            ? `${d.score.delta >= 0 ? "+" : ""}${d.score.delta.toFixed(1)} pts against school ${d.score.school.toFixed(1)}%`
            : "Nothing assessed yet this year"
        }
        good={(d.score.delta ?? 0) >= 0}
      />
      {/* Lesson plans updated, over the periods that have ENDED. The whole
          day's count was the old denominator, which read "2 / 63" at ten in
          the morning against a day that had taught eight periods. Same rule as
          the lesson-plan grid, so the card and the grid always agree. */}
      <Card
        label="Periods logged today"
        value={d.periods.logged.toLocaleString()}
        of={d.periods.due > 0 ? d.periods.due.toLocaleString() : undefined}
        pct={d.periods.pct}
        caption={
          d.periods.total === 0
            ? "No teaching periods scheduled today"
            : d.periods.due === 0
              ? `${d.periods.total} periods today, none finished yet`
              : d.periods.due < d.periods.total
                ? `lesson plans updated so far · ${d.periods.total - d.periods.due} periods still to come`
                : "lesson plans updated today"
        }
        good={d.periods.due > 0 && (d.periods.pct ?? 0) >= 90}
      />
    </div>
  );
}

/* ------------------------------------------------------------- the desk --- */

type DeskKey = "tasks" | "leave" | "rechecks" | "grading";

function DeskTile({
  label, value, sub, cta, accent, onClick,
}: {
  label: string; value: number; sub: React.ReactNode; cta: string;
  accent: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "surface-card frosted-shadow rounded-[13px] border border-surface-stroke",
        "border-l-[3px] px-4 py-3 text-left transition-colors duration-200",
        "hover:bg-surface-stroke/40",
      )}
      style={{ borderLeftColor: `hsl(${accent})` }}
    >
      <span className="block text-[11px] font-bold uppercase tracking-[0.05em] text-ink-400">
        {label}
      </span>
      <span
        className="mt-1 block text-[26px] font-extrabold leading-[1.1] tracking-[-0.035em] tabular-nums"
        style={{ color: `hsl(${accent})` }}
      >
        {value.toLocaleString()}
      </span>
      <span className="mt-0.5 block text-[11.5px] font-medium text-ink-500">{sub}</span>
      <span className="mt-2 block text-[12px] font-bold text-brand-primary">{cta} &rarr;</span>
    </button>
  );
}

/**
 * Four queues that close on THIS account and nobody else's. They sit above the
 * analytics because everything else on the page is work for a teacher, and this
 * is the part a coordinator cannot hand on.
 */
export function CoordDesk() {
  const q = useCoordDesk();
  const [open, setOpen] = React.useState<DeskKey | null>(null);
  const nav = useNavigate();

  const leave = useCoordLeave(open === "leave");
  const rechecks = useCoordRechecks(open === "rechecks");

  if (q.isLoading) return <V5Loading label="Loading your desk…" />;
  if (q.isError || !q.data) {
    return <V5Error label="Couldn't load your desk." onRetry={() => void q.refetch()} />;
  }
  const d = q.data;

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DeskTile
          label="Tasks assigned to you"
          value={d.tasks.count}
          accent={d.tasks.overdue > 0 ? "var(--dash-critical)" : "var(--brand-secondary)"}
          sub={
            d.tasks.overdue > 0
              ? <><b className="text-[hsl(var(--dash-critical))]">{d.tasks.overdue} overdue</b>
                {d.tasks.high > 0 ? ` · ${d.tasks.high} high priority` : ""}</>
              : d.tasks.high > 0 ? `${d.tasks.high} high priority` : "Nothing overdue"
          }
          cta="Open your task list"
          onClick={() => nav("/tasks")}
        />
        <DeskTile
          label="Leave awaiting your decision"
          value={d.leave.count}
          accent="var(--dash-warning)"
          sub={
            d.leave.count === 0
              ? "Nothing waiting"
              : `Oldest waiting ${d.leave.oldest_days} ${d.leave.oldest_days === 1 ? "day" : "days"}${
                  d.leave.oldest_class ? ` · ${d.leave.oldest_class}` : ""}`
          }
          cta="Approve or reject"
          onClick={() => setOpen("leave")}
        />
        <DeskTile
          label="Recheck requests"
          value={d.rechecks.count}
          accent="var(--brand-primary)"
          sub={
            d.rechecks.count === 0
              ? "Nothing waiting"
              : `Across ${d.rechecks.classes} ${d.rechecks.classes === 1 ? "class" : "classes"} · oldest ${d.rechecks.oldest_days} days`
          }
          cta="Open the recheck queue"
          onClick={() => setOpen("rechecks")}
        />
        <DeskTile
          label="Papers held, not graded"
          value={d.grading.count}
          accent="var(--dash-critical)"
          sub={
            d.grading.count === 0
              ? "Every paper held has been marked"
              : `Across ${d.grading.classes} ${d.grading.classes === 1 ? "class" : "classes"}. Results cannot publish until these close.`
          }
          cta="See the classes"
          onClick={() => setOpen("grading")}
        />
      </div>

      {/* ---- leave ---- */}
      <Dash5Drawer
        open={open === "leave"}
        onOpenChange={(v) => setOpen(v ? "leave" : null)}
        title="Leave awaiting your decision"
        subtitle={`${d.leave.count} request${d.leave.count === 1 ? "" : "s"} across your wing`}
      >
        {leave.isLoading ? (
          <V5Loading />
        ) : leave.isError ? (
          <V5Error label="Couldn't load the leave requests." onRetry={() => void leave.refetch()} />
        ) : !leave.data?.rows.length ? (
          <V5Empty
            title="No leave is waiting on you"
            sub="Applications from your classes appear here the moment a student files one."
          />
        ) : (
          <>
            <DrawerSection title="Waiting longest first">
              <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
                {leave.data.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span className="min-w-0 flex-1 basis-[190px]">
                      <span className="block text-[13px] font-semibold text-ink-900">{r.student}</span>
                      <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                        {r.class_label} · {r.days} {r.days === 1 ? "day" : "days"}
                        {r.reason ? ` · ${r.reason}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] font-bold text-ink-500 tabular-nums">
                      waiting {r.waiting_days}d
                    </span>
                  </li>
                ))}
              </ul>
            </DrawerSection>
            <DrawerHint>
              Approving or rejecting happens on the leave page, which writes the decision and the
              attendance record in one transaction.
            </DrawerHint>
          </>
        )}
      </Dash5Drawer>

      {/* ---- rechecks ---- */}
      <Dash5Drawer
        open={open === "rechecks"}
        onOpenChange={(v) => setOpen(v ? "rechecks" : null)}
        title="Recheck requests"
        subtitle={`${d.rechecks.count} open across ${d.rechecks.classes} of your classes`}
      >
        {rechecks.isLoading ? (
          <V5Loading />
        ) : rechecks.isError ? (
          <V5Error label="Couldn't load the recheck queue." onRetry={() => void rechecks.refetch()} />
        ) : !rechecks.data?.rows.length ? (
          <V5Empty title="Nothing to recheck" sub="No student in your wing has queried a mark." />
        ) : (
          <>
            <MiniStats
              items={[
                { label: "Open", value: String(d.rechecks.count) },
                { label: "Classes", value: String(d.rechecks.classes) },
                { label: "Oldest", value: `${d.rechecks.oldest_days}d` },
              ]}
            />
            <DrawerSection title="Oldest first">
              <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
                {rechecks.data.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span className="min-w-0 flex-1 basis-[200px]">
                      <span className="block text-[13px] font-semibold text-ink-900">
                        {r.student}
                        {r.was_pct != null && (
                          <span className="ml-1.5 font-bold text-ink-400 tabular-nums">
                            {r.was_pct}%
                          </span>
                        )}
                      </span>
                      <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                        {r.class_label} · {r.exam}
                      </span>
                      {r.reason && (
                        <span className="mt-1 block text-[11.5px] font-medium text-ink-400">
                          &ldquo;{r.reason}&rdquo;
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11.5px] font-bold text-ink-500 tabular-nums">
                      {r.days}d
                    </span>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          </>
        )}
      </Dash5Drawer>

      {/* ---- grading ---- */}
      <Dash5Drawer
        open={open === "grading"}
        onOpenChange={(v) => setOpen(v ? "grading" : null)}
        title="Papers held, not graded"
        subtitle={`${d.grading.count} across ${d.grading.classes} of your classes`}
      >
        <MiniStats
          items={[
            { label: "Papers", value: String(d.grading.count) },
            { label: "Classes", value: String(d.grading.classes) },
          ]}
        />
        <DrawerHint>
          Marking belongs to the subject teacher. What you can do from here is chase it: the
          performance table below names the teacher against every subject, and the class average
          on this page excludes every ungraded paper until it closes.
        </DrawerHint>
      </Dash5Drawer>
    </>
  );
}
