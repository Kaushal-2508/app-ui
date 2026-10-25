import { MathText } from "@/components/ui/math-text";
import { OptionChoiceGrid } from "@/components/exam/OptionChoiceGrid";
import { hasOptionImages } from "@/components/exam/optionDisplay";
import type { HybridExamPayload, HybridQuestion, HybridSection } from "@/hooks/useHybridAttempt";

interface HybridQuestionPaperProps {
  exam: HybridExamPayload;
}

interface QuestionOption {
  id?: string;
  text: string;
  isCorrect?: boolean;
  imageUrl?: string | null;
}

interface MatchingPair {
  columnA?: string[];
  columnB?: string[];
}

function normalizeOptions(value: unknown): QuestionOption[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return (value as Array<QuestionOption | string>).map((v, i) =>
      typeof v === "string" ? { id: String(i), text: v } : v,
    );
  }
  return [];
}

function tryMatching(value: unknown): MatchingPair | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.columnA) || !Array.isArray(obj.columnB)) return null;
  return {
    columnA: obj.columnA as string[],
    columnB: obj.columnB as string[],
  };
}

function QuestionBody({ q }: { q: HybridQuestion }) {
  const matching = q.question_type === "matching" ? tryMatching(q.options) : null;
  const options = !matching ? normalizeOptions(q.options) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <MathText
          text={q.question_text || ""}
          as="div"
          className="flex-1 text-sm leading-relaxed text-foreground"
        />
        <span className="shrink-0 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          [{q.marks} mark{q.marks === 1 ? "" : "s"}]
        </span>
      </div>

      {q.image_url && (
        <img
          src={q.image_url}
          alt=""
          className="my-2 max-h-72 rounded-md border border-border object-contain"
        />
      )}

      {/* Image-choice question: the student is comparing pictures on screen
          while writing on paper, so they need them at a readable size. */}
      {options.length > 0 && hasOptionImages(options) && (
        <OptionChoiceGrid options={options} className="ml-1 mt-1" />
      )}

      {options.length > 0 && !hasOptionImages(options) && (
        <ol className="ml-1 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm md:grid-cols-2">
          {options.map((opt, i) => (
            <li key={opt.id ?? i} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">
                {String.fromCharCode(65 + i)}
              </span>
              <MathText text={opt.text} as="span" className="min-w-0 flex-1 text-foreground" />
            </li>
          ))}
        </ol>
      )}

      {matching && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Column A
            </div>
            <ol className="space-y-1">
              {(matching.columnA ?? []).map((row, i) => (
                <li key={i} className="text-foreground">
                  <span className="mr-1 font-medium">{i + 1}.</span>
                  <MathText text={row} as="span" />
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Column B
            </div>
            <ol className="space-y-1">
              {(matching.columnB ?? []).map((row, i) => (
                <li key={i} className="text-foreground">
                  <span className="mr-1 font-medium">{String.fromCharCode(65 + i)}.</span>
                  <MathText text={row} as="span" />
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section, index }: { section: HybridSection; index: number }) {
  const parentQuestions = section.questions.filter((q) => !q.parent_question_id);
  let counter = 0;

  return (
    <section className="space-y-3">
      <header className="border-b border-border pb-2">
        <h3 className="text-base font-semibold text-foreground md:text-lg">
          Section {String.fromCharCode(65 + index)}: {section.title}
        </h3>
        {section.instructions && (
          <p className="mt-1 text-xs text-muted-foreground">{section.instructions}</p>
        )}
      </header>

      <ol className="space-y-4">
        {parentQuestions.map((q) => {
          counter += 1;
          const subQuestions = section.questions.filter(
            (sub) => sub.parent_question_id === q.id,
          );
          return (
            <li key={q.id} className="rounded-md border border-border bg-card p-3">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="font-semibold text-foreground tabular-nums">
                  Q{counter}.
                </span>
                <div className="flex-1">
                  <QuestionBody q={q} />
                </div>
              </div>
              {subQuestions.length > 0 && (
                <ol className="ml-5 mt-3 space-y-3 border-l-2 border-border/50 pl-3">
                  {subQuestions.map((sub, si) => (
                    <li key={sub.id} className="flex items-baseline gap-2">
                      <span className="font-medium text-foreground tabular-nums">
                        ({String.fromCharCode(97 + si)})
                      </span>
                      <div className="flex-1">
                        <QuestionBody q={sub} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function HybridQuestionPaper({ exam }: HybridQuestionPaperProps) {
  return (
    <article className="space-y-6">
      <header className="space-y-1 border-b border-border pb-3">
        <h2 className="text-lg font-bold text-foreground md:text-xl">{exam.title}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {exam.duration_minutes != null && (
            <span>Duration: {exam.duration_minutes} min</span>
          )}
          {exam.total_marks != null && <span>Total marks: {exam.total_marks}</span>}
          {exam.pass_marks != null && <span>Pass marks: {exam.pass_marks}</span>}
        </div>
        {exam.instructions && (
          <p className="mt-2 whitespace-pre-line rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
            {exam.instructions}
          </p>
        )}
        {exam.settings?.sheet_numbering_instruction && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <strong>Sheet numbering:</strong> {exam.settings.sheet_numbering_instruction}
          </p>
        )}
      </header>

      <div className="space-y-6">
        {exam.sections.map((section, i) => (
          <SectionBlock key={section.id} section={section} index={i} />
        ))}
      </div>
    </article>
  );
}
