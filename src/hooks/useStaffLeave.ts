import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "./useUserRole";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

export function useStaffLeaveRequests(adminView = false) {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["staff-leave-requests", institutionId, adminView],
    enabled: !!institutionId,
    queryFn: async () => {
      let q = supabase
        .from("staff_leave_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (adminView) {
        q = q.eq("institution_id", institutionId!);
      }
      // Non-admin: RLS filters to own requests automatically

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

  const submit = useMutation({
    mutationFn: async (values: { leave_type: string; start_date: string; end_date: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("staff_leave_requests").insert({
        institution_id: institutionId,
        user_id: user.id,
        ...values,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-leave-requests"] });
      toast.success("Leave request submitted");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't submit your leave request.", context: "applyStaffLeaveHR" }),
  });

  // Decisions go through review_staff_leave (20260928160000), the same RPC
  // the Workday Staff Leaves tab uses. It checks who may decide, refuses
  // your own request, and writes the on-leave attendance days and the
  // balance in the same transaction. The direct UPDATE this panel used to
  // make wrote neither, so an approved teacher was still auto-marked absent
  // on every day of the leave.
  const review = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: "approved" | "rejected"; notes?: string }) => {
      const { error } = await supabase.rpc("review_staff_leave", {
        p_request_id: id,
        p_decision: status,
        p_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-leave-requests"] });
      // The Workday lists and the staff attendance views read the same rows.
      queryClient.invalidateQueries({ queryKey: ["staff-leave-queue"] });
      queryClient.invalidateQueries({ queryKey: ["my-staff-leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["staff-attendance"] });
      toast.success("Leave request updated");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't record the decision.", context: "reviewStaffLeaveHR" }),
  });

  return { ...query, submit, review };
}

export function useStaffLeaveBalances(adminView = false) {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["staff-leave-balances", institutionId, adminView],
    enabled: !!institutionId,
    queryFn: async () => {
      let q = supabase.from("staff_leave_balances").select("*").order("academic_year", { ascending: false });
      if (adminView) q = q.eq("institution_id", institutionId!);
      const { data, error } = await q;
      if (error) throw error;

      const userIds = [...new Set(data?.map(d => d.user_id) || [])];
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      const nameMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);
      return data?.map(d => ({ ...d, staff_name: nameMap.get(d.user_id) || "Unknown" })) || [];
    },
  });

  const initBalance = useMutation({
    mutationFn: async (values: { user_id: string; academic_year: string; annual_total?: number; sick_total?: number; casual_total?: number }) => {
      const { error } = await supabase.from("staff_leave_balances").upsert({
        institution_id: institutionId,
        ...values,
      }, { onConflict: "institution_id,user_id,academic_year" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-leave-balances"] });
      toast.success("Leave balance initialized");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the leave balance.", context: "staffLeaveBalanceHR" }),
  });

  return { ...query, initBalance };
}
