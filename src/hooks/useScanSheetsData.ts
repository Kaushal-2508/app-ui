import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchExamEligibleStudentIds } from "@/lib/examEligibility";
import { useToast } from "@/hooks/use-toast";
import { getDisplayName } from "@/lib/displayName";
import { sortStudentRoster } from "@/lib/studentIdentity";

interface PendingExam {
  id: string;
  title: string;
  scheduled_date: string | null;
  total_marks: number | null;
  status: string;
  classes: Array<{
    class_id: string;
    class_name: string;
    section: string | null;
    total_students: number;
    scanned_count: number;
    evaluated_count: number;
  }>;
}

interface StudentWithScore {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  admission_number: string | null;
  scan_status: "not_scanned" | "pending_ocr" | "ocr_complete" | "ai_graded" | "teacher_reviewed";
  upload_id: string | null;
  attempt_id: string | null;
  ai_score: number | null;
  max_marks: number | null;
  avg_confidence: number | null;
  is_finalized: boolean;
}

// Fetch pending offline exams (not yet results published)
export function usePendingOfflineExams() {
  return useQuery({
    queryKey: ["pending-offline-exams"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Get user's institution
      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .single();

      if (!profile?.institution_id) return [];

      // Fetch offline exams that are published/active/completed but not results_published
      const { data: exams, error } = await supabase
        .from("exams")
        .select(`
          id, title, scheduled_date, total_marks, status,
          exam_classes(
            class_id,
            classes(id, name, section)
          )
        `)
        .eq("institution_id", profile.institution_id)
        .eq("exam_mode", "offline")
        .in("status", ["published", "active", "completed"])
        .order("scheduled_date", { ascending: false });

      if (error) throw error;
      if (!exams) return [];

      // For each exam and class, get scanned/evaluated counts
      const enrichedExams: PendingExam[] = [];

      for (const exam of exams) {
        const examClasses = exam.exam_classes || [];
        const classesData: PendingExam["classes"] = [];

        for (const ec of examClasses) {
          const classInfo = ec.classes as { id: string; name: string; section: string | null } | null;
          if (!classInfo) continue;

          // Denominator = the exam's eligible cohort in this class, NOT the
          // raw class headcount. With the headcount, an optional-subject exam
          // could never read as fully scanned or fully evaluated, so progress
          // bars sat permanently short and "complete" never fired.
          const examEligible = await fetchExamEligibleStudentIds(exam.id);
          const { data: classRoster } = await supabase
            .from("class_assignments")
            .select("user_id")
            .eq("class_id", ec.class_id)
            .eq("role", "student")
            .range(0, 999);
          const totalStudents = (classRoster ?? []).filter((r) =>
            examEligible.has(r.user_id as string),
          ).length;

          // Get scanned count (OCR uploads with student matched)
          const { count: scannedCount } = await supabase
            .from("ocr_uploads")
            .select("*", { count: "exact", head: true })
            .eq("exam_id", exam.id)
            .eq("class_id", ec.class_id)
            .not("student_id", "is", null);

        // Get evaluated count (attempts with AI evaluation)
        const { count: evaluatedCount } = await supabase
          .from("student_exam_attempts")
          .select("*", { count: "exact", head: true })
          .eq("exam_id", exam.id)
          .eq("class_id", ec.class_id)
          .in("evaluation_status", ["ai_evaluated", "finalized", "teacher_reviewed"]);

          classesData.push({
            class_id: ec.class_id,
            class_name: classInfo.name,
            section: classInfo.section,
            total_students: totalStudents || 0,
            scanned_count: scannedCount || 0,
            evaluated_count: evaluatedCount || 0,
          });
        }

        enrichedExams.push({
          id: exam.id,
          title: exam.title,
          scheduled_date: exam.scheduled_date,
          total_marks: exam.total_marks,
          status: exam.status,
          classes: classesData,
        });
      }

      return enrichedExams;
    },
  });
}

