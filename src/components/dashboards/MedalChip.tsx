import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { MedalDisc } from "@/components/achievements/MedalDisc";
import { MEDAL_SHORT_LABEL } from "@/components/achievements/medalStyles";
import {
  MEDAL_LABEL,
  buildMedalLadder,
  medalProgressRatio,
} from "@/components/achievements/teacher/medals";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeacherAchievements } from "@/hooks/useTeacherAchievements";
import { cn } from "@/lib/utils";

const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] py-1 pl-1.5 pr-2.5 text-[13px] font-medium leading-5 text-ink-700 shadow-card transition-colors duration-200 hover:bg-brand-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40";

export interface MedalChipProps {
  className?: string;
}

/**
 * The medal, small, beside the name on Home: a tiny disc, "Bronze · 63% to
 * Silver", a chevron. Opens /achievements, where the full card and the to-do
 * list live.
 *
 * Naman asked for the card on Home (2026-10-12, "it must be seen in home
 * page") and then, seeing it, for this instead ("dont make it this big, just a
 * small near name"). So: no card, no bar, one line that fits under the
 * greeting on a phone.
 *
 * Data: `useTeacherAchievements()`, the one request /achievements already
 * makes (server-aggregated, 60s staleTime, shared query key), so Home and
 * Achievements share a cache entry; no second RPC.
 *
 * States, in this order (§6): error (a muted chip that retries on tap, never
 * a silent disappearance), loading (a chip-sized skeleton so the line does
 * not jump), empty (the school's badge set is off: nothing, Home is not the
 * place to explain a switched-off feature).
 */
export function MedalChip({ className }: MedalChipProps) {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useTeacherAchievements();
  const ladder = useMemo(() => buildMedalLadder(data), [data]);

  if (isError) {
    return (
      <button
        type="button"
        onClick={() => refetch()}
        className={cn(CHIP, "text-ink-500", className)}
      >
        Medal unavailable, tap to retry
      </button>
    );
  }

  if (isLoading) {
    return <Skeleton className={cn("h-7 w-44 rounded-full", className)} aria-busy="true" />;
  }

  if ((data?.catalog.length ?? 0) === 0) return null;

  const { current, next } = ladder;
  const step = next ? (ladder.steps.find((s) => s.medal === next) ?? null) : null;
  const pct = step ? Math.floor(medalProgressRatio(step) * 100) : 100;
  const label = current ? MEDAL_SHORT_LABEL[current] : "No medal";
  const detail = next ? `${pct}% to ${MEDAL_SHORT_LABEL[next]}` : "Highest medal";
  const title = current ? MEDAL_LABEL[current] : "No medal yet";

  return (
    <button
      type="button"
      onClick={() => navigate("/achievements")}
      aria-label={`${title}, ${detail}. Open Achievements`}
      className={cn(CHIP, className)}
    >
      <MedalDisc medal={current ?? next ?? "diamond"} earned={current !== null} size="xs" />
      <span className="text-ink-900">{label}</span>
      <span className="text-ink-500">· {detail}</span>
      <ChevronRight className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
    </button>
  );
}
