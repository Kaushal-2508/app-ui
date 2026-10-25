import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { format, differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays } from "date-fns";
import {
  Calendar,
  Clock,
  BookOpen,
  PlayCircle,
  FileText,
  ExternalLink,
  Timer,
  Target,
  Camera,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStartHybridAttempt } from "@/hooks/useHybridAttempt";

interface ExamData {
  exam_id: string;
  title: string;
  description?: string;
  scheduled_date?: string;
  start_time?: string;
  end_time?: string;
  /** Last moment a student may JOIN (start + late entry). Null on legacy rows. */
  entry_deadline?: string | null;
  duration_minutes?: number;
  total_marks?: number;
  pass_marks?: number;
  class_id: string;
  class_name?: string;
  exam_mode: string;
  attempt_status: string;
  instructions?: string;
  study_materials?: Array<{ id: string; title: string; url: string; type: string }>;
}

interface UpcomingExamSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: ExamData | null;
}

export function UpcomingExamSheet({ open, onOpenChange, exam }: UpcomingExamSheetProps) {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState<string>("");
  const [canStart, setCanStart] = useState(false);

  const isExpired = exam?.attempt_status === "expired";

  useEffect(() => {
    if (isExpired) {
      setCountdown("Exam Ended");
      setCanStart(false);
      return;
    }

    if (!exam?.start_time) {
      setCountdown("");
      setCanStart(exam?.attempt_status === "available");
      return;
    }

    const startTime = new Date(exam.start_time);
    // Joining is gated by the ENTRY deadline (start + late entry), not by the
    // exam's end. Gating on end_time meant a student who joined late lost the
    // tail of their duration, and a long late-entry window did nothing.
    // Legacy rows have no entry_deadline — fall back to end_time as before.
    const entryDeadline = exam.entry_deadline
      ? new Date(exam.entry_deadline)
      : exam.end_time
        ? new Date(exam.end_time)
        : null;

    const updateCountdown = () => {
      const now = new Date();
      const diffSeconds = differenceInSeconds(startTime, now);

      if (diffSeconds <= 0) {
        // Exam has started
        if (entryDeadline && now > entryDeadline) {
          setCountdown("Entry Closed");
          setCanStart(false);
        } else {
          setCountdown("Exam is Live!");
          setCanStart(true);
        }
        return;
      }

      // Calculate remaining time
      const days = differenceInDays(startTime, now);
      const hours = differenceInHours(startTime, now) % 24;
      const minutes = differenceInMinutes(startTime, now) % 60;
      const seconds = diffSeconds % 60;

      if (days > 0) {
        setCountdown(`${days}d ${hours}h ${minutes}m`);
      } else if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m ${seconds}s`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
      setCanStart(false);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [exam?.start_time, exam?.end_time, exam?.entry_deadline, exam?.attempt_status, isExpired]);

  const startHybrid = useStartHybridAttempt();

  if (!exam) return null;

  const isHybrid = exam.exam_mode === "hybrid";

  const handleStartExam = async () => {
    if (isHybrid) {
      try {
        const { attemptId } = await startHybrid.mutateAsync({
          examId: exam.exam_id,
          classId: exam.class_id,
        });
        onOpenChange(false);
        navigate(`/student/hybrid-exam/${attemptId}`);
      } catch {
        /* toastError already shown by the hook */
      }
      return;
    }
    onOpenChange(false);
    navigate(`/student/exams/${exam.exam_id}/attempt?classId=${exam.class_id}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{exam.title}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Countdown Timer */}
          <Card className={isExpired ? "border-destructive/30 bg-destructive/5" : canStart ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-primary/20 bg-primary/5"}>
            <CardContent className="p-6 text-center">
              <Timer className={`h-8 w-8 mx-auto mb-2 ${isExpired ? "text-destructive" : canStart ? "text-green-600" : "text-primary"}`} />
              <div className={`text-3xl font-bold ${isExpired ? "text-destructive" : canStart ? "text-green-600" : ""}`}>
                {countdown || "No scheduled time"}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {isExpired ? "This exam window has closed" : canStart ? "Exam window is open!" : "Time until exam starts"}
              </p>
            </CardContent>
          </Card>

          {/* Exam Details */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{exam.class_name}</Badge>
              <Badge variant="secondary" className="capitalize">{exam.exam_mode}</Badge>
            </div>

            {exam.description && (
              <p className="text-sm text-muted-foreground">{exam.description}</p>
            )}

            <div className="grid gap-3">
              {exam.scheduled_date && (
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{format(new Date(exam.scheduled_date), "EEEE, MMMM d, yyyy")}</span>
                </div>
              )}
              {exam.start_time && (
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    Starts: {format(new Date(exam.start_time), "h:mm a")}
                    {exam.end_time && ` · Ends: ${format(new Date(exam.end_time), "h:mm a")}`}
                  </span>
                </div>
              )}
              {exam.duration_minutes && (
                <div className="flex items-center gap-3 text-sm">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  <span>Duration: {exam.duration_minutes} minutes</span>
                </div>
              )}
              {exam.total_marks && (
                <div className="flex items-center gap-3 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span>Total Marks: {exam.total_marks}</span>
                </div>
              )}
              {exam.pass_marks && (
                <div className="flex items-center gap-3 text-sm">
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <span>Pass Marks: {exam.pass_marks}</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Instructions */}
          {exam.instructions && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Instructions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {exam.instructions}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Study Materials */}
          {exam.study_materials && exam.study_materials.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Study Materials
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {exam.study_materials.map((material) => (
                  <a
                    key={material.id}
                    href={material.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <BookOpen className="h-4 w-4 text-primary" />
                      <div>
                        <p className="font-medium text-sm">{material.title}</p>
                        <p className="text-xs text-muted-foreground">{material.type}</p>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Start Button */}
          {!isExpired && (
            <Button
              className="w-full"
              size="lg"
              disabled={!canStart || startHybrid.isPending}
              onClick={handleStartExam}
            >
              {!canStart ? (
                <>
                  <Clock className="h-5 w-5 mr-2" />
                  Wait for Exam to Start
                </>
              ) : isHybrid ? (
                <>
                  <Camera className="h-5 w-5 mr-2" />
                  {startHybrid.isPending ? "Opening…" : "Start hybrid exam"}
                </>
              ) : (
                <>
                  <PlayCircle className="h-5 w-5 mr-2" />
                  Start Exam Now
                </>
              )}
            </Button>
          )}

          {isExpired && (
            <p className="text-center text-sm text-destructive font-medium">
              You missed this exam. The exam window has closed.
            </p>
          )}

          {!isExpired && !canStart && exam.start_time && (
            <p className="text-center text-sm text-muted-foreground">
              The exam button will be enabled when the exam window opens
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
