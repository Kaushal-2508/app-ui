import * as React from "react";
import { AlertTriangle, GraduationCap, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { useFeatureTip } from "@/hooks/useFeatureTip";
import { FeatureTip } from "@/components/shared/FeatureTip";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClassStep, SectionStep, PickerBreadcrumb } from "@/components/school/SectionPickerSteps";
import {
  useSectionStudentsForRoll,
  type SectionStudentForRoll,
} from "@/hooks/useSectionStudentsForRoll";

interface UpdateRollNumberSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
  /** When set, restricts the picker to these section (class) ids — for
   *  coordinators (wing) and teachers (assigned classes). null/undefined = all. */
  allowedClassIds?: string[] | null;
  /** When set, only these students are listed/editable — teachers pass their
   *  subject-scoped roster (policy 2026-08-26: a teacher edits only students
   *  of their own subjects). null/undefined = no per-student restriction. */
  allowedStudentIds?: string[] | null;
  /** Open straight on this section's students, skipping the Class and
   *  Section steps (used from a student's profile). Ignored when the section
   *  is outside allowedClassIds; Back still walks up to the full picker. */
  initialSection?: RollNumberSheetSection | null;
}

export interface RollNumberSheetSection {
  classGroupId: string;
  classGroupName: string;
  classId: string;
  classLabel: string;
}

type Step = "class" | "section" | "students";

interface RollChange {
  student_id: string;
  roll_number: string;
}

