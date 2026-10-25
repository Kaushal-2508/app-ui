import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, Receipt, CreditCard, Eye } from "lucide-react";
import { useStudentInstallments } from "@/hooks/useStudentFees";
import { useFeeCollection } from "@/hooks/useFeeCollection";
import { FeeReceiptViewer } from "@/components/fees/FeeReceiptViewer";
import { format } from "date-fns";

interface FeeCollectionPanelProps {
  institutionId: string;
}

export function FeeCollectionPanel({ institutionId }: FeeCollectionPanelProps) {
  const { installments, isLoading } = useStudentInstallments(institutionId);
  const { receipts, recordPayment } = useFeeCollection(institutionId);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payNotes, setPayNotes] = useState("");
  const [activeTab, setActiveTab] = useState<"collect" | "receipts">("collect");
  const [viewReceipt, setViewReceipt] = useState<any>(null);

  const pendingInstallments = installments.filter(
    (i: any) => i.status !== "paid" && i.status !== "waived"
  );

  const handlePay = (inst: any) => {
    setSelectedInstallment(inst);
    const remaining = Number(inst.amount) + Number(inst.late_fee_applied) - Number(inst.paid_amount);
    setPayAmount(remaining.toString());
    setPayDialogOpen(true);
  };

  const handleRecordPayment = () => {
    if (!selectedInstallment) return;
    recordPayment.mutate({
      installment_id: selectedInstallment.id,
      student_id: selectedInstallment.student_id,
      amount: parseFloat(payAmount),
      payment_method: payMethod,
      notes: payNotes || undefined,
    }, {
      onSuccess: () => {
        setPayDialogOpen(false);
        setSelectedInstallment(null);
        setPayNotes("");
      },
    });
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "paid": return "default";
      case "pending": return "secondary";
      case "overdue": return "destructive";
      case "partially_paid": return "outline";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant={activeTab === "collect" ? "default" : "outline"} onClick={() => setActiveTab("collect")}>
          <CreditCard className="h-4 w-4 mr-1" /> Collect Payment
        </Button>
        <Button variant={activeTab === "receipts" ? "default" : "outline"} onClick={() => setActiveTab("receipts")}>
          <Receipt className="h-4 w-4 mr-1" /> Receipts ({receipts.length})
        </Button>
      </div>

      {activeTab === "collect" && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Pending Installments</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : pendingInstallments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No pending installments.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingInstallments.map((inst: any) => {
                      const balance = Number(inst.amount) + Number(inst.late_fee_applied) - Number(inst.paid_amount);
                      return (
                        <TableRow key={inst.id}>
                          <TableCell className="font-medium">{inst.profiles?.full_name || "N/A"}</TableCell>
                          <TableCell>{format(new Date(inst.due_date), "dd MMM yyyy")}</TableCell>
                          <TableCell className="text-right">
                            <span className="flex items-center justify-end gap-0.5"><IndianRupee className="h-3 w-3" />{Number(inst.amount).toLocaleString()}</span>
                          </TableCell>
                          <TableCell className="text-right">₹{Number(inst.paid_amount).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium text-destructive">₹{balance.toLocaleString()}</TableCell>
                          <TableCell><Badge variant={statusColor(inst.status) as any} className="capitalize">{inst.status}</Badge></TableCell>
                          <TableCell>
                            <Button size="sm" onClick={() => handlePay(inst)}>Pay</Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "receipts" && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Payment Receipts</CardTitle></CardHeader>
          <CardContent>
            {receipts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No receipts yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt #</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receipts.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.receipt_number}</TableCell>
                        <TableCell>{r.profiles?.full_name || "N/A"}</TableCell>
                        <TableCell>{format(new Date(r.payment_date), "dd MMM yyyy")}</TableCell>
                        <TableCell className="text-right">
                          <span className="flex items-center justify-end gap-0.5"><IndianRupee className="h-3 w-3" />{Number(r.amount).toLocaleString()}</span>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{r.payment_method}</Badge></TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setViewReceipt(r)}>
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
      )}

      {/* Payment Dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          {selectedInstallment && (
            <div className="space-y-4">
              <p className="text-sm">
                Student: <strong>{selectedInstallment.profiles?.full_name}</strong> | 
                Installment #{selectedInstallment.installment_number}
              </p>
              <div>
                <Label>Amount (₹)</Label>
                <Input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Transaction ref, etc." />
              </div>
              <Button onClick={handleRecordPayment} disabled={!payAmount || recordPayment.isPending} className="w-full">
                {recordPayment.isPending ? "Recording..." : `Record ₹${parseFloat(payAmount || "0").toLocaleString()} Payment`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <FeeReceiptViewer
        receipt={viewReceipt}
        open={!!viewReceipt}
        onOpenChange={(open) => { if (!open) setViewReceipt(null); }}
      />
    </div>
  );
}
