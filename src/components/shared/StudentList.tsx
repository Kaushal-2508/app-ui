import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge, StatusType, getStatusFromPercentage } from "./StatusBadge";
import { TrendIndicator, TrendDirection } from "./TrendIndicator";
import { cn } from "@/lib/utils";
import { User, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

export interface StudentInfo {
  id: string;
  name: string;
  className?: string;
  rollNumber?: string;
  photoUrl?: string;
  percentage?: number;
  status?: StatusType;
  trend?: TrendDirection;
  subjects?: { name: string; percentage: number }[];
  issues?: string[];
  priority?: "immediate" | "high" | "monitor";
}

interface StudentListProps {
  students: StudentInfo[];
  title?: string;
  description?: string;
  showStatus?: boolean;
  showTrend?: boolean;
  showPercentage?: boolean;
  showIssues?: boolean;
  maxHeight?: number;
  compact?: boolean;
  onStudentClick?: (student: StudentInfo) => void;
  emptyMessage?: string;
  className?: string;
  groupByPriority?: boolean;
}

export function StudentList({
  students,
  title,
  description,
  showStatus = true,
  showTrend = false,
  showPercentage = true,
  showIssues = false,
  maxHeight = 400,
  compact = false,
  onStudentClick,
  emptyMessage = "No students to display",
  className,
  groupByPriority = false,
}: StudentListProps) {
  const getPriorityColor = (priority?: "immediate" | "high" | "monitor") => {
    switch (priority) {
      case "immediate":
        return "border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20";
      case "high":
        return "border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20";
      case "monitor":
        return "border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20";
      default:
        return "";
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const groupedStudents = groupByPriority
    ? {
        immediate: students.filter((s) => s.priority === "immediate"),
        high: students.filter((s) => s.priority === "high"),
        monitor: students.filter((s) => s.priority === "monitor"),
        other: students.filter((s) => !s.priority),
      }
    : { all: students };

  const renderStudent = (student: StudentInfo) => (
    <div
      key={student.id}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg transition-colors",
        getPriorityColor(student.priority),
        onStudentClick && "cursor-pointer hover:bg-muted/50",
        compact && "p-2"
      )}
      onClick={() => onStudentClick?.(student)}
    >
      <Avatar className={compact ? "h-8 w-8" : "h-10 w-10"}>
        <AvatarImage src={student.photoUrl} alt={student.name} />
        <AvatarFallback className="bg-primary/10 text-primary text-xs">
          {getInitials(student.name)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn("font-medium truncate", compact && "text-sm")}>
            {student.name}
          </p>
          {student.className && (
            <span className="text-xs text-muted-foreground">
              ({student.className})
            </span>
          )}
        </div>

        {showIssues && student.issues && student.issues.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {student.issues.slice(0, 2).map((issue, idx) => (
              <Badge key={idx} variant="outline" className="text-[10px] px-1 py-0">
                {issue}
              </Badge>
            ))}
            {student.issues.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{student.issues.length - 2} more
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {showPercentage && student.percentage !== undefined && (
          <span
            className={cn(
              "font-semibold",
              student.percentage >= 75
                ? "text-green-600"
                : student.percentage >= 50
                ? "text-amber-600"
                : "text-red-600"
            )}
          >
            {student.percentage.toFixed(0)}%
          </span>
        )}

        {showTrend && student.trend && (
          <TrendIndicator trend={student.trend} size="sm" />
        )}

        {showStatus && student.status && (
          <StatusBadge status={student.status} size="sm" />
        )}
      </div>
    </div>
  );

  const content = (
    <ScrollArea className={`h-full max-h-[${maxHeight}px]`}>
      {students.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <User className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">{emptyMessage}</p>
        </div>
      ) : groupByPriority ? (
        <div className="space-y-4">
          {groupedStudents.immediate?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium text-red-600">
                  Immediate Attention ({groupedStudents.immediate.length})
                </span>
              </div>
              <div className="space-y-2">
                {groupedStudents.immediate.map(renderStudent)}
              </div>
            </div>
          )}

          {groupedStudents.high?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium text-amber-600">
                  High Priority ({groupedStudents.high.length})
                </span>
              </div>
              <div className="space-y-2">
                {groupedStudents.high.map(renderStudent)}
              </div>
            </div>
          )}

          {groupedStudents.monitor?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium text-blue-600">
                  Monitor ({groupedStudents.monitor.length})
                </span>
              </div>
              <div className="space-y-2">
                {groupedStudents.monitor.map(renderStudent)}
              </div>
            </div>
          )}

          {groupedStudents.other?.length > 0 && (
            <div className="space-y-2">
              {groupedStudents.other.map(renderStudent)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">{students.map(renderStudent)}</div>
      )}
    </ScrollArea>
  );

  if (!title) {
    return <div className={cn("space-y-2", className)}>{content}</div>;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {students.length > 0 && (
            <Badge variant="secondary">{students.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

// Compact student chip for inline use
export function StudentChip({
  student,
  onClick,
  showPercentage = false,
}: {
  student: StudentInfo;
  onClick?: () => void;
  showPercentage?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted text-sm",
        onClick && "cursor-pointer hover:bg-muted/80"
      )}
      onClick={onClick}
    >
      <span className="truncate max-w-[100px]">{student.name}</span>
      {showPercentage && student.percentage !== undefined && (
        <span
          className={cn(
            "text-xs font-medium",
            student.percentage >= 75
              ? "text-green-600"
              : student.percentage >= 50
              ? "text-amber-600"
              : "text-red-600"
          )}
        >
          {student.percentage.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
