import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  Star,
  StarHalf,
  TrendingUp,
  Users,
} from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { TONES, type Tone } from "@/components/shared/design-system";
import { MetricInfo } from "./MetricInfo";
import { PTM_METRIC_HELP } from "./metricHelp";
import { cn, formatClassName } from "@/lib/utils";
import type { PTMHat } from "@/lib/ptm";
import { usePTMFeedbackSummary } from "@/hooks/ptm";

interface Props {
  ptmId: string;
  hat: PTMHat;
  slotBookingEnabled: boolean;
}

type StarKey = "1" | "2" | "3" | "4" | "5";

/** A share as a percentage. Below 10% it keeps one decimal, so 1 family of
 *  253 reads "0.4%", not a misleading "0%". */
function share(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const p = (part / whole) * 100;
  return p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

function ratingWord(avg: number): string {
  if (avg >= 4.5) return "Excellent";
  if (avg >= 3.5) return "Very good";
  if (avg >= 2.5) return "Good";
  if (avg >= 1.5) return "Fair";
  return "Poor";
}

function families(n: number): string {
  return `${n} ${n === 1 ? "family" : "families"}`;
}

/** Five stars filled to the average, with a half star for .5 and up. */
function RatingStars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const full = value >= n;
        const half = !full && value >= n - 0.5;
        return (
          <span key={n} className="relative inline-flex h-6 w-6">
            <Star
              className={cn("h-6 w-6", full ? "fill-brand-accent text-brand-accent" : "text-ink-400")}
              aria-hidden="true"
            />
            {half && (
              <StarHalf
                className="absolute inset-0 h-6 w-6 fill-brand-accent text-brand-accent"
                aria-hidden="true"
              />
            )}
          </span>
        );
      })}
    </span>
  );
}

/** A supporting fact: tone disc, eyebrow, one bold line, then detail. The
 *  StatTile look, with room for the sentence that makes the number useful. */
function InfoCard({
  icon,
  tone,
  label,
  info,
  value,
  children,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  /** What the number counts, behind an "i" beside the label. */
  info?: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section className="surface-card frosted-shadow rounded-card flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&_svg]:h-4 [&_svg]:w-4", t.bg, t.fg)}>
          {icon}
        </span>
        <div className="flex min-w-0 items-center gap-1">
          <p className="eyebrow truncate">{label}</p>
          {info && <MetricInfo label={label}>{info}</MetricInfo>}
        </div>
      </div>
      <div className="text-xl font-semibold tabular-nums text-ink-900">{value}</div>
      {children && <div className="space-y-2 text-sm text-ink-600">{children}</div>}
    </section>
  );
}

/**
 * Headline feedback for one PTM, scoped to the hat: a teacher sees their own
 * class, a coordinator their wing, an admin everything. The rating leads,
 * with the star breakdown inside it and who responded beside it; underneath,
 * how the classes compare and how the slots went. The wing, class and family
 * breakdown lives in PTMFeedbackTree. All counting happens on the server;
 * this only draws numbers.
 */
