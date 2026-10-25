import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface InsightReference {
  metric: string;
  value: string;
  comparison?: string;
  threshold?: string;
  detail?: string;
}

interface InsightCardProps {
  id: string;
  title: string;
  message: string;
  status: "Stable" | "Guide" | "Action" | "Needs Attention" | "Developing" | "info" | "warning" | "critical";
  icon: string;
  references: InsightReference[];
  studentList?: string[];
  className?: string;
}

export function InsightCard({
  title,
  message,
  status,
  icon,
  references,
  studentList,
  className,
}: InsightCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getCardStyle = () => {
    switch (status) {
      case "Stable":
      case "info":
        return "border-0 bg-gradient-to-br from-emerald-500 to-green-600 text-white";
      case "Guide":
        return "border-0 bg-gradient-to-br from-blue-500 to-indigo-600 text-white";
      case "Action":
      case "Needs Attention":
      case "critical":
        return "border-0 bg-gradient-to-br from-rose-500 to-red-600 text-white";
      case "Developing":
      case "warning":
        return "border-0 bg-gradient-to-br from-amber-400 to-orange-500 text-white";
      default:
        return "bg-muted/50";
    }
  };

  return (
    <Card className={cn("transition-all overflow-hidden relative", getCardStyle(), className)}>
      <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6" />
      <div className="absolute bottom-0 left-0 w-12 h-12 bg-white/5 rounded-full translate-y-4 -translate-x-4" />
      <CardContent className="p-4 space-y-2 relative">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-bold text-sm truncate">{title}</h4>
              <Badge className="text-[10px] bg-white/20 text-white border-0 hover:bg-white/30 shrink-0">
                {status}
              </Badge>
            </div>
            <p className="text-xs text-white/80 line-clamp-2">{message}</p>
          </div>
        </div>

        {references.length > 0 && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-xs text-white/70 hover:text-white hover:bg-white/10 h-7 px-2"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <span>Why this insight was generated</span>
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>

            {isExpanded && (
              <div className="mt-1 p-2.5 bg-white/10 backdrop-blur-sm rounded-xl space-y-1.5">
                {references.map((ref, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px] border-b border-white/10 last:border-0 pb-1">
                    <span className="text-white/70">{ref.metric}</span>
                    <span className="font-bold">{ref.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {studentList && studentList.length > 0 && isExpanded && (
          <div className="p-2 bg-white/10 rounded-xl">
            <div className="flex flex-wrap gap-1">
              {studentList.map((name, idx) => (
                <Badge key={idx} className="text-[10px] bg-white/20 text-white border-0">{name}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
