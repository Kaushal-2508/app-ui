import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sortStudentRoster } from "@/lib/studentIdentity";

export interface UploadWithMatching {
  id: string;
  fileName: string;
  fileUrl: string;
  status: string;
  studentId: string | null;
  studentName: string | null;
  attemptId: string | null;
  createdAt: string;
}

export interface StudentForMatching {
  id: string;
  fullName: string;
  email: string;
  rollNumber: string | null;
  admissionNumber: string | null;
  hasAttempt: boolean;
}

/**
 * Fetch uploads for an exam/class with student matching info
 */
export function useUploadsWithMatching(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["uploads-with-matching", examId, classId],
    queryFn: async (): Promise<UploadWithMatching[]> => {
      if (!examId || !classId) return [];

      const { data, error } = await supabase
        .from("ocr_uploads")
        .select(`
          id,
          file_name,
          file_url,
          status,
          student_id,
          attempt_id,
          created_at,
          profiles!ocr_uploads_student_id_fkey (full_name)
        `)
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((u) => ({
        id: u.id,
        fileName: u.file_name,
        fileUrl: u.file_url,
        status: u.status,
        studentId: u.student_id,
        studentName: (u.profiles as { full_name: string } | null)?.full_name || null,
        attemptId: u.attempt_id,
        createdAt: u.created_at,
      }));
    },
    enabled: !!examId && !!classId,
  });
}

/**
 * Fetch students in a class for matching dropdown
 */
export function useStudentsForMatching(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["students-for-matching", examId, classId],
    queryFn: async (): Promise<StudentForMatching[]> => {
      if (!classId) return [];

      // Get students assigned to this class
      const { data: assignments, error: assignError } = await supabase
        .from("class_assignments")
        .select(`
          user_id,
          profiles!class_assignments_user_id_fkey (id, full_name, email, roll_number, admission_number)
        `)
        .eq("class_id", classId)
        .eq("role", "student");

      if (assignError) throw assignError;

      // Get existing attempts for this exam to mark who already has one
      let existingAttempts: string[] = [];
      if (examId) {
        const { data: attempts } = await supabase
          .from("student_exam_attempts")
          .select("student_id")
          .eq("exam_id", examId)
          .eq("class_id", classId);
        existingAttempts = attempts?.map((a) => a.student_id) || [];
      }

      const mapped = (assignments || [])
        .filter((a) => a.profiles)
        .map((a) => {
          const profile = a.profiles as {
            id: string;
            full_name: string;
            email: string;
            roll_number: string | null;
            admission_number: string | null;
          };
          return {
            id: profile.id,
            fullName: profile.full_name,
            email: profile.email,
            rollNumber: profile.roll_number,
            admissionNumber: profile.admission_number,
            hasAttempt: existingAttempts.includes(profile.id),
          };
        });

      // Roll order matches the physical stack of sheets a marker works through,
      // but only once the whole class is numbered; until then the school ERP
      // order (alphabetical) is what the marker is holding.
      return sortStudentRoster(mapped, {
        getRoll: (s) => s.rollNumber,
        getName: (s) => s.fullName,
      });
    },
    enabled: !!classId,
  });
}

/**
 * Match a student to an upload and create offline attempt
 */
export function useMatchStudentToUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      uploadId,
      studentId,
      examId,
      classId,
    }: {
      uploadId: string;
      studentId: string;
      examId: string;
      classId: string;
    }) => {
      // 1. Check if student already has an attempt for this exam
      const { data: existingAttempt } = await supabase
        .from("student_exam_attempts")
        .select("id")
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .maybeSingle();

      let attemptId = existingAttempt?.id;

      // 2. If no attempt exists, create one for offline mode
      if (!attemptId) {
        const { data: newAttempt, error: attemptError } = await supabase
          .from("student_exam_attempts")
          .insert({
            exam_id: examId,
            student_id: studentId,
            class_id: classId,
            is_submitted: true,
            submitted_at: new Date().toISOString(),
            is_offline: true,
            evaluation_status: "pending",
          })
          .select("id")
          .single();

        if (attemptError) throw attemptError;
        attemptId = newAttempt.id;
      }

      // 3. Update the upload with student_id and attempt_id
      const { error: updateError } = await supabase
        .from("ocr_uploads")
        .update({
          student_id: studentId,
          attempt_id: attemptId,
        })
        .eq("id", uploadId);

      if (updateError) throw updateError;

      return { uploadId, studentId, attemptId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads-with-matching"] });
      queryClient.invalidateQueries({ queryKey: ["students-for-matching"] });
      toast.success("Student matched successfully");
    },
    onError: (error) => {
      toast.error("Failed to match student: " + (error as Error).message);
    },
  });
}

/**
 * Unmatch a student from an upload
 */
export function useUnmatchStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (uploadId: string) => {
      const { error } = await supabase
        .from("ocr_uploads")
        .update({
          student_id: null,
          attempt_id: null,
        })
        .eq("id", uploadId);

      if (error) throw error;
      return uploadId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads-with-matching"] });
      queryClient.invalidateQueries({ queryKey: ["students-for-matching"] });
      toast.success("Match removed");
    },
    onError: (error) => {
      toast.error("Failed to remove match: " + (error as Error).message);
    },
  });
}

/**
 * Bulk match students to uploads
 */
export function useBulkMatchStudents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      matches,
      examId,
      classId,
    }: {
      matches: Array<{ uploadId: string; studentId: string }>;
      examId: string;
      classId: string;
    }) => {
      const results = [];

      for (const match of matches) {
        // Create attempt if needed
        const { data: existingAttempt } = await supabase
          .from("student_exam_attempts")
          .select("id")
          .eq("exam_id", examId)
          .eq("student_id", match.studentId)
          .maybeSingle();

        let attemptId = existingAttempt?.id;

        if (!attemptId) {
          const { data: newAttempt, error: attemptError } = await supabase
            .from("student_exam_attempts")
            .insert({
              exam_id: examId,
              student_id: match.studentId,
              class_id: classId,
              is_submitted: true,
              submitted_at: new Date().toISOString(),
              is_offline: true,
              evaluation_status: "pending",
            })
            .select("id")
            .single();

          if (attemptError) throw attemptError;
          attemptId = newAttempt.id;
        }

        // Update upload
        const { error: updateError } = await supabase
          .from("ocr_uploads")
          .update({
            student_id: match.studentId,
            attempt_id: attemptId,
          })
          .eq("id", match.uploadId);

        if (updateError) throw updateError;

        results.push({ ...match, attemptId });
      }

      return results;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["uploads-with-matching"] });
      queryClient.invalidateQueries({ queryKey: ["students-for-matching"] });
      toast.success(`${data.length} students matched successfully`);
    },
    onError: (error) => {
      toast.error("Bulk match failed: " + (error as Error).message);
    },
  });
}
