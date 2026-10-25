import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * Per-user "manage teaching staff" override (`staff_manager_overrides`).
 * A row in that table grants ONE named user the non-destructive subset of
 * the Teachers tab — view all teachers, assign/bulk-assign classes &
 * subjects, edit basic details, export, assign tasks — WITHOUT changing
 * their role. It does NOT confer account create/delete or Make Coordinator
 * (those stay admin/coordinator-only). RLS side lives in migration
 * 20260714120000_staff_manager_overrides.sql. Sibling of
 * useIsTimetableManager.
 *
 * Only plain teachers can hold an override that changes anything — admins
 * and coordinators already reach these surfaces via their role — so the
 * lookup is disabled for everyone else and costs a single PK read per
 * teacher session. RLS only exposes the caller's own row.
 */
export function useIsStaffManager() {
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
    queryKey: ["staff-manager-override", user?.id],
    enabled: worthChecking,
    // Permission grants effectively never change mid-session.
    staleTime: 15 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("staff_manager_overrides" as never)
        .select("user_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  return {
    isStaffManager: worthChecking ? (query.data ?? false) : false,
    // Loading only matters while we're actually deciding for a plain
    // teacher; every other role resolves to false immediately.
    isLoading: roleLoading || (worthChecking && query.isLoading),
  };
}
