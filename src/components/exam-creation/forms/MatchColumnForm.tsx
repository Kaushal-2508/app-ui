import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Shuffle } from "lucide-react";
import { MathInput } from "@/components/ui/math-input";
import { DiagramField } from "./DiagramField";
import { MarksHeader } from "./MarksHeader";
import {
  sharedMetaSchema,
  buildQuestion,
  type ManualFormBaseProps,
} from "./formShared";
import type { MatchingData } from "@/types/exam";
import { useState } from "react";

const pairSchema = z.object({
  left: z.string().min(1, "Required"),
  right: z.string().min(1, "Required"),
});

const matchSchema = sharedMetaSchema.extend({
  questionText: z.string().min(3, "Question text is required"),
  pairs: z.array(pairSchema).min(2, "Add at least 2 pairs"),
});

type MatchValues = z.infer<typeof matchSchema>;

export function MatchColumnForm({
  questionType,
  defaultMarks,
  sectionCurrentTotal,
  sectionTargetTotal,
  initial,
  onSaveDone,
  onSaveAnother,
  onCancel,
}: ManualFormBaseProps) {
  const initialPairs = (() => {
    const m = initial?.matchingData;
    if (m && m.columnA && m.columnB) {
      return m.columnA.map((l, i) => ({ left: l, right: m.columnB[i] ?? "" }));
    }
    return [
      { left: "", right: "" },
      { left: "", right: "" },
      { left: "", right: "" },
    ];
  })();

  const [imageUrl, setImageUrl] = useState<string | null>(
    initial?.imageUrl ?? null
  );

  const form = useForm<MatchValues>({
    resolver: zodResolver(matchSchema),
    defaultValues: {
      marks: Number(initial?.marks ?? defaultMarks),
      difficultyLevel: initial?.difficultyLevel ?? 3,
      explanation: initial?.explanation ?? "",
      questionText: initial?.questionText ?? "",
      pairs: initialPairs,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "pairs",
  });

  const handle = (values: MatchValues, keepOpen: boolean) => {
    const matchingData: MatchingData = {
      columnA: values.pairs.map((p) => p.left),
      columnB: values.pairs.map((p) => p.right),
      matches: values.pairs
        .map((_, i) => `${i + 1}-${String.fromCharCode(65 + i)}`)
        .join(", "),
    };
    const question = buildQuestion(questionType, values, {
      tempId: initial?.tempId,
      questionText: values.questionText,
      matchingData,
      correctAnswer: matchingData.matches ?? null,
      options: null,
      imageUrl: imageUrl ?? undefined,
    });
    if (keepOpen) {
      onSaveAnother(question);
      form.reset({
        ...form.getValues(),
        questionText: "",
        explanation: "",
        pairs: [
          { left: "", right: "" },
          { left: "", right: "" },
          { left: "", right: "" },
        ],
      });
      setImageUrl(null);
    } else {
      onSaveDone(question);
    }
  };

  const marks = form.watch("marks");

  return (
    <Form {...form}>
      <form className="space-y-4 pb-4">
        <MarksHeader
          marks={Number(marks)}
          defaultMarks={defaultMarks}
          currentTotal={sectionCurrentTotal}
          targetTotal={sectionTargetTotal}
        />

        <FormField
          control={form.control}
          name="questionText"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Instruction</FormLabel>
              <FormControl>
                <MathInput
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="Match the items in Column A with Column B."
                  minHeight={64}
                  invalid={!!fieldState.error}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DiagramField imageUrl={imageUrl} onChange={setImageUrl} />

        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs text-primary">
            <Shuffle className="h-3.5 w-3.5" />
            <span>Column B will auto-shuffle for students.</span>
          </div>
          <div className="mb-2 grid grid-cols-[1fr_1fr_44px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Column A</div>
            <div>Column B</div>
            <div></div>
          </div>
          <div className="space-y-2">
            {fields.map((field, idx) => (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_1fr_44px] items-start gap-2"
              >
                <FormField
                  control={form.control}
                  name={`pairs.${idx}.left` as const}
                  render={({ field: leftField, fieldState }) => (
                    <MathInput
                      value={leftField.value ?? ""}
                      onChange={leftField.onChange}
                      placeholder={`A${idx + 1}`}
                      minHeight={44}
                      compact
                      invalid={!!fieldState.error}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name={`pairs.${idx}.right` as const}
                  render={({ field: rightField, fieldState }) => (
                    <MathInput
                      value={rightField.value ?? ""}
                      onChange={rightField.onChange}
                      placeholder={`B${idx + 1}`}
                      minHeight={44}
                      compact
                      invalid={!!fieldState.error}
                    />
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-destructive"
                  onClick={() => remove(idx)}
                  disabled={fields.length <= 2}
                  aria-label={`Remove pair ${idx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 gap-2"
            onClick={() => append({ left: "", right: "" })}
          >
            <Plus className="h-4 w-4" /> Add pair
          </Button>
          {form.formState.errors.pairs && (
            <p className="mt-2 text-xs text-destructive">
              {form.formState.errors.pairs.message as string}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="marks"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Marks</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.25"
                    min="0.25"
                    className="min-h-[44px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="difficultyLevel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Difficulty (1–5)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max="5"
                    className="min-h-[44px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="explanation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Explanation (optional)</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="min-h-[48px] flex-1"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[48px] flex-1"
            onClick={form.handleSubmit((v) => handle(v, true))}
          >
            Save & add another
          </Button>
          <Button
            type="button"
            className="min-h-[48px] flex-1"
            onClick={form.handleSubmit((v) => handle(v, false))}
          >
            Save & done
          </Button>
        </div>
      </form>
    </Form>
  );
}
