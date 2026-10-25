import { cn } from "@/lib/utils";
import { useCoordClasses, useCoordStaff, type CoordStaffStatus } from "@/hooks/dashboard/useCoord";

import {
  LevelTag, TradTable, V5Card, V5CardHead, V5Empty, V5Error, V5Loading, tdBase, thBase,
} from "../v5/primitives";

/**
 * "Your classes" and "Staff attendance & leave in your wing".
 *
 * Reference: public/report_reference/salci-coordinator-dashboard2.html,
 * `#ctTbl` and `#leaveList`.
 */

/* --------------------------------------------------------- your classes --- */

function Count({ n, tone }: { n: number; tone?: string }) {
  if (n === 0) return <span className="text-ink-400 tabular-nums">0</span>;
  return (
    <span className="font-bold tabular-nums" style={tone ? { color: `hsl(${tone})` } : undefined}>
      {n}
    </span>
  );
}

/**
 * A class is owned by the SET of teachers who take it, which is why the teacher
 * column is a count with a sample rather than one name: anything addressed to a
 * class fans out to that set.
 */
export function CoordClasses() {
  const q = useCoordClasses();
  const rows = q.data?.rows ?? [];

  return (
    <V5Card className="mb-4">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Your classes</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Every class mapped to your wing, with what each one is short of today.
          </p>
        </div>
        {q.data && (
          <LevelTag>
            {q.data.total} {q.data.total === 1 ? "class" : "classes"}
            {q.data.unmarked > 0 ? ` · ${q.data.unmarked} unmarked today` : " · all marked today"}
          </LevelTag>
        )}
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load your classes." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="No classes are mapped to your wing"
            sub="An administrator maps classes to wings from the Wings page."
          />
        ) : (
          <TradTable>
            <thead>
              <tr>
                <th className={thBase}>Class</th>
                <th className={thBase}>Class teacher</th>
                <th className={cn(thBase, "text-right")}>Teachers</th>
                <th className={cn(thBase, "text-right")}>Students</th>
                <th className={cn(thBase, "text-right")}>Marked today</th>
                <th className={cn(thBase, "text-right")}>Attendance</th>
                <th className={cn(thBase, "text-right")}>Needing attention</th>
                <th className={cn(thBase, "text-right")}>Under 75%</th>
                <th className={cn(thBase, "text-right")}>Never signed in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.class_id}>
                  <td className={cn(tdBase, "font-semibold text-ink-900")}>{r.label}</td>
                  <td className={tdBase}>
                    {/* Alliance has classes with no subjectless teacher row, so
                        this is genuinely unknown rather than missing data. */}
                    {r.class_teacher ?? <span className="text-ink-400">Not assigned</span>}
                  </td>
                  <td className={cn(tdBase, "text-right")}>
                    <span className="block tabular-nums">{r.teachers}</span>
                    {r.teacher_sample && (
                      <span className="mt-px block whitespace-nowrap text-[10.5px] font-medium text-ink-400">
                        {r.teacher_sample}
                        {r.teachers > 1 ? ` +${r.teachers - 1}` : ""}
                      </span>
                    )}
                  </td>
                  <td className={cn(tdBase, "text-right tabular-nums")}>{r.students}</td>
                  <td className={cn(tdBase, "text-right")}>
                    {r.marked_today ? (
                      <span className="font-bold" style={{ color: "hsl(var(--dash-exc))" }}>Yes</span>
                    ) : (
                      <span className="font-bold" style={{ color: "hsl(var(--dash-critical))" }}>No</span>
                    )}
                  </td>
                  <td className={cn(tdBase, "text-right tabular-nums")}>
                    {r.attendance != null
                      ? `${r.attendance.toFixed(1)}%`
                      : <span className="text-ink-400">N/A</span>}
                  </td>
                  <td className={cn(tdBase, "text-right")}>
                    <Count n={r.at_risk} tone="var(--dash-warning)" />
                  </td>
                  <td className={cn(tdBase, "text-right")}>
                    <Count n={r.under75} tone="var(--dash-critical)" />
                  </td>
                  <td className={cn(tdBase, "text-right")}>
                    <Count n={r.never_in} tone="var(--dash-critical)" />
                  </td>
                </tr>
              ))}
            </tbody>
          </TradTable>
        )}
      </div>
    </V5Card>
  );
}

/* --------------------------------------------------------- staff & leave -- */

const STATUS: Record<CoordStaffStatus, { label: string; varName: string }> = {
  present:  { label: "Present",   varName: "--dash-exc" },
  late:     { label: "Late",      varName: "--dash-warning" },
  absent:   { label: "Absent",    varName: "--dash-critical" },
  on_leave: { label: "On leave",  varName: "--dash-warning" },
  unmarked: { label: "Unmarked",  varName: "--ink-400" },
};

function StatusPill({ status, auto }: { status: CoordStaffStatus; auto: boolean }) {
  const s = STATUS[status] ?? STATUS.unmarked;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-bold"
      style={{
        color: `hsl(var(${s.varName}))`,
        background: `hsl(var(${s.varName}) / 0.12)`,
        borderColor: `hsl(var(${s.varName}) / 0.26)`,
      }}
    >
      {s.label}
      {/* An absence the cron wrote is a different fact from one a human
          recorded, and a coordinator chasing it needs to know which. */}
      {auto && status === "absent" && <span className="font-semibold opacity-70">auto</span>}
    </span>
  );
}

export function CoordStaff() {
  const q = useCoordStaff();
  const rows = q.data?.rows ?? [];

  return (
    <V5Card className="mb-8">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Staff attendance in your wing
          </h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Everyone who takes a class in your wing, today. Absent and unmarked first.
          </p>
        </div>
        {q.data && q.data.leave_pending > 0 && (
          <LevelTag>
            {q.data.leave_pending} student leave request
            {q.data.leave_pending === 1 ? "" : "s"} pending
          </LevelTag>
        )}
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load staff attendance." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="No teachers are assigned to your wing's classes"
            sub="Assign teachers from Classes, then this fills in on its own."
          />
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {([
                ["Present today", q.data!.present, "--dash-exc"],
                ["On approved leave", q.data!.on_leave, "--dash-warning"],
                ["Absent", q.data!.absent, "--dash-critical"],
                ["Unmarked", q.data!.unmarked, "--ink-400"],
              ] as const).map(([label, n, v]) => (
                <div
                  key={label}
                  className="rounded-[11px] border border-surface-stroke bg-surface-stroke/30 px-3 py-2"
                >
                  <span className="block text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-400">
                    {label}
                  </span>
                  <span
                    className="mt-0.5 block text-[20px] font-extrabold leading-none tabular-nums"
                    style={{ color: `hsl(var(${v}))` }}
                  >
                    {n}
                    <span className="text-[12px] font-bold text-ink-400">/{q.data!.total}</span>
                  </span>
                </div>
              ))}
            </div>
            <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1 basis-[180px]">
                    <span className="block text-[13px] font-semibold text-ink-900">{r.name}</span>
                    <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                      {r.classes} {r.classes === 1 ? "class" : "classes"} in your wing
                    </span>
                  </span>
                  <StatusPill status={r.status} auto={r.auto} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </V5Card>
  );
}
