import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { sortClassRows } from "@/lib/classSort";

/**
 * Explicit row caps. PostgREST silently truncates at 1000 rows, which reads as
 * "those rows don't exist" rather than as an error (§23), so every list here is
 * bounded well under the cap.
 */
const WING_CLASS_LIMIT = 500;
const EXAM_LIST_LIMIT = 500;

export interface CoordinatorClassesData {
  classIds: string[];
  wingIds: string[];
  classes: Array<{
    id: string;
    name: string;
    section: string | null;
    studentCount?: number;
    teacherCount?: number;
  }>;
  isLoading: boolean;
  /**
   * The wing lookup FAILED. Distinct from "resolved to no classes": callers
   * scope to `classIds` unconditionally (an empty list must show nothing, never
   * the whole institution), so without this flag a failed lookup is
   * indistinguishable from a coordinator who genuinely covers nothing and reads
   * as "no data" instead of an error (§6).
   */
  isError: boolean;
  isCoordinator: boolean;
}

/**
 * Hook to get the classes accessible to a coordinator based on their wing assignments.
 * Returns class IDs, wing IDs, and detailed class information.
 * 
 * For non-coordinators, returns empty arrays.
 */
export function useCoordinatorClasses(): CoordinatorClassesData {
  const { user } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  
  const isCoordinator = roleInfo?.isCoordinator || false;
  const userId = user?.id;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["coordinator-classes", userId],
    queryFn: async () => {
      if (!userId) return { classIds: [], wingIds: [], classes: [] };

      // Get user's wing assignments
      const { data: wingAssignments, error: wingError } = await supabase
        .from("wing_assignments")
        .select("wing_id")
        .eq("user_id", userId);

      if (wingError) throw wingError;

      const wingIds = wingAssignments?.map((a) => a.wing_id) || [];

      if (wingIds.length === 0) {
        return { classIds: [], wingIds: [], classes: [] };
      }

      // Get classes from wing_class_mappings with details.
      // Ordered so `classIds` is deterministic: it is spread into the query key
      // of useCoordinatorExams, and an unstable order would mint a new cache
      // entry (and a refetch) on every mount.
      const { data: classMappings, error: classError } = await supabase
        .from("wing_class_mappings")
        .select(`
          class_id,
          classes:class_id (
            id,
            name,
            section,
            is_active
          )
        `)
        .in("wing_id", wingIds)
        .order("class_id", { ascending: true })
        .range(0, WING_CLASS_LIMIT - 1);

      if (classError) throw classError;

      // PostgREST types a to-one embed as `T | T[]`; pickOne normalises it.
      type WingClassRow = {
        class_id: string;
        classes: { id: string; name: string; section: string | null; is_active: boolean } | null;
      };

      // Get unique classes
      const classesMap = new Map<string, { id: string; name: string; section: string | null }>();
      ((classMappings ?? []) as unknown as WingClassRow[]).forEach((cm) => {
        if (cm.classes && cm.classes.is_active) {
          classesMap.set(cm.class_id, {
            id: cm.classes.id,
            name: cm.classes.name,
            section: cm.classes.section,
          });
        }
      });

      const classIds = [...classesMap.keys()];
      const classes = [...classesMap.values()];

      return { classIds, wingIds, classes };
    },
    enabled: !!userId && isCoordinator,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    classIds: data?.classIds || [],
    wingIds: data?.wingIds || [],
    classes: data?.classes || [],
    isLoading: isLoading || roleLoading,
    isError,
    isCoordinator,
  };
}

/**
 * Hook to get detailed class information with student/teacher counts for coordinator dashboard.
 */
