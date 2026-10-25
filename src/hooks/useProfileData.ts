import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

export interface ProfileData {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  institution_id: string | null;
  is_active: boolean;
  admission_number: string | null;
  roll_number: string | null;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
  institution?: {
    id: string;
    name: string;
    code: string;
  } | null;
  roles: Array<{
    role: string;
    institution_id: string | null;
  }>;
  classAssignments: Array<{
    id: string;
    class_id: string;
    subject_id: string | null;
    role: string;
    class_name: string;
    class_section: string | null;
    subject_name: string | null;
  }>;
  studentClass?: {
    id: string;
    name: string;
    section: string | null;
    academic_year: string;
  } | null;
}

export function useProfileData() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["profile-data", user?.id],
    queryFn: async (): Promise<ProfileData | null> => {
      if (!user?.id) return null;

      // Fetch profile with institution — explicit columns only. profiles is
      // wide and this query runs for every authenticated user; select("*")
      // shipped every column for a fixed 10-field mapping (§23).
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select(`
          id, full_name, email, phone, institution_id, is_active,
          admission_number, roll_number, avatar_path, created_at, updated_at,
          institutions(id, name, code)
        `)
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;

      // Fetch roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, institution_id")
        .eq("user_id", user.id);

      // Fetch class assignments with classes and subjects (uses universal_subjects)
      const { data: classAssignments } = await supabase
        .from("class_assignments")
        .select(`
          id,
          class_id,
          subject_id,
          role,
          classes(name, section),
          universal_subjects(name)
        `)
        .eq("user_id", user.id);

      // For students, get their class assignment
      const studentRole = roles?.find(r => r.role === "student");
      let studentClass = null;
      
      if (studentRole) {
        const studentAssignment = classAssignments?.find(ca => ca.role === "student");
        if (studentAssignment) {
          const { data: classData } = await supabase
            .from("classes")
            .select("id, name, section, academic_year")
            .eq("id", studentAssignment.class_id)
            .single();
          studentClass = classData;
        }
      }

      return {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        institution_id: profile.institution_id,
        is_active: profile.is_active,
        admission_number: profile.admission_number ?? null,
        roll_number: profile.roll_number ?? null,
        avatar_path: profile.avatar_path ?? null,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        institution: profile.institutions,
        roles: roles || [],
        classAssignments: (classAssignments || []).map((ca: {
          id: string;
          class_id: string;
          subject_id: string | null;
          role: string;
          classes: { name: string; section: string | null } | null;
          universal_subjects: { name: string } | null;
        }) => ({
          id: ca.id,
          class_id: ca.class_id,
          subject_id: ca.subject_id,
          role: ca.role,
          class_name: ca.classes?.name || "Unknown",
          class_section: ca.classes?.section ?? null,
          subject_name: ca.universal_subjects?.name || null,
        })),
        studentClass,
      };
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { full_name: string; phone?: string }) => {
      if (!user?.id) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: data.full_name,
          phone: data.phone || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-data"] });
      toast.success("Profile updated successfully");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update profile.", context: "updateProfile" }),
  });
}
