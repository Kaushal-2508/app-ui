import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "./useUserRole";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

export function useHolidayCalendar() {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["holiday-calendar", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holiday_calendar")
        .select("*")
        .eq("institution_id", institutionId!)
        .order("holiday_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (values: { holiday_date: string; name: string; type: string }) => {
      const { error } = await supabase
        .from("holiday_calendar")
        .insert({
          ...values,
          institution_id: institutionId,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-calendar"] });
      toast.success("Holiday added");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't add the holiday.", context: "addHoliday" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("holiday_calendar").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-calendar"] });
      toast.success("Holiday removed");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't remove the holiday.", context: "removeHoliday" }),
  });

  return { ...query, create, remove };
}
