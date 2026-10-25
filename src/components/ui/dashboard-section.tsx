import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface DashboardSectionProps {
  title: string;
  description?: string;
  icon?: React.ElementType;
  iconGradient?: string;
  filter?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  borderColor?: string;
}

export function DashboardSection({
  title,
  description,
  icon: Icon,
  iconGradient = "from-blue-400 to-indigo-500",
  filter,
  children,
  className,
  contentClassName,
  borderColor,
}: DashboardSectionProps) {
  return (
    <Card className={cn("rounded-2xl relative overflow-hidden border-border/40", borderColor, className)}>
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-accent/[0.02]" />
      <CardHeader className="relative">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {Icon && (
                <div className={cn("p-1.5 rounded-lg bg-gradient-to-br text-white shadow-sm", iconGradient)}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
              )}
              {title}
            </CardTitle>
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          {filter}
        </div>
      </CardHeader>
      <CardContent className={cn("relative", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
