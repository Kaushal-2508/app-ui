import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to subscribe to real-time task updates.
 * Automatically invalidates relevant queries when tasks, assignments, evidence, or comments change.
 */
export function useTaskRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Subscribe to tasks table changes
    const tasksChannel = supabase
      .channel("task-realtime-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
        },
        (payload) => {
          console.log("Task change detected:", payload);
          // Invalidate all task-related queries
          queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["tasks-awaiting-approval"] });
          queryClient.invalidateQueries({ queryKey: ["supervising-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["tasks-assigned-by-me"] });
          queryClient.invalidateQueries({ queryKey: ["institution-tasks"] });
          // Prefix invalidation: at most one group is ever open at a time, so
          // there is nothing to narrow down to.
          queryClient.invalidateQueries({ queryKey: ["task-group-detail"] });

          // If we have the task ID, invalidate specific task detail
          if (payload.new && typeof payload.new === 'object' && 'id' in payload.new) {
            queryClient.invalidateQueries({ queryKey: ["task-detail", payload.new.id] });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_assignments",
        },
        (payload) => {
          console.log("Task assignment change detected:", payload);
          queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["tasks-awaiting-approval"] });
          queryClient.invalidateQueries({ queryKey: ["supervising-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["tasks-assigned-by-me"] });
          queryClient.invalidateQueries({ queryKey: ["institution-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["task-group-detail"] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_evidence",
        },
        (payload) => {
          console.log("Task evidence change detected:", payload);
          queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["task-detail"] });
          queryClient.invalidateQueries({ queryKey: ["task-group-detail"] });

          // Invalidate specific task if we have the task_id
          if (payload.new && typeof payload.new === 'object' && 'task_id' in payload.new) {
            queryClient.invalidateQueries({ queryKey: ["task-detail", payload.new.task_id] });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_comments",
        },
        (payload) => {
          console.log("Task comment change detected:", payload);
          // Invalidate specific task comments if we have the task_id
          if (payload.new && typeof payload.new === 'object' && 'task_id' in payload.new) {
            queryClient.invalidateQueries({ queryKey: ["task-comments", payload.new.task_id] });
          }
        }
      )
      .subscribe((status) => {
        console.log("Task realtime subscription status:", status);
      });

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(tasksChannel);
    };
  }, [queryClient]);
}
