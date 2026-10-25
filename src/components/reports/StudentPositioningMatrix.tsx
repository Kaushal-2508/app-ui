import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, AlertTriangle, TrendingUp, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface StudentData {
  id: string;
  name: string;
  class: string;
  accuracy: number;
}

interface PositioningData {
  needsAttention: { count: number; percentage: number; students: StudentData[] };
  developing: { count: number; percentage: number; students: StudentData[] };
  stable: { count: number; percentage: number; students: StudentData[] };
}

interface StudentPositioningMatrixProps {
  data: PositioningData;
  onCategoryClick?: (category: "needsAttention" | "developing" | "stable") => void;
  className?: string;
}

export function StudentPositioningMatrix({
  data,
  onCategoryClick,
  className,
}: StudentPositioningMatrixProps) {
  const total = data.needsAttention.count + data.developing.count + data.stable.count;

  const categories = [
    {
      key: "needsAttention" as const,
      label: "Needs Attention",
      description: "<50%",
      count: data.needsAttention.count,
      percentage: data.needsAttention.percentage,
      students: data.needsAttention.students,
      bgColor: "bg-red-50 dark:bg-red-950/30",
      borderColor: "border-red-200 dark:border-red-800",
      textColor: "text-red-700 dark:text-red-400",
      icon: AlertTriangle,
    },
    {
      key: "developing" as const,
      label: "Developing",
      description: "50-65%",
      count: data.developing.count,
      percentage: data.developing.percentage,
      students: data.developing.students,
      bgColor: "bg-amber-50 dark:bg-amber-950/30",
      borderColor: "border-amber-200 dark:border-amber-800",
      textColor: "text-amber-700 dark:text-amber-400",
      icon: TrendingUp,
    },
    {
      key: "stable" as const,
      label: "Stable",
      description: ">65%",
      count: data.stable.count,
      percentage: data.stable.percentage,
      students: data.stable.students,
      bgColor: "bg-green-50 dark:bg-green-950/30",
      borderColor: "border-green-200 dark:border-green-800",
      textColor: "text-green-700 dark:text-green-400",
      icon: CheckCircle,
    },
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Student Positioning Matrix
        </CardTitle>
        <CardDescription>
          Distribution of {total} students across performance levels
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {categories.map((cat) => (
            <button
              key={cat.key}
              onClick={() => onCategoryClick?.(cat.key)}
              className={cn(
                "p-4 rounded-lg border-2 transition-all hover:shadow-md text-left",
                cat.bgColor,
                cat.borderColor
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <cat.icon className={cn("h-5 w-5", cat.textColor)} />
                <Badge variant="outline" className={cat.textColor}>
                  {cat.percentage.toFixed(0)}%
                </Badge>
              </div>
              <div className={cn("text-2xl font-bold", cat.textColor)}>
                {cat.count}
              </div>
              <div className="text-sm font-medium">{cat.label}</div>
              <div className="text-xs text-muted-foreground">{cat.description}</div>
            </button>
          ))}
        </div>

        {/* Visual bar representation */}
        <div className="h-4 rounded-full overflow-hidden flex bg-muted">
          {data.needsAttention.count > 0 && (
            <div
              className="bg-red-500 h-full"
              style={{ width: `${data.needsAttention.percentage}%` }}
              title={`Needs Attention: ${data.needsAttention.count}`}
            />
          )}
          {data.developing.count > 0 && (
            <div
              className="bg-amber-500 h-full"
              style={{ width: `${data.developing.percentage}%` }}
              title={`Developing: ${data.developing.count}`}
            />
          )}
          {data.stable.count > 0 && (
            <div
              className="bg-green-500 h-full"
              style={{ width: `${data.stable.percentage}%` }}
              title={`Stable: ${data.stable.count}`}
            />
          )}
        </div>

        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>At Risk</span>
          <span>Developing</span>
          <span>On Track</span>
        </div>
      </CardContent>
    </Card>
  );
}