// Fetch students with their scores for a specific exam/class
export function useExamStudentsWithScores(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["exam-students-scores", examId, classId],
    queryFn: async () => {
      if (!examId || !classId) return [];

      // Get all students in the class
      const { data: students, error: studentsError } = await supabase
        .from("class_assignments")
        .select(`
          user_id,
          profiles!class_assignments_user_id_fkey(id, full_name, roll_number, admission_number)
        `)
        .eq("class_id", classId)
        .eq("role", "student")
        // Explicit bound: PostgREST truncates at 1000 silently.
        .range(0, 999);

      if (studentsError) throw studentsError;
      if (!students) return [];

      // Optional-subject eligibility: this table used to render every class
      // member, marking the ones who don't take the subject "Not Scanned" and
      // offering a marks-edit dialog for them. No-op for compulsory exams.
      const eligibleIds = await fetchExamEligibleStudentIds(examId);
      const eligibleStudents = students.filter((s) =>
        eligibleIds.has(s.user_id as string),
      );

      const result: StudentWithScore[] = [];

      for (const student of eligibleStudents) {
        const profile = student.profiles as {
          id: string;
          full_name: string;
          roll_number: string | null;
          admission_number: string | null;
        } | null;
        if (!profile) continue;

        // Check if sheet is scanned (OCR upload exists)
        const { data: upload } = await supabase
          .from("ocr_uploads")
          .select("id, status, attempt_id")
          .eq("exam_id", examId)
          .eq("class_id", classId)
          .eq("student_id", profile.id)
          .maybeSingle();

        // Check exam attempt status
        const { data: attempt } = await supabase
          .from("student_exam_attempts")
          .select("id, evaluation_status, is_finalized")
          .eq("exam_id", examId)
          .eq("student_id", profile.id)
          .maybeSingle();

        // Get AI evaluation scores if available
        let aiScore: number | null = null;
        let maxMarks: number | null = null;
        let avgConfidence: number | null = null;

        if (attempt) {
          const { data: answers } = await supabase
            .from("student_answers")
            .select(`
              id,
              ai_evaluations(suggested_marks, max_marks, confidence_score),
              teacher_overrides(final_marks, max_marks)
            `)
            .eq("attempt_id", attempt.id);

          if (answers && answers.length > 0) {
            let totalScore = 0;
            let totalMax = 0;
            let totalConfidence = 0;
            let confCount = 0;

            for (const ans of answers) {
              const aiEval = ans.ai_evaluations as { suggested_marks: number; max_marks: number; confidence_score: number } | null;
              const teacherOverride = ans.teacher_overrides as { final_marks: number; max_marks: number } | null;

              if (teacherOverride) {
                totalScore += teacherOverride.final_marks;
                totalMax += teacherOverride.max_marks;
              } else if (aiEval) {
                totalScore += aiEval.suggested_marks;
                totalMax += aiEval.max_marks;
                totalConfidence += aiEval.confidence_score;
                confCount++;
              }
            }

            if (totalMax > 0) {
              aiScore = totalScore;
              maxMarks = totalMax;
            }
            if (confCount > 0) {
              avgConfidence = totalConfidence / confCount;
            }
          }
        }

        // Determine scan status
        let scanStatus: StudentWithScore["scan_status"] = "not_scanned";
        if (upload) {
          if (upload.status === "pending" || upload.status === "processing") {
            scanStatus = "pending_ocr";
          } else if (upload.status === "completed") {
            if (attempt?.evaluation_status === "finalized" || attempt?.is_finalized) {
              scanStatus = "teacher_reviewed";
            } else if (attempt?.evaluation_status === "ai_evaluated" || attempt?.evaluation_status === "teacher_reviewed") {
              scanStatus = "ai_graded";
            } else {
              scanStatus = "ocr_complete";
            }
          }
        }

        result.push({
          student_id: profile.id,
          full_name: getDisplayName(profile),
          roll_number: profile.roll_number,
          admission_number: profile.admission_number,
          scan_status: scanStatus,
          upload_id: upload?.id || null,
          attempt_id: attempt?.id || null,
          ai_score: aiScore,
          max_marks: maxMarks,
          avg_confidence: avgConfidence,
          is_finalized: attempt?.is_finalized || false,
        });
      }

      // Single class, so one block: roll order only when every student here is
      // numbered, alphabetical (ERP order) otherwise.
      return sortStudentRoster(result, {
        getRoll: (r) => r.roll_number,
        getName: (r) => r.full_name,
      });
    },
    enabled: !!examId && !!classId,
  });
}

