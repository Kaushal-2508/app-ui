import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchExamEligibleStudentIds, filterToEligible } from "@/lib/examEligibility";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { getDisplayName } from "@/lib/displayName";
import { sortStudentRoster } from "@/lib/studentIdentity";

export interface ExamResultStudent {
  studentId: string;
  studentName: string;
  rollNo: string | null;
  admissionNo: string | null;
  attemptId: string | null;
  status: "not_checked" | "checked" | "not_attempted";
  evaluationStatus: string | null;
  isFinalized: boolean;
  totalScore: number | null;
  maxMarks: number | null;
  percentage: number | null;
  totalAnswers: number;
  evaluatedAnswers: number;
  proctoringFlags: number;
}

export interface ValidatedResult {
  rank: number;
  studentId: string;
  studentName: string;
  rollNo: string | null;
  admissionNo: string | null;
  attemptId: string;
  totalScore: number;
  maxMarks: number;
  percentage: number;
  grade: string;
  passed: boolean;
  proctoringFlags: number;
}

export interface ExamResultsSummary {
  totalStudents: number;
  attempted: number;
  notAttempted: number;
  checked: number;
  notChecked: number;
  avgScore: number;
  passRate: number;
  highestScore: number;
  lowestScore: number;
}

function getGrade(percentage: number): string {
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B+";
  if (percentage >= 60) return "B";
  if (percentage >= 50) return "C";
  if (percentage >= 40) return "D";
  return "F";
}

