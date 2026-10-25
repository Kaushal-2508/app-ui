import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndianRupee } from "lucide-react";
import { useStudentInstallments } from "@/hooks/useStudentFees";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

interface InstallmentSchedulePanelProps {
  institutionId: string;
}

export function InstallmentSchedulePanel({ institutionId }: InstallmentSchedulePanelProps) {
  const { installments, isLoading } = useStudentInstallments(institutionId);
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = statusFilter === "all"
    ? installments
    : installments.filter((i: any) => i.status === statusFilter);

  const statusColor = (s: string) => {
    switch (s) {
      case "paid": return "default";
      case "pending": return "secondary";
      case "overdue": return "destructive";
      case "partially_paid": return "outline";
      case "waived": return "secondary";
      default: return "outline";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Installment Schedule</CardTitle>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="partially_paid">Partially Paid</SelectItem>
            <SelectItem value="waived">Waived</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">No installments found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>#</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Late Fee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inst: any) => (
                  <TableRow key={inst.id}>
                    <TableCell className="font-medium">{inst.profiles?.full_name || "N/A"}</TableCell>
                    <TableCell>{inst.installment_number}</TableCell>
                    <TableCell>{format(new Date(inst.due_date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-right">
                      <span className="flex items-center justify-end gap-0.5"><IndianRupee className="h-3 w-3" />{Number(inst.amount).toLocaleString()}</span>
                    </TableCell>
                    <TableCell className="text-right">₹{Number(inst.paid_amount).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {Number(inst.late_fee_applied) > 0 ? `₹${Number(inst.late_fee_applied).toLocaleString()}` : "N/A"}
                    </TableCell>
                    <TableCell><Badge variant={statusColor(inst.status) as any} className="capitalize">{inst.status}</Badge></TableCell>
                    <TableCell className="capitalize">{inst.payment_method || "N/A"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
