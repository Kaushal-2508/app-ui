import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export interface WingMember {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  roleName: string;
}

/**
 * Fetches all users in a specific wing with their roles.
 * Supports bidirectional task assignment (upward and downward).
 */
export function useWingMembers(wingId: string | null) {
  return useQuery({
    queryKey: ["wing-members", wingId],
    enabled: !!wingId,
    queryFn: async () => {
      if (!wingId) return [];

      // Get all users assigned to this wing
      const { data: wingAssignments, error: assignError } = await supabase
        .from("wing_assignments")
        .select("user_id")
        .eq("wing_id", wingId);

      if (assignError) throw assignError;

      const userIds = wingAssignments?.map((a) => a.user_id) || [];
      if (userIds.length === 0) return [];

      // Get profiles for these users
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      // Get roles for these users
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds);

      if (rolesError) throw rolesError;

      // Map roles to user IDs
      const roleMap = new Map<string, AppRole>();
      userRoles?.forEach((ur) => {
        // Prioritize higher roles (school_admin > coordinator > teacher)
        const existingRole = roleMap.get(ur.user_id);
        const roleOrder: AppRole[] = ["school_admin", "coordinator", "teacher", "student"];
        if (!existingRole || roleOrder.indexOf(ur.role) < roleOrder.indexOf(existingRole)) {
          roleMap.set(ur.user_id, ur.role);
        }
      });

      // Create role name mapping
      const roleNames: Record<AppRole, string> = {
        super_admin: "Super Admin",
        super_school_admin: "Super School Admin",
        school_admin: "Principal",
        coordinator: "Coordinator",
        teacher: "Teacher",
        student: "Student",
        employee: "Employee",
      };

      // Combine profiles with roles
      const members: WingMember[] = (profiles || []).map((profile) => ({
        id: profile.id,
        full_name: profile.full_name || profile.email,
        email: profile.email,
        role: roleMap.get(profile.id) || "teacher",
        roleName: roleNames[roleMap.get(profile.id) || "teacher"],
      }));

      // Sort by role hierarchy
      const roleOrder: AppRole[] = ["school_admin", "coordinator", "teacher", "student"];
      members.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));

      return members;
    },
  });
}

/**
 * Fetches all wings the current user is assigned to.
 */
export function useUserWings() {
  return useQuery({
    queryKey: ["user-wings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("wing_assignments")
        .select(`
          wing_id,
          wings:wing_id (id, name, description, institution_id)
        `)
        .eq("user_id", user.id);

      if (error) throw error;

      return (data || []).map((wa: any) => wa.wings).filter(Boolean);
    },
  });
}

/**
 * Fetches all users in an institution with their roles (for users not assigned to any wing).
 * Fallback when wing-based assignment is not applicable.
 */
export function useInstitutionMembers(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-members", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      if (!institutionId) return [];

      // Get all users in this institution (teachers, coordinators, school_admin)
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .eq("institution_id", institutionId)
        .in("role", ["school_admin", "coordinator", "teacher"]);

      if (rolesError) throw rolesError;

      const userIds = [...new Set(userRoles?.map((ur) => ur.user_id) || [])];
      if (userIds.length === 0) return [];

      // Get profiles for these users
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      // Map roles to user IDs (prioritize higher roles)
      const roleMap = new Map<string, AppRole>();
      userRoles?.forEach((ur) => {
        const existingRole = roleMap.get(ur.user_id);
        const roleOrder: AppRole[] = ["school_admin", "coordinator", "teacher"];
        if (!existingRole || roleOrder.indexOf(ur.role) < roleOrder.indexOf(existingRole)) {
          roleMap.set(ur.user_id, ur.role);
        }
      });

      const roleNames: Record<string, string> = {
        super_admin: "Super Admin",
        school_admin: "Principal",
        coordinator: "Coordinator",
        teacher: "Teacher",
        employee: "Employee",
      };

      const members: WingMember[] = (profiles || []).map((profile) => ({
        id: profile.id,
        full_name: profile.full_name || profile.email,
        email: profile.email,
        role: roleMap.get(profile.id) || "teacher",
        roleName: roleNames[roleMap.get(profile.id) || "teacher"],
      }));

      // Sort by role hierarchy
      const roleOrder: AppRole[] = ["school_admin", "coordinator", "teacher"];
      members.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));

      return members;
    },
  });
}
