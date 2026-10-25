import { saveBlob } from "@/lib/native";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { ClassSectionSelector } from "@/components/shared/ClassSectionSelector";
import { TopicAutocomplete } from "@/components/shared/TopicAutocomplete";
import { useGradeLevelFromClass, useSubjectsForClasses } from "@/hooks/useTeacherClasses";
import * as XLSX from "xlsx";

interface BulkUploadStudyMaterialsDialogProps {
  trigger?: React.ReactNode;
  institutionId?: string | null;
}

interface ParsedMaterial {
  title: string;
  materialType: string;
  link: string;
  description: string;
  publisher: string;
  isValid: boolean;
  errors: string[];
  status: "pending" | "success" | "error";
  errorMessage?: string;
}

const MATERIAL_TYPES = ["pdf", "video", "image", "document", "worksheet", "link", "ppt"];

export function BulkUploadStudyMaterialsDialog({ trigger, institutionId: propInstitutionId }: BulkUploadStudyMaterialsDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"context" | "upload">("context");

  // Context state
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedTopicName, setSelectedTopicName] = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null);

  // Upload state
  const [parsedMaterials, setParsedMaterials] = useState<ParsedMaterial[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: userRole } = useUserRole();

  // Determine effective institution
  const effectiveInstitutionId = selectedInstitutionId || propInstitutionId || userRole?.institutionId;

  // Get user ID for teacher filtering
  const { data: currentUser } = useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  // Get grade level from selected class
  const { data: gradeLevel } = useGradeLevelFromClass(selectedClassId);

  // Get subjects for selected classes
  const { data: subjects = [] } = useSubjectsForClasses(selectedSections);

  // Determine role for component
  const componentRole = userRole?.isSuperAdmin
    ? "super_admin"
    : userRole?.isSchoolAdmin
    ? "school_admin"
    : userRole?.isCoordinator
    ? "coordinator"
    : "teacher";

  const downloadTemplate = () => {
    const headers = ["title", "description", "link"];
    const sampleData = [
      ["Introduction to Algebra", "Basic algebra concepts for beginners", "https://example.com/algebra.pdf"],
      ["Physics Lecture Video", "Newton's laws explained visually", "https://youtube.com/watch?v=xyz"],
      ["Chemistry Worksheet", "Practice problems on chemical reactions", "https://example.com/chem.pdf"],
    ];

    const csvContent = [headers.join(","), ...sampleData.map((row) => row.map((cell) => `"${cell}"`).join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    saveBlob(blob, "study_materials_template.csv");
  };

  const validateMaterial = (m: Partial<ParsedMaterial>): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!m.title?.trim()) errors.push("Title required");
    if (!m.link?.trim()) errors.push("Link/URL required");

    return { isValid: errors.length === 0, errors };
  };

  const parseCSV = (content: string): ParsedMaterial[] => {
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));

    const findIndex = (keywords: string[]) =>
      headers.findIndex((h) => keywords.some((k) => h.includes(k)));

    const indices = {
      title: findIndex(["title", "name", "material_title"]),
      description: findIndex(["description", "desc"]),
      link: findIndex(["link", "url", "material_link"]),
    };

    if (indices.title === -1) {
      toast({ title: "Invalid format", description: "Missing title column", variant: "destructive" });
      return [];
    }

    const materials: ParsedMaterial[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const char of lines[i]) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const getValue = (idx: number) => (idx !== -1 ? values[idx]?.replace(/^"|"$/g, "") || "" : "");

      const m: Partial<ParsedMaterial> = {
        title: getValue(indices.title),
        description: getValue(indices.description),
        link: getValue(indices.link),
        materialType: "document", // Auto-detect from link extension
        publisher: "",
      };

      if (!m.title) continue;

      const validation = validateMaterial(m);
      materials.push({
        ...m,
        isValid: validation.isValid,
        errors: validation.errors,
        status: "pending",
      } as ParsedMaterial);
    }

    return materials;
  };

  const parseExcel = (data: ArrayBuffer): ParsedMaterial[] => {
    try {
      const workbook = XLSX.read(data, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);

      if (jsonData.length === 0) {
        toast({ title: "Empty file", description: "No data found", variant: "destructive" });
        return [];
      }

      const materials: ParsedMaterial[] = [];
      for (const row of jsonData) {
        const keys = Object.keys(row);
        const find = (keywords: string[]) =>
          keys.find((k) => keywords.some((kw) => k.toLowerCase().includes(kw)));

        const m: Partial<ParsedMaterial> = {
          title: String(row[find(["title", "name", "material_title"]) || ""] || "").trim(),
          description: String(row[find(["description"]) || ""] || "").trim(),
          link: String(row[find(["link", "url", "material_link"]) || ""] || "").trim(),
          materialType: "document",
          publisher: "",
        };

        if (!m.title) continue;

        const validation = validateMaterial(m);
        materials.push({
          ...m,
          isValid: validation.isValid,
          errors: validation.errors,
          status: "pending",
        } as ParsedMaterial);
      }

      return materials;
    } catch (error) {
      toast({ title: "Error parsing Excel", description: "Failed to read file", variant: "destructive" });
      return [];
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
    if (![".csv", ".xlsx", ".xls"].includes(ext)) {
      toast({ title: "Invalid file", description: "Only CSV/Excel files allowed", variant: "destructive" });
      return;
    }

    setFileName(file.name);

    if (ext === ".csv") {
      const reader = new FileReader();
      reader.onload = (e) => setParsedMaterials(parseCSV(e.target?.result as string));
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => setParsedMaterials(parseExcel(e.target?.result as ArrayBuffer));
      reader.readAsArrayBuffer(file);
    }
  };

  const handleUpload = async () => {
    const validMaterials = parsedMaterials.filter((m) => m.isValid && m.status === "pending");
    if (validMaterials.length === 0) {
      toast({ title: "No valid materials", description: "Fix errors before uploading", variant: "destructive" });
      return;
    }

    if (!selectedSubjectId || !gradeLevel?.id) {
      toast({ title: "Missing context", description: "Subject and grade required", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const updated = [...parsedMaterials];
    let successCount = 0;

    for (let i = 0; i < updated.length; i++) {
      const m = updated[i];
      if (!m.isValid || m.status !== "pending") continue;

      try {
        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.from("study_materials").insert({
          title: m.title,
          material_type: m.materialType,
          external_link: m.link,
          description: m.description || null,
          publisher: m.publisher || null,
          subject_id: selectedSubjectId,
          grade_level_id: gradeLevel.id,
          topic_id: selectedTopicId || null,
          institution_id: effectiveInstitutionId || null,
          created_by: user?.id,
          is_active: true,
        });

        if (error) throw error;

        updated[i] = { ...m, status: "success" };
        successCount++;
      } catch (error: any) {
        updated[i] = { ...m, status: "error", errorMessage: error.message };
      }

      setParsedMaterials([...updated]);
      setUploadProgress(((i + 1) / validMaterials.length) * 100);
    }

    setIsUploading(false);
    await queryClient.invalidateQueries({ queryKey: ["study-materials"] });

    toast({
      title: "Upload complete",
      description: `Added ${successCount} of ${validMaterials.length} materials`,
    });
  };

  const handleClose = () => {
    setOpen(false);
    setStep("context");
    setSelectedClassId("");
    setSelectedSections([]);
    setSelectedSubjectId("");
    setSelectedTopicId(null);
    setSelectedTopicName("");
    setSelectedInstitutionId(null);
    setParsedMaterials([]);
    setFileName(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validCount = parsedMaterials.filter((m) => m.isValid).length;
  const invalidCount = parsedMaterials.length - validCount;
  const canProceed = selectedSections.length > 0 && selectedSubjectId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Bulk Upload Materials
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Upload Study Materials</DialogTitle>
          <DialogDescription>
            {step === "context"
              ? "Select the class, section(s), subject, and topic for the materials."
              : "Upload a CSV or Excel file with material details."}
          </DialogDescription>
        </DialogHeader>

        {step === "context" ? (
          <div className="space-y-4 py-4 overflow-y-auto">
            <ClassSectionSelector
              institutionId={effectiveInstitutionId}
              userRole={componentRole}
              userId={currentUser?.id}
              selectedClassId={selectedClassId}
              selectedSections={selectedSections}
              onClassChange={setSelectedClassId}
              onSectionsChange={setSelectedSections}
              showGlobalOption={userRole?.isSuperAdmin}
              showInstitutionSelector={userRole?.isSuperAdmin}
              selectedInstitutionId={selectedInstitutionId}
              onInstitutionChange={setSelectedInstitutionId}
            />

            {selectedSections.length > 0 && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedSubjectId && gradeLevel && (
              <div className="space-y-2">
                <Label>Chapter (Optional)</Label>
                <TopicAutocomplete
                  institutionId={effectiveInstitutionId}
                  subjectId={selectedSubjectId}
                  gradeLevelId={gradeLevel.id}
                  value={selectedTopicId}
                  topicName={selectedTopicName}
                  onChange={(id, name) => {
                    setSelectedTopicId(id);
                    setSelectedTopicName(name);
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 flex-1 overflow-hidden">
            <div className="flex flex-wrap gap-2 p-2 bg-muted/50 rounded-md">
              <Badge variant="outline">Sections: {selectedSections.length}</Badge>
              <Badge variant="outline">Subject: {subjects.find((s) => s.id === selectedSubjectId)?.name}</Badge>
              {selectedTopicName && <Badge variant="outline">Chapter: {selectedTopicName}</Badge>}
            </div>

            <div className="grid gap-2">
              <Label>CSV or Excel File</Label>
              <div className="flex items-center gap-2">
                <Input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Template
                </Button>
              </div>
            </div>

            <Alert>
              <FileSpreadsheet className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Expected format:</p>
                <code className="text-xs bg-muted p-1 rounded block">
                  title,description,link
                </code>
              </AlertDescription>
            </Alert>

            {parsedMaterials.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Preview ({parsedMaterials.length} materials)</Label>
                  <div className="flex gap-2">
                    <Badge className="bg-green-600">{validCount} valid</Badge>
                    {invalidCount > 0 && <Badge variant="destructive">{invalidCount} invalid</Badge>}
                  </div>
                </div>
                <ScrollArea className="h-[200px] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[250px]">Title</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Publisher</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedMaterials.map((m, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm truncate max-w-[250px]">{m.title}</TableCell>
                          <TableCell className="text-sm">{m.materialType}</TableCell>
                          <TableCell className="text-sm">{m.publisher || "-"}</TableCell>
                          <TableCell>
                            {!m.isValid ? (
                              <Badge variant="destructive" className="text-xs" title={m.errors.join(", ")}>
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Invalid
                              </Badge>
                            ) : m.status === "success" ? (
                              <Badge className="bg-green-600 text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Added
                              </Badge>
                            ) : m.status === "error" ? (
                              <Badge variant="destructive" className="text-xs" title={m.errorMessage}>
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Failed
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Ready</Badge>
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
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">{Math.round(uploadProgress)}%</p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {step === "upload" && (
            <Button type="button" variant="outline" onClick={() => setStep("context")}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {parsedMaterials.some((m) => m.status === "success") ? "Done" : "Cancel"}
            </Button>
            {step === "context" ? (
              <Button onClick={() => setStep("upload")} disabled={!canProceed}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleUpload} disabled={validCount === 0 || isUploading}>
                {isUploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Upload {validCount} Materials
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}