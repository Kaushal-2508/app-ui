import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { headCount } from "@/lib/headCount";

/**
 * PostgREST types a to-one embed as `T | T[]` depending on how it infers the
 * relationship, so every embedded row has to be normalised before it is read.
 * Reaching for `as any` here silently returns undefined when the embed arrives
 * as an array, which reads as "no data" rather than as a bug.
 */
function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

type EmbeddedTaskRow = { tasks: { status: string | null } | { status: string | null }[] | null };
type EmbeddedExamStatusRow = {
  exams: { status: string | null } | { status: string | null }[] | null;
};
type EmbeddedExam = { title: string | null; total_marks: number | null };

// Super Admin: Cross-institution overview
export function useSuperAdminStats() {
  return useQuery({
    queryKey: ["super-admin-stats"],
    queryFn: async () => {
      const [institutions, exams, profilesCount, classesCount] = await Promise.all([
        supabase.from("institutions").select("id, name, is_active", { count: "exact" }),
        supabase.from("exams").select("id, status, institution_id", { count: "exact" }),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("classes").select("*", { count: "exact", head: true }),
      ]);

      const examsByStatus = {
        draft: 0,
        published: 0,
        active: 0,
        completed: 0,
      };
      
      exams.data?.forEach(e => {
        if (e.status in examsByStatus) {
          examsByStatus[e.status as keyof typeof examsByStatus]++;
        }
      });

      return {
        totalInstitutions: institutions.count || 0,
        activeInstitutions: institutions.data?.filter(i => i.is_active).length || 0,
        totalExams: exams.count || 0,
        examsByStatus,
        totalUsers: profilesCount.count ?? 0,
        totalClasses: classesCount.count ?? 0,
      };
    },
  });
}

export function useSuperAdminInstitutions() {
  return useQuery({
    queryKey: ["super-admin-institutions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("institutions")
        .select(`
          id, name, code, is_active, created_at,
          exams:exams(count),
          classes:classes(count)
        `)
        .order("name");
      
      return data || [];
    },
  });
}

// School Admin: School-level overview
export function useSchoolAdminStats(institutionId: string | null) {
  return useQuery({
    queryKey: ["school-admin-stats", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;

      // Use profiles table for accurate student count (students have institution_id set)
      // And use class_assignments for enrolled students count
      const [exams, classesCount, teacherCount, studentCount, openTasksCount] = await Promise.all([
        supabase
          .from("exams")
          .select("id, status, scheduled_date")
          .eq("institution_id", institutionId),
        supabase
          .from("classes")
          .select("*", { count: "exact", head: true })
          .eq("institution_id", institutionId)
          .eq("is_active", true),
        supabase
          .from("user_roles")
          .select("*", { count: "exact", head: true })
          .eq("institution_id", institutionId)
          .eq("role", "teacher"),
        // Count students from class_assignments for accurate enrolled count
        supabase
          .from("class_assignments")
          .select("user_id, classes!inner(institution_id)", { count: "exact", head: true })
          .eq("classes.institution_id", institutionId)
          .eq("role", "student"),
        // Open tasks across the institution — RLS scopes admins to their school.
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .neq("status", "completed"),
      ]);

      const now = new Date();
      const upcomingExams = exams.data?.filter(e =>
        e.scheduled_date && new Date(e.scheduled_date) > now &&
        (e.status === "published" || e.status === "active")
      ).length || 0;

      const pendingEvaluation = exams.data?.filter(e => e.status === "active").length || 0;

      return {
        totalExams: exams.data?.length || 0,
        upcomingExams,
        pendingEvaluation,
        totalClasses: classesCount.count ?? 0,
        totalTeachers: teacherCount.count ?? 0,
        totalStudents: studentCount.count ?? 0,
        openTasks: openTasksCount.count ?? 0,
        examsByStatus: {
          draft: exams.data?.filter(e => e.status === "draft").length || 0,
          published: exams.data?.filter(e => e.status === "published").length || 0,
          active: exams.data?.filter(e => e.status === "active").length || 0,
          completed: exams.data?.filter(e => e.status === "completed").length || 0,
        },
      };
    },
    enabled: !!institutionId,
  });
}

