import { saveBlob } from "@/lib/native";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  X,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateUser } from "@/hooks/useAdminOperations";
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
import { supabase } from "@/integrations/supabase/client";
import { useClasses } from "@/hooks/useClasses";
import * as XLSX from "xlsx";
import { formatClassName } from "@/lib/utils";
import { getDisplaySection } from "@/lib/sectionDisplay";

interface BulkUploadStudentsDialogProps {
  trigger?: React.ReactNode;
  institutionId: string;
  /** For coordinators - limit class selection to these class IDs */
  coordinatorClassIds?: string[];
}

interface ParsedStudent {
  name: string;
  email: string;
  phone: string;
  admissionNumber: string;
  rollNumber: string;
  password: string;
  status: "pending" | "success" | "error";
  errorMessage?: string;
}

export function BulkUploadStudentsDialog({
  trigger,
  institutionId,
  coordinatorClassIds,
}: BulkUploadStudentsDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"context" | "upload">("context");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [parsedStudents, setParsedStudents] = useState<ParsedStudent[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const createUser = useCreateUser();
  const queryClient = useQueryClient();

  const { data: allClasses = [] } = useClasses(institutionId);

  // Filter classes if coordinator class IDs are provided
  const classes =
    coordinatorClassIds && coordinatorClassIds.length > 0
      ? allClasses.filter((c) => coordinatorClassIds.includes(c.id))
      : allClasses;

  // Group classes by name for selection
  const classNames = [...new Set(classes.map((c) => c.name))];
  const sectionsForClass = (className: string) =>
    classes.filter((c) => c.name === className);

  // Get selected class info
  const selectedClass = classes.find((c) => c.id === selectedClassId);

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let password = "";
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const downloadTemplate = () => {
    const headers = [
      "name",
      "email",
      "phone_number",
      "admission_number",
      "roll_number",
      "password",
    ];
    const sampleData = [
      [
        "Alice Johnson",
        "alice@school.edu",
        "9876543210",
        "ADM001",
        "1",
        "SecurePass123",
      ],
      ["Bob Smith", "", "9876543211", "ADM002", "2", ""],
    ];

    const csvContent = [
      headers.join(","),
      ...sampleData.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    saveBlob(blob, "student_upload_template.csv");
  };

  const parseCSV = (content: string): ParsedStudent[] => {
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0]
      .toLowerCase()
      .split(",")
      .map((h) => h.trim());
    const nameIndex = headers.findIndex(
      (h) => h.includes("name") && !h.includes("roll"),
    );
    const emailIndex = headers.findIndex((h) => h.includes("email"));
    const phoneIndex = headers.findIndex((h) => h.includes("phone"));
    const admissionIndex = headers.findIndex((h) => h.includes("admission"));
    const rollIndex = headers.findIndex((h) => h.includes("roll"));
    const passwordIndex = headers.findIndex((h) => h.includes("password"));

    if (nameIndex === -1) {
      toast({
        title: "Invalid CSV format",
        description: "CSV must have a 'name' column",
        variant: "destructive",
      });
      return [];
    }

    const students: ParsedStudent[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i]
        .split(",")
        .map((v) => v.trim().replace(/^"|"$/g, ""));
      if (values.length < 1 || !values[nameIndex]) continue;

      students.push({
        name: values[nameIndex] || "",
        email: emailIndex !== -1 ? values[emailIndex] || "" : "",
        phone: phoneIndex !== -1 ? values[phoneIndex] || "" : "",
        admissionNumber:
          admissionIndex !== -1 ? values[admissionIndex] || "" : "",
        rollNumber: rollIndex !== -1 ? values[rollIndex] || "" : "",
        password: passwordIndex !== -1 ? values[passwordIndex] || "" : "",
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
      const nameKey = keys.find(
        (k) =>
          k.toLowerCase().includes("name") && !k.toLowerCase().includes("roll"),
      );
      const emailKey = keys.find((k) => k.toLowerCase().includes("email"));
      const phoneKey = keys.find((k) => k.toLowerCase().includes("phone"));
      const admissionKey = keys.find((k) =>
        k.toLowerCase().includes("admission"),
      );
      const rollKey = keys.find((k) => k.toLowerCase().includes("roll"));
      const passwordKey = keys.find((k) =>
        k.toLowerCase().includes("password"),
      );

      if (!nameKey) {
        toast({
          title: "Invalid Excel format",
          description: "Excel must have a 'name' column",
          variant: "destructive",
        });
        return [];
      }

      const students: ParsedStudent[] = [];
      for (const row of jsonData) {
        const name = String(row[nameKey] || "").trim();
        if (!name) continue;

        students.push({
          name,
          email: emailKey ? String(row[emailKey] || "").trim() : "",
          phone: phoneKey ? String(row[phoneKey] || "").trim() : "",
          admissionNumber: admissionKey
            ? String(row[admissionKey] || "").trim()
            : "",
          rollNumber: rollKey ? String(row[rollKey] || "").trim() : "",
          password: passwordKey ? String(row[passwordKey] || "").trim() : "",
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
    const fileExtension = file.name
      .toLowerCase()
      .substring(file.name.lastIndexOf("."));
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
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result as ArrayBuffer;
        const students = parseExcel(data);
        setParsedStudents(students);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // Pre-upload validation for duplicates
  const validateDuplicates = async (): Promise<{
    valid: boolean;
    errors: string[];
  }> => {
    const errors: string[] = [];

    // Check for duplicates within the file
    const emails = parsedStudents
      .map((s) => s.email?.toLowerCase())
      .filter(Boolean);
    const phones = parsedStudents
      .map((s) => s.phone?.replace(/\D/g, ""))
      .filter(Boolean);
    const admissions = parsedStudents
      .map((s) => s.admissionNumber?.toLowerCase())
      .filter(Boolean);

    const duplicateEmails = emails.filter((e, i) => emails.indexOf(e) !== i);
    const duplicatePhones = phones.filter((p, i) => phones.indexOf(p) !== i);
    const duplicateAdmissions = admissions.filter(
      (a, i) => admissions.indexOf(a) !== i,
    );

    if (duplicateEmails.length > 0) {
      errors.push(
        `Duplicate emails in file: ${[...new Set(duplicateEmails)].join(", ")}`,
      );
    }
    if (duplicatePhones.length > 0) {
      errors.push(
        `Duplicate phone numbers in file: ${[...new Set(duplicatePhones)].join(", ")}`,
      );
    }
    if (duplicateAdmissions.length > 0) {
      errors.push(
        `Duplicate admission numbers in file: ${[...new Set(duplicateAdmissions)].join(", ")}`,
      );
    }

    // Check against existing database records
    if (emails.length > 0) {
      const { data: existingEmails } = await supabase
        .from("profiles")
        .select("email")
        .in("email", emails);
      if (existingEmails && existingEmails.length > 0) {
        errors.push(
          `Emails already registered: ${existingEmails.map((e) => e.email).join(", ")}`,
        );
      }
    }

    if (phones.length > 0) {
      const { data: existingPhones } = await supabase
        .from("profiles")
        .select("phone")
        .in("phone", phones);
      if (existingPhones && existingPhones.length > 0) {
        errors.push(
          `Phone numbers already registered: ${existingPhones.map((p) => p.phone).join(", ")}`,
        );
      }
    }

    if (admissions.length > 0) {
      const { data: existingAdmissions } = await supabase
        .from("profiles")
        .select("admission_number")
        .in("admission_number", admissions);
      if (existingAdmissions && existingAdmissions.length > 0) {
        errors.push(
          `Admission numbers already registered: ${existingAdmissions.map((a) => a.admission_number).join(", ")}`,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  };

  const handleUpload = async () => {
    if (!selectedClassId) {
      toast({
        title: "No class selected",
        description: "Please select a class before uploading",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    // Validate for duplicates first
    const { valid, errors: validationErrors } = await validateDuplicates();
    if (!valid) {
      toast({
        title: "Duplicate records found",
        description: validationErrors.join(". "),
        variant: "destructive",
      });
      setIsUploading(false);
      return;
    }

    const updatedStudents = [...parsedStudents];
    let successCount = 0;

    for (let i = 0; i < updatedStudents.length; i++) {
      const student = updatedStudents[i];

      try {
        // Use provided password or generate one
        const password = student.password || generatePassword();
        const hasRealEmail = Boolean(student.email && student.email.trim().length > 0);
        const emailToUse =
          hasRealEmail
            ? student.email
            : `${student.admissionNumber.replace(/\s/g, "")}@temp.local`;

        const result = await createUser.mutateAsync({
          fullName: student.name,
          email: emailToUse,
          password,
          role: "student",
          institutionId,
          // FIX ADDED HERE: Passing the parsed fields to the mutation
          phone: student.phone,
          admissionNumber: student.admissionNumber,
          rollNumber: student.rollNumber,
          // Only send the welcome email when a real address was provided.
          skipWelcomeEmail: !hasRealEmail,
        });

        // Update profile logic removed as it's now handled by the Edge Function
        if (result?.userId) {
          // Assign student to class
          const {
            data: { user },
          } = await supabase.auth.getUser();
          await supabase.from("class_assignments").insert({
            class_id: selectedClassId,
            user_id: result.userId,
            role: "student",
            assigned_by: user?.id,
          });
        }

        updatedStudents[i] = { ...student, status: "success" };
        successCount++;
      } catch (error) {
        updatedStudents[i] = {
          ...student,
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Failed to create student",
        };
      }

      setParsedStudents([...updatedStudents]);
      setUploadProgress(((i + 1) / updatedStudents.length) * 100);
    }

    setIsUploading(false);

    await queryClient.invalidateQueries({ queryKey: ["school-students"] });
    await queryClient.invalidateQueries({ queryKey: ["classes"] });
    await queryClient.invalidateQueries({ queryKey: ["teacher-class-students"] });
    await queryClient.invalidateQueries({ queryKey: ["teacher-assigned-classes"] });

    toast({
      title: "Bulk upload complete",
      description: `Successfully created ${successCount} of ${updatedStudents.length} students. Welcome emails have been sent to all students with valid email addresses.`,
    });
  };

  const handleClose = () => {
    setOpen(false);
    setStep("context");
    setSelectedClassId("");
    setParsedStudents([]);
    setFileName(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeStudent = (index: number) => {
    setParsedStudents((students) => students.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Bulk Upload Students
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Bulk Upload Students</DialogTitle>
          <DialogDescription>
            {step === "context"
              ? "Select the class and section for the students you want to upload."
              : "Upload a CSV or Excel file with student details."}
          </DialogDescription>
        </DialogHeader>

        {step === "context" ? (
          <div className="flex-1 overflow-y-auto min-h-0 pr-2 -mr-2 space-y-4 py-4">
            <div className="space-y-2">
              <Label>Class</Label>
              <Select
                value={selectedClass?.name || ""}
                onValueChange={(name) => {
                  const first = classes.find((c) => c.name === name);
                  if (first) setSelectedClassId(first.id);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedClass && (
              <div className="space-y-2">
                <Label>Section</Label>
                <Select
                  value={selectedClassId}
                  onValueChange={setSelectedClassId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sectionsForClass(selectedClass.name).map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {getDisplaySection(cls.name, cls.section) ?? cls.section ?? "Default"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedClass && (
              <Alert>
                <AlertDescription>
                  Students will be added to:{" "}
                  <strong>
                    {formatClassName(selectedClass.name, selectedClass.section)}
                  </strong>
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 pr-2 -mr-2 space-y-4 py-2">
            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
              <Badge variant="outline">
                {formatClassName(selectedClass?.name || "", selectedClass?.section)}
              </Badge>
            </div>

            <div className="grid gap-2">
              <Label>CSV or Excel File</Label>
              <div className="flex items-center gap-2">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadTemplate}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Template
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Columns: name (required), email, phone_number, admission_number,
                roll_number, password (optional - auto-generated if empty)
              </p>
            </div>

            <Alert>
              <FileSpreadsheet className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Expected format:</p>
                <code className="text-xs bg-muted p-1 rounded block">
                  name,email,phone_number,admission_number,roll_number,password
                  <br />
                  Alice
                  Johnson,alice@school.edu,9876543210,ADM001,1,SecurePass123
                </code>
                <p className="text-xs text-muted-foreground mt-1">
                  If password is empty, a secure password will be
                  auto-generated.
                </p>
              </AlertDescription>
            </Alert>

            {parsedStudents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Preview ({parsedStudents.length} students)</Label>
                  {fileName && (
                    <Badge variant="outline" className="text-xs">
                      {fileName}
                    </Badge>
                  )}
                </div>
                <ScrollArea className="h-[200px] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Admission #</TableHead>
                        <TableHead>Roll #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[40px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedStudents.map((student, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-sm">
                            {student.name}
                          </TableCell>
                          <TableCell className="text-sm">
                            {student.phone || "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {student.admissionNumber || "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {student.rollNumber || "-"}
                          </TableCell>
                          <TableCell>
                            {student.status === "pending" && (
                              <Badge variant="secondary" className="text-xs">
                                Pending
                              </Badge>
                            )}
                            {student.status === "success" && (
                              <Badge className="text-xs bg-green-600">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Success
                              </Badge>
                            )}
                            {student.status === "error" && (
                              <Badge
                                variant="destructive"
                                className="text-xs"
                                title={student.errorMessage}
                              >
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Failed
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {student.status === "pending" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => removeStudent(index)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}

            {isUploading && (
              <div className="space-y-2">
                <Label>Upload Progress</Label>
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {Math.round(uploadProgress)}% complete
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between flex-shrink-0">
          {step === "upload" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("context")}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {parsedStudents.some((s) => s.status === "success")
                ? "Done"
                : "Cancel"}
            </Button>
            {step === "context" ? (
              <Button
                onClick={() => setStep("upload")}
                disabled={!selectedClassId}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleUpload}
                disabled={
                  parsedStudents.length === 0 ||
                  isUploading ||
                  parsedStudents.every((s) => s.status !== "pending")
                }
              >
                {isUploading && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Upload{" "}
                {parsedStudents.filter((s) => s.status === "pending").length}{" "}
                Students
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
