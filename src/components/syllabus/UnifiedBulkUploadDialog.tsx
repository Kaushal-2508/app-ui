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
  Layers,
  BookOpen,
  GraduationCap,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSyllabusCache } from "@/lib/queryKeys";

interface UnifiedBulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedRow {
  grade_number: string;
  grade_name: string;
  subject_name: string;
  subject_code?: string;
  subject_category?: string;
  topic_name: string;
  topic_name_hindi?: string;
  difficulty_level?: string;
  material_title?: string;
  material_type?: string;
  material_link?: string;
}

interface ProcessingStats {
  gradesCreated: number;
  gradesSkipped: number;
  subjectsCreated: number;
  subjectsSkipped: number;
  assignmentsCreated: number;
  assignmentsSkipped: number;
  topicsCreated: number;
  topicsSkipped: number;
  materialsCreated: number;
  materialsSkipped: number;
  errors: string[];
}

type UploadStep = "upload" | "preview";
type ProcessingState = "idle" | "processing" | "complete";

export function UnifiedBulkUploadDialog({
  open,
  onOpenChange,
}: UnifiedBulkUploadDialogProps) {
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
    const template = `grade_number,grade_name,subject_name,subject_code,subject_category,topic_name,topic_name_hindi,difficulty_level,material_title,material_type,material_link
3,Class 3,English Literature,ENG-LIT,language,Bird Talk,,easy,Worksheet 1,worksheet,https://example.com/worksheet1.pdf
3,Class 3,English Literature,ENG-LIT,language,Little by Little,,easy,,,
3,Class 3,Mathematics,MATH,core,Fractions,,medium,Practice Sheet,worksheet,https://example.com/fractions.pdf
4,Class 4,Science,SCI,core,Plant Life,,easy,Video Lesson,video,https://example.com/plants.mp4`;

    const blob = new Blob([template], { type: "text/csv" });
    saveBlob(blob, "syllabus_template.csv");
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        
        // Validate required fields
        results.data.forEach((row, index) => {
          if (!row.grade_number) errors.push(`Row ${index + 2}: Missing grade_number`);
          if (!row.grade_name) errors.push(`Row ${index + 2}: Missing grade_name`);
          if (!row.subject_name) errors.push(`Row ${index + 2}: Missing subject_name`);
          if (!row.topic_name) errors.push(`Row ${index + 2}: Missing topic_name`);
        });

        setValidationErrors(errors);
        setParsedData(results.data);
        setStep("preview");
      },
      error: (error) => {
        toast.error(`Failed to parse CSV: ${error.message}`);
      },
    });
    
    // Reset input
    e.target.value = "";
  }, []);

  const processUpload = async () => {
    setProcessingState("processing");
    setProgress(0);

    const processingStats: ProcessingStats = {
      gradesCreated: 0,
      gradesSkipped: 0,
      subjectsCreated: 0,
      subjectsSkipped: 0,
      assignmentsCreated: 0,
      assignmentsSkipped: 0,
      topicsCreated: 0,
      topicsSkipped: 0,
      materialsCreated: 0,
      materialsSkipped: 0,
      errors: [],
    };

    try {
      // Step 1: Process Grades (20%)
      const uniqueGrades = [...new Map(parsedData.map(r => [r.grade_number, { number: parseInt(r.grade_number), name: r.grade_name }])).values()];
      
      const { data: existingGrades } = await supabase
        .from("grade_levels")
        .select("id, grade_number");
      
      const existingGradeNumbers = new Set((existingGrades || []).map(g => g.grade_number));
      const gradeMap: Record<number, string> = {};
      
      (existingGrades || []).forEach(g => { gradeMap[g.grade_number] = g.id; });

      for (const grade of uniqueGrades) {
        if (existingGradeNumbers.has(grade.number)) {
          processingStats.gradesSkipped++;
        } else {
          const { data, error } = await supabase
            .from("grade_levels")
            .insert({ grade_number: grade.number, grade_name: grade.name, is_active: true })
            .select("id")
            .single();
          
          if (error) {
            processingStats.errors.push(`Grade ${grade.name}: ${error.message}`);
          } else {
            gradeMap[grade.number] = data.id;
            processingStats.gradesCreated++;
          }
        }
      }
      setProgress(20);

      // Step 2: Process Subjects (40%)
      const uniqueSubjects = [...new Map(parsedData.map(r => [r.subject_name, { 
        name: r.subject_name, 
        code: r.subject_code || null, 
        category: r.subject_category || null 
      }])).values()];

      const { data: existingSubjects } = await supabase
        .from("universal_subjects")
        .select("id, name");

      const existingSubjectNames = new Set((existingSubjects || []).map(s => s.name.toLowerCase()));
      const subjectMap: Record<string, string> = {};

      (existingSubjects || []).forEach(s => { subjectMap[s.name.toLowerCase()] = s.id; });

      for (const subject of uniqueSubjects) {
        if (existingSubjectNames.has(subject.name.toLowerCase())) {
          processingStats.subjectsSkipped++;
        } else {
          const { data, error } = await supabase
            .from("universal_subjects")
            .insert({ name: subject.name, code: subject.code, category: subject.category })
            .select("id")
            .single();
          
          if (error) {
            processingStats.errors.push(`Subject ${subject.name}: ${error.message}`);
          } else {
            subjectMap[subject.name.toLowerCase()] = data.id;
            processingStats.subjectsCreated++;
          }
        }
      }
      setProgress(40);

      // Step 3: Process Grade-Subject Assignments (50%)
      const uniqueAssignments = [...new Set(parsedData.map(r => `${r.grade_number}-${r.subject_name.toLowerCase()}`))];

      const { data: existingAssignments } = await supabase
        .from("grade_subject_assignments")
        .select("grade_level_id, subject_id");

      const existingAssignmentKeys = new Set(
        (existingAssignments || []).map(a => `${a.grade_level_id}-${a.subject_id}`)
      );

      for (const key of uniqueAssignments) {
        const [gradeNum, subjectName] = key.split(/-(.+)/);
        const gradeId = gradeMap[parseInt(gradeNum)];
        const subjectId = subjectMap[subjectName];

        if (!gradeId || !subjectId) {
          processingStats.assignmentsSkipped++;
          continue;
        }

        const assignmentKey = `${gradeId}-${subjectId}`;
        if (existingAssignmentKeys.has(assignmentKey)) {
          processingStats.assignmentsSkipped++;
        } else {
          const { error } = await supabase
            .from("grade_subject_assignments")
            .insert({ grade_level_id: gradeId, subject_id: subjectId, is_active: true });

          if (error) {
            processingStats.errors.push(`Assignment ${key}: ${error.message}`);
          } else {
            processingStats.assignmentsCreated++;
          }
        }
      }
      setProgress(50);

      // Step 4: Process Topics (75%)
      const uniqueTopics = [...new Map(parsedData.map(r => [
        `${r.grade_number}-${r.subject_name.toLowerCase()}-${r.topic_name.toLowerCase()}`,
        {
          gradeNumber: parseInt(r.grade_number),
          subjectName: r.subject_name.toLowerCase(),
          topicName: r.topic_name,
          topicNameHindi: r.topic_name_hindi || null,
          difficultyLevel: r.difficulty_level || null,
        }
      ])).values()];

      const { data: existingTopics } = await supabase
        .from("syllabus_topics")
        .select("id, grade_level_id, subject_id, topic_name");

      const existingTopicKeys = new Set(
        (existingTopics || []).map(t => `${t.grade_level_id}-${t.subject_id}-${t.topic_name.toLowerCase()}`)
      );
      const topicMap: Record<string, string> = {};
      (existingTopics || []).forEach(t => {
        topicMap[`${t.grade_level_id}-${t.subject_id}-${t.topic_name.toLowerCase()}`] = t.id;
      });

      let displayOrder = 1;
      for (const topic of uniqueTopics) {
        const gradeId = gradeMap[topic.gradeNumber];
        const subjectId = subjectMap[topic.subjectName];

        if (!gradeId || !subjectId) {
          processingStats.topicsSkipped++;
          continue;
        }

        const topicKey = `${gradeId}-${subjectId}-${topic.topicName.toLowerCase()}`;
        if (existingTopicKeys.has(topicKey)) {
          processingStats.topicsSkipped++;
        } else {
          const { data, error } = await supabase
            .from("syllabus_topics")
            .insert({
              grade_level_id: gradeId,
              subject_id: subjectId,
              topic_name: topic.topicName,
              topic_name_hindi: topic.topicNameHindi,
              difficulty_level: topic.difficultyLevel,
              display_order: displayOrder++,
              is_active: true,
            })
            .select("id")
            .single();

          if (error) {
            processingStats.errors.push(`Topic ${topic.topicName}: ${error.message}`);
          } else {
            topicMap[topicKey] = data.id;
            processingStats.topicsCreated++;
          }
        }
      }
      setProgress(75);

      // Step 5: Process Materials (100%)
      const materialsToCreate = parsedData
        .filter(r => r.material_title && r.material_type)
        .map(r => ({
          gradeNumber: parseInt(r.grade_number),
          subjectName: r.subject_name.toLowerCase(),
          topicName: r.topic_name.toLowerCase(),
          title: r.material_title!,
          type: r.material_type!,
          link: r.material_link || null,
        }));

      // Get a default institution_id from the user's profile
      const { data: userData } = await supabase.auth.getUser();
      let institutionId: string | null = null;
      
      if (userData?.user?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("institution_id")
          .eq("id", userData.user.id)
          .single();
        institutionId = profile?.institution_id || null;
      }

      for (const material of materialsToCreate) {
        const gradeId = gradeMap[material.gradeNumber];
        const subjectId = subjectMap[material.subjectName];
        const topicKey = `${gradeId}-${subjectId}-${material.topicName}`;
        const topicId = topicMap[topicKey];

        if (!gradeId || !subjectId || !topicId) {
          processingStats.materialsSkipped++;
          continue;
        }

        // Only insert if we have an institution_id (required field)
        if (!institutionId) {
          processingStats.errors.push(`Material ${material.title}: No institution found for user`);
          processingStats.materialsSkipped++;
          continue;
        }

        const { error } = await supabase
          .from("study_materials")
          .insert({
            topic_id: topicId,
            grade_level_id: gradeId,
            subject_id: subjectId,
            institution_id: institutionId,
            title: material.title,
            material_type: material.type,
            external_link: material.link,
            is_active: true,
            created_by: userData?.user?.id ?? null,
          });

        if (error) {
          processingStats.errors.push(`Material ${material.title}: ${error.message}`);
          processingStats.materialsSkipped++;
        } else {
          processingStats.materialsCreated++;
        }
      }
      setProgress(100);

      // Invalidate queries
      invalidateSyllabusCache(queryClient);

      setStats(processingStats);
      setProcessingState("complete");

      if (processingStats.errors.length === 0) {
        toast.success("Syllabus uploaded successfully!");
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

  // Preview stats
  const previewStats = parsedData.length > 0 ? {
    grades: new Set(parsedData.map(r => r.grade_number)).size,
    subjects: new Set(parsedData.map(r => r.subject_name)).size,
    topics: new Set(parsedData.map(r => `${r.grade_number}-${r.subject_name}-${r.topic_name}`)).size,
    materials: parsedData.filter(r => r.material_title).length,
  } : null;

  const stepLabels = ["Select File", "Preview & Upload"];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk Upload Syllabus
          </DialogTitle>
          <DialogDescription>
            Upload your entire syllabus structure in one CSV file
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator - 2 steps */}
        <div className="flex items-center justify-center gap-2 py-2">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                    (step === "upload" && i === 0) || (step === "preview" && i === 1)
                      ? "bg-primary text-primary-foreground"
                      : step === "preview" && i === 0
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {step === "preview" && i === 0 ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span className="text-sm text-muted-foreground hidden sm:inline">{label}</span>
              </div>
              {i < 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        <ScrollArea className="flex-1 pr-4">
          {/* Upload Step */}
          {step === "upload" && (
            <div className="space-y-6 py-4">
              <div className="border-2 border-dashed rounded-xl p-8 text-center hover:border-primary/50 transition-colors">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-2">Upload CSV File</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Drag and drop or click to select your syllabus file
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
                  <strong>CSV Format:</strong> grade_number, grade_name, subject_name, subject_code, 
                  subject_category, topic_name, topic_name_hindi, difficulty_level, material_title, 
                  material_type, material_link
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Preview Step - includes processing and complete states */}
          {step === "preview" && (
            <div className="space-y-4 py-4">
              {/* Processing Overlay */}
              {processingState === "processing" && (
                <div className="space-y-4 mb-4">
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">Processing upload...</p>
                      <p className="text-xs text-muted-foreground">Please wait while we create your syllabus structure</p>
                    </div>
                    <span className="text-sm font-medium text-primary">{progress}%</span>
                  </div>
                  <Progress value={progress} />
                </div>
              )}

              {/* Complete State */}
              {processingState === "complete" && stats && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                    {stats.errors.length === 0 ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-yellow-600" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {stats.errors.length === 0 ? "Upload Complete!" : "Upload Completed with Warnings"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-green-500/10 text-center">
                      <div className="text-xl font-bold text-green-600">{stats.gradesCreated}</div>
                      <div className="text-xs text-muted-foreground">Grades Created</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted text-center">
                      <div className="text-xl font-bold text-muted-foreground">{stats.gradesSkipped}</div>
                      <div className="text-xs text-muted-foreground">Grades Skipped</div>
                    </div>
                    <div className="p-3 rounded-lg bg-green-500/10 text-center">
                      <div className="text-xl font-bold text-green-600">{stats.subjectsCreated}</div>
                      <div className="text-xs text-muted-foreground">Subjects Created</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted text-center">
                      <div className="text-xl font-bold text-muted-foreground">{stats.subjectsSkipped}</div>
                      <div className="text-xs text-muted-foreground">Subjects Skipped</div>
                    </div>
                    <div className="p-3 rounded-lg bg-green-500/10 text-center">
                      <div className="text-xl font-bold text-green-600">{stats.topicsCreated}</div>
                      <div className="text-xs text-muted-foreground">Chapters Created</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted text-center">
                      <div className="text-xl font-bold text-muted-foreground">{stats.topicsSkipped}</div>
                      <div className="text-xs text-muted-foreground">Chapters Skipped</div>
                    </div>
                    <div className="p-3 rounded-lg bg-green-500/10 text-center">
                      <div className="text-xl font-bold text-green-600">{stats.materialsCreated}</div>
                      <div className="text-xs text-muted-foreground">Materials Created</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted text-center">
                      <div className="text-xl font-bold text-muted-foreground">{stats.materialsSkipped}</div>
                      <div className="text-xs text-muted-foreground">Materials Skipped</div>
                    </div>
                  </div>

                  {stats.errors.length > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>{stats.errors.length} errors occurred:</strong>
                        <ul className="list-disc pl-4 mt-2 text-sm max-h-32 overflow-y-auto">
                          {stats.errors.slice(0, 10).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                          {stats.errors.length > 10 && (
                            <li>...and {stats.errors.length - 10} more</li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button onClick={handleClose} className="w-full">
                    Done
                  </Button>
                </div>
              )}

              {/* Preview Content - shown when idle */}
              {processingState === "idle" && (
                <>
                  {validationErrors.length > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>{validationErrors.length} validation errors:</strong>
                        <ul className="list-disc pl-4 mt-2 text-sm max-h-32 overflow-y-auto">
                          {validationErrors.slice(0, 10).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                          {validationErrors.length > 10 && (
                            <li>...and {validationErrors.length - 10} more</li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {previewStats && (
                    <div className="grid grid-cols-4 gap-4">
                      <div className="p-4 rounded-lg bg-muted/50 text-center">
                        <GraduationCap className="h-6 w-6 mx-auto text-primary mb-2" />
                        <div className="text-2xl font-bold text-foreground">{previewStats.grades}</div>
                        <div className="text-xs text-muted-foreground">Grades</div>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 text-center">
                        <BookOpen className="h-6 w-6 mx-auto text-primary mb-2" />
                        <div className="text-2xl font-bold text-foreground">{previewStats.subjects}</div>
                        <div className="text-xs text-muted-foreground">Subjects</div>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 text-center">
                        <Layers className="h-6 w-6 mx-auto text-primary mb-2" />
                        <div className="text-2xl font-bold text-foreground">{previewStats.topics}</div>
                        <div className="text-xs text-muted-foreground">Chapters</div>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 text-center">
                        <FileText className="h-6 w-6 mx-auto text-primary mb-2" />
                        <div className="text-2xl font-bold text-foreground">{previewStats.materials}</div>
                        <div className="text-xs text-muted-foreground">Materials</div>
                      </div>
                    </div>
                  )}

                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted px-4 py-2 text-sm font-medium">
                      Preview (first 10 rows)
                    </div>
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="px-2 py-1 text-left">Grade</th>
                            <th className="px-2 py-1 text-left">Subject</th>
                            <th className="px-2 py-1 text-left">Chapter</th>
                            <th className="px-2 py-1 text-left">Material</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedData.slice(0, 10).map((row, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-1">{row.grade_name}</td>
                              <td className="px-2 py-1">{row.subject_name}</td>
                              <td className="px-2 py-1">{row.topic_name}</td>
                              <td className="px-2 py-1">{row.material_title || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={resetState} className="flex-1">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      onClick={processUpload}
                      disabled={validationErrors.length > 0}
                      className="flex-1"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload
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
