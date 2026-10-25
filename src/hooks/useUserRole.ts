import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export interface UserRoleInfo {
  roles: AppRole[];
  primaryRole: AppRole | null;
  institutionId: string | null;
  isSuperAdmin: boolean;
  isSuperSchoolAdmin: boolean;
  /** True for both school_admin AND super_school_admin (inclusive) */
  isSchoolAdmin: boolean;
  isCoordinator: boolean;
  isTeacher: boolean;
  isStudent: boolean;
  isEmployee: boolean;
  employeeLevelId: string | null;
  /** True if user has both teacher and coordinator roles */
  hasDualTeacherCoordinatorRole: boolean;
  /** True if user has both a school-admin role and the teacher role */
  hasDualAdminTeacherRole: boolean;
}

export function useUserRole() {
  return useQuery({
    queryKey: ["user-role-info"],
    queryFn: async (): Promise<UserRoleInfo> => {
      // Every read below THROWS on failure. This answer scopes every
      // institution query in the app, and it used to swallow errors: offline,
      // a failed read resolved as a successful "no roles, no institution",
      // every list went empty, the reconnect did not refetch it (still fresh
      // for staleTime) and queryPersist restored it on relaunch, so only
      // sign-out recovered (Play test build, 2026-09-30). A throw keeps the
      // last good answer on screen and refetches on the next mount. Guarded by
      // `npm run test:role-offline`.
      // getSession() rather than getCurrentUser(), which drops the error: a
      // token due for refresh fails offline, and that is not "signed out".
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = session?.user;
      if (!user) {
        return {
          roles: [],
          primaryRole: null,
          institutionId: null,
          isSuperAdmin: false,
          isSuperSchoolAdmin: false,
          isSchoolAdmin: false,
          isCoordinator: false,
          isTeacher: false,
          isStudent: false,
          isEmployee: false,
          employeeLevelId: null,
          hasDualTeacherCoordinatorRole: false,
          hasDualAdminTeacherRole: false,
        };
      }

      // Roles and the profile's institution together, not one after the
      // other: every ProtectedRoute waits on this query, so on a phone with a
      // weak signal the second round trip was a visible pause on cold start.
      const [rolesResult, profileResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role, institution_id, employee_level_id")
          .eq("user_id", user.id),
        // maybeSingle, not single: a missing profile row is not a failure, it
        // falls back to the role row's institution below as it always has.
        supabase
          .from("profiles")
          .select("institution_id")
          .eq("id", user.id)
          .maybeSingle(),
      ]);
      if (rolesResult.error) throw rolesResult.error;
      if (profileResult.error) throw profileResult.error;
      const userRoles = rolesResult.data;
      const profile = profileResult.data;

      const roles = userRoles?.map(r => r.role) || [];
      
      // Priority order for primary role
      const rolePriority: AppRole[] = ["super_admin", "super_school_admin", "school_admin", "coordinator", "teacher", "employee", "student"];
      const primaryRole = rolePriority.find(r => roles.includes(r)) || null;

      const employeeRole = userRoles?.find(r => r.role === "employee");
      const isTeacher = roles.includes("teacher");
      const isCoordinator = roles.includes("coordinator");
      const isSuperSchoolAdmin = roles.includes("super_school_admin" as AppRole);
      
      return {
        roles,
        primaryRole,
        institutionId: profile?.institution_id || userRoles?.[0]?.institution_id || null,
        isSuperAdmin: roles.includes("super_admin"),
        isSuperSchoolAdmin,
        // Inclusive: super_school_admin gets all school_admin powers automatically
        isSchoolAdmin: roles.includes("school_admin") || isSuperSchoolAdmin,
        isCoordinator,
        isTeacher,
        isStudent: roles.includes("student"),
        isEmployee: roles.includes("employee" as AppRole),
        employeeLevelId: employeeRole?.employee_level_id || null,
        hasDualTeacherCoordinatorRole: isTeacher && isCoordinator,
        hasDualAdminTeacherRole: (roles.includes("school_admin") || isSuperSchoolAdmin) && isTeacher,
      };
    },
    staleTime: 1 * 60 * 1000, // Cache for 1 minute (faster role change detection)
  });
}
