import { saveBlob } from "@/lib/native";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ChevronDown, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateUser } from "@/hooks/useAdminOperations";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BulkUploadTeachersButtonProps {
  institutionId: string | null | undefined;
  onComplete?: () => void;
}

interface ParsedTeacher {
  name: string;
  email: string;
  phone: string;
  password: string;
  status: "pending" | "success" | "error";
  errorMessage?: string;
}

export function BulkUploadTeachersButton({ institutionId, onComplete }: BulkUploadTeachersButtonProps) {
  const [parsedTeachers, setParsedTeachers] = useState<ParsedTeacher[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const createUser = useCreateUser();
  const queryClient = useQueryClient();

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let password = "";
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const downloadTemplate = () => {
    const headers = ["name", "email", "phone_number", "password"];
    const sampleData = [
      ["John Doe", "john.doe@school.edu", "9876543210", ""],
      ["Jane Smith", "jane.smith@school.edu", "9876543211", "MyPassword123"],
    ];

    const csvContent = [
      headers.join(","),
      ...sampleData.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    saveBlob(blob, "teacher_upload_template.csv");
  };

  const parseCSV = (content: string): ParsedTeacher[] => {
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const nameIndex = headers.findIndex((h) => h.includes("name") && !h.includes("phone"));
    const emailIndex = headers.findIndex((h) => h.includes("email"));
    const phoneIndex = headers.findIndex((h) => h.includes("phone"));
    const passwordIndex = headers.findIndex((h) => h.includes("password"));

    if (nameIndex === -1 || emailIndex === -1) {
      toast({
        title: "Invalid CSV format",
        description: "CSV must have 'name' and 'email' columns",
        variant: "destructive",
      });
      return [];
    }

    const teachers: ParsedTeacher[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      if (values.length < 2 || !values[nameIndex] || !values[emailIndex]) continue;

      teachers.push({
        name: values[nameIndex] || "",
        email: values[emailIndex] || "",
        phone: phoneIndex !== -1 ? values[phoneIndex] || "" : "",
        password: passwordIndex !== -1 && values[passwordIndex] ? values[passwordIndex] : generatePassword(),
        status: "pending",
      });
    }

    return teachers;
  };

  const parseExcel = (data: ArrayBuffer): ParsedTeacher[] => {
    try {
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);

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
      const nameKey = keys.find((k) => k.toLowerCase().includes("name") && !k.toLowerCase().includes("phone"));
      const emailKey = keys.find((k) => k.toLowerCase().includes("email"));
      const phoneKey = keys.find((k) => k.toLowerCase().includes("phone"));
      const passwordKey = keys.find((k) => k.toLowerCase().includes("password"));

      if (!nameKey || !emailKey) {
        toast({
          title: "Invalid Excel format",
          description: "Excel must have 'name' and 'email' columns",
          variant: "destructive",
        });
        return [];
      }

      const teachers: ParsedTeacher[] = [];
      for (const row of jsonData) {
        const name = String(row[nameKey] || "").trim();
        const email = String(row[emailKey] || "").trim();
        if (!name || !email) continue;

        teachers.push({
          name,
          email,
          phone: phoneKey ? String(row[phoneKey] || "").trim() : "",
          password: passwordKey && row[passwordKey] ? String(row[passwordKey]).trim() : generatePassword(),
          status: "pending",
        });
      }

      return teachers;
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

    if (fileExtension === ".csv") {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const teachers = parseCSV(content);
        if (teachers.length > 0) {
          setParsedTeachers(teachers);
          setShowConfirm(true);
        }
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result as ArrayBuffer;
        const teachers = parseExcel(data);
        if (teachers.length > 0) {
          setParsedTeachers(teachers);
          setShowConfirm(true);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUpload = async () => {
    if (!institutionId) {
      toast({
        title: "No institution",
        description: "Institution ID is required",
        variant: "destructive",
      });
      return;
    }

    setShowConfirm(false);
    setIsUploading(true);
    setUploadProgress(0);
    setShowResults(true);

    const updatedTeachers = [...parsedTeachers];
    let successCount = 0;

    for (let i = 0; i < updatedTeachers.length; i++) {
      const teacher = updatedTeachers[i];

      try {
        const result = await createUser.mutateAsync({
          fullName: teacher.name,
          email: teacher.email,
          password: teacher.password,
          role: "teacher",
          institutionId,
        });

        // Update profile with phone number
        if (result?.userId && teacher.phone) {
          await supabase
            .from("profiles")
            .update({ phone: teacher.phone })
            .eq("id", result.userId);
        }

        updatedTeachers[i] = { ...teacher, status: "success" };
        successCount++;
      } catch (error: any) {
        updatedTeachers[i] = {
          ...teacher,
          status: "error",
          errorMessage: error.message || "Failed to create teacher",
        };
      }

      setParsedTeachers([...updatedTeachers]);
      setUploadProgress(((i + 1) / updatedTeachers.length) * 100);
    }

    setIsUploading(false);

    await queryClient.invalidateQueries({ queryKey: ["school-teachers"] });

    toast({
      title: "Bulk upload complete",
      description: `Successfully created ${successCount} of ${updatedTeachers.length} teachers. Welcome emails have been sent to all teachers.`,
    });

    onComplete?.();
  };

  const handleCloseResults = () => {
    setShowResults(false);
    setParsedTeachers([]);
    setUploadProgress(0);
  };

  const successCount = parsedTeachers.filter((t) => t.status === "success").length;
  const errorCount = parsedTeachers.filter((t) => t.status === "error").length;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
      />
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={isUploading}>
            {isUploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Bulk Upload
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Upload File
          </DropdownMenuItem>
          <DropdownMenuItem onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Teacher Upload</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to create {parsedTeachers.length} teacher accounts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <ScrollArea className="max-h-[300px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedTeachers.slice(0, 10).map((teacher, index) => (
                  <TableRow key={index}>
                    <TableCell className="text-sm">{teacher.name}</TableCell>
                    <TableCell className="text-sm">{teacher.email}</TableCell>
                    <TableCell className="text-sm">{teacher.phone || "-"}</TableCell>
                  </TableRow>
                ))}
                {parsedTeachers.length > 10 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      ...and {parsedTeachers.length - 10} more
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpload}>
              Upload {parsedTeachers.length} Teachers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Results Dialog */}
      <AlertDialog open={showResults} onOpenChange={setShowResults}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Upload Progress</AlertDialogTitle>
            <AlertDialogDescription>
              {isUploading 
                ? "Creating teacher accounts..." 
                : `Completed: ${successCount} success, ${errorCount} failed`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isUploading && (
            <Progress value={uploadProgress} className="h-2" />
          )}
          
          <ScrollArea className="max-h-[300px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedTeachers.map((teacher, index) => (
                  <TableRow key={index}>
                    <TableCell className="text-sm">{teacher.name}</TableCell>
                    <TableCell className="text-sm">{teacher.email}</TableCell>
                    <TableCell>
                      {teacher.status === "pending" && (
                        <Badge variant="secondary" className="text-xs">Pending</Badge>
                      )}
                      {teacher.status === "success" && (
                        <Badge className="text-xs bg-green-600">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Success
                        </Badge>
                      )}
                      {teacher.status === "error" && (
                        <Badge variant="destructive" className="text-xs" title={teacher.errorMessage}>
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          <AlertDialogFooter>
            <AlertDialogAction onClick={handleCloseResults} disabled={isUploading}>
              {isUploading ? "Uploading..." : "Close"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
