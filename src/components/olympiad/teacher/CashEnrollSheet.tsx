// src/components/olympiad/teacher/CashEnrollSheet.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { SubjectPicker } from "@/components/olympiad/public/SubjectPicker";
import { OlympiadStudentCredentials } from "@/components/olympiad/teacher/OlympiadStudentCredentials";
import { useOlympiadCashEnroll } from "@/hooks/olympiad/useOlympiadCashEnroll";
import { useOlympiadAssignedClasses } from "@/hooks/olympiad/useOlympiadAssignedClasses";
import { useOlympiadGradeSubjects } from "@/hooks/olympiad/useOlympiadGradeSubjects";
import {
  useOlympiadSalciRoster, type SalciRosterStudent,
} from "@/hooks/olympiad/useOlympiadSalciRoster";

type Subject = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  gradeLevelId: string;
  classLabel: string;
  availableSubjects: Subject[];
  isExistingSalciSchool: boolean;
};

export function CashEnrollSheet(props: Props) {
  return props.isExistingSalciSchool ? (
    <RosterCashEnrollSheet {...props} />
  ) : (
    <ManualCashEnrollSheet {...props} />
  );
}

type FormState = {
  fullName: string;
  dob: string;
  sectionLabel: string;
  admissionNumber: string;
  subjectIds: string[];
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  feeCollected: boolean;
};

const INITIAL: FormState = {
  fullName: "",
  dob: "",
  sectionLabel: "",
  admissionNumber: "",
  subjectIds: [],
  parentName: "",
  parentPhone: "",
  parentEmail: "",
  feeCollected: false,
};

