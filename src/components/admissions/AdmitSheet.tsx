import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardList, Copy, GraduationCap, Hash, ListChecks, Phone, Printer, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { useClassGroupSections, useInstitutionClassGroups } from "@/hooks/useClassGroups";
import { formatClassName } from "@/lib/utils";
import { GENDERS, GENDER_LABEL, admissionError, admissionNumberPreview, customAnswersError, mergeCustomAnswers, questionsFor, type Gender } from "@/lib/admissions";
import {
  useAdmitStudent,
  useOpenAdmissionDocument,
  useRemoveAdmissionDocumentFile,
  useUploadAdmissionDocument,
  type AdmissionEnquiryDetail,
  type AdmissionSettings,
  type AdmitResult,
} from "@/hooks/admissions";
import { CustomQuestions } from "./CustomQuestions";
import { DocumentChecklist } from "./DocumentChecklist";
import { Field, PillGroup, SectionCard, SummaryStrip } from "./parts";

interface Form {
  studentName: string;
  dateOfBirth: string;
  gender: Gender | "";
  bloodGroup: string;
  fatherName: string;
  motherName: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  address: string;
  previousSchool: string;
  classGroupId: string;
  classId: string;
  admissionNumber: string;
  admissionNumberIsAuto: boolean;
  admittedOn: string;
  ticked: string[];
  /** Answers to the school's own questions, by question id. */
  custom: Record<string, string>;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formFrom(e: AdmissionEnquiryDetail, settings: AdmissionSettings | undefined): Form {
  const preview = admissionNumberPreview(settings?.admission_number_prefix, settings?.next_admission_seq ?? 1);
  return {
    studentName: e.student_name,
    dateOfBirth: e.date_of_birth ?? "",
    gender: e.gender ?? "",
    bloodGroup: e.form?.blood_group ?? "",
    fatherName: e.form?.father_name ?? "",
    motherName: e.form?.mother_name ?? "",
    guardianName: e.parent_name,
    guardianPhone: e.parent_phone,
    guardianEmail: e.parent_email ?? "",
    address: e.form?.address ?? "",
    previousSchool: e.previous_school ?? "",
    classGroupId: e.class_group_id ?? "",
    classId: "",
    admissionNumber: preview ?? "",
    admissionNumberIsAuto: !!preview,
    admittedOn: today(),
    ticked: e.documents.filter((d) => d.collected).map((d) => d.doc_key),
    custom: { ...(e.form?.custom ?? {}) },
  };
}

/**
 * Admission: the physical form the parent filled, typed in by the
 * receptionist as four cards (student, parents, certificates, class and
 * number), the admission number pre-filled from the school's prefix and
 * editable. One server transaction makes the student; the slip that follows
 * carries the login the desk hands to the parent.
 */
export function AdmitSheet({
  enquiry,
  institutionId,
  settings,
  onClose,
  onAdmitted,
}: {
  enquiry: AdmissionEnquiryDetail | null;
  institutionId: string;
  settings: AdmissionSettings | undefined;
  onClose: () => void;
  onAdmitted?: (result: AdmitResult) => void;
}) {
  const admit = useAdmitStudent();
  const upload = useUploadAdmissionDocument();
  const removeFile = useRemoveAdmissionDocumentFile();
  const openDoc = useOpenAdmissionDocument();
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [slip, setSlip] = useState<AdmitResult | null>(null);
  const openFor = useRef<string | null>(null);
  useEffect(() => {
    if (enquiry && openFor.current !== enquiry.id) {
      openFor.current = enquiry.id;
      setForm(formFrom(enquiry, settings));
      setSlip(null);
      setConfirm(false);
    }
    if (!enquiry) openFor.current = null;
  }, [enquiry, settings]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const groups = useInstitutionClassGroups(enquiry ? institutionId : null);
  const sections = useClassGroupSections(form?.classGroupId || null);
  const groupOptions = useMemo<SearchableSelectOption[]>(
    () => (groups.data ?? []).filter((g) => g.is_active).map((g) => ({ value: g.id, label: g.name })),
    [groups.data],
  );
  const sectionOptions = useMemo<SearchableSelectOption[]>(
    () => (sections.data ?? []).map((s) => ({ value: s.id, label: formatClassName(s.name, s.section) })),
    [sections.data],
  );
  const sectionLabel = sectionOptions.find((o) => o.value === form?.classId)?.label ?? "";
  const checklist = useMemo(() => (enquiry?.documents ?? []).map((d) => ({ doc_key: d.doc_key, label: d.label })), [enquiry?.documents]);
  const docFiles = useMemo(
    () => Object.fromEntries((enquiry?.documents ?? []).map((d) => [d.doc_key, d.file_path ? { name: d.file_name ?? "scan" } : null])),
    [enquiry?.documents],
  );
  const uploadDoc = (docKey: string, file: File) => {
    if (!enquiry) return;
    setBusyDoc(docKey);
    upload.mutate(
      { id: enquiry.id, institutionId, docKey, file },
      {
        onSuccess: () => setForm((f) => (f && !f.ticked.includes(docKey) ? { ...f, ticked: [...f.ticked, docKey] } : f)),
        onSettled: () => setBusyDoc(null),
      },
    );
  };
  const removeDoc = (docKey: string) => {
    if (!enquiry) return;
    setBusyDoc(docKey);
    removeFile.mutate({ id: enquiry.id, docKey }, { onSettled: () => setBusyDoc(null) });
  };
  const openDocument = (docKey: string) => {
    const path = enquiry?.documents.find((d) => d.doc_key === docKey)?.file_path;
    if (path) openDoc.mutate(path);
  };

  const asked = useMemo(() => questionsFor(settings?.form_schema, "admission"), [settings?.form_schema]);
  const error = form
    ? (admissionError({
        studentName: form.studentName,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        guardianName: form.guardianName,
        guardianPhone: form.guardianPhone,
        guardianEmail: form.guardianEmail,
        classId: form.classId,
        admissionNumber: form.admissionNumber,
        admittedOn: form.admittedOn,
      }) ?? customAnswersError(asked, form.custom))
    : "Loading";
  const pending = admit.isPending;
  const noPrefix = !settings?.admission_number_prefix;
  const summary = form
    ? [form.studentName.trim(), sectionLabel, form.admissionNumber.trim() ? `No. ${form.admissionNumber.trim()}` : ""].filter(Boolean).join(" · ")
    : "";

  const doAdmit = () => {
    if (!enquiry || !form || error || pending || !form.gender) return;
    setConfirm(false);
    admit.mutate(
      {
        enquiryId: enquiry.id,
        institutionId,
        studentName: form.studentName,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        guardianName: form.guardianName,
        guardianPhone: form.guardianPhone,
        guardianEmail: form.guardianEmail.trim() || null,
        classId: form.classId,
        admissionNumber: form.admissionNumber,
        admissionNumberIsAuto: form.admissionNumberIsAuto,
        admittedOn: form.admittedOn,
        previousSchool: form.previousSchool.trim() || null,
        form: {
          blood_group: form.bloodGroup.trim() || null,
          father_name: form.fatherName.trim() || null,
          mother_name: form.motherName.trim() || null,
          address: form.address.trim() || null,
          custom: mergeCustomAnswers(enquiry.form?.custom, asked, form.custom),
        },
        documents: checklist.map((d) => ({ doc_key: d.doc_key, collected: form.ticked.includes(d.doc_key) })),
      },
      {
        onSuccess: (result) => {
          setSlip(result);
          onAdmitted?.(result);
        },
      },
    );
  };

  return (
    <>
      <MobileSheet
        open={!!enquiry}
        onOpenChange={(open) => !open && !pending && onClose()}
        title={slip ? "Admitted" : "Admission"}
        subtitle={enquiry ? `${enquiry.student_name} · ${enquiry.reference_no}` : undefined}
        icon={<UserRoundCheck className="h-5 w-5" />}
        desktopWidth="lg"
        primaryAction={
          slip
            ? { label: "Done", onClick: onClose }
            : { label: "Admit and create the account", onClick: () => setConfirm(true), loading: pending, disabled: !!error || pending }
        }
        secondaryAction={slip ? undefined : { label: "Cancel", onClick: onClose, disabled: pending }}
      >
        {slip ? (
          <AdmissionSlip slip={slip} studentName={form?.studentName ?? ""} classLabel={sectionLabel} />
        ) : form ? (
          <form
            className="space-y-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!error) setConfirm(true);
            }}
          >
            <SectionCard step={1} icon={<GraduationCap />} tone="teal" title="Student" hint="From the admission form">
              <Field label="Full name" htmlFor="adm-name" wide>
                <Input id="adm-name" value={form.studentName} onChange={(e) => set("studentName", e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Date of birth" htmlFor="adm-dob">
                <Input id="adm-dob" type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
              </Field>
              <Field label="Gender">
                <PillGroup ariaLabel="Gender" options={GENDERS.map((g) => ({ value: g, label: GENDER_LABEL[g] }))} value={form.gender} onChange={(v) => set("gender", v)} />
              </Field>
              <Field label="Blood group" htmlFor="adm-blood">
                <Input id="adm-blood" value={form.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Previous school" htmlFor="adm-prev">
                <Input id="adm-prev" value={form.previousSchool} onChange={(e) => set("previousSchool", e.target.value)} placeholder="Optional" />
              </Field>
            </SectionCard>

            <SectionCard step={2} icon={<Phone />} tone="violet" title="Parents and guardian" hint="The guardian is who the school calls">
              <Field label="Father's name" htmlFor="adm-father">
                <Input id="adm-father" value={form.fatherName} onChange={(e) => set("fatherName", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Mother's name" htmlFor="adm-mother">
                <Input id="adm-mother" value={form.motherName} onChange={(e) => set("motherName", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Guardian" htmlFor="adm-guardian">
                <Input id="adm-guardian" value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} />
              </Field>
              <Field label="Guardian's mobile" htmlFor="adm-phone">
                <PhoneInput id="adm-phone" value={form.guardianPhone} onChange={(v) => set("guardianPhone", v)} required />
              </Field>
              <Field label="Email" htmlFor="adm-email" hint="Becomes the login email when given">
                <Input id="adm-email" type="email" value={form.guardianEmail} onChange={(e) => set("guardianEmail", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Address" htmlFor="adm-address">
                <Textarea id="adm-address" value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} placeholder="Optional" />
              </Field>
            </SectionCard>

            {asked.length > 0 && (
              <SectionCard step={3} icon={<ListChecks />} tone="rose" title="The school's questions" hint="From the admission form, as set in Admissions settings">
                <CustomQuestions questions={asked} values={form.custom} onChange={(next) => set("custom", next)} idPrefix="adm" />
              </SectionCard>
            )}

            <SectionCard step={asked.length > 0 ? 4 : 3} icon={<ClipboardList />} tone="peach" title="Certificates collected" hint="Tick what the parent handed in; the rest shows as pending">
              <div className="sm:col-span-2">
                <div className="mb-3 flex items-center gap-3">
                  <Progress value={checklist.length ? (form.ticked.length / checklist.length) * 100 : 0} className="h-1.5 flex-1 bg-brand-primary/10" aria-hidden="true" />
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {form.ticked.length} of {checklist.length}
                  </span>
                </div>
                <DocumentChecklist
                  items={checklist}
                  value={form.ticked}
                  onChange={(next) => set("ticked", next)}
                  files={docFiles}
                  onUpload={uploadDoc}
                  onOpen={openDocument}
                  onRemoveFile={removeDoc}
                  busyKey={busyDoc}
                />
              </div>
            </SectionCard>

            <SectionCard step={asked.length > 0 ? 5 : 4} icon={<Hash />} tone="mint" title="Class and admission number" hint="The section the child joins, and the number from the register">
              <Field label="Class">
                <SearchableSelect
                  value={form.classGroupId}
                  onValueChange={(id) => setForm((f) => (f ? { ...f, classGroupId: id, classId: "" } : f))}
                  options={groupOptions}
                  placeholder={groups.isLoading ? "Loading classes…" : "Choose a class"}
                  searchPlaceholder="Search classes"
                  emptyText="No class matches."
                  disabled={groups.isLoading}
                />
              </Field>
              <Field label="Section">
                <SearchableSelect
                  value={form.classId}
                  onValueChange={(id) => set("classId", id)}
                  options={sectionOptions}
                  placeholder={!form.classGroupId ? "Choose the class first" : sections.isLoading ? "Loading sections…" : "Choose a section"}
                  searchPlaceholder="Search sections"
                  emptyText="No section in this class yet."
                  disabled={!form.classGroupId || sections.isLoading}
                />
              </Field>
              <Field
                label="Admission number"
                htmlFor="adm-number"
                hint={
                  noPrefix
                    ? "Set the prefix in Admissions settings to have the next number filled in."
                    : form.admissionNumberIsAuto
                      ? "Next in the school's sequence; change it only if the register says otherwise."
                      : "Typed by hand; the system refuses a number already used in this school."
                }
              >
                <div className="relative">
                  <Input
                    id="adm-number"
                    value={form.admissionNumber}
                    onChange={(e) => setForm((f) => (f ? { ...f, admissionNumber: e.target.value, admissionNumberIsAuto: false } : f))}
                    autoComplete="off"
                    placeholder={noPrefix ? "Type the number" : undefined}
                    className="pr-16 text-base font-semibold tabular-nums"
                  />
                  {form.admissionNumberIsAuto && (
                    <Badge variant="secondary" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 bg-brand-primary/10 text-[10px] font-semibold text-teal-700 dark:text-teal-300">
                      Auto
                    </Badge>
                  )}
                </div>
              </Field>
              <Field label="Admission date" htmlFor="adm-date">
                <Input id="adm-date" type="date" value={form.admittedOn} onChange={(e) => set("admittedOn", e.target.value)} />
              </Field>
            </SectionCard>

            <SummaryStrip summary={summary} missing={error} />
          </form>
        ) : null}
      </MobileSheet>

      <AlertDialog open={confirm} onOpenChange={(open) => !pending && setConfirm(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Admit {form?.studentName.trim() || "this child"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {sectionLabel ? `Into ${sectionLabel}` : "Into the chosen section"} with admission number{" "}
              <span className="font-medium text-ink-900">{form?.admissionNumber}</span>. This creates the student's
              account; the login and a one-time password appear on the next screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                doAdmit();
              }}
            >
              Admit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** The slip the desk hands to the parent: admission number and the login. */
function AdmissionSlip({ slip, studentName, classLabel }: { slip: AdmitResult; studentName: string; classLabel: string }) {
  const [copied, setCopied] = useState(false);
  const lines = [
    `Student: ${studentName}`,
    classLabel ? `Class: ${classLabel}` : null,
    `Admission number: ${slip.admission_number}`,
    `Login: ${slip.login_id}`,
    `Password: ${slip.password}`,
  ].filter((l): l is string => !!l);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.info("Select the details and copy them by hand.");
    }
  };
  const print = () => {
    const w = window.open("", "_blank", "width=520,height=640");
    if (!w) {
      toast.info("Allow pop-ups for this site to print the slip.");
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Admission slip</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:40px 32px;color:#1f2937}
h1{font-size:22px;margin:0 0 16px}p{margin:0 0 8px;font-size:16px}.k{color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.v{font-size:20px;font-weight:600;margin-bottom:14px}.note{margin-top:24px;font-size:13px;color:#6b7280}</style></head><body>
<h1>Admission slip</h1>
${lines.map((l) => { const [k, ...rest] = l.split(": "); return `<p class="k">${escapeHtml(k)}</p><p class="v">${escapeHtml(rest.join(": "))}</p>`; }).join("")}
<p class="note">Sign in to the SALCI app with the login and this password; the app asks for a new password on the first sign-in.</p>
<script>window.addEventListener("load",function(){window.print();});</script></body></html>`);
    w.document.close();
  };
  return (
    <div className="space-y-4 p-4" data-admission-slip="">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500/15 via-brand-primary/10 to-transparent px-5 py-4 ring-1 ring-inset ring-emerald-500/20">
        <p className="eyebrow">Admission number</p>
        <p className="text-3xl font-bold tabular-nums text-ink-900">{slip.admission_number}</p>
        <p className="mt-1 text-sm text-ink-700">
          {studentName}
          {classLabel ? ` · ${classLabel}` : ""}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-surface-stroke px-3 py-2">
          <dt className="eyebrow">Login</dt>
          <dd className="break-all text-sm font-medium text-ink-900">{slip.login_id}</dd>
        </div>
        <div className="rounded-xl border border-surface-stroke px-3 py-2">
          <dt className="eyebrow">One-time password</dt>
          <dd className="break-all font-mono text-sm font-medium text-ink-900">{slip.password}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-500">
        Shown once. Give it to the parent; the app asks for a new password at the first sign-in. The child is now in
        Manage Users like every other student.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy details"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={print}>
          <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Print slip
        </Button>
      </div>
    </div>
  );
}
