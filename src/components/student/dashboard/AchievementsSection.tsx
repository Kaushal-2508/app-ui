import { useNavigate } from "react-router-dom";
import { Trophy, ChevronDown, Medal, ArrowRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BadgeShowcase } from "@/components/badges";
import { useTopBadgeEarners } from "@/hooks/useBadgeLeaderboard";
import { useStudentPassport, getPassportLevelConfig, type PassportLevel } from "@/hooks/useStudentPassport";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const RANK_TINT = [
  "bg-amber-400/20 text-amber-600 dark:text-amber-400",
  "bg-slate-400/20 text-slate-600 dark:text-slate-300",
  "bg-orange-400/20 text-orange-600 dark:text-orange-400",
];

/** Section 7 — collapsed-by-default achievements. Deliberately quiet so it never
 *  competes with the academic data above. */
export function AchievementsSection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: leaders, isLoading: leadersLoading } = useTopBadgeEarners();
  const { data: passport, isLoading: passportLoading } = useStudentPassport(user?.id);

  const level = (passport?.passport?.passport_level ?? "beginner") as PassportLevel;
  const levelConfig = getPassportLevelConfig(level);
  const points = passport?.passport?.total_points ?? 0;

  return (
    <Collapsible>
      <Card className="surface-card frosted-shadow rounded-card">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 p-4 text-left">
          <span className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-secondary/10 text-brand-secondary">
              <Trophy className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink-900">Achievements</span>
              <span className="block text-[12px] text-ink-500">
                Badges, leaderboard &amp; passport level
              </span>
            </span>
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 text-ink-400 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-5 border-t pt-4">
            {/* Badges (compact) */}
            <div>
              <p className="eyebrow mb-2">Your badges</p>
              <BadgeShowcase userId={user?.id} compact />
            </div>

            {/* Top-3 class leaderboard */}
            <div>
              <p className="eyebrow mb-2">Class leaderboard</p>
              {leadersLoading || passportLoading ? (
                <div className="grid gap-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-2xl" />
                  ))}
                </div>
              ) : (leaders ?? []).length > 0 ? (
                <ul className="grid gap-2">
                  {(leaders ?? []).map((entry, idx) => (
                    <li
                      key={entry.userId}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl p-2.5",
                        entry.userId === user?.id ? "bg-brand-primary/5" : "bg-muted/30",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                          RANK_TINT[idx] ?? "bg-muted text-ink-600",
                        )}
                      >
                        {idx === 0 ? <Medal className="h-4 w-4" /> : idx + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
                        {entry.fullName}
                        {entry.userId === user?.id && (
                          <span className="ml-1 text-[11px] font-normal text-ink-500">(you)</span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-700">
                        {entry.totalPoints} pts
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-500">
                  No badges earned in your class yet.
                </p>
              )}
            </div>

            {/* Passport level row — sits last, closing the section with the
                single way through to the passport. It carries its own "View
                passport" affordance, so a separate Open button underneath was
                a second control to the same destination. */}
            <button
              type="button"
              onClick={() => navigate("/student/passport")}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-muted/40 p-3 text-left transition-colors hover:bg-muted/60"
            >
              <span className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>{levelConfig.icon}</span>
                <span>
                  <span className="block text-sm font-semibold text-ink-900">
                    {levelConfig.label}
                  </span>
                  <span className="block text-[12px] text-ink-500 tabular-nums">
                    {points} points
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-1 text-[13px] font-medium text-brand-primary">
                View passport
                <ArrowRight className="h-4 w-4" />
              </span>
            </button>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
