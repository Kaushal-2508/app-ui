import { CircleSlash, GraduationCap, UserX } from "lucide-react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { cn } from "@/lib/utils";
import { useTeacherAdoption } from "@/hooks/dashboard/useCoordinatorDashboardData";
import type { TeacherAdoptionSignal } from "@/hooks/dashboard/coordinatorTypes";

function SignalTile({ signal }: { signal: TeacherAdoptionSignal }) {
  // An unavailable signal is reported as such. Rendering 0% for a module nobody
  // uses reads as a failure by the teachers rather than a gap in the rollout,
  // and that misattribution is the whole reason this branch exists.
  if (!signal.available) {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--surface-stroke))] bg-[hsl(var(--ink-400)/0.03)] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-500">
          <CircleSlash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {signal.label}
        </p>
        <p className="mt-1.5 text-[12px] font-semibold leading-[16px] text-ink-400">
          Not measurable yet
        </p>
        {signal.unavailable_reason && (
          <p className="mt-1 text-[11px] leading-[15px] text-ink-400">
            {signal.unavailable_reason}
          </p>
        )}
      </div>
    );
  }

  const pct = signal.pct ?? 0;
  return (
    <div className="rounded-xl border border-[hsl(var(--surface-stroke))] bg-[hsl(var(--ink-400)/0.04)] px-3 py-2.5">
      <p className="text-[11.5px] font-medium text-ink-500">{signal.label}</p>
      <p
        className={cn(
          "mt-1 text-[21px] font-bold tabular-nums leading-none",
          pct >= 60 ? "text-ink-900" : pct >= 30 ? "text-amber-600" : "text-rose-600",
        )}
      >
        {pct}%
      </p>
      {signal.value != null && signal.of != null && (
        <p className="mt-1 text-[11px] text-ink-400 tabular-nums">
          {signal.value} of {signal.of}
        </p>
      )}
    </div>
  );
}

/**
 * "Are my teachers using SALCI the way they are supposed to?" — the wing's
 * biggest lever, because a teacher who is not in the system is a teacher whose
 * students almost certainly are not either.
 *
 * Four signals were specified. Two are backed by real data; the other two report
 * why they cannot be measured instead of showing a number that would be wrong.
 * That honesty is itself the finding a coordinator needs to escalate.
 *
 * Laggards are worst-pattern-first: never signed in, then longest inactive.
 */
export function TeacherAdoptionWidget() {
  const { data, isLoading, isError, refetch } = useTeacherAdoption(8);

  const total = data?.total ?? 0;
  const never = data?.never_signed_in ?? 0;
  const active7 = data?.active_7d ?? 0;
  const laggards = data?.laggards ?? [];

  return (
    <WidgetCard
      title="Teacher SALCI adoption"
      caption="A login alone is not adoption, but it is the floor. Teachers below have either never signed in or have been away for over a week."
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!isLoading && !isError && total === 0}
      emptyTitle="No teachers assigned to your classes"
      emptyDescription="Once staff are assigned to the classes in your wing, their platform use appears here."
      className="scroll-mt-24"
    >
      <div id="dash-teacher-adoption">
        {(never > 0 || active7 * 2 < total) && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3.5 py-3">
            <UserX className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold text-amber-700">
                Only {active7} of {total} teachers opened SALCI this week
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[18px] text-ink-600">
                {never > 0
                  ? `${never} of them have never signed in at all.`
                  : "Everyone has signed in at least once, but most have not been back recently."}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {(data?.signals ?? []).map((s) => (
            <SignalTile key={s.key} signal={s} />
          ))}
        </div>

        {laggards.length > 0 && (
          <div className="mt-5 border-t border-[hsl(var(--surface-stroke))] pt-4">
            <p className="mb-3 text-[12.5px] font-semibold text-ink-700">
              Not fully adopted · worst pattern first
            </p>
            <ul className="divide-y divide-[hsl(var(--surface-stroke))]">
              {laggards.map((t) => (
                <li key={t.teacher_id} className="flex items-start gap-3 py-2.5 first:pt-0">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white",
                      t.last_sign_in_at == null ? "bg-rose-500" : "bg-amber-500",
                    )}
                    aria-hidden="true"
                  >
                    {(t.name ?? "")
                      .split(" ")
                      .filter(Boolean)
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-900">
                      {t.name || "Unnamed teacher"}
                    </p>
                    {t.classes && (
                      <p className="truncate text-[11.5px] text-ink-500">{t.classes}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                          t.last_sign_in_at == null
                            ? "bg-rose-500/10 text-rose-600"
                            : "bg-amber-500/10 text-amber-700",
                        )}
                      >
                        {t.last_sign_in_at == null
                          ? "Never signed in"
                          : `Last seen ${t.days_inactive} days ago`}
                      </span>
                      <span className="rounded-full bg-[hsl(var(--ink-400)/0.09)] px-2 py-0.5 text-[10.5px] font-semibold text-ink-600">
                        {t.exams_created} exam{t.exams_created === 1 ? "" : "s"} created this year
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-500">
              <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
              Showing {laggards.length} of {total} teachers in your wing.
            </p>
          </div>
        )}
      </div>
    </WidgetCard>
  );
}
