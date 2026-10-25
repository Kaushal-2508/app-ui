import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WifiOff } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClassName, cn } from "@/lib/utils";
import {
  SEVERITY_META,
  useTeacherPortalLaggards,
  type PortalLaggard,
} from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.7, second card — "Not using the portal".
 *
 * Ranked on login recency COMBINED with submission/attempt rate, so a pupil who
 * is quiet on both fronts outranks one who simply logs in rarely but hands
 * everything in. Same row pattern as spec 2.6: severity badge, reason chips,
 * filter row narrowing the same list.
 */
export function TeacherPortalLaggards() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useTeacherPortalLaggards();
  const [classId, setClassId] = useState<string | null>(null);

  const students = useMemo(() => data?.students ?? [], [data]);

  const classes = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of students) m.set(s.class_id, formatClassName(s.class_name, s.section));
    return Array.from(m, ([id, label]) => ({ id, label }));
  }, [students]);

  const visible = classId ? students.filter((s) => s.class_id === classId) : students;

  // Show four, then reveal five at a time. The list is worst-first, so the rows
  // that matter are always above the fold; the rest is opt-in rather than a wall.
  const PAGE = 5;
  const INITIAL = 4;
  const [shown, setShown] = useState(INITIAL);
  // Switching the class filter re-collapses: carrying a "load more" position
  // across a different, shorter list would show everything with no button.
  useEffect(() => setShown(INITIAL), [classId]);

  const rows = visible.slice(0, shown);
  const remaining = visible.length - rows.length;

  if (isLoading) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <Skeleton className="h-6 w-48" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink-900">Not using the portal</h3>
        {students.length > 0 && (
          <span className="shrink-0 rounded-full bg-brand-primary/10 px-2.5 py-1 text-[12px] font-semibold text-brand-primary">
            {students.length} flagged
          </span>
        )}
      </div>

      {isError ? (
        <div className="mt-4">
          <EmptyState
            icon={<WifiOff className="h-7 w-7" />}
            title="Couldn't load portal usage"
            description="Something went wrong. Refresh to try again."
            reason="error"
            tone="rose"
          />
        </div>
      ) : students.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<WifiOff className="h-7 w-7" />}
            title="Everyone is using the portal"
            description="No student in your classes has gone quiet on logins and submissions together."
            tone="mint"
            size="sm"
          />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-500">
            Low logins and a low submission rate together. A student quiet on both is the one still
            working on paper.
          </p>

          {classes.length > 1 && (
            <div className="mt-3">
              <FilterRow activeCount={classId ? 1 : 0} onClear={() => setClassId(null)}>
                <FilterChip
                  label={`All (${students.length})`}
                  active={classId === null}
                  onClick={() => setClassId(null)}
                />
                {classes.map((c) => (
                  <FilterChip
                    key={c.id}
                    label={`${c.label} (${students.filter((s) => s.class_id === c.id).length})`}
                    active={classId === c.id}
                    onClick={() => setClassId(c.id)}
                  />
                ))}
              </FilterRow>
            </div>
          )}

          <ul className="mt-4 list-none space-y-2 p-0">
            {rows.map((s) => (
              <LaggardRow key={s.student_id} s={s} onMessage={() => navigate("/school/communication")} />
            ))}
          </ul>

          {(remaining > 0 || shown > INITIAL) && (
            <div className="mt-3 flex gap-2">
              {remaining > 0 && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="flex-1 rounded-xl border border-[hsl(var(--surface-stroke))] py-2 text-[13px] font-semibold text-brand-primary transition-colors hover:bg-[hsl(var(--ink-400)/0.05)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                >
                  Load {Math.min(PAGE, remaining)} more
                  <span className="font-normal text-ink-500"> · {remaining} left</span>
                </button>
              )}
              {/* Only offered once the list has actually been expanded, so it is
                  never a control that does nothing. */}
              {shown > INITIAL && (
                <button
                  type="button"
                  onClick={() => setShown(INITIAL)}
                  className={cn(
                    "rounded-xl border border-[hsl(var(--surface-stroke))] py-2 text-[13px] font-semibold text-ink-600 transition-colors hover:bg-[hsl(var(--ink-400)/0.05)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                    remaining > 0 ? "shrink-0 px-4" : "flex-1",
                  )}
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LaggardRow({ s, onMessage }: { s: PortalLaggard; onMessage: () => void }) {
  const sev = SEVERITY_META[s.severity];
  const seen = s.never_seen
    ? "Never opened the portal"
    : `Last seen ${s.days_since} day${s.days_since === 1 ? "" : "s"} ago`;

  return (
    <li className="rounded-2xl border border-[hsl(var(--surface-stroke))] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink-900">
            {s.student_name ?? "Unnamed student"}
          </p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-ink-500">
            {formatClassName(s.class_name, s.section)} · <span className="font-medium">{seen}</span>
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em]",
            sev.tone,
          )}
        >
          {sev.label}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {s.note ? (
          <Chip text={s.note} tone="neutral" />
        ) : (
          <>
            {s.hw_expected > 0 && (
              <Chip
                text={`Homework ${s.hw_submitted} of ${s.hw_expected} submitted`}
                tone={s.hw_submitted * 2 <= s.hw_expected ? "bad" : "warn"}
              />
            )}
            {s.ex_expected > 0 && (
              <Chip
                text={`Tests ${s.ex_attempted} of ${s.ex_expected} attempted`}
                tone={s.ex_attempted * 2 <= s.ex_expected ? "bad" : "warn"}
              />
            )}
          </>
        )}
      </div>

      {/* The mockup's action reads "Nudge · Message parent". There is no parent
          role in production and no parent-messaging entry point, so offering it
          would be a dead link. This sends a message to the STUDENT via the
          Communication hub, which does exist. */}
      <button
        type="button"
        onClick={onMessage}
        className="mt-2 text-[13px] font-semibold text-brand-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
      >
        Message student →
      </button>
    </li>
  );
}

function Chip({ text, tone }: { text: string; tone: "bad" | "warn" | "neutral" }) {
  const cls =
    tone === "bad"
      ? "bg-rose-500/10 text-rose-600"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-600"
        : "bg-[hsl(var(--ink-400)/0.1)] text-ink-600";
  return <span className={cn("rounded-full px-2 py-0.5 text-[12px]", cls)}>{text}</span>;
}
