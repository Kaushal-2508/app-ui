import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "./useUserRole";
import { useAuth } from "./useAuth";

interface CanEditResult {
  canEdit: boolean;
  reason?: string;
}

/**
 * Hook to determine whether the current user may reset a target user's password.
 *
 * Access is limited to administrators and coordinators — teachers cannot reset
 * passwords. These rules MIRROR the authoritative server-side gate in the
 * `admin-operations` edge function (`reset_user_password`); the client check is
 * purely for UX (show the form vs. an explanation). The server remains the
 * source of truth.
 *
 * Access rules:
 * - Super admin: any user.
 * - School admin / super school admin: any user in their institution, except
 *   another administrator (self excluded).
 * - Coordinator: any student/teacher in their institution, but NOT an
 *   administrator or a fellow coordinator.
 *
 * Reliability: current user comes from `useAuth` (local session), and the query
 * is gated only on `userId` + `roleInfo` — both reliably present once the app
 * has loaded. A previous version gated on a separate JWT-less `getUser()` query;
 * when that hadn't resolved the query sat disabled and returned `undefined`,
 * which the dialog rendered as a false "no permission" denial.
 */
export function useCanEditStudentPassword(userId: string | null) {
  const { data: roleInfo } = useUserRole();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  return useQuery({
    queryKey: [
      "can-edit-student-password",
      userId,
      roleInfo?.primaryRole,
      roleInfo?.institutionId,
      currentUserId,
    ],
    queryFn: async (): Promise<CanEditResult> => {
      if (!userId) {
        return { canEdit: false, reason: "No user selected" };
      }

      // Super admin can reset anyone.
      if (roleInfo?.isSuperAdmin) {
        return { canEdit: true };
      }

      // Only administrators and coordinators may reset passwords (teachers excluded).
      // `isSchoolAdmin` is inclusive of super_school_admin (see useUserRole).
      if (!roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator) {
        return {
          canEdit: false,
          reason: "Only administrators and coordinators can reset passwords.",
        };
      }

      // Resolve the target user's institution.
      const { data: targetProfile, error: targetError } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", userId)
        .single();

      if (targetError || !targetProfile) {
        return { canEdit: false, reason: "User not found" };
      }

      // Same-institution only for school-level roles.
      if (!roleInfo.institutionId || roleInfo.institutionId !== targetProfile.institution_id) {
        return { canEdit: false, reason: "This user belongs to a different institution." };
      }

      // Resolve the target user's roles (a user may hold several).
      const { data: targetRoles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      const roles = (targetRoles ?? []).map((r) => r.role as string);
      const targetIsAdmin =
        roles.includes("super_admin") ||
        roles.includes("super_school_admin") ||
        roles.includes("school_admin");
      const targetIsCoordinator = roles.includes("coordinator");

      // School admins: institution-wide, but cannot reset another administrator
      // (they may reset their own password).
      if (roleInfo.isSchoolAdmin) {
        if (targetIsAdmin && userId !== currentUserId) {
          return {
            canEdit: false,
            reason: "You cannot reset another administrator's password.",
          };
        }
        return { canEdit: true };
      }

      // Coordinators: institution-wide, but cannot reset administrators or
      // fellow coordinators.
      if (targetIsAdmin || targetIsCoordinator) {
        return {
          canEdit: false,
          reason: "Coordinators cannot reset an administrator's or coordinator's password.",
        };
      }

      return { canEdit: true };
    },
    // Gate only on inputs that are reliably present once the app has loaded.
    enabled: !!userId && !!roleInfo,
    staleTime: 60_000,
  });
}
