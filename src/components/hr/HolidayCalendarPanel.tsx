import { useState } from "react";
import { useHolidayCalendar } from "@/hooks/useHolidayCalendar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Calendar } from "lucide-react";
import { format } from "date-fns";

const TYPES = [
  { value: "national", label: "National" },
  { value: "state", label: "State" },
  { value: "school", label: "School" },
  { value: "optional", label: "Optional" },
];

export function HolidayCalendarPanel() {
  const { data: holidays, isLoading, create, remove } = useHolidayCalendar();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ holiday_date: "", name: "", type: "school" });

  const handleAdd = () => {
    create.mutate(form, { onSuccess: () => { setOpen(false); setForm({ holiday_date: "", name: "", type: "school" }); } });
  };

  const typeColors: Record<string, string> = {
    national: "bg-red-100 text-red-800",
    state: "bg-blue-100 text-blue-800",
    school: "bg-green-100 text-green-800",
    optional: "bg-gray-100 text-gray-800",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Holiday Calendar</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Holiday</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Holiday</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><Label>Date</Label><Input type="date" value={form.holiday_date} onChange={e => setForm(p => ({ ...p, holiday_date: e.target.value }))} /></div>
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Republic Day" /></div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button onClick={handleAdd} disabled={!form.holiday_date || !form.name || create.isPending}>
                {create.isPending ? "Adding..." : "Add Holiday"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="grid gap-2">
          {(holidays || []).map((h: any) => (
            <Card key={h.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), "dd MMM yyyy")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={typeColors[h.type] || ""} variant="secondary">{h.type}</Badge>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove.mutate(h.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
