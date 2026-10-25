import { ChevronRight, Lock, Star } from "lucide-react";

import { cn } from "@/lib/utils";

import { BadgeShield } from "../BadgeShield";
import { toBadgeDisplay, unitsFor } from "../toBadgeDisplay";
import {
  cumulativePercent,
  displayGapLabel,
  displayRemaining,
  isCumulativeMetric,
  plural,
} from "../types";
import {
  openRequirements,
  type BadgeRequirement,
  type MedalLadder,
  type PointsRequirement,
} from "./medals";
import type { TeacherAchievementCategory } from "./teacherCategories";

const fmt = (n: number) => n.toLocaleString("en-IN");

export interface NextMedalTodoListProps {
  ladder: MedalLadder;
  /** A badge row opens its category below, the way the hero's "View badge" does. */
  onOpenCategory: (category: TeacherAchievementCategory) => void;
  className?: string;
}

/**
 * ONLY what is left to reach the next medal, as to-dos ("4 more lessons
 * planned ahead to go"). Met requirements, blurbs and the medals beyond the
 * next one are not rendered; the engine still computes the whole ladder.
 *
 * History, all 2026-10-12: a four-medal ladder with a full panel, then a
 * separate card below the hero ("no need to show all the data, just which
 * stage and what to do"), now the list inside the hero's medal card behind a
 * dropdown ("instead of this bottom column add a dropdown in above column").
 * Renders nothing once Diamond is held: there is nothing left to do.
 */
export function NextMedalTodoList({ ladder, onOpenCategory, className }: NextMedalTodoListProps) {
  const open = openRequirements(ladder);
  if (open.length === 0) return null;

  return (
    <ul className={cn("divide-y divide-[hsl(var(--surface-stroke))]", className)}>
      {open.map((r, i) =>
        r.kind === "points" ? (
          <PointsRow key="points" req={r} />
        ) : (
          <BadgeRow
            key={r.badge?.id ?? `${r.rule.metric}-${r.rule.min}-${i}`}
            req={r}
            onOpen={onOpenCategory}
          />
        ),
      )}
    </ul>
  );
}

function RowBody({
  leading,
  title,
  subtitle,
  trailing,
}: {
  leading: React.ReactNode;
  title: string;
  subtitle: string;
  trailing: React.ReactNode;
}) {
  return (
    <>
      <div className="shrink-0">{leading}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium leading-5 text-ink-900">{title}</p>
        <p className="text-[12px] leading-4 text-ink-500">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">{trailing}</div>
    </>
  );
}

function Percent({ value }: { value: number }) {
  return <span className="text-[12px] font-semibold tabular-nums text-ink-500">{value}%</span>;
}

function PointsRow({ req }: { req: PointsRequirement }) {
  const pct = req.need > 0 ? Math.min(100, Math.floor((req.have / req.need) * 100)) : 100;
  const gap = Math.max(0, req.need - req.have);
  return (
    <li className="flex items-center gap-3 py-3">
      <RowBody
        leading={
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-primary/10 text-brand-primary">
            <Star className="h-5 w-5" aria-hidden="true" />
          </span>
        }
        title={`Earn ${fmt(gap)} more ${plural(gap, "point", "points")}`}
        subtitle={`${fmt(req.have)} of ${fmt(req.need)} points`}
        trailing={<Percent value={pct} />}
      />
    </li>
  );
}

function BadgeRow({
  req,
  onOpen,
}: {
  req: BadgeRequirement;
  onOpen: (category: TeacherAchievementCategory) => void;
}) {
  const { badge, rule } = req;

  // The catalog has no row for this keystone. Say so rather than inventing a
  // badge; the medal stays out of reach until the set carries one.
  if (!badge) {
    const units = isCumulativeMetric(rule.metric) ? unitsFor(rule.metric) : null;
    const noun = units ? plural(rule.min, units.one, units.many) : "";
    return (
      <li className="flex items-center gap-3 py-3">
        <RowBody
          leading={
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink-400/10 text-ink-400">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </span>
          }
          title="Badge not available yet"
          subtitle={
            noun
              ? `Needs ${fmt(rule.min)} ${noun}. Not in your school's badge set yet.`
              : "Not in your school's badge set yet."
          }
          trailing={<Lock className="h-4 w-4 text-ink-400" aria-label="Unavailable" role="img" />}
        />
      </li>
    );
  }

  const display = toBadgeDisplay(badge, req.progress);
  const remaining = displayRemaining(display);
  // Progress at the target with no award yet: the evaluator runs on the next
  // qualifying event, so "0 more to go" would read as a bug.
  const subtitle =
    remaining !== null && remaining <= 0
      ? "Complete. The badge is on its way."
      : (displayGapLabel(display) ?? badge.description ?? "");
  const pct = display.kind === "cumulative" ? cumulativePercent(display) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(badge.category)}
        className="flex w-full items-center gap-3 rounded-md py-3 text-left transition-colors duration-200 hover:bg-brand-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
      >
        <RowBody
          leading={<BadgeShield tier={badge.tier} iconName={badge.icon_name} earned={false} size="sm" />}
          title={badge.name}
          subtitle={subtitle}
          trailing={
            <>
              {pct !== null && <Percent value={pct} />}
              <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden="true" />
            </>
          }
        />
      </button>
    </li>
  );
}
