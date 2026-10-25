import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Loader2, Trash2, Info } from "lucide-react";
import { useUpdateQuestionBank, QuestionBankItem } from "@/hooks/useQuestionBank";
import type { Database, Json } from "@/integrations/supabase/types";
import { QuestionImageUpload } from "@/components/ui/question-image-upload";

type DbQuestionType = Database["public"]["Enums"]["question_type"];

interface EditQuestionBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: QuestionBankItem | null;
}

// Same vocabulary as the question bank list / exam creation chips.
// Comprehension and Case Study are listed for visibility but the editor
// for those keeps it conservative — sub-questions are edited as their
// own rows, not from inside the parent dialog.
const QUESTION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "mcq", label: "MCQ" },
  { value: "true_false", label: "True / False" },
  { value: "fill_blank", label: "Fill in Blank" },
  { value: "match_column", label: "Match Column" },
  { value: "short_answer", label: "Short Answer" },
  { value: "long_answer", label: "Long Answer" },
  { value: "comprehension", label: "Comprehension" },
];

type McqOption = { id: string; text: string; imageUrl?: string | null };

function parseMcqOptions(raw: unknown): McqOption[] {
  // The AI generator and ManualQuestionForm both store MCQ options as
  // [{id, text}, ...]. Older imports may have stored a plain string[].
  // Normalise here to the object shape.
  //
  // imageUrl must survive this round-trip: this dialog rebuilds the options
  // array on save, so anything not read here is silently dropped the first
  // time an admin edits a question that has per-option diagrams.
  if (Array.isArray(raw)) {
    return raw.map((entry, idx) => {
      if (entry && typeof entry === "object") {
        const o = entry as { id?: string; text?: string; imageUrl?: unknown };
        return {
          id: o.id ?? String.fromCharCode(97 + idx),
          text: typeof o.text === "string" ? o.text : "",
          imageUrl: typeof o.imageUrl === "string" && o.imageUrl ? o.imageUrl : null,
        };
      }
      return {
        id: String.fromCharCode(97 + idx),
        text: typeof entry === "string" ? entry : "",
        imageUrl: null,
      };
    });
  }
  return [];
}

function ensureFourOptions(opts: McqOption[]): McqOption[] {
  const out = [...opts];
  for (let i = out.length; i < 4; i++) {
    out.push({ id: String.fromCharCode(97 + i), text: "" });
  }
  return out;
}

type MatchPayload = { columnA: string[]; columnB: string[]; matches: string };

function parseMatchAnswer(raw: string | null | undefined): MatchPayload {
  const fallback: MatchPayload = { columnA: ["", ""], columnB: ["", ""], matches: "" };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<MatchPayload>;
    return {
      columnA: Array.isArray(parsed.columnA) && parsed.columnA.length > 0
        ? parsed.columnA.map((c) => String(c))
        : fallback.columnA,
      columnB: Array.isArray(parsed.columnB) && parsed.columnB.length > 0
        ? parsed.columnB.map((c) => String(c))
        : fallback.columnB,
      matches: typeof parsed.matches === "string" ? parsed.matches : "",
    };
  } catch {
    return fallback;
  }
}

