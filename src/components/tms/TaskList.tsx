import { TaskCard } from "./TaskCard";
import type { Task } from "@/hooks/useTasks";
import { Skeleton } from "@/components/ui/skeleton";

interface TaskListProps {
  tasks: Task[] | undefined;
  isLoading: boolean;
  onTaskClick: (taskId: string) => void;
  emptyMessage?: string;
  showAssigner?: boolean;
  showAssignee?: boolean;
}

export function TaskList({ 
  tasks, 
  isLoading, 
  onTaskClick, 
  emptyMessage = "No tasks found",
  showAssigner = true,
  showAssignee = false,
}: TaskListProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-4 border rounded-lg space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tasks.map((task) => (
        <TaskCard 
          key={task.id} 
          task={task} 
          onClick={() => onTaskClick(task.id)}
          showAssigner={showAssigner}
          showAssignee={showAssignee}
        />
      ))}
    </div>
  );
}
