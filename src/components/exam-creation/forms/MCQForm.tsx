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
import { QuestionImageUpload } from "@/components/ui/question-image-upload";
import { cn } from "@/lib/utils";
import { DiagramField } from "./DiagramField";
import { MarksHeader } from "./MarksHeader";
import {
  sharedMetaSchema,
  buildQuestion,
  makeOption,
  type ManualFormBaseProps,
} from "./formShared";
import { useState } from "react";

const mcqSchema = sharedMetaSchema.extend({
  questionText: z.string().min(3, "Question text is required"),
  optionA: z.string().min(1, "Option A is required"),
  optionB: z.string().min(1, "Option B is required"),
  optionC: z.string().min(1, "Option C is required"),
  optionD: z.string().min(1, "Option D is required"),
  correct: z.enum(["A", "B", "C", "D"], {
    required_error: "Choose a correct answer",
  }),
});

type MCQValues = z.infer<typeof mcqSchema>;

const LETTERS = ["A", "B", "C", "D"] as const;

export function MCQForm({
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
  const initialCorrect =
    initialCorrectIdx >= 0 && initialCorrectIdx < 4
      ? LETTERS[initialCorrectIdx]
      : "A";

  const [imageUrl, setImageUrl] = useState<string | null>(
    initial?.imageUrl ?? null
  );

  // Per-option diagrams. Kept outside react-hook-form for the same reason the
  // question diagram is: they're uploaded async and aren't validated fields.
  const [optionImages, setOptionImages] = useState<Record<string, string | null>>({
    A: initialOptions[0]?.imageUrl ?? null,
    B: initialOptions[1]?.imageUrl ?? null,
    C: initialOptions[2]?.imageUrl ?? null,
    D: initialOptions[3]?.imageUrl ?? null,
  });

  const form = useForm<MCQValues>({
    resolver: zodResolver(mcqSchema),
    defaultValues: {
      marks: Number(initial?.marks ?? defaultMarks),
      difficultyLevel: initial?.difficultyLevel ?? 3,
      explanation: initial?.explanation ?? "",
      questionText: initial?.questionText ?? "",
      optionA: initialOptions[0]?.text ?? "",
      optionB: initialOptions[1]?.text ?? "",
      optionC: initialOptions[2]?.text ?? "",
      optionD: initialOptions[3]?.text ?? "",
      correct: initialCorrect,
    },
  });

  const handle = (values: MCQValues, keepOpen: boolean) => {
    const texts = [values.optionA, values.optionB, values.optionC, values.optionD];
    const options = texts.map((t, i) =>
      makeOption(t, values.correct === LETTERS[i], optionImages[LETTERS[i]])
    );
    const question = buildQuestion(questionType, values, {
      tempId: initial?.tempId,
      questionText: values.questionText,
      options,
      correctAnswer: values.correct,
      imageUrl: imageUrl ?? undefined,
    });
    if (keepOpen) {
      onSaveAnother(question);
      form.reset({
        ...form.getValues(),
        questionText: "",
        optionA: "",
        optionB: "",
        optionC: "",
        optionD: "",
        correct: "A",
        explanation: "",
      });
      setImageUrl(null);
      setOptionImages({ A: null, B: null, C: null, D: null });
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
              <FormLabel>Question</FormLabel>
              <FormControl>
                <MathInput
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="Type the question here…"
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
              <FormLabel>Options (tap the circle to mark correct)</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="space-y-2"
                >
                  {LETTERS.map((letter) => {
                    const name = `option${letter}` as
                      | "optionA"
                      | "optionB"
                      | "optionC"
                      | "optionD";
                    return (
                      <div
                        key={letter}
                        className="rounded-md border border-border bg-card px-3 py-2"
                      >
                        <div className="flex items-start gap-3">
                          <label
                            htmlFor={`mcq-${letter}`}
                            // The circle itself carries the correct-answer
                            // state, so the "Correct" pill can hide on narrow
                            // screens without losing the signal.
                            className={cn(
                              "mt-1.5 flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border text-sm font-semibold",
                              field.value === letter
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-primary/40 bg-primary/5 text-primary",
                            )}
                          >
                            <RadioGroupItem
                              id={`mcq-${letter}`}
                              value={letter}
                              className="sr-only"
                            />
                            {letter}
                          </label>
                          <div className="min-w-0 flex-1">
                            <FormField
                              control={form.control}
                              name={name}
                              render={({ field: optionField, fieldState }) => (
                                <MathInput
                                  id={`mcq-input-${letter}`}
                                  value={optionField.value ?? ""}
                                  onChange={optionField.onChange}
                                  placeholder={`Option ${letter}`}
                                  minHeight={44}
                                  invalid={!!fieldState.error}
                                />
                              )}
                            />
                          </div>
                          {/* Per-option diagram, thumbnail-sized on purpose:
                              four question-sized banners would bury the inputs. */}
                          <div className="mt-0.5">
                            <QuestionImageUpload
                              variant="thumb"
                              imageUrl={optionImages[letter] ?? null}
                              onImageChange={(url) =>
                                setOptionImages((prev) => ({ ...prev, [letter]: url }))
                              }
                              ariaLabel={`option ${letter}`}
                            />
                          </div>
                          {field.value === letter && (
                            <span className="mt-1.5 hidden shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 sm:inline-flex">
                              Correct
                            </span>
                          )}
                        </div>
                      </div>
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
