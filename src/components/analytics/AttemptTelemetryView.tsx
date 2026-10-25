import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock,
  Flag,
  CheckCircle2,
  SkipForward,
  PenTool,
  BarChart3,
} from "lucide-react";

interface AttemptTelemetryViewProps {
  attemptId: string;
}

export function AttemptTelemetryView({ attemptId }: AttemptTelemetryViewProps) {
  // Fetch question telemetry
  const { data: questionTelemetry, isLoading: questionsLoading } = useQuery({
    queryKey: ["attempt-question-telemetry", attemptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attempt_question_telemetry")
        .select(`
          *,
          exam_questions (
            question_text,
            marks,
            question_type,
            section_id
          )
        `)
        .eq("attempt_id", attemptId);

      if (error) throw error;
      return data;
    },
  });

  // Fetch section telemetry
  const { data: sectionTelemetry, isLoading: sectionsLoading } = useQuery({
    queryKey: ["attempt-section-telemetry", attemptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attempt_section_telemetry")
        .select(`
          *,
          exam_sections (
            title,
            section_order
          )
        `)
        .eq("attempt_id", attemptId)
        .order("exam_sections(section_order)");

      if (error) throw error;
      return data;
    },
  });

  if (questionsLoading || sectionsLoading) {
    return <LoadingSkeleton />;
  }

  const totalQuestions = questionTelemetry?.length || 0;
  const answeredQuestions = questionTelemetry?.filter((q) => q.is_answered).length || 0;
  const skippedQuestions = questionTelemetry?.filter((q) => q.is_skipped).length || 0;
  const flaggedQuestions = questionTelemetry?.filter((q) => q.is_flagged_for_review).length || 0;
  const totalTimeSpent = questionTelemetry?.reduce((acc, q) => acc + (q.total_time_seconds || 0), 0) || 0;
  const avgTimePerQuestion = totalQuestions > 0 ? Math.round(totalTimeSpent / totalQuestions) : 0;
  const totalAnswerChanges = questionTelemetry?.reduce((acc, q) => acc + (q.answer_change_count || 0), 0) || 0;

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Answered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {answeredQuestions}/{totalQuestions}
            </div>
            <Progress
              value={(answeredQuestions / totalQuestions) * 100}
              className="mt-2 h-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg Time/Question
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTime(avgTimePerQuestion)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PenTool className="h-4 w-4" />
              Answer Changes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{totalAnswerChanges}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Flag className="h-4 w-4" />
              Flagged
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{flaggedQuestions}</div>
          </CardContent>
        </Card>
      </div>

      {/* Section Breakdown */}
      {sectionTelemetry && sectionTelemetry.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Section Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sectionTelemetry.map((section: any) => {
                const sectionQuestions = questionTelemetry?.filter(
                  (q: any) => q.exam_questions?.section_id === section.section_id
                );
                const sectionAnswered = sectionQuestions?.filter((q) => q.is_answered).length || 0;
                const sectionTotal = sectionQuestions?.length || 0;

                return (
                  <div key={section.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{section.exam_sections?.title}</span>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>
                          {sectionAnswered}/{sectionTotal} answered
                        </span>
                        <span>{formatTime(section.total_time_seconds || 0)}</span>
                      </div>
                    </div>
                    <Progress
                      value={sectionTotal > 0 ? (sectionAnswered / sectionTotal) * 100 : 0}
                      className="h-2"
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Question Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Question-Level Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {questionTelemetry?.map((q: any, idx: number) => (
              <div
                key={q.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-muted-foreground w-8">
                    Q{idx + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {q.is_answered ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <SkipForward className="h-4 w-4 text-muted-foreground" />
                    )}
                    {q.is_flagged_for_review && (
                      <Flag className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {q.exam_questions?.question_type}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>Views: {q.view_count}</span>
                  <span>Changes: {q.answer_change_count}</span>
                  <span>{formatTime(q.total_time_seconds || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
