import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  color?: "default" | "success" | "warning" | "danger" | "info";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const colorStyles = {
  default: "text-white",
  success: "text-white",
  warning: "text-white",
  danger: "text-white",
  info: "text-white",
};

const bgStyles = {
  default: "bg-gradient-to-br from-[hsl(258,89%,66%)] to-[hsl(280,85%,60%)] text-white border-0",
  success: "bg-gradient-to-br from-[hsl(152,68%,45%)] to-[hsl(170,70%,42%)] text-white border-0",
  warning: "bg-gradient-to-br from-[hsl(38,92%,50%)] to-[hsl(25,95%,53%)] text-white border-0",
  danger: "bg-gradient-to-br from-[hsl(0,84%,60%)] to-[hsl(340,82%,52%)] text-white border-0",
  info: "bg-gradient-to-br from-[hsl(200,95%,50%)] to-[hsl(220,90%,56%)] text-white border-0",
};

const sizeStyles = {
  sm: {
    card: "p-3",
    icon: "h-4 w-4",
    label: "text-xs",
    value: "text-lg font-bold",
    subValue: "text-xs",
  },
  md: {
    card: "p-4",
    icon: "h-5 w-5",
    label: "text-sm",
    value: "text-2xl font-bold",
    subValue: "text-xs",
  },
  lg: {
    card: "p-6",
    icon: "h-6 w-6",
    label: "text-sm",
    value: "text-4xl font-bold",
    subValue: "text-sm",
  },
};

export function MetricCard({
  icon: Icon,
  label,
  value,
  subValue,
  trend,
  trendValue,
  color = "default",
  size = "md",
  className,
}: MetricCardProps) {
  const styles = sizeStyles[size];

  return (
    <Card className={cn(bgStyles[color], "shadow-md hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5", className)}>
      <CardContent className={cn("text-center relative overflow-hidden", styles.card)}>
        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6" />
        <Icon className={cn("mx-auto mb-2 relative", styles.icon, colorStyles[color])} />
        <p className={cn("text-white/80 relative", styles.label)}>{label}</p>
        <p className={cn(colorStyles[color], "relative", styles.value)}>
          {typeof value === "number" ? formatNumber(value) : value}
        </p>
        {subValue && (
          <p className={cn("text-white/70 mt-1 relative", styles.subValue)}>
            {subValue}
          </p>
        )}
        {trend && trendValue && (
          <div className={cn("flex items-center justify-center gap-1 mt-1 relative", styles.subValue)}>
            <TrendIndicator trend={trend} size="sm" />
            <span className="text-white/90">
              {trendValue}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Inline TrendIndicator for MetricCard
function TrendIndicator({ trend, size = "sm" }: { trend: "up" | "down" | "stable"; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  
  if (trend === "up") {
    return (
      <svg className={cn(sizeClass, "text-white")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    );
  }
  if (trend === "down") {
    return (
      <svg className={cn(sizeClass, "text-white/80")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
  }
  return (
    <svg className={cn(sizeClass, "text-white/60")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
    </svg>
  );
}
