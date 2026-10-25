import { useState, useCallback } from "react";
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
  Upload,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  FileSpreadsheet,
} from "lucide-react";
import { getNextAcademicYear } from "@/lib/classPromotion";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import Papa from "papaparse";

interface BulkPromoteUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
}

interface UploadRow {
  admission_number: string;
  email: string;
  new_class: string;
  new_section: string;
  studentId?: string;
  studentName?: string;
  targetClassId?: string;
  matched: boolean;
  error?: string;
}

export function BulkPromoteUploadDialog({
  open,
  onOpenChange,
  institutionId,
}: BulkPromoteUploadDialogProps) {
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [newAcademicYear, setNewAcademicYear] = useState(getNextAcademicYear());
  const [snapshotBefore, setSnapshotBefore] = useState(true);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [isPromoting, setIsPromoting] = useState(false);
  const [result, setResult] = useState<{ promoted: number; failed: number } | null>(null);

  const queryClient = useQueryClient();

  // Fetch all classes for matching
  const { data: allClasses } = useQuery({
    queryKey: ["promote-classes-bulk", institutionId],
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
    enabled: open && !!institutionId,
  });

  // Fetch all students for matching
  const { data: allStudents } = useQuery({
    queryKey: ["promote-students-bulk", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, admission_number")
        .eq("institution_id", institutionId);
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!institutionId,
  });

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "csv" || ext === "txt") {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => processRows(results.data as any[]),
        });
      } else if (ext === "xlsx" || ext === "xls") {
        import("xlsx").then((XLSX) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const workbook = XLSX.read(ev.target?.result, { type: "binary" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(sheet);
            processRows(data as any[]);
          };
          reader.readAsBinaryString(file);
        });
      } else {
        toast.error("Please upload a CSV or Excel file");
      }
    },
    [allStudents, allClasses, newAcademicYear]
  );

  const processRows = (data: any[]) => {
    const targetClasses = allClasses?.filter((c) => c.academic_year === newAcademicYear) || [];

    const mapped: UploadRow[] = data.map((row) => {
      const admissionNo = (row.admission_number || row.admission_no || "").trim();
      const email = (row.email || "").trim().toLowerCase();
      const newClass = (row.new_class || "").trim();
      const newSection = (row.new_section || "").trim();

      // Match student: admission number first, then email fallback
      let student;
      if (admissionNo) {
        student = allStudents?.find((s) => s.admission_number === admissionNo);
      }
      if (!student && email) {
        student = allStudents?.find((s) => s.email?.toLowerCase() === email);
      }

      // Match target class
      let targetClassId: string | undefined;
      if (newClass) {
        const match = targetClasses.find(
          (c) =>
            c.name.toLowerCase() === newClass.toLowerCase() &&
            (!newSection || (c.section || "").toLowerCase() === newSection.toLowerCase())
        );
        if (match) targetClassId = match.id;
      }

      let error: string | undefined;
      if (!student) error = "Student not found";
      else if (!targetClassId) error = `Class "${newClass}${newSection ? ` - ${newSection}` : ""}" not found for ${newAcademicYear}`;

      return {
        admission_number: admissionNo,
        email,
        new_class: newClass,
        new_section: newSection,
        studentId: student?.id,
        studentName: student?.full_name,
        targetClassId,
        matched: !!student && !!targetClassId,
        error,
      };
    });

    setRows(mapped);
    setStep("preview");
  };

  const matchedRows = rows.filter((r) => r.matched);
  const unmatchedRows = rows.filter((r) => !r.matched);

  const handlePromote = async () => {
    if (matchedRows.length === 0) return;
    setIsPromoting(true);
    setStep("result");

    try {
      const { data, error } = await supabase.functions.invoke("promote-students", {
        body: {
          institution_id: institutionId,
          academic_year: newAcademicYear,
          snapshot_before_promote: snapshotBefore,
          promotions: matchedRows.map((r) => ({
            student_id: r.studentId,
            new_class_id: r.targetClassId,
          })),
        },
      });

      if (error) throw error;
      setResult({ promoted: data.promoted, failed: data.failed?.length || 0 });
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      toast.success(`${data.promoted} student(s) promoted`);
    } catch (err: any) {
      toast.error(err.message || "Promotion failed");
      setResult({ promoted: 0, failed: matchedRows.length });
    } finally {
      setIsPromoting(false);
    }
  };

  const handleClose = () => {
    setStep("upload");
    setRows([]);
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Bulk Promote via CSV/Excel
          </DialogTitle>
          <DialogDescription>
            Upload a file with columns: admission_number, email, new_class, new_section
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>New Academic Year</Label>
              <Input
                value={newAcademicYear}
                onChange={(e) => setNewAcademicYear(e.target.value)}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="snap-bulk"
                checked={snapshotBefore}
                onCheckedChange={(v) => setSnapshotBefore(!!v)}
              />
              <Label htmlFor="snap-bulk" className="text-sm">
                Snapshot current year data before promoting
              </Label>
            </div>

            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                Upload CSV or Excel file
              </p>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                className="max-w-xs mx-auto"
              />
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <p className="font-medium mb-1">Expected columns:</p>
              <code>admission_number, email, new_class, new_section</code>
              <p className="mt-1">
                Provide <strong>admission_number</strong> or <strong>email</strong> (or both). Example:
              </p>
              <p className="mt-0.5">
                <code>1001, student@school.com, Class 9, A</code>
              </p>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <Badge variant="default" className="bg-emerald-500">
                {matchedRows.length} matched
              </Badge>
              {unmatchedRows.length > 0 && (
                <Badge variant="destructive">
                  {unmatchedRows.length} unmatched
                </Badge>
              )}
            </div>

            <div className="border rounded-lg overflow-auto max-h-[350px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Adm. No.</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{row.admission_number || "N/A"}</TableCell>
                      <TableCell className="text-sm">{row.email || "N/A"}</TableCell>
                      <TableCell className="text-sm">
                        {row.studentName || "N/A"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatClassName(row.new_class, row.new_section)}
                      </TableCell>
                      <TableCell>
                        {row.matched ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <div className="flex items-center gap-1 text-destructive text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            {row.error}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={handlePromote}
                disabled={matchedRows.length === 0}
                className="flex-1"
              >
                Promote {matchedRows.length} Student(s)
              </Button>
            </div>
          </div>
        )}

        {step === "result" && (
          <div className="text-center py-8 space-y-4">
            {isPromoting ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">Promoting students...</p>
                <Progress value={50} />
              </>
            ) : result ? (
              <>
                <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500" />
                <h3 className="text-xl font-semibold">Complete!</h3>
                <p>
                  <strong>{result.promoted}</strong> promoted
                  {result.failed > 0 && (
                    <>, <strong className="text-destructive">{result.failed}</strong> failed</>
                  )}
                </p>
                <Button onClick={handleClose} className="w-full">
                  Done
                </Button>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