export function useExamResultsStudents(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["exam-results-students", examId, classId],
    queryFn: async (): Promise<ExamResultStudent[]> => {
      if (!examId || !classId) return [];

      // Get all students assigned to this class
      const { data: classStudents, error: studentsError } = await supabase
        .from("class_assignments")
        .select("user_id, profiles!class_assignments_user_id_fkey(id, full_name, roll_number, admission_number)")
        .eq("class_id", classId)
        .eq("role", "student")
        // Explicit bound: PostgREST truncates at 1000 silently.
        .range(0, 999);

      if (studentsError) throw studentsError;

      // Get all attempts for this exam
      const { data: attempts, error: attemptsError } = await supabase
        .from("student_exam_attempts")
        .select("id, student_id, is_submitted, is_finalized, evaluation_status, time_spent_seconds")
        .eq("exam_id", examId)
        .eq("class_id", classId);

      if (attemptsError) throw attemptsError;

      // Optional-subject eligibility. This roster used to be the ENTIRE class,
      // so a French exam in a 104-pupil class listed all 104 and stamped the 91
      // who don't take French as "Not Attempted" — and every summary figure
      // (totalStudents, passRate, averages) was computed over that wrong
      // population. No-op for compulsory exams, and for a section that has
      // recorded no optional choices yet (the dormancy fallback), where the
      // eligible set IS the whole class.
      const eligible = await fetchExamEligibleStudentIds(examId);
      // Never hide a student who already has an attempt on this exam: their
      // marks exist and must stay visible even if their choice changed later.
      const withAttempt = new Set((attempts || []).map((a) => a.student_id));
      const { kept: eligibleStudents, removed: ineligibleCount } = filterToEligible(
        ((classStudents || []) as unknown as ClassStudentRow[]),
        (cs) => cs.user_id,
        eligible,
        withAttempt,
      );
      void ineligibleCount;

      // Get exam total marks
      const { data: exam } = await supabase
        .from("exams")
        .select("total_marks, pass_marks, exam_mode")
        .eq("id", examId)
        .single();

      // For each attempt, count answers and evaluated answers
      const attemptIds = (attempts || []).map(a => a.id);
      
      const answerCounts: Record<string, { total: number; evaluated: number; totalScore: number }> = {};
      
      if (attemptIds.length > 0) {
        const { data: answers } = await supabase
          .from("student_answers")
          .select("id, attempt_id, teacher_overrides(id, final_marks)")
          .in("attempt_id", attemptIds);

        for (const answer of answers || []) {
          if (!answerCounts[answer.attempt_id]) {
            answerCounts[answer.attempt_id] = { total: 0, evaluated: 0, totalScore: 0 };
          }
          answerCounts[answer.attempt_id].total++;
          type OverrideJoin = { id: string; final_marks: number | null };
          const overrides = answer.teacher_overrides as unknown as OverrideJoin | OverrideJoin[] | null;
          if (overrides && (Array.isArray(overrides) ? overrides.length > 0 : overrides.id)) {
            answerCounts[answer.attempt_id].evaluated++;
            const finalMarks = Array.isArray(overrides) ? overrides[0]?.final_marks : overrides.final_marks;
            answerCounts[answer.attempt_id].totalScore += (finalMarks || 0);
          }
        }
      }

      // Get proctoring flags if online exam - proctoring_sessions uses attempt_id, not student_id
      const proctoringMap: Record<string, number> = {};
      if (exam?.exam_mode === "online" && attemptIds.length > 0) {
        const { data: sessions } = await supabase
          .from("proctoring_sessions")
          .select("attempt_id, total_events")
          .in("attempt_id", attemptIds);

        // Map attempt_id back to student_id
        const attemptToStudent = new Map((attempts || []).map(a => [a.id, a.student_id]));
        for (const s of sessions || []) {
          const studentId = attemptToStudent.get(s.attempt_id);
          if (studentId) {
            proctoringMap[studentId] = (proctoringMap[studentId] || 0) + (s.total_events || 0);
          }
        }
      }

      // Build student list
      const attemptMap = new Map((attempts || []).map(a => [a.student_id, a]));

      type ClassStudentRow = {
        user_id: string;
        profiles: { id: string; full_name: string | null; roll_number: string | null; admission_number: string | null } | null;
      };
      const rows = eligibleStudents.map((cs) => {
        const profile = cs.profiles;
        const attempt = attemptMap.get(cs.user_id);
        const counts = attempt ? answerCounts[attempt.id] : null;

        let status: "not_checked" | "checked" | "not_attempted" = "not_attempted";
        if (attempt && attempt.is_submitted) {
          if (attempt.is_finalized || attempt.evaluation_status === "finalized") {
            status = "checked";
          } else if (!counts || counts.total === 0) {
            // Submitted with no answers — nothing to evaluate; treat as checked (score = 0)
            // so it doesn't block validation from the unreachable evaluate page.
            status = "checked";
          } else if (counts.evaluated >= counts.total) {
            status = "checked";
          } else {
            status = "not_checked";
          }
        } else if (attempt && !attempt.is_submitted) {
          status = "not_attempted";
        }

        const maxMarks = exam?.total_marks || 0;
        const totalScore = counts?.totalScore || 0;

        return {
          studentId: cs.user_id,
          studentName: getDisplayName(profile),
          rollNo: profile?.roll_number || null,
          admissionNo: profile?.admission_number || null,
          attemptId: attempt?.id || null,
          status,
          evaluationStatus: attempt?.evaluation_status || null,
          isFinalized: attempt?.is_finalized || false,
          totalScore: status === "checked" ? totalScore : null,
          maxMarks: maxMarks,
          percentage: status === "checked" && maxMarks > 0 ? Math.round((totalScore / maxMarks) * 100) : null,
          totalAnswers: counts?.total || 0,
          evaluatedAnswers: counts?.evaluated || 0,
          proctoringFlags: proctoringMap[cs.user_id] || 0,
        };
      });

      // Single section, so one block: roll order only if every student here has
      // a roll number, alphabetical (ERP order) otherwise.
      return sortStudentRoster(rows, {
        getRoll: (r) => r.rollNo,
        getName: (r) => r.studentName,
      });
    },
    enabled: !!examId && !!classId,
    staleTime: 30_000,
    // Self-heal against the server-side stale-attempt cron
    // (close_stale_exam_attempts_sweep, every 5 min): it flips is_submitted
    // server-side WITHOUT invalidating this cache. Without a poll, a cron-closed
    // student keeps rendering as "Not Attempted" while useExamWindowStatus (30s
    // poll) already shows activeAttempts=0 — that fresh/stale split can open the
    // Validate gate and publish an ungraded attempt at score 0. 60s keeps this
    // list in step with the window-status poll (§23: >30s, justified).
    refetchInterval: 60_000,
  });
}

export function useExamClasses(examId: string | null) {
  return useQuery({
    queryKey: ["exam-classes", examId],
    queryFn: async () => {
      if (!examId) return [];
      const { data, error } = await supabase
        .from("exam_classes")
        .select("class_id, classes(id, name, section)")
        .eq("exam_id", examId);
      if (error) throw error;
      type ExamClassRow = {
        class_id: string;
        classes: { id: string; name: string | null; section: string | null } | null;
      };
      return ((data || []) as unknown as ExamClassRow[]).map((d) => ({
        id: d.class_id,
        name: d.classes?.name || "Unknown",
        section: d.classes?.section || "",
      }));
    },
    enabled: !!examId,
  });
}

