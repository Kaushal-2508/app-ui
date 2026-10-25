import { useState } from "react";
import { useStaffLeaveRequests, useStaffLeaveBalances } from "@/hooks/useStaffLeave";
import { useUserRole } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, CheckCircle, XCircle } from "lucide-react";

const LEAVE_TYPES = ["annual", "sick", "casual", "maternity", "paternity", "unpaid", "other"];

export function StaffLeavePanel() {
  const { data: roleInfo } = useUserRole();
  const isAdmin = roleInfo?.isSchoolAdmin;
  const { data: requests, isLoading, submit, review } = useStaffLeaveRequests(!!isAdmin);
  const { data: balances } = useStaffLeaveBalances(!!isAdmin);

  const [tab, setTab] = useState("requests");
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({ leave_type: "casual", start_date: "", end_date: "", reason: "" });

  const handleApply = () => {
    submit.mutate(form, { onSuccess: () => { setApplyOpen(false); setForm({ leave_type: "casual", start_date: "", end_date: "", reason: "" }); } });
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="requests">Leave Requests</TabsTrigger>
            {isAdmin && <TabsTrigger value="balances">Leave Balances</TabsTrigger>}
          </TabsList>
        </Tabs>
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Apply Leave</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Apply for Leave</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Leave Type</Label>
                <Select value={form.leave_type} onValueChange={v => setForm(p => ({ ...p, leave_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAVE_TYPES.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}</SelectContent>
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

      {tab === "requests" && (
        <div className="grid gap-2">
          {isLoading ? <p className="text-muted-foreground">Loading...</p> : (requests || []).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{r.staff_name}</p>
                  <p className="text-xs text-muted-foreground">{r.leave_type} • {r.start_date} to {r.end_date}</p>
                  {r.reason && <p className="text-xs text-muted-foreground mt-1">{r.reason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={statusColors[r.status] || ""}>{r.status}</Badge>
                  {isAdmin && r.status === "pending" && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => review.mutate({ id: r.id, status: "approved" })}>
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => review.mutate({ id: r.id, status: "rejected" })}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "balances" && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(balances || []).map((b: any) => (
            <Card key={b.id}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{b.staff_name} ({b.academic_year})</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                <p>Annual: {b.annual_used}/{b.annual_total} used</p>
                <p>Sick: {b.sick_used}/{b.sick_total} used</p>
                <p>Casual: {b.casual_used}/{b.casual_total} used</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
