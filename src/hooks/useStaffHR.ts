import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "./useUserRole";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

export function useStaffDirectory() {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;

  return useQuery({
    queryKey: ["staff-directory", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, admin_title, user_id, profiles!class_assignments_user_id_fkey:profiles!user_roles_user_id_fkey(id, full_name, email, phone, avatar_url, is_active, created_at)")
        .eq("institution_id", institutionId!)
        .in("role", ["teacher", "coordinator", "school_admin", "super_school_admin"]);

      if (error) {
        // Try simpler query without explicit FK
        const { data: d2, error: e2 } = await supabase
          .from("user_roles")
          .select("role, admin_title, user_id")
          .eq("institution_id", institutionId!)
          .in("role", ["teacher", "coordinator", "school_admin", "super_school_admin"]);
        if (e2) throw e2;

        // Fetch profiles separately
        const userIds = d2?.map(r => r.user_id) || [];
        if (userIds.length === 0) return [];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email, phone, avatar_url, is_active, created_at")
          .in("id", userIds);

        const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
        return d2?.map(r => ({
          ...r,
          profile: profileMap.get(r.user_id) || null,
        })) || [];
      }

      return data || [];
    },
  });
}

export function useSalaryStructures() {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["salary-structures", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_salary_structures")
        .select("*")
        .eq("institution_id", institutionId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (values: any) => {
      const { error } = await supabase.from("staff_salary_structures").insert({
        ...values,
        institution_id: institutionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
      toast.success("Salary structure created");
    },
    onError: (e: any) => toastError(e, { fallback: "Couldn't create the salary structure.", context: "createSalaryStructure" }),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...values }: any) => {
      const { error } = await supabase.from("staff_salary_structures").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
      toast.success("Salary structure updated");
    },
    onError: (e: any) => toastError(e, { fallback: "Couldn't update the salary structure.", context: "updateSalaryStructure" }),
  });

  return { ...query, create, update };
}

export function useSalaryAssignments() {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["salary-assignments", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_salary_assignments")
        .select("*, staff_salary_structures(name)")
        .eq("institution_id", institutionId!)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Fetch profile names
      const userIds = data?.map(d => d.user_id) || [];
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const profileMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);

      return data?.map(d => ({ ...d, staff_name: profileMap.get(d.user_id) || "Unknown" })) || [];
    },
  });

  const create = useMutation({
    mutationFn: async (values: any) => {
      const { error } = await supabase.from("staff_salary_assignments").insert({
        ...values,
        institution_id: institutionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-assignments"] });
      toast.success("Salary assigned");
    },
    onError: (e: any) => toastError(e, { fallback: "Couldn't assign the salary.", context: "createSalaryAssignment" }),
  });

  return { ...query, create };
}

export function useStaffDocuments(userId?: string) {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["staff-documents", institutionId, userId],
    enabled: !!institutionId,
    queryFn: async () => {
      let q = supabase
        .from("staff_documents")
        .select("*")
        .eq("institution_id", institutionId!)
        .order("uploaded_at", { ascending: false });
      if (userId) q = q.eq("user_id", userId);
      const { data, error } = await q;
      if (error) throw error;

      // Fetch names
      const userIds = [...new Set(data?.map(d => d.user_id) || [])];
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      const nameMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);
      return data?.map(d => ({ ...d, staff_name: nameMap.get(d.user_id) || "Unknown" })) || [];
    },
  });

  const upload = useMutation({
    mutationFn: async ({ userId: uid, file, documentType, documentName }: {
      userId: string; file: File; documentType: string; documentName: string;
    }) => {
      const filePath = `${uid}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("staff-documents").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("staff_documents").insert({
        institution_id: institutionId,
        user_id: uid,
        document_type: documentType,
        document_name: documentName,
        file_path: filePath,
        uploaded_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-documents"] });
      toast.success("Document uploaded");
    },
    onError: (e: any) => toastError(e, { fallback: "Couldn't upload the document.", context: "uploadStaffDocument" }),
  });

  return { ...query, upload };
}
