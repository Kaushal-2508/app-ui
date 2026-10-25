// src/components/olympiad/teacher/EditStudentSheet.tsx
import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useOlympiadEditStudent } from "@/hooks/olympiad/useOlympiadEditStudent";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";

type EditableFields = {
  full_name: string;
  section_label: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  student: RosterStudent | null;
};

export function EditStudentSheet({ open, onOpenChange, student }: Props) {
  const editStudent = useOlympiadEditStudent();
  const [fields, setFields] = useState<EditableFields>({
    full_name: "",
    section_label: "",
    parent_name: "",
    parent_phone: "",
    parent_email: "",
  });
  const initialRef = useRef<EditableFields>({
    full_name: "",
    section_label: "",
    parent_name: "",
    parent_phone: "",
    parent_email: "",
  });

  useEffect(() => {
    if (student && open) {
      const initial: EditableFields = {
        full_name: student.full_name,
        section_label: student.section_label ?? "",
        parent_name: student.parent_name,
        parent_phone: student.parent_phone,
        parent_email: student.parent_email ?? "",
      };
      setFields(initial);
      initialRef.current = initial;
    }
  }, [student, open]);

  const isDirty =
    fields.full_name !== initialRef.current.full_name ||
    fields.section_label !== initialRef.current.section_label ||
    fields.parent_name !== initialRef.current.parent_name ||
    fields.parent_phone !== initialRef.current.parent_phone ||
    fields.parent_email !== initialRef.current.parent_email;

  const phoneOk = /^[6-9]\d{9}$/.test(fields.parent_phone);
  const canSubmit =
    fields.full_name.trim() &&
    fields.parent_name.trim() &&
    phoneOk &&
    isDirty;

  const set = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const onSubmit = async () => {
    if (!canSubmit || !student) return;
    try {
      await editStudent.mutateAsync({
        oly_student_id: student.id,
        updates: {
          full_name: fields.full_name.trim(),
          section_label: fields.section_label.trim() || null,
          parent_name: fields.parent_name.trim(),
          parent_phone: fields.parent_phone,
          parent_email: fields.parent_email.trim() || null,
        },
      });
      onOpenChange(false);
    } catch {
      // toastError fires in the mutation's onError
    }
  };

  if (!student) return null;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit student"
      subtitle={student.full_name}
      primaryAction={{
        label: "Save changes",
        onClick: onSubmit,
        loading: editStudent.isPending,
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
        {/* Editable fields */}
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Student full name *</Label>
          <Input
            value={fields.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Section (optional)</Label>
          <Input
            value={fields.section_label}
            onChange={(e) => set("section_label", e.target.value)}
          />
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-xs font-medium text-ink-600">Parent contact</legend>
          <Input
            placeholder="Parent full name"
            value={fields.parent_name}
            onChange={(e) => set("parent_name", e.target.value)}
            required
          />
          <Input
            placeholder="Mobile number (10 digits)"
            value={fields.parent_phone}
            onChange={(e) =>
              set("parent_phone", e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            required
          />
          <Input
            type="email"
            placeholder="Email (optional)"
            value={fields.parent_email}
            onChange={(e) => set("parent_email", e.target.value)}
          />
          {fields.parent_phone && !phoneOk && (
            <p className="text-[11px] text-red-500">
              Enter a 10-digit Indian mobile (starts with 6–9)
            </p>
          )}
        </fieldset>

        {/* Locked fields */}
        <div className="space-y-2 pt-2 border-t border-surface-stroke">
          <p className="text-[11px] text-ink-500 flex items-center gap-1">
            <Lock className="h-3 w-3" /> Locked fields: contact SALCI to change
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-[11px] text-ink-400">Roll number</Label>
              <Input value={student.roll_number} readOnly disabled className="text-xs bg-ink-400/5" />
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px] text-ink-400">Date of birth</Label>
              <Input value={student.date_of_birth} readOnly disabled className="text-xs bg-ink-400/5" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-[11px] text-ink-400">Class</Label>
              <Input value={student.class_label} readOnly disabled className="text-xs bg-ink-400/5" />
            </div>
            {student.admission_number && (
              <div className="grid gap-1">
                <Label className="text-[11px] text-ink-400">Admission no.</Label>
                <Input
                  value={student.admission_number}
                  readOnly
                  disabled
                  className="text-xs bg-ink-400/5"
                />
              </div>
            )}
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-ink-400">Subjects</Label>
            <Input
              value={`${student.subject_ids.length} subjects selected`}
              readOnly
              disabled
              className="text-xs bg-ink-400/5"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-ink-400">Payment method</Label>
            <Input
              value={student.enrollment_channel === "teacher_cash" ? "Cash" : "Online (parent)"}
              readOnly
              disabled
              className="text-xs bg-ink-400/5"
            />
          </div>
        </div>
      </form>
    </MobileSheet>
  );
}
