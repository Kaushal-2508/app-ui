import { ArrowDown, ArrowUp, Circle, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ASK_AT_PRESETS,
  FORM_QUESTION_TYPES,
  FORM_QUESTION_TYPE_LABEL,
  askAtPreset,
  askAtStages,
  formQuestionError,
  moveQuestion,
  newFormQuestion,
  type AskAtPreset,
  type FormQuestion,
  type FormQuestionType,
} from "@/lib/admissions";

/** What the parent will see for an answer. */
const ANSWER_PREVIEW: Partial<Record<FormQuestionType, string>> = {
  short_text: "A short answer",
  long_text: "A longer answer, a few lines",
  number: "A number",
  date: "A date",
};

/**
 * The school's own questions (Naman, 2026-10-12: "like we create a google
 * form"; then "simplify"; then "a little professional, nothing can be
 * understood in this"). Each question is a small labelled form: Question,
 * Answer type, Hint, Asked on, and the Choices of a "Pick one"; a footer
 * with "Must answer", Move up, Move down and Remove. Every control says what
 * it is. Nothing is saved until the settings sheet's Save.
 */
export function FormDesigner({ value, onChange }: { value: FormQuestion[]; onChange: (next: FormQuestion[]) => void }) {
  const update = (i: number, patch: Partial<FormQuestion>) => onChange(value.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const add = () => {
    const q = newFormQuestion("short_text");
    onChange([...value, q]);
    // Focus the new question once it is in the DOM.
    setTimeout(() => document.getElementById(`fd-q-${q.id}`)?.focus(), 0);
  };
  return (
    <div className="space-y-3" data-form-designer="">
      <p className="text-sm text-ink-600">Name, class and phone are always asked. Add anything else this school wants to know; the questions appear in this order.</p>
      {value.length === 0 ? (
        <p className="rounded-xl border border-dashed border-surface-stroke px-3 py-3 text-sm text-ink-500">No questions yet. For example "Mother tongue" or "Sibling in this school?".</p>
      ) : (
        <ol className="space-y-3">
          {value.map((q, i) => {
            const error = formQuestionError(q);
            const n = i + 1;
            const preset = askAtPreset(q.ask_at);
            const qId = `fd-q-${q.id}`;
            const hintId = `fd-h-${q.id}`;
            const typeId = `fd-t-${q.id}`;
            const askId = `fd-a-${q.id}`;
            const setOption = (k: number, text: string) => update(i, { options: q.options.map((o, j) => (j === k ? text : o)) });
            return (
              <li key={q.id} className={cn("overflow-hidden rounded-xl border bg-[hsl(var(--surface-card))]", error ? "border-amber-500/40" : "border-surface-stroke")} data-question={q.id} data-ask={preset}>
                <header className="flex items-center justify-between gap-3 border-b border-surface-stroke bg-muted/40 px-4 py-2">
                  <h4 className="eyebrow">Question {n}</h4>
                  {q.required && <span className="text-[11px] font-medium text-ink-600">Must answer</span>}
                </header>

                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={qId} className="text-ink-700">
                      Question
                    </Label>
                    <Input id={qId} value={q.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="For example: Mother tongue" aria-label={`Question ${n}`} autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={typeId} className="text-ink-700">
                      Answer type
                    </Label>
                    <Select value={q.type} onValueChange={(t) => update(i, { type: t as FormQuestionType, options: t === "choice" ? (q.options.length ? q.options : ["", ""]) : [] })}>
                      <SelectTrigger id={typeId} aria-label={`Type of question ${n}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FORM_QUESTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {FORM_QUESTION_TYPE_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={hintId} className="text-ink-700">
                      Hint <span className="font-normal text-ink-500">(optional)</span>
                    </Label>
                    <Input id={hintId} value={q.help ?? ""} onChange={(e) => update(i, { help: e.target.value || null })} placeholder="Shown under the question" aria-label={`Hint for question ${n}`} autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={askId} className="text-ink-700">
                      Asked on
                    </Label>
                    <Select value={preset} onValueChange={(p) => update(i, { ask_at: askAtStages(p as AskAtPreset, q.ask_at) })}>
                      <SelectTrigger id={askId} aria-label={`Where question ${n} is asked`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASK_AT_PRESETS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                        {preset === "custom" && <SelectItem value="custom">Some places</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>

                  {q.type === "choice" ? (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-ink-700">Choices</Label>
                      <ul className="space-y-1.5" aria-label={`Options of question ${n}`}>
                        {q.options.map((o, k) => (
                          <li key={k} className="flex items-center gap-2">
                            <Circle className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                            <Input value={o} onChange={(e) => setOption(k, e.target.value)} placeholder={`Choice ${k + 1}`} aria-label={`Option ${k + 1} of question ${n}`} autoComplete="off" className="h-9" />
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-500" aria-label={`Remove option ${k + 1} of question ${n}`} onClick={() => update(i, { options: q.options.filter((_, j) => j !== k) })}>
                              <X className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => update(i, { options: [...q.options, ""] })}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Add a choice
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-500 sm:col-span-2">
                      The parent answers with: <span className="text-ink-700">{q.type === "yes_no" ? "Yes or No" : ANSWER_PREVIEW[q.type]}</span>
                    </p>
                  )}
                  {error && <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">{error}</p>}
                </div>

                <footer className="flex items-center gap-1 border-t border-surface-stroke px-4 py-2">
                  <label className="flex items-center gap-2 whitespace-nowrap text-sm text-ink-700">
                    <Switch checked={q.required} onCheckedChange={(v) => update(i, { required: v })} aria-label={`Question ${n} must be answered`} />
                    Must answer
                  </label>
                  <span className="ml-auto flex items-center gap-0.5">
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-ink-600" aria-label={`Move question ${n} up`} disabled={i === 0} onClick={() => onChange(moveQuestion(value, i, -1))}>
                      <ArrowUp className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Move up</span>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-ink-600" aria-label={`Move question ${n} down`} disabled={i === value.length - 1} onClick={() => onChange(moveQuestion(value, i, 1))}>
                      <ArrowDown className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Move down</span>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-ink-600" aria-label={`Remove question ${n}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Remove</span>
                    </Button>
                  </span>
                </footer>
              </li>
            );
          })}
        </ol>
      )}
      <Button type="button" variant="outline" size="sm" className="h-9" onClick={add}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Add a question
      </Button>
    </div>
  );
}
