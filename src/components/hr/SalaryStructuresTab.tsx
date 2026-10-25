import { useState } from "react";
import { useSalaryStructures } from "@/hooks/useStaffHR";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, IndianRupee } from "lucide-react";

export function SalaryStructuresTab() {
  const { data: structures, isLoading, create } = useSalaryStructures();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", basic_salary: 0, hra: 0, da: 0, ta: 0,
    medical_allowance: 0, special_allowance: 0,
    pf_percentage: 12, esi_percentage: 0.75, professional_tax: 200, tds_percentage: 0,
  });

  const handleSubmit = () => {
    create.mutate(form, { onSuccess: () => { setOpen(false); setForm({ name: "", basic_salary: 0, hra: 0, da: 0, ta: 0, medical_allowance: 0, special_allowance: 0, pf_percentage: 12, esi_percentage: 0.75, professional_tax: 200, tds_percentage: 0 }); } });
  };

  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Salary Templates</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Structure</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Salary Structure</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Teacher Grade A" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Basic Salary</Label><Input type="number" value={form.basic_salary} onChange={e => setForm(p => ({ ...p, basic_salary: +e.target.value }))} /></div>
                <div><Label>HRA</Label><Input type="number" value={form.hra} onChange={e => setForm(p => ({ ...p, hra: +e.target.value }))} /></div>
                <div><Label>DA</Label><Input type="number" value={form.da} onChange={e => setForm(p => ({ ...p, da: +e.target.value }))} /></div>
                <div><Label>TA</Label><Input type="number" value={form.ta} onChange={e => setForm(p => ({ ...p, ta: +e.target.value }))} /></div>
                <div><Label>Medical</Label><Input type="number" value={form.medical_allowance} onChange={e => setForm(p => ({ ...p, medical_allowance: +e.target.value }))} /></div>
                <div><Label>Special</Label><Input type="number" value={form.special_allowance} onChange={e => setForm(p => ({ ...p, special_allowance: +e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>PF %</Label><Input type="number" value={form.pf_percentage} onChange={e => setForm(p => ({ ...p, pf_percentage: +e.target.value }))} /></div>
                <div><Label>ESI %</Label><Input type="number" value={form.esi_percentage} onChange={e => setForm(p => ({ ...p, esi_percentage: +e.target.value }))} /></div>
                <div><Label>Prof. Tax</Label><Input type="number" value={form.professional_tax} onChange={e => setForm(p => ({ ...p, professional_tax: +e.target.value }))} /></div>
                <div><Label>TDS %</Label><Input type="number" value={form.tds_percentage} onChange={e => setForm(p => ({ ...p, tds_percentage: +e.target.value }))} /></div>
              </div>
              <Button onClick={handleSubmit} disabled={!form.name || create.isPending}>
                {create.isPending ? "Creating..." : "Create Structure"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="grid gap-3 md:grid-cols-2">
          {(structures || []).map((s: any) => (
            <Card key={s.id}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Active" : "Inactive"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>Basic: {fmt(s.basic_salary)}</span>
                  <span>HRA: {fmt(s.hra)}</span>
                  <span>DA: {fmt(s.da)}</span>
                  <span>TA: {fmt(s.ta)}</span>
                  <span>Medical: {fmt(s.medical_allowance)}</span>
                  <span>Special: {fmt(s.special_allowance)}</span>
                </div>
                <div className="pt-1 border-t text-xs text-muted-foreground">
                  PF: {s.pf_percentage}% | ESI: {s.esi_percentage}% | Tax: {fmt(s.professional_tax)} | TDS: {s.tds_percentage}%
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
