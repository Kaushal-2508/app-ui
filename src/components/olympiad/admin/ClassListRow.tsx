import { ChevronRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { type OlympiadClass } from "@/hooks/olympiad/useOlympiadClasses";

export function ClassListRow({ klass }: { klass: OlympiadClass }) {
  return (
    <NavLink
      to={`/admin/olympiad/classes/${klass.grade_level_id}`}
      className="flex items-center gap-3 px-4 py-3 surface-card frosted-shadow rounded-card hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-900 truncate">{klass.grade_name}</p>
        <p className="text-xs text-ink-500 mt-0.5">
          {klass.subject_count} subject{klass.subject_count === 1 ? "" : "s"}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
    </NavLink>
  );
}