export function useSchoolExams(institutionId: string | null) {
  return useQuery({
    queryKey: ["school-exams", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      const { data } = await supabase
        .from("exams")
        .select(`
          id, title, status, exam_mode, is_offline, is_results_only, scheduled_date, start_time, end_time, total_marks,
          created_by, created_at, duration_minutes, description,
          exam_classes(class_id, classes(name, section)),
          exam_subjects(subject_id, universal_subjects(name)),
          exam_topics(topic_id, syllabus_topics(topic_name), custom_topic_id, school_custom_topics(topic_name)),
          profiles!exams_created_by_fkey(full_name)
        `)
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false });
      
      return data || [];
    },
    enabled: !!institutionId,
  });
}

// Coordinator: Assigned classes overview (filtered by wing assignments)
export function useCoordinatorStats() {
  return useQuery({
    queryKey: ["coordinator-stats"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // First, get user's wing assignments
      const { data: wingAssignments } = await supabase
        .from("wing_assignments")
        .select("wing_id")
        .eq("user_id", user.id);

      const wingIds = wingAssignments?.map(a => a.wing_id) || [];

      let classIds: string[] = [];

      if (wingIds.length > 0) {
        // Get classes from wing_class_mappings
        const { data: wingClasses } = await supabase
          .from("wing_class_mappings")
          .select("class_id")
          .in("wing_id", wingIds);

        classIds = [...new Set(wingClasses?.map(wc => wc.class_id) || [])];
      } else {
        // Fallback: if no wing assignments, use direct class_assignments (legacy behavior)
        const { data: assignments } = await supabase
          .from("class_assignments")
          .select("class_id")
          .eq("user_id", user.id)
          .in("role", ["coordinator", "teacher"]);

        classIds = assignments?.map(a => a.class_id) || [];
      }

      if (classIds.length === 0) {
        return { 
          assignedClasses: 0, 
          pendingEvaluations: 0, 
          activeExams: 0, 
          openTasks: 0,
          assignedWings: wingIds.length,
        };
      }

      // Get exams for assigned classes
      const { data: examClasses } = await supabase
        .from("exam_classes")
        .select("exam_id, exams(status)")
        .in("class_id", classIds);

      // Get pending evaluations
      const examIds = examClasses?.map(ec => ec.exam_id) || [];
      const { data: attempts } = examIds.length > 0 
        ? await supabase
            .from("student_exam_attempts")
            .select("id, evaluation_status")
            .in("exam_id", examIds)
            .eq("is_submitted", true)
            .neq("evaluation_status", "finalized")
        : { data: [] };

      // Get tasks
      const { data: tasks } = await supabase
        .from("task_assignments")
        .select("task_id, tasks(status)")
        .eq("assignee_id", user.id);

      const openTasks = ((tasks ?? []) as unknown as EmbeddedTaskRow[]).filter((t) => {
        const task = pickOne(t.tasks);
        return task != null && task.status !== "completed";
      }).length;

      return {
        assignedClasses: classIds.length,
        pendingEvaluations: attempts?.length || 0,
        activeExams: ((examClasses ?? []) as unknown as EmbeddedExamStatusRow[]).filter((ec) => {
          const status = pickOne(ec.exams)?.status;
          return status === "active" || status === "published";
        }).length,
        openTasks,
        assignedWings: wingIds.length,
      };
    },
  });
}

