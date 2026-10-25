import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "./useUserRole";
import { toast } from "sonner";

export function usePayrollRuns() {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["payroll-runs", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*")
        .eq("institution_id", institutionId!)
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createRun = useMutation({
    mutationFn: async ({ month, year }: { month: number; year: number }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create payroll run
      const { data: run, error: runError } = await supabase.from("payroll_runs").insert({
        institution_id: institutionId,
        month,
        year,
        run_by: user.id,
      }).select().single();
      if (runError) throw runError;

      // Get all salary assignments
      const { data: assignments, error: aError } = await supabase
        .from("staff_salary_assignments")
        .select("*, staff_salary_structures(*)")
        .eq("institution_id", institutionId!)
        .lte("effective_from", `${year}-${String(month).padStart(2, "0")}-28`)
        .or(`effective_to.is.null,effective_to.gte.${year}-${String(month).padStart(2, "0")}-01`);
      if (aError) throw aError;

      if (!assignments || assignments.length === 0) {
        toast.info("No salary assignments found for this period");
        return run;
      }

      // Calculate entries
      const workingDays = 26; // Default
      const entries = assignments.map((a: any) => {
        const s = a.staff_salary_structures;
        const basic = a.override_basic ?? s.basic_salary;
        const hra = a.override_hra ?? s.hra;
        const gross = basic + hra + s.da + s.ta + s.medical_allowance + s.special_allowance;
        const pf = basic * (s.pf_percentage / 100);
        const esi = gross * (s.esi_percentage / 100);
        const totalDeductions = pf + esi + s.professional_tax + (gross * s.tds_percentage / 100);
        const net = gross - totalDeductions;

        return {
          payroll_run_id: run.id,
          user_id: a.user_id,
          basic_salary: basic,
          hra,
          da: s.da,
          ta: s.ta,
          medical_allowance: s.medical_allowance,
          special_allowance: s.special_allowance,
          other_allowances: s.other_allowances,
          gross_salary: gross,
          pf_deduction: pf,
          esi_deduction: esi,
          professional_tax: s.professional_tax,
          tds_deduction: gross * s.tds_percentage / 100,
          other_deductions: s.other_deductions,
          working_days: workingDays,
          attendance_days: workingDays,
          attendance_adjustment: 0,
          net_salary: net,
        };
      });

      const { error: entryError } = await supabase.from("payroll_entries").insert(entries);
      if (entryError) throw entryError;

      // Update totals
      const totalGross = entries.reduce((sum: number, e: any) => sum + e.gross_salary, 0);
      const totalDed = entries.reduce((sum: number, e: any) => sum + (e.pf_deduction + e.esi_deduction + e.professional_tax + e.tds_deduction), 0);
      const totalNet = entries.reduce((sum: number, e: any) => sum + e.net_salary, 0);

      await supabase.from("payroll_runs").update({
        total_gross: totalGross,
        total_deductions: totalDed,
        total_net: totalNet,
      }).eq("id", run.id);

      return run;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      toast.success("Payroll run created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const completeRun = useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.from("payroll_runs").update({
        status: "completed",
        run_at: new Date().toISOString(),
      }).eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      toast.success("Payroll completed");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return { ...query, createRun, completeRun };
}

export function usePayrollEntries(runId?: string) {
  return useQuery({
    queryKey: ["payroll-entries", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_entries")
        .select("*")
        .eq("payroll_run_id", runId!)
        .order("net_salary", { ascending: false });
      if (error) throw error;

      const userIds = data?.map(d => d.user_id) || [];
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      const nameMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);
      return data?.map(d => ({ ...d, staff_name: nameMap.get(d.user_id) || "Unknown" })) || [];
    },
  });
}

export function useMyPayroll() {
  return useQuery({
    queryKey: ["my-payroll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_entries")
        .select("*, payroll_runs(month, year, status)")
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
