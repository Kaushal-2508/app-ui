import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusType = 
  | "excellent" 
  | "good" 
  | "developing" 
  | "needs_attention"
  | "stable"
  | "improving"
  | "declining"
  | "critical"
  | "warning"
  | "info"
  | "success"
  | "pending"
  | "completed"
  | "active"
  | "inactive";

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: "sm" | "md" | "lg";
  showDot?: boolean;
  className?: string;
}

const statusConfig: Record<StatusType, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  excellent: {
    label: "Excellent",
    variant: "default",
    className: "bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0 shadow-sm",
  },
  good: {
    label: "Good",
    variant: "secondary",
    className: "bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0 shadow-sm",
  },
  developing: {
    label: "Developing",
    variant: "secondary",
    className: "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 shadow-sm",
  },
  needs_attention: {
    label: "Needs Attention",
    variant: "destructive",
    className: "bg-gradient-to-r from-rose-500 to-red-600 text-white border-0 shadow-sm",
  },
  stable: {
    label: "Stable",
    variant: "default",
    className: "bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-0 shadow-sm",
  },
  improving: {
    label: "Improving",
    variant: "default",
    className: "bg-gradient-to-r from-green-500 to-emerald-600 text-white border-0 shadow-sm",
  },
  declining: {
    label: "Declining",
    variant: "destructive",
    className: "bg-gradient-to-r from-red-500 to-rose-600 text-white border-0 shadow-sm",
  },
  critical: {
    label: "Critical",
    variant: "destructive",
    className: "bg-gradient-to-r from-red-600 to-rose-700 text-white border-0 shadow-sm",
  },
  warning: {
    label: "Warning",
    variant: "secondary",
    className: "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 shadow-sm",
  },
  info: {
    label: "Info",
    variant: "secondary",
    className: "bg-gradient-to-r from-sky-500 to-blue-600 text-white border-0 shadow-sm",
  },
  success: {
    label: "Success",
    variant: "default",
    className: "bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0 shadow-sm",
  },
  pending: {
    label: "Pending",
    variant: "outline",
    className: "bg-gradient-to-r from-slate-400 to-slate-500 text-white border-0 shadow-sm",
  },
  completed: {
    label: "Completed",
    variant: "default",
    className: "bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0 shadow-sm",
  },
  active: {
    label: "Active",
    variant: "default",
    className: "bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0 shadow-sm",
  },
  inactive: {
    label: "Inactive",
    variant: "outline",
    className: "bg-gradient-to-r from-slate-400 to-slate-500 text-white border-0 shadow-sm",
  },
};

const sizeStyles = {
  sm: "text-[10px] px-1.5 py-0",
  md: "text-xs px-2 py-0.5",
  lg: "text-sm px-2.5 py-1",
};

export function StatusBadge({
  status,
  label,
  size = "md",
  showDot = false,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const displayLabel = label || config.label;

  return (
    <Badge
      variant={config.variant}
      className={cn(config.className, sizeStyles[size], className)}
    >
      {showDot && (
        <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
      )}
      {displayLabel}
    </Badge>
  );
}

// Helper function to get status from percentage
export function getStatusFromPercentage(percentage: number): StatusType {
  if (percentage >= 85) return "excellent";
  if (percentage >= 75) return "good";
  if (percentage >= 65) return "developing";
  if (percentage >= 50) return "warning";
  return "needs_attention";
}

// Helper function to get status from trend
export function getStatusFromTrend(trend: "improving" | "stable" | "declining"): StatusType {
  switch (trend) {
    case "improving": return "improving";
    case "stable": return "stable";
    case "declining": return "declining";
  }
}
