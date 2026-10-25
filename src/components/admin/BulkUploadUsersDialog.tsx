import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X } from "lucide-react";
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
import * as XLSX from "xlsx";

interface BulkUploadUsersDialogProps {
  trigger?: React.ReactNode;
  defaultRole?: "teacher" | "student" | "coordinator";
  institutionId?: string;
}

interface ParsedUser {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  status: "pending" | "success" | "error";
  errorMessage?: string;
}

export function BulkUploadUsersDialog({ trigger, defaultRole, institutionId }: BulkUploadUsersDialogProps) {
  const [open, setOpen] = useState(false);
  const [parsedUsers, setParsedUsers] = useState<ParsedUser[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
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

  const parseCSV = (content: string): ParsedUser[] => {
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
    const nameIndex = headers.findIndex(h => h.includes("name"));
    const emailIndex = headers.findIndex(h => h.includes("email"));
    const phoneIndex = headers.findIndex(h => h.includes("phone"));
    const passwordIndex = headers.findIndex(h => h.includes("password"));

    if (nameIndex === -1 || emailIndex === -1) {
      toast({
        title: "Invalid CSV format",
        description: "CSV must have 'name' and 'email' columns",
        variant: "destructive",
      });
      return [];
    }

    const users: ParsedUser[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
      if (values.length < 2) continue;

      const fullName = values[nameIndex] || "";
      const email = values[emailIndex] || "";
      const phone = phoneIndex !== -1 ? (values[phoneIndex] || "") : "";
      const password = passwordIndex !== -1 && values[passwordIndex] 
        ? values[passwordIndex] 
        : generatePassword();

      if (fullName && email) {
        users.push({
          fullName,
          email,
          phone,
          password,
          status: "pending",
        });
      }
    }

    return users;
  };

  const parseExcel = (data: ArrayBuffer): ParsedUser[] => {
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

      // Find the correct columns
      const firstRow = jsonData[0];
      const keys = Object.keys(firstRow);
      const nameKey = keys.find(k => k.toLowerCase().includes("name"));
      const emailKey = keys.find(k => k.toLowerCase().includes("email"));
      const phoneKey = keys.find(k => k.toLowerCase().includes("phone"));
      const passwordKey = keys.find(k => k.toLowerCase().includes("password"));

      if (!nameKey || !emailKey) {
        toast({
          title: "Invalid Excel format",
          description: "Excel must have 'name' and 'email' columns",
          variant: "destructive",
        });
        return [];
      }

      const users: ParsedUser[] = [];
      for (const row of jsonData) {
        const fullName = String(row[nameKey] || "").trim();
        const email = String(row[emailKey] || "").trim();
        const phone = phoneKey ? String(row[phoneKey] || "").trim() : "";
        const password = passwordKey && row[passwordKey] 
          ? String(row[passwordKey]).trim() 
          : generatePassword();

        if (fullName && email) {
          users.push({
            fullName,
            email,
            phone,
            password,
            status: "pending",
          });
        }
      }

      return users;
    } catch (error) {
      toast({
        title: "Error parsing Excel",
        description: "Failed to read the Excel file",
        variant: "destructive",
      });
      return [];
    }
  };

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    // Check file extension
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!allowedExtensions.includes(fileExtension)) {
      return { valid: false, error: "Only .csv, .xlsx, or .xls files are allowed" };
    }
    
    // Check file size (max 10MB for Excel)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return { valid: false, error: "File size exceeds 10MB limit" };
    }
    
    return { valid: true };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      toast({
        title: "Invalid file",
        description: validation.error,
        variant: "destructive",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setFileName(file.name);
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (fileExtension === '.csv') {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        
        // Validate content starts with expected header pattern
        const firstLine = content.split('\n')[0].toLowerCase();
        if (!firstLine.includes('name') || !firstLine.includes('email')) {
          toast({
            title: "Invalid CSV format",
            description: "CSV must have 'name' and 'email' columns in the header",
            variant: "destructive",
          });
          setParsedUsers([]);
          return;
        }
        
        const users = parseCSV(content);
        setParsedUsers(users);
      };
      reader.onerror = () => {
        toast({
          title: "Error reading file",
          description: "Failed to read the uploaded file",
          variant: "destructive",
        });
      };
      reader.readAsText(file);
    } else {
      // Excel file
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result as ArrayBuffer;
        const users = parseExcel(data);
        setParsedUsers(users);
      };
      reader.onerror = () => {
        toast({
          title: "Error reading file",
          description: "Failed to read the Excel file",
          variant: "destructive",
        });
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleUpload = async () => {
    if (!institutionId || !defaultRole) {
      toast({
        title: "Configuration error",
        description: "Missing institution or role configuration",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const updatedUsers = [...parsedUsers];
    let successCount = 0;

    for (let i = 0; i < updatedUsers.length; i++) {
      const user = updatedUsers[i];
      
      try {
        const result = await createUser.mutateAsync({
          fullName: user.fullName,
          email: user.email,
          password: user.password,
          role: defaultRole,
          institutionId,
        });
        
        // Update phone number in profile if provided
        if (user.phone && result?.userId) {
          await supabase
            .from("profiles")
            .update({ phone: user.phone })
            .eq("id", result.userId);
        }
        
        updatedUsers[i] = { ...user, status: "success" };
        successCount++;
      } catch (error: any) {
        updatedUsers[i] = { 
          ...user, 
          status: "error", 
          errorMessage: error.message || "Failed to create user" 
        };
      }

      setParsedUsers([...updatedUsers]);
      setUploadProgress(((i + 1) / updatedUsers.length) * 100);
    }

    setIsUploading(false);
    
    // Force refresh all relevant queries after bulk upload completes
    await queryClient.invalidateQueries({ queryKey: ["users"] });
    await queryClient.invalidateQueries({ queryKey: ["school-students"] });
    await queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
    await queryClient.invalidateQueries({ queryKey: ["school-coordinators"] });
    await queryClient.invalidateQueries({ queryKey: ["school-admin-stats"] });
    await queryClient.invalidateQueries({ queryKey: ["super-admin-stats"] });
    
    toast({
      title: "Bulk upload complete",
      description: `Successfully created ${successCount} of ${updatedUsers.length} users. Welcome emails have been sent to all users with valid email addresses.`,
    });
  };

  const handleClose = () => {
    setOpen(false);
    setParsedUsers([]);
    setFileName(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeUser = (index: number) => {
    setParsedUsers(users => users.filter((_, i) => i !== index));
  };

  const roleLabel = defaultRole === "teacher" ? "Teachers" : defaultRole === "student" ? "Students" : "Coordinators";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Bulk Upload
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Upload {roleLabel}</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file with name and email columns. Passwords will be auto-generated if not provided.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden">
          {/* File Upload */}
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
                onClick={() => {
                  const templateType = defaultRole === "teacher" ? "teachers" : defaultRole === "student" ? "students" : "coordinators";
                  import("@/utils/csvTemplates").then(({ downloadTemplate }) => {
                    downloadTemplate(templateType);
                  });
                }}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Supports CSV (.csv) and Excel (.xlsx, .xls) files. Required columns: name, email. Optional: phone, password
            </p>
          </div>

          {/* Sample Format */}
          <Alert>
            <FileSpreadsheet className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium mb-1">Expected format (CSV or Excel):</p>
              <code className="text-xs bg-muted p-1 rounded block">
                name,email,phone,password<br />
                John Doe,john@school.edu,9876543210,optional123
              </code>
            </AlertDescription>
          </Alert>

          {/* Preview Table */}
          {parsedUsers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Preview ({parsedUsers.length} users)</Label>
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
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Password</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedUsers.map((user, index) => (
                      <TableRow key={index}>
                        <TableCell className="text-sm">{user.fullName}</TableCell>
                        <TableCell className="text-sm">{user.email}</TableCell>
                        <TableCell className="text-sm">{user.phone || "N/A"}</TableCell>
                        <TableCell className="text-sm font-mono">{user.password}</TableCell>
                        <TableCell>
                          {user.status === "pending" && (
                            <Badge variant="secondary" className="text-xs">Pending</Badge>
                          )}
                          {user.status === "success" && (
                            <Badge className="text-xs bg-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Success
                            </Badge>
                          )}
                          {user.status === "error" && (
                            <Badge variant="destructive" className="text-xs" title={user.errorMessage}>
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Failed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeUser(index)}
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

          {/* Progress */}
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {parsedUsers.some(u => u.status === "success") ? "Done" : "Cancel"}
          </Button>
          <Button 
            onClick={handleUpload} 
            disabled={parsedUsers.length === 0 || isUploading || parsedUsers.every(u => u.status !== "pending")}
          >
            {isUploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Upload {parsedUsers.filter(u => u.status === "pending").length} Users
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
