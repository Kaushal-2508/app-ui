import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle, Sparkles, Lock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingProgress } from "@/hooks/useOnboardingJourney";

interface OnboardingJourneyPanelProps {
  data: OnboardingProgress | null | undefined;
  isLoading: boolean;
}

export function OnboardingJourneyPanel({ data, isLoading }: OnboardingJourneyPanelProps) {
  const isComplete = data?.isJourneyCompleted ?? false;
  const [isExpanded, setIsExpanded] = useState(!isComplete);

  if (isLoading) {
    return (
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const pct = Math.round(data.completionPercent);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-0 shadow-lg overflow-hidden bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30">
        <CardHeader
          className={cn("pb-4", isComplete && "cursor-pointer select-none")}
          onClick={isComplete ? () => setIsExpanded((v) => !v) : undefined}
        >
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              {isComplete ? (
                <Sparkles className="h-5 w-5 text-green-500" />
              ) : (
                <Lock className="h-5 w-5 text-amber-500" />
              )}
              Onboarding Journey
            </CardTitle>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-sm font-semibold px-3 py-1 rounded-full",
                  isComplete
                    ? "bg-green-500 text-white"
                    : "bg-amber-500 text-white",
                )}
              >
                {data.completedCount} / 5 · {pct}%
              </span>
              {isComplete && (
                <motion.div
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                </motion.div>
              )}
            </div>
          </div>
          <p className="text-xs md:text-sm text-muted-foreground mt-2">
            {isComplete
              ? "Great job! You have completed onboarding. Badges are now unlocked and will start arriving as you earn them."
              : "Finish these five milestones to start earning badges. Your progress updates automatically as you complete each step, in any order."}
          </p>
        </CardHeader>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <CardContent className="space-y-4 pt-0">
                <Progress value={pct} className="h-2" />

                <ul className="space-y-2">
                  {data.milestones.map((m, idx) => (
                    <motion.li
                      key={m.key}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                        m.done
                          ? "border-green-500/30 bg-green-500/5"
                          : "border-muted bg-background",
                      )}
                    >
                      <div className="mt-0.5 shrink-0">
                        {m.done ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            m.done ? "text-green-600 dark:text-green-400" : "text-foreground",
                          )}
                        >
                          {m.label}
                        </p>
                        <p className="text-xs text-muted-foreground">{m.description}</p>
                      </div>
                      <span
                        className={cn(
                          "text-[10px] font-semibold uppercase tracking-wide shrink-0 px-2 py-0.5 rounded",
                          m.done
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {m.done ? "Done" : "Pending"}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}
