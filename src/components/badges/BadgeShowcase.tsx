import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BadgeCard } from "./BadgeCard";
import { useUserBadges, useBadgeStats } from "@/hooks/useBadges";
import { Award, Sparkles, Trophy, Star } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";

interface BadgeShowcaseProps {
  userId?: string;
  maxDisplay?: number;
  showStats?: boolean;
  compact?: boolean;
}

export function BadgeShowcase({ 
  userId, 
  maxDisplay = 6, 
  showStats = true,
  compact = false 
}: BadgeShowcaseProps) {
  const { data: badges, isLoading: badgesLoading } = useUserBadges(userId);
  const { data: stats, isLoading: statsLoading } = useBadgeStats();

  if (badgesLoading || statsLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="w-16 h-16 rounded-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayBadges = badges?.slice(0, maxDisplay) || [];
  const hasMore = (badges?.length || 0) > maxDisplay;

  if (compact) {
    return (
      <TooltipProvider>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {displayBadges.slice(0, 3).map((userBadge, idx) => (
              <motion.div
                key={userBadge.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <BadgeCard
                  badge={userBadge.badge}
                  earned={true}
                  earnedAt={userBadge.earned_at}
                  size="sm"
                  animate={false}
                />
              </motion.div>
            ))}
          </div>
          {(badges?.length || 0) > 3 && (
            <Badge variant="secondary" className="text-xs">
              +{(badges?.length || 0) - 3} more
            </Badge>
          )}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" />
              <span>Badges & Achievements</span>
            </div>
            {stats && (
              <div className="flex items-center gap-3 text-sm font-normal">
                <div className="flex items-center gap-1">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <span>{stats.totalBadges}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 text-yellow-500" />
                  <span>{stats.totalPoints} pts</span>
                </div>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {displayBadges.length > 0 ? (
            <div className="space-y-4">
              {/* Badge Grid */}
              <div className="flex flex-wrap gap-3">
                {displayBadges.map((userBadge, idx) => (
                  <motion.div
                    key={userBadge.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    <BadgeCard
                      badge={userBadge.badge}
                      earned={true}
                      earnedAt={userBadge.earned_at}
                    />
                  </motion.div>
                ))}
                {hasMore && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="flex items-center justify-center w-16 h-16 rounded-full bg-muted/50 border-2 border-dashed border-muted-foreground/20"
                  >
                    <span className="text-sm font-medium text-muted-foreground">
                      +{(badges?.length || 0) - maxDisplay}
                    </span>
                  </motion.div>
                )}
              </div>

              {/* Stats Row */}
              {showStats && stats && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="grid grid-cols-5 gap-2 pt-3 border-t"
                >
                  {(['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const).map((tier) => (
                    <div 
                      key={tier} 
                      className="text-center"
                    >
                      <p className="text-lg font-bold">{stats.tierCounts[tier]}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{tier}</p>
                    </div>
                  ))}
                </motion.div>
              )}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8"
            >
              <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No badges earned yet</p>
              <p className="text-sm text-muted-foreground/70">
                Complete exams and use the portal to earn badges!
              </p>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