// Teacher: Personal workload
export function useTeacherStats() {
  return useQuery({
    queryKey: ["teacher-stats"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // My exams (created by me)
      const { data: myExams } = await supabase
        .from("exams")
        .select("id, status")
        .eq("created_by", user.id);

      // Get assigned classes
      const { data: assignments } = await supabase
        .from("class_assignments")
        .select("class_id")
        .eq("user_id", user.id)
        .eq("role", "teacher");

      const classIds = assignments?.map(a => a.class_id) || [];

      // Pending evaluations in my classes
      let pendingEvaluations = 0;
      let ocrReviewsPending = 0;

      if (classIds.length > 0) {
        const { data: attempts } = await supabase
          .from("student_exam_attempts")
          .select("id, evaluation_status")
          .in("class_id", classIds)
          .eq("is_submitted", true)
          .neq("evaluation_status", "finalized");

        pendingEvaluations = attempts?.length || 0;

        // OCR extractions needing review
        const { data: ocrExtractions } = await supabase
          .from("ocr_extractions")
          .select("id, status")
          .eq("status", "extracted");

        ocrReviewsPending = ocrExtractions?.length || 0;
      }

      // My tasks
      const { data: tasks } = await supabase
        .from("task_assignments")
        .select("task_id, tasks(status)")
        .eq("assignee_id", user.id);

      const openTasks = ((tasks ?? []) as unknown as EmbeddedTaskRow[]).filter((t) => {
        const task = pickOne(t.tasks);
        return task != null && task.status !== "completed";
      }).length;

      return {
        totalExams: myExams?.length || 0,
        draftExams: myExams?.filter(e => e.status === "draft").length || 0,
        publishedExams: myExams?.filter(e => e.status === "published" || e.status === "active").length || 0,
        pendingEvaluations,
        ocrReviewsPending,
        openTasks,
      };
    },
  });
}

/**
 * Row cap for the exam list queries. PostgREST silently truncates at 1000 rows,
 * which reads as "those exams don't exist" rather than as an error (§23), so the
 * bound is explicit and well under the cap.
 */
const EXAM_LIST_LIMIT = 500;

/**
 * Column list shared by both teacher exam fetches.
 *
 * `classes(name, section)` must stay in step with useCoordinatorExams' select
 * (src/hooks/useCoordinatorClasses.ts) because ExamsPage merges the two lists for
 * dual teacher+coordinator users. Dropping `section` here renders "Class 8"
 * where the coordinator list renders "Class 8 A".
 */
const TEACHER_EXAM_SELECT = `
  id, title, status, exam_mode, is_offline, is_results_only, scheduled_date, start_time, end_time, total_marks, duration_minutes, created_at, created_by,
  exam_classes(class_id, classes(name, section)),
  exam_subjects(subject_id, universal_subjects(name)),
  exam_topics(topic_id, syllabus_topics(topic_name), custom_topic_id, school_custom_topics(topic_name)),
  profiles!exams_created_by_fkey(full_name)
`;

