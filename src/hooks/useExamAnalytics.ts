import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getDisplayName } from "@/lib/displayName";

/** The fields this hook reads off an embedded `exam_questions` row. */
interface ExamQuestionBits {
  id: string;
  marks: number;
  tags: string[] | null;
  question_text: string;
  question_order: number;
}

/** The fields this hook reads off an embedded `teacher_overrides` row. */
interface TeacherOverrideBits {
  final_marks: number | null;
  max_marks: number | null;
}

export interface ExamAnalytics {
  exam: {
    id: string;
    title: string;
    totalMarks: number;
    passMarks: number;
    examMode: string;
  };
  totalStudents: number;
  totalAttempted: number;
  avgScore: number;
  median: number;
  standardDeviation: number;
  highestScore: number;
  lowestScore: number;
  passCount: number;
  failCount: number;
  passRate: number;
  scoreDistribution: { bucket: string; count: number }[];
  gradeDistribution: { grade: string; count: number }[];
  sectionAnalysis: {
    sectionName: string;
    avgScore: number;
    maxPossible: number;
    accuracyPercent: number;
  }[];
  questionAnalysis: {
    questionId: string;
    questionText: string;
    sectionName: string;
    marks: number;
    avgScore: number;
    correctRate: number;
    avgTimeSeconds: number;
    difficulty: "easy" | "medium" | "hard";
    tags: string[];
  }[];
  studentResults: {
    studentId: string;
    studentName: string;
    rollNo: string | null;
    admissionNo: string | null;
    attemptId: string;
    totalScore: number;
    percentage: number;
    rank: number;
    grade: string;
    passed: boolean;
    timeSpentSeconds: number;
    sectionScores: { sectionName: string; score: number; maxMarks: number }[];
    questionScores: { questionId: string; score: number; maxMarks: number; timeSeconds: number }[];
    weakTopics: string[];
    strengths: string[];
  }[];
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

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function useExamAnalytics(examId: string | null) {
  return useQuery<ExamAnalytics | null>({
    queryKey: ["exam-analytics", examId],
    queryFn: async () => {
      if (!examId) return null;

      // Parallel fetches
      const [examRes, sectionsRes, attemptsRes] = await Promise.all([
        supabase.from("exams").select("id, title, total_marks, pass_marks, exam_mode, institution_id").eq("id", examId).single(),
        supabase.from("exam_sections").select("id, title, section_order, total_marks, exam_questions(id, question_text, marks, tags, correct_answer, question_type, question_order, section_id)").eq("exam_id", examId).order("section_order"),
        supabase.from("student_exam_attempts").select("id, student_id, class_id, time_spent_seconds, is_submitted, is_finalized").eq("exam_id", examId).eq("is_submitted", true),
      ]);

      if (examRes.error) throw examRes.error;
      if (sectionsRes.error) throw sectionsRes.error;
      if (attemptsRes.error) throw attemptsRes.error;

      const exam = examRes.data;
      const sections = sectionsRes.data || [];
      const attempts = attemptsRes.data || [];
      const attemptIds = attempts.map(a => a.id);
      const studentIds = [...new Set(attempts.map(a => a.student_id))];

      if (attemptIds.length === 0) {
        return {
          exam: { id: exam.id, title: exam.title, totalMarks: exam.total_marks || 0, passMarks: exam.pass_marks || 0, examMode: exam.exam_mode },
          totalStudents: 0, totalAttempted: 0, avgScore: 0, median: 0, standardDeviation: 0,
          highestScore: 0, lowestScore: 0, passCount: 0, failCount: 0, passRate: 0,
          scoreDistribution: [], gradeDistribution: [], sectionAnalysis: [], questionAnalysis: [], studentResults: [],
        };
      }

      // Fetch answers+overrides, telemetry, profiles in parallel
      const [answersRes, telemetryRes, profilesRes] = await Promise.all([
        supabase.from("student_answers").select("id, attempt_id, question_id, teacher_overrides(final_marks, max_marks)").in("attempt_id", attemptIds),
        supabase.from("attempt_question_telemetry").select("attempt_id, question_id, total_time_seconds").in("attempt_id", attemptIds),
        supabase.from("profiles").select("id, full_name, roll_number, admission_number").in("id", studentIds),
      ]);

      const answers = answersRes.data || [];
      const telemetry = telemetryRes.data || [];
      const profiles = profilesRes.data || [];
      const profileMap = new Map(profiles.map(p => [p.id, p]));

      // Build question map: questionId -> { marks, tags, sectionId, sectionName, questionText, order }
      const questionMap = new Map<string, { marks: number; tags: string[]; sectionName: string; questionText: string; sectionId: string; order: number }>();
      const sectionNameMap = new Map<string, string>();
      const sectionMaxMarks = new Map<string, number>();

      for (const section of sections) {
        sectionNameMap.set(section.id, section.title);
        let sectionTotal = 0;
        for (const q of (section.exam_questions || []) as ExamQuestionBits[]) {
          questionMap.set(q.id, {
            marks: q.marks,
            tags: q.tags || [],
            sectionName: section.title,
            questionText: q.question_text,
            sectionId: section.id,
            order: q.question_order,
          });
          sectionTotal += q.marks;
        }
        sectionMaxMarks.set(section.id, section.total_marks || sectionTotal);
      }

      // Build per-answer score map: { attemptId -> { questionId -> finalMarks } }
      const scoreMap = new Map<string, Map<string, number>>();
      for (const ans of answers) {
        if (!scoreMap.has(ans.attempt_id)) scoreMap.set(ans.attempt_id, new Map());
        // PostgREST returns an embedded row as an object or a one-element array
        // depending on the FK it infers, so handle both shapes.
        const overrides = ans.teacher_overrides as TeacherOverrideBits | TeacherOverrideBits[] | null;
        let finalMarks = 0;
        if (overrides) {
          if (Array.isArray(overrides)) {
            finalMarks = overrides[0]?.final_marks || 0;
          } else if (overrides.final_marks !== undefined) {
            finalMarks = overrides.final_marks || 0;
          }
        }
        scoreMap.get(ans.attempt_id)!.set(ans.question_id, finalMarks);
      }

      // Build telemetry map: attemptId -> questionId -> seconds
      const timeMap = new Map<string, Map<string, number>>();
      for (const t of telemetry) {
        if (!timeMap.has(t.attempt_id)) timeMap.set(t.attempt_id, new Map());
        timeMap.get(t.attempt_id)!.set(t.question_id, t.total_time_seconds || 0);
      }

      const totalMarks = exam.total_marks || 0;
      const passMarks = exam.pass_marks || 0;

      // Compute per-student results
      const studentResults: ExamAnalytics["studentResults"] = [];

      for (const attempt of attempts) {
        const profile = profileMap.get(attempt.student_id);
        const qScores = scoreMap.get(attempt.id) || new Map<string, number>();
        const qTimes = timeMap.get(attempt.id) || new Map<string, number>();

        let totalScore = 0;
        const sectionScoresAcc = new Map<string, { score: number; maxMarks: number; name: string }>();
        const questionScores: ExamAnalytics["studentResults"][0]["questionScores"] = [];
        const weakTopics: string[] = [];
        const strengths: string[] = [];

        for (const [qId, qInfo] of questionMap) {
          const score = qScores.get(qId) || 0;
          totalScore += score;
          const timeSeconds = qTimes.get(qId) || 0;

          questionScores.push({ questionId: qId, score, maxMarks: qInfo.marks, timeSeconds });

          // Section accumulation
          if (!sectionScoresAcc.has(qInfo.sectionId)) {
            sectionScoresAcc.set(qInfo.sectionId, { score: 0, maxMarks: sectionMaxMarks.get(qInfo.sectionId) || 0, name: qInfo.sectionName });
          }
          sectionScoresAcc.get(qInfo.sectionId)!.score += score;

          // Weak/strong topics
          if (qInfo.marks > 0) {
            const ratio = score / qInfo.marks;
            if (ratio < 0.5) {
              for (const tag of qInfo.tags) {
                if (!weakTopics.includes(tag)) weakTopics.push(tag);
              }
            }
            if (ratio >= 0.8) {
              for (const tag of qInfo.tags) {
                if (!strengths.includes(tag)) strengths.push(tag);
              }
            }
          }
        }

        const percentage = totalMarks > 0 ? (totalScore / totalMarks) * 100 : 0;
        const passed = passMarks > 0 ? totalScore >= passMarks : percentage >= 40;

        studentResults.push({
          studentId: attempt.student_id,
          studentName: getDisplayName(profile),
          rollNo: profile?.roll_number || null,
          admissionNo: profile?.admission_number || null,
          attemptId: attempt.id,
          totalScore,
          percentage: Math.round(percentage * 100) / 100,
          rank: 0, // computed after sorting
          grade: getGrade(percentage),
          passed,
          timeSpentSeconds: attempt.time_spent_seconds || 0,
          sectionScores: Array.from(sectionScoresAcc.values()).map(s => ({
            sectionName: s.name, score: s.score, maxMarks: s.maxMarks,
          })),
          questionScores,
          weakTopics,
          strengths: strengths.filter(s => !weakTopics.includes(s)),
        });
      }

      // Sort by totalScore descending, assign ranks
      studentResults.sort((a, b) => b.totalScore - a.totalScore);
      studentResults.forEach((s, i) => { s.rank = i + 1; });

      // Aggregate metrics
      const scores = studentResults.map(s => s.percentage);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : 0;
      const median = computeMedian(scores);
      const stdDev = Math.round(computeStdDev(scores, avgScore) * 100) / 100;
      const passCount = studentResults.filter(s => s.passed).length;
      const failCount = studentResults.length - passCount;

      // Score distribution buckets (percentage-based)
      const buckets = [
        { bucket: "0-20", min: 0, max: 20, count: 0 },
        { bucket: "21-40", min: 21, max: 40, count: 0 },
        { bucket: "41-60", min: 41, max: 60, count: 0 },
        { bucket: "61-80", min: 61, max: 80, count: 0 },
        { bucket: "81-100", min: 81, max: 100, count: 0 },
      ];
      for (const s of studentResults) {
        for (const b of buckets) {
          if (s.percentage >= b.min && s.percentage <= b.max) { b.count++; break; }
        }
      }

      // Grade distribution
      const gradeCounts = new Map<string, number>();
      for (const s of studentResults) {
        gradeCounts.set(s.grade, (gradeCounts.get(s.grade) || 0) + 1);
      }
      const gradeDistribution = Array.from(gradeCounts.entries()).map(([grade, count]) => ({ grade, count }));

      // Section analysis
      const sectionAnalysis: ExamAnalytics["sectionAnalysis"] = [];
      for (const section of sections) {
        const maxPossible = sectionMaxMarks.get(section.id) || 0;
        let totalSectionScore = 0;
        for (const sr of studentResults) {
          const ss = sr.sectionScores.find(s => s.sectionName === section.title);
          totalSectionScore += ss?.score || 0;
        }
        const avgSectionScore = studentResults.length > 0 ? totalSectionScore / studentResults.length : 0;
        const accuracy = maxPossible > 0 && studentResults.length > 0
          ? (totalSectionScore / (maxPossible * studentResults.length)) * 100 : 0;

        sectionAnalysis.push({
          sectionName: section.title,
          avgScore: Math.round(avgSectionScore * 100) / 100,
          maxPossible,
          accuracyPercent: Math.round(accuracy * 100) / 100,
        });
      }

      // Question analysis
      const questionAnalysis: ExamAnalytics["questionAnalysis"] = [];
      for (const [qId, qInfo] of questionMap) {
        let totalQScore = 0;
        let fullMarksCount = 0;
        let totalTime = 0;
        let timeCount = 0;

        for (const sr of studentResults) {
          const qs = sr.questionScores.find(q => q.questionId === qId);
          if (qs) {
            totalQScore += qs.score;
            if (qs.score >= qInfo.marks) fullMarksCount++;
            if (qs.timeSeconds > 0) { totalTime += qs.timeSeconds; timeCount++; }
          }
        }

        const avgQScore = studentResults.length > 0 ? totalQScore / studentResults.length : 0;
        const correctRate = studentResults.length > 0 ? (fullMarksCount / studentResults.length) * 100 : 0;
        const avgTime = timeCount > 0 ? totalTime / timeCount : 0;
        const difficulty: "easy" | "medium" | "hard" = correctRate > 70 ? "easy" : correctRate >= 40 ? "medium" : "hard";

        questionAnalysis.push({
          questionId: qId,
          questionText: qInfo.questionText,
          sectionName: qInfo.sectionName,
          marks: qInfo.marks,
          avgScore: Math.round(avgQScore * 100) / 100,
          correctRate: Math.round(correctRate * 100) / 100,
          avgTimeSeconds: Math.round(avgTime),
          difficulty,
          tags: qInfo.tags,
        });
      }

      // Sort question analysis by section order then question order
      questionAnalysis.sort((a, b) => {
        const secA = sections.findIndex(s => s.title === a.sectionName);
        const secB = sections.findIndex(s => s.title === b.sectionName);
        if (secA !== secB) return secA - secB;
        const qA = questionMap.get(a.questionId);
        const qB = questionMap.get(b.questionId);
        return (qA?.order || 0) - (qB?.order || 0);
      });

      return {
        exam: {
          id: exam.id,
          title: exam.title,
          totalMarks,
          passMarks,
          examMode: exam.exam_mode,
        },
        totalStudents: studentResults.length,
        totalAttempted: studentResults.length,
        avgScore,
        median: Math.round(median * 100) / 100,
        standardDeviation: stdDev,
        highestScore: scores.length > 0 ? Math.max(...scores) : 0,
        lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
        passCount,
        failCount,
        passRate: studentResults.length > 0 ? Math.round((passCount / studentResults.length) * 100 * 100) / 100 : 0,
        scoreDistribution: buckets.map(b => ({ bucket: b.bucket, count: b.count })),
        gradeDistribution,
        sectionAnalysis,
        questionAnalysis,
        studentResults,
      };
    },
    enabled: !!examId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}
