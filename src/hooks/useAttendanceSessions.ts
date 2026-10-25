import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useAttendanceSessions(classId: string | null, date: string | null) {
  return useQuery({
    queryKey: ["attendance-sessions", classId, date],
    queryFn: async () => {
      if (!classId || !date) return [];
      const { data, error } = await supabase
        .from("attendance_sessions")
        .select("*")
        .eq("class_id", classId)
        .eq("date", date)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!classId && !!date,
  });
}

export function useCreateAttendanceSession() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      institution_id: string;
      class_id: string;
      date: string;
      session_type: "qr" | "pin";
      expires_minutes: number;
    }) => {
      const code = params.session_type === "pin"
        ? Math.floor(100000 + Math.random() * 900000).toString()
        : crypto.randomUUID().replace(/-/g, "").substring(0, 12).toUpperCase();

      const expiresAt = new Date(Date.now() + params.expires_minutes * 60 * 1000).toISOString();

      // Deactivate previous sessions for same class/date
      await supabase
        .from("attendance_sessions")
        .update({ is_active: false })
        .eq("class_id", params.class_id)
        .eq("date", params.date);

      const { data, error } = await supabase
        .from("attendance_sessions")
        .insert({
          institution_id: params.institution_id,
          class_id: params.class_id,
          date: params.date,
          session_code: code,
          session_type: params.session_type,
          created_by: user!.id,
          expires_at: expiresAt,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
      toast.success("Session created successfully");
    },
    onError: (err: Error) => {
      toast.error("Failed to create session: " + err.message);
    },
  });
}

export function useValidateAndCheckIn() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { session_code: string; class_id: string }) => {
      // Find active session
      const { data: session, error: sessionError } = await supabase
        .from("attendance_sessions")
        .select("*")
        .eq("session_code", params.session_code)
        .eq("is_active", true)
        .single();

      if (sessionError || !session) throw new Error("Invalid or expired session code");

      if (new Date(session.expires_at) < new Date()) {
        throw new Error("Session has expired");
      }

      // Verify student is in the class
      const { data: assignment } = await supabase
        .from("class_assignments")
        .select("id")
        .eq("user_id", user!.id)
        .eq("class_id", session.class_id)
        .eq("role", "student")
        .single();

      if (!assignment) throw new Error("You are not assigned to this class");

      // Mark attendance
      const { error: attendanceError } = await supabase
        .from("attendance_records")
        .upsert({
          institution_id: session.institution_id,
          class_id: session.class_id,
          student_id: user!.id,
          date: session.date,
          status: "present",
          method: "mobile_checkin",
          marked_by: user!.id,
          remarks: `Checked in via ${session.session_type.toUpperCase()} code`,
        }, { onConflict: "class_id,student_id,date" });

      if (attendanceError) throw attendanceError;
      return session;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Checked in successfully!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
