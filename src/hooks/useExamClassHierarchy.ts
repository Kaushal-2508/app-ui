import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "./useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useMemo } from "react";
import { getDisplaySection } from "@/lib/sectionDisplay";
import { sortClassRows, compareClassNames } from "@/lib/classSort";

// Types for hierarchical class structure
export interface ClassSection {
  id: string;
  name: string;
  section: string | null;
  // Institution-aware section label (AISB renders LKG/UKG letters as colors).
  // Always prefer this over `section` in user-facing text.
  displaySection: string | null;
  academicYear: string | null;
  institutionId: string;
  displayName: string; // e.g., "Class 5 - Section A"
}

export interface ClassGroup {
  className: string; // e.g., "Class 5" or "Grade 5"
  classNumber: number | null; // For sorting
  sections: ClassSection[];
  isExpanded?: boolean;
}

export interface SubjectOption {
  id: string;
  name: string;
  code: string | null;
  category: string | null;
  isGlobal: boolean;
  institutionId: string | null;
}

export interface CoordinatorClassInfo {
  classId: string;
  accessType: "coordinator" | "teacher";
  subjects?: SubjectOption[]; // Only for teacher access
}

// Row shape shared by the three role-scoped queries below. The class_groups
// embed carries the canonical group label; PostgREST can hand a to-one embed
// back as an object or a single-element array depending on the join path.
interface ClassGroupEmbed {
  name: string | null;
}
interface ClassRow {
  id: string;
  name: string;
  section: string | null;
  academic_year: string | null;
  institution_id: string;
  is_active?: boolean | null;
  class_groups?: ClassGroupEmbed | ClassGroupEmbed[] | null;
}
interface SubjectEmbed {
  id: string;
  name: string;
  code: string | null;
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Parse class name to extract number for sorting
function extractClassNumber(name: string): number | null {
  // Handle patterns like "Class 5", "Grade 5", "5th Grade", "5", "V" (Roman)
  const numMatch = name.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  
  // Handle special cases
  const lowerName = name.toLowerCase();
  if (lowerName.includes("nursery") || lowerName.includes("nur")) return -2;
  if (lowerName.includes("lkg") || lowerName.includes("lower kg")) return -1;
  if (lowerName.includes("ukg") || lowerName.includes("upper kg") || lowerName.includes("kg")) return 0;
  
  return null;
}

// Fallback group label for rows whose class_groups embed is missing: strip a
// trailing section marker ONLY when it matches this row's own section. A blind
// /[a-z]$/ strip mangles letter-only class names ("UKG" -> "UK",
// "Nursery" -> "Nurser") and shows class groups that don't exist anywhere.
function legacyBaseName(name: string, section: string | null): string {
  const trimmed = name.trim();
  const sec = section?.trim();
  if (!sec) return trimmed;
  const escaped = sec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = trimmed
    .replace(new RegExp(`\\s*-?\\s*(?:section\\s*)?${escaped}$`, "i"), "")
    .trim();
  return stripped || trimmed;
}

// Group and sort classes hierarchically
function organizeClasses(classes: ClassRow[]): ClassGroup[] {
  const groupMap = new Map<string, ClassSection[]>();

  classes.forEach(cls => {
    // Canonical group label lives on class_groups — never derive it by
    // stripping letters off the class name.
    const baseName =
      pickOne(cls.class_groups)?.name?.trim() ||
      legacyBaseName(cls.name, cls.section);

    const displaySection = getDisplaySection(cls.name, cls.section);
    const section: ClassSection = {
      id: cls.id,
      name: cls.name,
      section: cls.section || null,
      displaySection: displaySection ?? (cls.section || null),
      academicYear: cls.academic_year || null,
      institutionId: cls.institution_id,
      displayName: cls.section ? `${cls.name} - Section ${displaySection ?? cls.section}` : cls.name,
    };

    const existing = groupMap.get(baseName) || [];
    existing.push(section);
    groupMap.set(baseName, existing);
  });
  
  // Convert to array and sort
  const groups: ClassGroup[] = Array.from(groupMap.entries()).map(([className, sections]) => ({
    className,
    classNumber: extractClassNumber(className),
    sections: sections.sort((a, b) => {
      // Sort sections alphabetically (A, B, C...)
      const sectionA = a.section || "";
      const sectionB = b.section || "";
      return sectionA.localeCompare(sectionB);
    }),
  }));
  
  // Sort groups using the canonical platform comparator so Nursery/LKG/UKG
  // sit before Class 1 and numeric grades stay in ascending order.
  groups.sort((a, b) => compareClassNames(a.className, b.className));
  
  return groups;
}

// Hook to fetch hierarchical classes based on user role
// IMPORTANT: Each user has exactly one primary role. Admin permissions must NOT be inherited.
export function useExamClassHierarchy(institutionId: string | null | undefined) {
  const { data: userRole } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();

  // Determine effective role - one hat at a time, never a union.
  // "admin" maps back to the concrete admin role so every downstream
  // comparison against "school_admin" / "super_school_admin" is unchanged.
  const effectiveRole = hasDualRole
    ? (activeViewRole === "admin" ? userRole?.primaryRole : activeViewRole)
    : userRole?.primaryRole;
  
  const isAdmin = effectiveRole === "super_admin" || effectiveRole === "school_admin" || effectiveRole === "super_school_admin";
  const isCoordinator = effectiveRole === "coordinator";
  const isTeacher = effectiveRole === "teacher";
  
  // For Admin: Fetch all classes in institution
  const allClassesQuery = useQuery({
    queryKey: ["exam-all-classes", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      
      const { data, error } = await supabase
        .from("classes")
        .select(
          "id, name, section, academic_year, institution_id, class_groups:class_group_id (name)"
        )
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      const rows = (data ?? []) as unknown as ClassRow[];
      return sortClassRows(rows, (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId && isAdmin,
    staleTime: 60_000,
  });
  
  // For Coordinator: Fetch wing-assigned classes
  // Coordinator sees all subjects of assigned classes but NOT unassigned classes
  const coordinatorClassesQuery = useQuery({
    queryKey: ["exam-coordinator-classes", effectiveRole],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      
      // Get classes from wing assignments
      const { data: wingClasses, error: wingError } = await supabase
        .from("wing_assignments")
        .select(`
          wing_id,
          wings:wing_id (
            id,
            name,
            wing_class_mappings (
              class_id,
              classes:class_id (
                id, name, section, academic_year, institution_id, is_active,
                class_groups:class_group_id (name)
              )
            )
          )
        `)
        .eq("user_id", user.id);

      if (wingError) throw wingError;

      type WingAssignmentRow = {
        wing_id: string;
        wings:
          | {
              id: string;
              name: string;
              wing_class_mappings:
                | { class_id: string; classes: ClassRow | ClassRow[] | null }[]
                | null;
            }
          | null;
      };

      // Extract unique classes from wings
      const rows = (wingClasses ?? []) as unknown as WingAssignmentRow[];
      const classMap = new Map<string, ClassRow & { accessType: "coordinator" }>();
      rows.forEach(wa => {
        pickOne(wa.wings)?.wing_class_mappings?.forEach(wcm => {
          const cls = pickOne(wcm.classes);
          // Skip AY-rollover leftovers (inactive class generations) — exams
          // are only created against active classes. Nested-embed filtering
          // is brittle in PostgREST, so this check stays client-side.
          if (cls && cls.is_active !== false) {
            classMap.set(wcm.class_id, {
              ...cls,
              accessType: "coordinator" as const,
            });
          }
        });
      });

      return Array.from(classMap.values());
    },
    enabled: isCoordinator,
    staleTime: 60_000,
  });
  
  // For Teacher: Fetch class assignments
  // Teacher sees ONLY assigned class-subject combinations
  // Each class-subject pair appears as separate entity
  const teacherClassesQuery = useQuery({
    queryKey: ["exam-teacher-classes", effectiveRole],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      
      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          subject_id,
          role,
          classes!class_assignments_class_id_fkey!inner (
            id, name, section, academic_year, institution_id,
            class_groups:class_group_id (name)
          ),
          subjects:subject_id (
            id, name, code
          )
        `)
        .eq("user_id", user.id)
        .eq("role", "teacher")
        // AY rollover leaves last year's class rows inactive; a stale
        // assignment would offer a dead class in the exam picker.
        .eq("classes.is_active", true);

      if (error) throw error;

      type TeacherAssignmentRow = {
        class_id: string;
        subject_id: string | null;
        role: string;
        classes: ClassRow | ClassRow[] | null;
        subjects: SubjectEmbed | SubjectEmbed[] | null;
      };

      // Group by class with subjects - but keep subjects strictly filtered
      const rows = (data ?? []) as unknown as TeacherAssignmentRow[];
      const classMap = new Map<
        string,
        { class: ClassRow & { accessType: "teacher" }; subjects: SubjectEmbed[] }
      >();
      rows.forEach(d => {
        const cls = pickOne(d.classes);
        if (!cls) return;
        const subject = pickOne(d.subjects);
        const existing = classMap.get(d.class_id);
        if (existing) {
          if (subject) existing.subjects.push(subject);
        } else {
          classMap.set(d.class_id, {
            class: { ...cls, accessType: "teacher" as const },
            subjects: subject ? [subject] : [],
          });
        }
      });

      return Array.from(classMap.values());
    },
    enabled: isTeacher,
    staleTime: 60_000,
  });
  
  // Combine data based on EFFECTIVE role - strictly one role at a time
  // Admin permissions must NOT be inherited by Teacher or Coordinator
  const { classGroups, isLoading: groupsLoading, teacherSubjectsMap } = useMemo(() => {
    let classes: ClassRow[] = [];
    const subjectsMap = new Map<string, SubjectOption[]>(); // classId -> subjects for teachers

    // Admin: sees all classes
    if (isAdmin) {
      classes = allClassesQuery.data || [];
    }
    // Coordinator: sees all subjects of assigned wing classes only
    // Must NOT see unassigned classes
    else if (isCoordinator) {
      classes = coordinatorClassesQuery.data || [];
    }
    // Teacher: sees ONLY assigned class-subject combinations
    // Each class-subject pair as separate entity
    // Must NOT see other subjects of the same class
    else if (isTeacher) {
      const teacherData = teacherClassesQuery.data || [];
      classes = teacherData.map(td => td.class);
      teacherData.forEach(td => {
        subjectsMap.set(td.class.id, td.subjects.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          category: null,
          isGlobal: false,
          institutionId: null,
        })));
      });
    }

    return {
      classGroups: organizeClasses(classes),
      isLoading: allClassesQuery.isLoading || coordinatorClassesQuery.isLoading || teacherClassesQuery.isLoading,
      teacherSubjectsMap: subjectsMap,
    };
  }, [
    isAdmin,
    isCoordinator,
    isTeacher,
    allClassesQuery.data,
    coordinatorClassesQuery.data,
    teacherClassesQuery.data,
    allClassesQuery.isLoading,
    coordinatorClassesQuery.isLoading,
    teacherClassesQuery.isLoading,
  ]);
  
  return {
    classGroups,
    isLoading: groupsLoading,
    teacherSubjectsMap,
    isAdmin,
    isCoordinator,
    isTeacher,
  };
}

// Hook to fetch subjects for a selected class
export function useExamSubjectsForClass(
  classId: string | null,
  institutionId: string | null | undefined,
  accessType: "admin" | "coordinator" | "teacher"
) {
  const { data: userRole } = useUserRole();
  
  return useQuery({
    queryKey: ["exam-subjects-for-class", classId, institutionId, accessType],
    queryFn: async () => {
      if (!classId) return [];
      
      const subjects: SubjectOption[] = [];
      
      // For admin or coordinator access, ONLY get subjects mapped to this class
      if (accessType === "admin" || accessType === "coordinator") {
        // Only fetch subjects that are mapped to this specific class via subject_class_mappings
        const { data: mappedSubjects, error: mappedError } = await supabase
          .from("subject_class_mappings")
          .select(`
            subject_id,
            universal_subjects!inner(id, name, code, category, institution_id)
          `)
          .eq("class_id", classId);
        
        if (mappedError) throw mappedError;

        type UniversalSubjectEmbed = {
          id: string;
          name: string;
          code: string | null;
          category: string | null;
          institution_id: string | null;
        };
        mappedSubjects?.forEach(ms => {
          const s = pickOne(
            ms.universal_subjects as unknown as
              | UniversalSubjectEmbed
              | UniversalSubjectEmbed[]
              | null
          );
          if (s && !subjects.some(existing => existing.id === s.id)) {
            subjects.push({
              id: s.id,
              name: s.name,
              code: s.code,
              category: s.category || null,
              isGlobal: s.institution_id === null, // Correctly determine based on institution_id
              institutionId: s.institution_id,
            });
          }
        });
      } else if (accessType === "teacher") {
        // For teachers, fetch only their assigned subjects for this class
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return [];
        
        const { data: assignments, error } = await supabase
          .from("class_assignments")
          .select(`
            subject_id,
            subjects:subject_id (id, name, code)
          `)
          .eq("user_id", user.id)
          .eq("class_id", classId)
          .not("subject_id", "is", null);
        
        if (error) throw error;
        
        assignments?.forEach(a => {
          const s = pickOne(
            a.subjects as unknown as SubjectEmbed | SubjectEmbed[] | null
          );
          if (s) {
            subjects.push({
              id: s.id,
              name: s.name,
              code: s.code,
              category: null,
              isGlobal: false,
              institutionId: null,
            });
          }
        });
      }
      
      // Sort: global first, then institute, alphabetically within each group
      return subjects.sort((a, b) => {
        if (a.isGlobal && !b.isGlobal) return -1;
        if (!a.isGlobal && b.isGlobal) return 1;
        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!classId,
    staleTime: 60_000,
  });
}
