import { useState } from "react";
import { useSalaryAssignments, useSalaryStructures, useStaffDirectory } from "@/hooks/useStaffHR";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { getDisplayName } from "@/lib/displayName";

export function SalaryAssignmentsTab() {
  const { data: assignments, isLoading, create } = useSalaryAssignments();
  const { data: structures } = useSalaryStructures();
  const { data: staff } = useStaffDirectory();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    user_id: "", salary_structure_id: "", effective_from: new Date().toISOString().split("T")[0],
    bank_name: "", bank_account_number: "", ifsc_code: "", pan_number: "",
  });

  const handleSubmit = () => {
    create.mutate(form, { onSuccess: () => setOpen(false) });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Salary Assignments</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Assign Salary</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign Salary Structure</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Staff Member</Label>
                <Select value={form.user_id} onValueChange={v => setForm(p => ({ ...p, user_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                  <SelectContent>
                    {(staff || []).map((s: any) => (
                      <SelectItem key={s.user_id} value={s.user_id}>{getDisplayName(s.profile)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Salary Structure</Label>
                <Select value={form.salary_structure_id} onValueChange={v => setForm(p => ({ ...p, salary_structure_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select structure" /></SelectTrigger>
                  <SelectContent>
                    {(structures || []).filter((s: any) => s.is_active).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Effective From</Label><Input type="date" value={form.effective_from} onChange={e => setForm(p => ({ ...p, effective_from: e.target.value }))} /></div>
              <div><Label>Bank Name</Label><Input value={form.bank_name} onChange={e => setForm(p => ({ ...p, bank_name: e.target.value }))} /></div>
              <div><Label>Account Number</Label><Input value={form.bank_account_number} onChange={e => setForm(p => ({ ...p, bank_account_number: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>IFSC Code</Label><Input value={form.ifsc_code} onChange={e => setForm(p => ({ ...p, ifsc_code: e.target.value }))} /></div>
                <div><Label>PAN Number</Label><Input value={form.pan_number} onChange={e => setForm(p => ({ ...p, pan_number: e.target.value }))} /></div>
              </div>
              <Button onClick={handleSubmit} disabled={!form.user_id || !form.salary_structure_id || create.isPending}>
                {create.isPending ? "Assigning..." : "Assign"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="grid gap-3">
          {(assignments || []).map((a: any) => (
            <Card key={a.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{a.staff_name}</p>
                  <p className="text-xs text-muted-foreground">Structure: {a.staff_salary_structures?.name || "N/A"}</p>
                  <p className="text-xs text-muted-foreground">From: {a.effective_from}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {a.bank_name && <p>{a.bank_name}</p>}
                  {a.pan_number && <Badge variant="outline" className="text-xs">PAN: {a.pan_number}</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
