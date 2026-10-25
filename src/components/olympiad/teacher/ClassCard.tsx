// src/components/olympiad/teacher/ClassCard.tsx
import { ChevronRight, Users } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { AssignedClass } from "@/hooks/olympiad/useOlympiadAssignedClasses";

export function ClassCard({ cls }: { cls: AssignedClass }) {
  return (
    <NavLink
      to={`/teacher/olympiad/classes/${cls.oly_school_id}/${cls.grade_level_id}`}
      className="block surface-card frosted-shadow rounded-card p-4 hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-900 truncate">{cls.grade_name}</p>
          <p className="text-[11px] text-ink-500 mt-0.5 truncate">
            {cls.institution_name} · {cls.school_short_code}
          </p>
          <div className="flex items-center gap-1 mt-2 text-xs text-ink-700">
            <Users className="h-3.5 w-3.5" />
            <span>
              {cls.enrolled_count} student{cls.enrolled_count === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
      </div>
    </NavLink>
  );
}
