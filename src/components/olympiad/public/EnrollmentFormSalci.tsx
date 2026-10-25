import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import type { PublicPaymentContext } from "@/hooks/olympiad/usePublicPaymentContext";

type Ctx = Extract<PublicPaymentContext, { found: true }>;
type LookupResult =
  | {
      found: true;
      profile_id: string;
      full_name: string;
      date_of_birth: string | null;
      class_name: string | null;
    }
  | { found: false };

export function EnrollmentFormSalci({ context }: { context: Ctx }) {
  const submit = useOlympiadEnrollSubmit();
  const [admissionNumber, setAdmissionNumber] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const [dob, setDob] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [classLabel, setClassLabel] = useState("");
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

  const doLookup = async () => {
    if (!admissionNumber.trim()) return;
    setLookupBusy(true);
    try {
      const { data, error } = await supabase.rpc("oly_lookup_salci_student", {
        p_school_short_code: context.school_short_code,
        p_admission_number: admissionNumber.trim(),
      });
      if (error) throw error;
      const result = data as LookupResult;
      setLookup(result);
      if (result.found) {
        if (result.date_of_birth) setDob(result.date_of_birth);
        // Try to match class_name to one of the offered classes
        const classMatch = context.classes.find((c) =>
          result.class_name?.toLowerCase().includes(`${c.number}`),
        );
        if (classMatch) {
          setGradeLevelId(classMatch.id);
          setClassLabel(`Class ${classMatch.number}`);
        }
      } else {
        toast.error(
          "Student admission number not recognized. Please contact your school to ensure the student is registered before enrolling for the Olympiad.",
        );
      }
    } catch (e) {
      toastError(e as Error, { fallback: "Couldn't look up student. Please check the admission number and try again.", context: "EnrollmentFormSalci.doLookup" });
    } finally {
      setLookupBusy(false);
    }
  };

  const subjectsForClass = gradeLevelId
    ? (context.subjects_per_class[gradeLevelId] ?? [])
    : [];
  const phoneOk = /^[6-9]\d{9}$/.test(parentPhone);
  const canSubmit =
    lookup?.found &&
    admissionNumber &&
    dob &&
    classLabel &&
    gradeLevelId &&
    subjectIds.length === 3 &&
    parentName.trim() &&
    phoneOk;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !lookup?.found) return;
    const result = await submit.mutateAsync({
      school_short_code: context.school_short_code,
      form_data: {
        full_name: lookup.full_name,
        date_of_birth: dob,
        class_label: classLabel,
        section_label: sectionLabel.trim() || null,
        grade_level_id: gradeLevelId,
        admission_number: admissionNumber.trim(),
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
      data-dirty={
        admissionNumber || parentName || subjectIds.length > 0 ? "true" : "false"
      }
      onSubmit={onSubmit}
      className="surface-card frosted-shadow rounded-card p-6 space-y-4"
    >
      <header>
        <p className="eyebrow">Enroll for SALCI Olympiad</p>
        <h2 className="text-lg font-bold text-ink-900 mt-1">{context.school_name}</h2>
        <p className="text-xs text-ink-600 mt-1">Fee: {fee.display}</p>
      </header>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">
          Student admission number
        </Label>
        <div className="flex gap-2">
          <Input
            value={admissionNumber}
            onChange={(e) => setAdmissionNumber(e.target.value)}
            required
          />
          <Button
            type="button"
            variant="outline"
            disabled={lookupBusy || !admissionNumber.trim()}
            onClick={doLookup}
          >
            {lookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
          </Button>
        </div>
      </div>

      {lookup?.found && (
        <>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-sm text-emerald-900 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Student found:{" "}
              <span className="font-semibold">{lookup.full_name}</span>
            </div>
            {lookup.class_name && (
              <p className="text-[11px] text-emerald-800 dark:text-emerald-400 mt-1">
                Class: {lookup.class_name}
              </p>
            )}
          </div>

          {!lookup.date_of_birth && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">
                Date of birth (we'll add this to the student record)
              </Label>
              <Input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                required
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">
              Section (optional)
            </Label>
            <Input
              value={sectionLabel}
              onChange={(e) => setSectionLabel(e.target.value)}
            />
          </div>

          {!gradeLevelId && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">
                Confirm class
              </Label>
              <Select
                value={gradeLevelId}
                onValueChange={(v) => {
                  setGradeLevelId(v);
                  const g = context.classes.find((c) => c.id === v);
                  setClassLabel(g ? `Class ${g.number}` : "");
                  setSubjectIds([]);
                }}
              >
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
          )}

          {subjectsForClass.length > 0 && (
            <SubjectPicker
              subjects={subjectsForClass}
              value={subjectIds}
              onChange={setSubjectIds}
              max={3}
            />
          )}

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-ink-600">
              Parent contact
            </legend>
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
            {submit.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Pay {fee.totalRupees}
          </Button>
        </>
      )}
    </form>
  );
}