export function UpdateRollNumberSheet({
  open,
  onOpenChange,
  institutionId,
  allowedClassIds,
  allowedStudentIds,
  initialSection,
}: UpdateRollNumberSheetProps) {
  const [step, setStep] = React.useState<Step>("class");
  const [classGroupId, setClassGroupId] = React.useState<string | null>(null);
  const [classGroupName, setClassGroupName] = React.useState<string>("");
  const [classId, setClassId] = React.useState<string | null>(null);
  const [classLabel, setClassLabel] = React.useState<string>("");

  // Lifted editable state — must live here so MobileSheet's primaryAction can read it.
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [originals, setOriginals] = React.useState<Record<string, string>>({});

  // Per-row save status state.
  const [rowStatus, setRowStatus] = React.useState<
    Record<string, "idle" | "saving" | "saved" | "error">
  >({});
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const queryClient = useQueryClient();

  const duplicates = React.useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const [id, raw] of Object.entries(drafts)) {
      const v = raw.trim();
      if (!v) continue;
      const arr = groups.get(v) ?? [];
      arr.push(id);
      groups.set(v, arr);
    }
    const dupIds = new Set<string>();
    const dupValues: string[] = [];
    for (const [v, ids] of groups) {
      if (ids.length >= 2) {
        dupValues.push(v);
        for (const id of ids) dupIds.add(id);
      }
    }
    return { dupIds, dupValues };
  }, [drafts]);

  const changedIds = React.useMemo(() => {
    const out: string[] = [];
    for (const [id, raw] of Object.entries(drafts)) {
      const orig = originals[id] ?? "";
      if (raw.trim() !== orig.trim()) out.push(id);
    }
    return out;
  }, [drafts, originals]);

  const saveDisabled =
    saving || duplicates.dupValues.length > 0 || changedIds.length === 0;

  // Single-flight: `saving` state lags a fast double click by one render.
  const savingRef = React.useRef(false);

  // Shared by Save Changes and Auto assign.
  const saveRolls = React.useCallback(async (changes: RollChange[]) => {
    if (!classId || changes.length === 0 || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    const ids = changes.map((c) => c.student_id);
    setRowError({});
    setRowStatus((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = "saving";
      return next;
    });

    try {
      // One call, one transaction. The server checks the section as it will
      // look AFTER the save, so shifts (5,6,7 -> 6,7,8) and swaps work, and a
      // refused save changes nothing. The old per-student loop checked each
      // row against the next row's not-yet-saved number and refused every
      // link of a shift but the last. The server also writes the audit rows.
      const { error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: number | null; error: unknown }>)("set_section_roll_numbers", {
        _class_id: classId,
        _changes: changes,
      });
      if (error) throw error;

      setRowStatus((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = "saved";
        return next;
      });
      // Drafts too: Auto assign saves numbers nobody typed into the list.
      const saved = (prev: Record<string, string>) => {
        const next = { ...prev };
        for (const c of changes) next[c.student_id] = c.roll_number;
        return next;
      };
      setOriginals(saved);
      setDrafts(saved);
      toast.success(`Updated ${ids.length} student${ids.length === 1 ? "" : "s"}.`);

      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      queryClient.invalidateQueries({ queryKey: ["section-students-for-roll", classId] });
      for (const id of ids) {
        queryClient.invalidateQueries({ queryKey: ["user-details", id] });
      }
    } catch (err) {
      setRowStatus((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      // The server names the clash ("Roll number 11 would be shared by A and
      // B"); the generic 23505 translation would hide who. Show that copy as
      // is, and route everything else through toastError.
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
      if (/would be shared by|no longer in this section/i.test(message)) {
        toast.error(message);
      } else {
        toastError(err, {
          fallback: "Couldn't save roll numbers. Nothing was changed.",
          context: "updateRollNumber.save",
        });
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [classId, queryClient]);

  const saveAll = React.useCallback(() => {
    if (saveDisabled) return;
    void saveRolls(changedIds.map((id) => ({ student_id: id, roll_number: drafts[id].trim() })));
  }, [saveDisabled, changedIds, drafts, saveRolls]);

  // Roll numbers are unique per SECTION (set_section_roll_numbers checks the
  // student's own class_id), so the edit state must be per section too. It is
  // keyed by student id and used to survive Back, which merged the previous
  // section's rows into the duplicate check and into the next Save.
  const leaveSection = React.useCallback(
    (navigate: () => void) => {
      if (saving) return;
      if (
        changedIds.length > 0 &&
        !window.confirm("You have unsaved roll number changes. Discard them and go back?")
      ) {
        return;
      }
      setDrafts({});
      setOriginals({});
      setRowStatus({});
      setRowError({});
      navigate();
    },
    [saving, changedIds.length]
  );

  // Reset on close so a fresh open always lands on Step 1.
  React.useEffect(() => {
    if (!open) {
      setStep("class");
      setClassGroupId(null);
      setClassGroupName("");
      setClassId(null);
      setClassLabel("");
      setDrafts({});
      setOriginals({});
      setRowStatus({});
      setRowError({});
      setSaving(false);
    }
  }, [open]);

  // Apply initialSection once per open. The ref stops a parent re-render
  // (a new allowedClassIds array) from yanking the user back to this section
  // after they have navigated elsewhere in the picker.
  const initialAppliedRef = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      initialAppliedRef.current = false;
      return;
    }
    if (initialAppliedRef.current || !initialSection) return;
    initialAppliedRef.current = true;
    if (allowedClassIds && !allowedClassIds.includes(initialSection.classId)) return;
    setClassGroupId(initialSection.classGroupId);
    setClassGroupName(initialSection.classGroupName);
    setClassId(initialSection.classId);
    setClassLabel(initialSection.classLabel);
    setStep("students");
  }, [open, initialSection, allowedClassIds]);

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
        if (!next && changedIds.length > 0) {
          const confirmed = window.confirm(
            "You have unsaved roll number changes. Discard and close?"
          );
          if (!confirmed) return;
        }
        onOpenChange(next);
      }}
      title="Update Roll Number"
      subtitle={subtitle}
      icon={<GraduationCap className="h-5 w-5 text-brand-primary" />}
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
                if (
                  changedIds.length === 0 ||
                  window.confirm(
                    "You have unsaved roll number changes. Discard and close?"
                  )
                ) {
                  onOpenChange(false);
                }
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
          emptyDescription="Use Manage Classes to add a class before assigning roll numbers."
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
          allowedStudentIds={allowedStudentIds}
          classGroupName={classGroupName}
          classLabel={classLabel}
          drafts={drafts}
          originals={originals}
          setDrafts={setDrafts}
          setOriginals={setOriginals}
          duplicates={duplicates}
          changedCount={changedIds.length}
          rowStatus={rowStatus}
          rowError={rowError}
          setRowStatus={setRowStatus}
          setRowError={setRowError}
          saving={saving}
          onSaveRolls={saveRolls}
          onBack={() =>
            leaveSection(() => {
              setClassId(null);
              setClassLabel("");
              setStep("section");
            })
          }
          onBackToClasses={() =>
            leaveSection(() => {
              setClassGroupId(null);
              setClassGroupName("");
              setClassId(null);
              setClassLabel("");
              setStep("class");
            })
          }
        />
      )}
    </MobileSheet>
  );
}

interface StudentsStepProps {
  classId: string;
  allowedStudentIds?: string[] | null;
  classGroupName: string;
  classLabel: string;
  drafts: Record<string, string>;
  originals: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setOriginals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  duplicates: { dupIds: Set<string>; dupValues: string[] };
  changedCount: number;
  // Task 4: per-row status props
  rowStatus: Record<string, "idle" | "saving" | "saved" | "error">;
  rowError: Record<string, string>;
  setRowStatus: React.Dispatch<
    React.SetStateAction<Record<string, "idle" | "saving" | "saved" | "error">>
  >;
  setRowError: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saving: boolean;
  onSaveRolls: (changes: RollChange[]) => Promise<void>;
  onBack: () => void;
  onBackToClasses: () => void;
}

