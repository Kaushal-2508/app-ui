import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge, StatusType } from "./StatusBadge";
import { TrendIndicator, TrendDirection } from "./TrendIndicator";
import { cn } from "@/lib/utils";
import {
  User,
  BookOpen,
  Users,
  AlertTriangle,
  ChevronRight,
  GraduationCap,
} from "lucide-react";

export interface TeacherInfo {
  id: string;
  name: string;
  photoUrl?: string;
  subjects?: string[];
  classes?: string[];
  classAverage?: number;
  studentsCount?: number;
  studentsNeedingAttention?: number;
  trend?: TrendDirection;
  status?: StatusType;
  effectiveness?: number;
  actionItems?: string[];
}

interface TeacherCardProps {
  teacher: TeacherInfo;
  variant?: "compact" | "detailed" | "action";
  showActions?: boolean;
  onViewDetails?: () => void;
  onAssignTask?: () => void;
  className?: string;
}

export function TeacherCard({
  teacher,
  variant = "detailed",
  showActions = true,
  onViewDetails,
  onAssignTask,
  className,
}: TeacherCardProps) {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getPerformanceColor = (value?: number) => {
    if (!value) return "text-muted-foreground";
    if (value >= 75) return "text-green-600";
    if (value >= 60) return "text-amber-600";
    return "text-red-600";
  };

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border bg-card",
          onViewDetails && "cursor-pointer hover:bg-muted/50",
          className
        )}
        onClick={onViewDetails}
      >
        <Avatar className="h-10 w-10">
          <AvatarImage src={teacher.photoUrl} alt={teacher.name} />
          <AvatarFallback className="bg-primary/10 text-primary text-xs">
            {getInitials(teacher.name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{teacher.name}</p>
          {teacher.subjects && teacher.subjects.length > 0 && (
            <p className="text-xs text-muted-foreground truncate">
              {teacher.subjects.join(", ")}
            </p>
          )}
        </div>

        {teacher.classAverage !== undefined && (
          <span className={cn("font-semibold", getPerformanceColor(teacher.classAverage))}>
            {teacher.classAverage.toFixed(0)}%
          </span>
        )}

        {onViewDetails && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
    );
  }

  if (variant === "action") {
    return (
      <Card className={cn("overflow-hidden", className)}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={teacher.photoUrl} alt={teacher.name} />
              <AvatarFallback className="bg-primary/10 text-primary">
                {getInitials(teacher.name)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-semibold truncate">{teacher.name}</h4>
                {teacher.status && <StatusBadge status={teacher.status} size="sm" />}
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-3">
                {teacher.subjects && (
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />
                    {teacher.subjects.join(", ")}
                  </span>
                )}
                {teacher.classes && (
                  <span className="flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    {teacher.classes.length} classes
                  </span>
                )}
              </div>

              {/* Action items */}
              {teacher.actionItems && teacher.actionItems.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {teacher.actionItems.slice(0, 3).map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs p-2 rounded bg-muted/50"
                    >
                      <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-4 text-sm">
                {teacher.studentsNeedingAttention !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-red-500" />
                    <span className="text-red-600 font-medium">
                      {teacher.studentsNeedingAttention}
                    </span>
                    <span className="text-muted-foreground text-xs">need attention</span>
                  </div>
                )}

                {teacher.trend && (
                  <TrendIndicator trend={teacher.trend} size="sm" showLabel />
                )}
              </div>
            </div>
          </div>

          {showActions && (
            <div className="flex gap-2 mt-4 pt-3 border-t">
              <Button variant="outline" size="sm" className="flex-1" onClick={onViewDetails}>
                View Details
              </Button>
              <Button variant="default" size="sm" className="flex-1" onClick={onAssignTask}>
                Assign Task
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Detailed variant (default)
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={teacher.photoUrl} alt={teacher.name} />
            <AvatarFallback className="bg-primary/10 text-primary">
              {getInitials(teacher.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <CardTitle className="text-lg">{teacher.name}</CardTitle>
            {teacher.subjects && teacher.subjects.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {teacher.subjects.join(", ")}
              </p>
            )}
          </div>

          {teacher.status && <StatusBadge status={teacher.status} />}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {teacher.classAverage !== undefined && (
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground">Class Average</p>
              <p className={cn("text-xl font-bold", getPerformanceColor(teacher.classAverage))}>
                {teacher.classAverage.toFixed(0)}%
              </p>
            </div>
          )}

          {teacher.studentsCount !== undefined && (
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground">Total Students</p>
              <p className="text-xl font-bold">{teacher.studentsCount}</p>
            </div>
          )}

          {teacher.studentsNeedingAttention !== undefined && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 text-center">
              <p className="text-xs text-muted-foreground">Need Attention</p>
              <p className="text-xl font-bold text-red-600">
                {teacher.studentsNeedingAttention}
              </p>
            </div>
          )}

          {teacher.effectiveness !== undefined && (
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground">Effectiveness</p>
              <div className="flex items-center justify-center gap-1">
                <p className={cn("text-xl font-bold", getPerformanceColor(teacher.effectiveness))}>
                  {teacher.effectiveness.toFixed(0)}%
                </p>
                {teacher.trend && <TrendIndicator trend={teacher.trend} size="sm" />}
              </div>
            </div>
          )}
        </div>

        {/* Classes */}
        {teacher.classes && teacher.classes.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Classes</p>
            <div className="flex flex-wrap gap-1.5">
              {teacher.classes.map((cls, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {cls}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {showActions && (
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onViewDetails}>
              View Analytics
            </Button>
            <Button variant="default" size="sm" className="flex-1" onClick={onAssignTask}>
              Assign Task
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Teacher list for grids
export function TeacherGrid({
  teachers,
  variant = "compact",
  columns = 2,
  onTeacherClick,
  className,
}: {
  teachers: TeacherInfo[];
  variant?: "compact" | "detailed" | "action";
  columns?: 1 | 2 | 3 | 4;
  onTeacherClick?: (teacher: TeacherInfo) => void;
  className?: string;
}) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {teachers.map((teacher) => (
        <TeacherCard
          key={teacher.id}
          teacher={teacher}
          variant={variant}
          onViewDetails={() => onTeacherClick?.(teacher)}
        />
      ))}
    </div>
  );
}
