import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileImage,
  Calendar,
  ChevronRight,
  CheckCircle2,
  Clock,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { formatClassName } from "@/lib/utils";

interface ExamClass {
  class_id: string;
  class_name: string;
  section: string | null;
  total_students: number;
  scanned_count: number;
  evaluated_count: number;
}

interface PendingExam {
  id: string;
  title: string;
  scheduled_date: string | null;
  total_marks: number | null;
  status: string;
  classes: ExamClass[];
}

interface ExamListViewProps {
  exams: PendingExam[];
  isLoading: boolean;
  onSelectExam: (examId: string, classId: string) => void;
}

export function ExamListView({ exams, isLoading, onSelectExam }: ExamListViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (exams.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center justify-center text-center">
          <FileImage className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="font-medium text-lg">No Pending Offline Exams</h3>
          <p className="text-muted-foreground mt-1">
            All offline exams have been evaluated and published.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {exams.map((exam) => (
        <Card key={exam.id} className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileImage className="h-4 w-4" />
                  {exam.title}
                </CardTitle>
                {exam.scheduled_date && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(exam.scheduled_date), "PPP")}
                  </p>
                )}
              </div>
              {exam.total_marks && (
                <Badge variant="outline">{exam.total_marks} marks</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {exam.classes.map((cls) => {
                const scanProgress = cls.total_students > 0
                  ? (cls.scanned_count / cls.total_students) * 100
                  : 0;
                const evalProgress = cls.total_students > 0
                  ? (cls.evaluated_count / cls.total_students) * 100
                  : 0;

                let status: "pending_scan" | "ready_for_ai" | "ready_to_publish" = "pending_scan";
                if (cls.scanned_count >= cls.total_students && cls.evaluated_count >= cls.total_students) {
                  status = "ready_to_publish";
                } else if (cls.scanned_count > 0) {
                  status = "ready_for_ai";
                }

                return (
                  <div
                    key={cls.class_id}
                    className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => onSelectExam(exam.id, cls.class_id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {formatClassName(cls.class_name, cls.section)}
                        </span>
                        <StatusBadge status={status} />
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            Scanned
                          </span>
                          <span className="font-medium">
                            {cls.scanned_count}/{cls.total_students}
                          </span>
                        </div>
                        <Progress value={scanProgress} className="h-1.5" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Evaluated
                          </span>
                          <span className="font-medium">
                            {cls.evaluated_count}/{cls.total_students}
                          </span>
                        </div>
                        <Progress value={evalProgress} className="h-1.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: "pending_scan" | "ready_for_ai" | "ready_to_publish" }) {
  const config = {
    pending_scan: {
      label: "Pending Scan",
      variant: "outline" as const,
      icon: Clock,
    },
    ready_for_ai: {
      label: "Ready for AI",
      variant: "secondary" as const,
      icon: FileImage,
    },
    ready_to_publish: {
      label: "Ready to Publish",
      variant: "default" as const,
      icon: CheckCircle2,
    },
  };

  const { label, variant, icon: Icon } = config[status];

  return (
    <Badge variant={variant} className="text-xs gap-1">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
