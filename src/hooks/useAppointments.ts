import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useAppointments(institutionId: string | null, role: "student" | "teacher") {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["appointments", institutionId, role],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !institutionId) return [];

      let q = supabase
        .from("appointments")
        .select("*, teacher:profiles!appointments_teacher_id_fkey(id, full_name, email), student:profiles!appointments_student_id_fkey(id, full_name, email)")
        .eq("institution_id", institutionId)
        .order("appointment_date", { ascending: true });

      if (role === "student") {
        q = q.eq("student_id", user.id);
      } else {
        q = q.eq("teacher_id", user.id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!institutionId,
  });

  const createAppointment = useMutation({
    mutationFn: async (values: {
      institution_id: string;
      teacher_id: string;
      appointment_date: string;
      start_time: string;
      end_time: string;
      purpose: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("appointments").insert({
        ...values,
        student_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Appointment request submitted");
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateAppointment = useMutation({
    mutationFn: async ({ id, status, teacher_notes }: { id: string; status: string; teacher_notes?: string }) => {
      const { error } = await supabase
        .from("appointments")
        .update({ status, teacher_notes })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Appointment updated");
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { appointments: query.data || [], isLoading: query.isLoading, createAppointment, updateAppointment };
}
