import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * Per-user institution-wide "manage students" override
 * (`student_manager_overrides`). A row grants ONE named user full
 * management of the student roster across the institution — add/remove
 * student accounts, edit details, enrol into classes, personal details,
 * optional-subject choices — without changing their role. RLS side lives
 * in migration 20260728120000_student_manager_overrides.sql. Sibling of
 * useIsTimetableManager / useIsStaffManager / useIsSyllabusManager.
 *
 * Only plain teachers can hold an override that changes anything — admins
 * and coordinators already reach these surfaces via their role — so the
 * lookup is disabled for everyone else and costs a single PK read per
 * teacher session. RLS only exposes the caller's own row.
 */
export function useIsStudentManager() {
  const { user } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();

  const worthChecking =
    !!user &&
    !!roleInfo &&
    roleInfo.isTeacher &&
    !roleInfo.isSchoolAdmin &&
    !roleInfo.isCoordinator &&
    !roleInfo.isSuperAdmin;

  const query = useQuery({
    queryKey: ["student-manager-override", user?.id],
    enabled: worthChecking,
    // Permission grants effectively never change mid-session.
    staleTime: 15 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("student_manager_overrides" as never)
        .select("user_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  return {
    isStudentManager: worthChecking ? (query.data ?? false) : false,
    // Loading only matters while we're actually deciding for a plain
    // teacher; every other role resolves to false immediately.
    isLoading: roleLoading || (worthChecking && query.isLoading),
  };
}
