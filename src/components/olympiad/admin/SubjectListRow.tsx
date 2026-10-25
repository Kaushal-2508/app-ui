import { ChevronRight, Pencil } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";

export function SubjectListRow({
  subject,
  classCount,
  onEdit,
  to,
}: {
  subject: OlympiadSubject;
  classCount: number;
  onEdit?: (s: OlympiadSubject) => void;
  to?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <NavLink
        to={to ?? `/admin/olympiad/subjects/${subject.id}`}
        className="flex-1 flex items-center gap-3 px-4 py-3 surface-card frosted-shadow rounded-card hover:bg-surface-card/80 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-900 truncate">{subject.name}</p>
          <p className="text-xs text-ink-500 mt-0.5">
            {classCount} class{classCount === 1 ? "" : "es"} ·{" "}
            {subject.status === "active" ? "Active" : "Archived"}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
      </NavLink>
      {onEdit && (
        <Button size="icon" variant="ghost" onClick={() => onEdit(subject)} title="Edit subject">
          <Pencil className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
