import { useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap, ListChecks, MessageSquare, Phone, UserRound } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";
import { formatIndianMobile } from "@/lib/phone";
import {
  DESK_SOURCES,
  GENDERS,
  GENDER_LABEL,
  SOURCE_LABEL,
  academicYearLabel,
  academicYearOptions,
  customAnswersError,
  enquiryError,
  mergeCustomAnswers,
  questionsFor,
  type EnquirySource,
  type FormQuestion,
  type Gender,
} from "@/lib/admissions";
import { useCreateEnquiry, useUpdateEnquiry, type AdmissionEnquiryDetail } from "@/hooks/admissions";
import { CustomQuestions } from "./CustomQuestions";
import { Field, PillGroup, SectionCard, SummaryStrip } from "./parts";

interface Form {
  studentName: string;
  dateOfBirth: string;
  gender: Gender | "";
  classGroupId: string;
  applyingForLabel: string;
  academicYearLabel: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  previousSchool: string;
  message: string;
  source: EnquirySource;
  nextFollowUpOn: string;
  /** Answers to the school's own questions, by question id. */
  custom: Record<string, string>;
}

function emptyForm(): Form {
  return {
    studentName: "",
    dateOfBirth: "",
    gender: "",
    classGroupId: "",
    applyingForLabel: "",
    academicYearLabel: academicYearLabel(new Date(), 1),
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    previousSchool: "",
    message: "",
    source: "walk_in",
    nextFollowUpOn: "",
    custom: {},
  };
}

function formFrom(e: AdmissionEnquiryDetail): Form {
  return {
    studentName: e.student_name,
    dateOfBirth: e.date_of_birth ?? "",
    gender: e.gender ?? "",
    classGroupId: e.class_group_id ?? "",
    applyingForLabel: e.applying_for_label,
    academicYearLabel: e.academic_year_label,
    parentName: e.parent_name,
    parentPhone: e.parent_phone,
    parentEmail: e.parent_email ?? "",
    previousSchool: e.previous_school ?? "",
    message: e.message ?? "",
    source: e.source === "public_form" ? "other" : e.source,
    nextFollowUpOn: e.next_follow_up_on ?? "",
    custom: { ...(e.form?.custom ?? {}) },
  };
}

/**
 * The front desk types an enquiry after a call or a walk-in (or edits one
 * later): three cards, child, parent, follow-up, with pills for the choices
 * the desk makes all day and a strip that says what is still needed. The
 * class applying for is a class group of the school; the year defaults to
 * the next academic year, which is what a parent enquiring mid-year means.
 * The school's own questions marked for the enquiry follow as a fourth card.
 */
