import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MathPreview } from "@/components/ui/math-preview";
import {
  useOlympiadQuestionBank,
  type BankFilters,
  type BankSort,
  type BankQuestion,
} from "@/hooks/olympiad/useOlympiadQuestionBank";
import { useOlympiadQuestionBulkAction } from "@/hooks/olympiad/useOlympiadQuestionBulkAction";
import { QuestionEditorSheet } from "./QuestionEditorSheet";

type Props = {
  subjectId: string;
  gradeLevelId: string;
};

export function QuestionBankTable({ subjectId, gradeLevelId }: Props) {
  const [filters, setFilters] = useState<BankFilters>({
    topicId: null,
    status: null,
  });
  const [sort, setSort] = useState<BankSort>("last_used_desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const { data, isLoading } = useOlympiadQuestionBank(
    subjectId,
    gradeLevelId,
    filters,
    sort,
    page,
    pageSize,
  );
  const bulk = useOlympiadQuestionBulkAction();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Issue 1: clear selection whenever page/filters/sort change so stale IDs
  // from other pages can never be included in bulk actions.
  const setPageSafe = (p: number) => {
    setPage(p);
    setSelected(new Set());
  };
  const setFiltersSafe = (updater: (f: BankFilters) => BankFilters) => {
    setFilters(updater);
    setSelected(new Set());
    setPage(1);
  };
  const setSortSafe = (s: BankSort) => {
    setSort(s);
    setSelected(new Set());
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.status ?? "__all"}
          onValueChange={(v) => {
            setFiltersSafe((f) => ({
              ...f,
              status:
                v === "__all"
                  ? null
                  : (v as "active" | "inactive"),
            }));
          }}
        >
          <SelectTrigger className="h-9 w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={sort}
          onValueChange={(v) => {
            setSortSafe(v as BankSort);
          }}
        >
          <SelectTrigger className="h-9 w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_used_desc">Last used (recent)</SelectItem>
            <SelectItem value="times_used_desc">Times used (high)</SelectItem>
            <SelectItem value="avg_correct_rate_asc">
              Avg correct rate (low)
            </SelectItem>
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <div className="ml-auto flex gap-2">
            {/* Issue 4: disable during pending mutation to prevent double-fire */}
            <Button
              size="sm"
              variant="outline"
              disabled={bulk.isPending}
              onClick={() =>
                bulk.mutate({
                  ids: Array.from(selected),
                  status: "inactive",
                })
              }
            >
              Deactivate {selected.size}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulk.isPending}
              onClick={() =>
                bulk.mutate({ ids: Array.from(selected), status: "active" })
              }
            >
              Activate {selected.size}
            </Button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 py-6 text-center">
          No questions match these filters.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => (
            <li
              key={q.id}
              className="flex items-start gap-3 px-3 py-3 surface-card frosted-shadow rounded-card"
            >
              <Checkbox
                checked={selected.has(q.id)}
                onCheckedChange={(v) => toggle(q.id, !!v)}
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-sm text-ink-900">
                  {q.question_text.includes("$") ? (
                    <MathPreview text={q.question_text} />
                  ) : (
                    <span className="line-clamp-2">{q.question_text}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                  {q.topic_name && (
                    <Badge variant="secondary" className="text-[10px]">
                      {q.topic_name}
                    </Badge>
                  )}
                  <span>Correct: {q.correct_answer}</span>
                  <span>·</span>
                  <span>Used {q.times_used}x</span>
                  {q.avg_correct_rate_percent != null && (
                    <>
                      <span>·</span>
                      <span>{q.avg_correct_rate_percent}% correct</span>
                    </>
                  )}
                  <span className="ml-auto">{q.status}</span>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setEditing(q);
                  setSheetOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-ink-600 pt-2">
          <span>
            Page {page} of {totalPages} ({total} questions)
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPageSafe(page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPageSafe(page + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <QuestionEditorSheet
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) setEditing(null);
        }}
        subjectId={subjectId}
        gradeLevelId={gradeLevelId}
        initial={editing}
      />
    </div>
  );
}
