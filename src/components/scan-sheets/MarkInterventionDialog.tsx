import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateStudentMarks } from "@/hooks/useScanSheetsData";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Save,
  FileText,
  Bot,
  User,
  Sparkles,
  Eye,
  Image,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface StudentWithScore {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  admission_number: string | null;
  attempt_id: string | null;
  ai_score: number | null;
  max_marks: number | null;
  avg_confidence: number | null;
}

interface MarkInterventionDialogProps {
  student: StudentWithScore | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AnswerWithEval {
  id: string;
  question_id: string;
  answer_text: string | null;
  question_text: string;
  question_type: string;
  question_marks: number;
  correct_answer: string | null;
  ai_marks: number | null;
  confidence: number | null;
  ai_reasoning: string | null;
  ai_feedback: string | null;
  matched_keywords: string[] | null;
  teacher_marks: number | null;
  teacher_feedback: string | null;
  internal_notes: string | null;
}

export function MarkInterventionDialog({
  student,
  open,
  onOpenChange,
}: MarkInterventionDialogProps) {
  const updateMarks = useUpdateStudentMarks();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [marks, setMarks] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [imageZoom, setImageZoom] = useState(100);

  // Fetch answers with evaluations
  const { data: answers, isLoading, refetch } = useQuery({
    queryKey: ["student-answers-for-intervention", student?.attempt_id],
    queryFn: async () => {
      if (!student?.attempt_id) return [];

      const { data, error } = await supabase
        .from("student_answers")
        .select(`
          id,
          question_id,
          answer_text,
          exam_questions!student_answers_question_id_fkey(
            question_text, 
            marks, 
            question_type,
            correct_answer
          ),
          ai_evaluations(
            suggested_marks, 
            confidence_score, 
            evaluation_reasoning,
            feedback_suggestion,
            matched_keywords
          ),
          teacher_overrides(
            final_marks, 
            teacher_feedback,
            internal_notes
          )
        `)
        .eq("attempt_id", student.attempt_id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return (data || []).map((ans): AnswerWithEval => {
        const question = ans.exam_questions as { 
          question_text: string; 
          marks: number;
          question_type: string;
          correct_answer: string | null;
        } | null;
        const aiEval = ans.ai_evaluations as { 
          suggested_marks: number; 
          confidence_score: number;
          evaluation_reasoning: string;
          feedback_suggestion: string;
          matched_keywords: string[];
        } | null;
        const teacherOverride = ans.teacher_overrides as { 
          final_marks: number; 
          teacher_feedback: string;
          internal_notes: string;
        } | null;

        return {
          id: ans.id,
          question_id: ans.question_id,
          answer_text: ans.answer_text,
          question_text: question?.question_text || "",
          question_type: question?.question_type || "short_answer",
          question_marks: question?.marks || 0,
          correct_answer: question?.correct_answer || null,
          ai_marks: aiEval?.suggested_marks ?? null,
          confidence: aiEval?.confidence_score ?? null,
          ai_reasoning: aiEval?.evaluation_reasoning ?? null,
          ai_feedback: aiEval?.feedback_suggestion ?? null,
          matched_keywords: aiEval?.matched_keywords ?? null,
          teacher_marks: teacherOverride?.final_marks ?? null,
          teacher_feedback: teacherOverride?.teacher_feedback ?? null,
          internal_notes: teacherOverride?.internal_notes ?? null,
        };
      });
    },
    enabled: open && !!student?.attempt_id,
  });

  // Fetch OCR upload image
  const { data: ocrUpload } = useQuery({
    queryKey: ["ocr-upload-for-intervention", student?.attempt_id],
    queryFn: async () => {
      if (!student?.attempt_id) return null;
      
      const { data, error } = await supabase
        .from("ocr_uploads")
        .select("id, file_url, status")
        .eq("attempt_id", student.attempt_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return null;
      return data;
    },
    enabled: open && !!student?.attempt_id,
  });

  const currentAnswer = answers?.[currentIndex];
  const totalQuestions = answers?.length || 0;
  const evaluatedCount = answers?.filter(a => a.teacher_marks !== null)?.length || 0;
  const progress = totalQuestions > 0 ? (evaluatedCount / totalQuestions) * 100 : 0;

  // Initialize form when answer changes or dialog opens
  useEffect(() => {
    if (currentAnswer) {
      setMarks(currentAnswer.teacher_marks ?? currentAnswer.ai_marks ?? 0);
      setFeedback(currentAnswer.teacher_feedback ?? currentAnswer.ai_feedback ?? "");
      setInternalNotes(currentAnswer.internal_notes ?? "");
    }
  }, [currentAnswer]);

  // Reset to first question when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setImageZoom(100);
    }
  }, [open]);

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleSave = async () => {
    if (!currentAnswer) return;

    await updateMarks.mutateAsync({
      answerId: currentAnswer.id,
      marks: marks,
      feedback: feedback,
    });

    refetch();
  };