export function NewEnquirySheet({
  open,
  onOpenChange,
  institutionId,
  enquiry = null,
  questions = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  /** Edit mode when given. */
  enquiry?: AdmissionEnquiryDetail | null;
  /** The school's own questions (settings); the enquiry-stage ones are asked. */
  questions?: FormQuestion[];
}) {
  const isEdit = !!enquiry;
  const groups = useInstitutionClassGroups(open ? institutionId : null);
  const create = useCreateEnquiry();
  const update = useUpdateEnquiry();
  const pending = create.isPending || update.isPending;
  const [form, setForm] = useState<Form>(emptyForm);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setForm(enquiry ? formFrom(enquiry) : emptyForm());
    wasOpen.current = open;
  }, [open, enquiry]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const groupOptions = useMemo<SearchableSelectOption[]>(
    () => (groups.data ?? []).filter((g) => g.is_active).map((g) => ({ value: g.id, label: g.name })),
    [groups.data],
  );
  const years = useMemo(() => {
    const opts = academicYearOptions();
    return form.academicYearLabel && !opts.includes(form.academicYearLabel) ? [form.academicYearLabel, ...opts] : opts;
  }, [form.academicYearLabel]);

  const asked = useMemo(() => questionsFor(questions, "enquiry"), [questions]);
  const error = enquiryError(form) ?? customAnswersError(asked, form.custom);
  const canSave = !pending && !error;
  const summary = [
    form.studentName.trim(),
    form.applyingForLabel.trim(),
    form.academicYearLabel,
    form.parentName.trim() ? `${form.parentName.trim()}${form.parentPhone.length === 10 ? `, ${formatIndianMobile(form.parentPhone)}` : ""}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const submit = () => {
    if (!canSave) return;
    const fields = {
      studentName: form.studentName.trim(),
      dateOfBirth: form.dateOfBirth || null,
      gender: form.gender || null,
      classGroupId: form.classGroupId || null,
      applyingForLabel: form.applyingForLabel.trim(),
      academicYearLabel: form.academicYearLabel,
      parentName: form.parentName.trim(),
      parentPhone: form.parentPhone,
      parentEmail: form.parentEmail.trim() || null,
      previousSchool: form.previousSchool.trim() || null,
      message: form.message.trim() || null,
      source: form.source,
      assignedTo: null,
      nextFollowUpOn: form.nextFollowUpOn || null,
      ...(asked.length > 0 ? { custom: mergeCustomAnswers(enquiry?.form?.custom, asked, form.custom) } : {}),
    };
    if (isEdit) {
      update.mutate({ id: enquiry.id, fields }, { onSuccess: () => onOpenChange(false) });
    } else {
      create.mutate({ institutionId, ...fields }, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title={isEdit ? "Edit enquiry" : "New enquiry"}
      subtitle={isEdit ? enquiry.reference_no : "A parent asking about a seat"}
      icon={<UserRound className="h-5 w-5" />}
      desktopWidth="lg"
      primaryAction={{ label: isEdit ? "Save changes" : "Save enquiry", onClick: submit, loading: pending, disabled: !canSave }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: pending }}
    >
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SectionCard step={1} icon={<GraduationCap />} tone="teal" title="Child" hint="Who is applying, for which class">
          <Field label="Child's name" htmlFor="enq-name" wide>
            <Input id="enq-name" value={form.studentName} onChange={(e) => set("studentName", e.target.value)} autoComplete="off" placeholder="As on the birth certificate" />
          </Field>
          <Field label="Applying for">
            {groups.isError ? (
              <p className="text-sm text-ink-600">Couldn't load the classes. Close and reopen this form.</p>
            ) : (
              <SearchableSelect
                value={form.classGroupId}
                onValueChange={(id) => {
                  const g = groupOptions.find((o) => o.value === id);
                  setForm((f) => ({ ...f, classGroupId: id, applyingForLabel: g?.label ?? f.applyingForLabel }));
                }}
                options={groupOptions}
                placeholder={groups.isLoading ? "Loading classes…" : "Choose a class"}
                searchPlaceholder="Search classes"
                emptyText="No class matches."
                disabled={groups.isLoading}
              />
            )}
          </Field>
          <Field label="Date of birth" htmlFor="enq-dob">
            <Input id="enq-dob" type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
          </Field>
          <Field label="Academic year">
            <PillGroup ariaLabel="Academic year" options={years.map((y) => ({ value: y, label: y }))} value={form.academicYearLabel} onChange={(v) => set("academicYearLabel", v)} />
          </Field>
          <Field label="Gender">
            <PillGroup ariaLabel="Gender" options={GENDERS.map((g) => ({ value: g, label: GENDER_LABEL[g] }))} value={form.gender} onChange={(v) => set("gender", v)} />
          </Field>
          <Field label="Previous school" htmlFor="enq-prev" wide>
            <Input id="enq-prev" value={form.previousSchool} onChange={(e) => set("previousSchool", e.target.value)} placeholder="Optional" />
          </Field>
        </SectionCard>

        <SectionCard step={2} icon={<Phone />} tone="violet" title="Parent" hint="Who the school calls back">
          <Field label="Parent's name" htmlFor="enq-parent">
            <Input id="enq-parent" value={form.parentName} onChange={(e) => set("parentName", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Mobile number" htmlFor="enq-phone">
            <PhoneInput id="enq-phone" value={form.parentPhone} onChange={(v) => set("parentPhone", v)} required />
          </Field>
          <Field label="Email" htmlFor="enq-email" wide>
            <Input id="enq-email" type="email" value={form.parentEmail} onChange={(e) => set("parentEmail", e.target.value)} placeholder="Optional" />
          </Field>
        </SectionCard>

        <SectionCard step={3} icon={<MessageSquare />} tone="peach" title="Follow-up" hint="How they reached us and what comes next">
          <Field label="How they reached us" wide>
            <PillGroup ariaLabel="How they reached us" options={DESK_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} value={form.source} onChange={(v) => set("source", v)} />
          </Field>
          <Field label="Next follow-up" htmlFor="enq-follow">
            <Input id="enq-follow" type="date" value={form.nextFollowUpOn} onChange={(e) => set("nextFollowUpOn", e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="enq-message" wide>
            <Textarea id="enq-message" value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="What the parent asked, what was promised" rows={3} />
          </Field>
        </SectionCard>

        {asked.length > 0 && (
          <SectionCard step={4} icon={<ListChecks />} tone="rose" title="The school's questions" hint="Set in Admissions settings">
            <CustomQuestions questions={asked} values={form.custom} onChange={(next) => set("custom", next)} idPrefix="enq" />
          </SectionCard>
        )}

        <SummaryStrip summary={summary} missing={error} />
      </form>
    </MobileSheet>
  );
}
