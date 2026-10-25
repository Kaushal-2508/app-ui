import { saveBlob } from "@/lib/native";
import { useState, useCallback } from "react";
import Papa from "papaparse";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  Globe,
  Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { invalidateSyllabusCache } from "@/lib/queryKeys";

interface BulkUploadMaterialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedRow {
  grade_number: string;
  subject_name: string;
  topic_name: string;
  material_title: string;
  material_type: string;
  material_link?: string;
  description?: string;
}

interface ProcessingStats {
  created: number;
  skipped: number;
  errors: string[];
}

type UploadStep = "upload" | "preview";
type ProcessingState = "idle" | "processing" | "complete";

export function BulkUploadMaterialsDialog({
  open,
  onOpenChange,
}: BulkUploadMaterialsDialogProps) {
  const queryClient = useQueryClient();
  const { data: userRole } = useUserRole();
  const [step, setStep] = useState<UploadStep>("upload");
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ProcessingStats | null>(null);
  const [isGlobal, setIsGlobal] = useState(false);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");

  // Fetch institutions list for super admin
  const { data: institutions } = useQuery({
    queryKey: ["institutions-for-material"],
    queryFn: async () => {
      const { data } = await supabase
        .from("institutions")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: userRole?.isSuperAdmin,
  });

  const selectedInstitutionName = institutions?.find(i => i.id === selectedInstitutionId)?.name;

  const resetState = () => {
    setStep("upload");
    setProcessingState("idle");
    setParsedData([]);
    setValidationErrors([]);
    setProgress(0);
    setStats(null);
    setIsGlobal(false);
    setSelectedInstitutionId("");
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const downloadTemplate = () => {
    const template = `grade_number,subject_name,topic_name,material_title,material_type,material_link,description
3,English Literature,Bird Talk,Worksheet 1,worksheet,https://example.com/worksheet1.pdf,Practice exercises
3,English Literature,Bird Talk,Video Lesson,video,https://example.com/video1.mp4,Introduction to the chapter
3,Mathematics,Fractions,Practice Sheet,worksheet,https://example.com/fractions.pdf,50 practice problems
4,Science,Plant Life,Interactive Quiz,link,https://example.com/quiz,Self-assessment quiz`;

    const blob = new Blob([template], { type: "text/csv" });
    saveBlob(blob, "study_materials_template.csv");
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        
        results.data.forEach((row, index) => {
          if (!row.grade_number) errors.push(`Row ${index + 2}: Missing grade_number`);
          if (!row.subject_name) errors.push(`Row ${index + 2}: Missing subject_name`);
          if (!row.topic_name) errors.push(`Row ${index + 2}: Missing topic_name`);
          if (!row.material_title) errors.push(`Row ${index + 2}: Missing material_title`);
          if (!row.material_type) errors.push(`Row ${index + 2}: Missing material_type`);
        });

        setValidationErrors(errors);
        setParsedData(results.data);
        setStep("preview");
      },
      error: (error) => {
        toast.error(`Failed to parse CSV: ${error.message}`);
      },
    });
    
    e.target.value = "";
  }, []);

  const processUpload = async () => {
    setProcessingState("processing");
    setProgress(0);

    const processingStats: ProcessingStats = {
      created: 0,
      skipped: 0,
      errors: [],
    };

    try {
      // Fetch lookup data
      const { data: grades } = await supabase
        .from("grade_levels")
        .select("id, grade_number");
      
      const { data: subjects } = await supabase
        .from("universal_subjects")
        .select("id, name");

      const { data: topics } = await supabase
        .from("syllabus_topics")
        .select("id, grade_level_id, subject_id, topic_name");

      const gradeMap: Record<number, string> = {};
      (grades || []).forEach(g => { gradeMap[g.grade_number] = g.id; });

      const subjectMap: Record<string, string> = {};
      (subjects || []).forEach(s => { subjectMap[s.name.toLowerCase()] = s.id; });

      const topicMap: Record<string, string> = {};
      (topics || []).forEach(t => {
        topicMap[`${t.grade_level_id}-${t.subject_id}-${t.topic_name.toLowerCase()}`] = t.id;
      });

      // Determine institution ID based on user role
      let institutionId: string | null = null;
      const { data: userData } = await supabase.auth.getUser();
      const uploaderId = userData?.user?.id ?? null;

      if (userRole?.isSuperAdmin) {
        // Super admin can choose global or specific institution
        institutionId = isGlobal ? null : selectedInstitutionId || null;
      } else {
        // Regular users use their own institution
        if (uploaderId) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("institution_id")
            .eq("id", uploaderId)
            .single();
          institutionId = profile?.institution_id || null;
        }

        if (!institutionId) {
          processingStats.errors.push("No institution found for user. Cannot upload materials.");
          setStats(processingStats);
          setProcessingState("complete");
          toast.error("No institution found. Please contact administrator.");
          return;
        }
      }

      setProgress(20);

      const total = parsedData.length;
      for (let i = 0; i < parsedData.length; i++) {
        const row = parsedData[i];
        const gradeId = gradeMap[parseInt(row.grade_number)];
        const subjectId = subjectMap[row.subject_name.toLowerCase()];
        
        if (!gradeId) {
          processingStats.errors.push(`Row ${i + 2}: Grade ${row.grade_number} not found`);
          processingStats.skipped++;
          continue;
        }

        if (!subjectId) {
          processingStats.errors.push(`Row ${i + 2}: Subject "${row.subject_name}" not found`);
          processingStats.skipped++;
          continue;
        }

        const topicKey = `${gradeId}-${subjectId}-${row.topic_name.toLowerCase()}`;
        const topicId = topicMap[topicKey];

        if (!topicId) {
          processingStats.errors.push(`Row ${i + 2}: Topic "${row.topic_name}" not found for Grade ${row.grade_number}, ${row.subject_name}`);
          processingStats.skipped++;
          continue;
        }

        const { error } = await supabase
          .from("study_materials")
          .insert({
            topic_id: topicId,
            grade_level_id: gradeId,
            subject_id: subjectId,
            institution_id: institutionId,
            title: row.material_title,
            material_type: row.material_type,
            external_link: row.material_link || null,
            description: row.description || null,
            is_active: true,
            created_by: uploaderId,
          });

        if (error) {
          processingStats.errors.push(`Row ${i + 2}: ${error.message}`);
          processingStats.skipped++;
        } else {
          processingStats.created++;
        }

        setProgress(20 + Math.round(((i + 1) / total) * 80));
      }

      invalidateSyllabusCache(queryClient);

      setStats(processingStats);
      setProcessingState("complete");

      if (processingStats.errors.length === 0) {
        toast.success(`${processingStats.created} study materials uploaded successfully!`);
      } else {
        toast.warning(`Upload completed with ${processingStats.errors.length} errors`);
      }
    } catch (error) {
      processingStats.errors.push(`Unexpected error: ${String(error)}`);
      setStats(processingStats);
      setProcessingState("complete");
      toast.error("Upload failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Bulk Upload Study Materials
          </DialogTitle>
          <DialogDescription>
            Upload study materials (PDFs, videos, links) for existing topics
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          {step === "upload" && (
            <div className="space-y-6 py-4">
              {/* Institution Selection for Super Admin */}
              {userRole?.isSuperAdmin && (
                <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="global-bulk-material"
                      checked={isGlobal}
                      onCheckedChange={(checked) => {
                        setIsGlobal(checked === true);
                        if (checked) setSelectedInstitutionId("");
                      }}
                    />
                    <Label htmlFor="global-bulk-material" className="flex items-center gap-2 cursor-pointer">
                      <Globe className="h-4 w-4 text-primary" />
                      Upload as Global Materials
                      <span className="text-xs text-muted-foreground">(available to all institutions)</span>
                    </Label>
                  </div>

                  {!isGlobal && (
                    <div className="space-y-2">
                      <Label>Target Institution</Label>
                      <SearchableSelect
                        value={selectedInstitutionId}
                        onValueChange={setSelectedInstitutionId}
                        placeholder="Select institution..."
                        searchPlaceholder="Search institutions..."
                        options={(institutions || []).map((inst) => ({
                          value: inst.id,
                          label: inst.name,
                        }))}
                      />
                    </div>
                  )}

                  {(isGlobal || selectedInstitutionName) && (
                    <div className="flex items-center gap-2 text-sm">
                      {isGlobal ? (
                        <span className="flex items-center gap-1 text-primary font-medium">
                          <Globe className="h-4 w-4" />
                          Materials will be global
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Building2 className="h-4 w-4" />
                          Materials will be added to: <strong>{selectedInstitutionName}</strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="border-2 border-dashed rounded-xl p-8 text-center hover:border-primary/50 transition-colors">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-2">Upload CSV File</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload study materials with links to resources
                </p>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="max-w-xs mx-auto"
                />
              </div>

              <div className="flex items-center justify-center">
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Required columns:</strong> grade_number, subject_name, topic_name, material_title, material_type
                  <br />
                  <strong>Optional:</strong> material_link, description
                  <br />
                  <strong>Material types:</strong> pdf, video, image, document, worksheet, link, ppt
                </AlertDescription>
              </Alert>

              <Alert className="bg-amber-500/10 border-amber-500/20">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-amber-700 dark:text-amber-300">
                  <strong>Note:</strong> Topics must already exist. Upload grades & subjects/topics first if needed.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4 py-4 relative">
              {processingState === "processing" && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
                  <div className="text-center space-y-4">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <div>
                      <p className="font-medium">Uploading study materials...</p>
                      <Progress value={progress} className="w-48 mt-2" />
                    </div>
                  </div>
                </div>
              )}

              {processingState === "complete" && stats && (
                <div className="space-y-4">
                  <Alert className="bg-primary/10 border-primary/20">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <AlertDescription>
                      <strong>Upload Complete!</strong>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <div>Created: {stats.created}</div>
                        <div>Skipped: {stats.skipped}</div>
                      </div>
                    </AlertDescription>
                  </Alert>

                  {stats.errors.length > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>{stats.errors.length} Errors:</strong>
                        <ul className="mt-2 list-disc pl-4 text-sm max-h-32 overflow-auto">
                          {stats.errors.slice(0, 10).map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                          {stats.errors.length > 10 && (
                            <li>...and {stats.errors.length - 10} more</li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button onClick={handleClose} className="w-full">
                    Close
                  </Button>
                </div>
              )}

              {processingState === "idle" && (
                <>
                  {validationErrors.length > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Validation Errors:</strong>
                        <ul className="mt-2 list-disc pl-4 text-sm max-h-24 overflow-auto">
                          {validationErrors.slice(0, 5).map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                          {validationErrors.length > 5 && (
                            <li>...and {validationErrors.length - 5} more</li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold">{parsedData.length}</p>
                    <p className="text-sm text-muted-foreground">Materials to Upload</p>
                  </div>

                  <div className="bg-muted/50 rounded-lg p-4">
                    <h4 className="font-medium mb-2">Preview (first 10 rows)</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2">Grade</th>
                            <th className="text-left py-2 px-2">Subject</th>
                            <th className="text-left py-2 px-2">Chapter</th>
                            <th className="text-left py-2 px-2">Material</th>
                            <th className="text-left py-2 px-2">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedData.slice(0, 10).map((row, i) => (
                            <tr key={i} className="border-b border-muted">
                              <td className="py-2 px-2">{row.grade_number}</td>
                              <td className="py-2 px-2 truncate max-w-[100px]">{row.subject_name}</td>
                              <td className="py-2 px-2 truncate max-w-[100px]">{row.topic_name}</td>
                              <td className="py-2 px-2 truncate max-w-[100px]">{row.material_title}</td>
                              <td className="py-2 px-2">{row.material_type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parsedData.length > 10 && (
                        <p className="text-sm text-muted-foreground mt-2">
                          ...and {parsedData.length - 10} more rows
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep("upload")} className="flex-1">
                      Back
                    </Button>
                    <Button
                      onClick={processUpload}
                      disabled={validationErrors.length > 0}
                      className="flex-1"
                    >
                      Upload {parsedData.length} Materials
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
