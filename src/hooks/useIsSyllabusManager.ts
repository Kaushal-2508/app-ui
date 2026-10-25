import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * Per-user institution-wide syllabus management override
 * (`syllabus_manager_overrides`). A row grants ONE named user full
 * management of the syllabus module across EVERY class and subject in
 * their institution — subjects, chapters, topics, hidden chapters and
 * segments — without changing their role. RLS side lives in migration
 * 20260725140000_syllabus_manager_overrides.sql. Sibling of
 * useIsTimetableManager / useIsStaffManager.
 *
 * Only plain teachers can hold an override that changes anything — admins
 * and coordinators already reach these surfaces via their role — so the
 * lookup is disabled for everyone else and costs a single PK read per
 * teacher session. RLS only exposes the caller's own row.
 */
export function useIsSyllabusManager() {
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
    queryKey: ["syllabus-manager-override", user?.id],
    enabled: worthChecking,
    // Permission grants effectively never change mid-session.
    staleTime: 15 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("syllabus_manager_overrides" as never)
        .select("user_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  return {
    isSyllabusManager: worthChecking ? (query.data ?? false) : false,
    // Loading only matters while we're actually deciding for a plain
    // teacher; every other role resolves to false immediately.
    isLoading: roleLoading || (worthChecking && query.isLoading),
  };
}
