import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ============================================
// TEACHER ANALYTICS
// ============================================

export function useTeacherAnalytics() {
  return useQuery({
    queryKey: ["teacher-analytics"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Get teacher's exams
      const { data: exams } = await supabase
        .from("exams")
        .select(`
          id, title, status, total_marks, created_at,
          exam_classes(class_id, classes(id, name))
        `)
        .eq("created_by", user.id);

      if (!exams || exams.length === 0) {
        return {
          examStats: { total: 0, draft: 0, published: 0, active: 0, completed: 0 },
          classPerformance: [],
          pendingWorkload: { evaluations: 0, ocrReviews: 0, tasks: 0 },
          evaluationProgress: [],
          questionDifficulty: [],
          hesitationAnalysis: [],
          conceptGaps: [],
        };
      }

      const examIds = exams.map(e => e.id);

      // Get all attempts for these exams
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select(`
          id, exam_id, class_id, is_submitted, evaluation_status,
          classes(name)
        `)
        .in("exam_id", examIds);

      // Get finalized results
      const attemptIds = attempts?.map(a => a.id) || [];
      const { data: results } = attemptIds.length > 0
        ? await supabase
            .from("final_results")
            .select("attempt_id, percentage, is_pass")
            .in("attempt_id", attemptIds)
        : { data: [] };

      // Get question telemetry for difficulty analysis
      const { data: questionTelemetry } = attemptIds.length > 0
        ? await supabase
            .from("attempt_question_telemetry")
            .select("*")
            .in("attempt_id", attemptIds)
        : { data: [] };

      // Get student answers for correctness
      const { data: studentAnswers } = attemptIds.length > 0
        ? await supabase
            .from("student_answers")
            .select("question_id, attempt_id, answer_text")
            .in("attempt_id", attemptIds)
        : { data: [] };

      // Get exam questions
      const { data: examQuestions } = await supabase
        .from("exam_questions")
        .select("id, question_text, marks, correct_answer, section_id, tags")
        .in("section_id", exams.flatMap(e => (e as { sections?: { id: string }[] }).sections?.map((s) => s.id) ?? []));

      // Calculate exam stats
      const examStats = {
        total: exams.length,
        draft: exams.filter(e => e.status === "draft").length,
        published: exams.filter(e => e.status === "published").length,
        active: exams.filter(e => e.status === "active").length,
        completed: exams.filter(e => e.status === "completed").length,
      };

      // Calculate class performance
      const classData: Record<string, { name: string; attempts: number; avgScore: number; passRate: number }> = {};
      
      attempts?.forEach(attempt => {
        const className = (attempt.classes as { name?: string | null } | null)?.name || "Unknown";
        const classId = attempt.class_id;
        
        if (!classData[classId]) {
          classData[classId] = { name: className, attempts: 0, avgScore: 0, passRate: 0 };
        }
        classData[classId].attempts++;
        
        const result = results?.find(r => r.attempt_id === attempt.id);
        if (result) {
          classData[classId].avgScore += result.percentage || 0;
          if (result.is_pass) classData[classId].passRate++;
        }
      });

      const classPerformance = Object.values(classData).map(c => ({
        ...c,
        avgScore: c.attempts > 0 ? c.avgScore / c.attempts : 0,
        passRate: c.attempts > 0 ? (c.passRate / c.attempts) * 100 : 0,
      }));

      // Question difficulty analysis
      const questionStats: Record<string, { 
        id: string; avgTime: number; hesitationCount: number; skipRate: number; 
        attempts: number; text: string; 
      }> = {};

      questionTelemetry?.forEach(qt => {
        if (!questionStats[qt.question_id]) {
          questionStats[qt.question_id] = { 
            id: qt.question_id, avgTime: 0, hesitationCount: 0, skipRate: 0, attempts: 0, text: "" 
          };
        }
        questionStats[qt.question_id].avgTime += qt.total_time_seconds || 0;
        questionStats[qt.question_id].attempts++;
        if ((qt.answer_change_count || 0) > 2) {
          questionStats[qt.question_id].hesitationCount++;
        }
        if (qt.is_skipped) {
          questionStats[qt.question_id].skipRate++;
        }
      });

      const questionDifficulty = Object.values(questionStats).map(q => ({
        questionId: q.id,
        avgTimeSpent: q.attempts > 0 ? q.avgTime / q.attempts : 0,
        hesitationRate: q.attempts > 0 ? (q.hesitationCount / q.attempts) * 100 : 0,
        skipRate: q.attempts > 0 ? (q.skipRate / q.attempts) * 100 : 0,
        totalAttempts: q.attempts,
      })).sort((a, b) => b.avgTimeSpent - a.avgTimeSpent).slice(0, 10);

      // Hesitation analysis - questions where students changed answers frequently
      const hesitationAnalysis = Object.values(questionStats)
        .filter(q => q.hesitationCount > 0)
        .map(q => ({
          questionId: q.id,
          hesitationRate: q.attempts > 0 ? (q.hesitationCount / q.attempts) * 100 : 0,
          avgTimeSpent: q.attempts > 0 ? q.avgTime / q.attempts : 0,
        }))
        .sort((a, b) => b.hesitationRate - a.hesitationRate)
        .slice(0, 5);

      // Concept gaps - topics with low accuracy
      const topicAggregates: Record<string, { correct: number; total: number }> = {};
      // Would need to match answers with correct_answer from exam_questions

      // Pending workload
      const pendingEvaluations = attempts?.filter(a => 
        a.is_submitted && a.evaluation_status !== "finalized"
      ).length || 0;

      const { data: ocrExtractions } = await supabase
        .from("ocr_extractions")
        .select("id")
        .eq("status", "extracted");

      const { data: tasks } = await supabase
        .from("task_assignments")
        .select("task_id, tasks(status)")
        .eq("assignee_id", user.id);

      const openTasks = tasks?.filter(t =>
        t.tasks && !["completed", "rejected"].includes((t.tasks as { status?: string } | null)?.status ?? "")
      ).length || 0;

      // Evaluation progress by exam
      const evaluationProgress = exams.filter(e => e.status !== "draft").map(exam => {
        const examAttempts = attempts?.filter(a => a.exam_id === exam.id) || [];
        const submitted = examAttempts.filter(a => a.is_submitted).length;
        const evaluated = examAttempts.filter(a => a.evaluation_status === "finalized").length;
        
        return {
          examId: exam.id,
          examTitle: exam.title,
          totalAttempts: submitted,
          evaluated,
          pending: submitted - evaluated,
          progress: submitted > 0 ? (evaluated / submitted) * 100 : 0,
        };
      });

      return {
        examStats,
        classPerformance,
        pendingWorkload: {
          evaluations: pendingEvaluations,
          ocrReviews: ocrExtractions?.length || 0,
          tasks: openTasks,
        },
        evaluationProgress,
        questionDifficulty,
        hesitationAnalysis,
        conceptGaps: [],
      };
    },
  });
}
// ============================================
// SUPER ADMIN ANALYTICS
// ============================================

