import { useState } from "react";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { MathInput } from "@/components/ui/math-input";
import { MathText } from "@/components/ui/math-text";
import { DiagramField } from "./DiagramField";
import { MarksHeader } from "./MarksHeader";
import {
  sharedMetaSchema,
  buildQuestion,
  nextTempId,
  type ManualFormBaseProps,
} from "./formShared";
import type { ExamQuestion, QuestionType } from "@/types/exam";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MCQForm } from "./MCQForm";
import { FillInBlankForm } from "./FillInBlankForm";
import { NumericalForm } from "./NumericalForm";

const compSchema = sharedMetaSchema.extend({
  passage: z.string().min(10, "Passage must be at least 10 characters"),
  questionText: z.string().optional(),
});

type CompValues = z.infer<typeof compSchema>;

type SubType = "mcq" | "fill_blank" | "numerical" | "short_answer";

const SUB_TYPE_LABELS: Record<SubType, string> = {
  mcq: "MCQ",
  fill_blank: "Fill in the blank",
  numerical: "Numerical",
  short_answer: "Short answer",
};

export function ComprehensionForm({
  questionType,
  defaultMarks,
  sectionCurrentTotal,
  sectionTargetTotal,
  initial,
  onSaveDone,
  onSaveAnother,
  onCancel,
}: ManualFormBaseProps) {
  // passage is stored in options as [{ id: 'passage', text: '...' }]
  const initialPassage =
    (initial?.options?.find((o) => o.id === "passage")?.text as string) ??
    initial?.questionText ??
    "";

  const [imageUrl, setImageUrl] = useState<string | null>(
    initial?.imageUrl ?? null
  );

  const [subQuestions, setSubQuestions] = useState<ExamQuestion[]>(
    initial?.subQuestions ?? []
  );
  const [subEditor, setSubEditor] = useState<{
    type: SubType;
    index: number | null;
  } | null>(null);

  const form = useForm<CompValues>({
    resolver: zodResolver(compSchema),
    defaultValues: {
      marks: Number(initial?.marks ?? defaultMarks),
      difficultyLevel: initial?.difficultyLevel ?? 3,
      explanation: initial?.explanation ?? "",
      passage: initialPassage,
      questionText: initial?.questionText ?? "",
    },
  });

  const totalSubMarks = subQuestions.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  const handle = (values: CompValues, keepOpen: boolean) => {
    if (subQuestions.length === 0) {
      form.setError("passage", {
        message: "Add at least one sub-question before saving",
      });
      return;
    }
    const question = buildQuestion(questionType, values, {
      tempId: initial?.tempId,
      questionText: values.questionText || "Comprehension",
      options: [{ id: "passage", text: values.passage }],
      correctAnswer: null,
      subQuestions,
      imageUrl: imageUrl ?? undefined,
    });
    // Overwrite marks with the sum of sub-question marks
    question.marks = totalSubMarks || values.marks;
    if (keepOpen) {
      onSaveAnother(question);
      form.reset({
        ...form.getValues(),
        passage: "",
        questionText: "",
        explanation: "",
      });
      setImageUrl(null);
      setSubQuestions([]);
    } else {
      onSaveDone(question);
    }
  };

  const marks = form.watch("marks");

  const handleSubSave = (sub: ExamQuestion) => {
    if (subEditor?.index != null) {
      setSubQuestions((prev) =>
        prev.map((q, i) => (i === subEditor.index ? sub : q))
      );
    } else {
      setSubQuestions((prev) => [...prev, { ...sub, tempId: nextTempId("sub") }]);
    }
    setSubEditor(null);
  };

  const renderSubEditor = () => {
    if (!subEditor) return null;
    const type: QuestionType = subEditor.type;
    const initialSub =
      subEditor.index != null ? subQuestions[subEditor.index] : undefined;

    const sharedProps = {
      questionType: type,
      defaultMarks: 1,
      sectionCurrentTotal: undefined,
      sectionTargetTotal: undefined,
      initial: initialSub,
      onSaveDone: handleSubSave,
      onSaveAnother: handleSubSave,
      onCancel: () => setSubEditor(null),
    };

    switch (subEditor.type) {
      case "mcq":
        return <MCQForm {...sharedProps} />;
      case "fill_blank":
        return <FillInBlankForm {...sharedProps} />;
      case "numerical":
        return <NumericalForm {...sharedProps} />;
      case "short_answer":
        return <FillInBlankForm {...sharedProps} />;
      default:
        return null;
    }
  };

  return (
    <>
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
            name="passage"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Passage</FormLabel>
                <FormControl>
                  <MathInput
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    placeholder="Paste or type the reading passage here…"
                    minHeight={140}
                    invalid={!!fieldState.error}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <DiagramField imageUrl={imageUrl} onChange={setImageUrl} />

          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Sub-questions</div>
                <div className="text-xs text-muted-foreground">
                  {subQuestions.length} added · {totalSubMarks} marks total
                </div>
              </div>
            </div>

            {subQuestions.length > 0 && (
              <ul className="mb-3 space-y-2">
                {subQuestions.map((q, i) => (
                  <li
                    key={q.tempId}
                    className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <MathText as="div" className="truncate text-sm" text={q.questionText} />
                      <div className="text-[11px] text-muted-foreground">
                        {SUB_TYPE_LABELS[q.questionType as SubType] ??
                          q.questionType}{" "}
                        · {q.marks}m
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() =>
                        setSubEditor({
                          type: (q.questionType as SubType) ?? "mcq",
                          index: i,
                        })
                      }
                      aria-label="Edit sub-question"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive"
                      onClick={() =>
                        setSubQuestions((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      aria-label="Delete sub-question"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(SUB_TYPE_LABELS) as SubType[]).map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] justify-start gap-2"
                  onClick={() => setSubEditor({ type: t, index: null })}
                >
                  <Plus className="h-4 w-4" /> {SUB_TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="marks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Total marks</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.25"
                      min="0.25"
                      className="min-h-[44px]"
                      value={totalSubMarks || field.value}
                      onChange={field.onChange}
                      readOnly={totalSubMarks > 0}
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

      <Sheet
        open={subEditor !== null}
        onOpenChange={(open) => {
          if (!open) setSubEditor(null);
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[90vh] overflow-y-auto sm:max-w-xl sm:mx-auto"
        >
          <SheetHeader className="mb-3">
            <SheetTitle>
              {subEditor?.index != null ? "Edit" : "Add"}{" "}
              {subEditor ? SUB_TYPE_LABELS[subEditor.type] : ""} sub-question
            </SheetTitle>
          </SheetHeader>
          {renderSubEditor()}
        </SheetContent>
      </Sheet>
    </>
  );
}
