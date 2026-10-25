import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface LearningAction {
  id: string;
  student_id: string;
  institution_id: string;
  class_id: string | null;
  action_type: "revision" | "practice" | "retest" | "study_material";
  title: string;
  description: string | null;
  topic_id: string | null;
  subject_id: string | null;
  priority: number;
  source: "auto" | "teacher";
  source_exam_id: string | null;
  status: "pending" | "approved" | "assigned" | "completed" | "declined";
  approved_by: string | null;
  approved_at: string | null;
  assigned_at: string | null;
  due_date: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Joined data
  student?: { full_name: string; email: string };
  topic?: { topic_name: string };
  subject?: { name: string };
  exam?: { title: string };
}

// Fetch pending actions for teacher approval
export function usePendingLearningActions(classId?: string) {
  return useQuery({
    queryKey: ["learning-actions", "pending", classId],
    queryFn: async () => {
      let query = supabase
        .from("learning_actions")
        .select(`
          *,
          student:profiles!learning_actions_student_id_fkey(full_name, email),
          topic:syllabus_topics(topic_name),
          subject:subjects(name),
          exam:exams(title)
        `)
        .eq("status", "pending")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false });

      if (classId) {
        query = query.eq("class_id", classId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as LearningAction[];
    },
    enabled: true,
  });
}

// Fetch student's assigned learning actions
export function useStudentLearningActions() {
  return useQuery({
    queryKey: ["learning-actions", "student"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("learning_actions")
        .select(`
          *,
          topic:syllabus_topics(topic_name),
          subject:subjects(name),
          exam:exams(title)
        `)
        .eq("student_id", user.user.id)
        .in("status", ["approved", "assigned"])
        .order("priority", { ascending: true })
        .order("due_date", { ascending: true });

      if (error) throw error;
      return data as LearningAction[];
    },
  });
}

// Approve a learning action
export function useApproveLearningAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ actionId, dueDate }: { actionId: string; dueDate?: string }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("learning_actions")
        .update({
          status: "assigned",
          approved_by: user.user.id,
          approved_at: new Date().toISOString(),
          assigned_at: new Date().toISOString(),
          due_date: dueDate || null,
        })
        .eq("id", actionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-actions"] });
      toast({
        title: "Action approved",
        description: "Learning action has been assigned to the student.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Decline a learning action
export function useDeclineLearningAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (actionId: string) => {
      const { error } = await supabase
        .from("learning_actions")
        .update({ status: "declined" })
        .eq("id", actionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-actions"] });
      toast({
        title: "Action declined",
        description: "Learning action has been declined.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Complete a learning action (student)
export function useCompleteLearningAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (actionId: string) => {
      const { error } = await supabase
        .from("learning_actions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", actionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-actions"] });
      toast({
        title: "Task completed!",
        description: "Great job on completing this learning task.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Create a learning action (teacher manually)
export function useCreateLearningAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (action: Partial<LearningAction> & { student_id: string; title: string; action_type: string }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.user.id)
        .single();

      const { error } = await supabase
        .from("learning_actions")
        .insert([{
          student_id: action.student_id,
          title: action.title,
          action_type: action.action_type,
          description: action.description,
          topic_id: action.topic_id,
          subject_id: action.subject_id,
          class_id: action.class_id,
          priority: action.priority || 3,
          due_date: action.due_date,
          institution_id: profile?.institution_id,
          source: "teacher",
          status: "assigned",
          approved_by: user.user.id,
          approved_at: new Date().toISOString(),
          assigned_at: new Date().toISOString(),
        }]);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-actions"] });
      toast({
        title: "Action created",
        description: "Learning action has been assigned to the student.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