export function useExamDetails(examId: string | null) {
  return useQuery({
    queryKey: ["exam-details-results", examId],
    queryFn: async () => {
      if (!examId) return null;
      const { data, error } = await supabase
        .from("exams")
        .select("*")
        .eq("id", examId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!examId,
  });
}

export function useExamWindowStatus(examId: string | null) {
  return useQuery({
    queryKey: ["exam-window-status", examId],
    queryFn: async () => {
      if (!examId) return null;
      const { data, error } = await supabase.rpc("get_exam_window_status", { p_exam_id: examId });
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!examId,
    refetchInterval: 30000,
  });
}

// Attempts opened but never submitted keep blocking "Validate Results" as
// phantom active attempts once each student's own clock is up (the report list
// shows those students as Not Attempted, so nothing looks pending). A cron
// sweep closes them server-side every 5 min; this hook is the on-open kick so
// the report page reflects it immediately instead of waiting for the sweep.
// Saved answers still count; a zero-answer attempt becomes Checked with score
// 0 per the existing convention above. `silent` suppresses toasts for the
// automatic path (see the auto-kick in ExamResultsView).
export function useCloseStaleAttempts(examId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opts?: { silent?: boolean }) => {
      if (!examId) throw new Error("Missing exam ID");
      // close_stale_exam_attempts is newer than the generated DB types; a
      // full regen currently drops schema (1.7k lines), so cast narrowly.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: "close_stale_exam_attempts",
        args: { p_exam_id: string }
      ) => Promise<{ data: number | null; error: { message: string } | null }>;
      const { data, error } = await rpc("close_stale_exam_attempts", { p_exam_id: examId });
      if (error) throw new Error(error.message);
      return { count: data ?? 0, silent: opts?.silent ?? false };
    },
    onSuccess: ({ count, silent }) => {
      if (count > 0) {
        queryClient.invalidateQueries({ queryKey: ["exam-window-status"] });
        queryClient.invalidateQueries({ queryKey: ["exam-results-students"] });
        queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
      }
      if (!silent) {
        toast.success(
          count > 0
            ? `Closed ${count} unsubmitted attempt(s).`
            : "No unsubmitted attempts remaining."
        );
      }
    },
    onError: (error: Error, opts) => {
      // The automatic on-open kick fails quietly (e.g. window still open, or a
      // student is still within their clock) — never surface that to the user.
      if (opts?.silent) return;
      toastError(error, {
        fallback: "Couldn't close unsubmitted attempts.",
        context: "closeStaleAttempts",
      });
    },
  });
}

export function useValidateExamResults(examId: string | null, classId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!examId || !classId) throw new Error("Missing exam or class ID");

      // Get current user for finalized_by
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get all submitted, non-finalized attempts for this exam+class
      const { data: attempts, error: attemptsError } = await supabase
        .from("student_exam_attempts")
        .select("id, student_id")
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .eq("is_submitted", true)
        .eq("is_finalized", false);

      if (attemptsError) throw attemptsError;

      // Finalize each attempt
      for (const attempt of attempts || []) {
        const { error } = await supabase
          .from("student_exam_attempts")
          .update({ is_finalized: true, evaluation_status: "finalized" })
          .eq("id", attempt.id);

        if (error) {
          console.error(`Error finalizing attempt ${attempt.id}:`, error);
          throw error;
        }
      }

      // Get exam details for pass marks
      const { data: exam } = await supabase
        .from("exams")
        .select("total_marks, pass_marks")
        .eq("id", examId)
        .single();

      // Build final results with rankings from ALL submitted attempts
      const { data: allAttempts } = await supabase
        .from("student_exam_attempts")
        .select("id, student_id")
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .eq("is_submitted", true);

      // Calculate scores
      const scores: { attemptId: string; studentId: string; totalScore: number }[] = [];
      
      for (const attempt of allAttempts || []) {
        const { data: overrides } = await supabase
          .from("teacher_overrides")
          .select("final_marks, student_answers!inner(attempt_id)")
          .eq("student_answers.attempt_id", attempt.id);

        const totalScore = (overrides || []).reduce(
          (sum: number, o: { final_marks: number | null }) => sum + (o.final_marks || 0),
          0
        );
        scores.push({ attemptId: attempt.id, studentId: attempt.student_id, totalScore });
      }

      // Sort by score descending for ranking
      scores.sort((a, b) => b.totalScore - a.totalScore);

      const maxMarks = exam?.total_marks || 100;

      // Insert/update final_results
      // NOTE: `percentage` is a GENERATED ALWAYS column — writing to it raises
      // "cannot insert a non-DEFAULT value" and silently drops the row.
      for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        const percentage = maxMarks > 0 ? (s.totalScore / maxMarks) * 100 : 0;
        const passed = exam?.pass_marks ? s.totalScore >= exam.pass_marks : percentage >= 40;

        const { error } = await supabase
          .from("final_results")
          .upsert({
            attempt_id: s.attemptId,
            finalized_by: user.id,
            total_marks_obtained: s.totalScore,
            total_max_marks: maxMarks,
            rank_in_class: i + 1,
            is_pass: passed,
            grade: getGrade(percentage),
            is_published: true,
            published_at: new Date().toISOString(),
            published_by: user.id,
          }, { onConflict: "attempt_id" });

        if (error) throw error;
      }

      // Update exam status to completed if not already
      await supabase
        .from("exams")
        .update({ status: "completed" })
        .eq("id", examId)
        .in("status", ["published", "active"]);

      return scores.length;
    },
    onSuccess: (count) => {
      toast.success(`Results validated for ${count} students`);
      queryClient.invalidateQueries({ queryKey: ["exam-results-students"] });
      queryClient.invalidateQueries({ queryKey: ["exam-window-status"] });
      queryClient.invalidateQueries({ queryKey: ["exam-details-results"] });
      queryClient.invalidateQueries({ queryKey: ["validated-results"] });
      queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't validate and publish results.", context: "validateExamResults" });
    },
  });
}

