import * as React from "react";
import { AlertTriangle, Info, Wifi } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useTeacherClassSubjects,
  useTeacherPortalAdoption,
  useTeacherRosterGap,
} from "@/hooks/dashboard/useTeacherDashboardData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Spec 2.7 — "Are your students using SALCI?".
 *
 * Logins come from student_activity_daily, a daily rollup of TWO sources:
 * auth.refresh_tokens (fine-grained, one row per active day) and
 * auth.users.last_sign_in_at (coarse, but survives GoTrue's token pruning).
 * Tokens alone captured only 1 of 9 students in the class this was measured on,
 * which is why both are needed. Neither table is client-queryable, hence the
 * rollup. The RPC returns counts and at most three names — never a
 * student-level activity row.
 */
export function TeacherPortalAdoption() {
  // Class options come from the teacher's own assignment pairs. Hidden entirely
  // when there is only one class, so there is never a control with one choice.
  const pairsQuery = useTeacherClassSubjects();
  const classOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pairsQuery.data?.pairs ?? []) {
      m.set(p.class_id, p.section ? `${p.class_name} ${p.section}` : p.class_name);
    }
    return Array.from(m, ([id, label]) => ({ id, label }));
  }, [pairsQuery.data]);

  const [classId, setClassId] = React.useState<string | null>(null);
  const showClass = classOptions.length > 1;

  const { data, isLoading, isError } = useTeacherPortalAdoption(showClass ? classId : null);

  // Roster-vs-class gap. dash_teacher_roster_gap was written for the
  // 2026-08-25 optional-subject blackout and then never mounted anywhere, so
  // the one signal that explains a shrunken denominator was invisible. When
  // narrowing legitimately cuts the roster (a section HAS recorded optional
  // choices), every percentage on this card is computed over that smaller
  // roster - say so instead of letting the number look like the whole class.
  const rosterGap = useTeacherRosterGap();

  if (isLoading) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-4 h-32 w-full rounded-2xl" />
      </section>
    );
  }

  if (isError || !data?.has_data) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <h3 className="text-base font-semibold text-ink-900">Are your students using SALCI?</h3>
        <div className="mt-4">
          <EmptyState
            icon={<Wifi className="h-7 w-7" />}
            title={isError ? "Couldn't load portal activity" : "No students yet"}
            description={
              isError
                ? "Something went wrong. Refresh to try again."
                : "Once students are enrolled in your classes their portal activity shows here."
            }
            reason={isError ? "error" : "noData"}
            tone={isError ? "rose" : "teal"}
            size="sm"
          />
        </div>
      </section>
    );
  }

  const never = data.never_logged_in;
  const spark = data.sparkline ?? [];
  const peak = Math.max(1, ...spark.map((p) => p.n));

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink-900">Are your students using SALCI?</h3>
        {showClass && (
          <Select value={classId ?? "all"} onValueChange={(v) => setClassId(v === "all" ? null : v)}>
            <SelectTrigger className="h-9 w-[150px] shrink-0 rounded-lg text-sm">
              <SelectValue placeholder="All my classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my classes</SelectItem>
              {classOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-[18px] text-ink-500">
        Every student in your classes. Logins, plus what they actually do once they are in.
      </p>

      {rosterGap.data?.gap && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-sky-500/10 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
          <p className="text-[13px] leading-[18px] text-ink-700">
            These figures cover the{" "}
            <span className="font-semibold">{rosterGap.data.roster}</span> students
            you teach, not all{" "}
            <span className="font-semibold">{rosterGap.data.class_total}</span> in
            these classes - your subject is optional, so only students who chose
            it are counted.
          </p>
        </div>
      )}

      {never && never.count > 0 && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-[13px] leading-[18px] text-ink-700">
            <span className="font-semibold">{never.count}</span>{" "}
            {never.count === 1 ? "account has" : "accounts have"} never been opened
            {never.names.length > 0 && <> · {never.names.join(", ")}
              {never.count > never.names.length && ` and ${never.count - never.names.length} more`}</>}
            .
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Today" n={data.today?.n} pct={data.today?.pct} />
        <Metric label="Yesterday" n={data.yesterday?.n} pct={data.yesterday?.pct} />
        <Metric label="Active in 7 days" n={data.avg_7?.n} pct={data.avg_7?.pct} />
        <Metric label="Active in 30 days" n={data.avg_30?.n} pct={data.avg_30?.pct} />
      </div>

      {spark.length > 0 && <Sparkline points={spark} peak={peak} />}

      <div className="mt-5 space-y-3">
        <Bar label="Homework submitted" pct={data.engagement?.homework_pct ?? null} />
        <Bar label="Tests attempted" pct={data.engagement?.tests_pct ?? null} />
      </div>
    </section>
  );
}

/**
 * A real line sparkline, drawn as inline SVG.
 *
 * The bar version this replaced gave every zero-value day a 4% floor so it stayed
 * visible, which rendered thirteen identical hairlines beside one full-height
 * spike — it read as broken rather than as "one active day". A line makes a
 * sparse series legible: it sits flat on the baseline and rises where activity
 * actually happened.
 *
 * Inline SVG rather than Recharts: fourteen integers do not need a chart
 * library, and this sidesteps the project's ResponsiveContainer-collapses-to-
 * zero-height gotcha entirely.
 */
function Sparkline({ points, peak }: { points: { d: string; n: number }[]; peak: number }) {
  const W = 100;
  const H = 32;
  const PAD = 3;
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const yOf = (n: number) => H - PAD - (peak > 0 ? n / peak : 0) * (H - PAD * 2);

  const coords = points.map((p, i) => [i * step, yOf(p.n)] as const);
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  const fmt = (iso: string) => {
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime())
      ? ""
      : dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };

  const total = points.reduce((a, p) => a + p.n, 0);

  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Daily active, last 14 days</p>
        <p className="text-[11px] text-ink-500 tabular-nums">peak {peak}</p>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-2 h-14 w-full overflow-visible"
        role="img"
        aria-label={`Daily active students over the last 14 days, ${total} visits in total, peak ${peak} in a day`}
      >
        {/* Baseline, so a flat series still reads as a chart and not a blank box. */}
        <line
          x1="0"
          y1={H - PAD}
          x2={W}
          y2={H - PAD}
          stroke="hsl(var(--ink-400) / 0.25)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <polygon points={area} fill="hsl(var(--brand-primary) / 0.12)" />
        <polyline
          points={line}
          fill="none"
          stroke="hsl(var(--brand-primary))"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          /* Keeps the stroke an even weight despite the squashed aspect ratio. */
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-1 flex justify-between text-[11px] text-ink-400">
        <span>{fmt(points[0]?.d ?? "")}</span>
        <span>{fmt(points[points.length - 1]?.d ?? "")}</span>
      </div>
    </div>
  );
}

function Metric({ label, n, pct }: { label: string; n?: number; pct?: number }) {
  const low = pct != null && pct < 40;
  return (
    <div className="rounded-2xl border border-[hsl(var(--surface-stroke))] p-3">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "mt-1 text-[22px] font-semibold leading-tight tabular-nums",
          low ? "text-amber-600" : "text-ink-900",
        )}
      >
        {n ?? 0}
      </p>
      <p className="text-[12px] text-ink-500 tabular-nums">{pct ?? 0}% of the class</p>
    </div>
  );
}

function Bar({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-700">{label}</span>
        <span className="text-[13px] font-medium tabular-nums text-ink-900">
          {pct == null ? "N/A" : `${pct}%`}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[hsl(var(--ink-400)/0.12)]">
        <div
          className="h-full rounded-full bg-brand-primary"
          style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
        />
      </div>
    </div>
  );
}
