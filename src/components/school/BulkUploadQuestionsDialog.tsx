import { saveBlob } from "@/lib/native";
import { useState, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast";
import type { DbQuestionType } from "@/types/exam";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MathText } from "@/components/ui/math-text";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useBulkAddQuestionsToBank } from "@/hooks/useQuestionBank";
import { ClassSectionSelector } from "@/components/shared/ClassSectionSelector";
import { TopicAutocomplete } from "@/components/shared/TopicAutocomplete";
import { useGradeLevelFromClass } from "@/hooks/useTeacherClasses";
import * as XLSX from "xlsx";
import { normalizeText } from "@/lib/textNormalization";

interface BulkUploadQuestionsDialogProps {
  trigger?: React.ReactNode;
  institutionId?: string | null;
}

interface ParsedQuestion {
  questionText: string;
  questionType: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation: string;
  marks: number;
  difficulty: string;
  tags: string;
  topic?: string;
  isValid: boolean;
  errors: string[];
  status: "pending" | "success" | "error";
}

const UPLOAD_QUESTION_TYPES = [
  { value: "mcq", label: "Multiple Choice (MCQ)" },
  { value: "true_false", label: "True / False" },
  { value: "short_answer", label: "Short Answer" },
  { value: "long_answer", label: "Long Answer" },
  { value: "fill_blank", label: "Fill in the Blank" },
  { value: "match", label: "Match the Following" },
  { value: "comprehension", label: "Comprehension" },
  { value: "case_study", label: "Case Study" },
] as const;

type UploadQuestionType = typeof UPLOAD_QUESTION_TYPES[number]["value"];

