import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IndianRupee, Loader2, Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useState } from "react";
import { FeeReceiptViewer } from "@/components/fees/FeeReceiptViewer";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";

type ReceiptRow = {
  id: string;
  receipt_number: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  [k: string]: unknown;
};

type InstallmentRow = {
  id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: string;
  student_fee_assignments?: {
    fee_structures?: {
      fee_categories?: { name?: string | null } | null;
    } | null;
  } | null;
};

type FeeSummary = {
  total_fees?: number;
  total_paid?: number;
  total_pending?: number;
  total_overdue?: number;
};

export default function StudentFeesView() {
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRow | null>(null);

  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  const studentId = user?.id;

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["student-fee-summary", studentId],
    queryFn: async (): Promise<FeeSummary | null> => {
      const { data, error } = await supabase.rpc("get_student_fee_summary", { _student_id: studentId! });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    enabled: !!studentId,
  });

  const { data: installments, isLoading: instLoading } = useQuery({
    queryKey: ["student-installments", studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_installments")
        .select("*, student_fee_assignments!inner(fee_structures!inner(fee_categories!inner(name)))")
        .eq("student_id", studentId!)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as unknown as InstallmentRow[];
    },
    enabled: !!studentId,
  });

  const { data: receipts } = useQuery({
    queryKey: ["student-receipts", studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_receipts")
        .select("*, profiles!fee_receipts_student_id_fkey(full_name)")
        .eq("student_id", studentId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ReceiptRow[];
    },
    enabled: !!studentId,
  });

  const isLoading = summaryLoading || instLoading;

  const statusColor = (s: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (s) {
      case "paid": return "default";
      case "pending": return "secondary";
      case "overdue": return "destructive";
      case "partially_paid": return "outline";
      default: return "secondary";
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={<IndianRupee className="h-5 w-5" />}
        title="My Fees"
        subtitle="View your fee summary, installments, and payment history"
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <StatTileGrid cols={2} mdCols={4}>
            <StatTile
              label="Total Fees"
              value={`₹${Number(summary?.total_fees || 0).toLocaleString()}`}
              tone="teal"
            />
            <StatTile
              label="Total Paid"
              value={`₹${Number(summary?.total_paid || 0).toLocaleString()}`}
              tone="mint"
            />
            <StatTile
              label="Pending"
              value={`₹${Number(summary?.total_pending || 0).toLocaleString()}`}
              tone="peach"
            />
            <StatTile
              label="Overdue"
              value={`₹${Number(summary?.total_overdue || 0).toLocaleString()}`}
              tone="rose"
            />
          </StatTileGrid>

          <Card>
            <CardHeader><CardTitle className="text-lg">Installment Schedule</CardTitle></CardHeader>
            <CardContent>
              {!installments?.length ? (
                <p className="text-muted-foreground text-sm">No installments assigned.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fee Category</TableHead>
                        <TableHead>#</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {installments.map((inst) => (
                        <TableRow key={inst.id}>
                          <TableCell>{inst.student_fee_assignments?.fee_structures?.fee_categories?.name || "N/A"}</TableCell>
                          <TableCell>{inst.installment_number}</TableCell>
                          <TableCell>{format(new Date(inst.due_date), "dd MMM yyyy")}</TableCell>
                          <TableCell className="text-right">₹{Number(inst.amount).toLocaleString()}</TableCell>
                          <TableCell className="text-right">₹{Number(inst.paid_amount).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant={statusColor(inst.status)} className="capitalize">{inst.status}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Payment History</CardTitle></CardHeader>
            <CardContent>
              {!receipts?.length ? (
                <p className="text-muted-foreground text-sm">No payments recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receipts.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-sm">{r.receipt_number}</TableCell>
                          <TableCell>{format(new Date(r.payment_date), "dd MMM yyyy")}</TableCell>
                          <TableCell className="text-right">₹{Number(r.amount).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline" className="capitalize">{r.payment_method}</Badge></TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setSelectedReceipt(r)}>
                              <Eye className="h-4 w-4 mr-1" /> View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <FeeReceiptViewer
        receipt={selectedReceipt}
        open={!!selectedReceipt}
        onOpenChange={(open) => { if (!open) setSelectedReceipt(null); }}
      />
    </PageShell>
  );
}
