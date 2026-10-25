import { ChevronRight, ExternalLink } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { OlympiadSchoolRow } from "@/hooks/olympiad/useOlympiadSchools";

const STATUS_STYLE: Record<string, string> = {
  enrollment_open:    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  enrollment_closed:  "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  batches_scheduled:  "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  exam_in_progress:   "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300",
  results_published:  "bg-slate-200 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
  archived:           "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400",
};

const STATUS_LABEL: Record<string, string> = {
  enrollment_open:    "Open",
  enrollment_closed:  "Closed",
  batches_scheduled:  "Scheduled",
  exam_in_progress:   "In Progress",
  results_published:  "Published",
  archived:           "Archived",
};

export function SchoolListRow({ school }: { school: OlympiadSchoolRow }) {
  return (
    <NavLink
      to={`/admin/olympiad/schools/${school.id}`}
      className="flex items-center gap-3 px-4 py-3 surface-card frosted-shadow rounded-card hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-ink-900 truncate">{school.institution_name}</p>
          {school.is_existing_salci_school && (
            <ExternalLink className="h-3 w-3 text-ink-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-ink-500 mt-0.5">
          {school.school_short_code} · {school.enrolled_count} enrolled
          {school.city ? ` · ${school.city}` : ""}
        </p>
      </div>
      <Badge className={`text-[10px] ${STATUS_STYLE[school.status] ?? ""}`} variant="secondary">
        {STATUS_LABEL[school.status] ?? school.status}
      </Badge>
      <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
    </NavLink>
  );
}
