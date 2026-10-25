import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { TaskTypeBadge } from "./TaskTypeBadge";
import type { TaskGroupEntry } from "@/hooks/useTasks";
import { CalendarDays, Clock, User, Users } from "lucide-react";
import { formatDistanceToNow, format, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import { isNativePlatform } from "@/lib/native";

/** How many avatars to show before collapsing the rest into a +N chip. */
const MAX_AVATARS = 4;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

interface TaskGroupCardProps {
  group: TaskGroupEntry;
  onClick?: () => void;
  showAssigner?: boolean;
}

/**
 * One card standing in for a whole multi-assignee group.
 *
 * Deliberately has no inline action buttons: every action on a group is
 * per-person, so they live inside the detail window where the person they
 * apply to is unambiguous.
 */
export function TaskGroupCard({ group, onClick, showAssigner = true }: TaskGroupCardProps) {
  const { lead, members, counts, completedCount, cancelledCount, rollupStatus } = group;
  const total = members.length;
  const percent = Math.round((completedCount / total) * 100);

  // Only speak for the group when everyone actually shares a title.
  const sharedTitle = members.every((m) => m.title === lead.title) ? lead.title : null;

  const isOverdue = Boolean(
    lead.due_date && isPast(new Date(lead.due_date)) && completedCount < total,
  );

  const lastUpdated = members.reduce(
    (latest, m) => (new Date(m.updated_at) > new Date(latest) ? m.updated_at : latest),
    lead.updated_at,
  );

  const visible = members.slice(0, MAX_AVATARS);
  const overflow = total - visible.length;

  const breakdown = [
    counts.completed > 0 ? `${counts.completed} done` : null,
    counts.done_pending_approval > 0 ? `${counts.done_pending_approval} awaiting approval` : null,
    counts.in_progress > 0 ? `${counts.in_progress} in progress` : null,
    counts.rejected > 0 ? `${counts.rejected} in rework` : null,
    counts.open > 0 ? `${counts.open} not started` : null,
    // Paused members keep their underlying status, so they are also counted
    // above. Called out separately because it changes what anyone can do.
    cancelledCount > 0 ? `${cancelledCount} paused` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md hover:border-primary/20",
        isOverdue && "border-destructive/50",
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium line-clamp-2">
            {sharedTitle ?? lead.title}
          </CardTitle>
          <TaskStatusBadge status={rollupStatus} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <TaskTypeBadge type={lead.task_type} />
          {lead.priority === 1 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              High Priority
            </span>
          )}
          <Badge variant="secondary" className="text-xs">
            <Users className="h-3 w-3 mr-1" />
            {total} assignees
          </Badge>
        </div>

        {sharedTitle === null && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            Each person has their own brief on this task.
          </p>
        )}
        {sharedTitle !== null && lead.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {lead.description}
          </p>
        )}

        <div className="space-y-2">
          <Progress value={percent} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            {completedCount} of {total} completed
            {breakdown ? ` · ${breakdown}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {visible.map((member) => (
            <Avatar
              key={member.id}
              className="h-6 w-6 border border-background"
              title={member.assignee_profile?.full_name ?? undefined}
            >
              <AvatarFallback className="text-[10px]">
                {initialsOf(member.assignee_profile?.full_name ?? "?")}
              </AvatarFallback>
            </Avatar>
          ))}
          {overflow > 0 && (
            <span className="text-xs text-muted-foreground ml-1">+{overflow}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {showAssigner && lead.assigner_profile && (
            <div className="flex min-w-0 items-center gap-1">
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {isNativePlatform()
                  ? `From ${lead.assigner_profile.full_name}`
                  : `From: ${lead.assigner_profile.full_name}`}
              </span>
            </div>
          )}

          {lead.due_date && (
            <div
              className={cn(
                "flex items-center gap-1",
                isOverdue && "text-destructive font-medium",
              )}
            >
              <CalendarDays className="h-3 w-3 shrink-0" />
              <span>
                {isNativePlatform() ? "Due " : "Due: "}
                {format(new Date(lead.due_date), "MMM d, yyyy")}
              </span>
            </div>
          )}

          {/* Same trim as TaskCard: the relative "Updated" line is web only. */}
          {!isNativePlatform() && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>
                Updated {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
