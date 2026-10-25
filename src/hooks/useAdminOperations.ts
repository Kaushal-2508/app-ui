import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

interface CreateInstitutionData {
  name: string;
  code: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  adminEmail: string;
  adminName: string;
  adminPassword?: string;
  adminRole?: "school_admin" | "super_school_admin";
  // Extended data for wizard - per-class subjects
  academicYear?: string;
  classes?: Array<{
    name: string;
    sections: string[];
    subjectIds: string[];
  }>;
  // Feature flags for institution
  enabledFeatures?: string[];
}

interface CreateUserData {
  email: string;
  fullName: string;
  password?: string;
  role: "super_school_admin" | "school_admin" | "coordinator" | "teacher" | "student" | "employee";
  institutionId: string;
  // Student-specific fields for admission number login
  phone?: string;
  admissionNumber?: string;
  rollNumber?: string;
  // Class assignment for students
  classId?: string;
  // When true, suppress the Resend welcome email (used when `email` is a
  // synthesised @temp.local placeholder for a student without a real inbox).
  skipWelcomeEmail?: boolean;
}

interface UpdateAIConfigData {
  configKey: string;
  configValue: string;
  isEnabled: boolean;
}

interface UpdateQuotaData {
  institutionId: string;
  dailyQuestionLimit?: number;
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  questionGenerationEnabled?: boolean;
  ocrEnabled?: boolean;
}

export function useCreateInstitution() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateInstitutionData) => {
      return invokeAdminOperation<{ institution: { id: string; name: string }; adminEmail: string }>({ action: "create_institution", data });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["super-admin-institutions"] });
      queryClient.invalidateQueries({ queryKey: ["super-admin-stats"] });
      toast({
        title: "Institution Created",
        description: `${data.institution.name} has been created with admin account ${data.adminEmail}`,
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't create institution.", context: "createInstitution" }),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateUserData) => {
      return invokeAdminOperation<{
        userId: string;
        email: string;
        password: string;
        role: string;
        emailSent: boolean;
        emailError: string | null;
        message: string;
      }>({ action: "create_user", data });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["super-admin-stats"] });
      // Invalidate role-specific lists
      queryClient.invalidateQueries({ queryKey: ["school-coordinators"] });
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      queryClient.invalidateQueries({ queryKey: ["school-admin-stats"] });
      const isPlaceholderEmail = typeof data.email === "string" && data.email.endsWith("@temp.local");
      toast({
        title: "User Created",
        description: isPlaceholderEmail
          ? `Student created with role ${data.role}. Share the password manually.`
          : `User ${data.email} has been created with role ${data.role}`,
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't create user.", context: "createUser" }),
  });
}

export function useUpdateAIConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: UpdateAIConfigData) => {
      return invokeAdminOperation<unknown>({ action: "update_ai_config", data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-config"] });
      toast({
        title: "Configuration Updated",
        description: "AI configuration has been saved",
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update AI configuration.", context: "updateAIConfig" }),
  });
}

export function useUpdateQuota() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: UpdateQuotaData) => {
      return invokeAdminOperation<unknown>({ action: "update_quota", data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-quotas"] });
      toast({
        title: "Quota Updated",
        description: "Institution AI quotas have been updated",
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update quota.", context: "updateQuota" }),
  });
}

// Fetch hooks for data
export function useInstitutions() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("institutions")
        .select(`
          id, name, code, is_active, contact_email, contact_phone, address, created_at,
          institution_subscriptions (plan_name, status, monthly_amount)
        `)
        .order("name");
      
      if (error) throw error;
      return data;
    },
  });
}

export function useUsers(institutionId?: string) {
  return useMutation({
    mutationFn: async () => {
      let query = supabase
        .from("profiles")
        .select(`
          id, full_name, email, is_active, institution_id, created_at,
          user_roles (role, institution_id),
          institutions (name)
        `)
        .order("full_name");
      
      if (institutionId) {
        query = query.eq("institution_id", institutionId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useAIConfig() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("global_ai_config")
        .select("*")
        .order("config_key");
      
      if (error) throw error;
      return data;
    },
  });
}

export function useInstitutionQuotas() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("ai_usage_quotas")
        .select(`
          *,
          institutions (name, code)
        `)
        .order("institution_id");
      
      if (error) throw error;
      return data;
    },
  });
}
