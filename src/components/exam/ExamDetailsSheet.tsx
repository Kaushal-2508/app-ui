import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { FileText, Calendar, Clock, Users, BookOpen, Target, Edit3, Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";
import { DownloadQuestionPaperButton } from "./DownloadQuestionPaperButton";
interface ExamDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string | null;
}

/**
 * Generated Supabase types lag the `late_entry_minutes` column, so read it via a
 * narrow structural cast rather than `any` (CLAUDE.md §5a). 0 = no dedicated
 * join window.
 */
function lateEntryMinutesOf(exam: unknown): number {
  const v = (exam as { late_entry_minutes?: number | null } | null)?.late_entry_minutes;
  return typeof v === "number" ? v : 0;
}

/** Shapes of the separately-fetched relations attached to the exam payload. */
interface ExamSectionRow {
  id: string;
  title: string;
  section_order: number;
  exam_questions?: { id: string }[] | null;
}

interface ExamClassRow {
  classes?: { name?: string | null; section?: string | null } | null;
}

export function ExamDetailsSheet({ open, onOpenChange, examId }: ExamDetailsSheetProps) {
  const navigate = useNavigate();

  const { data: exam, isLoading, error } = useQuery({
    queryKey: ["exam-details", examId],
    queryFn: async () => {
      if (!examId) return null;
      
      // First fetch the exam itself
      const { data: examData, error: examError } = await supabase
        .from("exams")
        .select("*")
        .eq("id", examId)
        .single();
      
      if (examError) {
        console.error("Exam fetch error:", examError);
        throw examError;
      }

      // Fetch related data separately to avoid RLS issues with joins
      const [sectionsResult, classesResult, subjectsResult, creatorResult] = await Promise.all([
        supabase
          .from("exam_sections")
          .select("id, title, section_order, exam_questions(id)")
          .eq("exam_id", examId)
          .order("section_order"),
        supabase
          .from("exam_classes")
          .select("class_id, classes(id, name, section)")
          .eq("exam_id", examId),
        supabase
          .from("exam_subjects")
          .select("subject_id, universal_subjects(id, name)")
          .eq("exam_id", examId),
        supabase
          .from("profiles")
          .select("full_name")
          .eq("id", examData.created_by)
          .single(),
      ]);

      return {
        ...examData,
        exam_sections: sectionsResult.data || [],
        exam_classes: classesResult.data || [],
        exam_subjects: subjectsResult.data || [],
        profiles: creatorResult.data,
      };
    },
    enabled: !!examId && open,
  });

  const statusColors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    published: "bg-blue-100 text-blue-700",
    active: "bg-green-100 text-green-700",
    completed: "bg-purple-100 text-purple-700",
    archived: "bg-gray-100 text-gray-500",
  };

  const totalQuestions = exam?.exam_sections?.reduce(
    (sum: number, section: ExamSectionRow) => sum + (section.exam_questions?.length || 0),
    0
  ) || 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Exam Details</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : exam ? (
          <div className="mt-6 space-y-6">
            {/* Header */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold">{exam.title}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge className={statusColors[exam.status] || ""} variant="outline">
                      {exam.status}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {exam.exam_mode}
                    </Badge>
                  </div>
                </div>
              </div>
              {exam.description && (
                <p className="text-sm text-muted-foreground">{exam.description}</p>
              )}
            </div>

            {exam.status === "draft" && (
              <Button 
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/exams/edit/${exam.id}`);
                }}
                className="w-full"
              >
                <Edit3 className="h-4 w-4 mr-2" />
                Edit Exam
              </Button>
            )}

            {/* Download button for offline published exams */}
            {exam.exam_mode === "offline" && exam.status !== "draft" && (
              <DownloadQuestionPaperButton 
                examId={exam.id} 
                examTitle={exam.title}
                className="w-full"
              />
            )}

            <Separator />

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{totalQuestions}</p>
                  <p className="text-xs text-muted-foreground">Questions</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{exam.total_marks || 0}</p>
                  <p className="text-xs text-muted-foreground">Total Marks</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{exam.duration_minutes || 0}</p>
                  <p className="text-xs text-muted-foreground">Minutes</p>
                </CardContent>
              </Card>
            </div>

            {/* Schedule */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Schedule
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {exam.scheduled_date ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span>{format(new Date(exam.scheduled_date), "PPP")}</span>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Not scheduled</p>
                )}
                {exam.start_time && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start Time</span>
                    <span>{format(new Date(exam.start_time), "p")}</span>
                  </div>
                )}
                {exam.duration_minutes ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration</span>
                    <span>{exam.duration_minutes} min per student</span>
                  </div>
                ) : null}
                {/* Late entry extends the window: each student gets the full
                    duration from when THEY join, so the exam's close time is
                    start + late entry + duration — never start + duration.
                    Labelling end_time "End Time" read as if everyone was cut
                    off at start + duration. */}
                {exam.start_time && lateEntryMinutesOf(exam) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Entry closes</span>
                    <span>
                      {format(
                        new Date(
                          new Date(exam.start_time).getTime() +
                            lateEntryMinutesOf(exam) * 60_000,
                        ),
                        "p",
                      )}
                    </span>
                  </div>
                )}
                {exam.end_time && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {lateEntryMinutesOf(exam) > 0 ? "Closes for everyone" : "Ends by"}
                    </span>
                    <span>{format(new Date(exam.end_time), "p")}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sections */}
            {exam.exam_sections && exam.exam_sections.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Sections ({exam.exam_sections.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {exam.exam_sections
                      .sort(
                        (a: ExamSectionRow, b: ExamSectionRow) =>
                          a.section_order - b.section_order,
                      )
                      .map((section: ExamSectionRow) => (
                        <div key={section.id} className="flex items-center justify-between text-sm">
                          <span>{section.title}</span>
                          <Badge variant="outline" className="text-xs">
                            {section.exam_questions?.length || 0} questions
                          </Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Assigned Classes */}
            {exam.exam_classes && exam.exam_classes.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Assigned Classes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {exam.exam_classes.map((ec: ExamClassRow, i: number) => (
                      <Badge key={i} variant="outline">
                        {formatClassName(ec.classes?.name ?? "", ec.classes?.section)}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Configuration */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pass Marks</span>
                  <span>{exam.pass_marks || "Not set"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Blueprint Ready</span>
                  <Badge variant={exam.is_blueprint_ready ? "default" : "secondary"}>
                    {exam.is_blueprint_ready ? "Yes" : "No"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created By</span>
                  <span>{getDisplayName(exam.profiles)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{format(new Date(exam.created_at), "PP")}</span>
                </div>
              </CardContent>
            </Card>

            {/* Instructions */}
            {exam.instructions && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Instructions</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {exam.instructions}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Exam not found
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
