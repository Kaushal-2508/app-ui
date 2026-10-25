import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  HelpCircle, 
  Award, 
  CheckCircle2, 
  AlertTriangle 
} from "lucide-react";
import type { ExamStats } from "@/types/exam";

interface ExamStatsCardProps {
  stats: ExamStats;
}

export function ExamStatsCard({ stats }: ExamStatsCardProps) {
  const blueprintStatus = stats.blueprintsRequired === 0 
    ? "complete" 
    : stats.blueprintsCovered >= stats.blueprintsRequired 
      ? "complete" 
      : "incomplete";

  return (
    <Card className="sticky top-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Exam Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            Sections
          </div>
          <Badge variant="secondary">{stats.totalSections}</Badge>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HelpCircle className="h-4 w-4" />
            Questions
          </div>
          <Badge variant="secondary">{stats.totalQuestions}</Badge>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Award className="h-4 w-4" />
            Total Marks
          </div>
          <Badge variant="outline" className="font-mono">
            {stats.totalMarks}
          </Badge>
        </div>

        <hr />

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Question Types
          </p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Objective</span>
            <span>{stats.objectiveQuestions}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subjective</span>
            <span>{stats.subjectiveQuestions}</span>
          </div>
        </div>

        <hr />

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Evaluation Blueprint
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            {blueprintStatus === "complete" ? (
              <div className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm">Ready</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm">
                  {stats.blueprintsCovered}/{stats.blueprintsRequired}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
