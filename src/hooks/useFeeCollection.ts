import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useFeeCollection(institutionId: string | undefined) {
  const queryClient = useQueryClient();

  const receiptsQuery = useQuery({
    queryKey: ["fee-receipts", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_receipts")
        .select("*, profiles!fee_receipts_student_id_fkey(full_name, email)")
        .eq("institution_id", institutionId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const recordPayment = useMutation({
    mutationFn: async (values: {
      installment_id: string;
      student_id: string;
      amount: number;
      payment_method: string;
      payment_date?: string;
      notes?: string;
    }) => {
      const userId = (await supabase.auth.getUser()).data.user?.id;

      // Generate receipt number
      const { data: receiptNum, error: rnErr } = await supabase.rpc("generate_fee_receipt_number", {
        _institution_id: institutionId!,
      });
      if (rnErr) throw rnErr;

      // Update installment
      const { data: installment, error: iErr } = await supabase
        .from("fee_installments")
        .select("paid_amount, amount, late_fee_applied")
        .eq("id", values.installment_id)
        .single();
      if (iErr) throw iErr;

      const newPaid = Number(installment.paid_amount) + values.amount;
      const totalDue = Number(installment.amount) + Number(installment.late_fee_applied);
      const newStatus = newPaid >= totalDue ? "paid" : "partially_paid";

      const { error: updErr } = await supabase
        .from("fee_installments")
        .update({
          paid_amount: newPaid,
          status: newStatus,
          paid_date: new Date().toISOString(),
          payment_method: values.payment_method,
          notes: values.notes,
        })
        .eq("id", values.installment_id);
      if (updErr) throw updErr;

      // Create receipt
      const { data: receipt, error: rErr } = await supabase
        .from("fee_receipts")
        .insert({
          institution_id: institutionId!,
          student_id: values.student_id,
          installment_id: values.installment_id,
          receipt_number: receiptNum as string,
          amount: values.amount,
          payment_date: values.payment_date || new Date().toISOString().split("T")[0],
          payment_method: values.payment_method,
          received_by: userId!,
          receipt_data: { notes: values.notes },
        })
        .select()
        .single();
      if (rErr) throw rErr;
      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["fee-installments"] });
      queryClient.invalidateQueries({ queryKey: ["fee-analytics"] });
      toast.success("Payment recorded & receipt generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { receipts: receiptsQuery.data ?? [], isLoading: receiptsQuery.isLoading, recordPayment };
}
