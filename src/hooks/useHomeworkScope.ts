import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useTeacherAssignedSubjects } from "@/hooks/useTeacherAssignedSubjects";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { useClasses } from "@/hooks/useClasses";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

export interface ScopeClass {
  id: string;
  name: string;
  section: string | null;
}
export interface ScopeSubject {
  id: string;
  name: string;
}

type UniversalSubjectRef = { id: string; name: string };
type SubjMapRow = {
  subject_id: string;
  universal_subjects: UniversalSubjectRef | UniversalSubjectRef[] | null;
};
function pickOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Returns the classes the current user may assign homework to (role-scoped)
 * and, given the chosen class ids, the subjects valid for them.
 * - teacher    -> own class_assignments (class+subject pairs)
 * - coordinator-> wing classes (subjects via useClassSubjects per class)
 * - admin      -> all institution classes (subjects via useClassSubjects)
 *
 * Composes existing role-scoped hooks (no new queries); each composed hook
 * keeps its own `staleTime`.
 */
export function useHomeworkScope(selectedClassIds: string[]) {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { institutionId } = useEffectiveInstitution();
  const { activeViewRole, hasDualRole } = useActiveRole();

  // Admins/super-admins scope to the whole institution. Any user who can switch
  // views follows the active view-role toggle (RoleSwitcher → ActiveRoleContext):
  // teacher mode shows only their taught classes, coordinator mode shows their
  // wing classes — never both. That covers teacher+coordinator AND an admin who
  // also teaches: in teacher mode they get their taught classes, not the whole
  // institution. Single-role users fall through to their one role.
  const isAdminScope =
    (!!roleInfo?.isSchoolAdmin || !!roleInfo?.isSuperAdmin) &&
    (!hasDualRole || activeViewRole === "admin");
  const isTeacherScope =
    !isAdminScope &&
    (hasDualRole
      ? activeViewRole === "teacher"
      : !!roleInfo?.isTeacher && !roleInfo?.isCoordinator);
  const isCoordinatorScope =
    !isAdminScope &&
    !isTeacherScope &&
    (hasDualRole ? activeViewRole === "coordinator" : !!roleInfo?.isCoordinator);

  const teacher = useTeacherAssignedSubjects(); // { grouped, flat, classIds, subjectIds }
  const coordinator = useCoordinatorClasses(); // { classes, classIds, isCoordinator, isLoading }
  const adminClasses = useClasses(institutionId); // institution classes (admins / super-admins)

  // For coordinator/admin: union of subjects across ALL selected classes
  // (class_group mappings preferred per §22, legacy per-section fallback).
  const classSubjectsUnion = useQuery({
    queryKey: ["homework-scope-subjects", [...selectedClassIds].sort(), institutionId],
    enabled: !isTeacherScope && selectedClassIds.length > 0 && !!institutionId,
    staleTime: 60_000,
    queryFn: async (): Promise<ScopeSubject[]> => {
      const { data: classRows } = await supabase
        .from("classes")
        .select("id, class_group_id")
        .in("id", selectedClassIds);
      const groupIds = [
        ...new Set(
          (classRows ?? [])
            .map((c) => (c as { class_group_id: string | null }).class_group_id)
            .filter((g): g is string => !!g),
        ),
      ];
      const map = new Map<string, ScopeSubject>();
      const collect = (rows: SubjMapRow[] | null) => {
        (rows ?? []).forEach((m) => {
          const us = pickOne(m.universal_subjects);
          if (us) map.set(us.id, { id: us.id, name: us.name });
        });
      };
      if (groupIds.length > 0) {
        const { data } = await supabase
          .from("subject_class_group_mappings" as never)
          .select("subject_id, universal_subjects!inner(id, name)")
          .in("class_group_id", groupIds)
          .eq("institution_id", institutionId!);
        collect(data as unknown as SubjMapRow[] | null);
      }
      // Legacy fallback when the group-level read produced no subjects.
      if (map.size === 0) {
        const { data } = await supabase
          .from("subject_class_mappings")
          .select("subject_id, universal_subjects!inner(id, name)")
          .in("class_id", selectedClassIds)
          .eq("institution_id", institutionId!);
        collect(data as unknown as SubjMapRow[] | null);
      }
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const classes: ScopeClass[] = useMemo(() => {
    if (isTeacherScope) {
      return (
        teacher.data?.grouped.map((g) => ({
          id: g.classId,
          name: g.className,
          section: g.section,
        })) ?? []
      );
    }
    if (isCoordinatorScope) {
      return coordinator.classes.map((c) => ({
        id: c.id,
        name: c.name,
        section: c.section ?? null,
      }));
    }
    return (adminClasses.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      section: c.section ?? null,
    }));
  }, [isTeacherScope, isCoordinatorScope, teacher.data, coordinator.classes, adminClasses.data]);

  const subjects: ScopeSubject[] = useMemo(() => {
    if (isTeacherScope) {
      // Union of subjects taught across the selected classes.
      const grouped = teacher.data?.grouped ?? [];
      const picked = grouped.filter((g) => selectedClassIds.includes(g.classId));
      const map = new Map<string, ScopeSubject>();
      picked.forEach((g) => g.subjects.forEach((s) => map.set(s.id, { id: s.id, name: s.name })));
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    return classSubjectsUnion.data ?? [];
  }, [isTeacherScope, teacher.data, selectedClassIds, classSubjectsUnion.data]);

  return {
    classes,
    subjects,
    isLoading:
      roleLoading ||
      teacher.isLoading ||
      coordinator.isLoading ||
      adminClasses.isLoading ||
      classSubjectsUnion.isLoading,
  };
}
