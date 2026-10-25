import * as React from "react";
import { AlertTriangle, Layers, Users } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toastError } from "@/lib/toast";
import { translateError } from "@/lib/errorMessages";
import { logActivityEvent } from "@/lib/activityLog";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClassStep, SectionStep, PickerBreadcrumb } from "@/components/school/SectionPickerSteps";
import { useInstitutionOptionalGroups, type OptionalGroupRow } from "@/hooks/useOptionalGroups";
import {
  useSectionStudentsForRoll,
  type SectionStudentForRoll,
} from "@/hooks/useSectionStudentsForRoll";
import {
  useSectionOptionalChoices,
  SECTION_OPTIONAL_CHOICES_KEY,
  type SectionOptionalChoices,
} from "@/hooks/useSectionOptionalChoices";

// =============================================================
// Update Optional Subjects — third card in "Update Student Details".
//
// Classes › Section › one row per student with a dropdown per optional
// group of that class. Choices persist through the same one-transaction
// RPC the Subjects tab uses (set_student_optional_group_choices), so
// Optional Groups stays the ONLY writer of student_optional_enrollments
// (optional-subjects skill §1). Teachers were removed from that write
// on 2026-08-26; the card is offered to admins and coordinators only and
// the RPC re-checks can_manage_student_subjects regardless.
//
// Dormancy (optional-subjects skill §2): an optional subject narrows
// nothing until at least one student of the SECTION has chosen it. The
// first save that records a subject here flips it to enrolled-only for
// the whole section, so the sheet flags dormant groups and confirms
// before recording a subject's first choice, naming how many students
// will lose it. The 2026-08-25 Alliance blackout was exactly that flip
// landing unannounced.
// =============================================================

interface UpdateOptionalSubjectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
  /** When set, restricts the picker to these section (class) ids — for
   *  wing-scoped coordinators. null/undefined = all. */
  allowedClassIds?: string[] | null;
}

type Step = "class" | "section" | "students";
type RowStatus = "idle" | "saving" | "saved" | "error";

/** studentId -> groupId -> subjectId | null ("None selected"). */
type ChoiceDrafts = Record<string, Record<string, string | null>>;
type GroupChoices = Record<string, string | null>;

interface ChoicePayload {
  group_id: string;
  subject_id: string | null;
}

const NONE = "none";

