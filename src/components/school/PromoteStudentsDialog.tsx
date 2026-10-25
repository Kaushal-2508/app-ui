import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  GraduationCap,
} from "lucide-react";
import { getNextClassName, getNextAcademicYear } from "@/lib/classPromotion";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

interface PromoteStudentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
}

interface PromotionRow {
  studentId: string;
  studentName: string;
  currentClassName: string;
  currentSection: string | null;
  suggestedClassName: string | null;
  suggestedSection: string | null;
  targetClassId: string | null;
  selected: boolean;
}

export function PromoteStudentsDialog({
  open,
  onOpenChange,
  institutionId,
}: PromoteStudentsDialogProps) {
  const [step, setStep] = useState(1);
  const [sourceClassId, setSourceClassId] = useState<string>("");
  const [newAcademicYear, setNewAcademicYear] = useState(getNextAcademicYear());
  const [snapshotBefore, setSnapshotBefore] = useState(true);
  const [promotionRows, setPromotionRows] = useState<PromotionRow[]>([]);
  const [isPromoting, setIsPromoting] = useState(false);
  const [promotionResult, setPromotionResult] = useState<{
    promoted: number;
    failed: Array<{ student_id: string; error: string }>;
  } | null>(null);

  const queryClient = useQueryClient();

  // Fetch active classes for this institution (archived years are soft-deleted).
  const { data: activeClasses = [] } = useQuery({
    queryKey: ["promote-classes", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year, is_active")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: open && !!institutionId,
  });

  // Fetch students in the selected source class
  const { data: studentsInClass, isLoading: loadingStudents } = useQuery({
    queryKey: ["promote-students-in-class", sourceClassId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select(
          "user_id, profiles!class_assignments_user_id_fkey(id, full_name, email)"
        )
        .eq("class_id", sourceClassId)
        .eq("role", "student");
      if (error) throw error;
      return data || [];
    },
    enabled: !!sourceClassId,
  });

  const sourceClass = activeClasses.find((c) => c.id === sourceClassId);

  const handleProceedToPreview = () => {
    if (!sourceClass || !studentsInClass) return;

    const nextName = getNextClassName(sourceClass.name);

    // Find target class in new academic year
    const targetClasses = activeClasses?.filter(
      (c) => c.academic_year === newAcademicYear
    ) || [];

    const rows: PromotionRow[] = studentsInClass.map((sa: any) => {
      const profile = sa.profiles;
      const suggestedName = nextName;
      const suggestedSection = sourceClass.section;

      // Find matching target class
      let targetClassId: string | null = null;
      if (suggestedName) {
        const match = targetClasses.find(
          (c) =>
            c.name.toLowerCase() === suggestedName.toLowerCase() &&
            (c.section || null) === (suggestedSection || null)
        );
        if (match) targetClassId = match.id;
        else {
          // Try name-only match
          const nameMatch = targetClasses.find(
            (c) => c.name.toLowerCase() === suggestedName.toLowerCase()
          );
          if (nameMatch) targetClassId = nameMatch.id;
        }
      }

      return {
        studentId: profile.id,
        studentName: profile.full_name,
        currentClassName: sourceClass.name,
        currentSection: sourceClass.section,
        suggestedClassName: suggestedName,
        suggestedSection: suggestedSection,
        targetClassId,
        selected: !!targetClassId,
      };
    });

    setPromotionRows(rows);
    setStep(2);
  };

  const handleTargetClassChange = (studentId: string, classId: string) => {
    setPromotionRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId ? { ...r, targetClassId: classId } : r
      )
    );
  };

  const toggleStudent = (studentId: string) => {
    setPromotionRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId ? { ...r, selected: !r.selected } : r
      )
    );
  };

  const toggleSelectAll = () => {
    const allSelected = promotionRows.every((r) => r.selected);
    setPromotionRows((prev) => prev.map((r) => ({ ...r, selected: !allSelected })));
  };

  const selectedRows = promotionRows.filter((r) => r.selected && r.targetClassId);

  const handlePromote = async () => {
    if (selectedRows.length === 0) return;

    setIsPromoting(true);
    setStep(3);

    try {
      const { data, error } = await supabase.functions.invoke("promote-students", {
        body: {
          institution_id: institutionId,
          academic_year: newAcademicYear,
          snapshot_before_promote: snapshotBefore,
          promotions: selectedRows.map((r) => ({
            student_id: r.studentId,
            new_class_id: r.targetClassId,
          })),
        },
      });

      if (error) throw error;

      setPromotionResult({
        promoted: data.promoted,
        failed: data.failed || [],
      });

      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      toast.success(`${data.promoted} student(s) promoted successfully`);
    } catch (err: any) {
      toast.error(err.message || "Promotion failed");
      setPromotionResult({ promoted: 0, failed: [] });
    } finally {
      setIsPromoting(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setSourceClassId("");
    setPromotionRows([]);
    setPromotionResult(null);
    setIsPromoting(false);
    onOpenChange(false);
  };

  // Target classes for the new academic year
  const targetYearClasses = useMemo(
    () => activeClasses?.filter((c) => c.academic_year === newAcademicYear) || [],
    [activeClasses, newAcademicYear]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Promote Students
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Select a source class and configure promotion settings"}
            {step === 2 && "Review and adjust target classes before promoting"}
            {step === 3 && "Promotion in progress..."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-4">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step 1: Select Source */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Source Class (Current)</Label>
              <Select value={sourceClassId} onValueChange={setSourceClassId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select class to promote from" />
                </SelectTrigger>
                <SelectContent>
                  {activeClasses.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {formatClassName(cls.name, cls.section)} ({cls.academic_year})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>New Academic Year</Label>
              <Input
                value={newAcademicYear}
                onChange={(e) => setNewAcademicYear(e.target.value)}
                placeholder="e.g. 2027-2028"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="snapshot"
                checked={snapshotBefore}
                onCheckedChange={(v) => setSnapshotBefore(!!v)}
              />
              <Label htmlFor="snapshot" className="text-sm">
                Snapshot current year data before promoting
              </Label>
            </div>

            {sourceClass && studentsInClass && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <p>
                  <strong>{studentsInClass.length}</strong> students in{" "}
                  <strong>{formatClassName(sourceClass.name, sourceClass.section)}</strong>
                </p>
                {getNextClassName(sourceClass.name) ? (
                  <p className="text-muted-foreground mt-1">
                    Suggested target: {getNextClassName(sourceClass.name)}
                  </p>
                ) : (
                  <p className="text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    No auto-suggestion available. Manual selection required
                  </p>
                )}
              </div>
            )}

            {targetYearClasses.length === 0 && newAcademicYear && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                No classes found for academic year "{newAcademicYear}". Create classes first.
              </div>
            )}

            <Button
              onClick={handleProceedToPreview}
              disabled={!sourceClassId || !studentsInClass?.length || loadingStudents || targetYearClasses.length === 0}
              className="w-full"
            >
              {loadingStudents ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Preview Promotions
            </Button>
          </div>
        )}

        {/* Step 2: Preview & Edit */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="outline">
                {selectedRows.length} / {promotionRows.length} ready
              </Badge>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
                  {promotionRows.every((r) => r.selected) ? "Deselect All" : "Select All"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                  Back
                </Button>
              </div>
            </div>

            <div className="border rounded-lg overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Student</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Target Class</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promotionRows.map((row) => (
                    <TableRow key={row.studentId}>
                      <TableCell>
                        <Checkbox
                          checked={row.selected}
                          onCheckedChange={() => toggleStudent(row.studentId)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{row.studentName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {formatClassName(row.currentClassName, row.currentSection)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.targetClassId || ""}
                          onValueChange={(v) => handleTargetClassChange(row.studentId, v)}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Select target" />
                          </SelectTrigger>
                          <SelectContent>
                            {targetYearClasses.map((cls) => (
                              <SelectItem key={cls.id} value={cls.id}>
                                {formatClassName(cls.name, cls.section)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Button
              onClick={handlePromote}
              disabled={selectedRows.length === 0}
              className="w-full"
            >
              <GraduationCap className="h-4 w-4 mr-2" />
              Promote {selectedRows.length} Student(s)
            </Button>
          </div>
        )}

        {/* Step 3: Results */}
        {step === 3 && (
          <div className="space-y-4">
            {isPromoting ? (
              <div className="text-center py-8 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">
                  Promoting students...
                  {snapshotBefore && " (snapshotting data first)"}
                </p>
                <Progress value={50} className="w-full" />
              </div>
            ) : promotionResult ? (
              <div className="text-center py-8 space-y-4">
                <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500" />
                <h3 className="text-xl font-semibold">Promotion Complete!</h3>
                <div className="flex justify-center gap-4">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-emerald-600">
                      {promotionResult.promoted}
                    </p>
                    <p className="text-sm text-muted-foreground">Promoted</p>
                  </div>
                  {promotionResult.failed.length > 0 && (
                    <div className="text-center">
                      <p className="text-3xl font-bold text-destructive">
                        {promotionResult.failed.length}
                      </p>
                      <p className="text-sm text-muted-foreground">Failed</p>
                    </div>
                  )}
                </div>
                {promotionResult.failed.length > 0 && (
                  <div className="text-left p-3 rounded-lg bg-destructive/10 text-sm max-h-32 overflow-auto">
                    {promotionResult.failed.map((f, i) => (
                      <p key={i} className="text-destructive">
                        {f.student_id}: {f.error}
                      </p>
                    ))}
                  </div>
                )}
                <Button onClick={handleClose} className="w-full">
                  Done
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
