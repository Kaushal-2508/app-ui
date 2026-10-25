import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, AlertTriangle, Zap, Bell } from "lucide-react";
import { useFeeDefaulters } from "@/hooks/useFeeDefaulters";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { useState } from "react";

interface DefaulterTrackerProps {
  institutionId: string;
}

export function DefaulterTracker({ institutionId }: DefaulterTrackerProps) {
  const { defaulters, isLoading, applyLateFees } = useFeeDefaulters(institutionId);
  const [sendingReminders, setSendingReminders] = useState(false);

  const totalOverdue = defaulters.reduce((sum: number, d: any) =>
    sum + Number(d.amount) + Number(d.late_fee_applied) - Number(d.paid_amount), 0
  );

  const handleSendReminders = async () => {
    const studentIds = [...new Set(defaulters.map((d: any) => d.student_id))];
    if (studentIds.length === 0) return;
    setSendingReminders(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-fee-reminder", {
        body: { student_ids: studentIds, reminder_type: "overdue" },
      });
      if (error) throw error;
      toast.success(`Reminders sent to ${data.reminders_sent} student(s)`);
    } catch (e: any) {
      toast.error(e.message || "Failed to send reminders");
    } finally {
      setSendingReminders(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-semibold">{defaulters.length} overdue installments</span>
          </div>
          <span className="text-muted-foreground">|</span>
          <span className="font-medium flex items-center gap-1">
            <IndianRupee className="h-4 w-4" />{totalOverdue.toLocaleString()} outstanding
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSendReminders} disabled={sendingReminders || defaulters.length === 0}>
            <Bell className="h-4 w-4 mr-1" />
            {sendingReminders ? "Sending..." : "Send Reminders"}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => applyLateFees.mutate()} disabled={applyLateFees.isPending}>
            <Zap className="h-4 w-4 mr-1" />
            {applyLateFees.isPending ? "Applying..." : "Apply Late Fees"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : defaulters.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No defaulters. All payments are on track! 🎉</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Days Overdue</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Late Fee</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {defaulters.map((d: any) => {
                    const daysOverdue = differenceInDays(new Date(), new Date(d.due_date));
                    const balance = Number(d.amount) + Number(d.late_fee_applied) - Number(d.paid_amount);
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.profiles?.full_name || "N/A"}</TableCell>
                        <TableCell>{format(new Date(d.due_date), "dd MMM yyyy")}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">{daysOverdue} days</Badge>
                        </TableCell>
                        <TableCell className="text-right">₹{Number(d.amount).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {Number(d.late_fee_applied) > 0 ? `₹${Number(d.late_fee_applied).toLocaleString()}` : "N/A"}
                        </TableCell>
                        <TableCell className="text-right font-bold text-destructive">₹{balance.toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
