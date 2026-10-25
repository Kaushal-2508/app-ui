import { saveBlob } from "@/lib/native";
import { useState, useCallback } from "react";
import Papa from "papaparse";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSyllabusCache } from "@/lib/queryKeys";

interface BulkUploadGradesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedRow {
  grade_number: string;
  grade_name: string;
  display_order?: string;
}

interface ProcessingStats {
  created: number;
  skipped: number;
  errors: string[];
}

type UploadStep = "upload" | "preview";
type ProcessingState = "idle" | "processing" | "complete";

export function BulkUploadGradesDialog({
  open,
  onOpenChange,
}: BulkUploadGradesDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<UploadStep>("upload");
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ProcessingStats | null>(null);

  const resetState = () => {
    setStep("upload");
    setProcessingState("idle");
    setParsedData([]);
    setValidationErrors([]);
    setProgress(0);
    setStats(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const downloadTemplate = () => {
    const template = `grade_number,grade_name,display_order
1,Class 1,1
2,Class 2,2
3,Class 3,3
4,Class 4,4
5,Class 5,5
6,Class 6,6
7,Class 7,7
8,Class 8,8
9,Class 9,9
10,Class 10,10
11,Class 11,11
12,Class 12,12`;

    const blob = new Blob([template], { type: "text/csv" });
    saveBlob(blob, "grades_template.csv");
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
          if (!row.grade_name) errors.push(`Row ${index + 2}: Missing grade_name`);
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
      const { data: existingGrades } = await supabase
        .from("grade_levels")
        .select("grade_number");
      
      const existingGradeNumbers = new Set((existingGrades || []).map(g => g.grade_number));
      
      const total = parsedData.length;
      for (let i = 0; i < parsedData.length; i++) {
        const row = parsedData[i];
        const gradeNumber = parseInt(row.grade_number);
        
        if (existingGradeNumbers.has(gradeNumber)) {
          processingStats.skipped++;
        } else {
          const { error } = await supabase
            .from("grade_levels")
            .insert({
              grade_number: gradeNumber,
              grade_name: row.grade_name,
              display_order: row.display_order ? parseInt(row.display_order) : gradeNumber,
              is_active: true,
            });
          
          if (error) {
            processingStats.errors.push(`Grade ${row.grade_name}: ${error.message}`);
          } else {
            processingStats.created++;
          }
        }
        
        setProgress(Math.round(((i + 1) / total) * 100));
      }

      invalidateSyllabusCache(queryClient);

      setStats(processingStats);
      setProcessingState("complete");

      if (processingStats.errors.length === 0) {
        toast.success(`${processingStats.created} grades uploaded successfully!`);
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
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Bulk Upload Grades
          </DialogTitle>
          <DialogDescription>
            Upload multiple grades at once using a CSV file
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          {step === "upload" && (
            <div className="space-y-6 py-4">
              <div className="border-2 border-dashed rounded-xl p-8 text-center hover:border-primary/50 transition-colors">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-2">Upload CSV File</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload a CSV file with grade details
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
                  <strong>CSV Format:</strong> grade_number, grade_name, display_order (optional)
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4 py-4">
              {processingState === "processing" && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
                  <div className="text-center space-y-4">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <div>
                      <p className="font-medium">Uploading grades...</p>
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
                          {stats.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
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

                  <div className="bg-muted/50 rounded-lg p-4">
                    <h4 className="font-medium mb-2">Preview ({parsedData.length} grades)</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2">Grade #</th>
                            <th className="text-left py-2 px-2">Name</th>
                            <th className="text-left py-2 px-2">Order</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedData.slice(0, 10).map((row, i) => (
                            <tr key={i} className="border-b border-muted">
                              <td className="py-2 px-2">{row.grade_number}</td>
                              <td className="py-2 px-2">{row.grade_name}</td>
                              <td className="py-2 px-2">{row.display_order || "-"}</td>
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
                      Upload {parsedData.length} Grades
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
