import { saveBlob } from "@/lib/native";
import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type UploadType = "grades" | "subjects" | "topics" | "materials";

interface BulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: UploadType;
  grades?: { id: string; grade_name: string; grade_number: number }[];
  subjects?: { id: string; name: string }[];
}

interface ParsedRow {
  data: Record<string, string>;
  error?: string;
  status: "pending" | "success" | "error";
}

const TEMPLATES: Record<UploadType, { headers: string[]; example: string[] }> = {
  grades: {
    headers: ["grade_number", "grade_name"],
    example: ["5", "Class 5"],
  },
  subjects: {
    headers: ["name", "code", "category"],
    example: ["Mathematics", "MATH", "core"],
  },
  topics: {
    headers: ["grade_name", "subject_name", "topic_name", "difficulty_level"],
    example: ["Class 5", "Mathematics", "Fractions", "medium"],
  },
  materials: {
    headers: ["grade_name", "subject_name", "title", "publisher", "material_type", "external_link", "file_url"],
    example: ["Class 5", "Mathematics", "NCERT Math Book", "NCERT", "book", "https://ncert.nic.in", ""],
  },
};

export function BulkUploadDialog({ 
  open, 
  onOpenChange, 
  type,
  grades = [],
  subjects = []
}: BulkUploadDialogProps) {
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: ParsedRow[] = results.data.map((row: unknown) => {
          const data = row as Record<string, string>;
          const error = validateRow(data);
          return { data, error, status: error ? "error" : "pending" };
        });
        setParsedRows(rows);
        setResult(null);
      },
      error: (error) => {
        toast.error(`Parse error: ${error.message}`);
      },
    });
  };

  const validateRow = (row: Record<string, string>): string | undefined => {
    const template = TEMPLATES[type];
    const requiredFields = template.headers.slice(0, 2); // First 2 are required
    
    for (const field of requiredFields) {
      if (!row[field]?.trim()) {
        return `Missing required field: ${field}`;
      }
    }

    if (type === "topics" || type === "materials") {
      const gradeName = row.grade_name?.trim();
      const subjectName = row.subject_name?.trim();
      
      if (!grades.some(g => g.grade_name === gradeName)) {
        return `Grade not found: ${gradeName}`;
      }
      if (!subjects.some(s => s.name === subjectName)) {
        return `Subject not found: ${subjectName}`;
      }
    }

    return undefined;
  };

  const downloadTemplate = () => {
    const template = TEMPLATES[type];
    const csvContent = [
      template.headers.join(","),
      template.example.join(","),
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    saveBlob(blob, `${type}_template.csv`);
  };

  const handleUpload = async () => {
    const validRows = parsedRows.filter(r => r.status === "pending");
    if (validRows.length === 0) {
      toast.error("No valid rows to upload");
      return;
    }

    setIsUploading(true);
    setProgress(0);
    let success = 0;
    let failed = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        await insertRow(row.data);
        row.status = "success";
        success++;
      } catch (error) {
        row.status = "error";
        row.error = error instanceof Error ? error.message : "Unknown error";
        failed++;
      }
      setProgress(Math.round(((i + 1) / validRows.length) * 100));
      setParsedRows([...parsedRows]);
    }

    setIsUploading(false);
    setResult({ success, failed });

    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: ["grade-levels"] });
    queryClient.invalidateQueries({ queryKey: ["universal-subjects"] });
    queryClient.invalidateQueries({ queryKey: ["syllabus-topics"] });
    queryClient.invalidateQueries({ queryKey: ["study-materials"] });

    toast.success(`Uploaded ${success} items, ${failed} failed`);
  };

  const insertRow = async (data: Record<string, string>) => {
    switch (type) {
      case "grades": {
        const { error } = await supabase.from("grade_levels").insert({
          grade_number: parseInt(data.grade_number),
          grade_name: data.grade_name,
          is_active: true,
        });
        if (error) throw error;
        break;
      }
      case "subjects": {
        const { error } = await supabase.from("universal_subjects").insert({
          name: data.name,
          code: data.code || null,
          category: data.category || null,
        });
        if (error) throw error;
        break;
      }
      case "topics": {
        const grade = grades.find(g => g.grade_name === data.grade_name);
        const subject = subjects.find(s => s.name === data.subject_name);
        if (!grade || !subject) throw new Error("Grade or subject not found");
        
        const { error } = await supabase.from("syllabus_topics").insert({
          grade_level_id: grade.id,
          subject_id: subject.id,
          topic_name: data.topic_name,
          difficulty_level: data.difficulty_level || null,
        });
        if (error) throw error;
        break;
      }
      case "materials": {
        const grade = grades.find(g => g.grade_name === data.grade_name);
        const subject = subjects.find(s => s.name === data.subject_name);
        if (!grade || !subject) throw new Error("Grade or subject not found");
        
        const { data: { user } } = await supabase.auth.getUser();
        
        // Determine the URL - file_url takes precedence, then external_link
        const fileUrl = data.file_url?.trim() || null;
        const externalLink = data.external_link?.trim() || null;
        
        const { error } = await supabase.from("study_materials").insert({
          grade_level_id: grade.id,
          subject_id: subject.id,
          title: data.title,
          publisher: data.publisher || null,
          material_type: data.material_type || "book",
          file_url: fileUrl,
          external_link: externalLink,
          created_by: user?.id || "",
          institution_id: null,
        });
        if (error) throw error;
        break;
      }
    }
  };

  const resetDialog = () => {
    setParsedRows([]);
    setProgress(0);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetDialog();
      onOpenChange(open);
    }}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Bulk Upload {type === "topics" ? "Chapters" : type.charAt(0).toUpperCase() + type.slice(1)}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {/* Template Download */}
            <div className="flex items-center justify-between p-4 border rounded-xl bg-muted/50 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm truncate">Download CSV template for {type === "topics" ? "chapters" : type}</span>
              </div>
              <Button variant="default" size="sm" onClick={downloadTemplate} className="shrink-0">
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>

            {/* Important Notice */}
            <Alert className="rounded-xl border-destructive/30 bg-destructive/5">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-destructive text-xs">
                <strong>Important:</strong> Ensure your CSV headers match the template exactly. 
                {type === "topics" || type === "materials" 
                  ? " Grade and subject names must match existing records." 
                  : " First two columns are required fields."}
              </AlertDescription>
            </Alert>

            {/* File Upload */}
            <div className="flex items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button onClick={() => fileInputRef.current?.click()} variant="secondary" className="shrink-0">
                <Upload className="h-4 w-4 mr-2" />
                Select CSV File
              </Button>
              <span className="text-sm text-muted-foreground">
                {parsedRows.length > 0 ? `${parsedRows.length} rows loaded` : "No file selected"}
              </span>
            </div>

          {/* Preview Table */}
          {parsedRows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Status</TableHead>
                    {TEMPLATES[type].headers.map((header) => (
                      <TableHead key={header}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.slice(0, 10).map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        {row.status === "success" && (
                          <Badge variant="default" className="bg-green-500">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            OK
                          </Badge>
                        )}
                        {row.status === "error" && (
                          <Badge variant="destructive">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Error
                          </Badge>
                        )}
                        {row.status === "pending" && (
                          <Badge variant="secondary">Pending</Badge>
                        )}
                      </TableCell>
                      {TEMPLATES[type].headers.map((header) => (
                        <TableCell key={header} className="max-w-[150px] truncate">
                          {row.data[header] || "-"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {parsedRows.length > 10 && (
                <div className="p-2 text-center text-sm text-muted-foreground bg-muted/50">
                  ...and {parsedRows.length - 10} more rows
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {isUploading && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-center text-muted-foreground">
                Uploading... {progress}%
              </p>
            </div>
          )}

          {/* Result */}
          {result && (
            <Alert>
              <AlertDescription className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Upload complete: {result.success} succeeded, {result.failed} failed
              </AlertDescription>
            </Alert>
          )}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button 
            onClick={handleUpload} 
            disabled={isUploading || parsedRows.filter(r => r.status === "pending").length === 0}
          >
            {isUploading ? "Uploading..." : "Upload All"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
