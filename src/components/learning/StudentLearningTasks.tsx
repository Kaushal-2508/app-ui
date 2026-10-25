import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Target,
  BookOpen,
  FileText,
  RefreshCcw,
  GraduationCap,
  CheckCircle2,
  Clock,
  Calendar,
} from "lucide-react";
import {
  useStudentLearningActions,
  useCompleteLearningAction,
  type LearningAction,
} from "@/hooks/useLearningActions";
import { format, isPast, isToday } from "date-fns";

const actionTypeIcons: Record<string, typeof BookOpen> = {
  revision: BookOpen,
  practice: FileText,
  retest: RefreshCcw,
  study_material: GraduationCap,
};

const actionTypeLabels: Record<string, string> = {
  revision: "Revision",
  practice: "Practice",
  retest: "Retest",
  study_material: "Study Material",
};

export function StudentLearningTasks() {
  const { data: actions, isLoading } = useStudentLearningActions();
  const completeMutation = useCompleteLearningAction();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            My Learning Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!actions || actions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            My Learning Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Target className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">
              No learning tasks assigned yet.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Your teacher will assign personalized tasks based on your performance.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleComplete = (actionId: string) => {
    completeMutation.mutate(actionId);
  };

  const getDueDateStatus = (dueDate: string | null) => {
    if (!dueDate) return null;
    const date = new Date(dueDate);
    if (isPast(date) && !isToday(date)) {
      return { label: "Overdue", className: "text-red-600 bg-red-100 dark:bg-red-950" };
    }
    if (isToday(date)) {
      return { label: "Due Today", className: "text-amber-600 bg-amber-100 dark:bg-amber-950" };
    }
    return { label: format(date, "MMM d"), className: "text-muted-foreground bg-muted" };
  };

  // Sort by priority and due date
  const sortedActions = [...actions].sort((a, b) => {
    // Priority first
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Then by due date (null goes last)
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    if (a.due_date && b.due_date) {
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    }
    return 0;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          My Learning Tasks
          <Badge variant="secondary" className="ml-2">
            {actions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sortedActions.map((action) => {
            const Icon = actionTypeIcons[action.action_type] || BookOpen;
            const dueDateStatus = getDueDateStatus(action.due_date);
            
            return (
              <div
                key={action.id}
                className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{action.title}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {actionTypeLabels[action.action_type]}
                      </Badge>
                      {action.topic?.topic_name && (
                        <Badge variant="secondary" className="text-xs">
                          {action.topic.topic_name}
                        </Badge>
                      )}
                      {dueDateStatus && (
                        <Badge className={`text-xs ${dueDateStatus.className}`}>
                          <Clock className="h-3 w-3 mr-1" />
                          {dueDateStatus.label}
                        </Badge>
                      )}
                    </div>
                    {action.description && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {action.description}
                      </p>
                    )}
                    {action.exam?.title && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Based on: {action.exam.title}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleComplete(action.id)}
                    disabled={completeMutation.isPending}
                    className="flex-shrink-0"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Complete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
