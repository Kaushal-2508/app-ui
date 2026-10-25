import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionContext } from "@/contexts/InstitutionContext";

/**
 * Hook that returns the effective institution ID for the current user.
 * For Super Admins managing an institution, it returns the managed institution ID.
 * For other users, it returns their own institution ID.
 */
export function useEffectiveInstitution() {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { 
    managedInstitutionId, 
    managedInstitution, 
    isManagingInstitution, 
    isLoading: contextLoading 
  } = useInstitutionContext();

  // If Super Admin is managing an institution, use that
  const effectiveInstitutionId = 
    roleInfo?.isSuperAdmin && isManagingInstitution && managedInstitutionId
      ? managedInstitutionId
      : roleInfo?.institutionId || null;

  return {
    institutionId: effectiveInstitutionId,
    institutionName: isManagingInstitution ? managedInstitution?.name : null,
    isManagingAsAdmin: roleInfo?.isSuperAdmin && isManagingInstitution,
    isLoading: roleLoading || contextLoading,
    roleInfo,
  };
}
