import { useMemo, useState } from "react";
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronLeft, ChevronRight, Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { translateError } from "@/lib/errorMessages";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";
import { useClassGroupSubjects } from "@/hooks/useClassGroupSubjects";
import {
  useInstitutionOptionalGroups,
  useUpsertOptionalGroup,
  useSetOptionalGroupSubject,
  useDeleteOptionalGroup,
  useDeleteOptionalGroupsByName,
} from "@/hooks/useOptionalGroups";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
}

/**
 * Syllabus → Add New → Optional Groups. Two levels:
 *  1. the institution's optional names ("Optional 1", "Optional 2") +
 *     create-new;
 *  2. inside a name: pick a class, then tick the subjects of that class
 *     that belong to this optional. Ticking auto-marks the subject
 *     optional for the class (server-side invariant).
 */
export default function OptionalGroupsSheet({ open, onOpenChange, institutionId }: Props) {
  const { data: groupRows = [], isLoading } = useInstitutionOptionalGroups(open ? institutionId : null);
  const {
    data: classGroups = [],
    isLoading: classesLoading,
    isError: classesFailed,
    error: classesError,
  } = useInstitutionClassGroups(open ? institutionId : null);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [localNames, setLocalNames] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [classGroupId, setClassGroupId] = useState<string | null>(null);

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const r of groupRows) set.add(r.name);
    for (const n of localNames) set.add(n);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [groupRows, localNames]);

  const defaultNewName = `Optional ${names.length + 1}`;
  const deleteByName = useDeleteOptionalGroupsByName();

  /**
   * Deleting an optional is blocked while it still holds subjects - dropping it
   * silently would un-map every student's elective. The user clears the
   * subjects first, then the optional itself goes.
   */
  const handleDeleteName = (target: string) => {
    const rows = groupRows.filter((r) => r.name === target);
    const subjectCount = rows.reduce((sum, r) => sum + r.subject_ids.length, 0);

    if (subjectCount > 0) {
      toastError(
        new Error(
          `Remove the ${subjectCount} subject${subjectCount === 1 ? "" : "s"} inside "${target}" before deleting it.`,
        ),
        { fallback: "Remove its subjects first.", context: "deleteOptionalGroupBlocked" },
      );
      return;
    }

    // Never saved (typed here, no class picked yet) - drop the local name only.
    if (rows.length === 0) {
      setLocalNames((l) => l.filter((n) => n !== target));
      if (selectedName === target) setSelectedName(null);
      toast.success(`"${target}" removed`);
      return;
    }

    deleteByName.mutate(
      { name: target, groupIds: rows.map((r) => r.id) },
      {
        onSuccess: () => {
          setLocalNames((l) => l.filter((n) => n !== target));
          if (selectedName === target) setSelectedName(null);
        },
      },
    );
  };

  const reset = () => {
    setSelectedName(null);
    setClassGroupId(null);
    setNewName("");
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      title={selectedName ?? "Optional Groups"}
      subtitle={
        selectedName
          ? "Pick a class, then choose which of its subjects belong to this optional"
          : "Baskets of subjects that run in parallel. Students pick one subject per optional."
      }
      icon={<Layers className="h-5 w-5" />}
      secondaryAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : selectedName === null ? (
        <div className="space-y-4">
          {names.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-7 w-7" />}
              title="No optionals yet"
              description='Create "Optional 1", then add the subjects each class offers inside it.'
              reason="noData"
            />
          ) : (
            <div className="space-y-2">
              {names.map((groupName) => {
                const rows = groupRows.filter((r) => r.name === groupName);
                const classCount = rows.length;
                const subjectCount = rows.reduce((sum, r) => sum + r.subject_ids.length, 0);
                return (
                  /* Row is a container, not a button: the delete control is its
                     own button and nesting buttons is invalid HTML. Hidden until
                     hover on pointer devices, always present on touch. */
                  <div
                    key={groupName}
                    className="group surface-card frosted-shadow rounded-card flex items-center gap-1 pr-2 transition-colors hover:bg-brand-primary/[0.04]"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedName(groupName)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                    >
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                        <Layers className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-900">
                          {groupName}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-500">
                          {classCount} {classCount === 1 ? "class" : "classes"}
                          {subjectCount > 0 && (
                            <> &middot; {subjectCount} {subjectCount === 1 ? "subject" : "subjects"}</>
                          )}
                        </span>
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${groupName}`}
                      disabled={deleteByName.isPending}
                      onClick={() => handleDeleteName(groupName)}
                      className="h-8 w-8 shrink-0 text-ink-400 hover:bg-rose-500/10 hover:text-rose-600 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="newOptionalName">New optional</Label>
            <div className="flex items-center gap-2">
              <Input
                id="newOptionalName"
                value={newName}
                onChange={(e) => setNewName(e.target.value.slice(0, 60))}
                placeholder={defaultNewName}
              />
              <Button
                size="sm"
                onClick={() => {
                  const name = (newName.trim() || defaultNewName).slice(0, 60);
                  setLocalNames((l) => (l.includes(name) ? l : [...l, name]));
                  setNewName("");
                  setSelectedName(name);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <OptionalNameEditor
          institutionId={institutionId}
          name={selectedName}
          classGroups={classGroups.map((g) => ({ id: g.id, name: g.name }))}
          classesLoading={classesLoading}
          classesFailed={classesFailed}
          classesError={classesError}
          groupRows={groupRows}
          classGroupId={classGroupId}
          onClassGroupChange={setClassGroupId}
          onBack={() => {
            setSelectedName(null);
            setClassGroupId(null);
          }}
        />
      )}
    </MobileSheet>
  );
}

function OptionalNameEditor({
  institutionId,
  name,
  classGroups,
  classesLoading,
  classesFailed,
  classesError,
  groupRows,
  classGroupId,
  onClassGroupChange,
  onBack,
}: {
  institutionId: string;
  name: string;
  classGroups: { id: string; name: string }[];
  classesLoading: boolean;
  classesFailed: boolean;
  classesError: unknown;
  groupRows: {
    id: string;
    name: string;
    class_group_id: string;
    subject_ids: string[];
    subjects: { id: string; name: string }[];
  }[];
  classGroupId: string | null;
  onClassGroupChange: (id: string | null) => void;
  onBack: () => void;
}) {
  const upsertGroup = useUpsertOptionalGroup();
  const setSubject = useSetOptionalGroupSubject();
  const deleteGroup = useDeleteOptionalGroup();

  const { data: subjectData, isLoading: subjectsLoading } = useClassGroupSubjects(
    classGroupId,
    institutionId,
  );
  const subjects = subjectData?.all ?? [];

  const groupRow = groupRows.find((r) => r.name === name && r.class_group_id === classGroupId) ?? null;
  const memberIds = new Set(groupRow?.subject_ids ?? []);

  // Subjects already claimed by a DIFFERENT optional of the same class.
  const otherGroupBySubject = new Map<string, string>();
  for (const r of groupRows) {
    if (r.class_group_id !== classGroupId || r.name === name) continue;
    for (const sid of r.subject_ids) otherGroupBySubject.set(sid, r.name);
  }

  const pending = upsertGroup.isPending || setSubject.isPending;
  const selectedClass = classGroups.find((g) => g.id === classGroupId) ?? null;

  /* The optional opens on what it already contains - subject first, its class
     underneath. Picking a class is a deliberate "add" step, not the landing
     screen, so the configuration is readable without opening every class.
     Built off classGroups so rows keep the canonical Nursery -> 12 order. */
  const [picking, setPicking] = useState(false);
  const configuredByClass = classGroups
    .map((g) => {
      const row = groupRows.find((r) => r.name === name && r.class_group_id === g.id);
      return row && row.subjects.length > 0
        ? { classId: g.id, className: g.name, subjects: row.subjects }
        : null;
    })
    .filter((c): c is { classId: string; className: string; subjects: { id: string; name: string }[] } => c !== null);

  const openClass = (id: string | null) => {
    onClassGroupChange(id);
    setPicking(true);
  };
  const backToSummary = () => {
    onClassGroupChange(null);
    setPicking(false);
  };

  const handleToggle = async (subjectId: string, subjectName: string, member: boolean) => {
    let groupId = groupRow?.id ?? null;
    if (!groupId) {
      if (!classGroupId) return;
      try {
        groupId = await upsertGroup.mutateAsync({ classGroupId, name });
      } catch {
        return; // toasted by the hook
      }
    }
    setSubject.mutate({ groupId, subjectId, member, subjectName, groupName: name });
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        All optionals
      </Button>

      {!picking && (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="eyebrow">Subjects in {name}</p>
            {classesLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : classesFailed ? (
              <p className="py-2 text-sm text-rose-600">
                {translateError(classesError, "Couldn't load classes.").title}
              </p>
            ) : configuredByClass.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-7 w-7" />}
                title="No subjects yet"
                description="Add the first subject to this optional from any class."
                reason="noData"
              />
            ) : (
              /* Each class is its own floating card: a hairline border on white
                 inside a white sheet reads as one flat block. */
              <div className="space-y-2">
                {configuredByClass.map((c) => (
                  <button
                    key={c.classId}
                    type="button"
                    onClick={() => openClass(c.classId)}
                    className="surface-card frosted-shadow rounded-card flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-primary/[0.04]"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                      <Layers className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-900">
                        {c.subjects.map((s) => s.name).join(", ")}
                      </span>
                      <span className="mt-1 inline-flex max-w-full items-center truncate rounded-md bg-brand-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-primary">
                        {c.className}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button
            type="button"
            className="w-full bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.99]"
            disabled={classesLoading || classGroups.length === 0}
            onClick={() => openClass(null)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add another subject from any class
          </Button>
        </div>
      )}

      {picking && (
      <div className="space-y-2">
        <p className="eyebrow">Class</p>
        {/* Error state renders BEFORE the empty state: a failed class lookup
            must never read as "this school has no classes" (CLAUDE.md §6).
            The picker is a tap list, not a Select: a Radix Select portals its
            options to document.body, which lands outside this sheet's Dialog
            focus scope and never presented. The list also matches the optional
            rows on the previous level and is easier to hit at 375px. */}
        {classesLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading classes...
          </div>
        ) : classesFailed ? (
          <p className="py-2 text-sm text-rose-600">
            {translateError(classesError, "Couldn't load classes.").title}
          </p>
        ) : classGroups.length === 0 ? (
          <p className="py-2 text-sm text-ink-500">
            No active classes found for this school. Add a class first, then come back.
          </p>
        ) : selectedClass ? (
          /* Collapsed once chosen so the subject list - the actual task - gets
             the sheet's remaining height instead of a 20-row class list. */
          <div className="surface-card frosted-shadow rounded-card flex items-center gap-3 px-4 py-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
              <Check className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
              {selectedClass.name}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => onClassGroupChange(null)}
            >
              Change
            </Button>
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label="Class"
            className="surface-card frosted-shadow rounded-card max-h-56 overflow-y-auto"
          >
            {classGroups.map((g) => {
              /* What this optional already holds for that class, so configured
                 classes are visible without opening each one. */
              const configured =
                groupRows.find((r) => r.name === name && r.class_group_id === g.id)?.subjects ?? [];
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={false}
                  onClick={() => onClassGroupChange(g.id)}
                  className="flex w-full items-center gap-2 border-b border-surface-stroke px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-brand-primary/[0.04]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900">{g.name}</span>
                    {configured.length > 0 && (
                      <span className="mt-0.5 block truncate text-xs font-medium text-brand-primary">
                        {configured.map((s) => s.name).join(", ")}
                      </span>
                    )}
                  </span>
                  {configured.length > 0 && (
                    <Badge className="shrink-0 bg-brand-primary/10 text-[10px] text-brand-primary hover:bg-brand-primary/10">
                      {configured.length}
                    </Badge>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {picking && classGroupId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Subjects in {selectedClass?.name ?? "this class"}</p>
            {groupRow && (
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:text-rose-700"
                disabled={deleteGroup.isPending}
                onClick={() => deleteGroup.mutate({ groupId: groupRow.id, groupName: name })}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Remove from this class
              </Button>
            )}
          </div>

          {subjectsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : subjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subjects assigned to this class yet. Add subjects to the class first.
            </p>
          ) : (
            <div className="space-y-1">
              {subjects.map((s) => {
                const inThisGroup = memberIds.has(s.id);
                const otherGroup = otherGroupBySubject.get(s.id);
                const disabled = pending || (!inThisGroup && !!otherGroup);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "surface-card rounded-card flex items-center gap-3 border border-surface-stroke px-3 py-2.5 transition-colors",
                      inThisGroup && "border-brand-primary/30 bg-brand-primary/[0.06]",
                      disabled && !inThisGroup
                        ? "opacity-60"
                        : "cursor-pointer hover:bg-brand-primary/[0.04]",
                    )}
                  >
                    <Checkbox
                      checked={inThisGroup}
                      disabled={disabled}
                      onCheckedChange={(c) => handleToggle(s.id, s.name, !!c)}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        inThisGroup ? "font-semibold text-ink-900" : "text-ink-700",
                      )}
                    >
                      {s.name}
                    </span>
                    {otherGroup && !inThisGroup ? (
                      <span className="shrink-0 text-xs text-muted-foreground">In {otherGroup}</span>
                    ) : s.is_optional && !inThisGroup ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        Optional
                      </Badge>
                    ) : null}
                  </label>
                );
              })}
              <p className="pt-1 text-xs text-muted-foreground">
                Ticking a subject marks it optional for this class. Students then pick
                one subject per optional from their profile's Subjects tab.
              </p>
            </div>
          )}
        </div>
      )}

      {picking && (
        <Button type="button" variant="outline" className="w-full" onClick={backToSummary}>
          Done adding
        </Button>
      )}
    </div>
  );
}
