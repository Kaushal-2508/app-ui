import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Lightbulb,
  Check,
  X,
  ChevronRight,
  BookOpen,
  RefreshCcw,
  FileText,
  GraduationCap,
} from "lucide-react";
import {
  usePendingLearningActions,
  useApproveLearningAction,
  useDeclineLearningAction,
  type LearningAction,
} from "@/hooks/useLearningActions";
import { ApproveActionDialog } from "./ApproveActionDialog";

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

const priorityColors: Record<number, string> = {
  1: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  2: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  3: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  4: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  5: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

interface SuggestedActionsCardProps {
  classId?: string;
}

export function SuggestedActionsCard({ classId }: SuggestedActionsCardProps) {
  const { data: actions, isLoading } = usePendingLearningActions(classId);
  const approveMutation = useApproveLearningAction();
  const declineMutation = useDeclineLearningAction();
  const [selectedAction, setSelectedAction] = useState<LearningAction | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Suggested Learning Actions
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
            <Lightbulb className="h-4 w-4" />
            Suggested Learning Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">
              No pending learning actions to review.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Actions are auto-generated after exam results are finalized.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleQuickApprove = (action: LearningAction) => {
    approveMutation.mutate({ actionId: action.id });
  };

  const handleDecline = (actionId: string) => {
    declineMutation.mutate(actionId);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Suggested Learning Actions
            <Badge variant="secondary" className="ml-2">
              {actions.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {actions.slice(0, 5).map((action) => {
              const Icon = actionTypeIcons[action.action_type] || BookOpen;
              return (
                <div
                  key={action.id}
                  className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{action.title}</p>
                        <Badge
                          variant="outline"
                          className={`text-xs ${priorityColors[action.priority]}`}
                        >
                          P{action.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{action.student?.full_name}</span>
                        <span>•</span>
                        <span>{actionTypeLabels[action.action_type]}</span>
                        {action.topic?.topic_name && (
                          <>
                            <span>•</span>
                            <span>{action.topic.topic_name}</span>
                          </>
                        )}
                      </div>
                      {action.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {action.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-100"
                        onClick={() => handleQuickApprove(action)}
                        disabled={approveMutation.isPending}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-100"
                        onClick={() => handleDecline(action.id)}
                        disabled={declineMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setSelectedAction(action)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {actions.length > 5 && (
            <Button variant="ghost" className="w-full mt-3" size="sm">
              View all {actions.length} actions
            </Button>
          )}
        </CardContent>
      </Card>

      <ApproveActionDialog
        action={selectedAction}
        open={!!selectedAction}
        onOpenChange={(open) => !open && setSelectedAction(null)}
      />
    </>
  );
}
