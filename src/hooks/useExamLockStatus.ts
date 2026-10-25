import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { queryKeys } from "@/lib/queryKeys";

export interface ExamLockStatus {
  examId: string;
  isLockedForEdits: boolean;
  lockedAt: string | null;
  currentVersion: number;
  hasAttempts: boolean;
}

/**
 * Reads is_locked_for_edits + current_version for an exam and whether any
 * student attempts exist. Consumed by VersionWarningModal before entering the
 * editor.
 */
export function useExamLockStatus(examId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.examLockStatus(examId),
    enabled: !!examId,
    queryFn: async (): Promise<ExamLockStatus> => {
      const { data, error } = await supabase
        .from("exams")
        .select("id, is_locked_for_edits, locked_at, current_version")
        .eq("id", examId!)
        .single();
      if (error) throw error;

      const { count } = await supabase
        .from("student_exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", examId!);

      const row = data as unknown as {
        id: string;
        is_locked_for_edits: boolean;
        locked_at: string | null;
        current_version: number;
      };

      return {
        examId: row.id,
        isLockedForEdits: !!row.is_locked_for_edits,
        lockedAt: row.locked_at,
        currentVersion: row.current_version ?? 1,
        hasAttempts: (count ?? 0) > 0,
      };
    },
  });
}

/**
 * Bumps the exam version and clears the lock — called when the teacher
 * confirms the VersionWarningModal and wants to edit an attempted exam.
 */
export function useBumpExamVersion() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (examId: string): Promise<number> => {
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: number | null; error: Error | null }>)("bump_exam_version", {
        _exam_id: examId,
      });
      if (error) throw error;
      return (data as number) ?? 1;
    },
    onSuccess: (_, examId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examLockStatus(examId) });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: "New version started", description: "You can now edit this exam." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to bump version", description: err.message, variant: "destructive" });
    },
  });
}