export function useSuperAdminAnalytics() {
  return useQuery({
    queryKey: ["super-admin-analytics"],
    queryFn: async () => {
      // Institution growth
      const { data: institutions } = await supabase
        .from("institutions")
        .select("id, name, is_active, created_at")
        .order("created_at");

      // System-wide usage
      const { data: allExams } = await supabase
        .from("exams")
        .select("id, status, institution_id, created_at");

      const { data: allAttempts } = await supabase
        .from("student_exam_attempts")
        .select("id, is_submitted, evaluation_status, created_at");

      const { data: allUsers } = await supabase
        .from("profiles")
        .select("id, created_at");

      const { data: allRoles } = await supabase
        .from("user_roles")
        .select("role, institution_id");

      // System-wide proctoring stats
      const { data: allProctoringSessions } = await supabase
        .from("proctoring_sessions")
        .select("*");

      // Calculate institution stats
      const institutionStats = institutions?.map(inst => {
        const instExams = allExams?.filter(e => e.institution_id === inst.id) || [];
        const instUsers = allRoles?.filter(r => r.institution_id === inst.id) || [];
        
        return {
          id: inst.id,
          name: inst.name,
          isActive: inst.is_active,
          createdAt: inst.created_at,
          examCount: instExams.length,
          userCount: instUsers.length,
          teacherCount: instUsers.filter(r => r.role === "teacher").length,
          studentCount: instUsers.filter(r => r.role === "student").length,
        };
      }) || [];

      // Growth metrics (monthly)
      const now = new Date();
      const monthlyGrowth = [];
      for (let i = 5; i >= 0; i--) {
        const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
        
        const newInstitutions = institutions?.filter(inst => {
          const created = new Date(inst.created_at);
          return created >= month && created <= monthEnd;
        }).length || 0;

        const newUsers = allUsers?.filter(u => {
          const created = new Date(u.created_at);
          return created >= month && created <= monthEnd;
        }).length || 0;

        const newExams = allExams?.filter(e => {
          const created = new Date(e.created_at);
          return created >= month && created <= monthEnd;
        }).length || 0;

        monthlyGrowth.push({
          month: month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          institutions: newInstitutions,
          users: newUsers,
          exams: newExams,
        });
      }

      // System usage overview
      const systemUsage = {
        totalInstitutions: institutions?.length || 0,
        activeInstitutions: institutions?.filter(i => i.is_active).length || 0,
        totalUsers: allUsers?.length || 0,
        totalExams: allExams?.length || 0,
        totalAttempts: allAttempts?.length || 0,
        completedEvaluations: allAttempts?.filter(a => a.evaluation_status === "finalized").length || 0,
        activeRate: allAttempts?.length 
          ? ((allAttempts.filter(a => a.is_submitted).length / allAttempts.length) * 100)
          : 0,
      };

      // Role distribution
      const roleDistribution = {
        super_admin: allRoles?.filter(r => r.role === "super_admin").length || 0,
        school_admin: allRoles?.filter(r => r.role === "school_admin").length || 0,
        coordinator: allRoles?.filter(r => r.role === "coordinator").length || 0,
        teacher: allRoles?.filter(r => r.role === "teacher").length || 0,
        student: allRoles?.filter(r => r.role === "student").length || 0,
      };

      // System-wide integrity metrics
      const integrityMetrics = {
        totalProctoringSessions: allProctoringSessions?.length || 0,
        flaggedSessions: allProctoringSessions?.filter(p => p.requires_review).length || 0,
        reviewedSessions: allProctoringSessions?.filter(p => p.review_status === "reviewed").length || 0,
        pendingReview: allProctoringSessions?.filter(p => p.review_status === "pending").length || 0,
        flagRate: allProctoringSessions?.length 
          ? ((allProctoringSessions.filter(p => p.requires_review).length / allProctoringSessions.length) * 100)
          : 0,
        totalHighSeverity: allProctoringSessions?.reduce((sum, p) => sum + (p.high_severity_events || 0), 0) || 0,
        totalMediumSeverity: allProctoringSessions?.reduce((sum, p) => sum + (p.medium_severity_events || 0), 0) || 0,
        totalLowSeverity: allProctoringSessions?.reduce((sum, p) => sum + (p.low_severity_events || 0), 0) || 0,
      };

      return {
        institutionStats,
        monthlyGrowth,
        systemUsage,
        roleDistribution,
        integrityMetrics,
      };
    },
  });
}


// ============================================
// REVENUE/PAYMENT ANALYTICS (Super Admin Only)
// ============================================

export function useRevenueAnalytics() {
  return useQuery({
    queryKey: ["revenue-analytics"],
    queryFn: async () => {
      // This would integrate with Stripe or payment tables
      const { data: institutions } = await supabase
        .from("institutions")
        .select("id, name, is_active, created_at");

      // Simulated revenue data structure (would come from payments table)
      const institutionBilling = institutions?.map(inst => ({
        institutionId: inst.id,
        institutionName: inst.name,
        isActive: inst.is_active,
        subscriptionStatus: inst.is_active ? "active" : "inactive",
        monthlyAmount: 0,
        lastPaymentDate: null,
        nextBillingDate: null,
      })) || [];

      return {
        totalRevenue: 0,
        monthlyRecurring: 0,
        activeSubscriptions: institutions?.filter(i => i.is_active).length || 0,
        institutionBilling,
        revenueByMonth: [],
      };
    },
  });
}
