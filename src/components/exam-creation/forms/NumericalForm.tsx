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
import { MathInput } from "@/components/ui/math-input";
import { DiagramField } from "./DiagramField";
import { MarksHeader } from "./MarksHeader";
import {
  sharedMetaSchema,
  buildQuestion,
  type ManualFormBaseProps,
} from "./formShared";
import { useState } from "react";

const numericalSchema = sharedMetaSchema
  .extend({
    questionText: z.string().min(3, "Question text is required"),
    correctAnswer: z.coerce.number({
      invalid_type_error: "Correct answer must be numeric",
    }),
    rangeMin: z.coerce.number(),
    rangeMax: z.coerce.number(),
  })
  .refine((v) => v.rangeMin <= v.rangeMax, {
    path: ["rangeMax"],
    message: "Max must be greater than or equal to min",
  })
  .refine((v) => v.correctAnswer >= v.rangeMin && v.correctAnswer <= v.rangeMax, {
    path: ["correctAnswer"],
    message: "Correct answer must fall within the accepted range",
  });

type NumericalValues = z.infer<typeof numericalSchema>;

interface NumericalOptions {
  min: number;
  max: number;
  value: number;
}

export function NumericalForm({
  questionType,
  defaultMarks,
  sectionCurrentTotal,
  sectionTargetTotal,
  initial,
  onSaveDone,
  onSaveAnother,
  onCancel,
}: ManualFormBaseProps) {
  const initialOpts = (initial?.options as unknown as NumericalOptions) ?? null;

  const [imageUrl, setImageUrl] = useState<string | null>(
    initial?.imageUrl ?? null
  );

  const form = useForm<NumericalValues>({
    resolver: zodResolver(numericalSchema),
    defaultValues: {
      marks: Number(initial?.marks ?? defaultMarks),
      difficultyLevel: initial?.difficultyLevel ?? 3,
      explanation: initial?.explanation ?? "",
      questionText: initial?.questionText ?? "",
      correctAnswer: initialOpts?.value ?? Number(initial?.correctAnswer ?? 0),
      rangeMin: initialOpts?.min ?? Number(initial?.correctAnswer ?? 0),
      rangeMax: initialOpts?.max ?? Number(initial?.correctAnswer ?? 0),
    },
  });

  const handle = (values: NumericalValues, keepOpen: boolean) => {
    // Stash the range on `options` as a JSON bag so the DB row still matches
    // the existing options:jsonb column shape.
    const optionsJson = [
      { id: "num-answer", text: String(values.correctAnswer), isCorrect: true },
      { id: "num-min", text: String(values.rangeMin) },
      { id: "num-max", text: String(values.rangeMax) },
    ];
    const question = buildQuestion(questionType, values, {
      tempId: initial?.tempId,
      questionText: values.questionText,
      correctAnswer: String(values.correctAnswer),
      options: optionsJson,
      imageUrl: imageUrl ?? undefined,
    });
    if (keepOpen) {
      onSaveAnother(question);
      form.reset({
        ...form.getValues(),
        questionText: "",
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
          name="correctAnswer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correct answer</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="any"
                  className="min-h-[44px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="rangeMin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Acceptable min</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="any"
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
            name="rangeMax"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Acceptable max</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="any"
                    className="min-h-[44px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormDescription>
          Students whose answer falls inside [min, max] will be marked correct.
          Set min = max for an exact-match answer.
        </FormDescription>

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
