import { useNavigate } from "react-router-dom";
import { Loader2, Copy, Trash2, Pencil, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CompletionBar } from "../components/CompletionBar";
import {
  useExamDrafts,
  useDuplicateExamDraft,
  useDeleteExamDraft,
} from "@/hooks/useExamDrafts";
import { toast } from "sonner";

/**
 * Drafts tab mounted inside ExamsPage. Lists the current user's in-progress
 * exams with completion bars and Continue / Duplicate / Delete actions.
 */
export function DraftsTab() {
  const navigate = useNavigate();
  const { data: drafts = [], isLoading, error } = useExamDrafts();
  const duplicate = useDuplicateExamDraft();
  const del = useDeleteExamDraft();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium">No drafts yet</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Start a new exam. It will auto-save here as you work.
        </div>
        <Button
          type="button"
          className="mt-3 min-h-[44px]"
          onClick={() => navigate("/exams/create")}
        >
          Create exam
        </Button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
      {drafts.map((d) => {
        const pct = Math.max(0, Math.min(100, d.completionPercent));
        return (
          <li
            key={d.id}
            className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {d.title || "Untitled exam"}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {d.subjectName && <span>{d.subjectName}</span>}
                {d.subjectName && <span className="text-border">•</span>}
                <span className="capitalize">{d.exam_mode}</span>
                <span className="text-border">•</span>
                <span>
                  {d.questionsCount}/{d.targetQuestionsCount} questions
                </span>
              </div>
            </div>

            <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
              <CompletionBar percent={pct} className="h-1.5 flex-1" />
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(pct)}%
              </span>
            </div>

            <div className="col-start-2 row-start-1 flex items-center gap-1 sm:col-start-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-3 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
                onClick={() => navigate(`/exams/edit/${d.id}`)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Continue
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                disabled={duplicate.isPending}
                title="Duplicate"
                onClick={() => {
                  duplicate.mutate(d.id, {
                    onSuccess: () => toast.success("Draft duplicated"),
                  });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                disabled={del.isPending}
                title="Delete"
                onClick={() => {
                  if (
                    !confirm(
                      `Delete draft "${d.title || "Untitled exam"}"? This cannot be undone.`
                    )
                  )
                    return;
                  del.mutate(d.id, {
                    onSuccess: () => toast.success("Draft deleted"),
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