export function useCoordinatorClassDetails() {
  const { user } = useAuth();
  const { classIds, isCoordinator } = useCoordinatorClasses();
  const userId = user?.id;

  return useQuery({
    queryKey: ["coordinator-class-details", userId, classIds],
    queryFn: async () => {
      if (classIds.length === 0) return [];

      // Get classes with counts
      const { data: classes, error: classError } = await supabase
        .from("classes")
        .select("id, name, section")
        .in("id", classIds)
        .eq("is_active", true)
        .order("name");

      if (classError) throw classError;

      // Get student counts per class
      const { data: studentCounts, error: studentError } = await supabase
        .from("class_assignments")
        .select("class_id")
        .in("class_id", classIds)
        .eq("role", "student");

      if (studentError) throw studentError;

      // Get teacher counts per class
      const { data: teacherCounts, error: teacherError } = await supabase
        .from("class_assignments")
        .select("class_id")
        .in("class_id", classIds)
        .eq("role", "teacher");

      if (teacherError) throw teacherError;

      // Count per class
      const studentCountMap = new Map<string, number>();
      const teacherCountMap = new Map<string, number>();

      studentCounts?.forEach((sc) => {
        studentCountMap.set(sc.class_id, (studentCountMap.get(sc.class_id) || 0) + 1);
      });

      teacherCounts?.forEach((tc) => {
        teacherCountMap.set(tc.class_id, (teacherCountMap.get(tc.class_id) || 0) + 1);
      });

      const enriched = (classes || []).map((cls) => ({
        ...cls,
        studentCount: studentCountMap.get(cls.id) || 0,
        teacherCount: teacherCountMap.get(cls.id) || 0,
      }));
      return sortClassRows(enriched, (c) => c.name, (c) => c.section);
    },
    enabled: classIds.length > 0 && isCoordinator,
  });
}

/**
 * Check if the current user is a coordinator for a specific class.
 * Uses the database function is_coordinator_for_class.
 */
export function useIsCoordinatorForClass(classId: string | null) {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ["is-coordinator-for-class", userId, classId],
    queryFn: async () => {
      if (!userId || !classId) return false;

      const { data, error } = await supabase.rpc("is_coordinator_for_class", {
        _user_id: userId,
        _class_id: classId,
      });

      if (error) {
        console.error("Error checking coordinator access:", error);
        return false;
      }

      return data || false;
    },
    enabled: !!userId && !!classId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to get exams accessible to a coordinator (from their assigned classes).
 */
export function useCoordinatorExams() {
  const { user } = useAuth();
  const { classIds, isCoordinator } = useCoordinatorClasses();
  const userId = user?.id;

  return useQuery({
    queryKey: ["coordinator-exams", userId, classIds],
    staleTime: 60_000,
    queryFn: async () => {
      if (!userId || classIds.length === 0) return [];

      // Must stay in step with TEACHER_EXAM_SELECT in useDashboardData.ts:
      // ExamsPage merges both lists for dual teacher+coordinator users.
      const examSelect = `
        id, title, status, exam_mode, is_offline, is_results_only, scheduled_date, start_time, end_time, total_marks, duration_minutes, created_at, created_by,
        exam_classes(class_id, classes(name, section)),
        exam_subjects(subject_id, universal_subjects(name)),
        profiles!exams_created_by_fkey(full_name)
      `;

      // Get exams created by the coordinator
      const { data: ownExams, error: ownError } = await supabase
        .from("exams")
        .select(examSelect)
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .range(0, EXAM_LIST_LIMIT - 1);

      if (ownError) throw ownError;

      // Get exam IDs assigned to coordinator's classes. One row per
      // (exam x class), so this is the widest list in the hook.
      const { data: classExamMappings, error: mappingError } = await supabase
        .from("exam_classes")
        .select("exam_id")
        .in("class_id", classIds)
        .order("exam_id", { ascending: true })
        .range(0, EXAM_LIST_LIMIT * 2 - 1);

      if (mappingError) throw mappingError;

      const classExamIds = [...new Set(classExamMappings?.map((e) => e.exam_id) || [])];

      type CoordExamRow = { id: string; created_at: string };
      const ownExamRows = (ownExams || []) as CoordExamRow[];
      // Get those exams if any
      let classExams: CoordExamRow[] = [];
      if (classExamIds.length > 0) {
        const { data, error } = await supabase
          .from("exams")
          .select(examSelect)
          .in("id", classExamIds)
          .order("created_at", { ascending: false })
          .range(0, EXAM_LIST_LIMIT - 1);

        if (error) throw error;
        classExams = (data || []) as CoordExamRow[];
      }

      // Merge and deduplicate
      const examMap = new Map<string, CoordExamRow>();
      [...ownExamRows, ...classExams].forEach((exam) => {
        examMap.set(exam.id, exam);
      });

      return [...examMap.values()].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    enabled: !!userId && isCoordinator && classIds.length > 0,
  });
}