// Bulk AI evaluate all scanned sheets
export function useBulkAIEvaluate() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ examId, classId }: { examId: string; classId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get all attempts that need evaluation
      const { data: attempts, error } = await supabase
        .from("student_exam_attempts")
        .select("id, evaluation_status")
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .eq("is_submitted", true)
        .in("evaluation_status", ["pending"]);

      if (error) throw error;

      const results = [];
      for (const attempt of attempts || []) {
        try {
          const { data, error: fnError } = await supabase.functions.invoke("auto-grade-submission", {
            body: { attempt_id: attempt.id, grader_id: user.id },
          });

          if (fnError) throw fnError;
          results.push({ attemptId: attempt.id, success: true, data });
        } catch (err) {
          console.error("Failed to grade attempt:", attempt.id, err);
          results.push({ attemptId: attempt.id, success: false, error: err });
        }
      }

      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter((r) => r.success).length;
      toast({
        title: "AI Evaluation Complete",
        description: `Successfully evaluated ${successCount}/${results.length} submissions`,
      });
      queryClient.invalidateQueries({ queryKey: ["exam-students-scores"] });
      queryClient.invalidateQueries({ queryKey: ["pending-offline-exams"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Evaluation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Publish offline exam results
export function usePublishOfflineResults() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ examId, classId }: { examId: string; classId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get all attempts that need publishing
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select("id")
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .eq("is_submitted", true);

      if (!attempts || attempts.length === 0) {
        throw new Error("No submitted attempts found to publish");
      }

      // Step 1: For each attempt, auto-create missing teacher_overrides from AI evaluations
      for (const attempt of attempts) {
        // Find answers with AI evaluations but no teacher overrides
        const { data: answersNeedingOverrides } = await supabase
          .from("student_answers")
          .select(`
            id,
            ai_evaluations(suggested_marks, max_marks, feedback_suggestion, evaluation_reasoning)
          `)
          .eq("attempt_id", attempt.id);

        for (const ans of answersNeedingOverrides || []) {
          const aiEval = ans.ai_evaluations as {
            suggested_marks: number;
            max_marks: number;
            feedback_suggestion: string | null;
            evaluation_reasoning: string | null;
          } | null;

          if (!aiEval) continue;

          // Check if teacher_override already exists
          const { data: existingOverride } = await supabase
            .from("teacher_overrides")
            .select("id")
            .eq("answer_id", ans.id)
            .maybeSingle();

          if (existingOverride) continue;

          // Create teacher_override from AI evaluation
          await supabase.from("teacher_overrides").insert({
            answer_id: ans.id,
            evaluated_by: user.id,
            final_marks: aiEval.suggested_marks,
            max_marks: aiEval.max_marks,
            teacher_feedback: aiEval.feedback_suggestion || "Auto-accepted from AI evaluation",
            internal_notes: `Auto-accepted during publish: ${aiEval.evaluation_reasoning || ""}`,
            is_auto_graded: true,
            accepted_ai_suggestion: true,
          });
        }
      }

      // Step 2: Finalize all attempts (trigger will now pass since all answers have overrides)
      const { error: attemptError } = await supabase
        .from("student_exam_attempts")
        .update({ 
          is_finalized: true,
          evaluation_status: "finalized",
        })
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .eq("is_submitted", true);

      if (attemptError) throw attemptError;

      for (const attempt of attempts || []) {
        // Calculate total marks
        const { data: answers } = await supabase
          .from("student_answers")
          .select(`
            ai_evaluations(suggested_marks, max_marks),
            teacher_overrides(final_marks, max_marks)
          `)
          .eq("attempt_id", attempt.id);

        let totalObtained = 0;
        let totalMax = 0;

        for (const ans of answers || []) {
          const teacherOverride = ans.teacher_overrides as { final_marks: number; max_marks: number } | null;
          const aiEval = ans.ai_evaluations as { suggested_marks: number; max_marks: number } | null;

          if (teacherOverride) {
            totalObtained += teacherOverride.final_marks;
            totalMax += teacherOverride.max_marks;
          } else if (aiEval) {
            totalObtained += aiEval.suggested_marks;
            totalMax += aiEval.max_marks;
          }
        }

        // Upsert final result.
        //
        // `percentage` is a GENERATED ALWAYS ... STORED column (CLAUDE.md §9).
        // Including it makes Postgres reject the whole row with "cannot insert a
        // non-DEFAULT value into column percentage", and because the error used
        // to be discarded here, this publish path reported success while writing
        // NOTHING. Never send percentage, and never swallow the error.
        const { error: resultError } = await supabase.from("final_results").upsert({
          attempt_id: attempt.id,
          total_marks_obtained: totalObtained,
          total_max_marks: totalMax,
          finalized_by: user.id,
          finalized_at: new Date().toISOString(),
          is_published: true,
          published_at: new Date().toISOString(),
          published_by: user.id,
        }, { onConflict: "attempt_id" });

        if (resultError) throw resultError;
      }

      // Check if all classes are published, then update exam status
      const { data: exam } = await supabase
        .from("exams")
        .select("id, exam_classes(class_id)")
        .eq("id", examId)
        .single();

      if (exam) {
        const allClassIds = exam.exam_classes?.map((ec: { class_id: string }) => ec.class_id) || [];
        
        // Check if all classes have published results
        const { count: publishedCount } = await supabase
          .from("student_exam_attempts")
          .select("*", { count: "exact", head: true })
          .eq("exam_id", examId)
          .eq("is_finalized", true)
          .in("class_id", allClassIds);

        const { count: totalAttempts } = await supabase
          .from("student_exam_attempts")
          .select("*", { count: "exact", head: true })
          .eq("exam_id", examId)
          .in("class_id", allClassIds);

        if (publishedCount === totalAttempts && totalAttempts && totalAttempts > 0) {
          // All results published, update exam status
          await supabase
            .from("exams")
            .update({ status: "completed" })
            .eq("id", examId);
        }
      }

      return { success: true };
    },
    onSuccess: () => {
      toast({ title: "Results Published Successfully" });
      queryClient.invalidateQueries({ queryKey: ["pending-offline-exams"] });
      queryClient.invalidateQueries({ queryKey: ["exam-students-scores"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Publish Results",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Update student marks (teacher intervention)
export function useUpdateStudentMarks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      answerId,
      marks,
      feedback,
    }: {
      answerId: string;
      marks: number;
      feedback?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get answer details for max marks
      const { data: answer } = await supabase
        .from("student_answers")
        .select(`
          id,
          question_id,
          exam_questions!student_answers_question_id_fkey(marks)
        `)
        .eq("id", answerId)
        .single();

      if (!answer) throw new Error("Answer not found");

      const maxMarks = (answer.exam_questions as { marks: number } | null)?.marks || 0;

      // Upsert teacher override
      const { error } = await supabase.from("teacher_overrides").upsert({
        answer_id: answerId,
        evaluated_by: user.id,
        final_marks: marks,
        max_marks: maxMarks,
        feedback_to_student: feedback || "",
        is_ai_accepted: false,
      }, { onConflict: "answer_id" });

      if (error) throw error;

      return { success: true };
    },
    onSuccess: () => {
      toast({ title: "Marks Updated" });
      queryClient.invalidateQueries({ queryKey: ["exam-students-scores"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Marks",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
