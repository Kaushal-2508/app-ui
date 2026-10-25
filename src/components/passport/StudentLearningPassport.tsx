import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudentPassport, getPassportLevelConfig, PassportLevel } from "@/hooks/useStudentPassport";
import { useUserBadges } from "@/hooks/useBadges";
import { BadgeShowcase } from "@/components/badges";
import { SubjectCapabilityCards } from "@/components/passport/SubjectCapabilityCards";
import { AcademicHistoryTimeline } from "@/components/passport/AcademicHistoryTimeline";
import { 
  GraduationCap, 
  Target, 
  Trophy, 
  Flame,
  TrendingUp,
  BookOpen,
  Calendar,
  Star,
  Award,
  BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StudentLearningPassportProps {
  studentId?: string;
  expanded?: boolean;
}

export function StudentLearningPassport({ studentId, expanded = true }: StudentLearningPassportProps) {
  const { data: passportData, isLoading: passportLoading } = useStudentPassport(studentId);
  const { data: badges } = useUserBadges(studentId);

  if (passportLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const passport = passportData?.passport;
  const academicRecords = passportData?.academicRecords || [];
  const subjectCapabilities = passportData?.subjectCapabilities || [];

  if (!passport) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Learning passport not available</p>
        </CardContent>
      </Card>
    );
  }

  const levelConfig = getPassportLevelConfig(passport.passport_level as PassportLevel);
  const passRate = passport.total_exams_taken > 0 
    ? (passport.total_exams_passed / passport.total_exams_taken) * 100 
    : 0;

  const levelProgress = Math.min(
    ((passport.total_points - levelConfig.minPoints) / 
    (levelConfig.maxPoints - levelConfig.minPoints)) * 100,
    100
  );

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="overflow-hidden">
          {/* Header with Level Badge */}
          <CardHeader className={cn("pb-4 border-b", levelConfig.bgColor)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-3">
                <motion.div
                  animate={{ rotate: [0, -10, 10, 0] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                  className="text-2xl"
                >
                  {levelConfig.icon}
                </motion.div>
                <div>
                  <span>Learning Passport</span>
                  <div className={cn("text-sm font-normal mt-0.5", levelConfig.color)}>
                    Level: {levelConfig.label}
                  </div>
                </div>
              </CardTitle>
              <div className="text-right">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.3 }}
                  className="flex items-center gap-1"
                >
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                  <span className="text-2xl font-bold">{passport.total_points}</span>
                </motion.div>
                <p className="text-xs text-muted-foreground">Total Points</p>
              </div>
            </div>

            <div className="mt-4 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Level Progress</span>
                <span className={levelConfig.color}>{levelProgress.toFixed(0)}%</span>
              </div>
              <Progress value={levelProgress} className="h-2" />
            </div>
          </CardHeader>

          <CardContent className="pt-6 space-y-6">
            {/* Key Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatItem icon={<BookOpen className="h-5 w-5 text-primary" />} label="Exams Taken" value={passport.total_exams_taken} delay={0.1} />
              <StatItem icon={<Trophy className="h-5 w-5 text-green-500" />} label="Exams Passed" value={passport.total_exams_passed} subValue={`${passRate.toFixed(0)}%`} delay={0.2} />
              <StatItem icon={<Target className="h-5 w-5 text-amber-500" />} label="Avg Score" value={`${passport.average_percentage.toFixed(1)}%`} delay={0.3} />
              <StatItem icon={<TrendingUp className="h-5 w-5 text-purple-500" />} label="Best Score" value={`${passport.highest_percentage.toFixed(1)}%`} delay={0.4} />
            </div>

            {/* Secondary Stats */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Award className="h-4 w-4 text-primary" />
                  <span className="text-xl font-bold">{passport.total_badges_earned}</span>
                </div>
                <p className="text-xs text-muted-foreground">Badges Earned</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span className="text-xl font-bold">{passport.login_streak_current}</span>
                </div>
                <p className="text-xs text-muted-foreground">Day Streak</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="text-xl font-bold">
                    {passport.improvement_rate >= 0 ? '+' : ''}{passport.improvement_rate.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Improvement</p>
              </div>
            </div>

            {/* Rankings */}
            {(passport.rank_in_class || passport.rank_in_institution) && (
              <div className="flex gap-4">
                {passport.rank_in_class && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                    className="flex-1 p-3 bg-muted/50 rounded-lg border"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🏅</span>
                      <div>
                        <p className="text-lg font-bold">#{passport.rank_in_class}</p>
                        <p className="text-xs text-muted-foreground">Rank in Class</p>
                      </div>
                    </div>
                  </motion.div>
                )}
                {passport.rank_in_institution && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 }}
                    className="flex-1 p-3 bg-muted/50 rounded-lg border"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🎖️</span>
                      <div>
                        <p className="text-lg font-bold">#{passport.rank_in_institution}</p>
                        <p className="text-xs text-muted-foreground">Rank in School</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* Subjects Mastered */}
            {passport.subjects_mastered && passport.subjects_mastered.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Subjects Mastered
                </h4>
                <div className="flex flex-wrap gap-2">
                  {passport.subjects_mastered.map((subject, idx) => (
                    <motion.div
                      key={subject}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.7 + idx * 0.1 }}
                    >
                      <Badge variant="secondary">✓ {subject}</Badge>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Last Active */}
            {passport.last_active_at && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                <Calendar className="h-3 w-3" />
                <span>Last active: {new Date(passport.last_active_at).toLocaleDateString()}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Subject Capabilities */}
      {expanded && subjectCapabilities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <SubjectCapabilityCards capabilities={subjectCapabilities} />
        </motion.div>
      )}

      {/* Academic History */}
      {expanded && academicRecords.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <AcademicHistoryTimeline records={academicRecords} />
        </motion.div>
      )}

      {/* Badge Showcase */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <BadgeShowcase userId={studentId} maxDisplay={8} />
        </motion.div>
      )}
    </div>
  );
}

interface StatItemProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  delay?: number;
}

function StatItem({ icon, label, value, subValue, delay = 0 }: StatItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="text-center p-3 bg-card border rounded-lg"
    >
      <div className="flex items-center justify-center mb-2">{icon}</div>
      <p className="text-xl font-bold">{value}</p>
      {subValue && <p className="text-xs text-green-600 dark:text-green-400">{subValue}</p>}
      <p className="text-xs text-muted-foreground">{label}</p>
    </motion.div>
  );
}
