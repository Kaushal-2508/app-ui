import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAddQuestionToBank } from "@/hooks/useQuestionBank";

const formSchema = z.object({
  questionText: z.string().min(5, "Question must be at least 5 characters"),
  questionType: z.enum(["mcq", "true_false", "fill_blank", "short_answer", "long_answer", "matching"]),
  correctAnswer: z.string().optional(),
  explanation: z.string().optional(),
  marks: z.number().min(1).max(100),
  difficultyLevel: z.number().min(1).max(5),
  gradeId: z.string().optional(),
  subjectId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface AddQuestionToBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId?: string | null;
  availableGrades?: { id: string; name: string }[];
  /**
   * Phase 3 — when provided, the first dropdown is driven by class_groups
   * (one UUID per parent container, e.g. "Class 12 Commerce"). The selected
   * value is written to `question_bank.class_group_id`, and `grade_level_id`
   * is resolved from the class_group's own grade_level_id. See CLAUDE.md §22.
   */
  availableClassGroups?: { id: string; name: string; gradeLevelId: string | null }[];
  availableSubjects?: { id: string; name: string }[];
}

const questionTypes = [
  { value: "mcq", label: "Multiple Choice" },
  { value: "true_false", label: "True/False" },
  { value: "fill_blank", label: "Fill in Blank" },
  { value: "short_answer", label: "Short Answer" },
  { value: "long_answer", label: "Long Answer" },
  { value: "matching", label: "Matching" },
];

export default function AddQuestionToBankDialog({
  open,
  onOpenChange,
  institutionId,
  availableGrades,
  availableClassGroups,
  availableSubjects,
}: AddQuestionToBankDialogProps) {
  const useClassGroupMode = Array.isArray(availableClassGroups);
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const addQuestion = useAddQuestionToBank();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      questionText: "",
      questionType: "mcq",
      correctAnswer: "",
      explanation: "",
      marks: 1,
      difficultyLevel: 3,
      gradeId: "",
      subjectId: "",
    },
  });

  const questionType = form.watch("questionType");

  const { data: globalGrades } = useQuery({
    queryKey: ["grade-levels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name")
        .eq("is_active", true)
        .order("grade_number");
      if (error) throw error;
      return data || [];
    },
    enabled: !availableGrades && !useClassGroupMode,
  });

  const { data: globalSubjects } = useQuery({
    queryKey: ["universal-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !availableSubjects,
  });

  const grades = useClassGroupMode
    ? (availableClassGroups || []).map(cg => ({ value: cg.id, label: cg.name }))
    : availableGrades
    ? availableGrades.map(g => ({ value: g.id, label: g.name }))
    : (globalGrades?.map(g => ({ value: g.id, label: g.grade_name })) || []);

  const gradeFieldLabel = useClassGroupMode ? "Class" : "Grade Level";
  const gradeFieldPlaceholder = useClassGroupMode ? "Select class" : "Select grade";
  const gradeFieldSearchPlaceholder = useClassGroupMode
    ? "Search classes..."
    : "Search grades...";

  const subjects = availableSubjects
    ? availableSubjects.map(s => ({ value: s.id, label: s.name }))
    : (globalSubjects?.map(s => ({ value: s.id, label: s.name })) || []);

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const onSubmit = async (values: FormValues) => {
    const optionsData = ["mcq", "matching"].includes(values.questionType)
      ? options.filter((o) => o.trim())
      : values.questionType === "true_false"
      ? ["True", "False"]
      : null;

    // In class-group mode the dropdown's id is a class_group_id. Resolve the
    // group's grade_level_id so grade stays populated (NULL is valid but less
    // useful for reporting). Otherwise treat the id as a grade_level_id.
    const selectedId = values.gradeId || undefined;
    const selectedClassGroup = useClassGroupMode && selectedId
      ? availableClassGroups?.find(cg => cg.id === selectedId)
      : undefined;

    await addQuestion.mutateAsync({
      questionText: values.questionText,
      questionType: values.questionType,
      correctAnswer: values.correctAnswer,
      explanation: values.explanation,
      marks: values.marks,
      difficultyLevel: values.difficultyLevel,
      gradeId: useClassGroupMode
        ? (selectedClassGroup?.gradeLevelId || undefined)
        : selectedId,
      classGroupId: useClassGroupMode ? selectedId : undefined,
      subjectId: values.subjectId || undefined,
      institutionId: institutionId || undefined,
      options: optionsData,
      tags,
    });

    form.reset();
    setOptions(["", "", "", ""]);
    setTags([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Question to Bank</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="gradeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{gradeFieldLabel}</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        placeholder={gradeFieldPlaceholder}
                        searchPlaceholder={gradeFieldSearchPlaceholder}
                        options={grades}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="subjectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        placeholder="Select subject"
                        searchPlaceholder="Search subjects..."
                        options={subjects}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="questionType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Question Type</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select type"
                      searchPlaceholder="Search types..."
                      options={questionTypes}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="questionText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Question Text</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter your question..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {questionType === "mcq" && (
              <div className="space-y-2">
                <FormLabel>Options</FormLabel>
                {options.map((option, index) => (
                  <Input
                    key={index}
                    placeholder={`Option ${index + 1}`}
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                  />
                ))}
              </div>
            )}

            <FormField
              control={form.control}
              name="correctAnswer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correct Answer</FormLabel>
                  <FormControl>
                    {questionType === "true_false" ? (
                      <SearchableSelect
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        placeholder="Select answer"
                        searchPlaceholder="Search..."
                        options={[
                          { value: "True", label: "True" },
                          { value: "False", label: "False" },
                        ]}
                      />
                    ) : questionType === "mcq" ? (
                      <SearchableSelect
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        placeholder="Select correct option"
                        searchPlaceholder="Search options..."
                        options={options.filter(o => o.trim()).map((option) => ({
                          value: option,
                          label: option,
                        }))}
                      />
                    ) : (
                      <Textarea
                        placeholder="Enter correct answer..."
                        {...field}
                      />
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="explanation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Explanation (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Explain the answer..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="marks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Marks</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
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
                    <FormLabel>Difficulty: {field.value}</FormLabel>
                    <FormControl>
                      <Slider
                        min={1}
                        max={5}
                        step={1}
                        value={[field.value]}
                        onValueChange={(v) => field.onChange(v[0])}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              <FormLabel>Tags / Keywords</FormLabel>
              <div className="flex gap-2">
                <Input
                  placeholder="Add tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={handleAddTag}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addQuestion.isPending}>
                {addQuestion.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Add Question
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