export function FeedbackDashboard({ ptmId, hat, slotBookingEnabled }: Props) {
  const summary = usePTMFeedbackSummary(ptmId, hat);

  if (summary.isLoading) {
    return (
      // The loaded layout's shape: rating and responses, then two cards.
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-48 rounded-card lg:col-span-2" />
          <Skeleton className="h-48 rounded-card" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        tone="rose"
        reason="error"
        title="Couldn't load the feedback summary"
        description="Check your connection and try again."
        action={{ label: "Retry", onClick: () => summary.refetch() }}
      />
    );
  }

  const s = summary.data;

  // The RPC scopes to the hat; no classes back means none of the PTM's
  // classes are this reader's, which is not the same as "no feedback".
  if (s.per_class.length === 0 && s.students_in_scope === 0) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        reason="noData"
        title="None of your classes are in this PTM"
        description="Feedback shows for the classes you are responsible for."
      />
    );
  }

  const d = s.distribution;
  const count = (k: StarKey) => d[k] ?? 0;
  const positive = count("4") + count("5");
  const neutral = count("3");
  const negative = count("1") + count("2");
  const distributionMax = Math.max(1, ...([1, 2, 3, 4, 5] as const).map((n) => count(String(n) as StarKey)));
  const yetToRespond = Math.max(0, s.students_in_scope - s.responses);

  // Highest and lowest rated class, among classes someone actually rated.
  const rated = s.per_class
    .filter((c) => c.responses > 0 && c.avg_rating !== null)
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || b.responses - a.responses);
  const best = rated.length >= 2 ? rated[0] : null;
  const worst = rated.length >= 2 ? rated[rated.length - 1] : null;

  const hasSupport = !!(best && worst) || slotBookingEnabled;

  return (
    <div className="space-y-4">
      {/* Top row: how families rated the meeting, and beside it how many
          responded (Naman, 2026-09-29). */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5 lg:col-span-2">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-center">
            <div>
              <div className="flex items-center gap-1">
                <p className="eyebrow">Average rating</p>
                <MetricInfo label="Average rating">{PTM_METRIC_HELP.averageRating}</MetricInfo>
              </div>
              {s.avg_rating === null ? (
                <p className="mt-2 text-sm text-ink-600">
                  No ratings yet. Families can rate the meeting once it starts.
                </p>
              ) : (
                <>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-5xl font-bold leading-none tabular-nums text-ink-900">
                      {s.avg_rating.toFixed(1)}
                    </span>
                    <span className="text-base font-medium text-ink-500">/ 5</span>
                  </div>
                  <div className="mt-3">
                    <RatingStars value={s.avg_rating} />
                  </div>
                  <p className="mt-2 text-sm font-medium text-ink-700">
                    {ratingWord(s.avg_rating)} · from {families(s.responses)}
                  </p>
                </>
              )}
            </div>

            {s.responses > 0 && (
              <ul className="space-y-1.5" aria-label="How families rated">
                {([5, 4, 3, 2, 1] as const).map((n) => {
                  const c = count(String(n) as StarKey);
                  return (
                    <li key={n} className="flex items-center gap-3 text-sm">
                      <span className="flex w-9 shrink-0 items-center gap-1 tabular-nums text-ink-700">
                        {n}
                        <Star className="h-3.5 w-3.5 fill-brand-accent text-brand-accent" aria-hidden="true" />
                      </span>
                      {/* Light track, amber fill: an empty row must read empty. */}
                      <Progress
                        value={(c / distributionMax) * 100}
                        className="h-2 flex-1 bg-muted [&>div]:bg-brand-accent"
                        aria-label={`${c} rated ${n}`}
                      />
                      <span className="w-20 shrink-0 text-right tabular-nums text-ink-600">
                        {c} <span className="text-ink-400">({share(c, s.responses)})</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {s.responses > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3 text-xs font-medium">
              <span className={cn("rounded-full px-2.5 py-1", TONES.mint.bg, TONES.mint.fg)}>
                {share(positive, s.responses)} rated 4 or 5
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 text-ink-600">
                {share(neutral, s.responses)} rated 3
              </span>
              <span className={cn("rounded-full px-2.5 py-1", TONES.rose.bg, TONES.rose.fg)}>
                {share(negative, s.responses)} rated 1 or 2
              </span>
            </div>
          )}
        </section>

        <InfoCard
          icon={<Users />}
          tone="sky"
          label="Responses"
          info={PTM_METRIC_HELP.responses}
          value={
            <span>
              {s.responses}
              <span className="text-base font-normal text-ink-500"> of {families(s.students_in_scope)}</span>
            </span>
          }
        >
          <Progress
            value={s.students_in_scope > 0 ? (s.responses / s.students_in_scope) * 100 : 0}
            className="h-2 bg-muted [&>div]:bg-brand-primary"
            aria-label={`${share(s.responses, s.students_in_scope)} responded`}
          />
          <p>
            {share(s.responses, s.students_in_scope)} responded · {yetToRespond} yet to respond
          </p>
        </InfoCard>
      </div>

      {/* Class comparison and slots, when there is something to show. */}
      {hasSupport && (
        <div className="grid gap-4 sm:grid-cols-2">
          {best && worst && (
            <InfoCard
              icon={<TrendingUp />}
              tone="mint"
              label="Classes compared"
              info={PTM_METRIC_HELP.classesCompared}
              value={
                <span className="flex items-center gap-1.5">
                  {best.avg_rating?.toFixed(1)}
                  <Star className="h-4 w-4 fill-brand-accent text-brand-accent" aria-hidden="true" />
                  <span className="truncate text-base font-normal text-ink-500">
                    {formatClassName(best.class_name, best.class_section)}
                  </span>
                </span>
              }
            >
              <p>
                Highest rated. Lowest:{" "}
                <span className="font-medium text-ink-900">
                  {formatClassName(worst.class_name, worst.class_section)}
                </span>{" "}
                at {worst.avg_rating?.toFixed(1)}, from {rated.length} rated classes.
              </p>
            </InfoCard>
          )}

          {slotBookingEnabled && (
            <InfoCard
              icon={<CalendarCheck />}
              tone="violet"
              label="Slots"
              info={PTM_METRIC_HELP.slots}
              value={
                <span>
                  {s.bookings.booked}
                  <span className="text-base font-normal text-ink-500"> of {s.bookings.total_slots} booked</span>
                </span>
              }
            >
              <Progress
                value={s.bookings.total_slots > 0 ? (s.bookings.booked / s.bookings.total_slots) * 100 : 0}
                className="h-2 bg-muted [&>div]:bg-brand-secondary"
                aria-label={`${share(s.bookings.booked, s.bookings.total_slots)} of slots booked`}
              />
              <p>
                {s.bookings.attended} attended ({share(s.bookings.attended, s.bookings.booked)} of booked)
              </p>
            </InfoCard>
          )}
        </div>
      )}
    </div>
  );
}
