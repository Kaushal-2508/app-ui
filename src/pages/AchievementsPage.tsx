import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BadgeCard } from "@/components/badges/BadgeCard";
import { BadgeIcon } from "@/components/badges/BadgeIcon";
import { StudentAchievementsView } from "@/components/achievements/StudentAchievementsView";
import { TeacherAchievementsView } from "@/components/achievements/teacher/TeacherAchievementsView";
import { useStudentAchievements } from "@/hooks/useStudentAchievements";
import { useTeacherAchievements } from "@/hooks/useTeacherAchievements";
import {
  useBadgeDefinitions, 
  useUserBadges, 
  useBadgeProgress, 
  useBadgeStats,
  getTierStyles,
  BadgeTier
} from "@/hooks/useBadges";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useMyOnboardingProgress } from "@/hooks/useOnboardingJourney";
import { OnboardingJourneyPanel } from "@/components/achievements/OnboardingJourneyPanel";
import { 
  Award, 
  Trophy, 
  Star, 
  Sparkles, 
  Crown, 
  Zap,
  Target,
  TrendingUp,
  Medal,
  Gift,
  Flame,
  GraduationCap,
  BookOpen,
  Users,
  CheckCircle2,
  Lock
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

// Animated confetti particles
function Confetti() {
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#A855F7', '#3B82F6', '#10B981'];
  
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-3 h-3 rounded-full"
          style={{
            background: colors[i % colors.length],
            left: `${Math.random() * 100}%`,
            top: -20,
          }}
          animate={{
            y: ['0vh', '100vh'],
            x: [0, Math.random() * 100 - 50],
            rotate: [0, 360 * (Math.random() > 0.5 ? 1 : -1)],
            opacity: [1, 0],
          }}
          transition={{
            duration: 3 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 5,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
}

// Animated background gradient
function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-blue-500/10 blur-3xl"
        animate={{
          x: [0, 100, 0],
          y: [0, 50, 0],
          scale: [1, 1.2, 1],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full bg-gradient-to-r from-blue-500/10 via-green-500/10 to-yellow-500/10 blur-3xl"
        animate={{
          x: [0, -100, 0],
          y: [0, -50, 0],
          scale: [1.2, 1, 1.2],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// Hero stats card with animation.
//
// `streak` comes from the server-side student_streak() walk. Pass null for any
// role that has no streak (teachers, coordinators) and the tile is omitted
// rather than rendering a meaningless zero. This value used to be the literal
// number 7, hardcoded, so every student on the platform was shown the same fake
// week-long streak.
function HeroStats({
  stats,
  isLoading,
  streak,
}: {
  // Shape of useBadgeStats()'s payload, narrowed inline rather than `any` (§5a).
  stats: {
    totalBadges: number;
    totalPoints: number;
    tierCounts: Record<string, number>;
  } | null | undefined;
  isLoading: boolean;
  streak?: number | null;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }

  // Explicit type: the streak tile is pushed conditionally below, and without
  // this the array's inferred shape omits `suffix` and the push stops compiling.
  const statItems: Array<{
    label: string;
    value: number;
    icon: LucideIcon;
    color: string;
    bgColor: string;
    suffix?: string;
  }> = [
    {
      label: 'Total Badges',
      value: stats?.totalBadges || 0, 
      icon: Trophy, 
      color: 'from-amber-400 to-orange-500',
      bgColor: 'bg-amber-500/10'
    },
    { 
      label: 'Total Points', 
      value: stats?.totalPoints || 0, 
      icon: Star, 
      color: 'from-yellow-400 to-amber-500',
      bgColor: 'bg-yellow-500/10'
    },
    { 
      label: 'Diamond Badges', 
      value: stats?.tierCounts?.diamond || 0, 
      icon: Crown, 
      color: 'from-purple-400 to-pink-500',
      bgColor: 'bg-purple-500/10'
    },
  ];

  // Real streak or no tile. A streak of 0 is still a true fact worth showing a
  // student ("start one today"); null means the concept does not apply to this
  // role at all.
  if (streak !== null && streak !== undefined) {
    statItems.push({
      label: 'Current Streak',
      value: streak,
      icon: Flame,
      color: 'from-red-400 to-orange-500',
      bgColor: 'bg-red-500/10',
      suffix: streak === 1 ? ' day' : ' days',
    });
  }

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 md:grid-cols-4 gap-4"
    >
      {statItems.map((item, idx) => (
        <motion.div
          key={item.label}
          variants={itemVariants}
          whileHover={{ scale: 1.015, y: -2 }}
          className="relative group"
        >
          <Card className={cn(
            "relative border-0 shadow-md overflow-hidden transition-all duration-200",
            item.bgColor,
            "hover:shadow-lg"
          )}>
            {/* Subtle hover glow */}
            <motion.div 
              className={cn(
                "pointer-events-none absolute inset-3 rounded-xl opacity-0 group-hover:opacity-10 transition-opacity duration-200 blur-md",
                `bg-gradient-to-r ${item.color}`
              )}
              animate={{ scale: [1, 1.02, 1] }}
              transition={{ duration: 2.4, repeat: Infinity }}
            />
            
            <CardContent className="p-6 relative">
              <div className="flex items-center justify-between mb-3">
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center",
                  `bg-gradient-to-r ${item.color}`
                )}>
                  <item.icon className="h-6 w-6 text-white" />
                </div>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.3 + idx * 0.1, type: 'spring' }}
                >
                  <Sparkles className="h-5 w-5 text-yellow-500 opacity-70" />
                </motion.div>
              </div>
              <motion.p 
                className="text-3xl font-bold"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 + idx * 0.1 }}
              >
                {item.value}{item.suffix}
              </motion.p>
              <p className="text-sm text-muted-foreground mt-1">{item.label}</p>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}

// Tier progress visualization
function TierProgress({ stats }: { stats: { totalPoints: number } | null | undefined }) {
  const tiers: { name: BadgeTier; icon: LucideIcon; threshold: number }[] = [
    { name: 'bronze', icon: Medal, threshold: 0 },
    { name: 'silver', icon: Medal, threshold: 100 },
    { name: 'gold', icon: Trophy, threshold: 300 },
    { name: 'platinum', icon: Crown, threshold: 600 },
    { name: 'diamond', icon: Crown, threshold: 1000 },
  ];

  const totalPoints = stats?.totalPoints || 0;
  const currentTierIndex = tiers.findIndex((t, i) => 
    totalPoints >= t.threshold && (i === tiers.length - 1 || totalPoints < tiers[i + 1].threshold)
  );
  const nextTier = tiers[currentTierIndex + 1];
  const progressToNext = nextTier 
    ? ((totalPoints - tiers[currentTierIndex].threshold) / (nextTier.threshold - tiers[currentTierIndex].threshold)) * 100
    : 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
    >
      <Card className="border-0 shadow-lg bg-gradient-to-br from-slate-900 to-slate-800 text-white overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-white">
            <TrendingUp className="h-5 w-5 text-green-400" />
            Level Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current level display */}
          <div className="flex items-center gap-4">
            <motion.div
              className={cn(
                "w-20 h-20 rounded-2xl flex items-center justify-center",
                `bg-gradient-to-r ${getTierStyles(tiers[currentTierIndex]?.name || 'bronze').gradient}`
              )}
              animate={{ 
                boxShadow: ['0 0 20px rgba(255,215,0,0.3)', '0 0 40px rgba(255,215,0,0.6)', '0 0 20px rgba(255,215,0,0.3)']
              }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Crown className="h-10 w-10 text-white" />
            </motion.div>
            <div>
              <p className="text-2xl font-bold capitalize">{tiers[currentTierIndex]?.name || 'Bronze'} Rank</p>
              <p className="text-slate-400">
                {totalPoints} / {nextTier?.threshold || totalPoints} points
              </p>
            </div>
          </div>

          {/* Progress bar */}
          {nextTier && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Progress to {nextTier.name}</span>
                <span className="text-green-400">{Math.round(progressToNext)}%</span>
              </div>
              <div className="relative h-4 bg-slate-700 rounded-full overflow-hidden">
                <motion.div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    `bg-gradient-to-r ${getTierStyles(nextTier.name).gradient}`
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${progressToNext}%` }}
                  transition={{ duration: 1, delay: 0.5 }}
                />
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {nextTier.threshold - totalPoints} more points to unlock {nextTier.name}
              </p>
            </div>
          )}

          {/* Tier indicators */}
          <div className="flex justify-between">
            {tiers.map((tier, idx) => {
              const isUnlocked = totalPoints >= tier.threshold;
              const isCurrent = idx === currentTierIndex;
              const tierStyle = getTierStyles(tier.name);
              
              return (
                <motion.div
                  key={tier.name}
                  className="flex flex-col items-center gap-1"
                  whileHover={{ scale: 1.1 }}
                >
                  <motion.div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all",
                      isUnlocked 
                        ? `bg-gradient-to-r ${tierStyle.gradient} border-transparent shadow-lg`
                        : "bg-slate-700 border-slate-600 opacity-50"
                    )}
                    animate={isCurrent ? { 
                      boxShadow: ['0 0 10px rgba(255,215,0,0.3)', '0 0 20px rgba(255,215,0,0.6)', '0 0 10px rgba(255,215,0,0.3)']
                    } : {}}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    {isUnlocked ? (
                      <CheckCircle2 className="h-5 w-5 text-white" />
                    ) : (
                      <Lock className="h-4 w-4 text-slate-400" />
                    )}
                  </motion.div>
                  <span className={cn(
                    "text-[10px] capitalize",
                    isUnlocked ? "text-white" : "text-slate-500"
                  )}>
                    {tier.name}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Badge criteria card
function BadgeCriteriaCard({ badge, isEarned, progress }: {
  // The fields this card actually reads, narrowed inline rather than `any` (§5a).
  badge: {
    id: string;
    name: string;
    description: string | null;
    icon_name: string;
    tier: string;
    points: number;
    criteria_type: string;
    criteria_value: number;
    criteria_metric: string;
  };
  isEarned: boolean;
  progress?: number;
}) {
  const tierStyle = getTierStyles(badge.tier as BadgeTier);
  
  const criteriaDescriptions: Record<string, string> = {
    'exam_count': 'Complete exams',
    'high_score': 'Score above threshold',
    'perfect_score': 'Get perfect scores',
    'login_streak': 'Login days in a row',
    'portal_usage': 'Days active on portal',
    'task_count': 'Complete assigned tasks',
    'exam_created': 'Create exams',
    'student_improvement': 'Students improved under guidance',
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -3 }}
      className="group"
    >
      <Card className={cn(
        "border-2 transition-all duration-300 overflow-hidden h-full",
        isEarned 
          ? `${tierStyle.border} ${tierStyle.bg} shadow-lg` 
          : "border-dashed border-muted hover:border-muted-foreground/30"
      )}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className={cn(
              "w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all",
              isEarned 
                ? `bg-gradient-to-r ${tierStyle.gradient} shadow-lg` 
                : "bg-muted"
            )}>
              <BadgeIcon 
                iconName={badge.icon_name} 
                size={28}
                className={isEarned ? "text-white" : "text-muted-foreground"}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold truncate">{badge.name}</h4>
                {isEarned && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500 }}
                  >
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  </motion.div>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {badge.description}
              </p>
            </div>
          </div>
          
          {/* Criteria */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {criteriaDescriptions[badge.criteria_metric] || badge.criteria_metric}: {badge.criteria_value}
            </span>
            <Badge 
              variant="outline" 
              className={cn("capitalize", tierStyle.text)}
            >
              {badge.tier}
            </Badge>
          </div>
          
          {/* Progress bar for non-earned badges */}
          {!isEarned && progress !== undefined && (
            <div className="space-y-1">
              <Progress value={progress} className="h-2" />
              <p className="text-[10px] text-muted-foreground text-right">
                {Math.round(progress)}% complete
              </p>
            </div>
          )}
          
          {/* Points */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-1">
              <Star className="h-3 w-3 text-yellow-500" />
              <span className="text-xs font-medium">{badge.points} pts</span>
            </div>
            {isEarned && (
              <span className="text-xs text-green-500 font-medium">Earned!</span>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Main achievements page
export default function AchievementsPage() {
  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();

  // Determine user's badge type based on their role. Teachers and coordinators
  // share ONE ladder (badge_type = 'teacher'): since 20260904150000 the
  // evaluator admits both roles and the legacy 'coordinator' catalog is retired,
  // so a dual-role user has nothing to toggle between here. The only switcher
  // is the compact RoleSwitcher in the app bar (AppLayout, since 2026-09-09);
  // this page mounts none. This routes badge display only; it does not union the
  // two roles' data scopes anywhere else (teacher-authority-scope skill).
  // An admin+teacher keeps primaryRole "school_admin", so the active view is
  // checked first: in teacher view they get the teaching ladder rather than a
  // blank page while the badge evaluator is already awarding them teacher badges.
  const getEffectiveBadgeType = () => {
    if (roleInfo?.primaryRole === "student") return "student";
    if (hasDualRole && activeViewRole === "teacher") return "teacher";
    if (roleInfo?.primaryRole === "teacher" || roleInfo?.primaryRole === "coordinator") return "teacher";
    return null;
  };
  
  const userBadgeType = getEffectiveBadgeType();

  // Streaks are a student concept: user_activity_log is only written for
  // students, so this is gated rather than showing staff a permanent zero.
  // Same query key as the one inside StudentAchievementsView, so React Query
  // serves both from a single request.
  const { data: studentAchievements } = useStudentAchievements(userBadgeType === 'student');
  const currentStreak =
    userBadgeType === 'student' ? studentAchievements?.streak?.current ?? null : null;

  // Teacher payload, fetched here and handed down, so the page and the view
  // issue one request between them rather than two.
  const {
    data: teacherAchievements,
    isLoading: teacherAchievementsLoading,
    isError: teacherAchievementsError,
    refetch: refetchTeacherAchievements,
  } = useTeacherAchievements(userBadgeType === 'teacher');

  const { data: allBadges, isLoading: badgesLoading } = useBadgeDefinitions();
  const { data: userBadges, isLoading: userBadgesLoading } = useUserBadges();
  const { data: badgeProgress } = useBadgeProgress();
  const { data: stats, isLoading: statsLoading } = useBadgeStats();

  // Onboarding journey — only relevant to teaching staff (teachers and
  // coordinators both resolve to the teacher badge type above)
  const showOnboardingJourney = userBadgeType === "teacher";
  const { data: onboarding, isLoading: onboardingLoading } = useMyOnboardingProgress(showOnboardingJourney);
  const badgesLocked = showOnboardingJourney && !!onboarding && !onboarding.isJourneyCompleted;

  const earnedBadgeIds = new Set(userBadges?.map(b => b.badge_id) || []);
  
  // Filter badges to only show those relevant to the user's effective role
  // Students see student badges, teachers see teacher badges, etc.
  // School admins and super admins can see all (but shouldn't have access to this page)
  const filteredBadges = allBadges?.filter(b => {
    // If user has a specific role type, only show badges for that type
    if (userBadgeType) {
      return b.badge_type === userBadgeType;
    }
    // Fallback: show all (for admins if they somehow access this page)
    return true;
  }) || [];

  const earnedCount = filteredBadges.filter(b => earnedBadgeIds.has(b.id)).length;
  const lockedCount = filteredBadges.length - earnedCount;

  if (badgesLoading || statsLoading) {
    return (
      <div className="space-y-6 p-4">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const isStudent = userBadgeType === 'student';
  const isTeacher = userBadgeType === 'teacher';
  // Both redesigned surfaces carry their own hero, tabs and tiles, so the legacy
  // chrome below (animated background, confetti, HeroStats, TierProgress, the
  // flat badge grid) is suppressed for them. Coordinators resolve to the teacher
  // surface, so the legacy branch is now reached only by an admin who lands on
  // this route without a badge type of their own.
  const isRedesigned = isStudent || isTeacher;

  return (
    <TooltipProvider>
      <div className="relative min-h-dvh">
        {/* The animated background and permanent confetti are staff-only now.
            On the student surface they sat behind a saturated hero row and read
            as noise, and confetti that never stops celebrates nothing. */}
        {!isRedesigned && (
          <>
            <AnimatedBackground />
            <Confetti />
          </>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative z-10 space-y-8 pb-8"
        >
          {/* Hero Header — staff only. The student surface opens on the Player
              Card, which states rank, points, streak and badge count in one
              object; a pill, a 48px gradient title and a subtitle above it were
              three restatements of the word "achievements". */}
          {!isRedesigned && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-4"
            >
              <motion.div
                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400/20 to-orange-400/20 rounded-full border border-yellow-400/30"
                animate={{
                  boxShadow: ['0 0 20px rgba(251,191,36,0.2)', '0 0 40px rgba(251,191,36,0.4)', '0 0 20px rgba(251,191,36,0.2)']
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="h-5 w-5 text-yellow-500" />
                <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                  Achievement Center
                </span>
              </motion.div>

              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-orange-600 bg-clip-text text-transparent">
                Your Achievements
              </h1>
              <p className="text-muted-foreground max-w-md mx-auto">
                Track your progress, earn badges, and unlock rewards as you learn and grow!
              </p>
            </motion.div>
          )}

          {/* Onboarding journey — for teachers & coordinators only, shown above badges */}
          {showOnboardingJourney && (
            <OnboardingJourneyPanel data={onboarding} isLoading={onboardingLoading} />
          )}

          {/* Stats + Level Progress are staff-only: for a student both are
              folded into the Player Card, and leaving them here printed the
              same points total twice on one screen. */}
          {!isRedesigned && (
            <>
              <HeroStats stats={stats} isLoading={statsLoading} streak={currentStreak} />
              <TierProgress stats={stats} />
            </>
          )}

          {/* Redesigned student surface: tri-colour hero row, five category tabs,
              shield tiles. Coordinators keep the legacy grid below, since their
              badge set has not been rebuilt yet. */}
          {isStudent && <StudentAchievementsView />}

          {/* Teacher surface: same shape, teacher vocabulary. Classroom,
              Assessment, Marking, Homework and Teamwork, with no streak card
              (there is no teacher activity spine to compute one from). The
              payload is passed down rather than fetched inside the view so this
              page and the view share a single request. */}
          {isTeacher && (
            <TeacherAchievementsView
              data={teacherAchievements}
              isLoading={teacherAchievementsLoading}
              isError={teacherAchievementsError}
              onRetry={refetchTeacherAchievements}
            />
          )}

          {/* Badge Categories — coordinator only */}
          {!isRedesigned && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Gift className="h-5 w-5 text-primary" />
                    Badge Collection
                  </CardTitle>
                  
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      <span>{earnedCount} Earned</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-muted border" />
                      <span>{lockedCount} Locked</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Role-specific info badge */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {userBadgeType ? `${userBadgeType} badges` : 'All badges'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Showing achievements for your role
                  </span>
                </div>

                {/* Locked notice — visible until onboarding journey is complete */}
                {badgesLocked && (
                  <div className="flex items-start gap-3 rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-4">
                    <Lock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-semibold text-amber-600 dark:text-amber-400">Badges are locked</p>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Complete your onboarding journey above to start earning badges. We'll begin awarding them automatically the moment you finish all five milestones.
                      </p>
                    </div>
                  </div>
                )}

                {/* Badge Grid */}
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                >
                  <AnimatePresence mode="popLayout">
                    {filteredBadges.map((badge, idx) => {
                      const isEarned = earnedBadgeIds.has(badge.id);
                      const progress = badgeProgress?.find(p => p.badge_id === badge.id);
                      const progressPercent = progress 
                        ? (progress.current_value / progress.target_value) * 100 
                        : 0;
                      
                      return (
                        <motion.div
                          key={badge.id}
                          layout
                          variants={itemVariants}
                          initial="hidden"
                          animate="visible"
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ delay: idx * 0.05 }}
                        >
                          <BadgeCriteriaCard 
                            badge={badge}
                            isEarned={isEarned}
                            progress={isEarned ? undefined : progressPercent}
                          />
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </motion.div>

                {filteredBadges.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-12"
                  >
                    <Award className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">No badges in this category yet</p>
                  </motion.div>
                )}
              </CardContent>
            </Card>
          </motion.div>
          )}

          {/* How to Earn — staff only. Every student badge tile already states
              its own criteria and live progress, so a generic explainer in a
              fourth colour (blue to purple) sat outside the tri-colour system
              and repeated what the grid says per badge. */}
          {!isRedesigned && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-500" />
                  How to Earn Badges
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-6">
                  {[
                    {
                      icon: Target,
                      title: 'Complete Exams',
                      description: 'Take exams and aim for high scores to earn achievement badges',
                      color: 'from-green-400 to-emerald-500'
                    },
                    {
                      icon: Flame,
                      title: 'Stay Consistent',
                      description: 'Login daily and maintain streaks to unlock consistency badges',
                      color: 'from-orange-400 to-red-500'
                    },
                    {
                      icon: TrendingUp,
                      title: 'Show Improvement',
                      description: 'Improve your performance over time to earn growth badges',
                      color: 'from-blue-400 to-purple-500'
                    }
                  ].map((item, idx) => (
                    <motion.div
                      key={item.title}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.9 + idx * 0.1 }}
                      whileHover={{ y: -5 }}
                      className="flex gap-4"
                    >
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                        `bg-gradient-to-r ${item.color}`
                      )}>
                        <item.icon className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-semibold mb-1">{item.title}</h4>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
          )}
        </motion.div>
      </div>
    </TooltipProvider>
  );
}
