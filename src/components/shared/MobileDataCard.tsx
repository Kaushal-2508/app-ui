import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MobileDataCardField {
  label: string;
  value: React.ReactNode;
  className?: string;
}

interface MobileDataCardProps {
  title: string;
  subtitle?: string;
  avatarText?: string;
  badge?: {
    text: string;
    variant?: "default" | "secondary" | "destructive" | "outline";
    className?: string;
  };
  fields?: MobileDataCardField[];
  actions?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function MobileDataCard({
  title,
  subtitle,
  avatarText,
  badge,
  fields = [],
  actions,
  onClick,
  className,
}: MobileDataCardProps) {
  return (
    <Card 
      className={cn(
        "hover:shadow-md transition-shadow",
        onClick && "cursor-pointer active:scale-[0.99]",
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {avatarText && (
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {avatarText}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p 
                  className={cn(
                    "font-medium text-foreground truncate",
                    onClick && "text-primary hover:underline"
                  )}
                >
                  {title}
                </p>
                {badge && (
                  <Badge 
                    variant={badge.variant || "secondary"} 
                    className={cn("text-xs shrink-0", badge.className)}
                  >
                    {badge.text}
                  </Badge>
                )}
              </div>
              {subtitle && (
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          
          {actions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {actions}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        
        {fields.length > 0 && (
          <div className="mt-3 pt-3 border-t space-y-2">
            {fields.map((field, index) => (
              <div key={index} className={cn("flex justify-between items-center text-sm", field.className)}>
                <span className="text-muted-foreground">{field.label}</span>
                <span className="font-medium text-right">{field.value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// List wrapper component for consistent spacing
interface MobileDataListProps {
  children: React.ReactNode;
  className?: string;
}

export function MobileDataList({ children, className }: MobileDataListProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {children}
    </div>
  );
}
