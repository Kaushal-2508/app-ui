import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SubjectCapability, getCapabilityTierConfig } from "@/hooks/useStudentPassport";
import { BookOpen, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SubjectCapabilityCardsProps {
  capabilities: SubjectCapability[];
}

export function SubjectCapabilityCards({ capabilities }: SubjectCapabilityCardsProps) {
  if (capabilities.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          Subject Capabilities
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {capabilities.map((cap, idx) => (
            <SubjectCard key={cap.subject_id || idx} capability={cap} index={idx} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SubjectCard({ capability, index }: { capability: SubjectCapability; index: number }) {
  const tierConfig = getCapabilityTierConfig(capability.capability_tier);
  const yearData = capability.year_wise_data || [];
  const hasTrend = yearData.length >= 2;
  const trendUp = hasTrend
    ? yearData[yearData.length - 1].accuracy > yearData[yearData.length - 2].accuracy
    : false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={cn(
        "p-4 rounded-lg border space-y-3",
        tierConfig.bgColor,
        tierConfig.borderColor
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{tierConfig.icon}</span>
          <div>
            <h4 className="font-semibold text-sm">{capability.subject_name}</h4>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", tierConfig.color, tierConfig.borderColor)}>
              {tierConfig.label}
            </Badge>
          </div>
        </div>
        {hasTrend && (
          <div className={cn("flex items-center gap-0.5 text-xs", trendUp ? "text-green-600" : "text-red-500")}>
            {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trendUp ? "Improving" : "Declining"}
          </div>
        )}
      </div>

      {/* Accuracy bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Accuracy</span>
          <span className="font-medium">{capability.accuracy_percent.toFixed(1)}%</span>
        </div>
        <Progress value={capability.accuracy_percent} className="h-1.5" />
      </div>

      {/* Mastery */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Mastery</span>
          <span className="font-medium">{capability.mastery_level}/100</span>
        </div>
        <Progress value={capability.mastery_level} className="h-1.5" />
      </div>

      {/* Stats row */}
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span>{capability.total_questions} questions</span>
        <span>{capability.correct_answers} correct</span>
      </div>

      {/* Topics */}
      {capability.strongest_topics.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Strongest</p>
          <div className="flex flex-wrap gap-1">
            {capability.strongest_topics.map(t => (
              <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {capability.weakest_topics.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Needs Work</p>
          <div className="flex flex-wrap gap-1">
            {capability.weakest_topics.map(t => (
              <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Year-wise trend */}
      {yearData.length > 0 && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Year-wise</p>
          <div className="flex items-center gap-1 text-xs flex-wrap">
            {yearData.map((yd, i) => (
              <span key={yd.year} className="flex items-center gap-1">
                <span className="font-medium">{yd.class_name}</span>
                <span className="text-muted-foreground">{yd.accuracy.toFixed(0)}%</span>
                {i < yearData.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
