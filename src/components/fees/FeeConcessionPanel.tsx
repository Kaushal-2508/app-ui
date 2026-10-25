import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Award } from "lucide-react";
import { useFeeConcessions } from "@/hooks/useFeeConcessions";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface FeeConcessionPanelProps {
  institutionId: string;
}

const CONCESSION_TYPES = [
  { value: "scholarship", label: "Scholarship" },
  { value: "sibling_discount", label: "Sibling Discount" },
  { value: "staff_child", label: "Staff Child" },
  { value: "financial_aid", label: "Financial Aid" },
];

export function FeeConcessionPanel({ institutionId }: FeeConcessionPanelProps) {
  const { concessions, isLoading, createConcession, toggleConcession } = useFeeConcessions(institutionId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [concessionType, setConcessionType] = useState("scholarship");
  const [percentage, setPercentage] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  const { data: students } = useQuery({
    queryKey: ["students-for-concessions", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("institution_id", institutionId);
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const handleCreate = () => {
    createConcession.mutate({
      student_id: studentId,
      concession_type: concessionType,
      percentage: percentage ? parseFloat(percentage) : undefined,
      fixed_amount: fixedAmount ? parseFloat(fixedAmount) : undefined,
      reason,
      valid_from: validFrom,
      valid_to: validTo,
    }, {
      onSuccess: () => {
        setDialogOpen(false);
        setStudentId("");
        setPercentage("");
        setFixedAmount("");
        setReason("");
        setValidFrom("");
        setValidTo("");
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          <span className="font-semibold">{concessions.length} concessions</span>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Concession
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : concessions.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No concessions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Valid Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {concessions.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.profiles?.full_name || "N/A"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {c.concession_type?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {c.percentage ? `${c.percentage}%` : c.fixed_amount ? `₹${Number(c.fixed_amount).toLocaleString()}` : "N/A"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{c.reason || "N/A"}</TableCell>
                      <TableCell className="text-sm">
                        {c.valid_from && c.valid_to
                          ? `${format(new Date(c.valid_from), "dd MMM yy")} – ${format(new Date(c.valid_to), "dd MMM yy")}`
                          : "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.is_active ? "default" : "secondary"}>
                          {c.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleConcession.mutate({ id: c.id, is_active: !c.is_active })}
                        >
                          {c.is_active ? "Deactivate" : "Activate"}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Fee Concession</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Student</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                <SelectContent>
                  {students?.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Concession Type</Label>
              <Select value={concessionType} onValueChange={setConcessionType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONCESSION_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Percentage (%)</Label>
                <Input type="number" value={percentage} onChange={e => setPercentage(e.target.value)} placeholder="e.g. 25" />
              </div>
              <div>
                <Label>Fixed Amount (₹)</Label>
                <Input type="number" value={fixedAmount} onChange={e => setFixedAmount(e.target.value)} placeholder="e.g. 5000" />
              </div>
            </div>
            <div>
              <Label>Reason</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Merit scholarship, etc." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Valid From</Label>
                <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
              </div>
              <div>
                <Label>Valid To</Label>
                <Input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleCreate} disabled={!studentId || !reason || createConcession.isPending} className="w-full">
              {createConcession.isPending ? "Creating..." : "Create Concession"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
