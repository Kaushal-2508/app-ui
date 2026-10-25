import { TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrendDirection = "up" | "down" | "stable";

interface TrendIndicatorProps {
  trend: TrendDirection;
  value?: string | number;
  showLabel?: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "arrow" | "line";
  className?: string;
}

const sizeConfig = {
  sm: {
    icon: "h-3 w-3",
    text: "text-xs",
    gap: "gap-0.5",
  },
  md: {
    icon: "h-4 w-4",
    text: "text-sm",
    gap: "gap-1",
  },
  lg: {
    icon: "h-5 w-5",
    text: "text-base",
    gap: "gap-1.5",
  },
};

const trendConfig = {
  up: {
    color: "text-green-600 dark:text-green-500",
    bgColor: "bg-green-50 dark:bg-green-950/20",
    label: "Improving",
  },
  down: {
    color: "text-red-600 dark:text-red-500",
    bgColor: "bg-red-50 dark:bg-red-950/20",
    label: "Declining",
  },
  stable: {
    color: "text-muted-foreground",
    bgColor: "bg-muted/50",
    label: "Stable",
  },
};

export function TrendIndicator({
  trend,
  value,
  showLabel = false,
  label,
  size = "md",
  variant = "default",
  className,
}: TrendIndicatorProps) {
  const sizeStyles = sizeConfig[size];
  const config = trendConfig[trend];

  const getIcon = () => {
    if (variant === "arrow") {
      if (trend === "up") return <ArrowUp className={sizeStyles.icon} />;
      if (trend === "down") return <ArrowDown className={sizeStyles.icon} />;
      return <Minus className={sizeStyles.icon} />;
    }
    
    if (trend === "up") return <TrendingUp className={sizeStyles.icon} />;
    if (trend === "down") return <TrendingDown className={sizeStyles.icon} />;
    return <Minus className={sizeStyles.icon} />;
  };

  const displayLabel = label || config.label;

  return (
    <div
      className={cn(
        "inline-flex items-center",
        sizeStyles.gap,
        config.color,
        className
      )}
    >
      {getIcon()}
      {value !== undefined && (
        <span className={sizeStyles.text}>{value}</span>
      )}
      {showLabel && (
        <span className={cn(sizeStyles.text, "text-muted-foreground")}>
          {displayLabel}
        </span>
      )}
    </div>
  );
}

// Compact trend indicator with background
export function TrendBadge({
  trend,
  value,
  size = "sm",
  className,
}: Omit<TrendIndicatorProps, "showLabel" | "label" | "variant">) {
  const config = trendConfig[trend];
  const sizeStyles = sizeConfig[size];

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5",
        sizeStyles.gap,
        config.bgColor,
        config.color,
        className
      )}
    >
      <TrendIndicator trend={trend} size={size} />
      {value !== undefined && (
        <span className={sizeStyles.text}>{value}</span>
      )}
    </div>
  );
}

// Helper to determine trend from two values
export function determineTrend(current: number, previous: number, threshold = 5): TrendDirection {
  const change = ((current - previous) / previous) * 100;
  if (change > threshold) return "up";
  if (change < -threshold) return "down";
  return "stable";
}
