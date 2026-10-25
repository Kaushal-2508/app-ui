import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  X,
  Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast";
import { useBulkUpdateProfiles, StudentUpdateRecord } from "@/hooks/useBulkUpdateProfiles";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";
import { downloadTemplate } from "@/utils/csvTemplates";

interface BulkUpdateStudentsDialogProps {
  trigger?: React.ReactNode;
  institutionId: string;
  onOpenRollNumberPicker?: () => void;
  /** Admin / coordinator surfaces only — teachers don't move students between
   *  classes, so TeacherStudentsPage leaves this undefined and the card hides. */
  onOpenClassSectionPicker?: () => void;
  /** Admin / coordinator surfaces only — teachers lost the right to change a
   *  student's optional subjects on 2026-08-26 (migration 20260826140000), so
   *  TeacherStudentsPage leaves this undefined and the card hides. */
  onOpenOptionalSubjectPicker?: () => void;
}

interface ParsedStudent {
  email: string;
  admissionNumber: string;
  phone: string;
  rollNumber: string;
  status: "pending" | "matched" | "not_found" | "out_of_scope" | "success" | "error";
  errorMessage?: string;
}

export function BulkUpdateStudentsDialog({
  trigger,
  institutionId,
  onOpenRollNumberPicker,
  onOpenClassSectionPicker,
  onOpenOptionalSubjectPicker,
}: BulkUpdateStudentsDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"upload" | "preview" | "processing" | "complete">("upload");
  const [parsedStudents, setParsedStudents] = useState<ParsedStudent[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [results, setResults] = useState<{ updated: number; notFound: number; outOfScope: number; errors: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const bulkUpdateMutation = useBulkUpdateProfiles();

  const handleDownloadTemplate = () => {
    downloadTemplate("student_update");
  };

  const parseCSV = (content: string): ParsedStudent[] => {
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const emailIndex = headers.findIndex((h) => h.includes("email"));
    const admissionIndex = headers.findIndex((h) => h.includes("admission"));
    const phoneIndex = headers.findIndex((h) => h.includes("phone"));
    const rollIndex = headers.findIndex((h) => h.includes("roll"));

    if (emailIndex === -1) {
      toast({
        title: "Invalid CSV format",
        description: "CSV must have an 'email' column for matching",
        variant: "destructive",
      });
      return [];
    }

    const students: ParsedStudent[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const email = values[emailIndex] || "";
      
      if (!email) continue; // Skip rows without email

      students.push({
        email,
        admissionNumber: admissionIndex !== -1 ? values[admissionIndex] || "" : "",
        phone: phoneIndex !== -1 ? values[phoneIndex] || "" : "",
        rollNumber: rollIndex !== -1 ? values[rollIndex] || "" : "",
        status: "pending",
      });
    }

    return students;
  };

  const parseExcel = (data: ArrayBuffer): ParsedStudent[] => {
    try {
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      if (jsonData.length === 0) {
        toast({
          title: "Empty file",
          description: "The Excel file doesn't contain any data",
          variant: "destructive",
        });
        return [];
      }

      const firstRow = jsonData[0];
      const keys = Object.keys(firstRow);
      const emailKey = keys.find((k) => k.toLowerCase().includes("email"));
      const admissionKey = keys.find((k) => k.toLowerCase().includes("admission"));
      const phoneKey = keys.find((k) => k.toLowerCase().includes("phone"));
      const rollKey = keys.find((k) => k.toLowerCase().includes("roll"));

      if (!emailKey) {
        toast({
          title: "Invalid Excel format",
          description: "Excel must have an 'email' column for matching",
          variant: "destructive",
        });
        return [];
      }

      const students: ParsedStudent[] = [];
      for (const row of jsonData) {
        const email = String(row[emailKey] || "").trim();
        if (!email) continue;

        students.push({
          email,
          admissionNumber: admissionKey ? String(row[admissionKey] || "").trim() : "",
          phone: phoneKey ? String(row[phoneKey] || "").trim() : "",
          rollNumber: rollKey ? String(row[rollKey] || "").trim() : "",
          status: "pending",
        });
      }

      return students;
    } catch (error) {
      toast({
        title: "Error parsing Excel",
        description: "Failed to read the Excel file",
        variant: "destructive",
      });
      return [];
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExtensions = [".csv", ".xlsx", ".xls"];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
    if (!allowedExtensions.includes(fileExtension)) {
      toast({
        title: "Invalid file",
        description: "Only .csv, .xlsx, or .xls files are allowed",
        variant: "destructive",
      });
      return;
    }

    setFileName(file.name);

    if (fileExtension === ".csv") {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const students = parseCSV(content);
        setParsedStudents(students);
        if (students.length > 0) {
          setStep("preview");
        }
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result as ArrayBuffer;
        const students = parseExcel(data);
        setParsedStudents(students);
        if (students.length > 0) {
          setStep("preview");
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleUpdate = async () => {
    if (parsedStudents.length === 0) return;

    setIsProcessing(true);
    setStep("processing");
    setUploadProgress(0);

    // Process in batches of 500
    const BATCH_SIZE = 500;
    const batches: StudentUpdateRecord[][] = [];
    
    for (let i = 0; i < parsedStudents.length; i += BATCH_SIZE) {
      batches.push(
        parsedStudents.slice(i, i + BATCH_SIZE).map((s) => ({
          email: s.email,
          admissionNumber: s.admissionNumber || undefined,
          phone: s.phone || undefined,
          rollNumber: s.rollNumber || undefined,
        }))
      );
    }

    let totalUpdated = 0;
    let totalNotFound = 0;
    let totalOutOfScope = 0;
    let totalErrors = 0;
    const allNotFound: string[] = [];
    const allOutOfScope: string[] = [];

    try {
      for (let i = 0; i < batches.length; i++) {
        const result = await bulkUpdateMutation.mutateAsync({
          institutionId,
          students: batches[i],
        });

        totalUpdated += result.results.updated;
        totalNotFound += result.results.notFound.length;
        totalOutOfScope += result.results.outOfScope.length;
        totalErrors += result.results.errors.length;
        allNotFound.push(...result.results.notFound);
        allOutOfScope.push(...result.results.outOfScope);

        setUploadProgress(((i + 1) / batches.length) * 100);
      }

      // Update local state with results
      const updatedStudents = parsedStudents.map((s) => ({
        ...s,
        status: allOutOfScope.includes(s.email)
          ? ("out_of_scope" as const)
          : allNotFound.includes(s.email)
            ? ("not_found" as const)
            : ("success" as const),
      }));
      setParsedStudents(updatedStudents);
      setResults({ updated: totalUpdated, notFound: totalNotFound, outOfScope: totalOutOfScope, errors: totalErrors });
      setStep("complete");

      toast({
        title: "Update complete",
        description: `Updated ${totalUpdated} student profiles. ${totalNotFound} not found.${
          totalOutOfScope > 0 ? ` ${totalOutOfScope} skipped (not your class).` : ""
        }`,
      });
    } catch (error: unknown) {
      toastError(error, { fallback: "Failed to update student profiles.", context: "bulkUpdateStudents" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setStep("upload");
    setParsedStudents([]);
    setFileName(null);
    setUploadProgress(0);
    setResults(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeStudent = (index: number) => {
    setParsedStudents((students) => students.filter((_, i) => i !== index));
  };

  const studentsWithData = parsedStudents.filter(
    (s) => s.admissionNumber || s.phone || s.rollNumber
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Update Student Details
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Update Student Details</DialogTitle>
          <DialogDescription>
            Update missing details (admission number, phone, roll number) for existing students using email to match records.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4 py-4">
            {onOpenRollNumberPicker && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenRollNumberPicker();
                }}
                className="flex w-full items-center justify-between rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-left transition hover:bg-brand-primary/10"
              >
                <span>
                  <span className="block text-sm font-semibold text-brand-primary">
                    Update Roll Number
                  </span>
                  <span className="block text-xs text-ink-600">
                    Pick a class &rsaquo; section and edit roll numbers in a list
                  </span>
                </span>
                <span aria-hidden className="text-brand-primary">&rsaquo;</span>
              </button>
            )}
            {onOpenClassSectionPicker && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenClassSectionPicker();
                }}
                className="flex w-full items-center justify-between rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-left transition hover:bg-brand-primary/10"
              >
                <span>
                  <span className="block text-sm font-semibold text-brand-primary">
                    Update Class &amp; Section
                  </span>
                  <span className="block text-xs text-ink-600">
                    Pick a class &rsaquo; section and move students to another one
                  </span>
                </span>
                <span aria-hidden className="text-brand-primary">&rsaquo;</span>
              </button>
            )}
            {onOpenOptionalSubjectPicker && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenOptionalSubjectPicker();
                }}
                className="flex w-full items-center justify-between rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-left transition hover:bg-brand-primary/10"
              >
                <span>
                  <span className="block text-sm font-semibold text-brand-primary">
                    Update Optional Subjects
                  </span>
                  <span className="block text-xs text-ink-600">
                    Pick a class &rsaquo; section and set each student&apos;s optional group choices
                  </span>
                </span>
                <span aria-hidden className="text-brand-primary">&rsaquo;</span>
              </button>
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Upload a CSV or Excel file with student email and details to update
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>

            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-2">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground">
                CSV, XLSX, or XLS files only
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {fileName && (
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>Selected: {fileName}</AlertDescription>
              </Alert>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Required columns:</strong> Email (for matching)<br />
                <strong>Optional columns:</strong> Admission Number, Phone, Roll Number<br />
                Only non-empty values will be updated.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{parsedStudents.length} students found</p>
                <p className="text-sm text-muted-foreground">
                  {studentsWithData.length} have data to update
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStep("upload");
                  setParsedStudents([]);
                  setFileName(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Change File
              </Button>
            </div>

            <ScrollArea className="h-[300px] border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Admission #</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Roll #</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedStudents.map((student, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-sm">{student.email}</TableCell>
                      <TableCell>{student.admissionNumber || "N/A"}</TableCell>
                      <TableCell>{student.phone || "N/A"}</TableCell>
                      <TableCell>{student.rollNumber || "N/A"}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeStudent(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        {step === "processing" && (
          <div className="space-y-4 py-8">
            <div className="flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <p className="text-center text-muted-foreground">
              Updating student profiles...
            </p>
            <Progress value={uploadProgress} className="w-full" />
            <p className="text-center text-sm text-muted-foreground">
              {Math.round(uploadProgress)}% complete
            </p>
          </div>
        )}

        {step === "complete" && results && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium">Update Complete</p>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">{results.updated}</p>
                  <p className="text-sm text-muted-foreground">Updated</p>
                </div>
                <div className="p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                  <p className="text-2xl font-bold text-yellow-600">{results.notFound}</p>
                  <p className="text-sm text-muted-foreground">Not Found</p>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600">{results.outOfScope}</p>
                  <p className="text-sm text-muted-foreground">Skipped (not your class)</p>
                </div>
                <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg">
                  <p className="text-2xl font-bold text-red-600">{results.errors}</p>
                  <p className="text-sm text-muted-foreground">Errors</p>
                </div>
              </div>
            </div>

            {(results.notFound > 0 || results.outOfScope > 0) && (
              <ScrollArea className="h-[200px] border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedStudents
                      .filter((s) => s.status === "not_found" || s.status === "out_of_scope")
                      .map((student, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-mono text-sm">{student.email}</TableCell>
                          <TableCell>
                            {student.status === "out_of_scope" ? (
                              <Badge variant="outline">Skipped (not your class)</Badge>
                            ) : (
                              <Badge variant="secondary">Not Found</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={studentsWithData.length === 0}>
                Update {studentsWithData.length} Students
              </Button>
            </>
          )}
          {step === "complete" && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
