import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { MathText } from "@/components/ui/math-text";
import { OptionImage } from "@/components/exam/OptionImage";
import { OptionChoiceGrid } from "@/components/exam/OptionChoiceGrid";
import { hasOptionImages } from "@/components/exam/optionDisplay";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Save,
  Eye,
  FileText,
  Bot,
  User,
  Info,
  Image,
  Zap,
  ZoomIn,
  ZoomOut,
  RotateCw,
  MessageSquare,
  Loader2,
  ArrowLeft,
  CheckCheck,
} from "lucide-react";
import { 
  useAttemptAnswers, 
  useSubmitOverride,
  useAcceptAllAIMarks,
} from "@/hooks/useEvaluations";
import { AnswerImageModal } from "./AnswerImageModal";
import { isAutoGradable } from "@/utils/autoGrading";
import { supabase } from "@/integrations/supabase/client";
import type { StudentAnswerWithEvaluation } from "@/types/exam";
import { useCreateRemark, type RemarkCategory } from "@/hooks/useStudentRemarks";
import { useUserRole } from "@/hooks/useUserRole";
import { useAutoGradeAttempt } from "@/hooks/useAutoGrading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EvaluationWorkspaceProps {
  attemptId: string;
  studentName: string;
  /** "Roll 12 · Adm AIS/2024/019"; empty string hides the line. */
  studentIdLine?: string;
  examTitle: string;
  isOffline?: boolean;
  readOnly?: boolean;
  fullPage?: boolean;
  onComplete: () => void;
}

