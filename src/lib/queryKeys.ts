import { QueryClient } from "@tanstack/react-query";

export const queryKeys = {
  schoolStudents: (institutionId?: string) => ["school-students", institutionId] as const,
  schoolTeachers: (institutionId?: string) => ["school-teachers", institutionId] as const,
  schoolCoordinators: (institutionId?: string) => ["school-coordinators", institutionId] as const,
  schoolClasses: (institutionId?: string) => ["school-classes", institutionId] as const,
  institutionClasses: (institutionId?: string) => ["institution-classes", institutionId] as const,
  userWingAssignments: (userId?: string) => ["user-wing-assignments", userId] as const,
  userClassAssignments: (userId?: string, role?: string) => ["user-class-assignments", userId, role] as const,
  wings: (institutionId?: string) => ["wings", institutionId] as const,
  adminStats: (institutionId?: string) => ["school-admin-stats", institutionId] as const,
  // Command Center
  commandCenterExamPipeline: (institutionId?: string) => ["command-center-exam-pipeline", institutionId] as const,
  commandCenterAttendanceToday: (institutionId?: string) => ["command-center-attendance-today", institutionId] as const,
  commandCenterStudentPositioning: (institutionId?: string) => ["command-center-student-positioning", institutionId] as const,
  commandCenterAcademicYears: (institutionId?: string) => ["command-center-academic-years", institutionId] as const,
  // Exam Creation Flow
  examTemplates: (institutionId?: string) => ["exam-templates", institutionId] as const,
  examDrafts: (userId?: string, institutionId?: string) => ["exam-drafts", userId, institutionId] as const,
  examLockStatus: (examId?: string) => ["exam-lock-status", examId] as const,
  offlineMarks: (examId?: string) => ["offline-marks", examId] as const,
  // Distinct from offlineMarks: backs the SECTION-based pipeline
  // (useOfflineMarksEntry -> offline_section_marks) used by the results-only
  // ("Already Created") flow. MUST NOT share a key with offlineMarks (legacy
  // total-per-student -> offline_student_marks) — the cached shapes are
  // incompatible and a shared key causes a wrong-shape cache crash.
  offlineSectionMarks: (examId?: string) => ["offline-section-marks", examId] as const,
  offlineMarksStudents: (examId?: string) => ["offline-marks-students", examId] as const,
} as const;

/**
 * Invalidates all school-related data queries for a given institution.
 * Uses prefix matching to ensure all related queries are invalidated.
 */
export const invalidateSchoolData = (queryClient: QueryClient, institutionId?: string) => {
  // Invalidate with prefix matching - this catches all variations
  queryClient.invalidateQueries({ queryKey: ["school-students"] });
  queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
  queryClient.invalidateQueries({ queryKey: ["school-coordinators"] });
  queryClient.invalidateQueries({ queryKey: ["school-classes"] });
  queryClient.invalidateQueries({ queryKey: ["school-admin-stats"] });
  queryClient.invalidateQueries({ queryKey: ["institution-classes"] });
  queryClient.invalidateQueries({ queryKey: ["wings"] });
  
  // Also refetch the specific institution data for immediate update
  if (institutionId) {
    queryClient.refetchQueries({ queryKey: ["school-students", institutionId] });
    queryClient.refetchQueries({ queryKey: ["school-teachers", institutionId] });
    queryClient.refetchQueries({ queryKey: ["school-coordinators", institutionId] });
  }
};

/**
 * Invalidates user assignment queries after changes
 */
export const invalidateUserAssignments = (queryClient: QueryClient, userId?: string) => {
  queryClient.invalidateQueries({ queryKey: ["user-wing-assignments"] });
  queryClient.invalidateQueries({ queryKey: ["user-class-assignments"] });
  queryClient.invalidateQueries({ queryKey: ["class-assignments"] });
  
  if (userId) {
    queryClient.invalidateQueries({ queryKey: ["user-wing-assignments", userId] });
    queryClient.invalidateQueries({ queryKey: ["user-class-assignments", userId] });
  }
};

/**
 * Invalidates user role data for session updates
 */
export const invalidateUserRoleData = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: ["user-role-info"] });
};

/**
 * Invalidates every query that backs the Syllabus pages (school + admin) and
 * the syllabus dialogs. Call this from any mutation that adds/updates/deletes
 * grades, subjects, chapters (topics), or study materials so the UI refreshes
 * without a manual page reload.
 *
 * The SchoolSyllabusPage uses versioned query keys (see
 * `useInstitutionSyllabusTree`, `useInstitutionClassesWithCounts`,
 * `useInstitutionSubjectsForClass`, `useInstitutionTopics`). Those keys must
 * be invalidated explicitly — `["institution-syllabus-tree"]` does NOT match
 * `["institution-syllabus-tree-v5", …]` because React Query's prefix match
 * compares each array element exactly. Tree key bumped to `-v5` (2026-05-13)
 * when `institution_id` + `hidden_in_institution` were added to the topic
 * shape so the trash icon and Hide button render correctly on global rows.
 */
export const invalidateSyllabusCache = (queryClient: QueryClient) => {
  // SchoolSyllabusPage — versioned keys
  queryClient.invalidateQueries({ queryKey: ["institution-syllabus-tree-v5"] });
  queryClient.invalidateQueries({ queryKey: ["institution-classes-counts-v3"] });
  queryClient.invalidateQueries({ queryKey: ["institution-subjects-class-v3"] });
  queryClient.invalidateQueries({ queryKey: ["institution-topics-v3"] });

  // Admin SyllabusPage — from useSyllabusHierarchy
  queryClient.invalidateQueries({ queryKey: ["grades-with-counts"] });
  queryClient.invalidateQueries({ queryKey: ["subjects-by-grade"] });
  queryClient.invalidateQueries({ queryKey: ["topics-by-grade-subject"] });
  queryClient.invalidateQueries({ queryKey: ["full-syllabus-tree"] });
  queryClient.invalidateQueries({ queryKey: ["all-universal-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["materials-by-topic"] });
  queryClient.invalidateQueries({ queryKey: ["available-subjects-for-grade"] });

  // Dialog-local read caches that depend on the same DB rows
  queryClient.invalidateQueries({ queryKey: ["class-subjects-for-material"] });
  queryClient.invalidateQueries({ queryKey: ["class-topics-for-material"] });
  queryClient.invalidateQueries({ queryKey: ["class-subjects-for-topic-multi"] });
  queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
  queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
};
