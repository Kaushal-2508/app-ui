import * as React from "react";
import { AlertTriangle, ArrowRightLeft, Users } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";
import { formatClassName } from "@/lib/utils";
import { invalidateSchoolData } from "@/lib/queryKeys";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ClassStep, SectionStep, PickerBreadcrumb } from "@/components/school/SectionPickerSteps";
import { useInstitutionClasses } from "@/hooks/useWingClasses";
import { useSectionRollNumbers } from "@/hooks/useSectionRollNumbers";
import {
  useSectionStudentsForRoll,
  type SectionStudentForRoll,
} from "@/hooks/useSectionStudentsForRoll";

interface UpdateClassSectionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
  /** When set, restricts BOTH the source picker and the destination dropdown to
   *  these section (class) ids — for wing-scoped coordinators. null/undefined = all. */
  allowedClassIds?: string[] | null;
}

type Step = "class" | "section" | "students";

interface DestinationOption {
  id: string;
  label: string;
  className: string;
  academicYear: string;
}

export function UpdateClassSectionSheet({
  open,
  onOpenChange,
  institutionId,
  allowedClassIds,
}: UpdateClassSectionSheetProps) {
  const [step, setStep] = React.useState<Step>("class");
  const [classGroupId, setClassGroupId] = React.useState<string | null>(null);
  const [classGroupName, setClassGroupName] = React.useState<string>("");
  const [classId, setClassId] = React.useState<string | null>(null);
  const [classLabel, setClassLabel] = React.useState<string>("");

  // Lifted editable state — MobileSheet's primaryAction reads it from here.
  // drafts: studentId → destination class id. Seeded with the source section,
  // so "changed" simply means the draft no longer equals the source.
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [originals, setOriginals] = React.useState<Record<string, string>>({});
  // studentId → name, seeded with the roster so the audit row can name them.
  const [names, setNames] = React.useState<Record<string, string>>({});

  const [rowStatus, setRowStatus] = React.useState<
    Record<string, "idle" | "saving" | "saved" | "error">
  >({});
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [movedLabel, setMovedLabel] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const queryClient = useQueryClient();

  // Destination sections. useInstitutionClasses inherits the app-wide 60s
  // staleTime and returns active classes only, already in canonical order.
  const { data: allClasses, isError: classesError } = useInstitutionClasses(institutionId);

  const destinations = React.useMemo<DestinationOption[]>(() => {
    const allowed = allowedClassIds ? new Set(allowedClassIds) : null;
    return (allClasses ?? [])
      .filter((c) => !allowed || allowed.has(c.id))
      .map((c) => ({
        id: c.id,
        label: formatClassName(c.name, c.section),
        className: c.name,
        academicYear: c.academic_year,
      }));
  }, [allClasses, allowedClassIds]);

  const destinationLabel = React.useCallback(
    (id: string) => destinations.find((d) => d.id === id)?.label ?? "another section",
    [destinations]
  );

  const changedIds = React.useMemo(() => {
    const out: string[] = [];
    for (const [id, target] of Object.entries(drafts)) {
      if (target && target !== (originals[id] ?? "")) out.push(id);
    }
    return out;
  }, [drafts, originals]);

  const saveDisabled = saving || changedIds.length === 0;

  // The source roster is deliberately NOT invalidated right after a save —
  // moved students would vanish mid-list and take their "Moved to 6 - B"
  // confirmation with them. It refreshes when the user leaves this section.
  const staleSourceIds = React.useRef<Set<string>>(new Set());

  const flushSourceRefresh = React.useCallback(() => {
    for (const id of staleSourceIds.current) {
      queryClient.invalidateQueries({ queryKey: ["section-students-for-roll", id] });
    }
    staleSourceIds.current.clear();
  }, [queryClient]);

  const saveAll = React.useCallback(async () => {
    if (saveDisabled) return;
    setSaving(true);

    try {
      let okCount = 0;
      let failCount = 0;
      const touchedTargets = new Set<string>();

      // One RPC per moved student, sequentially. A batch RPC would be fewer
      // round-trips, but it would collapse N outcomes into one — and the whole
      // point of this screen is that a student who can't be moved says so on
      // their own row while the rest still go through. The load profile is one
      // admin moving a handful of students, not a student-facing hot path.
      for (const id of changedIds) {
        setRowStatus((prev) => ({ ...prev, [id]: "saving" }));
        setRowError((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });

        const target = drafts[id];
        try {
          const { error } = await supabase.rpc("set_student_class", {
            _student: id,
            _class: target,
          });
          if (error) throw error;

          setRowStatus((prev) => ({ ...prev, [id]: "saved" }));
          setOriginals((prev) => ({ ...prev, [id]: target }));
          setMovedLabel((prev) => ({ ...prev, [id]: destinationLabel(target) }));
          touchedTargets.add(target);
          if (classId) staleSourceIds.current.add(classId);

          void logActivityEvent({
            action: "student_class_updated",
            entityType: "Student",
            entityId: id,
            entityName: names[id] ?? null,
            metadata: {
              institution_id: institutionId ?? null,
              moved_to: destinationLabel(target),
              moved_from: classLabel || null,
            },
          });
          okCount++;
        } catch (err) {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : "Couldn't move this student.";
          setRowStatus((prev) => ({ ...prev, [id]: "error" }));
          setRowError((prev) => ({ ...prev, [id]: message }));
          failCount++;
        }
      }

      // Invalidate once, after the whole batch.
      invalidateSchoolData(queryClient, institutionId ?? undefined);
      for (const target of touchedTargets) {
        queryClient.invalidateQueries({
          queryKey: ["section-students-for-roll", target],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["section-roll-numbers"] });
      for (const id of changedIds) {
        queryClient.invalidateQueries({ queryKey: ["user-details", id] });
      }

      if (failCount === 0) {
        toast.success(`Moved ${okCount} student${okCount === 1 ? "" : "s"}.`);
      } else if (okCount === 0) {
        toastError(new Error("Every move failed."), {
          fallback: `All ${failCount} move${failCount === 1 ? "" : "s"} failed. See the per-row messages.`,
          context: "updateClassSection.saveAll",
        });
      } else {
        toast.warning(
          `Moved ${okCount} of ${okCount + failCount}. Fix the ${failCount} red row${failCount === 1 ? "" : "s"} and retry.`
        );
      }
    } finally {
      setSaving(false);
    }
  }, [
    saveDisabled,
    changedIds,
    drafts,
    names,
    classId,
    classLabel,
    institutionId,
    destinationLabel,
    queryClient,
  ]);

  // Reset on close so a fresh open always lands on Step 1.
  React.useEffect(() => {
    if (!open) {
      flushSourceRefresh();
      setStep("class");
      setClassGroupId(null);
      setClassGroupName("");
      setClassId(null);
      setClassLabel("");
      setDrafts({});
      setOriginals({});
      setNames({});
      setRowStatus({});
      setRowError({});
      setMovedLabel({});
      setSaving(false);
    }
  }, [open, flushSourceRefresh]);

  const leaveStudentsStep = React.useCallback(() => {
    flushSourceRefresh();
    setDrafts({});
    setOriginals({});
    setNames({});
    setRowStatus({});
    setRowError({});
    setMovedLabel({});
  }, [flushSourceRefresh]);

  const confirmDiscard = () =>
    changedIds.length === 0 ||
    window.confirm("You have unsaved class changes. Discard and close?");

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
        if (!next && !confirmDiscard()) return;
        onOpenChange(next);
      }}
      title="Update Class & Section"
      subtitle={subtitle}
      icon={<ArrowRightLeft className="h-5 w-5 text-brand-primary" />}
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
                if (confirmDiscard()) onOpenChange(false);
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
          emptyDescription="Use Manage Classes to add a class before moving students."
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
          destinations={destinations}
          destinationsError={classesError}
          drafts={drafts}
          setDrafts={setDrafts}
          setOriginals={setOriginals}
          setNames={setNames}
          changedCount={changedIds.length}
          rowStatus={rowStatus}
          rowError={rowError}
          movedLabel={movedLabel}
          setRowStatus={setRowStatus}
          setRowError={setRowError}
          onBack={() => {
            if (!confirmDiscard()) return;
            leaveStudentsStep();
            setClassId(null);
            setClassLabel("");
            setStep("section");
          }}
          onBackToClasses={() => {
            if (!confirmDiscard()) return;
            leaveStudentsStep();
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
  destinations: DestinationOption[];
  destinationsError: boolean;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setOriginals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  changedCount: number;
  rowStatus: Record<string, "idle" | "saving" | "saved" | "error">;
  rowError: Record<string, string>;
  movedLabel: Record<string, string>;
  setRowStatus: React.Dispatch<
    React.SetStateAction<Record<string, "idle" | "saving" | "saved" | "error">>
  >;
  setRowError: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onBack: () => void;
  onBackToClasses: () => void;
}

function StudentsStep({
  classId,
  classGroupName,
  classLabel,
  destinations,
  destinationsError,
  drafts,
  setDrafts,
  setOriginals,
  setNames,
  changedCount,
  rowStatus,
  rowError,
  movedLabel,
  setRowStatus,
  setRowError,
  onBack,
  onBackToClasses,
}: StudentsStepProps) {
  const { data, isLoading, isError } = useSectionStudentsForRoll(classId);

  // Seed both drafts + originals with the section the student is in today.
  React.useEffect(() => {
    if (!data) return;
    setOriginals((prev) => {
      const next = { ...prev };
      for (const s of data) if (!(s.id in next)) next[s.id] = classId;
      return next;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of data) if (!(s.id in next)) next[s.id] = classId;
      return next;
    });
    setNames((prev) => {
      const next = { ...prev };
      for (const s of data) next[s.id] = s.full_name;
      return next;
    });
  }, [data, classId, setOriginals, setDrafts, setNames]);

  // Only the sections someone actually picked get their rolls loaded.
  const pendingTargets = React.useMemo(
    () =>
      [...new Set(Object.values(drafts).filter((t) => t && t !== classId))],
    [drafts, classId]
  );
  const { data: rollsByClass } = useSectionRollNumbers(pendingTargets);

  const options = React.useMemo(
    () =>
      destinations.map((d) => ({
        value: d.id,
        label: d.label,
        description: d.academicYear,
        group: d.className,
      })),
    [destinations]
  );

  /** studentId → who already holds that roll number in the chosen destination. */
  const rollClashes = React.useMemo(() => {
    const out: Record<string, { holder: string; where: string }> = {};
    if (!data) return out;

    const byRoll = new Map<string, string>(); // `${target}|${roll}` → first mover's name
    for (const s of data) {
      const target = drafts[s.id];
      const roll = s.roll_number?.trim();
      if (!target || target === classId || !roll) continue;

      const where = destinations.find((d) => d.id === target)?.label ?? "that section";
      const existing = rollsByClass?.get(target)?.get(roll);
      if (existing) {
        out[s.id] = { holder: existing, where };
        continue;
      }
      // Two students moved into the same section with the same roll clash
      // with each other, and no query can see that — it only exists in drafts.
      const key = `${target}|${roll}`;
      const firstMover = byRoll.get(key);
      if (firstMover) out[s.id] = { holder: firstMover, where };
      else byRoll.set(key, s.full_name);
    }
    return out;
  }, [data, drafts, classId, destinations, rollsByClass]);

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
      />

      {destinationsError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Couldn't load the list of classes to move students into. Close this and try again.</p>
        </div>
      )}

      {isLoading && <div className="p-6 text-sm text-ink-600">Loading students…</div>}
      {isError && (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Couldn't load students"
          description="Please go back and try again."
          reason="error"
        />
      )}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students in this section"
          description="Assign students to this section first."
          reason="noData"
        />
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <form
          className="p-4"
          data-dirty={changedCount > 0 ? "true" : undefined}
          onSubmit={(e) => e.preventDefault()}
        >
          <ul className="surface-card frosted-shadow rounded-card divide-y divide-surface-stroke">
            {data.map((s: SectionStudentForRoll) => {
              const draft = drafts[s.id] ?? classId;
              const status = rowStatus[s.id] ?? "idle";
              const err = rowError[s.id];
              const clash = rollClashes[s.id];
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-ink-900">{s.full_name}</span>
                    {s.roll_number && (
                      <span className="ml-2 text-xs text-ink-500">Roll {s.roll_number}</span>
                    )}
                    {status === "saved" && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Moved to {movedLabel[s.id] ?? "the new section"}.
                      </p>
                    )}
                    {status === "error" && err && (
                      <p className="text-xs text-red-600 dark:text-red-400">{err}</p>
                    )}
                    {status !== "saved" && clash && (
                      <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span>
                          Roll {s.roll_number} is already used by {clash.holder} in {clash.where}.
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="w-full shrink-0 sm:w-60">
                    <SearchableSelect
                      value={draft}
                      onValueChange={(v) => handleDraftChange(s.id, v)}
                      options={options}
                      disabled={status === "saving" || options.length === 0}
                      placeholder="Select a section"
                      searchPlaceholder="Search classes…"
                      emptyText="No classes available."
                      triggerClassName={
                        status === "saved"
                          ? "ring-2 ring-emerald-500"
                          : status === "error"
                            ? "ring-2 ring-red-500"
                            : draft !== classId
                              ? "ring-2 ring-brand-primary"
                              : undefined
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            {changedCount === 0
              ? "No changes yet. Pick a different class or section for a student to move them."
              : `${changedCount} move${changedCount === 1 ? "" : "s"} pending.`}
          </p>
        </form>
      )}
    </>
  );
}