  const handleAcceptAi = async () => {
    if (!currentAnswer || currentAnswer.ai_marks === null) return;

    await updateMarks.mutateAsync({
      answerId: currentAnswer.id,
      marks: currentAnswer.ai_marks,
      feedback: currentAnswer.ai_feedback || "",
    });

    refetch();

    // Move to next if available
    if (currentIndex < totalQuestions - 1) {
      handleNext();
    }
  };

  const handleSaveAndNext = async () => {
    await handleSave();
    if (currentIndex < totalQuestions - 1) {
      handleNext();
    }
  };

  const confidencePercentage = currentAnswer?.confidence 
    ? Math.round(currentAnswer.confidence * 100) 
    : null;
  const isLowConfidence = confidencePercentage !== null && confidencePercentage < 70;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0 gap-0">
        {/* Header */}
        <DialogHeader className="p-4 pb-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-lg">
                Evaluate: {student?.full_name}
              </DialogTitle>
              {student?.roll_number && (
                <Badge variant="outline">Roll: {student.roll_number}</Badge>
              )}
              {student?.admission_number && (
                <Badge variant="outline">Adm: {student.admission_number}</Badge>
              )}
              {student && student.ai_score !== null && student.max_marks !== null && (
                <Badge variant="secondary">
                  Total: {student.ai_score}/{student.max_marks}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4">
              {!isLoading && totalQuestions > 0 && (
                <div className="text-sm text-muted-foreground">
                  Question {currentIndex + 1} of {totalQuestions}
                </div>
              )}
              <div className="w-32">
                <Progress value={progress} className="h-2" />
                <div className="text-xs text-muted-foreground mt-1 text-right">
                  {evaluatedCount} evaluated
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-full" />
            <div className="grid lg:grid-cols-2 gap-4">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        ) : answers && answers.length > 0 ? (
          <div className="flex-1 overflow-auto p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Left Panel: Question & Answer */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Question {currentIndex + 1}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize text-xs">
                        {currentAnswer?.question_type?.replace("_", " ") || "Question"}
                      </Badge>
                      <Badge variant="secondary" className="font-mono">
                        {currentAnswer?.question_marks} marks
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Question */}
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-2">Question:</p>
                    <p className="text-sm whitespace-pre-wrap">{currentAnswer?.question_text}</p>
                  </div>

                  {/* Correct Answer if available */}
                  {currentAnswer?.correct_answer && (
                    <div className="p-3 border rounded-lg bg-green-50 border-green-200">
                      <p className="text-sm font-medium flex items-center gap-2 text-green-700 mb-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Expected Answer
                      </p>
                      <p className="text-sm text-green-800">{currentAnswer.correct_answer}</p>
                    </div>
                  )}

                  {/* Student Answer */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <User className="h-4 w-4" />
                        Student's Answer
                      </p>
                      {confidencePercentage !== null && (
                        <Badge 
                          variant="outline" 
                          className={isLowConfidence ? "border-amber-300 text-amber-700 bg-amber-50" : "border-green-300 text-green-700 bg-green-50"}
                        >
                          {isLowConfidence && <AlertTriangle className="h-3 w-3 mr-1" />}
                          OCR {confidencePercentage}%
                        </Badge>
                      )}
                    </div>
                    <div className="p-3 border rounded-lg min-h-[80px] bg-background">
                      {currentAnswer?.answer_text ? (
                        <p className="text-sm whitespace-pre-wrap">{currentAnswer.answer_text}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No answer provided</p>
                      )}
                    </div>
                  </div>

                  {/* Scanned Image Preview */}
                  {ocrUpload?.file_url && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <Image className="h-4 w-4" />
                          Scanned Answer Sheet
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setImageZoom(Math.max(50, imageZoom - 25))}
                          >
                            <ZoomOut className="h-3 w-3" />
                          </Button>
                          <span className="text-xs w-10 text-center">{imageZoom}%</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setImageZoom(Math.min(200, imageZoom + 25))}
                          >
                            <ZoomIn className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="border rounded-lg overflow-auto bg-muted/30 max-h-[200px]">
                        <img
                          src={ocrUpload.file_url}
                          alt="Scanned answer sheet"
                          style={{
                            transform: `scale(${imageZoom / 100})`,
                            transformOrigin: "top left",
                          }}
                          className="max-w-none"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Right Panel: Evaluation */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Evaluation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* AI Suggestion */}
                  {currentAnswer?.ai_marks !== null && (
                    <div className={`p-3 rounded-lg border ${
                      isLowConfidence 
                        ? "border-amber-200 bg-amber-50" 
                        : "border-blue-200 bg-blue-50"
                    }`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-blue-600" />
                          <span className="font-medium text-sm">AI Suggestion</span>
                          {confidencePercentage !== null && (
                            <Badge variant="outline" className="text-xs">
                              {confidencePercentage}% confidence
                            </Badge>
                          )}
                        </div>
                        <Badge variant="secondary" className="font-mono">
                          {currentAnswer.ai_marks}/{currentAnswer.question_marks}
                        </Badge>
                      </div>
                      
                      {currentAnswer.ai_reasoning && (
                        <p className="text-sm mt-2 text-muted-foreground">
                          {currentAnswer.ai_reasoning}
                        </p>
                      )}

                      {currentAnswer.matched_keywords && currentAnswer.matched_keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className="text-xs text-muted-foreground">Matched:</span>
                          {currentAnswer.matched_keywords.map((kw, i) => (
                            <Badge key={i} variant="outline" className="text-xs text-green-600 border-green-300">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {currentAnswer.teacher_marks === null && (
                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            onClick={handleAcceptAi}
                            disabled={updateMarks.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Accept AI
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setMarks(currentAnswer.ai_marks ?? 0);
                              setFeedback(currentAnswer.ai_feedback ?? "");
                            }}
                          >
                            <Bot className="h-4 w-4 mr-1" />
                            Use as Base
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Already Evaluated Notice */}
                  {currentAnswer?.teacher_marks !== null && (
                    <Alert className="border-green-200 bg-green-50">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <AlertTitle className="text-green-700">Already Evaluated</AlertTitle>
                      <AlertDescription className="text-green-600">
                        Marks: {currentAnswer.teacher_marks}/{currentAnswer.question_marks}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Marks Input */}
                  <div className="space-y-3">
                    <Label className="font-medium">
                      Your Marks (out of {currentAnswer?.question_marks || 0})
                    </Label>
                    <div className="flex items-center gap-4">
                      <Slider
                        value={[marks]}
                        onValueChange={([v]) => setMarks(v)}
                        max={currentAnswer?.question_marks || 0}
                        step={0.5}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={marks}
                        onChange={(e) =>
                          setMarks(
                            Math.min(
                              currentAnswer?.question_marks || 0,
                              Math.max(0, parseFloat(e.target.value) || 0)
                            )
                          )
                        }
                        className="w-20"
                        min={0}
                        max={currentAnswer?.question_marks || 0}
                        step={0.5}
                      />
                    </div>
                  </div>

                  {/* Feedback */}
                  <div className="space-y-2">
                    <Label className="font-medium">Feedback to Student</Label>
                    <Textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="Enter feedback for the student..."
                      rows={3}
                    />
                  </div>

                  {/* Internal Notes */}
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Internal Notes (optional)</Label>
                    <Textarea
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                      placeholder="Notes for yourself or other evaluators..."
                      rows={2}
                      className="text-sm"
                    />
                  </div>

                  {/* Save Button */}
                  <div className="flex gap-2 pt-2">
                    <Button 
                      onClick={handleSave} 
                      disabled={updateMarks.isPending}
                      variant="outline"
                      className="flex-1"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                    <Button 
                      onClick={handleSaveAndNext} 
                      disabled={updateMarks.isPending || currentIndex >= totalQuestions - 1}
                      className="flex-1"
                    >
                      Save & Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            No answers found for this student
          </div>
        )}

        {/* Footer Navigation */}
        {answers && answers.length > 0 && (
          <div className="border-t p-4 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={handlePrev}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            
            {/* Question Pills */}
            <div className="flex gap-1 flex-wrap justify-center max-w-md">
              {answers.map((ans, idx) => (
                <Button
                  key={ans.id}
                  variant={idx === currentIndex ? "default" : ans.teacher_marks !== null ? "secondary" : "outline"}
                  size="sm"
                  className="w-8 h-8 p-0"
                  onClick={() => setCurrentIndex(idx)}
                >
                  {idx + 1}
                </Button>
              ))}
            </div>

            <Button
              variant="outline"
              onClick={handleNext}
              disabled={currentIndex >= totalQuestions - 1}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
