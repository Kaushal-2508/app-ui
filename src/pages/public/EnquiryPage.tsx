import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, GraduationCap, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { academicYearOptions, cleanAnswers, customAnswersError, enquiryError, questionsFor, type FormQuestion } from "@/lib/admissions";
import { CustomQuestions } from "@/components/admissions/CustomQuestions";

/** What the intake function tells the form about the school. */
interface FormContext {
  school_name: string;
  logo_url: string | null;
  enabled: boolean;
  classes: { id: string; name: string }[];
  academic_years: string[];
  /** The school's own questions marked for the online form; absent on an older server. */
  questions?: FormQuestion[];
}

const INTAKE_FN = "admission-enquiry-intake";

async function invokeIntake<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(INTAKE_FN, { body });
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return data as T;
}

function Shell({ school, children }: { school?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh surface-gradient">
      <header className="mx-auto flex max-w-xl items-center gap-2 px-4 py-6 sm:py-8">
        <GraduationCap className="h-6 w-6 text-brand-primary" aria-hidden="true" />
        <p className="text-sm font-semibold text-ink-900">{school ?? "SALCI"}</p>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-12">{children}</main>
      <footer className="mx-auto max-w-xl px-4 py-6 text-center text-[11px] text-ink-500">Powered by SALCI</footer>
    </div>
  );
}

/**
 * The public enquiry form at /enquire/:schoolCode (spec 2026-10-09, section
 * 4): a parent asks about a seat without a login. The intake edge function
 * is the only unauthenticated write on the platform: it rate-limits, drops
 * anything that fills the honeypot, and answers with a reference number the
 * desk can find.
 */
export default function EnquiryPage() {
  const { schoolCode = "" } = useParams<{ schoolCode: string }>();
  const ctx = useQuery({
    queryKey: ["enquiry-form-context", schoolCode],
    queryFn: () => invokeIntake<FormContext>({ action: "context", school_code: schoolCode }),
    enabled: !!schoolCode,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const years = useMemo(() => (ctx.data?.academic_years?.length ? ctx.data.academic_years : academicYearOptions()), [ctx.data]);
  const asked = useMemo(() => questionsFor(ctx.data?.questions, "public"), [ctx.data]);

  const [studentName, setStudentName] = useState("");
  const [classId, setClassId] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [year, setYear] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [previousSchool, setPreviousSchool] = useState("");
  const [message, setMessage] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState(""); // honeypot: humans never see it
  const [reference, setReference] = useState<string | null>(null);

  const effectiveYear = year || years[1] || years[0] || "";
  const error =
    enquiryError({ studentName, applyingForLabel: classLabel, academicYearLabel: effectiveYear, parentName, parentPhone, parentEmail }) ?? customAnswersError(asked, answers);

  const submit = useMutation({
    mutationFn: () =>
      invokeIntake<{ reference_no: string }>({
        action: "submit",
        school_code: schoolCode,
        student_name: studentName.trim(),
        class_group_id: classId || null,
        applying_for: classLabel.trim(),
        academic_year: effectiveYear,
        parent_name: parentName.trim(),
        parent_phone: parentPhone,
        parent_email: parentEmail.trim() || null,
        previous_school: previousSchool.trim() || null,
        message: message.trim() || null,
        ...(asked.length > 0 ? { answers: cleanAnswers(asked, answers) } : {}),
        website,
      }),
    onSuccess: (r) => setReference(r.reference_no),
    onError: (e: Error) => toastError(e, { fallback: "Couldn't send your enquiry. Please try again or call the school.", context: "publicEnquiry" }),
  });

  if (ctx.isLoading) {
    return (
      <Shell>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" aria-label="Loading" />
        </div>
      </Shell>
    );
  }

  if (ctx.isError || !ctx.data || ctx.data.enabled === false) {
    return (
      <Shell school={ctx.data?.school_name}>
        <div className="surface-card frosted-shadow rounded-card p-6 text-center">
          <p className="mb-2 text-base font-semibold text-ink-900">Enquiries at the front desk</p>
          <p className="text-sm text-ink-600">
            {ctx.isError
              ? "This link is not taking online enquiries right now. Please call the school."
              : "This school takes admission enquiries at its front desk. Please call or visit the school."}
          </p>
        </div>
      </Shell>
    );
  }

  const school = ctx.data;

  if (reference) {
    return (
      <Shell school={school.school_name}>
        <div className="surface-card frosted-shadow rounded-card space-y-3 p-6 text-center" data-enquiry-done="">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="text-base font-semibold text-ink-900">Thank you, we have your enquiry</p>
          <p className="text-sm text-ink-600">
            Your reference number is <span className="font-medium text-ink-900">{reference}</span>. The school will call you on{" "}
            {parentPhone ? `+91 ${parentPhone.slice(0, 5)} ${parentPhone.slice(5)}` : "your number"}.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell school={school.school_name}>
      <form
        className="surface-card frosted-shadow rounded-card space-y-5 p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!error && !submit.isPending) submit.mutate();
        }}
      >
        <header>
          <p className="eyebrow">Admission enquiry</p>
          <h1 className="text-xl font-bold text-ink-900">{school.school_name}</h1>
          <p className="mt-1 text-sm text-ink-600">Tell us about your child and we will call you back.</p>
        </header>

        <div className="space-y-1.5">
          <Label htmlFor="pe-name">Child's name</Label>
          <Input id="pe-name" value={studentName} onChange={(e) => setStudentName(e.target.value)} autoComplete="off" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pe-class">Class applying for</Label>
            {school.classes.length > 0 ? (
              <Select
                value={classId}
                onValueChange={(id) => {
                  setClassId(id);
                  setClassLabel(school.classes.find((c) => c.id === id)?.name ?? "");
                }}
              >
                <SelectTrigger id="pe-class">
                  <SelectValue placeholder="Choose a class" />
                </SelectTrigger>
                <SelectContent>
                  {school.classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id="pe-class" value={classLabel} onChange={(e) => setClassLabel(e.target.value)} placeholder="For example Class 5" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pe-year">Academic year</Label>
            <Select value={effectiveYear} onValueChange={setYear}>
              <SelectTrigger id="pe-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-parent">Your name</Label>
          <Input id="pe-parent" value={parentName} onChange={(e) => setParentName(e.target.value)} autoComplete="name" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pe-phone">Mobile number</Label>
            <PhoneInput id="pe-phone" value={parentPhone} onChange={setParentPhone} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pe-email">Email</Label>
            <Input id="pe-email" type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="Optional" autoComplete="email" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-prev">Current or previous school</Label>
          <Input id="pe-prev" value={previousSchool} onChange={(e) => setPreviousSchool(e.target.value)} placeholder="Optional" />
        </div>
        {asked.length > 0 && (
          <div className="grid gap-4" data-school-questions="">
            <CustomQuestions questions={asked} values={answers} onChange={setAnswers} idPrefix="pe" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pe-message">Anything you want to ask</Label>
          <Textarea id="pe-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Optional" />
        </div>
        {/* Honeypot: off-screen and skipped by keyboards; bots fill it, people never do. */}
        <div className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor="pe-website">Website</label>
          <input id="pe-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        {error && studentName && parentName && <p className="text-xs text-ink-500">{error}</p>}
        <Button type="submit" className="w-full" disabled={!!error || submit.isPending}>
          {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Send enquiry
        </Button>
        <p className="text-center text-xs text-ink-500">We use your number only to call you about this enquiry.</p>
      </form>
    </Shell>
  );
}
