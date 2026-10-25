import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardTrigger, HoverCardContent, HoverCardPortal } from "@/components/ui/hover-card";

const variantStyles = {
  blue: "bg-gradient-to-br from-blue-500 to-blue-600",
  indigo: "bg-gradient-to-br from-indigo-500 to-purple-600",
  purple: "bg-gradient-to-br from-violet-500 to-fuchsia-600",
  pink: "bg-gradient-to-br from-pink-500 to-rose-600",
  red: "bg-gradient-to-br from-rose-500 to-red-600",
  orange: "bg-gradient-to-br from-amber-400 to-orange-500",
  emerald: "bg-gradient-to-br from-emerald-500 to-green-600",
  amber: "bg-gradient-to-br from-amber-500 to-yellow-600",
  slate: "bg-gradient-to-br from-slate-500 to-slate-600",
  sky: "bg-gradient-to-br from-sky-500 to-blue-600",
  teal: "bg-gradient-to-br from-teal-500 to-cyan-600",
  cyan: "bg-gradient-to-br from-cyan-500 to-blue-500",
} as const;

export type KPIVariant = keyof typeof variantStyles;

interface GradientKPICardProps {
  icon: React.ElementType;
  value: React.ReactNode;
  label: string;
  subLabel?: string;
  variant?: KPIVariant;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
  infoTooltip?: string;
}

export function GradientKPICard({
  icon: Icon,
  value,
  label,
  subLabel,
  variant = "blue",
  onClick,
  className,
  children,
  infoTooltip,
}: GradientKPICardProps) {
  return (
    <Card
      className={cn(
        "rounded-2xl border-0 shadow-lg text-white overflow-hidden relative hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 h-full",
        variantStyles[variant],
        onClick && "cursor-pointer hover:scale-[1.02]",
        className
      )}
      onClick={onClick}
    >
      <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6" />
      <div className="absolute bottom-0 left-0 w-14 h-14 bg-white/5 rounded-full translate-y-4 -translate-x-4" />
      {infoTooltip && (
        <HoverCard openDelay={200} closeDelay={100}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              className="absolute top-2 right-2 z-10 w-4 h-4 rounded-full bg-white/20 hover:bg-white/40 transition-colors flex items-center justify-center text-[9px] font-bold leading-none cursor-help"
              onClick={(e) => e.stopPropagation()}
            >
              i
            </button>
          </HoverCardTrigger>
          <HoverCardPortal>
            <HoverCardContent
              side="bottom"
              align="end"
              sideOffset={8}
              className="w-[270px] bg-slate-900/95 backdrop-blur-sm border-slate-600/50 text-white text-xs p-3.5 rounded-xl shadow-2xl"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-white/15 flex items-center justify-center text-[8px] font-bold">i</span>
                <p className="leading-relaxed text-white/90">{infoTooltip}</p>
              </div>
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCard>
      )}
      <CardContent className="p-4 relative flex flex-col justify-between h-full">
        <Icon className="h-5 w-5 mb-2 opacity-90" />
        {children ? (
          children
        ) : (
          <div className="text-3xl font-bold tracking-tight">{value}</div>
        )}
        <div>
          <p className="text-xs text-white/85 mt-1 font-medium">{label}</p>
          {subLabel && <p className="text-[10px] text-white/65 mt-0.5">{subLabel}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