/** Feature guide for Auto assign, shown the first time a user reaches a
 *  section here. A FEATURE guide, not the onboarding tour: see
 *  src/lib/featureTips.ts. Steps 0 and 1 point at the button, step 2 at the
 *  first roll number box. Bump the version in the id to show it again. */
const ROLL_GUIDE_ID = "roll-auto-assign-v1";
const ROLL_GUIDE = [
  {
    title: "Auto assign",
    body: "Numbers the whole section in alphabetical order of name: 1, 2, 3 and so on, in one tap.",
  },
  {
    title: "Nothing changes by surprise",
    body: "If students already have roll numbers, you first see whose number will change, before anything is saved.",
  },
  {
    title: "Or set them yourself",
    body: "Type a number next to any student, then press Save Changes.",
  },
];

function StudentsStep({
  classId,
  allowedStudentIds,
  classGroupName,
  classLabel,
  drafts,
  originals,
  setDrafts,
  setOriginals,
  duplicates,
  changedCount,
  rowStatus,
  rowError,
  setRowStatus,
  setRowError,
  saving,
  onSaveRolls,
  onBack,
  onBackToClasses,
}: StudentsStepProps) {
  const { data: sectionStudents, isLoading, isError } = useSectionStudentsForRoll(classId);

  // Teachers may only see/edit students of their own subjects; the DB gate
  // (can_edit_student_details -> teacher_controls_student) rejects the save
  // anyway, so this filter keeps the list honest rather than enforcing.
  const data = React.useMemo(() => {
    if (!sectionStudents) return sectionStudents;
    if (!allowedStudentIds) return sectionStudents;
    const allowed = new Set(allowedStudentIds);
    return sectionStudents.filter((s) => allowed.has(s.id));
  }, [sectionStudents, allowedStudentIds]);

  // Seed both drafts + originals from the section's data when it lands.
  React.useEffect(() => {
    if (!data) return;
    setOriginals((prev) => {
      const next = { ...prev };
      for (const s of data) if (!(s.id in next)) next[s.id] = s.roll_number ?? "";
      return next;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of data) if (!(s.id in next)) next[s.id] = s.roll_number ?? "";
      return next;
    });
  }, [data, setOriginals, setDrafts]);

  // Auto assign: 1..N in alphabetical order. Only offered when the list is
  // the whole section; a teacher who sees part of it cannot renumber the rest.
  // The list arrives sorted by roll number and Array.sort is stable, so two
  // students with the same name keep their current order.
  const autoAssign = React.useMemo(() => {
    if (!data || !sectionStudents || data.length === 0) return null;
    if (data.length !== sectionStudents.length) return null;
    const ordered = [...data].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base", numeric: true }),
    );
    const plan = ordered.map((s, i) => ({
      id: s.id,
      name: s.full_name,
      current: (originals[s.id] ?? s.roll_number ?? "").trim(),
      next: String(i + 1),
    }));
    return {
      plan,
      changes: plan
        .filter((p) => p.current !== p.next)
        .map((p) => ({ student_id: p.id, roll_number: p.next })),
      // Students who already HAVE a number that would change.
      overwritten: plan.filter((p) => p.current !== "" && p.current !== p.next),
    };
  }, [data, sectionStudents, originals]);

  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Feature guide: starts once the button is on screen (never during the
  // onboarding tour; useFeatureTip owns those rules).
  const guide = useFeatureTip(ROLL_GUIDE_ID, ROLL_GUIDE.length, autoAssign !== null);
  const guideStep = guide.step;

  const handleAutoAssign = () => {
    if (guideStep !== null) guide.end();
    if (!autoAssign) return;
    // Unsaved typing in the list would be replaced, so that always warns.
    if (changedCount > 0) {
      setConfirmOpen(true);
      return;
    }
    if (autoAssign.changes.length === 0) {
      toast.success("Roll numbers are already in alphabetical order.");
      return;
    }
    // Nobody loses an existing number: no warning needed.
    if (autoAssign.overwritten.length === 0) {
      void onSaveRolls(autoAssign.changes);
      return;
    }
    setConfirmOpen(true);
  };

  // Clear a row's saved/error status when the user re-edits it.
  const handleDraftChange = (id: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
    setRowStatus((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRowError((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  return (
    <>
      <PickerBreadcrumb
        items={[
          { label: "Classes", onClick: onBackToClasses },
          { label: classGroupName, onClick: onBack },
          { label: classLabel },
        ]}
        trailing={
          !isLoading && !isError && autoAssign ? (
            <FeatureTip
              open={guideStep === 0 || guideStep === 1}
              title={ROLL_GUIDE[guideStep === 1 ? 1 : 0].title}
              body={ROLL_GUIDE[guideStep === 1 ? 1 : 0].body}
              step={guideStep === 1 ? 1 : 0}
              total={ROLL_GUIDE.length}
              onNext={guide.next}
              onSkip={guide.end}
            >
              <Button
                type="button"
                size="sm"
                className={
                  "gap-1 bg-brand-primary text-white hover:bg-brand-primary/90" +
                  (guideStep === 0 || guideStep === 1 ? " ring-2 ring-brand-primary ring-offset-2" : "")
                }
                onClick={handleAutoAssign}
                disabled={saving}
                title="Auto assign roll numbers"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Auto assign
              </Button>
            </FeatureTip>
          ) : undefined
        }
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing roll numbers?</AlertDialogTitle>
            <AlertDialogDescription>
              {changedCount > 0
                ? "Roll numbers go in alphabetical order, replacing your unsaved changes."
                : "Roll numbers go in alphabetical order."}
              {autoAssign && autoAssign.overwritten.length > 0 && " These students' numbers will change:"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {autoAssign && autoAssign.overwritten.length > 0 && (
            <ul className="max-h-64 divide-y divide-surface-stroke overflow-y-auto rounded-lg border border-surface-stroke">
              {autoAssign.overwritten.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-ink-900">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-600">
                    {p.current} → {p.next}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!autoAssign) return;
                // Every row shows its alphabetical number, replacing any typing,
                // then only the numbers that differ from the saved ones are sent.
                setDrafts((prev) => {
                  const next = { ...prev };
                  for (const p of autoAssign.plan) next[p.id] = p.next;
                  return next;
                });
                if (autoAssign.changes.length > 0) void onSaveRolls(autoAssign.changes);
              }}
            >
              Auto assign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {duplicates.dupValues.length > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Duplicate roll numbers</p>
            <p>
              Multiple students share roll
              {duplicates.dupValues.length === 1 ? " number " : " numbers "}
              {duplicates.dupValues.join(", ")}. Resolve before saving.
            </p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-6 text-sm text-ink-600">Loading students…</div>
      )}
      {isError && (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Couldn't load students"
          description="Please go back and try again."
        />
      )}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students in this section"
          description="Assign students to this section first."
        />
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <form
          className="p-4"
          data-dirty={changedCount > 0 ? "true" : undefined}
          onSubmit={(e) => e.preventDefault()}
        >
          <ul className="surface-card frosted-shadow rounded-card divide-y divide-surface-stroke">
            {data.map((s: SectionStudentForRoll, index: number) => {
              const draft = drafts[s.id] ?? "";
              const isDup = duplicates.dupIds.has(s.id);
              const status = rowStatus[s.id] ?? "idle";
              const err = rowError[s.id];
              const guideTarget = index === 0 && guideStep === 2;
              const ringClass =
                status === "saved"
                  ? "ring-2 ring-emerald-500 focus-visible:ring-emerald-500"
                  : status === "error" || isDup
                    ? "ring-2 ring-red-500 focus-visible:ring-red-500"
                    : guideTarget
                      ? "ring-2 ring-brand-primary ring-offset-2"
                      : "";
              const input = (
                <Input
                  type="text"
                  inputMode="numeric"
                  value={draft}
                  disabled={status === "saving"}
                  onChange={(e) => handleDraftChange(s.id, e.target.value)}
                  aria-label={`Roll number for ${s.full_name}`}
                  aria-invalid={isDup || status === "error"}
                  className={"w-full sm:w-32 " + ringClass}
                />
              );
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <span className="text-sm font-medium text-ink-900">{s.full_name}</span>
                    {status === "saved" && (
                      <p className="text-xs text-emerald-600">Saved.</p>
                    )}
                    {status === "error" && err && (
                      <p className="text-xs text-red-600">{err}</p>
                    )}
                  </div>
                  {index === 0 ? (
                    <FeatureTip
                      open={guideTarget}
                      title={ROLL_GUIDE[2].title}
                      body={ROLL_GUIDE[2].body}
                      step={2}
                      total={ROLL_GUIDE.length}
                      onNext={guide.next}
                      onSkip={guide.end}
                    >
                      {input}
                    </FeatureTip>
                  ) : (
                    input
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            {changedCount === 0
              ? "No changes yet."
              : `${changedCount} change${changedCount === 1 ? "" : "s"} pending.`}
          </p>
        </form>
      )}
    </>
  );
}
