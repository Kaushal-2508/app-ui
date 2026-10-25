import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ListPlus, UserCog, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Flag } from "@/hooks/dashboard/types";
import { useFlagActions } from "@/hooks/dashboard/useFlagActions";
import { cn } from "@/lib/utils";

import { AssigneePickerSheet } from "./AssigneePickerSheet";
import { severityDot, statusChip } from "./flagLifecycle";

export interface FlagCardProps {
  flag: Flag;
  institutionId?: string | null;
}

/**
 * One flag in the feed: severity dot + status chip + plain title + 2-line
 * description + an optional "View" link. Actions depend on lifecycle:
 * - no task (red)  → "Create a task" (auto-resolves the assignee server-side).
 * - task (amber/blue) → "Give to someone else" (reassign picker) + "Cancel task".
 * Mutations come from `useFlagActions`; the assignee picker is a `MobileSheet`.
 */
export function FlagCard({ flag, institutionId }: FlagCardProps) {
  const navigate = useNavigate();
  const { createTask, reassignTask, cancelTask } = useFlagActions();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const chip = statusChip(flag.status);
  const hasTask = flag.task_id != null;
  const busy = createTask.isPending || reassignTask.isPending || cancelTask.isPending;

  const handleReassign = (assigneeId: string) => {
    reassignTask.mutate(
      { flagId: flag.id, assigneeId },
      { onSuccess: () => setPickerOpen(false) },
    );
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border border-surface-stroke/60 p-3">
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", severityDot(flag.severity))}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink-900">{flag.title}</p>
          <Badge variant="secondary" className={cn("border-transparent", chip.className)}>
            {chip.label}
          </Badge>
        </div>

        {flag.description && (
          <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{flag.description}</p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {flag.link_url && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-brand-primary hover:text-brand-primary"
              onClick={() => navigate(flag.link_url as string)}
            >
              View
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}

          {!hasTask ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={busy}
              onClick={() => createTask.mutate({ flagId: flag.id })}
            >
              <ListPlus className="mr-1 h-3.5 w-3.5" />
              Create a task
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy}
                onClick={() => setPickerOpen(true)}
              >
                <UserCog className="mr-1 h-3.5 w-3.5" />
                Give to someone else
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-ink-500 hover:text-destructive"
                disabled={busy}
                onClick={() => cancelTask.mutate({ flagId: flag.id })}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel task
              </Button>
            </>
          )}
        </div>
      </div>

      {hasTask && (
        <AssigneePickerSheet
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          institutionId={institutionId}
          currentAssigneeId={flag.assignee_id}
          onSelect={handleReassign}
          loading={reassignTask.isPending}
        />
      )}
    </div>
  );
}
