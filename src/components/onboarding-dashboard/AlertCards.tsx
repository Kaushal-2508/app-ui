import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Sparkles, ListChecks, TimerReset, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardAlert, AlertKind, AlertSeverity } from "@/lib/onboardingDashboardMath";

interface Props {
  alerts: DashboardAlert[];
}

const ICON_BY_KIND: Record<AlertKind, LucideIcon> = {
  escalation: TimerReset,
  closeToDone: ListChecks,
  bottleneck: AlertTriangle,
  momentum: Sparkles,
};

const TONE_BY_SEVERITY: Record<AlertSeverity, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-100",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100",
  critical: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100",
};

export function AlertCards({ alerts }: Props) {
  if (alerts.length === 0) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {alerts.map((a, i) => {
        const Icon = ICON_BY_KIND[a.kind];
        return (
          <Alert key={`${a.kind}-${i}`} className={cn("rounded-card", TONE_BY_SEVERITY[a.severity])}>
            <Icon className="h-4 w-4" />
            <AlertTitle className="font-semibold">{a.title}</AlertTitle>
            <AlertDescription className="text-sm opacity-90">{a.body}</AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