export function UpdateOptionalSubjectSheet({
  open,
  onOpenChange,
  institutionId,
  allowedClassIds,
}: UpdateOptionalSubjectSheetProps) {
  const [step, setStep] = React.useState<Step>("class");
  const [classGroupId, setClassGroupId] = React.useState<string | null>(null);
  const [classGroupName, setClassGroupName] = React.useState<string>("");
  const [classId, setClassId] = React.useState<string | null>(null);
  const [classLabel, setClassLabel] = React.useState<string>("");

  // Lifted editable state — MobileSheet's primaryAction reads it from here.
  const [drafts, setDrafts] = React.useState<ChoiceDrafts>({});
  const [originals, setOriginals] = React.useState<ChoiceDrafts>({});
  // studentId → name, seeded with the roster so the audit row can name them.
  const [names, setNames] = React.useState<Record<string, string>>({});

  const [rowStatus, setRowStatus] = React.useState<Record<string, RowStatus>>({});
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const queryClient = useQueryClient();

  // Every optional group of the institution is one cached query; the
  // picked class's groups are a client-side filter of it. Groups without
  // a subject have nothing to choose from and are left out of the grid.
  // Gated on `open`: this sheet stays mounted on the Students page, and
  // the groups are only needed once someone actually opens it.
  const {
    data: allGroups,
    isLoading: groupsLoading,
    isError: groupsError,
  } = useInstitutionOptionalGroups(open ? institutionId : null);

  const classGroups = React.useMemo<OptionalGroupRow[]>(
    () => (allGroups ?? []).filter((g) => g.class_group_id === classGroupId),
    [allGroups, classGroupId]
  );
  const usableGroups = React.useMemo(
    () => classGroups.filter((g) => g.subjects.length > 0),
    [classGroups]
  );

  const subjectName = React.useCallback(
    (subjectId: string | null) => {
      if (!subjectId) return null;
      for (const g of usableGroups) {
        const hit = g.subjects.find((s) => s.id === subjectId);
        if (hit) return hit.name;
      }
      return null;
    },
    [usableGroups]
  );

  /** Subjects at least one student of this section has ALREADY chosen, i.e.
   *  the ones optional_choices_recorded() already reports as in use. Anything
   *  else is dormant: the whole section still sees it. Derived from `originals`
   *  so a successful save moves its subjects across without a refetch. */
  const recordedSubjectIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const mine of Object.values(originals)) {
      for (const subjectId of Object.values(mine)) if (subjectId) set.add(subjectId);
    }
    return set;
  }, [originals]);

  /** Only the groups whose draft differs from what is saved, per student. */
  const changedByStudent = React.useMemo(() => {
    const out: Record<string, ChoicePayload[]> = {};
    for (const [studentId, groupDrafts] of Object.entries(drafts)) {
      const saved = originals[studentId] ?? {};
      const diffs: ChoicePayload[] = [];
      for (const [groupId, subjectId] of Object.entries(groupDrafts)) {
        if ((subjectId ?? null) !== (saved[groupId] ?? null)) {
          diffs.push({ group_id: groupId, subject_id: subjectId ?? null });
        }
      }
      if (diffs.length > 0) out[studentId] = diffs;
    }
    return out;
  }, [drafts, originals]);

  const changedIds = React.useMemo(() => Object.keys(changedByStudent), [changedByStudent]);
  const changedCount = React.useMemo(
    () => Object.values(changedByStudent).reduce((n, list) => n + list.length, 0),
    [changedByStudent]
  );

  const saveDisabled = saving || changedIds.length === 0;

  const saveAll = React.useCallback(async () => {
    if (saveDisabled) return;

    // Dormancy gate: a subject nobody in this section has chosen yet is
    // still visible to every student. Recording its first choice flips it
    // to enrolled-only for the section, so name the fallout and ask first.
    const firstTime = new Map<string, { subject: string; group: string; groupId: string }>();
    for (const list of Object.values(changedByStudent)) {
      for (const c of list) {
        if (!c.subject_id || recordedSubjectIds.has(c.subject_id) || firstTime.has(c.subject_id)) {
          continue;
        }
        firstTime.set(c.subject_id, {
          subject: subjectName(c.subject_id) ?? "This subject",
          group: usableGroups.find((g) => g.id === c.group_id)?.name ?? "this optional",
          groupId: c.group_id,
        });
      }
    }
    if (firstTime.size > 0) {
      const lines = [...firstTime.values()].map(({ subject, group, groupId }) => {
        const remaining = Object.values(drafts).filter(
          (mine) => (mine[groupId] ?? null) === null
        ).length;
        return `${subject} (${group}): ${remaining} student${remaining === 1 ? "" : "s"} still on None selected will stop seeing it.`;
      });
      const confirmed = window.confirm(
        `First choices for ${classGroupName} ${classLabel}.\n\nOnce saved, these subjects are shown only to the students who chose them:\n\n${lines.join("\n")}\n\nContinue?`
      );
      if (!confirmed) return;
    }

    setSaving(true);

    try {
      let okCount = 0;
      let failCount = 0;

      // One RPC per changed student, sequentially. Each call is already one
      // transaction across that student's groups; keeping students separate
      // lets a student who can't be saved say so on their own row while the
      // rest go through. The load profile is one admin fixing a section, not
      // a student-facing hot path. Every dropdown is disabled while this
      // runs, so the click-time snapshot below is also what the user sees.
      for (const id of changedIds) {
        setRowStatus((prev) => ({ ...prev, [id]: "saving" }));
        setRowError((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });

        const choices = changedByStudent[id];
        try {
          const { error } = await supabase.rpc("set_student_optional_group_choices", {
            _student: id,
            _choices: choices as unknown as Json,
          });
          if (error) throw error;

          setRowStatus((prev) => ({ ...prev, [id]: "saved" }));
          setOriginals((prev) => {
            const mine = { ...(prev[id] ?? {}) };
            for (const c of choices) mine[c.group_id] = c.subject_id;
            return { ...prev, [id]: mine };
          });

          void logActivityEvent({
            action: "optional_group_choices_saved",
            entityType: "StudentOptionalSubject",
            entityId: id,
            entityName: names[id] ?? null,
            metadata: {
              institution_id: institutionId ?? null,
              class_id: classId,
              section: `${classGroupName} ${classLabel}`.trim(),
              choices: JSON.stringify(
                choices.map((c) => ({
                  group_id: c.group_id,
                  group: usableGroups.find((g) => g.id === c.group_id)?.name ?? null,
                  subject_id: c.subject_id,
                  subject: subjectName(c.subject_id),
                }))
              ),
            },
          });
          okCount++;
        } catch (err) {
          // Translate, don't leak (CLAUDE.md §19): the row is the primary
          // explanation the user gets, so it must never show raw fetch or
          // Postgres text. The RPC's own RAISE copy passes through as-is.
          console.error("[updateOptionalSubject.saveRow]", err);
          const message = translateError(
            err,
            "Couldn't save this student's optional subjects."
          ).title;
          setRowStatus((prev) => ({ ...prev, [id]: "error" }));
          setRowError((prev) => ({ ...prev, [id]: message }));
          failCount++;
        }
      }

      // Invalidate once, after the whole batch — the same downstream set the
      // Subjects tab refreshes, plus this picker's own section read.
      queryClient.invalidateQueries({ queryKey: [SECTION_OPTIONAL_CHOICES_KEY, classId] });
      for (const id of changedIds) {
        queryClient.invalidateQueries({ queryKey: ["student-optional-group-assignment", id] });
        queryClient.invalidateQueries({ queryKey: ["student-subject-assignment", id] });
        queryClient.invalidateQueries({ queryKey: ["student-visible-subjects", id] });
      }
      queryClient.invalidateQueries({ queryKey: ["student-eligible-exams"] });
      queryClient.invalidateQueries({ queryKey: ["student-results"] });
      queryClient.invalidateQueries({ queryKey: ["student-homework"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "student-week"] });

      if (failCount === 0) {
        toast.success(
          `Saved optional subjects for ${okCount} student${okCount === 1 ? "" : "s"}.`
        );
      } else if (okCount === 0) {
        // The sentence lives in the Error itself: translateError passes short
        // non-technical messages through as the title, so a `fallback` here
        // would never render.
        toastError(
          new Error(
            `All ${failCount} save${failCount === 1 ? "" : "s"} failed. See the per-row messages.`
          ),
          { context: "updateOptionalSubject.saveAll" }
        );
      } else {
        toast.warning(
          `Saved ${okCount} of ${okCount + failCount}. Fix the ${failCount} red row${failCount === 1 ? "" : "s"} and retry.`
        );
      }
    } finally {
      setSaving(false);
    }
  }, [
    saveDisabled,
    changedIds,
    changedByStudent,
    recordedSubjectIds,
    drafts,
    names,
    classId,
    classGroupName,
    classLabel,
    institutionId,
    usableGroups,
    subjectName,
    queryClient,
  ]);

  const resetStudentsState = React.useCallback(() => {
    setDrafts({});
    setOriginals({});
    setNames({});
    setRowStatus({});
    setRowError({});
  }, []);

  // Reset on close so a fresh open always lands on Step 1. `saving` is left
  // alone: the batch's own `finally` clears it, and nothing can close the
  // sheet while a batch runs (see the guards below).
  React.useEffect(() => {
    if (!open) {
      setStep("class");
      setClassGroupId(null);
      setClassGroupName("");
      setClassId(null);
      setClassLabel("");
      resetStudentsState();
    }
  }, [open, resetStudentsState]);

  // While a batch is in flight the sheet cannot be closed or navigated: the
  // loop would otherwise keep writing into freshly reset state, and an admin
  // who confirmed "discard" would still have the rest of the section saved.
  const canLeave = () =>
    !saving &&
    (changedIds.length === 0 ||
      window.confirm("You have unsaved optional subject changes. Discard and close?"));

  const subtitle =
    step === "class"
      ? "Pick a class to start"
      : step === "section"
        ? classGroupName
        : `${classGroupName}  ›  ${classLabel}`;

  return (
    <MobileSheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !canLeave()) return;
        onOpenChange(next);
      }}
      title="Update Optional Subjects"
      subtitle={subtitle}
      icon={<Layers className="h-5 w-5 text-brand-primary" />}
      // The bottom sheet's body is hard-coded white (pre-existing debt shared
      // by its other consumers). Everything rendered in here uses flipping
      // tokens, so the card token is safe to apply and makes dark mode work.
      className="bg-surface-card"
      primaryAction={
        step === "students"
          ? {
              label: saving ? "Saving…" : "Save Changes",
              onClick: saveAll,
              disabled: saveDisabled,
              loading: saving,
            }
          : undefined
      }
      secondaryAction={
        step === "students"
          ? {
              label: "Close",
              onClick: () => {
                if (canLeave()) onOpenChange(false);
              },
              disabled: saving,
            }
          : undefined
      }
    >
      {step === "class" && (
        <ClassStep
          institutionId={institutionId}
          allowedClassIds={allowedClassIds}
          emptyDescription="Use Manage Classes to add a class before setting optional subjects."
          onPick={(id, name) => {
            setClassGroupId(id);
            setClassGroupName(name);
            setStep("section");
          }}
        />
      )}
      {step === "section" && classGroupId && (
        <SectionStep
          classGroupId={classGroupId}
          classGroupName={classGroupName}
          allowedClassIds={allowedClassIds}
          onBack={() => {
            setClassGroupId(null);
            setClassGroupName("");
            setStep("class");
          }}
          onPick={(id, label) => {
            setClassId(id);
            setClassLabel(label);
            setStep("students");
          }}
        />
      )}
      {step === "students" && classId && (
        <StudentsStep
          classId={classId}
          classGroupName={classGroupName}
          classLabel={classLabel}
          groupsLoading={groupsLoading}
          groupsError={groupsError}
          classGroupCount={classGroups.length}
          groups={usableGroups}
          drafts={drafts}
          originals={originals}
          setDrafts={setDrafts}
          setOriginals={setOriginals}
          setNames={setNames}
          changedCount={changedCount}
          saving={saving}
          rowStatus={rowStatus}
          rowError={rowError}
          setRowStatus={setRowStatus}
          setRowError={setRowError}
          onBack={() => {
            if (!canLeave()) return;
            resetStudentsState();
            setClassId(null);
            setClassLabel("");
            setStep("section");
          }}
          onBackToClasses={() => {
            if (!canLeave()) return;
            resetStudentsState();
            setClassGroupId(null);
            setClassGroupName("");
            setClassId(null);
            setClassLabel("");
            setStep("class");
          }}
        />
      )}
    </MobileSheet>
  );
}

