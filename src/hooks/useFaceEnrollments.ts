import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getDisplayName } from "@/lib/displayName";

export function useFaceEnrollments(classId: string | null) {
  return useQuery({
    queryKey: ["face-enrollments", classId],
    queryFn: async () => {
      if (!classId) return [];
      // Get students in class, then get their enrollments
      const { data: students, error: studentsError } = await supabase
        .from("class_assignments")
        .select("user_id, profiles!class_assignments_user_id_fkey(id, full_name)")
        .eq("class_id", classId)
        .eq("role", "student");

      if (studentsError) throw studentsError;

      const studentIds = (students || []).map((s: any) => s.user_id);
      if (studentIds.length === 0) return [];

      const { data: enrollments, error: enrollError } = await supabase
        .from("face_enrollments")
        .select("*")
        .in("student_id", studentIds);

      if (enrollError) throw enrollError;

      return (students || []).map((s: any) => ({
        studentId: s.user_id,
        name: getDisplayName(s.profiles),
        enrollment: (enrollments || []).find((e: any) => e.student_id === s.user_id) || null,
      }));
    },
    enabled: !!classId,
  });
}

export function useUpsertFaceEnrollment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      institution_id: string;
      student_id: string;
      face_descriptor: number[];
      photo_url?: string;
    }) => {
      const { error } = await supabase
        .from("face_enrollments")
        .upsert({
          institution_id: params.institution_id,
          student_id: params.student_id,
          face_descriptor: params.face_descriptor,
          photo_url: params.photo_url || null,
          enrolled_by: user!.id,
          is_active: true,
        }, { onConflict: "student_id" });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["face-enrollments"] });
      toast.success("Face enrolled successfully");
    },
    onError: (err: Error) => {
      toast.error("Failed to enroll face: " + err.message);
    },
  });
}
