import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FormQuestion } from "@/lib/admissions";
import { Field, PillGroup } from "./parts";

/**
 * The school's own questions as fields (spec 2026-10-09, section 2; Naman,
 * 2026-10-12). Rendered inside a SectionCard by the caller: each question
 * gets the control its type asks for; a choice of four or fewer is pills,
 * a longer one a dropdown. One question per row (Naman, 2026-10-12: "make
 * these questions vertical"). Answers are strings keyed by question id.
 */
export function CustomQuestions({
  questions,
  values,
  onChange,
  idPrefix,
  disabled = false,
}: {
  questions: FormQuestion[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const set = (id: string, v: string) => onChange({ ...values, [id]: v });
  return (
    <>
      {questions.map((q) => {
        const id = `${idPrefix}-${q.id}`;
        const label = q.required ? q.label : `${q.label} (optional)`;
        const v = values[q.id] ?? "";
        return (
          <Field key={q.id} label={label} htmlFor={q.type === "choice" && q.options.length <= 4 ? undefined : id} hint={q.help ?? undefined} wide>
            {q.type === "short_text" && <Input id={id} value={v} onChange={(e) => set(q.id, e.target.value)} disabled={disabled} autoComplete="off" />}
            {q.type === "long_text" && <Textarea id={id} value={v} onChange={(e) => set(q.id, e.target.value)} rows={3} disabled={disabled} />}
            {q.type === "number" && <Input id={id} type="number" inputMode="decimal" value={v} onChange={(e) => set(q.id, e.target.value)} disabled={disabled} />}
            {q.type === "date" && <Input id={id} type="date" value={v} onChange={(e) => set(q.id, e.target.value)} disabled={disabled} />}
            {q.type === "yes_no" && (
              <PillGroup
                ariaLabel={q.label}
                options={[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                ]}
                value={v}
                onChange={(next) => set(q.id, next)}
                disabled={disabled}
              />
            )}
            {q.type === "choice" &&
              (q.options.length <= 4 ? (
                <PillGroup ariaLabel={q.label} options={q.options.map((o) => ({ value: o, label: o }))} value={v} onChange={(next) => set(q.id, next)} disabled={disabled} />
              ) : (
                <Select value={v} onValueChange={(next) => set(q.id, next)} disabled={disabled}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {q.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
          </Field>
        );
      })}
    </>
  );
}
