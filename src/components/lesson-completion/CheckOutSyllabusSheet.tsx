import { LogOut, Loader2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { useTeacherPendingSyllabusDays } from "@/hooks/useSyllabusProgress";
import { SyllabusProgressGroup } from "./SyllabusProgressGroup";

/**
 * Opened for teachers right AFTER their staff check-out has been recorded: one
 * group per (class, subject) taught today, each taking a chapter entry
 * (Completed/Partial) or a note. It never blocks anything. Closing it (Done,
 * the X, the overlay) just closes it; whatever was saved stays saved, and a
 * group left unfilled resurfaces in CheckInBacklogSheet at the next check-in.
 *
 * Until 2026-09-11 this was CheckOutLessonGate: the check-out ran only once
 * every group was filled, so a teacher who could not fill one (a planned
 * chapter blocked the note, an RPC error, no chapters configured) could not
 * go home. The check-out now happens on the button and this is a prompt.
 */
export function CheckOutSyllabusSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useTeacherPendingSyllabusDays({ includeToday: true, enabled: open });

  // A day is listed only while ≥1 group is unfilled, so today absent from
  // `days` ⇒ everything's recorded (or there were no teaching periods today).
  const todayDay = data?.days.find((d) => d.is_today) ?? null;
  const groups = todayDay?.groups ?? [];

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="You're checked out"
      subtitle="Log today's syllabus progress"
      icon={<LogOut className="h-4 w-4" />}
      primaryAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking today's classes…
        </div>
      ) : isError ? (
        <p className="py-6 text-sm text-ink-500">
          Couldn't load today's classes. You'll be asked to fill them at your next check-in.
        </p>
      ) : todayDay && groups.length > 0 ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <SyllabusProgressGroup
              key={`${g.class_id}|${g.subject_id}`}
              classId={g.class_id}
              subjectId={g.subject_id}
              className={g.class_name}
              subjectName={g.subject_name}
              date={todayDay.date}
              source="checkout"
              serverFilled={g.filled}
              collapseWhenFilled
            />
          ))}
        </div>
      ) : (
        <p className="py-6 text-sm text-ink-500">Nothing to log today. You're all set.</p>
      )}
    </MobileSheet>
  );
}
