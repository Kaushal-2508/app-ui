import { useMemo } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { cn } from "@/lib/utils";
import type { PTMHat } from "@/lib/ptm";
import {
  newClassSession,
  teacherAvailability,
  type BusyLike,
  type ClassSessionDraft,
  type ClassSessionIssue,
  type MeetingHours,
} from "@/lib/ptmClassSessions";
import type { PTMOnlineTeacherOption } from "@/hooks/ptm";
import { HoursRow } from "./HoursRow";
import { ParticipatingTeacherPicker } from "./ParticipatingTeacherPicker";

/** A teacher row of `notice_class_staff`: enough to filter the hat's list. */
export interface AssignedTeacher {
  user_id: string;
  full_name: string | null;
}

/** What the editor needs per class from `useNoticeClassStaffPerClass`. */
export interface ClassStaffLookup {
  teachersOf: Record<string, AssignedTeacher[] | undefined>;
  loading: Record<string, boolean>;
  errored: Record<string, boolean>;
  refetch: (classId: string) => void;
}

interface SharedProps {
  hat: PTMHat;
  meeting: MeetingHours;
  /** The PTM's date; "" before it is picked (no busy check then). */
  date: string;
  busy: BusyLike[];
  /** Every teacher the hat may invite: names and the Google flag. */
  teacherOptions: PTMOnlineTeacherOption[] | undefined;
  teacherOptionsLoading: boolean;
  teacherOptionsError: boolean;
  onRetryTeacherOptions: () => void;
  staff: ClassStaffLookup;
  classLabel: (classId: string) => string;
  onSetGoogleEmail?: (teacherId: string, name: string) => void;
}

interface BoxProps extends SharedProps {
  draft: ClassSessionDraft;
  sessions: ClassSessionDraft[];
  issues: ClassSessionIssue[];
  onChange: (next: ClassSessionDraft) => void;
  onRemove: () => void;
}

/**
 * One class of an admin-made online PTM (Naman, 2026-10-06: "when a single
 * class is chosen a new box appears with the teachers of that class"): its
 * hours inside the meeting and its teachers. Students are never picked here
 * ("give this option in hand of teachers"): the session's teachers pick
 * them afterwards from the PTM's Edit (a student may be with several of
 * them, 2026-10-09). A teacher already in
 * another box at an overlapping time, or busy in another PTM then, is greyed
 * with the reason; one free at another time shows "Also in ...". Errors
 * that block Create sit under the box.
 */
