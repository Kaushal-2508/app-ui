import { saveBlob } from "@/lib/native";
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Download, FileText, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBulkAddQuestionsToBank } from "@/hooks/useQuestionBank";
import Papa from "papaparse";
import { normalizeText } from "@/lib/textNormalization";
import { MathText } from "@/components/ui/math-text";

interface ParsedQuestion {
  questionText: string;
  questionType: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  marks: number;
  difficultyLevel: number;
  tags: string[];
  isValid: boolean;
  error?: string;
}

interface BulkUploadQuestionBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BulkUploadQuestionBankDialog({
  open,
  onOpenChange,
}: BulkUploadQuestionBankDialogProps) {
  const [gradeId, setGradeId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const bulkAdd = useBulkAddQuestionsToBank();

  const { data: grades } = useQuery({
    queryKey: ["grade-levels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name")
        .eq("is_active", true)
        .order("grade_number");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: subjects } = useQuery({
    queryKey: ["universal-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const downloadTemplate = () => {
    const template = `question_text,question_type,option_1,option_2,option_3,option_4,correct_answer,explanation,marks,difficulty,tags,topic
"What is 2+2?",mcq,"1","2","3","4","4","Basic addition",1,1,"math,basic","Algebra Basics"
"The Earth is flat",true_false,"","","","","False","The Earth is a sphere",1,2,"science,geography","Geography"
"The capital of France is ___",fill_blank,"","","","","Paris","",1,2,"geography","Geography"
"Explain photosynthesis",short_answer,"","","","","Plants convert sunlight to energy","",2,3,"biology,plants","Biology"`;
    
    const blob = new Blob([template], { type: "text/csv" });
    saveBlob(blob, "question_bank_template.csv");
  };

  const parseFile = useCallback((file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const questions: ParsedQuestion[] = results.data.map((rawRow: Record<string, string>) => {
          // Normalize all cell values
          const row = Object.fromEntries(
            Object.entries(rawRow).map(([k, v]) => [k, typeof v === 'string' ? normalizeText(v) : v])
          ) as Record<string, string>;
          const questionType = row.question_type?.toLowerCase() || "short_answer";
          const validTypes = ["mcq", "true_false", "fill_blank", "short_answer", "long_answer", "matching"];
          const isValidType = validTypes.includes(questionType);
          
          const options = [
            row.option_1?.trim(),
            row.option_2?.trim(),
            row.option_3?.trim(),
            row.option_4?.trim(),
          ].filter(Boolean);

          const marks = parseInt(row.marks) || 1;
          const difficulty = parseInt(row.difficulty) || 3;
          const tags = row.tags?.split(",").map((t: string) => t.trim()).filter(Boolean) || [];

          const isValid = 
            isValidType &&
            row.question_text?.trim().length >= 5 &&
            marks > 0 &&
            difficulty >= 1 && difficulty <= 5;

          return {
            questionText: row.question_text?.trim() || "",
            questionType: isValidType ? questionType : "short_answer",
            options,
            correctAnswer: row.correct_answer?.trim() || "",
            explanation: row.explanation?.trim() || "",
            marks,
            difficultyLevel: Math.min(5, Math.max(1, difficulty)),
            tags,
            isValid,
            error: !isValid ? "Invalid question format" : undefined,
          };
        });

        setParsedQuestions(questions);
      },
      error: (error) => {
        console.error("Parse error:", error);
      },
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "text/csv" || file.name.endsWith(".csv"))) {
      parseFile(file);
    }
  }, [parseFile]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseFile(file);
    }
  };

  const handleUpload = async () => {
    const validQuestions = parsedQuestions.filter((q) => q.isValid);
    
    await bulkAdd.mutateAsync({
      questions: validQuestions.map((q) => ({
        questionText: q.questionText,
        questionType: q.questionType as "mcq" | "true_false" | "fill_blank" | "short_answer" | "long_answer" | "matching",
        options: q.options.length > 0 ? q.options : undefined,
        correctAnswer: q.correctAnswer || undefined,
        explanation: q.explanation || undefined,
        marks: q.marks,
        difficultyLevel: q.difficultyLevel,
        tags: q.tags,
        gradeId: gradeId || undefined,
        subjectId: subjectId || undefined,
      })),
    });

    setParsedQuestions([]);
    onOpenChange(false);
  };

  const validCount = parsedQuestions.filter((q) => q.isValid).length;
  const invalidCount = parsedQuestions.filter((q) => !q.isValid).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Upload Questions</DialogTitle>
          <DialogDescription>
            Upload a CSV file to add multiple questions at once
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Grade Level (Optional)</Label>
              <SearchableSelect
                value={gradeId}
                onValueChange={setGradeId}
                placeholder="Select grade"
                searchPlaceholder="Search grades..."
                className="mt-1"
                options={grades?.map((grade) => ({
                  value: grade.id,
                  label: grade.grade_name,
                })) || []}
              />
            </div>
            <div>
              <Label>Subject (Optional)</Label>
              <SearchableSelect
                value={subjectId}
                onValueChange={setSubjectId}
                placeholder="Select subject"
                searchPlaceholder="Search subjects..."
                className="mt-1"
                options={subjects?.map((subject) => ({
                  value: subject.id,
                  label: subject.name,
                })) || []}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Drag and drop your CSV file here</p>
            <p className="text-muted-foreground mt-1">or</p>
            <label>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button variant="outline" className="mt-2" asChild>
                <span>Browse Files</span>
              </Button>
            </label>
          </div>

          {parsedQuestions.length > 0 && (
            <>
              <div className="flex gap-4">
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  {validCount} Valid
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" />
                    {invalidCount} Invalid
                  </Badge>
                )}
              </div>

              <div className="border rounded-lg max-h-64 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Status</TableHead>
                      <TableHead>Question</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Marks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedQuestions.slice(0, 20).map((q, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {q.isValid ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          <MathText text={q.questionText} />
                        </TableCell>
                        <TableCell>{q.questionType}</TableCell>
                        <TableCell>{q.marks}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsedQuestions.length > 20 && (
                  <p className="text-center py-2 text-muted-foreground text-sm">
                    And {parsedQuestions.length - 20} more...
                  </p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={validCount === 0 || bulkAdd.isPending}
            >
              {bulkAdd.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload {validCount} Questions
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
