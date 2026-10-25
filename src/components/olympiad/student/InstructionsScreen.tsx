import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  examDurationMinutes: number;
  onProceed: () => void;
};

const RULES = (durationMin: number) => [
  `The exam is ${durationMin} minutes long.`,
  "It contains questions from 3 subjects shown as tabs at the top.",
  "You can switch between sections freely.",
  "You can mark questions for review and come back to them.",
  "The exam will run in fullscreen. Do not exit fullscreen.",
  "Tab-switching counts as a proctoring violation. 3 violations auto-submit your exam.",
  "If you lose internet briefly, your timer keeps running on the server.",
  "Click I'm Ready when you're prepared to begin. The timer starts immediately after.",
];

export function InstructionsScreen({ examDurationMinutes, onProceed }: Props) {
  return (
    <div className="surface-card frosted-shadow rounded-card p-6 sm:p-8 space-y-5 max-w-2xl mx-auto">
      <header>
        <p className="eyebrow">Read the instructions carefully</p>
        <h2 className="text-xl font-bold text-ink-900 mt-1">Before you begin</h2>
      </header>

      <ul className="space-y-3">
        {RULES(examDurationMinutes).map((rule, i) => (
          <li key={i} className="flex gap-3 text-sm text-ink-700">
            <CheckCircle2 className="h-5 w-5 text-brand-primary flex-shrink-0 mt-0.5" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>

      <Button onClick={onProceed} className="w-full">
        I&apos;m ready
      </Button>
    </div>
  );
}
