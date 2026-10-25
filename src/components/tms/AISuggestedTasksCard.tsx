import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Sparkles, 
  RefreshCw, 
  CheckCircle2, 
  X, 
  TrendingDown, 
  FileText, 
  BookOpen,
  UserCheck,
  AlertTriangle
} from "lucide-react";
import { 
  useAISuggestedTasks, 
  useGenerateTaskSuggestions, 
  useUpdateSuggestionStatus,
  AISuggestedTask 
} from "@/hooks/useAISuggestedTasks";
import { useCreateTask, TaskType } from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";

const sourceTypeIcons: Record<string, typeof TrendingDown> = {
  performance: TrendingDown,
  evaluation: FileText,
  mastery: BookOpen,
  activity: UserCheck,
};

const priorityLabels: Record<number, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  1: { label: "Low", variant: "secondary" },
  2: { label: "Medium", variant: "default" },
  3: { label: "High", variant: "destructive" },
};

export function AISuggestedTasksCard() {
  const { data: suggestions, isLoading } = useAISuggestedTasks();
  const generateSuggestions = useGenerateTaskSuggestions();
  const updateStatus = useUpdateSuggestionStatus();
  const createTask = useCreateTask();
  const { data: userRole } = useUserRole();
  
  const [selectedSuggestion, setSelectedSuggestion] = useState<AISuggestedTask | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const handleCreateTask = async (suggestion: AISuggestedTask) => {
    if (!userRole?.institutionId) return;

    try {
      await createTask.mutateAsync({
        title: suggestion.title,
        description: suggestion.description || undefined,
        taskType: suggestion.task_type as TaskType,
        priority: suggestion.priority,
        assigneeId: suggestion.suggested_assignee || "",
        institutionId: userRole.institutionId,
        wingId: suggestion.wing_id || undefined,
      });

      await updateStatus.mutateAsync({
        suggestionId: suggestion.id,
        status: "accepted",
      });

      setConfirmDialogOpen(false);
      setSelectedSuggestion(null);
    } catch (error) {
      console.error("Error creating task from suggestion:", error);
    }
  };

  const handleDismiss = async (suggestionId: string) => {
    await updateStatus.mutateAsync({
      suggestionId,
      status: "dismissed",
    });
  };

  const handleRefresh = () => {
    if (userRole?.institutionId) {
      generateSuggestions.mutate({ institutionId: userRole.institutionId });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              AI Suggested Actions
            </CardTitle>
            <CardDescription>
              Smart recommendations based on school performance data
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={generateSuggestions.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${generateSuggestions.isPending ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {!suggestions || suggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium mb-2">No suggestions yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Click refresh to generate AI-powered task suggestions
              </p>
              <Button 
                onClick={handleRefresh} 
                disabled={generateSuggestions.isPending}
              >
                {generateSuggestions.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Generate Suggestions
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-3">
                {suggestions.map((suggestion) => {
                  const Icon = sourceTypeIcons[suggestion.source_type] || AlertTriangle;
                  const priority = priorityLabels[suggestion.priority] || priorityLabels[2];

                  return (
                    <div
                      key={suggestion.id}
                      className="p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="p-2 rounded-full bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <h4 className="font-medium text-sm">{suggestion.title}</h4>
                              <Badge variant={priority.variant} className="text-xs">
                                {priority.label}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {suggestion.description}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => {
                              setSelectedSuggestion(suggestion);
                              setConfirmDialogOpen(true);
                            }}
                            title="Create Task"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDismiss(suggestion.id)}
                            disabled={updateStatus.isPending}
                            title="Dismiss"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create Task from Suggestion?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedSuggestion && (
                <>
                  <strong className="text-foreground">{selectedSuggestion.title}</strong>
                  <br />
                  <span className="mt-2 block">{selectedSuggestion.description}</span>
                  {!selectedSuggestion.suggested_assignee && (
                    <span className="mt-2 block text-amber-600">
                      Note: You'll need to select an assignee for this task.
                    </span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedSuggestion && handleCreateTask(selectedSuggestion)}
              disabled={createTask.isPending || !selectedSuggestion?.suggested_assignee}
            >
              {createTask.isPending ? "Creating..." : "Create Task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