const QUESTION_TYPE_TEMPLATES: Record<UploadQuestionType, { headers: string[]; sample: string[][] }> = {
  mcq: {
    headers: ["question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "marks", "difficulty", "topic"],
    sample: [
      ["What is 2 + 2?", "3", "4", "5", "6", "B", "Basic addition: 2+2=4", "1", "easy", "Algebra Basics"],
      ["Which planet is closest to the Sun?", "Venus", "Mercury", "Earth", "Mars", "B", "Mercury is the closest", "1", "medium", "Solar System"],
    ],
  },
  true_false: {
    headers: ["question_text", "correct_answer", "explanation", "marks", "topic"],
    sample: [
      ["The Earth is flat.", "False", "Earth is approximately spherical", "1", "Geography"],
      ["Water boils at 100°C at sea level.", "True", "Standard boiling point", "1", "Chemistry"],
    ],
  },
  short_answer: {
    headers: ["question_text", "correct_answer", "explanation", "marks", "difficulty", "topic"],
    sample: [
      ["What is the chemical symbol for water?", "H2O", "Hydrogen and Oxygen", "2", "easy", "Chemistry"],
      ["Name the capital of France.", "Paris", "", "1", "easy", "Geography"],
    ],
  },
  long_answer: {
    headers: ["question_text", "model_answer", "marks", "difficulty", "topic"],
    sample: [
      ["Explain the process of photosynthesis.", "Plants convert sunlight, water, and CO2 into glucose and oxygen using chlorophyll.", "5", "medium", "Biology"],
      ["Describe Newton's three laws of motion.", "1st: Inertia, 2nd: F=ma, 3rd: Equal and opposite reaction.", "5", "hard", "Physics"],
    ],
  },
  fill_blank: {
    headers: ["question_text", "correct_answer", "explanation", "marks", "difficulty", "topic"],
    sample: [
      ["The chemical formula of water is ___.", "H2O", "Hydrogen + Oxygen", "1", "easy", "Chemistry"],
      ["The capital of India is ___.", "New Delhi", "", "1", "easy", "Geography"],
    ],
  },
  match: {
    headers: ["question_text", "column_a_items", "column_b_items", "correct_pairs", "marks", "topic"],
    sample: [
      ["Match the countries with their capitals", "India;France;Japan", "Tokyo;New Delhi;Paris", "India-New Delhi;France-Paris;Japan-Tokyo", "3", "Geography"],
      ["Match the elements with their symbols", "Gold;Silver;Iron", "Fe;Au;Ag", "Gold-Au;Silver-Ag;Iron-Fe", "3", "Chemistry"],
    ],
  },
  comprehension: {
    headers: ["passage_text", "question_text", "question_type", "option_a", "option_b", "option_c", "option_d", "correct_answer", "marks", "topic"],
    sample: [
      ["The sun rises in the east and sets in the west...", "Where does the sun rise?", "mcq", "North", "East", "West", "South", "B", "1", "Astronomy"],
      ["The sun rises in the east and sets in the west...", "Explain why the sun appears to move.", "short_answer", "", "", "", "", "Earth rotates on its axis", "2", "Astronomy"],
    ],
  },
  case_study: {
    headers: ["case_text", "question_text", "question_type", "option_a", "option_b", "option_c", "option_d", "correct_answer", "marks", "topic"],
    sample: [
      ["A company produces 100 units per day...", "How many units in a week?", "short_answer", "", "", "", "", "700", "2", "Business Math"],
      ["A company produces 100 units per day...", "What is the monthly output?", "mcq", "2000", "3000", "3100", "2800", "B", "1", "Business Math"],
    ],
  },
};

const VALID_QUESTION_TYPES = UPLOAD_QUESTION_TYPES.map(t => t.value);

export function BulkUploadQuestionsDialog({ trigger, institutionId: propInstitutionId }: BulkUploadQuestionsDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"context" | "upload">("context");
  
  // Context state
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedTopicName, setSelectedTopicName] = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null);
  const [selectedQuestionType, setSelectedQuestionType] = useState<UploadQuestionType | "">("");
  
  // Upload state
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: userRole } = useUserRole();
  const bulkAddQuestions = useBulkAddQuestionsToBank();

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

  // Detect global mode
  const isGlobalMode = userRole?.isSuperAdmin && !selectedInstitutionId;

  // Global mode: get subjects directly by grade_level_id (mirrors Syllabus page)
  const { data: globalSubjects = [] } = useQuery({
    queryKey: ["global-subjects-for-grade", gradeLevel?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name, code, category")
        .eq("grade_level_id", gradeLevel!.id)
        .order("display_order");
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: !!isGlobalMode && !!gradeLevel?.id,
  });

  // Institution mode: get subjects mapped to selected classes via subject_class_mappings
  const { data: institutionSubjects = [] } = useQuery({
    queryKey: ["institution-subjects-for-upload", selectedSections],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subject_class_mappings")
        .select("subject_id, universal_subjects!inner(id, name)")
        .in("class_id", selectedSections);
      if (error) throw error;
      // `!inner` on the to-one FK returns one object per mapping row.
      type MappingRow = { universal_subjects: { id: string; name: string } };
      const seen = new Set<string>();
      return ((data || []) as unknown as MappingRow[])
        .map((m) => ({ id: m.universal_subjects.id, name: m.universal_subjects.name }))
        .filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !isGlobalMode && selectedSections.length > 0,
  });

  // Use global subjects in global mode, otherwise institution subjects
  const effectiveSubjects = isGlobalMode ? globalSubjects : institutionSubjects;

  // Determine role for component
  const componentRole = userRole?.isSuperAdmin
    ? "super_admin"
    : userRole?.isSchoolAdmin
    ? "school_admin"
    : userRole?.isCoordinator
    ? "coordinator"
    : "teacher";

  const downloadTemplate = () => {
    if (!selectedQuestionType) return;
    const template = QUESTION_TYPE_TEMPLATES[selectedQuestionType];
    const csvContent = [
      template.headers.join(","),
      ...template.sample.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    saveBlob(blob, `${selectedQuestionType}_questions_template.csv`);
  };

  const validateQuestion = (q: Partial<ParsedQuestion>): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!q.questionText?.trim()) errors.push("Question text required");

    if (selectedQuestionType === "mcq") {
      if (!q.optionA || !q.optionB) errors.push("MCQ needs at least 2 options");
      if (!q.correctAnswer || !["A", "B", "C", "D"].includes(q.correctAnswer.toUpperCase())) {
        errors.push("MCQ correct answer must be A, B, C, or D");
      }
    }

    if (selectedQuestionType === "true_false") {
      if (!q.correctAnswer || !["A", "B", "TRUE", "FALSE"].includes(q.correctAnswer.toUpperCase())) {
        errors.push("True/False answer must be A, B, TRUE, or FALSE");
      }
    }

    if (!q.marks || q.marks < 0) errors.push("Marks must be positive");

    return { isValid: errors.length === 0, errors };
  };

  const parseCSV = (content: string): ParsedQuestion[] => {
    const lines = normalizeText(content).trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));

    const findIndex = (keywords: string[]) =>
      headers.findIndex((h) => keywords.some((k) => h.includes(k)));

    const indices = {
      text: findIndex(["question_text", "question", "passage_text", "case_text"]),
      type: findIndex(["question_type", "type"]),
      optA: findIndex(["option_a", "opt_a", "a)"]),
      optB: findIndex(["option_b", "opt_b", "b)"]),
      optC: findIndex(["option_c", "opt_c", "c)"]),
      optD: findIndex(["option_d", "opt_d", "d)"]),
      correct: findIndex(["correct_answer", "answer", "correct", "model_answer"]),
      explanation: findIndex(["explanation"]),
      marks: findIndex(["marks", "score"]),
      difficulty: findIndex(["difficulty"]),
      tags: findIndex(["tags"]),
      topic: findIndex(["topic", "topic_name"]),
    };

    if (indices.text === -1) {
      toast({ title: "Invalid format", description: "Missing question_text column", variant: "destructive" });
      return [];
    }

    const questions: ParsedQuestion[] = [];
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

      const topicVal = getValue(indices.topic);
      const q: Partial<ParsedQuestion> = {
        questionText: getValue(indices.text),
        questionType: selectedQuestionType || getValue(indices.type).toLowerCase() || "mcq",
        optionA: getValue(indices.optA),
        optionB: getValue(indices.optB),
        optionC: getValue(indices.optC),
        optionD: getValue(indices.optD),
        correctAnswer: getValue(indices.correct).toUpperCase(),
        explanation: getValue(indices.explanation),
        marks: parseFloat(getValue(indices.marks)) || 1,
        difficulty: getValue(indices.difficulty).toLowerCase() || "medium",
        tags: getValue(indices.tags),
        topic: topicVal || undefined,
      };

      if (!q.questionText) continue;

      const validation = validateQuestion(q);
      questions.push({
        ...q,
        isValid: validation.isValid,
        errors: validation.errors,
        status: "pending",
      } as ParsedQuestion);
    }

    return questions;
  };

  const parseExcel = (data: ArrayBuffer): ParsedQuestion[] => {
    try {
      const workbook = XLSX.read(data, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      if (jsonData.length === 0) {
        toast({ title: "Empty file", description: "No data found", variant: "destructive" });
        return [];
      }

      const questions: ParsedQuestion[] = [];
      for (const row of jsonData) {
        const keys = Object.keys(row);
        const find = (keywords: string[]) =>
          keys.find((k) => keywords.some((kw) => k.toLowerCase().includes(kw)));

      const topicKey = find(["topic", "topic_name"]);
      const topicVal = topicKey ? String(row[topicKey] || "").trim() : "";
      const q: Partial<ParsedQuestion> = {
          questionText: String(row[find(["question_text", "question", "passage_text", "case_text"]) || ""] || "").trim(),
          questionType: selectedQuestionType || String(row[find(["question_type", "type"]) || ""] || "mcq").toLowerCase(),
          optionA: String(row[find(["option_a", "opt_a"]) || ""] || "").trim(),
          optionB: String(row[find(["option_b", "opt_b"]) || ""] || "").trim(),
          optionC: String(row[find(["option_c", "opt_c"]) || ""] || "").trim(),
          optionD: String(row[find(["option_d", "opt_d"]) || ""] || "").trim(),
          correctAnswer: String(row[find(["correct_answer", "answer", "model_answer"]) || ""] || "").toUpperCase(),
          explanation: String(row[find(["explanation"]) || ""] || "").trim(),
          marks: parseFloat(String(row[find(["marks", "score"]) || ""] || 1)) || 1,
          difficulty: String(row[find(["difficulty"]) || ""] || "medium").toLowerCase(),
          tags: String(row[find(["tags"]) || ""] || "").trim(),
          topic: topicVal || undefined,
        };

        if (!q.questionText) continue;

        const validation = validateQuestion(q);
        questions.push({
          ...q,
          isValid: validation.isValid,
          errors: validation.errors,
          status: "pending",
        } as ParsedQuestion);
      }

      return questions;
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
      reader.onload = (e) => setParsedQuestions(parseCSV(e.target?.result as string));
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => setParsedQuestions(parseExcel(e.target?.result as ArrayBuffer));
      reader.readAsArrayBuffer(file);
    }
  };

  const handleUpload = async () => {
    const validQuestions = parsedQuestions.filter((q) => q.isValid && q.status === "pending");
    if (validQuestions.length === 0) {
      toast({ title: "No valid questions", description: "Fix errors before uploading", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Resolve topic names from CSV to IDs
      const topicMap = new Map<string, string>();
      const uniqueTopics = [...new Set(validQuestions.filter(q => q.topic).map(q => q.topic!.toLowerCase()))];
      if (uniqueTopics.length > 0 && selectedSubjectId) {
        const { data: matchedTopics } = await supabase
          .from("syllabus_topics")
          .select("id, topic_name")
          .eq("subject_id", selectedSubjectId)
          .eq("is_active", true);
        (matchedTopics || []).forEach(t => topicMap.set(t.topic_name.toLowerCase(), t.id));
      }

      const questionsToAdd = validQuestions.map((q) => ({
        questionText: q.questionText,
        // Upload types are a subset of the DB enum; the hook writes the enum.
        questionType: q.questionType as DbQuestionType,
        options: q.questionType === "mcq" || q.questionType === "true_false"
          ? { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD }
          : null,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || null,
        marks: q.marks,
        difficultyLevel: q.difficulty === "easy" ? 1 : q.difficulty === "hard" ? 3 : 2,
        tags: q.tags ? q.tags.split(",").map((t) => t.trim()) : [],
        subjectId: selectedSubjectId || undefined,
        gradeId: gradeLevel?.id || undefined,
        topicId: (q.topic && topicMap.get(q.topic.toLowerCase())) || selectedTopicId || undefined,
        institutionId: effectiveInstitutionId || undefined,
        source: 'bulk_upload',
      }));

      await bulkAddQuestions.mutateAsync({
        questions: questionsToAdd,
        onProgress: (imported, total) => {
          setUploadProgress(Math.round((imported / total) * 100));
        },
      });

      const updated = parsedQuestions.map((q) =>
        q.isValid && q.status === "pending" ? { ...q, status: "success" as const } : q
      );
      setParsedQuestions(updated);
      setUploadProgress(100);

      toast({
        title: "Upload complete",
        description: `Added ${validQuestions.length} questions to the bank`,
      });
    } catch (error) {
      toastError(error, { fallback: "Couldn't upload the questions.", context: "bulkUploadQuestions" });
    } finally {
      setIsUploading(false);
    }
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
    setSelectedQuestionType("");
    setParsedQuestions([]);
    setFileName(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validCount = parsedQuestions.filter((q) => q.isValid).length;
  const invalidCount = parsedQuestions.length - validCount;
  const canProceed = isGlobalMode
    ? !!selectedClassId && !!selectedSubjectId && !!selectedQuestionType
    : selectedSections.length > 0 && !!selectedSubjectId && !!selectedQuestionType;

  const selectedTypeLabel = UPLOAD_QUESTION_TYPES.find(t => t.value === selectedQuestionType)?.label || "";
  const templateInfo = selectedQuestionType ? QUESTION_TYPE_TEMPLATES[selectedQuestionType] : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Bulk Upload Questions
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Upload Questions</DialogTitle>
          <DialogDescription>
            {step === "context"
              ? "Select the class, subject, question type, and optionally a topic."
              : "Upload a CSV or Excel file with question details."}
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
              onClassChange={(id) => {
                setSelectedClassId(id);
                setSelectedSubjectId("");
                setSelectedTopicId(null);
                setSelectedTopicName("");
              }}
              onSectionsChange={setSelectedSections}
              showGlobalOption={userRole?.isSuperAdmin}
              showInstitutionSelector={userRole?.isSuperAdmin}
              selectedInstitutionId={selectedInstitutionId}
              onInstitutionChange={(id) => {
                setSelectedInstitutionId(id);
                setSelectedSubjectId("");
                setSelectedTopicId(null);
                setSelectedTopicName("");
              }}
            />

            {(isGlobalMode ? !!selectedClassId : selectedSections.length > 0) && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <Select value={selectedSubjectId} onValueChange={(v) => { setSelectedSubjectId(v); setSelectedTopicId(null); setSelectedTopicName(""); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {effectiveSubjects.map((s) => (
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

            {selectedSubjectId && (
              <div className="space-y-2">
                <Label>Question Type</Label>
                <Select value={selectedQuestionType} onValueChange={(v) => setSelectedQuestionType(v as UploadQuestionType)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select question type" />
                  </SelectTrigger>
                  <SelectContent>
                    {UPLOAD_QUESTION_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 flex-1 overflow-hidden">
            <div className="flex flex-wrap gap-2 p-2 bg-muted/50 rounded-md">
              {!isGlobalMode && <Badge variant="outline">Sections: {selectedSections.length}</Badge>}
              {isGlobalMode && <Badge variant="outline">Global</Badge>}
              <Badge variant="outline">Subject: {effectiveSubjects.find((s) => s.id === selectedSubjectId)?.name}</Badge>
              {selectedTopicName && <Badge variant="outline">Chapter: {selectedTopicName}</Badge>}
              <Badge variant="outline">Type: {selectedTypeLabel}</Badge>
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

            {templateInfo && (
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium mb-1">Expected columns for {selectedTypeLabel}:</p>
                  <code className="text-xs bg-muted p-1 rounded block overflow-x-auto">
                    {templateInfo.headers.join(", ")}
                  </code>
                </AlertDescription>
              </Alert>
            )}

            {parsedQuestions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Preview ({parsedQuestions.length} questions)</Label>
                  <div className="flex gap-2">
                    <Badge className="bg-green-600">{validCount} valid</Badge>
                    {invalidCount > 0 && <Badge variant="destructive">{invalidCount} invalid</Badge>}
                  </div>
                </div>
                <ScrollArea className="h-[200px] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[300px]">Question</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Marks</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedQuestions.map((q, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm truncate max-w-[300px]">
                            <MathText text={q.questionText} />
                          </TableCell>
                          <TableCell className="text-sm">{q.questionType}</TableCell>
                          <TableCell className="text-sm">{q.marks}</TableCell>
                          <TableCell>
                            {!q.isValid ? (
                              <Badge variant="destructive" className="text-xs" title={q.errors.join(", ")}>
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Invalid
                              </Badge>
                            ) : q.status === "success" ? (
                              <Badge className="bg-green-600 text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Added
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

        {isUploading && (
          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Uploading questions...</span>
              <span>{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {step === "upload" && (
            <Button type="button" variant="outline" onClick={() => setStep("context")} disabled={isUploading}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          {/* ml-auto keeps Cancel/Next bottom-right on both steps. With
              justify-between alone they sat bottom-left on the first step,
              where there is no Back button to take the left slot. */}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isUploading}>
              {parsedQuestions.some((q) => q.status === "success") ? "Done" : "Cancel"}
            </Button>
            {step === "context" ? (
              <Button onClick={() => setStep("upload")} disabled={!canProceed}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleUpload} disabled={validCount === 0 || isUploading}>
                {isUploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Upload {validCount} Questions
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
