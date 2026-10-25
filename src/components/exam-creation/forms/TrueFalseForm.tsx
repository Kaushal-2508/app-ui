import { useForm } from "react-hook-form";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MathInput } from "@/components/ui/math-input";
import { DiagramField } from "./DiagramField";
import { MarksHeader } from "./MarksHeader";
import {
  sharedMetaSchema,
  buildQuestion,
  makeOption,
  type ManualFormBaseProps,
} from "./formShared";
import { useState } from "react";

const trueFalseSchema = sharedMetaSchema.extend({
  questionText: z.string().min(3, "Question text is required"),
  correct: z.enum(["A", "B"], { required_error: "Pick True or False" }),
});

type TrueFalseValues = z.infer<typeof trueFalseSchema>;

const CHOICES = [
  { key: "A", label: "True" },
  { key: "B", label: "False" },
] as const;

export function TrueFalseForm({
  questionType,
  defaultMarks,
  sectionCurrentTotal,
  sectionTargetTotal,
  initial,
  onSaveDone,
  onSaveAnother,
  onCancel,
}: ManualFormBaseProps) {
  const initialOptions = initial?.options ?? [];
  const initialCorrectIdx = initialOptions.findIndex((o) => o.isCorrect);
  const initialCorrect: "A" | "B" =
    initialCorrectIdx === 1 ? "B" : initialCorrectIdx === 0 ? "A" : "A";

  const [imageUrl, setImageUrl] = useState<string | null>(
    initial?.imageUrl ?? null
  );

  const form = useForm<TrueFalseValues>({
    resolver: zodResolver(trueFalseSchema),
    defaultValues: {
      marks: Number(initial?.marks ?? defaultMarks),
      difficultyLevel: initial?.difficultyLevel ?? 3,
      explanation: initial?.explanation ?? "",
      questionText: initial?.questionText ?? "",
      correct: initialCorrect,
    },
  });

  const handle = (values: TrueFalseValues, keepOpen: boolean) => {
    const options = CHOICES.map((c) =>
      makeOption(c.label, values.correct === c.key)
    );
    const question = buildQuestion(questionType, values, {
      tempId: initial?.tempId,
      questionText: values.questionText,
      options,
      correctAnswer: values.correct === "A" ? "True" : "False",
      imageUrl: imageUrl ?? undefined,
    });
    if (keepOpen) {
      onSaveAnother(question);
      form.reset({
        ...form.getValues(),
        questionText: "",
        correct: "A",
        explanation: "",
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
              <FormLabel>Statement</FormLabel>
              <FormControl>
                <MathInput
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="Type the statement students will judge…"
                  invalid={!!fieldState.error}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DiagramField imageUrl={imageUrl} onChange={setImageUrl} />

        <FormField
          control={form.control}
          name="correct"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correct answer</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid grid-cols-2 gap-3"
                >
                  {CHOICES.map((c) => {
                    const selected = field.value === c.key;
                    return (
                      <label
                        key={c.key}
                        htmlFor={`tf-${c.key}`}
                        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold transition-colors ${
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-foreground hover:bg-muted/40"
                        }`}
                      >
                        <RadioGroupItem
                          id={`tf-${c.key}`}
                          value={c.key}
                          className="sr-only"
                        />
                        {c.label}
                      </label>
                    );
                  })}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                <Textarea
                  rows={2}
                  placeholder="Shown to students after results"
                  {...field}
                />
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
