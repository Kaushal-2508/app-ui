import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubjectPicker } from "./SubjectPicker";
import { PaymentMethodHandoff } from "./PaymentMethodHandoff";
import { useOlympiadEnrollSubmit } from "@/hooks/olympiad/useOlympiadEnrollSubmit";
import { formatOlympiadFee } from "@/lib/olympiad/money";
import { toast } from "sonner";
import type { PublicPaymentContext } from "@/hooks/olympiad/usePublicPaymentContext";

type Ctx = Extract<PublicPaymentContext, { found: true }>;

export function EnrollmentFormNonSalci({ context }: { context: Ctx }) {
  const submit = useOlympiadEnrollSubmit();
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [sectionLabel, setSectionLabel] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");

  const [handoff, setHandoff] = useState<{
    pendingId: string;
    clientPayload: unknown;
  } | null>(null);

  const fee = formatOlympiadFee(context.price_rupees, context.gst_percent);
  const subjectsForClass = gradeLevelId
    ? (context.subjects_per_class[gradeLevelId] ?? [])
    : [];

  const phoneOk = /^[6-9]\d{9}$/.test(parentPhone);
  const canSubmit =
    fullName.trim() &&
    dob &&
    classLabel &&
    gradeLevelId &&
    subjectIds.length === 3 &&
    parentName.trim() &&
    phoneOk;

  const onClassChange = (gid: string) => {
    setGradeLevelId(gid);
    const g = context.classes.find((c) => c.id === gid);
    setClassLabel(g ? `Class ${g.number}` : "");
    setSubjectIds([]);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const result = await submit.mutateAsync({
      school_short_code: context.school_short_code,
      form_data: {
        full_name: fullName.trim(),
        date_of_birth: dob,
        class_label: classLabel,
        section_label: sectionLabel.trim() || null,
        grade_level_id: gradeLevelId,
        subject_ids: subjectIds,
        parent_name: parentName.trim(),
        parent_phone: parentPhone,
        parent_email: parentEmail.trim() || null,
      },
    });
    // Narrow on the success-only field: under this repo's non-strict TS config a
    // `"blocked" in result` discriminant doesn't narrow the union reliably.
    if (!("pending_id" in result)) {
      toast.error(result.message);
      return;
    }
    setHandoff({
      pendingId: result.pending_id,
      clientPayload: result.client_payload,
    });
  };

  if (handoff) {
    return (
      <PaymentMethodHandoff
        pendingId={handoff.pendingId}
        clientPayload={handoff.clientPayload}
        payer={{ name: parentName, email: parentEmail || null, phone: parentPhone }}
        schoolCode={context.school_short_code}
        onCancel={() => setHandoff(null)}
      />
    );
  }

  return (
    <form
      data-dirty={fullName || dob || classLabel ? "true" : "false"}
      onSubmit={onSubmit}
      className="surface-card frosted-shadow rounded-card p-6 space-y-4"
    >
      <header>
        <p className="eyebrow">Enroll for SALCI Olympiad</p>
        <h2 className="text-lg font-bold text-ink-900 mt-1">{context.school_name}</h2>
        <p className="text-xs text-ink-600 mt-1">Fee: {fee.display}</p>
      </header>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Student full name</Label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Date of birth</Label>
          <Input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Class</Label>
          <Select value={gradeLevelId} onValueChange={onClassChange}>
            <SelectTrigger>
              <SelectValue placeholder="Pick class" />
            </SelectTrigger>
            <SelectContent>
              {context.classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Section (optional)</Label>
        <Input value={sectionLabel} onChange={(e) => setSectionLabel(e.target.value)} />
      </div>

      {subjectsForClass.length > 0 && (
        <SubjectPicker
          subjects={subjectsForClass}
          value={subjectIds}
          onChange={setSubjectIds}
          max={3}
        />
      )}

      <fieldset className="grid gap-2">
        <legend className="text-xs font-medium text-ink-600">Parent contact</legend>
        <Input
          placeholder="Parent name"
          value={parentName}
          onChange={(e) => setParentName(e.target.value)}
          required
        />
        <Input
          placeholder="Phone (10 digits)"
          value={parentPhone}
          onChange={(e) =>
            setParentPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          required
        />
        <Input
          type="email"
          placeholder="Email (optional)"
          value={parentEmail}
          onChange={(e) => setParentEmail(e.target.value)}
        />
        {parentPhone && !phoneOk && (
          <p className="text-[11px] text-red-500">
            Enter a 10-digit Indian mobile (starts with 6-9)
          </p>
        )}
      </fieldset>

      <Button
        type="submit"
        disabled={!canSubmit || submit.isPending}
        className="w-full bg-brand-primary text-white"
      >
        {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Pay {fee.totalRupees}
      </Button>
    </form>
  );
}