export function ClassSessionBox({
  hat,
  draft,
  sessions,
  meeting,
  date,
  busy,
  teacherOptions,
  teacherOptionsLoading,
  teacherOptionsError,
  onRetryTeacherOptions,
  staff,
  classLabel,
  issues,
  onChange,
  onRemove,
  onSetGoogleEmail,
}: BoxProps) {
  const label = classLabel(draft.classId);
  const assigned = staff.teachersOf[draft.classId];
  const assignedIds = useMemo(() => new Set((assigned ?? []).map((t) => t.user_id)), [assigned]);
  const options = useMemo(
    () => (assigned ? (teacherOptions ?? []).filter((t) => assignedIds.has(t.teacher_id)) : undefined),
    [assigned, teacherOptions, assignedIds],
  );

  const availability = (teacherId: string) =>
    teacherAvailability({ teacherId, classId: draft.classId, sessions, meeting, date, busy, classLabel });

  // The hours error shows inside the row; the rest under the box.
  const shown = issues.filter((i) => i.kind !== "hours");

  return (
    <div className="space-y-3 rounded-xl border border-surface-stroke p-3" data-class-box={draft.classId}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-ink-900">{label}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-ink-500"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <HoursRow
        idPrefix={`cs-${draft.classId}`}
        meeting={meeting}
        value={draft.startTime || draft.endTime ? { startTime: draft.startTime, endTime: draft.endTime } : null}
        onChange={(next) => onChange({ ...draft, startTime: next?.startTime ?? "", endTime: next?.endTime ?? "" })}
      />
      <div className="space-y-1.5">
        <Label>Teachers</Label>
        <ParticipatingTeacherPicker
          options={options}
          busy={undefined}
          isLoading={teacherOptionsLoading || !!staff.loading[draft.classId]}
          isError={teacherOptionsError || !!staff.errored[draft.classId]}
          onRetry={() => {
            onRetryTeacherOptions();
            staff.refetch(draft.classId);
          }}
          emptyText="No teacher is assigned to this class yet."
          value={draft.teacherIds}
          onChange={(next) => onChange({ ...draft, teacherIds: next })}
          disabledReason={(id) => {
            // `=== false`: strictNullChecks is off, so `!a.ok` does not narrow.
            const a = availability(id);
            return a.ok === false ? a.text : null;
          }}
          noteFor={(id) => {
            const a = availability(id);
            return a.ok === true ? a.note : null;
          }}
          missingList={false}
          onSetGoogleEmail={hat === "admin" ? onSetGoogleEmail : undefined}
        />
      </div>
      {shown.length > 0 && (
        <ul className="space-y-1 text-xs text-rose-600 dark:text-rose-400" aria-live="polite">
          {shown.map((i, n) => (
            <li key={`${i.kind}-${n}`}>{i.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface EditorProps extends SharedProps {
  classOptions: SearchableSelectOption[];
  classesLoading: boolean;
  classesError: boolean;
  drafts: ClassSessionDraft[];
  onChange: (next: ClassSessionDraft[]) => void;
  issues: ClassSessionIssue[];
}

/**
 * The Class multi-select and one ClassSessionBox per chosen class, in the
 * order of the class list. Shared by step 2 of the create sheet and the
 * "Classes and teachers" sheet of an existing PTM. Ticking a class adds a
 * box on the meeting's hours; unticking drops it (case 8), which frees its
 * teachers everywhere else.
 */
export function ClassSessionsEditor({
  classOptions,
  classesLoading,
  classesError,
  drafts,
  onChange,
  issues,
  ...shared
}: EditorProps) {
  const order = useMemo(() => new Map(classOptions.map((o, i) => [o.value, i])), [classOptions]);
  const sorted = useMemo(
    () => [...drafts].sort((a, b) => (order.get(a.classId) ?? 999) - (order.get(b.classId) ?? 999)),
    [drafts, order],
  );
  const setClasses = (next: string[]) => {
    const keep = new Map(drafts.map((d) => [d.classId, d]));
    onChange(next.map((id) => keep.get(id) ?? newClassSession(id)));
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Classes</Label>
        {classesLoading ? (
          <p className="text-sm text-ink-500">Loading classes…</p>
        ) : classesError ? (
          <p className="text-sm text-ink-600">Couldn't load your classes. Close and reopen this form.</p>
        ) : classOptions.length === 0 ? (
          <p className="text-sm text-ink-600">No class is assigned to you yet.</p>
        ) : (
          <SearchableMultiSelect
            values={drafts.map((d) => d.classId)}
            onValuesChange={setClasses}
            options={classOptions}
            placeholder="Choose classes"
            searchPlaceholder="Search classes"
            emptyText="No class matches."
            selectedHeading="Selected"
            othersHeading="Other classes"
            selectAll={classOptions.length > 1 ? { label: "All classes" } : undefined}
            triggerClassName={cn("h-10 rounded-xl border-input px-3 text-sm", FIELD_FILL)}
            summary={(_count, picked) => {
              const names = picked.map((o) => o.label);
              return names.length <= 2 ? names.join(", ") : `${names[0]}, ${names[1]} + ${names.length - 2} more`;
            }}
          />
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-ink-500">Each class you choose gets a box here with its hours and teachers.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((d) => (
            <ClassSessionBox
              key={d.classId}
              {...shared}
              draft={d}
              sessions={drafts}
              issues={issues.filter((i) => i.classId === d.classId)}
              onChange={(next) => onChange(drafts.map((x) => (x.classId === d.classId ? next : x)))}
              onRemove={() => onChange(drafts.filter((x) => x.classId !== d.classId))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