export function useTeacherExams() {
  return useQuery({
    queryKey: ["teacher-my-exams"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // 1. Get exams created by this teacher
      const { data: ownExams, error: ownError } = await supabase
        .from("exams")
        .select(TEACHER_EXAM_SELECT)
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .range(0, EXAM_LIST_LIMIT - 1);

      if (ownError) throw ownError;

      // 2. Get class+subject assignments for this teacher
      const { data: assignments, error: assignError } = await supabase
        .from("class_assignments")
        .select("class_id, subject_id")
        .eq("user_id", user.id)
        .eq("role", "teacher")
        .order("class_id", { ascending: true })
        .range(0, EXAM_LIST_LIMIT - 1);

      if (assignError) throw assignError;

      const classIds = [...new Set((assignments || []).map(a => a.class_id))];

      // 3. Get exams for those classes, then filter by subject match
      type ExamQueryRow = {
        id: string;
        exam_subjects?: Array<{ subject_id?: string }>;
        exam_classes?: Array<{ class_id?: string }>;
      };
      let classExams: ExamQueryRow[] = [];
      if (classIds.length > 0) {
        const { data: examClasses, error: examClassError } = await supabase
          .from("exam_classes")
          .select("exam_id")
          .in("class_id", classIds)
          .order("exam_id", { ascending: true })
          .range(0, EXAM_LIST_LIMIT - 1);

        if (examClassError) throw examClassError;

        const examIds = [...new Set(examClasses?.map(e => e.exam_id) || [])];

        // Exclude own exams (already fetched above)
        const ownExamIds = new Set((ownExams || []).map((e) => e.id));
        const otherExamIds = examIds.filter(id => !ownExamIds.has(id));

        if (otherExamIds.length > 0) {
          const { data, error: classExamError } = await supabase
            .from("exams")
            .select(TEACHER_EXAM_SELECT)
            .in("id", otherExamIds)
            .order("created_at", { ascending: false })
            .range(0, EXAM_LIST_LIMIT - 1);

          if (classExamError) throw classExamError;

          // Filter: only include exams where at least one exam_subject matches
          // the teacher's subject assignment for a matching class
          const teacherPairs = new Set(
            (assignments || [])
              .filter(a => a.subject_id)
              .map(a => `${a.class_id}__${a.subject_id}`)
          );

          classExams = (data || []).filter((exam) => {
            const examSubjectIds = (exam.exam_subjects || []).map((es) => es.subject_id);
            const examClassIds = (exam.exam_classes || []).map((ec) => ec.class_id);
            // Check if any class+subject pair matches teacher's assignments
            return examClassIds.some((cid) =>
              examSubjectIds.some((sid) => teacherPairs.has(`${cid}__${sid}`))
            );
          });
        }
      }

      // 4. Merge and deduplicate, sorting by created_at
      const examMap = new Map();
      [...(ownExams || []), ...classExams].forEach(exam => examMap.set(exam.id, exam));
      
      return [...examMap.values()]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
  });
}

// Student: Personal exam data
export function useStudentStats() {
  return useQuery({
    queryKey: ["student-stats"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Use the eligible exams view (optional-subject filtered: hides exams whose
      // optional subject this student isn't enrolled in — see P3 migration).
      // Status column only — rows are bounded to this student's exams, and one
      // narrow fetch beats three head-count round trips for these buckets.
      const { data: eligibleExams } = await supabase
        .from("student_eligible_exams")
        .select("attempt_status")
        .eq("student_id", user.id)
        .eq("subject_visible", true);

      const upcoming = eligibleExams?.filter(e =>
        e.attempt_status === "available" || e.attempt_status === "not_started"
      ).length || 0;

      const inProgress = eligibleExams?.filter(e =>
        e.attempt_status === "in_progress"
      ).length || 0;

      const submitted = eligibleExams?.filter(e =>
        e.attempt_status === "submitted"
      ).length || 0;

      // Server-side head counts — previously these pulled full row sets to
      // .length them client-side, per student per dashboard load (§23).
      const [totalAttempts, publishedResults, pendingRechecks] = await Promise.all([
        headCount("student_exam_attempts", { student_id: user.id, is_submitted: true }),
        headCount("final_results", { student_id: user.id, is_published: true }),
        headCount("recheck_requests", { requested_by: user.id, status: "pending" }),
      ]);

      return {
        upcomingExams: upcoming,
        inProgressExams: inProgress,
        submittedExams: submitted,
        publishedResults,
        pendingRechecks,
        totalAttempts,
      };
    },
  });
}

export function useStudentExams() {
  return useQuery({
    queryKey: ["student-eligible-exams"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data } = await supabase
        .from("student_eligible_exams")
        .select("*")
        .eq("student_id", user.id)
        .eq("subject_visible", true)
        .order("scheduled_date", { ascending: true });

      return data || [];
    },
  });
}

export function useStudentResults() {
  return useQuery({
    queryKey: ["student-results"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Get student's attempts
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select(`
          id, exam_id, submitted_at,
          exams(title, total_marks)
        `)
        .eq("student_id", user.id)
        .eq("is_submitted", true);

      if (!attempts || attempts.length === 0) return [];

      // Get published results for these attempts
      const { data: results } = await supabase
        .from("final_results")
        .select("*")
        .in("attempt_id", attempts.map(a => a.id))
        .eq("is_published", true);

      // Merge data
      type AttemptWithExam = {
        id: string;
        submitted_at: string | null;
        exams: EmbeddedExam | EmbeddedExam[] | null;
      };
      const attemptRows = attempts as unknown as AttemptWithExam[];

      return (results || []).map(result => {
        const attempt = attemptRows.find(a => a.id === result.attempt_id);
        const exam = pickOne(attempt?.exams);
        return {
          ...result,
          examTitle: exam?.title || "Unknown Exam",
          examTotalMarks: exam?.total_marks || 0,
          submittedAt: attempt?.submitted_at,
        };
      });
    },
  });
}
