import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Trophy, 
  Medal, 
  Crown, 
  Sparkles,
  TrendingUp,
  Users,
  GraduationCap,
  Briefcase,
  Info
} from "lucide-react";
import { useState } from "react";
import {
  useBadgeLeaderboard,
  useLeaderboardBadgeBreakdown,
  describeAchievement,
  LeaderboardEntry,
  getLeaderboardTitle,
} from "@/hooks/useBadgeLeaderboard";
import { getTierStyles, BadgeTier } from "@/hooks/useBadges";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
// Imported from the leaf module, not the achievements barrel: that barrel pulls
// BadgeTile and ~14 lucide icons into whatever chunk touches it (§23 bundle).
import { HeroCard } from "@/components/achievements/HeroCard";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const roleLabels: Record<string, string> = {
  student: "Student",
  teacher: "Teacher",
  coordinator: "Coordinator",
  school_admin: "Admin",
  super_admin: "Super Admin",
};

const rankIcons = [
  { icon: Crown, color: "text-yellow-500", bg: "bg-yellow-100 dark:bg-yellow-900/30" },
  { icon: Medal, color: "text-slate-400", bg: "bg-slate-100 dark:bg-slate-800/50" },
  { icon: Medal, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
];

/** Who the viewer can see, mirroring the role rules inside badge_leaderboard(). */
function visibilityNote(role: string | null): string {
  switch (role) {
    case "student":
      return "Students who share at least one class with you.";
    case "teacher":
      return "Teachers at your school.";
    case "coordinator":
      return "Coordinators at your school.";
    case "school_admin":
    case "super_school_admin":
      return "Everyone at your school.";
    case "super_admin":
      return "Everyone, across all schools.";
    default:
      return "People you share a school with.";
  }
}

const TIER_ORDER: BadgeTier[] = ["diamond", "platinum", "gold", "silver", "bronze"];

/**
 * The "how is this worked out" popover, on every person in the list.
 *
 * The wording below states the ORDER BY of badge_leaderboard() exactly:
 *   ORDER BY total_points DESC, total_badges DESC, latest_badge_at DESC
 * If that ordering ever changes, change this text in the same commit. A
 * leaderboard that explains itself incorrectly is worse than one that says
 * nothing, because a student will trust it.
 */
function RankInfoButton({
  entry,
  rank,
  total,
  visibility,
}: {
  entry: LeaderboardEntry;
  rank: number;
  total: number;
  visibility: string;
}) {
  const tiers = TIER_ORDER.filter((t) => entry.tierCounts[t] > 0);
  // Only fetch once the popover is actually opened: 50 rows on screen must not
  // fire 50 breakdown queries on mount (§23).
  const [open, setOpen] = useState(false);
  const { data: breakdown, isLoading, isError } = useLeaderboardBadgeBreakdown(
    entry.userId,
    open,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 shrink-0 rounded-full text-muted-foreground",
            "hover:bg-brand-primary/10 hover:text-brand-primary",
            // Open state reads as pressed, so it is obvious which row the
            // panel belongs to when several are on screen.
            "data-[state=open]:bg-brand-primary/12 data-[state=open]:text-brand-primary",
          )}
          aria-label={`How ${entry.fullName} reached rank ${rank}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      {/* HEIGHT IS THE FIX. Radix only FLIPS a colliding popover, it never
          shrinks it, so a card taller than the space available simply hangs off
          the top of the window - which is what collisionPadding alone could not
          solve. --radix-popover-content-available-height is the room Radix
          actually measured on the chosen side; capping the card to it and
          letting the list absorb the slack means it can never leave the
          viewport, on any screen. Header and footer are shrink-0 so only the
          achievements scroll. */}
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[320px] flex-col overflow-hidden p-0 text-sm"
      >
        <div className="shrink-0 border-b px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-semibold">{entry.fullName}</p>
            <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
              #{rank} of {total}
            </p>
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {entry.totalPoints} points · {entry.totalBadges}{" "}
            {entry.totalBadges === 1 ? "badge" : "badges"}
          </p>
        </div>

        {/* min-h-0 is required: without it a flex child refuses to shrink below
            its content and the overflow never engages. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            How they earned them
          </p>

          {isLoading ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          ) : isError ? (
            /* Error before empty: a failed read must not read as "earned nothing". */
            <p className="mt-2 text-xs text-muted-foreground">
              Couldn&apos;t load this right now.
            </p>
          ) : (breakdown?.length ?? 0) === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No badges yet.</p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {breakdown!.map((row) => {
                const line = describeAchievement(row);
                return (
                  <li key={row.metric} className="flex gap-2.5">
                    <span
                      className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug">{line.title}</span>
                      {/* Explains where several badges came from one line, so
                          "4 badges" beside a single best score reads as an
                          explanation rather than four separate perfect exams. */}
                      <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                        {line.note}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* One compact footer instead of a tier block plus three paragraphs of
            prose. The per-achievement "· 195 pts" already teaches how scoring
            works, so explaining it again in a grey box was pure height. */}
        <div className="shrink-0 space-y-2 border-t bg-muted/40 px-4 py-2.5">
          {tiers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tiers.map((tier) => {
                const styles = getTierStyles(tier);
                return (
                  <Badge
                    key={tier}
                    variant="outline"
                    className={`text-[10px] ${styles.text} ${styles.bg} ${styles.border}`}
                  >
                    {entry.tierCounts[tier]} {tier}
                  </Badge>
                );
              })}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Ranked by points, then badges, then newest badge.{" "}
            {visibility.charAt(0).toLowerCase() + visibility.slice(1)}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function BadgeLeaderboardPage() {
  const { data: roleInfo } = useUserRole();
  const { user } = useAuth();
  const { data: leaderboard, isLoading } = useBadgeLeaderboard(50);

  const { title, subtitle } = getLeaderboardTitle(roleInfo?.primaryRole || null);
  const entries = leaderboard ?? [];

  // Get role-specific icon
  const getRoleIcon = () => {
    switch (roleInfo?.primaryRole) {
      case "student":
        return <GraduationCap className="h-10 w-10" />;
      case "teacher":
      case "coordinator":
        return <Briefcase className="h-10 w-10" />;
      default:
        return <Trophy className="h-10 w-10" />;
    }
  };

  const classBadges = entries.reduce((sum, e) => sum + e.totalBadges, 0);
  const classPoints = entries.reduce((sum, e) => sum + e.totalPoints, 0);
  const visibility = visibilityNote(roleInfo?.primaryRole ?? null);

  return (
    <div className="space-y-5">
      {/* Header — the shared hero treatment, teal. The old header rendered 20
          sparkles positioned with Math.random() INSIDE render, so every one of
          them jumped to a new spot on every re-render. The dot field on
          .hero-card is static and comes from the same token set as the rest of
          the student surfaces. */}
      <HeroCard tone="teal" eyebrow={subtitle}>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15">
            {getRoleIcon()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold leading-tight sm:text-[30px]">{title}</h1>
            <p className="mt-1 text-sm text-white/80 tabular-nums">
              {entries.length} {entries.length === 1 ? "member" : "members"} · {classBadges} badges
              earned between them · {classPoints} points
            </p>
          </div>
        </div>
      </HeroCard>

      {/* Deliberately NO "your position" / "next to catch" cards here. Two more
          gradient cards made this page read as a copy of the Achievements hero
          row, and at rank 1 both stated the same sentence twice. The viewer is
          marked in place instead: a "You" chip on their podium card or a tinted
          row in the rankings, which answers "where am I" without new chrome. */}

      {/* Top 3 Podium */}
      {!isLoading && leaderboard && leaderboard.length >= 3 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-3 gap-4"
        >
          {/* 2nd Place */}
          <PodiumCard entry={entries[1]} rank={2} total={entries.length} visibility={visibility} isMe={entries[1].userId === user?.id} />
          {/* 1st Place */}
          <PodiumCard entry={entries[0]} rank={1} featured total={entries.length} visibility={visibility} isMe={entries[0].userId === user?.id} />
          {/* 3rd Place */}
          <PodiumCard entry={entries[2]} rank={3} total={entries.length} visibility={visibility} isMe={entries[2].userId === user?.id} />
        </motion.div>
      )}

      {/* Single leaderboard - no tabs since data is already role-filtered */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Rankings
            <Badge variant="outline" className="ml-2">
              <Users className="h-3 w-3 mr-1" />
              {leaderboard?.length || 0} members
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LeaderboardList
            entries={entries}
            isLoading={isLoading}
            currentUserId={user?.id ?? null}
            visibility={visibility}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PodiumCard({ entry, rank, featured, total, visibility, isMe }: {
  entry: LeaderboardEntry;
  rank: number;
  featured?: boolean;
  total: number;
  visibility: string;
  isMe?: boolean;
}) {
  const rankConfig = rankIcons[rank - 1];
  const Icon = rankConfig?.icon || Medal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank === 1 ? 0.1 : rank === 2 ? 0.2 : 0.3 }}
    >
      <Card className={`relative overflow-hidden ${featured ? "border-yellow-400 border-2 shadow-lg shadow-yellow-100 dark:shadow-yellow-900/20" : ""}`}>
        {/* Rank badge */}
        <motion.div
          className={`absolute -top-1 -right-1 p-2 rounded-bl-xl ${rankConfig?.bg}`}
          animate={featured ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <Icon className={`h-5 w-5 ${rankConfig?.color}`} />
        </motion.div>

        <CardContent className={`pt-6 text-center ${featured ? "pb-8" : "pb-6"}`}>
          <motion.div
            className="relative mx-auto mb-3"
            whileHover={{ scale: 1.05 }}
          >
            <Avatar className={`mx-auto ${featured ? "h-20 w-20" : "h-16 w-16"} border-4 ${
              rank === 1 ? "border-yellow-400" : rank === 2 ? "border-slate-300" : "border-amber-400"
            }`}>
              <AvatarImage src={entry.avatarUrl || undefined} />
              <AvatarFallback className="text-xl font-bold">
                {entry.fullName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {featured && (
              <motion.div
                className="absolute -bottom-2 left-1/2 -translate-x-1/2"
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <Crown className="h-6 w-6 text-yellow-500 fill-yellow-500" />
              </motion.div>
            )}
          </motion.div>

          <p className={`font-semibold truncate ${featured ? "text-lg" : ""}`}>
            {entry.fullName}
          </p>
          <div className="mt-1 flex items-center justify-center gap-1.5">
            <Badge variant="outline" className="text-xs capitalize">
              {roleLabels[entry.role] || entry.role}
            </Badge>
            {/* The rankings list below starts at rank 4, so without this a
                student on the podium had no marker for themselves anywhere. */}
            {isMe && (
              <Badge className="border-transparent bg-brand-primary text-[10px] text-white hover:bg-brand-primary">
                You
              </Badge>
            )}
            <RankInfoButton entry={entry} rank={rank} total={total} visibility={visibility} />
          </div>

          <div className="mt-4 flex justify-center gap-4">
            <div className="text-center">
              <p className={`font-bold ${featured ? "text-2xl" : "text-xl"}`}>
                {entry.totalPoints}
              </p>
              <p className="text-xs text-muted-foreground">Points</p>
            </div>
            <div className="text-center">
              <p className={`font-bold ${featured ? "text-2xl" : "text-xl"}`}>
                {entry.totalBadges}
              </p>
              <p className="text-xs text-muted-foreground">Badges</p>
            </div>
          </div>

          {/* Tier badges */}
          <div className="mt-3 flex justify-center gap-1 flex-wrap">
            {(["diamond", "platinum", "gold", "silver", "bronze"] as BadgeTier[]).map(tier => {
              const count = entry.tierCounts[tier];
              if (count === 0) return null;
              const styles = getTierStyles(tier);
              return (
                <Badge 
                  key={tier} 
                  variant="outline" 
                  className={`text-[10px] ${styles.text} ${styles.bg} ${styles.border}`}
                >
                  {count} {tier}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function LeaderboardList({ entries, isLoading, currentUserId, visibility }: {
  entries: LeaderboardEntry[];
  isLoading: boolean;
  currentUserId: string | null;
  visibility: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-12 text-center">
        <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground">No badge earners yet</p>
        <p className="text-sm text-muted-foreground/70">
          Complete activities to earn badges and appear on the leaderboard!
        </p>
      </div>
    );
  }

  // Show entries starting from rank 4 (top 3 are in podium)
  const remainingEntries = entries.slice(3);

  if (remainingEntries.length === 0 && entries.length <= 3) {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground">
          All members are shown in the podium above!
        </p>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <div className="space-y-2">
        {remainingEntries.map((entry, index) => (
          <LeaderboardRow
            key={entry.userId}
            entry={entry}
            rank={index + 4}
            isMe={!!currentUserId && entry.userId === currentUserId}
            total={entries.length}
            visibility={visibility}
          />
        ))}
      </div>
    </AnimatePresence>
  );
}

function LeaderboardRow({ entry, rank, isMe, total, visibility }: {
  entry: LeaderboardEntry;
  rank: number;
  isMe?: boolean;
  total: number;
  visibility: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: (rank - 4) * 0.05 }}
      className={cn(
        "flex items-center gap-4 p-3 rounded-lg border transition-colors",
        isMe
          ? "border-brand-primary/50 bg-brand-primary/[0.07]"
          : "hover:bg-muted/50",
      )}
    >
      {/* Rank */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center font-bold",
          isMe ? "bg-brand-primary text-white" : "bg-muted text-muted-foreground",
        )}
      >
        {rank}
      </div>

      {/* Avatar & Name */}
      <Avatar className="h-10 w-10">
        <AvatarImage src={entry.avatarUrl || undefined} />
        <AvatarFallback>
          {entry.fullName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">
          {entry.fullName}
          {isMe && (
            <span className="ml-2 rounded-full bg-brand-primary/15 px-2 py-0.5 text-[10px] font-semibold text-brand-primary">
              You
            </span>
          )}
        </p>
        <Badge variant="secondary" className="text-[10px] capitalize">
          {roleLabels[entry.role] || entry.role}
        </Badge>
      </div>

      {/* Tier counts */}
      <div className="hidden md:flex gap-1">
        {(["diamond", "platinum", "gold", "silver", "bronze"] as BadgeTier[]).map(tier => {
          const count = entry.tierCounts[tier];
          if (count === 0) return null;
          const styles = getTierStyles(tier);
          return (
            <motion.div
              key={tier}
              whileHover={{ scale: 1.1 }}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${styles.bg} ${styles.text}`}
            >
              {count}
            </motion.div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="text-right">
        <p className="font-bold text-lg tabular-nums">{entry.totalPoints}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {entry.totalBadges} {entry.totalBadges === 1 ? "badge" : "badges"}
        </p>
      </div>

      <RankInfoButton entry={entry} rank={rank} total={total} visibility={visibility} />
    </motion.div>
  );
}
