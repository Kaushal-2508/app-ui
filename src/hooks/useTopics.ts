import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Fetch topics by subjects and grade (from classes)
export function useTopicsBySubjectsAndGrades(subjectIds: string[], classIds: string[]) {
  return useQuery({
    queryKey: ["topics-by-subjects-grades", subjectIds, classIds],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];

      // Fetch topics that match these subjects
      const { data: topics, error } = await supabase
        .from("syllabus_topics")
        .select(`
          id,
          topic_name,
          sub_topics,
          learning_outcomes,
          subject_id,
          grade_level_id,
          universal_subjects!inner(id, name, code),
          grade_levels!inner(id, grade_name, grade_number)
        `)
        .in("subject_id", subjectIds)
        .eq("is_active", true)
        .order("display_order");

      if (error) throw error;
      return topics || [];
    },
    enabled: subjectIds.length > 0,
  });
}

// Fetch school custom topics
export function useSchoolCustomTopics(institutionId: string | null, subjectIds: string[]) {
  return useQuery({
    queryKey: ["school-custom-topics", institutionId, subjectIds],
    queryFn: async () => {
      if (!institutionId || subjectIds.length === 0) return [];

      const { data, error } = await supabase
        .from("school_custom_topics")
        .select(`
          id,
          topic_name,
          description,
          subject_id,
          grade_level_id,
          universal_subjects!inner(id, name, code),
          grade_levels!inner(id, grade_name)
        `)
        .eq("institution_id", institutionId)
        .in("subject_id", subjectIds)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!institutionId && subjectIds.length > 0,
  });
}

// Add custom topic mutation
export function useAddCustomTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topic: {
      institutionId: string;
      subjectId: string;
      gradeLevelId: string;
      topicName: string;
      description?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("school_custom_topics")
        .insert({
          institution_id: topic.institutionId,
          subject_id: topic.subjectId,
          grade_level_id: topic.gradeLevelId,
          topic_name: topic.topicName,
          description: topic.description || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["school-custom-topics"] });
      toast.success("Custom topic added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add custom topic");
    },
  });
}

// Fetch grade levels
export function useGradeLevels() {
  return useQuery({
    queryKey: ["grade-levels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number")
        .eq("is_active", true)
        .order("display_order");

      if (error) throw error;
      return data || [];
    },
  });
}