export function EvaluationWorkspace({
  attemptId,
  studentName,
  studentIdLine = "",
  examTitle,
  isOffline = false,
  readOnly = false,
  fullPage = false,
  onComplete,
}: EvaluationWorkspaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: answers, isLoading } = useAttemptAnswers(attemptId);
  const submitOverride = useSubmitOverride();
  const autoGradeAttempt = useAutoGradeAttempt();
  const acceptAllAI = useAcceptAllAIMarks();
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [marks, setMarks] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageZoom, setImageZoom] = useState(100);
  const [remarkText, setRemarkText] = useState("");
  const [remarkCategory, setRemarkCategory] = useState<RemarkCategory>("exam");
  
  const createRemark = useCreateRemark();
  const { data: roleInfo } = useUserRole();

  // Get student ID from attempt
  const { data: attemptInfo } = useQuery({
    queryKey: ["attempt-info-for-remark", attemptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_exam_attempts")
        .select("student_id, exam_id")
        .eq("id", attemptId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!attemptId,
  });

  // Fetch OCR upload image for offline exams
  const { data: ocrUpload } = useQuery({
    queryKey: ["ocr-upload-for-evaluation", attemptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocr_uploads")
        .select("id, file_url, status, error_message")
        .eq("attempt_id", attemptId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching OCR upload:", error);
        return null;
      }
      return data;
    },
    enabled: isOffline && !!attemptId,
  });

  const currentAnswer = answers?.[currentIndex];
  const totalQuestions = answers?.length || 0;
  const evaluatedCount = answers?.filter(a => a.teacherOverride)?.length || 0;
  const progress = totalQuestions > 0 ? (evaluatedCount / totalQuestions) * 100 : 0;

  // Check if AI has already evaluated all answers
  const allAIEvaluated = useMemo(() => {
    if (!answers || answers.length === 0) return false;
    return answers.every(a => a.aiEvaluation || a.teacherOverride);
  }, [answers]);

  // Check if current question is auto-gradable
  const isCurrentAutoGradable = currentAnswer ? isAutoGradable(currentAnswer.questionType) : false;
  const isAutoGraded = currentAnswer?.teacherOverride?.isAutoGraded;

  // Check if current answer has AI evaluation but no teacher override
  const hasAIButNoOverride = currentAnswer?.aiEvaluation && !currentAnswer?.teacherOverride;

  // Initialize form when answer changes
  const initializeForm = (answer: StudentAnswerWithEvaluation | undefined) => {
    if (!answer) return;
    
    if (answer.teacherOverride) {
      setMarks(answer.teacherOverride.finalMarks);
      setFeedback(answer.teacherOverride.feedbackToStudent);
      setInternalNotes(answer.teacherOverride.internalNotes);
    } else if (answer.aiEvaluation) {
      setMarks(answer.aiEvaluation.suggestedMarks);
      setFeedback(answer.aiEvaluation.feedbackSuggestion);
      setInternalNotes("");
    } else {
      setMarks(0);
      setFeedback("");
      setInternalNotes("");
    }
  };

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(prev => prev + 1);
      initializeForm(answers?.[currentIndex + 1]);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      initializeForm(answers?.[currentIndex - 1]);
    }
  };

  const handleSave = async () => {
    if (!currentAnswer || readOnly) return;

    await submitOverride.mutateAsync({
      answerId: currentAnswer.id,
      finalMarks: marks,
      maxMarks: currentAnswer.maxMarks,
      feedbackToStudent: feedback,
      internalNotes,
      isAiAccepted: currentAnswer.aiEvaluation 
        ? marks === currentAnswer.aiEvaluation.suggestedMarks 
        : false,
      previousMarks: currentAnswer.aiEvaluation?.suggestedMarks || null,
    });
  };

  const handleEvaluateWithAI = async () => {
    try {
      await autoGradeAttempt.mutateAsync(attemptId);
      // Refetch answers to get AI evaluations
      queryClient.invalidateQueries({ queryKey: ["attempt-answers", attemptId] });
    } catch {
      // Error handled by the mutation
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!answers || answers.length === 0) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>No answers found</AlertTitle>
        <AlertDescription>
          This attempt has no submitted answers to evaluate.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={fullPage ? "space-y-4" : "space-y-4"}>
      {/* AI Evaluation Progress Overlay */}
      {autoGradeAttempt.isPending && fullPage && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="text-center space-y-4 p-8 rounded-2xl bg-card border shadow-lg max-w-sm">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h3 className="text-lg font-semibold">AI is Evaluating...</h3>
            <p className="text-sm text-muted-foreground">
              Grading all {totalQuestions} questions automatically. This may take a moment.
            </p>
            <Progress value={50} className="h-2" />
          </div>
        </div>
      )}

      {/* Full-Page Header */}
      {fullPage ? (
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b -mx-4 md:-mx-6 px-4 md:px-6 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={onComplete}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-xl font-bold">{examTitle}</h1>
                <p className="text-sm text-muted-foreground">
              Student: {studentName}
              {studentIdLine && <span className="ml-2 font-mono text-xs">{studentIdLine}</span>}
            </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Evaluate with AI */}
              {!readOnly && !allAIEvaluated && (
                <Button
                  onClick={handleEvaluateWithAI}
                  disabled={autoGradeAttempt.isPending}
                  size="lg"
                >
                  {autoGradeAttempt.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Bot className="h-4 w-4 mr-2" />
                  )}
                  {autoGradeAttempt.isPending ? "AI Evaluating..." : "Evaluate with AI"}
                </Button>
              )}
              {/* Accept All AI Marks */}
              {!readOnly && allAIEvaluated && evaluatedCount < totalQuestions && (
                <Button
                  onClick={() => acceptAllAI.mutate(attemptId)}
                  disabled={acceptAllAI.isPending}
                  variant="secondary"
                  size="lg"
                >
                  {acceptAllAI.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4 mr-2" />
                  )}
                  Accept All AI Marks
                </Button>
              )}
              <div className="text-right">
                <div className="text-sm text-muted-foreground">
                  {currentIndex + 1} / {totalQuestions}
                </div>
                <Progress value={progress} className="w-32 h-2 mt-1" />
                <div className="text-xs text-muted-foreground mt-0.5">
                  {evaluatedCount} evaluated
                </div>
              </div>
            </div>
          </div>

          {/* Question Switcher - horizontal sticky */}
          <div className="flex gap-1 flex-wrap">
            {answers.map((answer, idx) => {
              const isAutoGradedQ = answer.teacherOverride?.isAutoGraded;
              const hasAIOnly = answer.aiEvaluation && !answer.teacherOverride;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentIndex(idx);
                    initializeForm(answers[idx]);
                  }}
                  className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                    idx === currentIndex
                      ? "bg-primary text-primary-foreground"
                      : answer.teacherOverride
                        ? isAutoGradedQ
                          ? "bg-purple-100 text-purple-700 border border-purple-300"
                          : "bg-emerald-100 text-emerald-700 border border-emerald-300"
                        : hasAIOnly
                          ? "bg-blue-100 text-blue-700 border border-blue-300"
                          : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Original compact header for non-full-page */
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{examTitle}</h2>
            <p className="text-sm text-muted-foreground">
              Student: {studentName}
              {studentIdLine && <span className="ml-2 font-mono text-xs">{studentIdLine}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && !allAIEvaluated && (
              <Button
                onClick={handleEvaluateWithAI}
                disabled={autoGradeAttempt.isPending}
              >
                {autoGradeAttempt.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Bot className="h-4 w-4 mr-2" />
                )}
                {autoGradeAttempt.isPending ? "AI Evaluating..." : "Evaluate with AI"}
              </Button>
            )}
            <div className="text-right">
              <div className="text-sm text-muted-foreground">
                Question {currentIndex + 1} of {totalQuestions}
              </div>
              <Progress value={progress} className="w-40 h-2 mt-1" />
              <div className="text-xs text-muted-foreground mt-1">
                {evaluatedCount} evaluated
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Banner after evaluation */}
      {allAIEvaluated && evaluatedCount < totalQuestions && !readOnly && (
        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
          <Bot className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-700 dark:text-blue-400">AI has evaluated all questions</AlertTitle>
          <AlertDescription className="text-blue-600 dark:text-blue-300">
            Review and save each, or click "Accept All AI Marks" to finalize all at once.
          </AlertDescription>
        </Alert>
      )}

      {/* Read-only banner */}
      {readOnly && (
        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
          <Eye className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-700 dark:text-blue-400">Read-Only View</AlertTitle>
          <AlertDescription className="text-blue-600 dark:text-blue-300">
            This evaluation has been finalized. You are viewing the evaluated marks.
          </AlertDescription>
        </Alert>
      )}

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
                <Badge variant="outline" className="capitalize">
                  {currentAnswer?.questionType.replace("_", " ")}
                </Badge>
                <Badge variant="secondary" className="font-mono">
                  {currentAnswer?.maxMarks} marks
                </Badge>
                {isCurrentAutoGradable && (
                  <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                    <Zap className="h-3 w-3 mr-1" />
                    Auto-gradable
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Question */}
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">Question:</p>
              <MathText className="text-sm" text={currentAnswer?.questionText ?? ""} />
              {currentAnswer?.questionImageUrl && (
                <img
                  src={currentAnswer.questionImageUrl}
                  alt="Question diagram"
                  className="mt-3 max-h-56 rounded-md border object-contain"
                />
              )}
            </div>

            {/* Student Answer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Student's Answer
                </p>
                <div className="flex items-center gap-2">
                  {currentAnswer?.answerSource === "offline_ocr" && (
                    <>
                      <Badge variant="outline" className="text-xs">
                        OCR ({Math.round((currentAnswer.ocrConfidence || 0) * 100)}%)
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setImageModalOpen(true)}
                      >
                        <Image className="h-3 w-3 mr-1" />
                        View Image
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="p-3 border rounded-lg min-h-[100px]">
                {currentAnswer?.answerText ? (
                  <p className="text-sm whitespace-pre-wrap">{currentAnswer.answerText}</p>
                ) : currentAnswer?.answerOptions ? (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Selected: </span>
                    <span className="font-medium">
                      {typeof currentAnswer.answerOptions === 'object' && 'selected' in currentAnswer.answerOptions
                        ? String(currentAnswer.answerOptions.selected)
                        : JSON.stringify(currentAnswer.answerOptions)}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No answer provided</p>
                )}
              </div>

              {/* MCQ Options Display with Correct Answer */}
              {currentAnswer?.options && currentAnswer.options.length > 0 && (
                <div className="space-y-2 mt-3">
                  <p className="text-sm font-medium text-muted-foreground">Answer Key:</p>
                  {/* Image-choice question: the marker needs to see the same
                      pictures the student compared, not four thumbnails. */}
                  {hasOptionImages(currentAnswer.options) ? (
                    <OptionChoiceGrid
                      options={currentAnswer.options}
                      annotate={(opt) => {
                        const o = opt as { id?: string | null };
                        const isCorrect = o.id === currentAnswer.correctAnswer;
                        const studentSelection =
                          currentAnswer.answerOptions &&
                          typeof currentAnswer.answerOptions === "object" &&
                          "selected" in currentAnswer.answerOptions
                            ? String(currentAnswer.answerOptions.selected)
                            : null;
                        const isSelected = o.id === studentSelection;
                        if (isCorrect) {
                          return {
                            tone: "correct",
                            note: isSelected ? "Student's answer · Correct" : "Correct",
                          };
                        }
                        return isSelected ? { tone: "wrong", note: "Student's answer" } : {};
                      }}
                    />
                  ) : (
                  <div className="space-y-2">
                    {currentAnswer.options.map((opt, idx) => {
                      const isCorrect = opt.id === currentAnswer.correctAnswer;
                      const studentSelection = currentAnswer.answerOptions && typeof currentAnswer.answerOptions === 'object' && 'selected' in currentAnswer.answerOptions
                        ? String(currentAnswer.answerOptions.selected)
                        : null;
                      const isSelected = opt.id === studentSelection;
                      
                      return (
                        <div
                          key={opt.id}
                          className={`p-2 rounded-lg border text-sm flex items-center gap-2 ${
                            isCorrect ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : ""
                          } ${
                            isSelected && !isCorrect ? "bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-800" : ""
                          } ${
                            isSelected && isCorrect ? "ring-2 ring-green-500" : ""
                          }`}
                        >
                          <span className="font-mono font-medium w-6">
                            {String.fromCharCode(65 + idx)}.
                          </span>
                          {opt.imageUrl && (
                            <OptionImage
                              url={opt.imageUrl}
                              label={`Option ${String.fromCharCode(65 + idx)}`}
                            />
                          )}
                          <MathText as="span" className="flex-1" text={opt.text} />
                          {isCorrect && (
                            <Badge variant="outline" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Correct
                            </Badge>
                          )}
                          {isSelected && (
                            <Badge variant="outline" className="text-xs">
                              Student's Answer
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              )}

              {currentAnswer?.ocrNeedsReview && (
                <Alert variant="default" className="border-amber-200 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800">
                    OCR extraction needs verification. Original text may differ.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Scanned Answer Sheet Preview for Offline Exams */}
            {isOffline && ocrUpload?.file_url && (
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
                      title="Zoom out"
                    >
                      <ZoomOut className="h-3 w-3" />
                    </Button>
                    <span className="text-xs w-10 text-center">{imageZoom}%</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setImageZoom(Math.min(200, imageZoom + 25))}
                      title="Zoom in"
                    >
                      <ZoomIn className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setImageModalOpen(true)}
                      title="Full screen"
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg overflow-auto bg-muted/30 max-h-[300px]">
                  <img
                    src={ocrUpload.file_url}
                    alt="Scanned answer sheet"
                    style={{
                      transform: `scale(${imageZoom / 100})`,
                      transformOrigin: "top left",
                      transition: "transform 0.2s ease",
                    }}
                    className="max-w-none"
                  />
                </div>
                {ocrUpload.status === "processing" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <RotateCw className="h-3 w-3 animate-spin" />
                    OCR processing in progress...
                  </div>
                )}
                {ocrUpload.status === "failed" && (
                  <Alert variant="destructive" className="py-2">
                    <AlertTriangle className="h-3 w-3" />
                    <AlertDescription className="text-xs">
                      OCR failed: {ocrUpload.error_message || "Unknown error"}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Blueprint Reference */}
            {currentAnswer?.blueprint && (
              <div className="p-3 border rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Evaluation Blueprint
                </p>
                <p className="text-xs text-muted-foreground">
                  {currentAnswer.blueprint.markingScheme}
                </p>
                {currentAnswer.blueprint.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {currentAnswer.blueprint.keywords.map((kw, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                )}
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
            {/* Auto-graded notice */}
            {isAutoGraded && (
              <Alert className="border-purple-200 bg-purple-50">
                <Zap className="h-4 w-4 text-purple-600" />
                <AlertTitle className="text-purple-700">Auto-graded</AlertTitle>
                <AlertDescription className="text-purple-600">
                  This objective question was automatically graded. You can override if needed.
                </AlertDescription>
              </Alert>
            )}

            {/* AI Evaluated Banner - when AI has marks but no teacher override */}
            {hasAIButNoOverride && !isAutoGraded && (
              <Alert className="border-purple-200 bg-purple-50">
                <Bot className="h-4 w-4 text-purple-600" />
                <AlertTitle className="text-purple-700">AI Evaluated</AlertTitle>
                <AlertDescription className="text-purple-600">
                  AI has evaluated this answer. Review and save to confirm, or adjust marks.
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      {Math.round((currentAnswer?.aiEvaluation?.confidenceScore || 0) * 100)}% confidence
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {currentAnswer?.aiEvaluation?.suggestedMarks}/{currentAnswer?.aiEvaluation?.maxMarks}
                    </Badge>
                  </div>
                  {currentAnswer?.aiEvaluation?.evaluationReasoning && (
                    <p className="text-xs mt-2">{currentAnswer.aiEvaluation.evaluationReasoning}</p>
                  )}
                  {currentAnswer?.aiEvaluation?.matchedKeywords && currentAnswer.aiEvaluation.matchedKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="text-xs">Matched:</span>
                      {currentAnswer.aiEvaluation.matchedKeywords.map((kw, i) => (
                        <Badge key={i} variant="outline" className="text-xs text-green-600 border-green-300">
                          {kw}
                        </Badge>
                      ))}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Previous Override */}
            {currentAnswer?.teacherOverride && !isAutoGraded && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-700">Already Evaluated</AlertTitle>
                <AlertDescription>
                  Marks: {currentAnswer.teacherOverride.finalMarks}/{currentAnswer.teacherOverride.maxMarks}
                  {currentAnswer.teacherOverride.teacherName && (
                    <span className="ml-2">by {currentAnswer.teacherOverride.teacherName}</span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Marks Input */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Award Marks</Label>
                <span className="text-sm font-mono">
                  {marks} / {currentAnswer?.maxMarks || 0}
                </span>
              </div>
              <Slider
                value={[marks]}
                onValueChange={([value]) => setMarks(value)}
                max={currentAnswer?.maxMarks || 0}
                step={0.5}
                disabled={readOnly}
              />
              <Input
                type="number"
                value={marks}
                onChange={(e) => setMarks(Math.min(parseFloat(e.target.value) || 0, currentAnswer?.maxMarks || 0))}
                min={0}
                max={currentAnswer?.maxMarks || 0}
                step={0.5}
                disabled={readOnly}
              />
            </div>

            {/* Feedback */}
            <div className="space-y-2">
              <Label>Feedback to Student</Label>
              <Textarea
                placeholder="Write feedback that will be shown to the student..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                disabled={readOnly}
              />
            </div>

            {/* Internal Notes */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Internal Notes
                <Badge variant="outline" className="text-xs">Not visible to student</Badge>
              </Label>
              <Textarea
                placeholder="Private notes for other evaluators..."
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={2}
                disabled={readOnly}
              />
            </div>

            {/* Save Button */}
            {!readOnly && (
              <Button 
                className="w-full" 
                onClick={handleSave}
                disabled={submitOverride.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {submitOverride.isPending ? "Saving..." : "Save Evaluation"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handlePrev}
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>

        {/* Question circles only in non-fullPage mode */}
        {!fullPage && (
          <div className="flex gap-1 flex-wrap justify-center max-w-md">
            {answers.map((answer, idx) => {
              const isAutoGradedQ = answer.teacherOverride?.isAutoGraded;
              const hasAIOnly = answer.aiEvaluation && !answer.teacherOverride;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentIndex(idx);
                    initializeForm(answers[idx]);
                  }}
                  className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                    idx === currentIndex
                      ? "bg-primary text-primary-foreground"
                      : answer.teacherOverride
                        ? isAutoGradedQ
                          ? "bg-purple-100 text-purple-700 border border-purple-300"
                          : "bg-emerald-100 text-emerald-700 border border-emerald-300"
                        : hasAIOnly
                          ? "bg-blue-100 text-blue-700 border border-blue-300"
                          : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        )}

        <Button
          variant="outline"
          onClick={handleNext}
          disabled={currentIndex === totalQuestions - 1}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Proctoring Review Panel */}
      <ProctoringReviewPanel attemptId={attemptId} readOnly={readOnly} />

      {/* Add Remark Section */}
      {!readOnly && attemptInfo && roleInfo?.institutionId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Add Student Remark
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={remarkCategory} onValueChange={(v) => setRemarkCategory(v as RemarkCategory)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exam">Exam</SelectItem>
                    <SelectItem value="topic">Chapter</SelectItem>
                    <SelectItem value="behaviour">Behaviour</SelectItem>
                    <SelectItem value="improvement">Improvement</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea
              placeholder="Write a remark about this student's performance..."
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              rows={2}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!remarkText.trim() || createRemark.isPending}
              onClick={async () => {
                await createRemark.mutateAsync({
                  studentId: attemptInfo.student_id,
                  institutionId: roleInfo.institutionId!,
                  examId: attemptInfo.exam_id,
                  category: remarkCategory,
                  remarkText: remarkText.trim(),
                });
                setRemarkText("");
              }}
            >
              {createRemark.isPending ? "Saving..." : "Save Remark"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Finalize Button */}
      {!readOnly && evaluatedCount === totalQuestions && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-700">Ready to Finalize</AlertTitle>
          <AlertDescription className="text-green-600">
            All questions have been evaluated. You can now finalize this attempt.
            <Button 
              className="mt-2 w-full" 
              onClick={onComplete}
            >
              Finalize & Publish Result
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Image Modal for Offline Answers */}
      {isOffline && ocrUpload?.file_url && (
        <AnswerImageModal
          open={imageModalOpen}
          onOpenChange={setImageModalOpen}
          imageUrl={ocrUpload.file_url}
          fileName={`answer-sheet-${attemptId}.jpg`}
          ocrConfidence={currentAnswer?.ocrConfidence || undefined}
        />
      )}
    </div>
  );
}

// Proctoring Review Panel - inline in evaluation workspace
function ProctoringReviewPanel({ attemptId, readOnly }: { attemptId: string; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: session } = useQuery({
    queryKey: ["proctoring-session-eval", attemptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proctoring_sessions")
        .select("*")
        .eq("attempt_id", attemptId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: events } = useQuery({
    queryKey: ["proctoring-events-eval", session?.id],
    queryFn: async () => {
      if (!session?.id) return [];
      const { data, error } = await supabase
        .from("proctoring_events")
        .select("*")
        .eq("session_id", session.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!session?.id,
  });

  const updateReview = useMutation({
    mutationFn: async (status: string) => {
      if (!session?.id) return;
      const { error } = await supabase
        .from("proctoring_sessions")
        .update({
          review_status: status,
          reviewed_by: (await supabase.auth.getUser()).data.user?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proctoring-session-eval", attemptId] });
    },
  });

  if (!session) return null;

  const severityColor = (severity: string): "destructive" | "secondary" | "outline" => {
    switch (severity) {
      case "high": return "destructive";
      case "medium": return "secondary";
      default: return "outline";
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Proctoring Review
          </CardTitle>
          <div className="flex items-center gap-2">
            {session.high_severity_events > 0 && (
              <Badge variant="destructive">{session.high_severity_events} High</Badge>
            )}
            {session.medium_severity_events > 0 && (
              <Badge variant="secondary">{session.medium_severity_events} Med</Badge>
            )}
            <Badge variant="outline">{session.total_events} Total</Badge>
            {session.review_status && (
              <Badge variant={session.review_status === "cleared" ? "outline" : session.review_status === "flagged" ? "destructive" : "secondary"}>
                {session.review_status}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {events && events.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              <Label className="text-xs text-muted-foreground">Event Timeline</Label>
              {events.map((event) => (
                <div key={event.id} className="flex items-center gap-2 text-xs border-l-2 pl-3 py-1"
                  style={{ borderColor: event.severity === "high" ? "hsl(var(--destructive))" : event.severity === "medium" ? "hsl(var(--muted-foreground))" : "hsl(var(--muted))" }}
                >
                  <Badge variant={severityColor(event.severity)} className="text-[10px] px-1 py-0">
                    {event.severity}
                  </Badge>
                  <span className="font-medium">{event.event_type?.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground ml-auto">
                    {new Date(event.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No proctoring events recorded.</p>
          )}

          {!readOnly && (
            <div className="space-y-3 border-t pt-3">
              <Label className="text-xs">Set Proctoring Status</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={session.review_status === "cleared" ? "default" : "outline"}
                  onClick={() => updateReview.mutate("cleared")}
                  disabled={updateReview.isPending}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant={session.review_status === "warning" ? "default" : "outline"}
                  onClick={() => updateReview.mutate("warning")}
                  disabled={updateReview.isPending}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Warning
                </Button>
                <Button
                  size="sm"
                  variant={session.review_status === "flagged" ? "destructive" : "outline"}
                  onClick={() => updateReview.mutate("flagged")}
                  disabled={updateReview.isPending}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Flag
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
