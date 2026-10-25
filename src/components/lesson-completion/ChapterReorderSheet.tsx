import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Button } from "@/components/ui/button";
import { ChapterStatusTag } from "@/components/lesson-completion/ChapterStatusTag";
import { CHAPTER_ROW_TINT } from "@/components/lesson-completion/chapterStatusStyle";
import { cn } from "@/lib/utils";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  useSyllabusProgressState,
  useReorderChapters,
} from "@/hooks/useSyllabusProgress";

/**
 * "Edit the whole timeline" surface: reorder the remaining (not-completed)
 * chapters of one (class, subject). Saving rewrites syllabus_sequence; every
 * projection recomputes from the new order on next read (Auto wins — no pins).
 */
export function ChapterReorderSheet({
  open, onOpenChange, classId, subjectId, subjectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  subjectId: string;
  subjectName: string;
}) {
  const { institutionId } = useEffectiveInstitution();
  const stateQuery = useSyllabusProgressState(open ? { classId, subjectId } : null);
  const { isLoading, isError } = stateQuery;
  // No [] destructuring default: that fallback is a fresh array every render
  // while data is undefined (loading/errored), which would re-fire the seeding
  // effect in a tight loop. `data` itself is referentially stable.
  const chapters = stateQuery.data;
  const reorder = useReorderChapters();
  const [order, setOrder] = useState<{ id: string; label: string; status: "partial" | "untouched" }[]>([]);

  // Seed local order from the server state each time the sheet opens — sorted
  // the way the projector orders chapters (partial-first, then position) so
  // what the teacher sees here matches the timeline they're editing.
  useEffect(() => {
    if (!open || !chapters) return;
    setOrder(
      chapters
        .filter((c) => c.status !== "completed")
        .sort((a, b) =>
          (b.status === "partial" ? 1 : 0) - (a.status === "partial" ? 1 : 0)
          || a.position - b.position
          || a.topic_name.localeCompare(b.topic_name))
        .map((c) => ({
          id: c.topic_id,
          label: `${c.chapter_number != null ? `${c.chapter_number}. ` : ""}${c.topic_name}`,
          status: c.status === "partial" ? ("partial" as const) : ("untouched" as const),
        })),
    );
  }, [open, chapters]);

  // Completed chapters are listed too, below and not movable: the order only
  // drives what is still to be taught, but a list that silently drops chapters
  // reads as if they were missing from the syllabus.
  const completed = (chapters ?? []).filter((c) => c.status === "completed");

  const move = (idx: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const save = async () => {
    if (!institutionId) return;
    await reorder.mutateAsync({
      classId, subjectId, institutionId,
      orderedTopicIds: order.map((o) => o.id),
    });
    onOpenChange(false);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Chapter order"
      subtitle={`${subjectName} · the auto timeline follows this order`}
      icon={<ListOrdered className="h-4 w-4" />}
      primaryAction={{ label: "Save order", onClick: save, disabled: order.length === 0 || !institutionId, loading: reorder.isPending }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: reorder.isPending }}
    >
      {isLoading ? (
        <p className="py-6 text-sm text-ink-500">Loading chapters…</p>
      ) : isError ? (
        <p className="py-6 text-sm text-ink-500">Couldn't load chapters. Close and try again.</p>
      ) : (
        <div className="space-y-4">
          {order.length === 0 ? (
            <p className="py-2 text-sm text-ink-500">No remaining chapters. Everything is completed.</p>
          ) : (
            <form data-dirty="true" onSubmit={(e) => e.preventDefault()} className="space-y-1.5">
              {order.map((c, idx) => (
                <div key={c.id} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5", CHAPTER_ROW_TINT[c.status])}>
                  <span className="w-6 text-xs tabular-nums text-ink-500">{idx + 1}.</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-ink-900">{c.label}</span>
                  <ChapterStatusTag status={c.status} />
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => move(idx, -1)} disabled={idx === 0 || reorder.isPending} title="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => move(idx, 1)} disabled={idx === order.length - 1 || reorder.isPending} title="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </form>
          )}
          {completed.length > 0 && (
            <div className="space-y-1.5">
              <p className="eyebrow">Completed</p>
              {completed.map((c) => (
                <div key={c.topic_id} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5", CHAPTER_ROW_TINT.completed)}>
                  <span className="flex-1 min-w-0 truncate text-sm text-ink-900">
                    {c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.topic_name}
                  </span>
                  <ChapterStatusTag status="completed" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </MobileSheet>
  );
}