function ManualCashEnrollSheet({
  open,
  onOpenChange,
  olySchoolId,
  gradeLevelId,
  classLabel,
  availableSubjects,
}: Props) {
  const enroll = useOlympiadCashEnroll();
  const [form, setForm] = useState<FormState>(INITIAL);
  const initialRef = useRef<FormState>(INITIAL);
  // After a successful enroll we reveal the student's sign-in details instead of
  // closing, so the teacher can hand over the roll number + date of birth.
  const [result, setResult] = useState<
    { rollNumber: string; dob: string; loginReady: boolean } | null
  >(null);

  const isDirty =
    form.fullName !== initialRef.current.fullName ||
    form.dob !== initialRef.current.dob ||
    form.parentName !== initialRef.current.parentName;

  const phoneOk = /^[6-9]\d{9}$/.test(form.parentPhone);
  const canSubmit =
    form.fullName.trim() &&
    form.dob &&
    form.subjectIds.length === 3 &&
    form.parentName.trim() &&
    phoneOk &&
    form.feeCollected;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      const result = await enroll.mutateAsync({
        oly_school_id: olySchoolId,
        form_data: {
          full_name: form.fullName.trim(),
          date_of_birth: form.dob,
          class_label: classLabel,
          section_label: form.sectionLabel.trim() || null,
          grade_level_id: gradeLevelId,
          admission_number: form.admissionNumber.trim() || null,
          subject_ids: form.subjectIds,
          parent_name: form.parentName.trim(),
          parent_phone: form.parentPhone,
          parent_email: form.parentEmail.trim() || null,
          fee_collected: form.feeCollected,
        },
      });
      // Narrow on the success-only field: the optional `blocked?: false` on the
      // success variant means `"blocked" in result` doesn't discriminate.
      if (!("oly_student_id" in result)) {
        toast.error(result.message);
        return;
      }
      // Reveal the sign-in details; keep the sheet open.
      setResult({
        rollNumber: result.roll_number,
        dob: form.dob,
        loginReady: result.login_ready !== false,
      });
    } catch {
      // toastError fires in the mutation's onError
    }
  };

  const closeAndReset = (o: boolean) => {
    if (!o) {
      setForm(INITIAL);
      setResult(null);
    }
    onOpenChange(o);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={closeAndReset}
      title={result ? "Student enrolled" : "Enroll cash student"}
      subtitle={result ? "Share the sign-in details with the student" : classLabel}
      primaryAction={
        result
          ? { label: "Done", onClick: () => closeAndReset(false) }
          : {
              label: "Enroll",
              onClick: onSubmit,
              loading: enroll.isPending,
              disabled: !canSubmit,
            }
      }
      secondaryAction={
        result
          ? {
              label: "Enroll another",
              onClick: () => {
                setResult(null);
                setForm(INITIAL);
              },
            }
          : { label: "Cancel", onClick: () => onOpenChange(false) }
      }
    >
      {result ? (
        <OlympiadStudentCredentials
          name={form.fullName.trim()}
          rollNumber={result.rollNumber}
          dob={result.dob}
          loginReady={result.loginReady}
        />
      ) : (
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Student full name *</Label>
          <Input
            value={form.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Date of birth *</Label>
            <Input
              type="date"
              value={form.dob}
              onChange={(e) => set("dob", e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Class</Label>
            <Input value={classLabel} readOnly disabled className="bg-ink-400/5" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Section (optional)</Label>
            <Input
              value={form.sectionLabel}
              onChange={(e) => set("sectionLabel", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Admission no. (optional)</Label>
            <Input
              value={form.admissionNumber}
              onChange={(e) => set("admissionNumber", e.target.value)}
            />
          </div>
        </div>

        {availableSubjects.length >= 3 ? (
          <SubjectPicker
            subjects={availableSubjects}
            value={form.subjectIds}
            onChange={(ids) => set("subjectIds", ids)}
            max={3}
          />
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {classLabel || "This class"} needs at least 3 Olympiad subjects before you can enroll
              students
              {availableSubjects.length > 0 ? ` (only ${availableSubjects.length} set up so far)` : ""}.
              Ask your SALCI administrator to add subjects for this class.
            </span>
          </div>
        )}

        <fieldset className="grid gap-2">
          <legend className="text-xs font-medium text-ink-600">Parent contact *</legend>
          <Input
            placeholder="Parent full name"
            value={form.parentName}
            onChange={(e) => set("parentName", e.target.value)}
            required
          />
          <Input
            placeholder="Mobile number (10 digits)"
            value={form.parentPhone}
            onChange={(e) => set("parentPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
            required
          />
          <Input
            type="email"
            placeholder="Email (optional)"
            value={form.parentEmail}
            onChange={(e) => set("parentEmail", e.target.value)}
          />
          {form.parentPhone && !phoneOk && (
            <p className="text-[11px] text-red-500">
              Enter a 10-digit Indian mobile (starts with 6–9)
            </p>
          )}
        </fieldset>

        <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 px-4 py-3 cursor-pointer">
          <Checkbox
            id="fee-collected"
            checked={form.feeCollected}
            onCheckedChange={(v) => set("feeCollected", !!v)}
            className="mt-0.5"
          />
          <span className="text-sm text-ink-800 dark:text-ink-300">
            <strong className="font-semibold text-amber-800 dark:text-amber-300">
              Fee collected from parent
            </strong>
            <br />
            <span className="text-xs text-ink-600">
              Check this box only after physically collecting the exam fee in cash.
            </span>
          </span>
        </label>
      </form>
      )}
    </MobileSheet>
  );
}

type RosterForm = {
  gradeLevelId: string;
  sectionFilter: string; // "" = all sections
  profileId: string;
  dob: string;
  subjectIds: string[];
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  feeCollected: boolean;
};

const ROSTER_INITIAL: RosterForm = {
  gradeLevelId: "",
  sectionFilter: "",
  profileId: "",
  dob: "",
  subjectIds: [],
  guardianName: "",
  guardianPhone: "",
  guardianEmail: "",
  feeCollected: false,
};

function RosterCashEnrollSheet({
  open,
  onOpenChange,
  olySchoolId,
  gradeLevelId,
  classLabel: pageClassLabel,
}: Props) {
  const enroll = useOlympiadCashEnroll();
  const [form, setForm] = useState<RosterForm>({ ...ROSTER_INITIAL, gradeLevelId });

  const set = <K extends keyof RosterForm>(key: K, value: RosterForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // The teacher's Olympiad grades for THIS school (class dropdown source).
  const { data: assigned = [] } = useOlympiadAssignedClasses();
  const myGrades = useMemo(
    () => assigned.filter((a) => a.oly_school_id === olySchoolId),
    [assigned, olySchoolId],
  );

  const { data: subjects = [] } = useOlympiadGradeSubjects(form.gradeLevelId || undefined);
  const { data: roster = [], isLoading: rosterLoading } = useOlympiadSalciRoster(
    olySchoolId,
    form.gradeLevelId || undefined,
    open,
  );

  // Default grade for a fresh open: the page's grade, else the sole assigned grade.
  // Held in a ref so the reset reacts to `open`/`gradeLevelId` only and never
  // re-runs (clobbering an in-progress selection) when `myGrades` resolves
  // asynchronously.
  const defaultGradeRef = useRef("");
  defaultGradeRef.current =
    gradeLevelId || (myGrades.length === 1 ? myGrades[0].grade_level_id : "");

  // Reset to the page's grade when the sheet opens AND whenever the page's grade
  // changes (navigating between class pages with the sheet mounted) — otherwise a
  // stale grade from a prior page would persist. A manual dropdown change only
  // moves form.gradeLevelId (not the gradeLevelId prop), so it is preserved.
  useEffect(() => {
    if (open) setForm({ ...ROSTER_INITIAL, gradeLevelId: defaultGradeRef.current });
  }, [open, gradeLevelId]);

  // Distinct sections present in the roster.
  const sections = useMemo(() => {
    const seen = new Set<string>();
    for (const r of roster) if (r.section_label) seen.add(r.section_label);
    return Array.from(seen).sort();
  }, [roster]);

  // Auto-select the only section as the filter (still a filter, not the written value).
  // Functional update keeps `form` out of the dep array — deps are just [sections].
  useEffect(() => {
    if (sections.length === 1) {
      setForm((prev) => (prev.sectionFilter === "" ? { ...prev, sectionFilter: sections[0] } : prev));
    }
  }, [sections]);

  const selectedGrade = myGrades.find((g) => g.grade_level_id === form.gradeLevelId);
  const classLabel = selectedGrade
    ? selectedGrade.grade_number != null
      ? `Class ${selectedGrade.grade_number}`
      : selectedGrade.grade_name
    : form.gradeLevelId === gradeLevelId
      ? pageClassLabel
      : "";

  const visibleStudents = useMemo(
    () =>
      roster.filter(
        (r) => form.sectionFilter === "" || r.section_label === form.sectionFilter,
      ),
    [roster, form.sectionFilter],
  );

  const studentOptions: SearchableSelectOption[] = visibleStudents.map((s) => ({
    value: s.profile_id,
    label: s.admission_number ? `${s.full_name} · ${s.admission_number}` : s.full_name,
    description: s.already_enrolled
      ? `Already enrolled${s.enrolled_roll_number ? ` · ${s.enrolled_roll_number}` : ""}`
      : form.sectionFilter === "" && s.section_label
        ? `Section ${s.section_label}`
        : undefined,
    disabled: s.already_enrolled,
  }));

  const selectedStudent: SalciRosterStudent | undefined = roster.find(
    (r) => r.profile_id === form.profileId,
  );

  const onPickStudent = (profileId: string) => {
    const s = roster.find((r) => r.profile_id === profileId);
    setForm((prev) => ({
      ...prev,
      profileId,
      dob: s?.date_of_birth ?? "",
      guardianName: s?.guardian_name ?? "",
      guardianPhone: s?.guardian_phone ?? "",
      guardianEmail: s?.guardian_email ?? "",
    }));
  };

  const phoneOk = /^[6-9]\d{9}$/.test(form.guardianPhone);
  const canSubmit =
    !!form.profileId &&
    !!classLabel &&
    !!form.dob &&
    form.subjectIds.length === 3 &&
    !!form.guardianName.trim() &&
    phoneOk &&
    form.feeCollected;

  const isDirty = !!form.profileId || form.subjectIds.length > 0 || !!form.guardianName;

  const reset = () => setForm({ ...ROSTER_INITIAL, gradeLevelId });

  const onSubmit = async () => {
    // Re-check already_enrolled: the roster may refetch while the sheet is open
    // and flip a selected student to enrolled (the server also blocks this).
    if (!canSubmit || !selectedStudent || selectedStudent.already_enrolled) return;
    try {
      const result = await enroll.mutateAsync({
        oly_school_id: olySchoolId,
        form_data: {
          full_name: selectedStudent.full_name,
          date_of_birth: form.dob,
          class_label: classLabel,
          section_label: selectedStudent.section_label,
          grade_level_id: form.gradeLevelId,
          admission_number: selectedStudent.admission_number,
          subject_ids: form.subjectIds,
          parent_name: form.guardianName.trim(),
          parent_phone: form.guardianPhone,
          parent_email: form.guardianEmail.trim() || null,
          fee_collected: form.feeCollected,
          profile_id: form.profileId,
        },
      });
      if ("blocked" in result && result.blocked) {
        toast.error(result.message);
        return;
      }
      reset();
      onOpenChange(false);
    } catch {
      // toastError fires in the mutation's onError
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Enroll cash student"
      subtitle={classLabel || undefined}
      primaryAction={{
        label: "Enroll",
        onClick: onSubmit,
        loading: enroll.isPending,
        disabled: !canSubmit,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        {/* Class (grade) */}
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Class *</Label>
          <Select
            value={form.gradeLevelId}
            onValueChange={(v) =>
              setForm({ ...ROSTER_INITIAL, gradeLevelId: v })
            }
            disabled={myGrades.length <= 1}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {myGrades.map((g) => (
                <SelectItem key={g.grade_level_id} value={g.grade_level_id}>
                  {g.grade_number != null ? `Class ${g.grade_number}` : g.grade_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Section filter */}
        {sections.length > 0 && (
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Section</Label>
            <Select
              value={form.sectionFilter || "__all__"}
              onValueChange={(v) => {
                set("sectionFilter", v === "__all__" ? "" : v);
                set("profileId", "");
              }}
              disabled={sections.length <= 1}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sections</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s} value={s}>
                    Section {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Student */}
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Student *</Label>
          <SearchableSelect
            value={form.profileId}
            onValueChange={onPickStudent}
            options={studentOptions}
            placeholder={rosterLoading ? "Loading students…" : "Select a student"}
            searchPlaceholder="Search by name or admission no."
            emptyText={rosterLoading ? "Loading…" : "No students found for this class."}
            disabled={rosterLoading || !form.gradeLevelId}
          />
        </div>

        {/* DOB — pre-filled if stored, else entered */}
        {form.profileId && (
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Date of birth *</Label>
            <Input
              type="date"
              value={form.dob}
              onChange={(e) => set("dob", e.target.value)}
              required
            />
          </div>
        )}

        {/* Subjects */}
        {form.profileId && subjects.length > 0 && (
          <SubjectPicker
            subjects={subjects}
            value={form.subjectIds}
            onChange={(ids) => set("subjectIds", ids)}
            max={3}
          />
        )}

        {/* Guardian contact */}
        {form.profileId && (
          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-ink-600">Guardian contact *</legend>
            <Input
              placeholder="Guardian full name"
              value={form.guardianName}
              onChange={(e) => set("guardianName", e.target.value)}
              required
            />
            <Input
              placeholder="Mobile number (10 digits)"
              value={form.guardianPhone}
              onChange={(e) => set("guardianPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
              required
            />
            <Input
              type="email"
              placeholder="Email (optional)"
              value={form.guardianEmail}
              onChange={(e) => set("guardianEmail", e.target.value)}
            />
            {form.guardianPhone && !phoneOk && (
              <p className="text-[11px] text-red-500">
                Enter a 10-digit Indian mobile (starts with 6–9)
              </p>
            )}
          </fieldset>
        )}

        {/* Fee collected */}
        {form.profileId && (
          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 px-4 py-3 cursor-pointer">
            <Checkbox
              id="fee-collected"
              checked={form.feeCollected}
              onCheckedChange={(v) => set("feeCollected", !!v)}
              className="mt-0.5"
            />
            <span className="text-sm text-ink-800 dark:text-ink-300">
              <strong className="font-semibold text-amber-800 dark:text-amber-300">
                Fee collected from parent
              </strong>
              <br />
              <span className="text-xs text-ink-600">
                Check this box only after physically collecting the exam fee in cash.
              </span>
            </span>
          </label>
        )}
      </form>
    </MobileSheet>
  );
}
