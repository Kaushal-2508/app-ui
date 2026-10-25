import { format, parseISO } from "date-fns";
import { NotebookPen, Loader2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { useTeacherPendingSyllabusDays } from "@/hooks/useSyllabusProgress";
import { SyllabusProgressGroup } from "./SyllabusProgressGroup";

/**
 * Non-blocking backlog popup (replaces the login hard-block gate): lists past
 * days whose (class, subject) groups have no jar entry — absent days included.
 * Opened after check-in and from the My Week backlog chip; dismissible; days
 * drop off as their groups are filled.
 */
export function CheckInBacklogSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useTeacherPendingSyllabusDays({ includeToday: false, enabled: open });
  const days = data?.days ?? [];

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Unlogged syllabus"
      subtitle="Fill what you covered on these days"
      icon={<NotebookPen className="h-4 w-4" />}
      secondaryAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your recent days…
        </div>
      ) : isError ? (
        <p className="py-6 text-sm text-ink-500">
          Couldn't load your pending days. You can close this and try again later.
        </p>
      ) : days.length === 0 ? (
        <p className="py-6 text-sm text-ink-500">You're all caught up. Nothing to fill.</p>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <div key={day.date} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-900">
                {format(parseISO(day.date), "EEE, dd MMM")}
              </h3>
              {day.groups.map((g) => (
                <SyllabusProgressGroup
                  key={`${g.class_id}|${g.subject_id}`}
                  classId={g.class_id}
                  subjectId={g.subject_id}
                  className={g.class_name}
                  subjectName={g.subject_name}
                  date={day.date}
                  source="checkin"
                  serverFilled={g.filled}
                  collapseWhenFilled
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </MobileSheet>
  );
}
