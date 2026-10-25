import { useState } from "react";
import { format } from "date-fns";
import { User, Pencil, Loader2, X, ListOrdered } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateStudentDetails } from "@/hooks/useStudentDetails";

export interface StudentPersonalDetailsShape {
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
}

interface StudentDetailsCardProps {
  studentId: string;
  /** Admin / coordinator — shows the Edit button (server still enforces). */
  canManage: boolean;
  fullName: string | null;
  rollNumber: string | null;
  admissionNumber: string | null;
  phone: string | null;
  personalDetails: StudentPersonalDetailsShape | null;
  /** When set, the Roll Number field gets an "Edit whole class" button that hands
   *  off to the page's Update Roll Number sheet for this student's section. */
  onOpenBulkRollNumbers?: () => void;
}

type FormState = {
  fullName: string;
  rollNumber: string;
  admissionNumber: string;
  phone: string;
  dateOfBirth: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
};

const seed = (p: StudentDetailsCardProps): FormState => ({
  fullName: p.fullName ?? "",
  rollNumber: p.rollNumber ?? "",
  admissionNumber: p.admissionNumber ?? "",
  phone: p.phone ?? "",
  dateOfBirth: p.personalDetails?.date_of_birth ?? "",
  guardianName: p.personalDetails?.guardian_name ?? "",
  guardianPhone: p.personalDetails?.guardian_phone ?? "",
  guardianEmail: p.personalDetails?.guardian_email ?? "",
});

export function StudentDetailsCard(props: StudentDetailsCardProps) {
  const { studentId, canManage, personalDetails } = props;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => seed(props));
  const update = useUpdateStudentDetails();

  const startEdit = () => {
    setForm(seed(props));
    setEditing(true);
  };

  const setField = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    update.mutate(
      { studentId, ...form },
      { onSuccess: () => setEditing(false) },
    );
  };

  // Leaving for the bulk sheet closes this profile, so unsaved edits here
  // would vanish silently; ask first, the same way the bulk sheet does.
  const openBulkRollNumbers = () => {
    if (!props.onOpenBulkRollNumbers) return;
    const original = seed(props);
    const dirty = (Object.keys(form) as (keyof FormState)[]).some(
      (k) => form[k].trim() !== original[k].trim(),
    );
    if (
      dirty &&
      !window.confirm("You have unsaved changes to this student. Discard them and open the roll number list?")
    ) {
      return;
    }
    setEditing(false);
    props.onOpenBulkRollNumbers();
  };

  // ---- View mode: only the fields we actually have ----
  if (!editing) {
    const rows = [
      { label: "Full Name", value: props.fullName },
      { label: "Roll Number", value: props.rollNumber },
      { label: "Admission Number", value: props.admissionNumber },
      { label: "Phone", value: props.phone },
      {
        label: "Date of Birth",
        value: personalDetails?.date_of_birth
          ? format(new Date(`${personalDetails.date_of_birth}T12:00:00`), "PP")
          : null,
      },
      { label: "Guardian Name", value: personalDetails?.guardian_name },
      { label: "Guardian Phone", value: personalDetails?.guardian_phone },
      { label: "Guardian Email", value: personalDetails?.guardian_email },
    ].filter((r) => r.value);

    // Nothing to show and can't edit → render nothing.
    if (rows.length === 0 && !canManage) return null;

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <User className="h-4 w-4" />
            Student Details
          </CardTitle>
          {canManage && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm">
          {rows.length > 0 ? (
            rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground shrink-0">{row.label}</span>
                <span className="font-medium text-right break-all">{row.value}</span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No details added yet. Click Edit to add them.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ---- Edit mode: every field ----
  const fields: { key: keyof FormState; label: string; type?: string; placeholder?: string }[] = [
    { key: "fullName", label: "Full Name", placeholder: "Student's full name" },
    { key: "rollNumber", label: "Roll Number", placeholder: "e.g. 01" },
    { key: "admissionNumber", label: "Admission Number", placeholder: "e.g. AIS12641" },
    { key: "phone", label: "Phone", type: "tel", placeholder: "Phone number" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "guardianName", label: "Guardian Name", placeholder: "Parent / guardian name" },
    { key: "guardianPhone", label: "Guardian Phone", type: "tel", placeholder: "Guardian phone" },
    { key: "guardianEmail", label: "Guardian Email", type: "email", placeholder: "Guardian email" },
  ];

  return (
    <Card data-dirty="true">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <User className="h-4 w-4" />
          Edit Student Details
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setEditing(false)}
          disabled={update.isPending}
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`sd-${f.key}`} className="text-xs text-muted-foreground">
              {f.label}
            </Label>
            {f.key === "rollNumber" && props.onOpenBulkRollNumbers ? (
              <div className="relative">
                <Input
                  id={`sd-${f.key}`}
                  type={f.type ?? "text"}
                  value={form[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setField(f.key)(e.target.value)}
                  disabled={update.isPending}
                  className="pr-40"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 h-8 -translate-y-1/2 gap-1 px-2 text-xs text-brand-primary hover:bg-brand-primary/10 hover:text-brand-primary"
                  onClick={openBulkRollNumbers}
                  disabled={update.isPending}
                  aria-label="Edit whole class: roll numbers for this student's section"
                >
                  <ListOrdered className="h-3.5 w-3.5" aria-hidden />
                  Edit whole class
                </Button>
              </div>
            ) : (
              <Input
                id={`sd-${f.key}`}
                type={f.type ?? "text"}
                value={form[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.key)(e.target.value)}
                disabled={update.isPending}
              />
            )}
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={update.isPending || !form.fullName.trim()}>
            {update.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
