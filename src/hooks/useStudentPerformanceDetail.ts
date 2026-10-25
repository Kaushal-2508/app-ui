import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getDisplayName } from "@/lib/displayName";

export interface StudentPerformanceDetail {
  studentName: string;
  email: string;
  className: string;
  classSection: string | null;
  overallAccuracy: number;
  totalExams: number;
  totalQuestionsAttempted: number;
  totalCorrect: number;
  avgTimePerQuestion: number;
  avgEfficiency: number;
  bestAccuracy: number;
  worstAccuracy: number;
  trend: { examNumber: number; examTitle: string; accuracy: number; classAvg: number; topperAccuracy: number; date: string }[];
  subjectPerformance: { subject: string; accuracy: number; classAvg: number; questionsAttempted: number }[];
  recentExams: { examTitle: string; accuracy: number; score: string; date: string; rank: number | null }[];
  conceptMastery: { topic: string; mastery: number; trend: string | null }[];
}

export function useStudentPerformanceDetail(studentId: string | undefined) {
  return useQuery({
    queryKey: ["student-performance-detail", studentId],
    queryFn: async (): Promise<StudentPerformanceDetail | null> => {
      if (!studentId) return null;

      // Fetch profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", studentId)
        .single();

      if (!profile) return null;

      // Fetch class assignment
      const { data: classAssignment } = await supabase
        .from("class_assignments")
        .select("classes(id, name, section)")
        .eq("user_id", studentId)
        .eq("role", "student")
        .limit(1)
        .maybeSingle();

      const cls = classAssignment?.classes as unknown as
        | { id: string; name: string | null; section: string | null }
        | null;

      // Fetch all performance snapshots
      const { data: snapshots } = await supabase
        .from("student_performance_snapshots")
        .select("*, exams:exam_id(title, scheduled_date)")
        .eq("student_id", studentId)
        .order("snapshot_at", { ascending: true });

      const snaps = snapshots || [];

      // Fetch concept mastery
      const { data: mastery } = await supabase
        .from("concept_mastery")
        // Column is topic_name — aliased to `name` so the downstream shape
        // stays intact. Selecting bare `name` made this query 42703 on every
        // call (silently swallowed: mastery rendered empty for months).
        .select("mastery_level, trend, syllabus_topics:topic_id(name:topic_name)")
        .eq("student_id", studentId)
        .order("mastery_level", { ascending: true })
        .limit(20);

      // Fetch final results for rank info
      const attemptIds = snaps.map(s => s.attempt_id);
      const { data: results } = attemptIds.length > 0
        ? await supabase
            .from("final_results")
            .select("attempt_id, rank_in_class, total_marks_obtained, total_max_marks")
            .in("attempt_id", attemptIds)
        : { data: [] };

      const resultsMap = new Map((results || []).map(r => [r.attempt_id, r]));

      // Compute metrics
      const totalExams = snaps.length;
      const totalQA = snaps.reduce((s, snap) => s + snap.questions_attempted, 0);
      const totalCorrect = snaps.reduce((s, snap) => s + snap.questions_correct, 0);
      const overallAccuracy = totalQA > 0 ? (totalCorrect / totalQA) * 100 : 0;
      const avgTime = totalExams > 0 ? snaps.reduce((s, snap) => s + snap.avg_time_per_question_seconds, 0) / totalExams : 0;
      const avgEfficiency = totalExams > 0 ? snaps.reduce((s, snap) => s + snap.efficiency_score, 0) / totalExams : 0;
      const bestAccuracy = snaps.length > 0 ? Math.max(...snaps.map(s => s.accuracy_percent)) : 0;
      const worstAccuracy = snaps.length > 0 ? Math.min(...snaps.map(s => s.accuracy_percent)) : 0;

      // PostgREST to-one embed of exams — narrow inline instead of `any` (§5a)
      type ExamJoin = { title: string | null; scheduled_date: string | null } | null;

      // Build trend
      const trend = snaps.map((snap, i) => ({
        examNumber: i + 1,
        examTitle: (snap.exams as ExamJoin)?.title || `Exam ${i + 1}`,
        accuracy: snap.accuracy_percent,
        classAvg: snap.class_avg_accuracy || 0,
        topperAccuracy: snap.topper_accuracy || 0,
        date: snap.snapshot_at,
      }));

      // Build subject performance from subject_breakdown
      const subjectMap: Record<string, { totalAcc: number; count: number; classAvg: number; qa: number }> = {};
      type BreakdownEntry = {
        subject_name?: string;
        subject?: string;
        accuracy?: number | string;
        accuracy_percent?: number | string;
        questions_attempted?: number | string;
        attempted?: number | string;
      };
      for (const snap of snaps) {
        const breakdown = snap.subject_breakdown as
          | BreakdownEntry[]
          | Record<string, BreakdownEntry>
          | null;
        if (breakdown && typeof breakdown === "object") {
          const subjects = Array.isArray(breakdown) ? breakdown : Object.values(breakdown);
          for (const sub of subjects) {
            const name = sub.subject_name || sub.subject || "Unknown";
            if (!subjectMap[name]) subjectMap[name] = { totalAcc: 0, count: 0, classAvg: 0, qa: 0 };
            subjectMap[name].totalAcc += Number(sub.accuracy || sub.accuracy_percent || 0);
            subjectMap[name].count += 1;
            subjectMap[name].qa += Number(sub.questions_attempted || sub.attempted || 0);
          }
        }
      }
      const subjectPerformance = Object.entries(subjectMap).map(([subject, data]) => ({
        subject,
        accuracy: data.count > 0 ? data.totalAcc / data.count : 0,
        classAvg: 0,
        questionsAttempted: data.qa,
      }));

      // Recent exams
      const recentExams = [...snaps].reverse().slice(0, 10).map((snap) => {
        const result = resultsMap.get(snap.attempt_id);
        return {
          examTitle: (snap.exams as ExamJoin)?.title || "Exam",
          accuracy: snap.accuracy_percent,
          score: result ? `${result.total_marks_obtained}/${result.total_max_marks}` : `${snap.questions_correct}/${snap.total_questions}`,
          date: snap.snapshot_at,
          rank: result?.rank_in_class || null,
        };
      });

      // Concept mastery — inline structural type for the aliased embed (§5a)
      type MasteryRow = {
        mastery_level: number | null;
        trend: string | null;
        syllabus_topics: { name: string | null } | null;
      };
      const conceptMastery = ((mastery ?? []) as unknown as MasteryRow[]).map((m) => ({
        topic: m.syllabus_topics?.name || "Unknown",
        mastery: m.mastery_level || 0,
        trend: m.trend,
      }));

      return {
        studentName: getDisplayName(profile),
        email: profile.email || "",
        className: cls?.name || "Unassigned",
        classSection: cls?.section || null,
        overallAccuracy,
        totalExams,
        totalQuestionsAttempted: totalQA,
        totalCorrect,
        avgTimePerQuestion: avgTime,
        avgEfficiency,
        bestAccuracy,
        worstAccuracy,
        trend,
        subjectPerformance,
        recentExams,
        conceptMastery,
      };
    },
    enabled: !!studentId,
  });
}
