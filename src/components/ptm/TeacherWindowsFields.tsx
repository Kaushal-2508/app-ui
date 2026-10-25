import { Label } from "@/components/ui/label";
import { HoursRow, type HoursValue } from "./HoursRow";

export type TeacherWindow = HoursValue;

interface Props {
  teachers: { id: string; name: string }[];
  /** The meeting's own window; a teacher's hours must sit inside it. */
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  slotBufferMinutes: number;
  /** Teachers with their own hours; absent = the meeting's hours. */
  value: Record<string, TeacherWindow>;
  onChange: (teacherId: string, next: TeacherWindow | null) => void;
}

/**
 * Per-teacher hours inside an online PTM (Naman, 2026-10-06: "admin can also
 * choose the slot of teachers, like from 12 to 3:00 one teacher"). Every
 * teacher starts on the meeting's hours; "Own hours" opens a start and end
 * for that teacher, "Meeting hours" puts them back. Families of a teacher
 * with own hours see only those slots. Since the class sessions of the same
 * day the admin's create form sets hours per CLASS box instead; this list
 * stays for the flat teacher list (edit flows below the `sessions` probe).
 */
export function TeacherWindowsFields({
  teachers,
  startTime,
  endTime,
  slotDurationMinutes,
  slotBufferMinutes,
  value,
  onChange,
}: Props) {
  if (teachers.length === 0 || !startTime || !endTime) return null;
  const meeting = { startTime, endTime, slotDurationMinutes, slotBufferMinutes };

  return (
    <div className="space-y-2">
      <Label>Teachers' hours</Label>
      <ul className="divide-y divide-surface-stroke rounded-xl border border-surface-stroke">
        {teachers.map((t) => (
          <li key={t.id} className="px-3 py-2">
            <HoursRow
              idPrefix={`tw-${t.id}`}
              title={t.name}
              meeting={meeting}
              value={value[t.id] ?? null}
              onChange={(next) => onChange(t.id, next)}
            />
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-500">Leave a teacher on the meeting hours unless they are free for only part of it.</p>
    </div>
  );
}
