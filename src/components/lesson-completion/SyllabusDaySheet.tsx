import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SyllabusProgressGroup } from "./SyllabusProgressGroup";

/**
 * Edit any past day of one class + subject's syllabus log: the same editing
 * box as the check-out and backlog sheets (change, remove, add, swap a chapter
 * for a note), for a day the teacher picks. Opened from the My syllabus page,
 * either on a date a chapter was logged or on "Edit a past day".
 */
export function SyllabusDaySheet({
  open, onOpenChange, classId, subjectId, className, subjectName, date, todayIso,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  subjectId: string;
  className: string;
  subjectName: string;
  /** The day to open on; null opens on today, with the date field to change it. */
  date: string | null;
  /** Device-local today (IST-only deployment, as the week page). */
  todayIso: string;
}) {
  const [picked, setPicked] = useState(date ?? todayIso);
  useEffect(() => {
    if (open) setPicked(date ?? todayIso);
  }, [open, date, todayIso]);

  // The server refuses a future day too; this just says so before it is tried.
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(picked) && picked <= todayIso;
  const fieldId = `syllabus-day-${classId}-${subjectId}`;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${subjectName} · ${className}`}
      subtitle="Change, remove or add what was logged for a day"
      icon={<CalendarDays className="h-4 w-4" />}
      primaryAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={fieldId} className="text-xs font-medium text-ink-700">Day</Label>
          <Input
            id={fieldId}
            type="date"
            value={picked}
            max={todayIso}
            onChange={(e) => setPicked(e.target.value)}
          />
          {!valid && (
            <p className="text-xs text-rose-600 dark:text-rose-300">Pick a day up to today.</p>
          )}
        </div>
        {valid && (
          <SyllabusProgressGroup
            // A fresh box per day, so a half-typed note never carries across.
            key={picked}
            classId={classId}
            subjectId={subjectId}
            className={className}
            subjectName={subjectName}
            date={picked}
            source="correction"
            // The sheet's title already names the class and subject.
            showHeader={false}
            showEnteredOn
          />
        )}
      </div>
    </MobileSheet>
  );
}
