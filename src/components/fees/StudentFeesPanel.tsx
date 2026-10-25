import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, Plus, Users } from "lucide-react";
import { useStudentFees, useStudentInstallments } from "@/hooks/useStudentFees";
import { useFeeStructures } from "@/hooks/useFeeStructures";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { addMonths, format } from "date-fns";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

interface StudentFeesPanelProps {
  institutionId: string;
}

export function StudentFeesPanel({ institutionId }: StudentFeesPanelProps) {
  const { assignments, isLoading, assignFees } = useStudentFees(institutionId);
  const { createInstallments } = useStudentInstallments(institutionId);
  const { structures } = useFeeStructures(institutionId);
  const [assignOpen, setAssignOpen] = useState(false);

  // Form state
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [discountReason, setDiscountReason] = useState("");

  // Fetch classes
  const { data: classes } = useQuery({
    queryKey: ["classes", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
  });

  // Fetch students of selected class
  const { data: classStudents } = useQuery({
    queryKey: ["class-students", selectedClassId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select("user_id, profiles!class_assignments_user_id_fkey(id, full_name)")
        .eq("class_id", selectedClassId)
        .eq("role", "student");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedClassId,
  });

  const selectedStructure = structures.find(s => s.id === selectedStructureId);

  const handleBulkAssign = async () => {
    if (!classStudents || !selectedStructure) return;
    const discount = parseFloat(discountAmount) || 0;
    const totalAmount = Number(selectedStructure.amount) - discount;

    const assignmentPayload = classStudents.map((cs: any) => ({
      student_id: cs.user_id,
      fee_structure_id: selectedStructureId,
      discount_amount: discount,
      discount_reason: discountReason || undefined,
      total_amount: totalAmount,
    }));

    assignFees.mutate(assignmentPayload, {
      onSuccess: (data) => {
        // Auto-generate installments
        if (data && selectedStructure) {
          const freq = selectedStructure.frequency;
          const numInstallments = freq === "monthly" ? 12 : freq === "term" ? 3 : 1;
          const perInstallment = totalAmount / numInstallments;

          const installments = data.flatMap((assignment: any) =>
            Array.from({ length: numInstallments }, (_, i) => ({
              assignment_id: assignment.id,
              student_id: assignment.student_id,
              installment_number: i + 1,
              amount: Math.round(perInstallment * 100) / 100,
              due_date: format(addMonths(new Date(), i + 1), "yyyy-MM-dd"),
            }))
          );
          createInstallments.mutate(installments);
        }
        setAssignOpen(false);
      },
    });
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "active": return "default";
      case "waived": return "secondary";
      case "cancelled": return "destructive";
      default: return "outline";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Student Fee Assignments</CardTitle>
        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={structures.length === 0}>
              <Users className="h-4 w-4 mr-1" /> Assign Fees
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Bulk Assign Fees to Class</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Select Class</Label>
                <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                  <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
                  <SelectContent>
                    {classes?.map(c => <SelectItem key={c.id} value={c.id}>{formatClassName(c.name, c.section)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {classStudents && <p className="text-xs text-muted-foreground mt-1">{classStudents.length} students found</p>}
              </div>
              <div>
                <Label>Fee Structure</Label>
                <Select value={selectedStructureId} onValueChange={setSelectedStructureId}>
                  <SelectTrigger><SelectValue placeholder="Choose structure" /></SelectTrigger>
                  <SelectContent>
                    {structures.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.fee_categories?.name}: ₹{Number(s.amount).toLocaleString()} ({s.frequency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Discount (₹)</Label>
                  <Input type="number" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Reason</Label>
                  <Input placeholder="Optional" value={discountReason} onChange={e => setDiscountReason(e.target.value)} />
                </div>
              </div>
              {selectedStructure && (
                <p className="text-sm font-medium">
                  Net amount per student: ₹{(Number(selectedStructure.amount) - (parseFloat(discountAmount) || 0)).toLocaleString()}
                </p>
              )}
              <Button
                onClick={handleBulkAssign}
                disabled={!selectedClassId || !selectedStructureId || !classStudents?.length || assignFees.isPending}
                className="w-full"
              >
                {assignFees.isPending ? "Assigning..." : `Assign to ${classStudents?.length || 0} Students`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No fee assignments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.profiles?.full_name || "N/A"}</TableCell>
                    <TableCell>{a.fee_structures?.fee_categories?.name} ({a.fee_structures?.frequency})</TableCell>
                    <TableCell className="text-right">
                      <span className="flex items-center justify-end gap-0.5"><IndianRupee className="h-3 w-3" />{Number(a.fee_structures?.amount).toLocaleString()}</span>
                    </TableCell>
                    <TableCell className="text-right">{Number(a.discount_amount) > 0 ? `₹${Number(a.discount_amount).toLocaleString()}` : "N/A"}</TableCell>
                    <TableCell className="text-right font-medium">
                      <span className="flex items-center justify-end gap-0.5"><IndianRupee className="h-3 w-3" />{Number(a.total_amount).toLocaleString()}</span>
                    </TableCell>
                    <TableCell><Badge variant={statusColor(a.status) as any} className="capitalize">{a.status}</Badge></TableCell>
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
