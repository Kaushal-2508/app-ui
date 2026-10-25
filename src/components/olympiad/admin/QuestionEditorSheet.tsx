import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { supabase } from "@/integrations/supabase/client";
import {
  useOlympiadQuestionUpsert,
  type QuestionUpsertInput,
} from "@/hooks/olympiad/useOlympiadQuestionUpsert";
import { useOlympiadTopics } from "@/hooks/olympiad/useOlympiadTopics";
import type { BankQuestion } from "@/hooks/olympiad/useOlympiadQuestionBank";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
  initial?: BankQuestion | null;
};

type DraftState = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "A" | "B" | "C" | "D";
  topic_id: string | null;
  internal_notes: string | null;
  status: "active" | "inactive";
};

const EMPTY: DraftState = {
  question_text: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_answer: "A",
  topic_id: null,
  internal_notes: null,
  status: "active",
};

const OPTION_KEYS = [
  "option_a",
  "option_b",
  "option_c",
  "option_d",
] as const satisfies (keyof DraftState)[];

export function QuestionEditorSheet({
  open,
  onOpenChange,
  subjectId,
  gradeLevelId,
  initial,
}: Props) {
  const upsert = useOlympiadQuestionUpsert();
  const { data: topics } = useOlympiadTopics(subjectId);
  const topicsForGrade = (topics ?? []).filter(
    (t) => t.grade_level_id === gradeLevelId && t.status === "active",
  );

  const [draft, setDraft] = useState<DraftState>(EMPTY);
  const initialRef = useRef<DraftState>(EMPTY);

  // Issue 3: fetch internal_notes for the question being edited so we don't
  // silently overwrite existing notes with null.  BankQuestion doesn't carry
  // this field, so we load it separately with a lightweight single-column
  // query that only fires when a real question ID is present and the sheet is
  // open.
  const { data: notesRow } = useQuery({
    queryKey: ["olympiad", "question-notes", initial?.id],
    queryFn: async () => {
      if (!initial?.id) return null;
      const { data, error } = await supabase
        .from("oly_questions")
        .select("internal_notes")
        .eq("id", initial.id)
        .single();
      if (error) throw error;
      return data as { internal_notes: string | null };
    },
    enabled: !!initial?.id && open,
    staleTime: 30_000,
  });

  useEffect(() => {
    const next: DraftState = initial
      ? {
          question_text: initial.question_text,
          option_a: initial.option_a,
          option_b: initial.option_b,
          option_c: initial.option_c,
          option_d: initial.option_d,
          correct_answer: initial.correct_answer,
          topic_id: initial.topic_id,
          internal_notes: notesRow?.internal_notes ?? null,
          status: initial.status,
        }
      : EMPTY;
    setDraft(next);
    initialRef.current = next;
  }, [initial, open, notesRow]);

  const update = <K extends keyof DraftState>(k: K, v: DraftState[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialRef.current);

  const onSubmit = async () => {
    // Issue 2: trim first, then validate — HTML `required` is bypassed by the
    // synthetic onSubmit so we must guard against whitespace-only values here.
    const trimmed = {
      question_text: draft.question_text.trim(),
      option_a: draft.option_a.trim(),
      option_b: draft.option_b.trim(),
      option_c: draft.option_c.trim(),
      option_d: draft.option_d.trim(),
    };
    if (
      !trimmed.question_text ||
      !trimmed.option_a ||
      !trimmed.option_b ||
      !trimmed.option_c ||
      !trimmed.option_d
    ) {
      toast.error("Question and all four options are required");
      return;
    }

    const payload: QuestionUpsertInput = {
      id: initial?.id,
      subject_id: subjectId,
      grade_level_id: gradeLevelId,
      topic_id: draft.topic_id,
      ...trimmed,
      correct_answer: draft.correct_answer,
      internal_notes: draft.internal_notes,
      status: draft.status,
    };
    try {
      await upsert.mutateAsync(payload);
      onOpenChange(false);
    } catch {
      // onError on the mutation already surfaces toastError.
      // Keep the sheet open so the user can correct and retry.
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Edit question" : "New question"}
      subtitle="Use $...$ for inline KaTeX, $$...$$ for block math."
    >
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Question</Label>
          <Textarea
            value={draft.question_text}
            onChange={(e) => update("question_text", e.target.value)}
            rows={4}
            required
            placeholder="e.g. Solve for $x$: $x^2 + 2x - 3 = 0$"
          />
          <MathPreview text={draft.question_text} />
        </div>

        {OPTION_KEYS.map((key) => {
          const letter = key.slice(-1).toUpperCase();
          return (
            <div key={key} className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">
                Option {letter}
              </Label>
              <Input
                value={draft[key]}
                onChange={(e) => update(key, e.target.value)}
                required
              />
              <MathPreview text={draft[key]} />
            </div>
          );
        })}

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">
              Correct answer
            </Label>
            <Select
              value={draft.correct_answer}
              onValueChange={(v) =>
                update("correct_answer", v as "A" | "B" | "C" | "D")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["A", "B", "C", "D"] as const).map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Topic</Label>
            <Select
              value={draft.topic_id ?? "__none"}
              onValueChange={(v) =>
                update("topic_id", v === "__none" ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No topic</SelectItem>
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
            Status
          </Label>
          <Select
            value={draft.status}
            onValueChange={(v) =>
              update("status", v as "active" | "inactive")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">
            Internal notes (super-admin only)
          </Label>
          <Textarea
            value={draft.internal_notes ?? ""}
            onChange={(e) =>
              update("internal_notes", e.target.value || null)
            }
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Save
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
