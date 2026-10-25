import type { AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";

type Props = {
  subjects: Array<{ id: string; name: string }>;
  questions: AttemptQuestion[];
  activeSubjectId: string;
  onSubjectChange: (subjectId: string) => void;
};

export function ExamSubjectTabs({ subjects, questions, activeSubjectId, onSubjectChange }: Props) {
  return (
    <nav className="flex gap-2 overflow-x-auto scrollbar-hide" role="tablist">
      {subjects.map((s) => {
        const subjectQuestions = questions.filter((q) => q.subject_id === s.id);
        const answered = subjectQuestions.filter((q) => q.selected_answer !== null).length;
        const total = subjectQuestions.length;
        const isActive = s.id === activeSubjectId;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSubjectChange(s.id)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              isActive
                ? "bg-brand-primary text-white"
                : "bg-surface-card text-ink-700 hover:bg-surface-card/80"
            }`}
          >
            {s.name} ({answered}/{total})
          </button>
        );
      })}
    </nav>
  );
}