interface StudentsStepProps {
  classId: string;
  classGroupName: string;
  classLabel: string;
  groupsLoading: boolean;
  groupsError: boolean;
  /** All optional groups of the class, including ones with no subjects yet. */
  classGroupCount: number;
  /** Groups that have at least one subject to choose from. */
  groups: OptionalGroupRow[];
  drafts: ChoiceDrafts;
  originals: ChoiceDrafts;
  setDrafts: React.Dispatch<React.SetStateAction<ChoiceDrafts>>;
  setOriginals: React.Dispatch<React.SetStateAction<ChoiceDrafts>>;
  setNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  changedCount: number;
  saving: boolean;
  rowStatus: Record<string, RowStatus>;
  rowError: Record<string, string>;
  setRowStatus: React.Dispatch<React.SetStateAction<Record<string, RowStatus>>>;
  setRowError: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onBack: () => void;
  onBackToClasses: () => void;
}

function StudentsStep({
  classId,
  classGroupName,
  classLabel,
  groupsLoading,
  groupsError,
  classGroupCount,
  groups,
  drafts,
  originals,
  setDrafts,
  setOriginals,
  setNames,
  changedCount,
  saving,
  rowStatus,
  rowError,
  setRowStatus,
  setRowError,
  onBack,
  onBackToClasses,
}: StudentsStepProps) {
  const {
    data: roster,
    isLoading: rosterLoading,
    isError: rosterError,
  } = useSectionStudentsForRoll(classId);

  const studentIds = React.useMemo(() => (roster ?? []).map((s) => s.id), [roster]);
  const choiceGroups = React.useMemo(
    () => groups.map((g) => ({ id: g.id, subject_ids: g.subject_ids })),
    [groups]
  );

  const hasStudents = studentIds.length > 0;
  const hasGroups = groups.length > 0;

  const {
    data: choices,
    isLoading: choicesLoading,
    isError: choicesError,
  } = useSectionOptionalChoices({
    classId,
    studentIds: hasStudents && hasGroups ? studentIds : null,
    groups: hasStudents && hasGroups ? choiceGroups : null,
  });

  // Seed drafts + originals only once BOTH the roster and the saved choices
  // are in hand. Seeding from the roster alone would read as "None selected"
  // for everyone and a later save could wipe real choices.
  //
  // Re-runs whenever fresher data lands (a background refetch of a cached
  // section, or the post-save refetch): rows the user has not touched follow
  // the server, rows with pending edits keep their draft. It is keyed on the
  // identity of the loaded data, NOT on drafts/originals, so the optimistic
  // `setOriginals` after a save cannot drag a just-saved row back to the
  // pre-save cache before the refetch arrives.
  const seededFrom = React.useRef<{ roster: unknown; choices: unknown; groups: unknown } | null>(
    null
  );
  React.useEffect(() => {
    if (!roster || !choices) return;
    const last = seededFrom.current;
    if (last && last.roster === roster && last.choices === choices && last.groups === groups) {
      return;
    }
    seededFrom.current = { roster, choices, groups };

    const fromServer = (studentId: string): GroupChoices => {
      const mine: GroupChoices = {};
      for (const g of groups) mine[g.id] = choices[studentId]?.[g.id] ?? null;
      return mine;
    };
    const same = (a: GroupChoices | undefined, b: GroupChoices | undefined) => {
      if (!a || !b) return false;
      for (const g of groups) if ((a[g.id] ?? null) !== (b[g.id] ?? null)) return false;
      return true;
    };

    const nextOriginals: ChoiceDrafts = { ...originals };
    const nextDrafts: ChoiceDrafts = { ...drafts };
    let touched = false;
    for (const s of roster) {
      const server = fromServer(s.id);
      const isNew = !(s.id in originals);
      const untouched = !isNew && same(drafts[s.id], originals[s.id]);
      if (!isNew && !untouched) continue; // pending edit: keep the draft
      if (!isNew && same(originals[s.id], server)) continue; // already current
      nextOriginals[s.id] = server;
      nextDrafts[s.id] = { ...server };
      touched = true;
    }
    if (touched) {
      setOriginals(nextOriginals);
      setDrafts(nextDrafts);
    }

    setNames((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of roster) {
        if (next[s.id] !== s.full_name) {
          next[s.id] = s.full_name;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [roster, choices, groups, drafts, originals, setOriginals, setDrafts, setNames]);

  // Groups no student of this section has chosen from yet: still visible to
  // the whole section, and about to stop being so on the first save.
  const dormantGroups = React.useMemo(() => {
    if (!choices) return [];
    const recorded = new Set<string>();
    for (const mine of Object.values(choices as SectionOptionalChoices)) {
      for (const subjectId of Object.values(mine)) recorded.add(subjectId);
    }
    return groups.filter((g) => g.subjects.every((s) => !recorded.has(s.id)));
  }, [choices, groups]);

  // Clear a row's saved/error status when the user re-edits it.
  const handleDraftChange = (studentId: string, groupId: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] ?? {}), [groupId]: value === NONE ? null : value },
    }));
    setRowStatus((prev) => {
      if (!(studentId in prev)) return prev;
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    setRowError((prev) => {
      if (!(studentId in prev)) return prev;
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  };

  const breadcrumb = (
    <PickerBreadcrumb
      items={[
        { label: "Classes", onClick: onBackToClasses },
        { label: classGroupName, onClick: onBack },
        { label: classLabel },
      ]}
    />
  );

  // Error states render BEFORE empty states (CLAUDE.md §6): a failed read
  // must never look like "no groups" or "nobody has chosen anything".
  if (groupsError) {
    return (
      <>
        {breadcrumb}
        <EmptyState
          icon={<Layers className="h-7 w-7" />}
          title="Couldn't load optional groups"
          description="Please go back and try again."
          reason="error"
        />
      </>
    );
  }
  if (rosterError) {
    return (
      <>
        {breadcrumb}
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Couldn't load students"
          description="Please go back and try again."
          reason="error"
        />
      </>
    );
  }
  if (choicesError) {
    return (
      <>
        {breadcrumb}
        <EmptyState
          icon={<Layers className="h-7 w-7" />}
          title="Couldn't load current choices"
          description="Editing is paused so nobody's saved choice gets overwritten. Please go back and try again."
          reason="error"
        />
      </>
    );
  }

  const loading =
    groupsLoading || rosterLoading || (hasStudents && hasGroups && (choicesLoading || !choices));
  if (loading) {
    return (
      <>
        {breadcrumb}
        <div className="p-6 text-sm text-ink-600">Loading students…</div>
      </>
    );
  }

  if (classGroupCount === 0) {
    return (
      <>
        {breadcrumb}
        <EmptyState
          icon={<Layers className="h-7 w-7" />}
          title={`No optional groups for ${classGroupName}`}
          description="Create them from Syllabus, then Add New, then Optional Groups."
          reason="noData"
        />
      </>
    );
  }
  if (!hasGroups) {
    return (
      <>
        {breadcrumb}
        <EmptyState
          icon={<Layers className="h-7 w-7" />}
          title="Optional groups have no subjects yet"
          description={`Add subjects to the optional groups of ${classGroupName} under Syllabus before assigning choices.`}
          reason="noData"
        />
      </>
    );
  }
  if (!hasStudents) {
    return (
      <>
        {breadcrumb}
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students in this section"
          description="Assign students to this section first."
          reason="noData"
        />
      </>
    );
  }

  return (
    <>
      {breadcrumb}

      {dormantGroups.length > 0 && (
        <div
          role="note"
          className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            No choices recorded yet for {dormantGroups.map((g) => g.name).join(", ")} in this
            section, so every student still sees all of {dormantGroups.length === 1 ? "its" : "their"}{" "}
            subjects. After the first save, each chosen subject is shown only to the students who
            chose it.
          </p>
        </div>
      )}

      <form
        className="p-4"
        data-dirty={changedCount > 0 ? "true" : undefined}
        onSubmit={(e) => e.preventDefault()}
      >
        <ul className="surface-card frosted-shadow rounded-card divide-y divide-surface-stroke">
          {(roster ?? []).map((s: SectionStudentForRoll) => {
            const status = rowStatus[s.id] ?? "idle";
            const err = rowError[s.id];
            const errId = `optional-choice-error-${s.id}`;
            const mine = drafts[s.id] ?? {};
            return (
              <li
                key={s.id}
                className="flex flex-col gap-2 p-3 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-ink-900">{s.full_name}</span>
                  {s.roll_number && (
                    <span className="ml-2 text-xs text-ink-500">Roll {s.roll_number}</span>
                  )}
                  {status === "saved" && (
                    <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
                      Saved.
                    </p>
                  )}
                  {status === "error" && err && (
                    <p id={errId} className="text-xs text-red-600 dark:text-red-400">
                      {err}
                    </p>
                  )}
                </div>
                <div className="grid w-full shrink-0 gap-2 sm:grid-cols-2 lg:flex lg:w-auto">
                  {groups.map((g) => {
                    const draft = mine[g.id] ?? null;
                    const isChanged = draft !== (originals[s.id]?.[g.id] ?? null);
                    return (
                      <div key={g.id} className="lg:w-52">
                        {/* Each dropdown carries its own group label at every width: a
                            single header row would scroll away inside the sheet body. */}
                        <p className="eyebrow mb-1 truncate" title={g.name}>
                          {g.name}
                        </p>
                        <Select
                          value={draft ?? NONE}
                          onValueChange={(v) => handleDraftChange(s.id, g.id, v)}
                          disabled={saving}
                        >
                          <SelectTrigger
                            aria-label={`${g.name} for ${s.full_name}`}
                            aria-invalid={status === "error"}
                            aria-describedby={status === "error" ? errId : undefined}
                            className={
                              status === "saved"
                                ? "ring-2 ring-emerald-500"
                                : status === "error"
                                  ? "ring-2 ring-red-500"
                                  : isChanged
                                    ? "ring-2 ring-brand-primary"
                                    : undefined
                            }
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>None selected</SelectItem>
                            {g.subjects.map((sub) => (
                              <SelectItem key={sub.id} value={sub.id}>
                                {sub.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-ink-500">
          {changedCount === 0
            ? "No changes yet. Pick a subject in an optional group to change a student's choice."
            : `${changedCount} change${changedCount === 1 ? "" : "s"} pending.`}
        </p>
      </form>
    </>
  );
}
