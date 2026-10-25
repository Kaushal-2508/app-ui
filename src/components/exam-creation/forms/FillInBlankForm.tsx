import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MathPreview } from "@/components/ui/math-preview";
import { MathInput } from "@/components/ui/math-input";
import { DiagramField } from "./DiagramField";
import { MarksHeader } from "./MarksHeader";
import {
  sharedMetaSchema,
  buildQuestion,
  type ManualFormBaseProps,
} from "./formShared";
import { useState } from "react";

const fillSchema = sharedMetaSchema.extend({
  questionText: z
    .string()
    .min(3, "Question text is required")
    .refine((v) => v.includes("_"), {
      message: "Use ____ where the blank should appear",
    }),
  correctAnswer: z.string().min(1, "Correct answer is required"),
  alternates: z.string().optional(),
});

type FillValues = z.infer<typeof fillSchema>;

export function FillInBlankForm({
  questionType,
  defaultMarks,
  sectionCurrentTotal,
  sectionTargetTotal,
  initial,
  onSaveDone,
  onSaveAnother,
  onCancel,
}: ManualFormBaseProps) {
  const existingCorrect = (() => {
    const raw = initial?.correctAnswer ?? "";
    const parts = raw.split("|");
    return { primary: parts[0] ?? "", alternates: parts.slice(1).join(", ") };
  })();

  const [imageUrl, setImageUrl] = useState<string | null>(
    initial?.imageUrl ?? null
  );

  const form = useForm<FillValues>({
    resolver: zodResolver(fillSchema),
    defaultValues: {
      marks: Number(initial?.marks ?? defaultMarks),
      difficultyLevel: initial?.difficultyLevel ?? 3,
      explanation: initial?.explanation ?? "",
      questionText: initial?.questionText ?? "",
      correctAnswer: existingCorrect.primary,
      alternates: existingCorrect.alternates,
    },
  });

  const handle = (values: FillValues, keepOpen: boolean) => {
    const alts = (values.alternates ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const serialized = [values.correctAnswer, ...alts].join("|");
    const question = buildQuestion(questionType, values, {
      tempId: initial?.tempId,
      questionText: values.questionText,
      correctAnswer: serialized,
      options: null,
      imageUrl: imageUrl ?? undefined,
    });
    if (keepOpen) {
      onSaveAnother(question);
      form.reset({
        ...form.getValues(),
        questionText: "",
        correctAnswer: "",
        alternates: "",
        explanation: "",
      });
      setImageUrl(null);
    } else {
      onSaveDone(question);
    }
  };

  const marks = form.watch("marks");
  const watchedCorrect = form.watch("correctAnswer");

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
                  placeholder="The capital of France is ____."
                  invalid={!!fieldState.error}
                />
              </FormControl>
              <FormDescription>
                Use four underscores <code>____</code> where the blank should
                appear.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <DiagramField imageUrl={imageUrl} onChange={setImageUrl} />

        <FormField
          control={form.control}
          name="correctAnswer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correct answer</FormLabel>
              <FormControl>
                <Input className="min-h-[44px]" {...field} />
              </FormControl>
              <MathPreview text={watchedCorrect} />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="alternates"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Alternate accepted answers</FormLabel>
              <FormControl>
                <Input
                  className="min-h-[44px]"
                  placeholder="Paris, paris"
                  {...field}
                />
              </FormControl>
              <FormDescription>Comma-separated, case sensitive.</FormDescription>
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
