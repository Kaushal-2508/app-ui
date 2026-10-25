import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useLeaveRequests(institutionId: string | null, role: "student" | "staff") {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["leave-requests", institutionId, role],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !institutionId) return [];

      let q = supabase
        .from("leave_requests")
        .select("*, student:profiles!leave_requests_student_id_fkey(id, full_name, email), reviewer:profiles!leave_requests_reviewed_by_fkey(id, full_name), class:classes!leave_requests_class_id_fkey(id, name, section)")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false });

      if (role === "student") {
        q = q.eq("student_id", user.id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!institutionId,
  });

  const createLeaveRequest = useMutation({
    mutationFn: async (values: {
      institution_id: string;
      class_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      reason: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("leave_requests").insert({
        ...values,
        student_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Leave request submitted");
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reviewLeaveRequest = useMutation({
    mutationFn: async ({ id, status, reviewer_notes }: { id: string; status: "approved" | "rejected"; reviewer_notes?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("leave_requests")
        .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString(), reviewer_notes })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Leave request updated");
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { leaveRequests: query.data || [], isLoading: query.isLoading, createLeaveRequest, reviewLeaveRequest };
}
