import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck, ChevronDown, Loader2, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/surfaces";
import { sortClassRows } from "@/lib/classSort";
import { cn, formatClassName } from "@/lib/utils";
import { joinNames } from "@/lib/ptm";
import type { PTMOnlinePickRow } from "@/hooks/ptm";

interface Props {
  rows: PTMOnlinePickRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Ticked student ids, in tick order. */
  value: string[];
  onChange: (next: string[]) => void;
}

interface ClassGroup {
  class_id: string;
  name: string;
  section: string | null;
  students: PTMOnlinePickRow[];
}

/**
 * The teacher's pick of residential students: every student of every class
 * they teach, grouped by class, each class with a tri-state checkbox that
 * ticks the whole class in one tap. A student on another teacher's list too
 * shows "Also with Ms X" and stays tickable (several teachers per student
 * since 2026-10-09); an older server marks them `taken` instead, greyed with
 * "With Ms X", and refuses them.
 * Inline, never a popover: a sheet scrolls it, and a class of 40 needs room.
 */
export function ResidentialStudentPicker({ rows, isLoading, isError, onRetry, value, onChange }: Props) {
  const [search, setSearch] = useState("");
  const [openIds, setOpenIds] = useState<Record<string, boolean> | null>(null);

  const groups = useMemo<ClassGroup[]>(() => {
    const map = new Map<string, ClassGroup>();
    for (const r of rows ?? []) {
      const g = map.get(r.class_id) ?? {
        class_id: r.class_id,
        name: r.class_name,
        section: r.class_section,
        students: [],
      };
      g.students.push(r);
      map.set(r.class_id, g);
    }
    const sorted = sortClassRows([...map.values()], (g) => g.name, (g) => g.section);
    for (const g of sorted) g.students.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return sorted;
  }, [rows]);

  // Three classes or fewer open on arrival; more start closed so the date
  // fields are not buried. Decided once per data load, then the user owns it.
  useEffect(() => {
    if (openIds !== null || groups.length === 0) return;
    const all = groups.length <= 3;
    setOpenIds(Object.fromEntries(groups.map((g) => [g.class_id, all])));
  }, [groups, openIds]);

  const picked = useMemo(() => new Set(value), [value]);
  const needle = search.trim().toLowerCase();
  const searching = needle.length > 0;

  const visibleGroups = useMemo(() => {
    if (!searching) return groups;
    return groups
      .map((g) => ({
        ...g,
        students: g.students.filter(
          (s) =>
            s.full_name.toLowerCase().includes(needle) ||
            formatClassName(g.name, g.section).toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.students.length > 0);
  }, [groups, searching, needle]);

  const totalPicked = (rows ?? []).filter((r) => picked.has(r.student_id)).length;
  const classesWithPicks = groups.filter((g) => g.students.some((s) => picked.has(s.student_id))).length;

  const toggleStudent = (id: string) => {
    onChange(picked.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const toggleClass = (g: ClassGroup) => {
    const selectable = g.students.filter((s) => s.state !== "taken").map((s) => s.student_id);
    const allOn = selectable.length > 0 && selectable.every((id) => picked.has(id));
    if (allOn) {
      const drop = new Set(selectable);
      onChange(value.filter((id) => !drop.has(id)));
    } else {
      const add = selectable.filter((id) => !picked.has(id));
      onChange([...value, ...add]);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading students" />
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        size="sm"
        icon={<AlertTriangle className="h-7 w-7" />}
        tone="rose"
        reason="error"
        title="Couldn't load your students"
        description="Check your connection and try again."
        action={{ label: "Retry", onClick: onRetry }}
      />
    );
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<Users className="h-7 w-7" />}
        reason="noData"
        title="No students in the classes you teach"
        description="Students appear here once they are enrolled in a class you have a teacher row on."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-700">
          {totalPicked === 0 ? (
            <span className="text-ink-500">Nobody picked yet</span>
          ) : (
            <>
              <span className="font-medium text-ink-900">
                {totalPicked} {totalPicked === 1 ? "student" : "students"}
              </span>{" "}
              across {classesWithPicks} {classesWithPicks === 1 ? "class" : "classes"}
            </>
          )}
        </p>
        {totalPicked > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onChange([])}>
            Clear all
          </Button>
        )}
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a student"
          aria-label="Find a student"
          className="h-10 pl-9"
        />
      </div>

      {visibleGroups.length === 0 ? (
        <p className="px-1 py-3 text-sm text-ink-500">No student matches.</p>
      ) : (
        <ul className="space-y-2">
          {visibleGroups.map((g) => {
            const selectable = g.students.filter((s) => s.state !== "taken");
            const onCount = selectable.filter((s) => picked.has(s.student_id)).length;
            const allOn = selectable.length > 0 && onCount === selectable.length;
            const someOn = onCount > 0 && !allOn;
            const open = searching || (openIds?.[g.class_id] ?? false);
            const label = formatClassName(g.name, g.section);
            return (
              <li key={g.class_id} className="overflow-hidden rounded-md border border-surface-stroke">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Checkbox
                    checked={allOn ? true : someOn ? "indeterminate" : false}
                    disabled={selectable.length === 0}
                    onCheckedChange={() => toggleClass(g)}
                    aria-label={`Pick every student of ${label}`}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenIds((prev) => ({ ...(prev ?? {}), [g.class_id]: !(prev?.[g.class_id] ?? false) }))
                    }
                  >
                    <span className="truncate text-sm font-medium text-ink-900">{label}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-ink-500">
                      {onCount} of {g.students.length}
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                </div>
                {open && (
                  <ul className="divide-y divide-surface-stroke border-t border-surface-stroke">
                    {g.students.map((s) => {
                      const taken = s.state === "taken";
                      const also = (s.with_teachers ?? []).filter(Boolean);
                      const on = picked.has(s.student_id);
                      return (
                        <li key={s.student_id}>
                          <label
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 text-sm",
                              taken ? "cursor-not-allowed text-ink-400" : "cursor-pointer text-ink-900 hover:bg-muted/50",
                            )}
                          >
                            <Checkbox
                              checked={on}
                              disabled={taken}
                              onCheckedChange={() => toggleStudent(s.student_id)}
                              aria-label={s.full_name}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{s.full_name}</span>
                              {also.length > 0 && (
                                <span className="block truncate text-xs text-ink-500">Also with {joinNames(also)}</span>
                              )}
                            </span>
                            {s.booked && !taken && (
                              <CalendarCheck
                                className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                                aria-label="Has booked a slot"
                              />
                            )}
                            {taken && (
                              <span className="shrink-0 text-xs text-ink-500">
                                With {s.taken_by_name ?? "another teacher"}
                              </span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
