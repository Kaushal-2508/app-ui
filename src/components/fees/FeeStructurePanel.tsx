import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, IndianRupee } from "lucide-react";
import { useFeeCategories } from "@/hooks/useFeeCategories";
import { useFeeStructures } from "@/hooks/useFeeStructures";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

interface FeeStructurePanelProps {
  institutionId: string;
}

export function FeeStructurePanel({ institutionId }: FeeStructurePanelProps) {
  const { categories, isLoading: catLoading, createCategory, deleteCategory } = useFeeCategories(institutionId);
  const { structures, isLoading: strLoading, createStructure, deleteStructure } = useFeeStructures(institutionId);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [strDialogOpen, setStrDialogOpen] = useState(false);

  // Fetch classes for dropdown
  const { data: classes } = useQuery({
    queryKey: ["classes", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId,
  });

  // Category form state
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [catRecurring, setCatRecurring] = useState(false);

  // Structure form state
  const [strCategoryId, setStrCategoryId] = useState("");
  const [strClassId, setStrClassId] = useState<string>("");
  const [strYear, setStrYear] = useState("2025-2026");
  const [strAmount, setStrAmount] = useState("");
  const [strFrequency, setStrFrequency] = useState("annual");
  const [strDueDay, setStrDueDay] = useState("");
  const [strLateFee, setStrLateFee] = useState("0");
  const [strLateFeeType, setStrLateFeeType] = useState("fixed");
  const [strGrace, setStrGrace] = useState("0");

  const handleCreateCategory = () => {
    createCategory.mutate({ name: catName, description: catDesc || undefined, is_recurring: catRecurring }, {
      onSuccess: () => { setCatDialogOpen(false); setCatName(""); setCatDesc(""); setCatRecurring(false); },
    });
  };

  const handleCreateStructure = () => {
    createStructure.mutate({
      fee_category_id: strCategoryId,
      class_id: strClassId || null,
      academic_year: strYear,
      amount: parseFloat(strAmount),
      frequency: strFrequency,
      due_day: strDueDay ? parseInt(strDueDay) : null,
      late_fee_amount: parseFloat(strLateFee) || 0,
      late_fee_type: strLateFeeType,
      grace_period_days: parseInt(strGrace) || 0,
    }, {
      onSuccess: () => {
        setStrDialogOpen(false);
        setStrCategoryId(""); setStrClassId(""); setStrAmount(""); setStrDueDay("");
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Fee Categories */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Fee Categories</CardTitle>
          <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Category</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Fee Category</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input placeholder="e.g. Tuition Fee" value={catName} onChange={e => setCatName(e.target.value)} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input placeholder="Optional description" value={catDesc} onChange={e => setCatDesc(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={catRecurring} onCheckedChange={setCatRecurring} />
                  <Label>Recurring (monthly)</Label>
                </div>
                <Button onClick={handleCreateCategory} disabled={!catName || createCategory.isPending} className="w-full">
                  {createCategory.isPending ? "Creating..." : "Create Category"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {catLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">No fee categories yet. Create one to get started.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <Badge key={cat.id} variant={cat.is_active ? "default" : "secondary"} className="gap-1 text-sm py-1 px-3">
                  {cat.name}
                  {cat.is_recurring && <span className="text-xs opacity-70">(recurring)</span>}
                  <button onClick={() => deleteCategory.mutate(cat.id)} className="ml-1 hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fee Structures */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Fee Structures</CardTitle>
          <Dialog open={strDialogOpen} onOpenChange={setStrDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={categories.length === 0}><Plus className="h-4 w-4 mr-1" /> Add Structure</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Create Fee Structure</DialogTitle></DialogHeader>
              <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <Label>Fee Category</Label>
                  <Select value={strCategoryId} onValueChange={setStrCategoryId}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Class (optional: leave blank for all)</Label>
                  <Select value={strClassId} onValueChange={setStrClassId}>
                    <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Classes</SelectItem>
                      {classes?.map(c => <SelectItem key={c.id} value={c.id}>{formatClassName(c.name, c.section)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Academic Year</Label>
                    <Input value={strYear} onChange={e => setStrYear(e.target.value)} />
                  </div>
                  <div>
                    <Label>Amount (₹)</Label>
                    <Input type="number" placeholder="0" value={strAmount} onChange={e => setStrAmount(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Frequency</Label>
                    <Select value={strFrequency} onValueChange={setStrFrequency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="annual">Annual</SelectItem>
                        <SelectItem value="term">Term</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="one_time">One-Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Due Day (for monthly)</Label>
                    <Input type="number" min="1" max="28" placeholder="e.g. 10" value={strDueDay} onChange={e => setStrDueDay(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Late Fee</Label>
                    <Input type="number" value={strLateFee} onChange={e => setStrLateFee(e.target.value)} />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <Select value={strLateFeeType} onValueChange={setStrLateFeeType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed (₹)</SelectItem>
                        <SelectItem value="percentage">Percentage (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Grace Days</Label>
                    <Input type="number" value={strGrace} onChange={e => setStrGrace(e.target.value)} />
                  </div>
                </div>
                <Button
                  onClick={handleCreateStructure}
                  disabled={!strCategoryId || !strAmount || createStructure.isPending}
                  className="w-full"
                >
                  {createStructure.isPending ? "Creating..." : "Create Structure"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {strLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : structures.length === 0 ? (
            <p className="text-muted-foreground text-sm">No fee structures yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Late Fee</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {structures.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.fee_categories?.name}</TableCell>
                      <TableCell>{s.classes ? formatClassName(s.classes.name, s.classes.section) : "All"}</TableCell>
                      <TableCell>{s.academic_year}</TableCell>
                      <TableCell className="text-right">
                        <span className="flex items-center justify-end gap-0.5">
                          <IndianRupee className="h-3 w-3" />{Number(s.amount).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{s.frequency}</Badge></TableCell>
                      <TableCell>
                        {Number(s.late_fee_amount) > 0
                          ? `${s.late_fee_type === "percentage" ? `${s.late_fee_amount}%` : `₹${s.late_fee_amount}`} (${s.grace_period_days}d grace)`
                          : "N/A"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => deleteStructure.mutate(s.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
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
  );
}
