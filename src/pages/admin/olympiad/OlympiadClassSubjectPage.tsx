import { NavLink, Outlet, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";

const SUB_TABS = [
  { label: "Topics",         to: ""               },
  { label: "Questions",      to: "questions"      },
  { label: "Study material", to: "study-material" },
] as const;

export default function OlympiadClassSubjectPage() {
  const { gradeLevelId, subjectId } = useParams();
  const { data: subjects, isLoading } = useOlympiadSubjects();
  const subject = subjects?.find((s) => s.id === subjectId);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (!subject) {
    return (
      <div className="py-6 text-sm text-ink-600">
        Subject not found.{" "}
        <NavLink to={`/admin/olympiad/classes/${gradeLevelId}`} className="underline">Back to class</NavLink>.
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      <NavLink to={`/admin/olympiad/classes/${gradeLevelId}`} className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" />
        Back to class
      </NavLink>

      <header>
        <p className="eyebrow">Subject</p>
        <h2 className="text-xl font-semibold text-ink-900">{subject.name}</h2>
        {subject.description && <p className="text-sm text-ink-600 mt-1">{subject.description}</p>}
      </header>

      <nav className="-mx-4 px-4 flex gap-2 overflow-x-auto scrollbar-hide">
        {SUB_TABS.map((t) => (
          <NavLink
            key={t.label}
            end={t.to === ""}
            to={t.to}
            className={({ isActive }) =>
              `inline-flex items-center px-3.5 py-1.5 rounded-full whitespace-nowrap text-xs font-medium transition-colors ${
                isActive ? "bg-brand-primary text-white" : "bg-surface-card text-ink-700 hover:bg-surface-card/80"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ subject, gradeLevelId }} />
    </div>
  );
}