export default function EditQuestionBankDialog({
  open,
  onOpenChange,
  question,
}: EditQuestionBankDialogProps) {
  const updateQuestion = useUpdateQuestionBank();

  // Top-level form state
  const [questionType, setQuestionType] = useState<DbQuestionType>("mcq");
  const [questionText, setQuestionText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [marks, setMarks] = useState(1);
  const [difficulty, setDifficulty] = useState(3);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Per-type editor state
  const [mcqOptions, setMcqOptions] = useState<McqOption[]>(ensureFourOptions([]));
  const [mcqCorrect, setMcqCorrect] = useState<string>("a");
  const [tfCorrect, setTfCorrect] = useState<"True" | "False">("True");
  const [shortFillAnswer, setShortFillAnswer] = useState("");
  const [match, setMatch] = useState<MatchPayload>({ columnA: ["", ""], columnB: ["", ""], matches: "" });

  const isParent = question
    ? question.question_type === "comprehension" ||
      (question.question_type === "long_answer" &&
        ((question as { sub_question_count?: number | null }).sub_question_count ?? 0) > 0)
    : false;

  // Hydrate from `question` whenever the dialog opens with a new row.
  useEffect(() => {
    if (!question) return;

    setQuestionText(question.question_text);
    setExplanation(question.explanation ?? "");
    setMarks(question.marks);
    setDifficulty(question.difficulty_level);
    setTags(question.tags ?? []);
    setTagInput("");

    const dbType = question.question_type as DbQuestionType;
    setQuestionType(dbType);

    // Reset per-type state so previously-loaded values don't leak.
    setMcqOptions(ensureFourOptions(parseMcqOptions(question.options)));
    setMcqCorrect((question.correct_answer ?? "a").toLowerCase());
    setTfCorrect(question.correct_answer === "False" ? "False" : "True");
    setShortFillAnswer(question.correct_answer ?? "");
    setMatch(parseMatchAnswer(question.correct_answer));
  }, [question]);

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]);
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) =>
    setTags(tags.filter((t) => t !== tag));

  // Build the (options, correct_answer) pair the way each type expects it.
  const buildTypeFields = (): { options: Json | null; correct_answer: string | null } => {
    switch (questionType) {
      case "mcq": {
        const trimmed = mcqOptions
          .map((o, idx) => ({
            id: o.id || String.fromCharCode(97 + idx),
            text: o.text.trim(),
            // Omitted when absent so options without an image keep the exact
            // JSONB shape they had before per-option images existed.
            ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
          }))
          // An option that carries only an image is still a real choice, so it
          // must not be filtered out for having empty text.
          .filter((o) => o.text || o.imageUrl);
        return {
          options: trimmed as unknown as Json,
          correct_answer: (mcqCorrect || "").toLowerCase() || null,
        };
      }
      case "true_false":
        return {
          options: [
            { id: "t", text: "True" },
            { id: "f", text: "False" },
          ] as unknown as Json,
          correct_answer: tfCorrect,
        };
      case "fill_blank":
        return {
          options: null,
          correct_answer: shortFillAnswer.trim() || null,
        };
      case "match_column":
      case "matching": {
        const colA = match.columnA.map((s) => s.trim()).filter(Boolean);
        const colB = match.columnB.map((s) => s.trim()).filter(Boolean);
        return {
          options: colA.map((text, i) => ({ id: String(i + 1), text })) as unknown as Json,
          correct_answer: JSON.stringify({
            columnA: colA,
            columnB: colB,
            matches: match.matches.trim(),
          }),
        };
      }
      // short_answer / long_answer / comprehension / numerical: a free-text
      // sample answer is allowed but optional. No options.
      default:
        return {
          options: null,
          correct_answer: shortFillAnswer.trim() || null,
        };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question) return;
    if (questionText.trim().length < 5) return;

    const { options, correct_answer } = buildTypeFields();

    await updateQuestion.mutateAsync({
      id: question.id,
      updates: {
        question_text: questionText,
        question_type: questionType,
        options,
        correct_answer,
        explanation: explanation.trim() || null,
        marks,
        difficulty_level: difficulty,
        tags,
      },
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Question</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Question Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Question Type</label>
            <SearchableSelect
              value={questionType}
              onValueChange={(v) => setQuestionType(v as DbQuestionType)}
              placeholder="Select type"
              searchPlaceholder="Search types..."
              options={QUESTION_TYPE_OPTIONS}
            />
          </div>

          {/* Parent-row banner (Comprehension / Case Study) */}
          {isParent && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 p-3 text-sm text-violet-900 dark:text-violet-200 flex gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                This is a parent passage with sub-questions. Edit the passage
                text below; sub-questions are edited from their own rows in
                the question list.
              </div>
            </div>
          )}

          {/* Question / Passage text */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {isParent ? "Passage" : "Question Text"}
            </label>
            <Textarea
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              className="min-h-[100px]"
              placeholder={isParent ? "Enter the passage..." : "Enter your question..."}
              required
            />
          </div>

          {/* Per-type editors */}
          {questionType === "mcq" && (
            <McqEditor
              options={mcqOptions}
              setOptions={setMcqOptions}
              correct={mcqCorrect}
              setCorrect={setMcqCorrect}
            />
          )}

          {questionType === "true_false" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Correct Answer</label>
              <SearchableSelect
                value={tfCorrect}
                onValueChange={(v) => setTfCorrect(v === "False" ? "False" : "True")}
                placeholder="Select answer"
                searchPlaceholder="Search..."
                options={[
                  { value: "True", label: "True" },
                  { value: "False", label: "False" },
                ]}
              />
            </div>
          )}

          {questionType === "fill_blank" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Answer</label>
              <Input
                value={shortFillAnswer}
                onChange={(e) => setShortFillAnswer(e.target.value)}
                placeholder="The expected fill-in answer"
              />
            </div>
          )}

          {(questionType === "match_column" || questionType === "matching") && (
            <MatchColumnEditor value={match} onChange={setMatch} />
          )}

          {(questionType === "short_answer" ||
            questionType === "long_answer" ||
            questionType === "numerical") && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Sample / Expected Answer (optional)
              </label>
              <Textarea
                value={shortFillAnswer}
                onChange={(e) => setShortFillAnswer(e.target.value)}
                placeholder={
                  isParent
                    ? "Optional: guidance for evaluators"
                    : "Optional: used as a reference for evaluators or AI grading"
                }
              />
            </div>
          )}

          {/* Explanation */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Explanation (Optional)</label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Explain the answer..."
            />
          </div>

          {/* Marks + Difficulty */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Marks</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={marks}
                onChange={(e) => setMarks(Number(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Difficulty: {difficulty}</label>
              <Slider
                min={1}
                max={5}
                step={1}
                value={[difficulty]}
                onValueChange={(v) => setDifficulty(v[0])}
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tags / Keywords</label>
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

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateQuestion.isPending}>
              {updateQuestion.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Per-type editors ----------

function McqEditor({
  options,
  setOptions,
  correct,
  setCorrect,
}: {
  options: McqOption[];
  setOptions: (next: McqOption[]) => void;
  correct: string;
  setCorrect: (next: string) => void;
}) {
  const setOptionText = (idx: number, text: string) => {
    const next = options.map((o, i) => (i === idx ? { ...o, text } : o));
    setOptions(next);
  };

  const setOptionImage = (idx: number, imageUrl: string | null) => {
    setOptions(options.map((o, i) => (i === idx ? { ...o, imageUrl } : o)));
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Options</label>
      <div className="space-y-2">
        {options.map((opt, idx) => {
          const isCorrect = (correct || "").toLowerCase() === opt.id.toLowerCase();
          return (
            <div key={opt.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCorrect(opt.id)}
                className={
                  "h-6 w-6 rounded-full border-2 flex items-center justify-center text-xs font-semibold shrink-0 " +
                  (isCorrect
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/60")
                }
                aria-label={`Mark option ${opt.id.toUpperCase()} correct`}
                title="Mark correct"
              >
                {opt.id.toUpperCase()}
              </button>
              <Input
                value={opt.text}
                onChange={(e) => setOptionText(idx, e.target.value)}
                placeholder={`Option ${opt.id.toUpperCase()}`}
              />
              <QuestionImageUpload
                variant="thumb"
                imageUrl={opt.imageUrl ?? null}
                onImageChange={(url) => setOptionImage(idx, url)}
                ariaLabel={`option ${opt.id.toUpperCase()}`}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Tap the letter circle to mark the correct option.
      </p>
    </div>
  );
}

function MatchColumnEditor({
  value,
  onChange,
}: {
  value: MatchPayload;
  onChange: (next: MatchPayload) => void;
}) {
  const setColA = (i: number, v: string) => {
    const next = [...value.columnA];
    next[i] = v;
    onChange({ ...value, columnA: next });
  };
  const setColB = (i: number, v: string) => {
    const next = [...value.columnB];
    next[i] = v;
    onChange({ ...value, columnB: next });
  };
  const addRow = () =>
    onChange({
      ...value,
      columnA: [...value.columnA, ""],
      columnB: [...value.columnB, ""],
    });
  const removeRow = (i: number) =>
    onChange({
      ...value,
      columnA: value.columnA.filter((_, idx) => idx !== i),
      columnB: value.columnB.filter((_, idx) => idx !== i),
    });

  const rowCount = Math.max(value.columnA.length, value.columnB.length, 2);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">Column A</label>
        </div>
        <div>
          <label className="text-sm font-medium">Column B</label>
        </div>
      </div>
      {Array.from({ length: rowCount }).map((_, i) => (
        <div key={i} className="grid grid-cols-2 gap-3 items-start">
          <Input
            value={value.columnA[i] ?? ""}
            onChange={(e) => setColA(i, e.target.value)}
            placeholder={`A${i + 1}`}
          />
          <div className="flex items-center gap-2">
            <Input
              value={value.columnB[i] ?? ""}
              onChange={(e) => setColB(i, e.target.value)}
              placeholder={`B${i + 1}`}
            />
            {rowCount > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(i)}
                aria-label={`Remove row ${i + 1}`}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-1" /> Add row
      </Button>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Correct Mapping</label>
        <Input
          value={value.matches}
          onChange={(e) => onChange({ ...value, matches: e.target.value })}
          placeholder="e.g. A1→B3, A2→B1, A3→B2"
        />
        <p className="text-xs text-muted-foreground">
          Use the format <code>A1→B3, A2→B1, …</code> matching the rows above.
        </p>
      </div>
    </div>
  );
}
