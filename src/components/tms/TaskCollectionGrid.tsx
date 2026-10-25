import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TaskCard } from "./TaskCard";
import { TaskGroupCard } from "./TaskGroupCard";
import { groupTasks, type Task } from "@/hooks/useTasks";

export interface TaskSelection {
  taskId: string;
  /** Non-null when the click came from a collapsed multi-assignee group. */
  groupId: string | null;
}

interface TaskCollectionGridProps {
  tasks: Task[];
  onOpen: (selection: TaskSelection) => void;
  showAssigner?: boolean;
  showAssignee?: boolean;
}

/**
 * Cards mounted per page. The query is already bounded (TASK_LIST_RANGE), but
 * rendering every row at once put 98 cards in one 13,500px page on a phone
 * (2026-09-18 audit); this pages the RENDER, and "Show more" grows it.
 */
const PAGE_SIZE = 24;

/**
 * Renders a task list with multi-assignee groups collapsed into one card each.
 *
 * Grouping runs over whatever slice it is handed, so in a status- or
 * date-scoped tab a group card describes the members in that scope. The detail
 * window always loads the complete group by id, so nothing is hidden there.
 */
export function TaskCollectionGrid({
  tasks,
  onOpen,
  showAssigner = true,
  showAssignee = false,
}: TaskCollectionGridProps) {
  const entries = useMemo(() => groupTasks(tasks), [tasks]);

  const [visible, setVisible] = useState(PAGE_SIZE);
  // A new list (tab or filter change) starts from the first page again.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [tasks]);

  const shown = entries.slice(0, visible);
  const remaining = entries.length - shown.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((entry) =>
          entry.kind === "group" ? (
            <TaskGroupCard
              key={entry.groupId}
              group={entry}
              showAssigner={showAssigner}
              onClick={() =>
                onOpen({ taskId: entry.lead.id, groupId: entry.groupId })
              }
            />
          ) : (
            <TaskCard
              key={entry.task.id}
              task={entry.task}
              showAssigner={showAssigner}
              showAssignee={showAssignee}
              onClick={() => onOpen({ taskId: entry.task.id, groupId: null })}
            />
          ),
        )}
      </div>
      {remaining > 0 && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="h-10 rounded-full px-5"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
          >
            <ChevronDown className="mr-1.5 h-4 w-4" />
            Show {Math.min(remaining, PAGE_SIZE)} more
          </Button>
        </div>
      )}
    </div>
  );
}
