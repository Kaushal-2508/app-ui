import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, CheckCircle2, Circle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { MathPreview } from "@/components/ui/math-preview";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { useOlympiadTopics } from "@/hooks/olympiad/useOlympiadTopics";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
};

type Letter = "A" | "B" | "C" | "D";
type GenQuestion = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: Letter;
};

const COUNTS = [5, 10, 15] as const;
const OPTION_LETTERS: Letter[] = ["A", "B", "C", "D"];

export function QuestionAiGenerateSheet({
  open,
  onOpenChange,
  subjectId,
  gradeLevelId,
}: Props) {
  const queryClient = useQueryClient();
  const { data: topics } = useOlympiadTopics(subjectId);
  const topicsForGrade = (topics ?? []).filter(
    (t) => t.grade_level_id === gradeLevelId && t.status === "active",
  );

  const [count, setCount] = useState<number>(5);
  const [topicId, setTopicId] = useState<string>("__all");
  const [focus, setFocus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [generated, setGenerated] = useState<GenQuestion[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Reset everything whenever the sheet closes so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setCount(5);
      setTopicId("__all");
      setFocus("");
      setGenerating(false);
      setInserting(false);
      setGenerated(null);
      setSelected(new Set());
    }
  }, [open]);

  const onGenerate = async () => {
    setGenerating(true);
    try {
      const { questions } = await invokeEdgeFunction<{ questions: GenQuestion[] }>(
        "oly-generate-questions",
        {
          subject_id: subjectId,
          grade_level_id: gradeLevelId,
          topic_id: topicId === "__all" ? null : topicId,
          count,
          focus: focus.trim() || undefined,
        },
      );
      setGenerated(questions);
      setSelected(new Set(questions.map((_, i) => i)));
    } catch (e) {
      toastError(e as Error, {
        fallback: "Couldn't generate questions.",
        context: "QuestionAiGenerateSheet.onGenerate",
      });
    } finally {
      setGenerating(false);
    }
  };

  const onInsert = async () => {
    if (!generated) return;
    const rows = generated
      .filter((_, i) => selected.has(i))
      .map((q) => ({
        subject_id: subjectId,
        grade_level_id: gradeLevelId,
        topic_id: topicId === "__all" ? null : topicId,
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        correct_answer: q.correct_answer,
      }));
    if (rows.length === 0) {
      toast.warning("Select at least one question to add.");
      return;
    }
    setInserting(true);
    try {
      const result = await invokeEdgeFunction<{ inserted_count: number }>(
        "oly-question-csv-import",
        { rows },
      );
      const n = result.inserted_count ?? rows.length;
      toast.success(`Added ${n} question${n === 1 ? "" : "s"} to the bank`);
      queryClient.invalidateQueries({
        queryKey: ["olympiad", "question-bank", subjectId, gradeLevelId],
      });
      onOpenChange(false);
    } catch (e) {
      toastError(e as Error, {
        fallback: "Couldn't add the questions.",
        context: "QuestionAiGenerateSheet.onInsert",
      });
    } finally {
      setInserting(false);
    }
  };

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const inPreview = generated !== null;
  const selectedCount = selected.size;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="AI generate questions"
      subtitle={
        inPreview
          ? "Review the generated questions, then add the ones you want."
          : "Generate olympiad MCQs for this subject and class with AI."
      }
      icon={<Sparkles className="h-4 w-4" />}
      primaryAction={
        inPreview
          ? {
              label: `Add ${selectedCount} to bank`,
              onClick: onInsert,
              loading: inserting,
              disabled: selectedCount === 0 || inserting,
            }
          : {
              label: "Generate",
              onClick: onGenerate,
              loading: generating,
              disabled: generating,
            }
      }
      secondaryAction={
        inPreview
          ? { label: "Back", onClick: () => setGenerated(null), disabled: inserting }
          : undefined
      }
    >
      {!inPreview ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">How many</Label>
              <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTS.map((c) => (
                    <SelectItem key={c} value={String(c)}>
                      {c} questions
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">Topic</Label>
              <Select value={topicId} onValueChange={setTopicId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All topics (mixed)</SelectItem>
                  {topicsForGrade.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">
              Extra instructions <span className="text-ink-400">(optional)</span>
            </Label>
            <Textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={3}
              placeholder="e.g. focus on Indian rivers and state capitals; avoid current-affairs after 2024."
            />
          </div>

          <p className="text-xs text-ink-500">
            Questions are drafted at olympiad difficulty for this grade. You can review,
            deselect any you don't want, and edit them after adding.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setGenerated(null)}
            className="inline-flex items-center gap-1 text-xs text-ink-600 hover:text-ink-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Change settings &amp; regenerate
          </button>

          {generated.map((q, i) => {
            const isSel = selected.has(i);
            const options: Array<[Letter, string]> = [
              ["A", q.option_a],
              ["B", q.option_b],
              ["C", q.option_c],
              ["D", q.option_d],
            ];
            return (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => toggle(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(i);
                  }
                }}
                className={cn(
                  "surface-card rounded-card border p-3 cursor-pointer transition-colors",
                  isSel
                    ? "border-brand-primary/50 bg-brand-primary/5"
                    : "border-surface-stroke opacity-70",
                )}
              >
                <div className="flex items-start gap-2.5">
                  {isSel ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="text-sm font-medium text-ink-900">
                      <span className="text-ink-500">Q{i + 1}. </span>
                      <MathPreview text={q.question_text} />
                    </div>
                    <ul className="space-y-1">
                      {options.map(([letter, text]) => {
                        const correct = letter === q.correct_answer;
                        return (
                          <li
                            key={letter}
                            className={cn(
                              "flex items-start gap-2 rounded-md px-2 py-1 text-[13px]",
                              correct
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "text-ink-700",
                            )}
                          >
                            <span className="font-semibold">{letter}.</span>
                            <span className="min-w-0 flex-1">
                              <MathPreview text={text} />
                            </span>
                            {correct && (
                              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">
                                correct
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between pt-1 text-xs text-ink-600">
            <span>
              {selectedCount} of {generated.length} selected
            </span>
            <button
              type="button"
              onClick={() =>
                setSelected(
                  selectedCount === generated.length
                    ? new Set()
                    : new Set(generated.map((_, i) => i)),
                )
              }
              className="font-medium text-brand-primary hover:underline"
            >
              {selectedCount === generated.length ? "Deselect all" : "Select all"}
            </button>
          </div>
        </div>
      )}
    </MobileSheet>
  );
}
