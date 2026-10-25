import { Badge } from "@/components/ui/badge";
import { Globe, School, Archive } from "lucide-react";
import { cn } from "@/lib/utils";

export type SourceType = "global" | "institute" | "custom" | "archived";

interface SourceBadgeProps {
  source: SourceType;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "default";
}

export function SourceBadge({ 
  source, 
  className, 
  showIcon = true,
  size = "default" 
}: SourceBadgeProps) {
  const sizeClasses = size === "sm" ? "text-[10px] px-1.5 py-0" : "text-xs";
  
  if (source === "archived") {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "gap-1 border-muted-foreground/30 text-muted-foreground",
          sizeClasses,
          className
        )}
      >
        {showIcon && <Archive className="h-3 w-3" />}
        Archived
      </Badge>
    );
  }
  
  if (source === "global") {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "gap-1 border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
          sizeClasses,
          className
        )}
      >
        {showIcon && <Globe className="h-3 w-3" />}
        Global
      </Badge>
    );
  }
  
  // "institute" or "custom" - both represent institution-specific content
  return (
    <Badge 
      variant="secondary" 
      className={cn(
        "gap-1 border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
        sizeClasses,
        className
      )}
    >
      {showIcon && <School className="h-3 w-3" />}
      Custom
    </Badge>
  );
}

// Helper to determine source type
export function getSourceType(institutionId: string | null | undefined, isActive?: boolean): SourceType {
  if (isActive === false) return "archived";
  return institutionId ? "institute" : "global";
}
