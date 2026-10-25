import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ConceptMastery {
  id: string;
  student_id: string;
  topic_id: string;
  subject_id: string;
  institution_id: string;
  mastery_level: number;
  total_questions_attempted: number;
  total_questions_correct: number;
  avg_time_per_question_seconds: number | null;
  trend: "improving" | "declining" | "stable";
  last_exam_id: string | null;
  last_updated: string;
  created_at: string;
  // Joined data
  topic?: { topic_name: string };
  subject?: { name: string };
  student?: { full_name: string };
}

// Fetch concept mastery for a student
export function useStudentConceptMastery(studentId?: string) {
  return useQuery({
    queryKey: ["concept-mastery", "student", studentId],
    queryFn: async () => {
      const userId = studentId || (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error("No user ID");

      const { data, error } = await supabase
        .from("concept_mastery")
        .select(`
          *,
          topic:syllabus_topics(topic_name),
          subject:subjects(name)
        `)
        .eq("student_id", userId)
        .order("mastery_level", { ascending: true });

      if (error) throw error;
      return data as ConceptMastery[];
    },
    enabled: true,
  });
}

// Fetch weak concepts (mastery < 50%)
export function useWeakConcepts(studentId?: string) {
  return useQuery({
    queryKey: ["concept-mastery", "weak", studentId],
    queryFn: async () => {
      const userId = studentId || (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error("No user ID");

      const { data, error } = await supabase
        .from("concept_mastery")
        .select(`
          *,
          topic:syllabus_topics(topic_name),
          subject:subjects(name)
        `)
        .eq("student_id", userId)
        .lt("mastery_level", 50)
        .order("mastery_level", { ascending: true });

      if (error) throw error;
      return data as ConceptMastery[];
    },
    enabled: true,
  });
}

// Fetch class-level concept mastery for teachers
export function useClassConceptMastery(classId: string) {
  return useQuery({
    queryKey: ["concept-mastery", "class", classId],
    queryFn: async () => {
      // Get all students in the class
      const { data: students, error: studentsError } = await supabase
        .from("class_assignments")
        .select("user_id")
        .eq("class_id", classId)
        .eq("role", "student");

      if (studentsError) throw studentsError;

      const studentIds = students.map(s => s.user_id);
      
      if (studentIds.length === 0) return [];

      const { data, error } = await supabase
        .from("concept_mastery")
        .select(`
          *,
          topic:syllabus_topics(topic_name),
          subject:subjects(name),
          student:profiles(full_name)
        `)
        .in("student_id", studentIds)
        .order("mastery_level", { ascending: true });

      if (error) throw error;
      return data as ConceptMastery[];
    },
    enabled: !!classId,
  });
}

// Aggregate class mastery by topic
export function useClassTopicMastery(classId: string) {
  return useQuery({
    queryKey: ["concept-mastery", "class-topics", classId],
    queryFn: async () => {
      // Get all students in the class
      const { data: students, error: studentsError } = await supabase
        .from("class_assignments")
        .select("user_id")
        .eq("class_id", classId)
        .eq("role", "student");

      if (studentsError) throw studentsError;

      const studentIds = students.map(s => s.user_id);
      
      if (studentIds.length === 0) return [];

      const { data, error } = await supabase
        .from("concept_mastery")
        .select(`
          topic_id,
          mastery_level,
          topic:syllabus_topics(topic_name),
          subject:subjects(name)
        `)
        .in("student_id", studentIds);

      if (error) throw error;

      // Aggregate by topic
      const topicMap = new Map<string, {
        topic_id: string;
        topic_name: string;
        subject_name: string;
        avg_mastery: number;
        student_count: number;
        struggling_count: number;
      }>();

      data.forEach((cm: any) => {
        const existing = topicMap.get(cm.topic_id);
        if (existing) {
          existing.avg_mastery = (existing.avg_mastery * existing.student_count + cm.mastery_level) / (existing.student_count + 1);
          existing.student_count += 1;
          if (cm.mastery_level < 50) existing.struggling_count += 1;
        } else {
          topicMap.set(cm.topic_id, {
            topic_id: cm.topic_id,
            topic_name: cm.topic?.topic_name || "Unknown",
            subject_name: cm.subject?.name || "Unknown",
            avg_mastery: cm.mastery_level,
            student_count: 1,
            struggling_count: cm.mastery_level < 50 ? 1 : 0,
          });
        }
      });

      return Array.from(topicMap.values()).sort((a, b) => a.avg_mastery - b.avg_mastery);
    },
    enabled: !!classId,
  });
}

// Fetch mastery history for trends
export function useConceptMasteryHistory(masteryId: string) {
  return useQuery({
    queryKey: ["concept-mastery-history", masteryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("concept_mastery_history")
        .select(`
          *,
          exam:exams(title, scheduled_date)
        `)
        .eq("mastery_id", masteryId)
        .order("snapshot_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!masteryId,
  });
}
