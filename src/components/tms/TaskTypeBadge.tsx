import { Badge } from "@/components/ui/badge";
import type { TaskType } from "@/hooks/useTasks";
import { FileText, BookOpen, Users, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";

const typeConfig: Record<TaskType, { label: string; icon: typeof FileText; className: string }> = {
  exam_related: {
    label: "Exam",
    icon: FileText,
    className: "bg-purple-100 text-purple-700",
  },
  academic_content: {
    label: "Academic",
    icon: BookOpen,
    className: "bg-blue-100 text-blue-700",
  },
  student_support: {
    label: "Student Support",
    icon: Users,
    className: "bg-teal-100 text-teal-700",
  },
  administrative: {
    label: "Admin",
    icon: Briefcase,
    className: "bg-gray-100 text-gray-700",
  },
  general: {
    label: "General",
    icon: FileText,
    className: "bg-orange-100 text-orange-700",
  },
};

/** Enum order, as the board's "group by type" lanes want it. */
export const TASK_TYPE_ORDER = Object.keys(typeConfig) as TaskType[];

export function taskTypeLabel(type: TaskType): string {
  return typeConfig[type]?.label ?? type;
}

interface TaskTypeBadgeProps {
  type: TaskType;
  showIcon?: boolean;
  className?: string;
}

export function TaskTypeBadge({ type, showIcon = true, className }: TaskTypeBadgeProps) {
  const config = typeConfig[type];
  const Icon = config.icon;
  
  return (
    <Badge variant="outline" className={cn(config.className, "gap-1", className)}>
      {showIcon && <Icon className="h-3 w-3" />}
      {config.label}
    </Badge>
  );
}