export function useValidatedResults(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["validated-results", examId, classId],
    queryFn: async (): Promise<ValidatedResult[]> => {
      if (!examId || !classId) return [];

      // final_results doesn't have exam_id/class_id directly, join through attempts
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select("id, student_id")
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .eq("is_submitted", true);

      if (!attempts || attempts.length === 0) return [];

      const attemptIds = attempts.map(a => a.id);
      const studentMap = new Map(attempts.map(a => [a.id, a.student_id]));

      const { data: results, error } = await supabase
        .from("final_results")
        .select("*")
        .in("attempt_id", attemptIds)
        .eq("is_published", true)
        .order("rank_in_class", { ascending: true });

      if (error) throw error;
      if (!results || results.length === 0) return [];

      // Get student profiles
      const studentIds = [...new Set(results.map(r => studentMap.get(r.attempt_id)).filter(Boolean))] as string[];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, roll_number, admission_number")
        .in("id", studentIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      // Get proctoring flags
      const { data: exam } = await supabase
        .from("exams")
        .select("exam_mode")
        .eq("id", examId)
        .single();

      const proctoringMap: Record<string, number> = {};
      if (exam?.exam_mode === "online") {
        const { data: sessions } = await supabase
          .from("proctoring_sessions")
          .select("attempt_id, total_events")
          .in("attempt_id", attemptIds);

        for (const s of sessions || []) {
          const sid = studentMap.get(s.attempt_id);
          if (sid) {
            proctoringMap[sid] = (proctoringMap[sid] || 0) + (s.total_events || 0);
          }
        }
      }

      return results.map((r) => {
        const studentId = studentMap.get(r.attempt_id) || "";
        const profile = profileMap.get(studentId);
        return {
          rank: r.rank_in_class || 0,
          studentId,
          studentName: getDisplayName(profile),
          rollNo: profile?.roll_number || null,
          admissionNo: profile?.admission_number || null,
          attemptId: r.attempt_id,
          totalScore: r.total_marks_obtained,
          maxMarks: r.total_max_marks,
          percentage: r.percentage || 0,
          grade: r.grade || getGrade(r.percentage || 0),
          passed: r.is_pass || false,
          proctoringFlags: proctoringMap[studentId] || 0,
        };
      });
    },
    enabled: !!examId && !!classId,
  });
}

export function useExamResultsSummary(students: ExamResultStudent[]): ExamResultsSummary {
  const attempted = students.filter(s => s.status !== "not_attempted");
  const checked = students.filter(s => s.status === "checked");
  const notChecked = students.filter(s => s.status === "not_checked");
  const notAttempted = students.filter(s => s.status === "not_attempted");

  const scores = checked.filter(s => s.percentage !== null).map(s => s.percentage!);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const passRate = checked.length > 0
    ? Math.round((checked.filter(s => (s.percentage || 0) >= 40).length / checked.length) * 100)
    : 0;

  return {
    totalStudents: students.length,
    attempted: attempted.length,
    notAttempted: notAttempted.length,
    checked: checked.length,
    notChecked: notChecked.length,
    avgScore,
    passRate,
    highestScore: scores.length > 0 ? Math.max(...scores) : 0,
    lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
  };
}
