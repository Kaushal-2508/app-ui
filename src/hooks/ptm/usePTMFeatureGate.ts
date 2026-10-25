import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { PTM_FEATURE_ID } from "@/lib/ptm";

/**
 * The same gate ProtectedRoute applies through FEATURE_URL_MAP, for pages
 * whose path carries an id (`/school/ptm/:id`, `/ptm/feedback/:token`): the
 * map matches exact pathnames, so those two gate themselves. Same rule,
 * same toast, same redirect (decision 6: PTM is behind ptm_scheduling).
 */
export function usePTMFeatureGate(): { enabled: boolean; isLoading: boolean } {
  const navigate = useNavigate();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { isFeatureEnabled, isLoading: featuresLoading } = useInstitutionFeatures();
  const { isManagingInstitution } = useInstitutionContext();

  const isLoading = roleLoading || featuresLoading;
  const shouldEnforce =
    !!roleInfo &&
    (roleInfo.isSchoolAdmin ||
      roleInfo.isTeacher ||
      roleInfo.isCoordinator ||
      roleInfo.isStudent ||
      (roleInfo.isSuperAdmin && isManagingInstitution));
  const enabled = !shouldEnforce || isFeatureEnabled(PTM_FEATURE_ID);

  useEffect(() => {
    if (isLoading || enabled) return;
    toast.error("This feature is not enabled for your institution.");
    navigate("/dashboard", { replace: true });
  }, [isLoading, enabled, navigate]);

  return { enabled, isLoading };
}
