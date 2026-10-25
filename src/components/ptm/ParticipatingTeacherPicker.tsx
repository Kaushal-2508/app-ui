import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { EmptyState } from "@/components/shared/surfaces";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { cn } from "@/lib/utils";
import type { PTMBusyWindow, PTMOnlineTeacherOption } from "@/hooks/ptm";

interface Props {
  options: PTMOnlineTeacherOption[] | undefined;
  /** Every PTM holding a teacher on the chosen day; undefined before a date is picked. */
  busy: PTMBusyWindow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  value: string[];
  onChange: (next: string[]) => void;
  /** Admin: open the Google-account sheet for a teacher who has none. */
  onSetGoogleEmail?: (teacherId: string, name: string) => void;
  /** Shown when `options` is empty; the default speaks of the caller's whole scope. */
  emptyText?: string;
  /** Class boxes (2026-10-06): why a teacher cannot be ticked here ("In Class
   *  5 - A, 3:00 PM to 4:00 PM", "Busy ... with ..."); null when they can.
   *  The row is greyed with that text; a chip already on the list keeps its
   *  remove button. */
  disabledReason?: (teacherId: string) => string | null;
  /** Class boxes: one line of information on a selectable teacher ("Also in
   *  Class 5 - A, 3:00 PM to 4:00 PM"), shown as the row's description and
   *  under their chip. */
  noteFor?: (teacherId: string) => string | null;
  /** The "N teachers have no Google account set" list under the picker. A
   *  class box turns it off: the row description already marks them. */
  missingList?: boolean;
}

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : format(at, "h:mm a");
}

/**
 * The admin's or coordinator's pick of participating teachers. Every teacher
 * is selectable (Naman, 2026-10-05: "admin can select it here, and when the
 * teacher sees the PTM he/she can add gmail"; most teachers log in with their
 * Gmail, which Meet uses unless they set another account). A teacher with no
 * Google account set is marked, not blocked, and an admin can set it from the
 * list under the picker. A teacher already in a PTM that day stays selectable
 * but reads "Busy 3:00 PM to 5:00 PM with ...": the exact overlap is checked
 * once the times are set, and the server refuses it either way.
 */
export function ParticipatingTeacherPicker({
  options,
  busy,
  isLoading,
  isError,
  onRetry,
  value,
  onChange,
  onSetGoogleEmail,
  emptyText = "No teachers are assigned to the classes you cover yet, so there is nobody to invite.",
  disabledReason,
  noteFor,
  missingList = true,
}: Props) {
  const [missingOpen, setMissingOpen] = useState(false);

  const busyByTeacher = useMemo(() => {
    const map = new Map<string, PTMBusyWindow[]>();
    for (const b of busy ?? []) {
      const list = map.get(b.teacher_id) ?? [];
      list.push(b);
      map.set(b.teacher_id, list);
    }
    return map;
  }, [busy]);

  const selectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      (options ?? []).map((t) => {
        const reason = disabledReason?.(t.teacher_id) ?? null;
        const note = reason ? null : (noteFor?.(t.teacher_id) ?? null);
        const windows = busyByTeacher.get(t.teacher_id) ?? [];
        const first = windows[0];
        const description = reason
          ? reason
          : note
            ? note
            : first
              ? `Busy ${clock(first.starts_at)} to ${clock(first.ends_at)} with "${first.title}"${windows.length > 1 ? ` and ${windows.length - 1} more` : ""}`
              : !t.has_google_email
                ? "Google account not set; joins with their login email"
                : `${t.class_count} ${t.class_count === 1 ? "class" : "classes"}`;
        return {
          value: t.teacher_id,
          label: t.full_name,
          description,
          disabled: !!reason,
          className: reason ? "text-ink-400" : first ? "text-amber-700 dark:text-amber-300" : undefined,
        };
      }),
    [options, busyByTeacher, disabledReason, noteFor],
  );

  const byId = useMemo(() => new Map((options ?? []).map((t) => [t.teacher_id, t])), [options]);
  const selected = value.map((id) => byId.get(id)).filter((t): t is PTMOnlineTeacherOption => !!t);
  const missing = (options ?? []).filter((t) => !t.has_google_email);

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading teachers…
      </p>
    );
  }
  if (isError) {
    return (
      <EmptyState
        size="sm"
        icon={<AlertTriangle className="h-7 w-7" />}
        tone="rose"
        reason="error"
        title="Couldn't load the teachers"
        description="Check your connection and try again."
        action={{ label: "Retry", onClick: onRetry }}
      />
    );
  }
  if ((options ?? []).length === 0) {
    return <p className="text-sm text-ink-600">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      <SearchableMultiSelect
        values={value}
        onValuesChange={onChange}
        options={selectOptions}
        placeholder="Choose teachers"
        searchPlaceholder="Search teachers"
        emptyText="No teacher matches."
        selectedHeading="Selected"
        othersHeading="Other teachers"
        triggerClassName={cn("h-10 rounded-xl border-input px-3 text-sm", FIELD_FILL)}
        summary={(_count, picked) => {
          const names = picked.map((o) => o.label);
          return names.length <= 2 ? names.join(", ") : `${names[0]}, ${names[1]} + ${names.length - 2} more`;
        }}
      />

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((t) => {
            const windows = busyByTeacher.get(t.teacher_id) ?? [];
            const note = noteFor?.(t.teacher_id) ?? null;
            return (
              <Badge key={t.teacher_id} variant="secondary" className="max-w-full gap-1 whitespace-normal pr-1">
                {windows.length > 0 && (
                  <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-label="Busy that day" />
                )}
                <span>
                  {t.full_name}
                  {note && <span className="font-normal text-ink-500"> · {note}</span>}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${t.full_name}`}
                  onClick={() => onChange(value.filter((id) => id !== t.teacher_id))}
                  className="h-5 w-5 rounded-full p-0.5 hover:bg-transparent hover:text-destructive [&_svg]:size-3"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </Badge>
            );
          })}
        </div>
      )}

      {missingList && missing.length > 0 && (
        <Collapsible open={missingOpen} onOpenChange={setMissingOpen}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-8 gap-1 px-2 text-xs text-ink-600"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", missingOpen && "rotate-180")} aria-hidden="true" />
              {missing.length} {missing.length === 1 ? "teacher has" : "teachers have"} no Google account set
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mb-2 text-xs text-ink-500">
              They can still be picked. Meet uses their login email unless a different Google account is set here
              or by them under Settings.
            </p>
            <ul className="divide-y divide-surface-stroke rounded-md border border-surface-stroke text-sm">
              {missing.map((t) => (
                <li key={t.teacher_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-ink-900">{t.full_name}</span>
                    <span className="block text-xs text-ink-500">Google account not set</span>
                  </span>
                  {onSetGoogleEmail && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 text-xs"
                      onClick={() => onSetGoogleEmail(t.teacher_id, t.full_name)}
                    >
                      Set Google account
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
