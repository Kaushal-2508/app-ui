import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole, type AppRole } from "@/hooks/useUserRole";
import { useIsTimetableManager } from "@/hooks/useIsTimetableManager";
import { useIsStaffManager } from "@/hooks/useIsStaffManager";
import { useIsStudentManager } from "@/hooks/useIsStudentManager";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { useIsOlympiadOnlyInstitution, olympiadHomePath } from "@/hooks/olympiad/useIsOlympiadOnlyInstitution";
import { FEATURE_URL_MAP } from "@/components/admin/institution-wizard/featuresData";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "./AppLayout";
import { toast } from "sonner";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
  /**
   * Timetable/Calendar routes only: also admit a user holding a
   * `tt_manager_overrides` grant (per-user full timetable management,
   * no role change) even when their role isn't in `allowedRoles`.
   */
  allowTimetableManagerOverride?: boolean;
  /**
   * Teachers-management route only: also admit a user holding a
   * `staff_manager_overrides` grant (per-user manage-teaching-staff
   * rights, no role change) even when their role isn't in `allowedRoles`.
   */
  allowStaffManagerOverride?: boolean;
  /**
   * Students-management route only: also admit a user holding a
   * `student_manager_overrides` grant (per-user manage-students rights,
   * no role change) even when their role isn't in `allowedRoles`.
   */
  allowStudentManagerOverride?: boolean;
}

export function ProtectedRoute({ children, allowedRoles, allowTimetableManagerOverride, allowStaffManagerOverride, allowStudentManagerOverride }: ProtectedRouteProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  // Cheap: both are internally disabled for every role except plain
  // teachers, and only consulted when the route opts in via a prop.
  const { isTimetableManager, isLoading: ttOverrideLoading } = useIsTimetableManager();
  const { isStaffManager, isLoading: staffOverrideLoading } = useIsStaffManager();
  const { isStudentManager, isLoading: studentOverrideLoading } = useIsStudentManager();
  const overrideLoading = ttOverrideLoading || staffOverrideLoading || studentOverrideLoading;
  const { isFeatureEnabled, isLoading: featuresLoading } = useInstitutionFeatures();
  const { isManagingInstitution } = useInstitutionContext();
  const { isOlympiadOnly, isLoading: olyLoading } = useIsOlympiadOnlyInstitution();

  // Remember the page a signed-out visitor asked for, so the login page can
  // bring them back to it (the PTM feedback QR depends on this; see
  // src/lib/returnPath.ts for what is honoured). Replace, so the page is not
  // left under the login screen: back from login would reopen it only to be
  // sent to login again, and after sign-in it would sit in history twice.
  const requestedPath = `${location.pathname}${location.search}${location.hash}`;
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login", { state: { from: requestedPath }, replace: true });
    }
  }, [authLoading, user, navigate, requestedPath]);

  useEffect(() => {
    // Check role access after role info is loaded. Only for a signed-in user:
    // for a signed-out visitor the role query answers `roles: []`, and judging
    // that sent them to /dashboard right after the effect above sent them to
    // login, so the page they asked for was lost (the PTM feedback QR landed
    // families on the dashboard after sign-in).
    if (!user) return;
    if (!roleLoading && roleInfo && allowedRoles && allowedRoles.length > 0) {
      const hasAccess = allowedRoles.some((role) => roleInfo.roles.includes(role));
      if (hasAccess) return;
      if (allowTimetableManagerOverride || allowStaffManagerOverride || allowStudentManagerOverride) {
        // Don't bounce while an override grant is still resolving.
        if (overrideLoading) return;
        if (allowTimetableManagerOverride && isTimetableManager) return;
        if (allowStaffManagerOverride && isStaffManager) return;
        if (allowStudentManagerOverride && isStudentManager) return;
      }
      navigate("/dashboard");
    }
  }, [user, roleLoading, roleInfo, allowedRoles, allowTimetableManagerOverride, allowStaffManagerOverride, allowStudentManagerOverride, overrideLoading, isTimetableManager, isStaffManager, isStudentManager, navigate]);

  // Feature gating: block direct URL access to disabled features.
  // Enforced for every institution-bound role — sidebar gating already
  // hides the tab, but a typed/bookmarked URL would otherwise still load
  // the page (e.g. a student visiting /student/fees when fees is off).
  useEffect(() => {
    // Wait for the Olympiad-only detection too, so the generic gate never
    // fires a stray "feature not enabled" toast on a /school/olympiad cold
    // load before we know the institution is Olympiad-only.
    if (roleLoading || featuresLoading || olyLoading) return;
    const shouldEnforce =
      roleInfo?.isSchoolAdmin ||
      roleInfo?.isTeacher ||
      roleInfo?.isCoordinator ||
      roleInfo?.isStudent ||
      (roleInfo?.isSuperAdmin && isManagingInstitution);
    if (!shouldEnforce) return;

    // Olympiad-only (onboarded) schools are governed solely by the lockdown
    // guard below. Their Olympiad access must NOT depend on the
    // institution_features `olympiad` flag — without this bail the generic
    // gate toasts "feature not enabled" and bounces /school/olympiad back to
    // /dashboard, which the lockdown sends straight back: an infinite loop.
    if (isOlympiadOnly && !roleInfo?.isSuperAdmin) return;

    const featureId = FEATURE_URL_MAP[location.pathname];
    if (featureId && !isFeatureEnabled(featureId)) {
      toast.error("This feature is not enabled for your institution.");
      navigate("/dashboard", { replace: true });
    }
  }, [location.pathname, roleLoading, featuresLoading, olyLoading, roleInfo, isManagingInstitution, isFeatureEnabled, isOlympiadOnly, navigate]);

  // Olympiad-only lockdown: onboarded (net-new) schools expose ONLY the
  // Olympiad workspace. Block any other authenticated route (typed/bookmarked
  // URL) and bounce back to the role's Olympiad home. Never applies to super
  // admins. Settings stays reachable for account/password management.
  useEffect(() => {
    if (roleLoading) return;
    if (!roleInfo || roleInfo.isSuperAdmin || !isOlympiadOnly) return;

    const p = location.pathname;
    const allowed =
      p === "/dashboard" ||
      // Salci Support. This guard is an ALLOWLIST, so without this line an
      // onboarded (Olympiad-only) school's users get bounced straight off a
      // page whose entry button is visible to them in the sidebar footer.
      // Their tickets are the ones most likely to be about onboarding.
      p === "/support" ||
      p.startsWith("/school/olympiad") ||
      p.startsWith("/teacher/olympiad") ||
      p.startsWith("/student/olympiad") ||
      p.startsWith("/olympiad") ||
      p.startsWith("/settings");
    if (!allowed) {
      navigate(olympiadHomePath(roleInfo), { replace: true });
    }
  }, [location.pathname, roleLoading, roleInfo, isOlympiadOnly, navigate]);

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="space-y-4 w-full max-w-md">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <AppLayout>{children}</AppLayout>;
}
