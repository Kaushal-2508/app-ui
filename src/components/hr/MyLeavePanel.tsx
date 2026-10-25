import { useState } from "react";
import { useStaffLeaveRequests, useStaffLeaveBalances } from "@/hooks/useStaffLeave";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, CalendarDays } from "lucide-react";

const LEAVE_TYPES = ["annual", "sick", "casual", "maternity", "paternity", "unpaid", "other"];

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export function MyLeavePanel() {
  const { data: requests, isLoading, submit } = useStaffLeaveRequests(false);
  const { data: balances } = useStaffLeaveBalances(false);

  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({ leave_type: "casual", start_date: "", end_date: "", reason: "" });

  const handleApply = () => {
    submit.mutate(form, {
      onSuccess: () => {
        setApplyOpen(false);
        setForm({ leave_type: "casual", start_date: "", end_date: "", reason: "" });
      },
    });
  };

  const myBalance = balances?.[0];

  return (
    <div className="space-y-6">
      {/* Leave Balance Summary */}
      {myBalance && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Annual Leave</p>
              <p className="text-2xl font-bold text-foreground">{myBalance.annual_total - myBalance.annual_used}</p>
              <p className="text-xs text-muted-foreground">of {myBalance.annual_total} remaining</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Sick Leave</p>
              <p className="text-2xl font-bold text-foreground">{myBalance.sick_total - myBalance.sick_used}</p>
              <p className="text-xs text-muted-foreground">of {myBalance.sick_total} remaining</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Casual Leave</p>
              <p className="text-2xl font-bold text-foreground">{myBalance.casual_total - myBalance.casual_used}</p>
              <p className="text-xs text-muted-foreground">of {myBalance.casual_total} remaining</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header with Apply button */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-foreground">My Leave Requests</h3>
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Apply Leave</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Apply for Leave</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Leave Type</Label>
                <Select value={form.leave_type} onValueChange={v => setForm(p => ({ ...p, leave_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAVE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} /></div>
                <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} /></div>
              </div>
              <div><Label>Reason</Label><Textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} /></div>
              <Button onClick={handleApply} disabled={!form.start_date || !form.end_date || submit.isPending}>
                {submit.isPending ? "Submitting..." : "Submit"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Leave History */}
      <div className="grid gap-2">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : (requests || []).length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No leave requests yet</p>
            </CardContent>
          </Card>
        ) : (
          (requests || []).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-foreground capitalize">{r.leave_type} Leave</p>
                  <p className="text-xs text-muted-foreground">{r.start_date} to {r.end_date}</p>
                  {r.reason && <p className="text-xs text-muted-foreground mt-1">{r.reason}</p>}
                  {r.reviewer_notes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">Admin: {r.reviewer_notes}</p>
                  )}
                </div>
                <Badge className={statusColors[r.status] || ""}>{r.status}</Badge>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
