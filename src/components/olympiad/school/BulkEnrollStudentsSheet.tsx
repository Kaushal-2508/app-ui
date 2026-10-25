import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import {
  cellText,
  downloadXlsxData,
  downloadXlsxTemplate,
  excelCellToDobIso,
  parseXlsxRows,
  resolveClass,
  EMAIL_RE,
  PHONE_RE,
  type ClassOption,
} from "@/lib/olympiad/bulkUpload";

const HEADERS = [
  "Student Name",
  "Class",
  "Date of Birth (YYYY-MM-DD)",
  "Section",
  "Admission No",
  "Parent Name",
  "Parent Phone",
  "Parent Email",
  "Subject 1",
  "Subject 2",
  "Subject 3",
];

type ParsedRow = {
  rowNo: number;
  fullName: string;
  klass: ClassOption;
  dobIso: string;
  section: string;
  admission: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  subjectIds: string[];
};

type RowIssue = { rowNo: number; message: string };
type RowResult = {
  fullName: string;
  classLabel: string;
  rollNumber?: string;
  dobIso: string;
  status: "enrolled" | "skipped" | "failed";
  message?: string;
};

type Phase = "start" | "review" | "running" | "done";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  classes: ClassOption[];
};

/** Subjects for every participating grade in one bounded query (grades and the
 *  subject catalog are both small), keyed by grade_level_id. */
function useSubjectsByGrade(gradeIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ["olympiad", "grade-subjects-map", gradeIds],
    queryFn: async (): Promise<Map<string, { id: string; name: string }[]>> => {
      const map = new Map<string, { id: string; name: string }[]>();
      if (gradeIds.length === 0) return map;
      const { data: links, error: e1 } = await supabase
        .from("oly_subject_classes")
        .select("subject_id, grade_level_id")
        .in("grade_level_id", gradeIds)
        .limit(1000);
      if (e1) throw e1;
      const subjectIds = Array.from(new Set((links ?? []).map((l) => l.subject_id)));
      if (subjectIds.length === 0) return map;
      const { data: subjects, error: e2 } = await supabase
        .from("oly_subjects")
        .select("id, name")
        .in("id", subjectIds)
        .eq("status", "active")
        .limit(1000);
      if (e2) throw e2;
      const nameById = new Map((subjects ?? []).map((s) => [s.id, s.name]));
      for (const l of links ?? []) {
        const name = nameById.get(l.subject_id);
        if (!name) continue;
        const arr = map.get(l.grade_level_id) ?? [];
        arr.push({ id: l.subject_id, name });
        map.set(l.grade_level_id, arr);
      }
      for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
      return map;
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Bulk student enrollment for onboarded (non-SALCI) schools. Two entry options:
 * download the .xlsx template (real class + subject names in the demo rows) or
 * upload a filled file. Rows are validated client-side, then enrolled one by one
 * through the same oly-cash-enroll edge function the single flow uses, so all
 * server-side rules (roll numbers, duplicate guards, receipts) are identical.
 */
export function BulkEnrollStudentsSheet({ open, onOpenChange, olySchoolId, classes }: Props) {
  const queryClient = useQueryClient();
  const gradeIds = useMemo(() => classes.map((c) => c.gradeLevelId), [classes]);
  const { data: subjectsByGrade } = useSubjectsByGrade(gradeIds, open);

  const [phase, setPhase] = useState<Phase>("start");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [feeConfirmed, setFeeConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RowResult[]>([]);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);

  const reset = () => {
    setPhase("start");
    setRows([]);
    setIssues([]);
    setFeeConfirmed(false);
    setProgress(0);
    setResults([]);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o && phase === "running") return; // don't lose an in-flight run
    if (!o) reset();
    onOpenChange(o);
  };

  const downloadTemplate = async () => {
    const demoClass = classes[0];
    const demoSubjects = (subjectsByGrade?.get(demoClass?.gradeLevelId ?? "") ?? []).slice(0, 3);
    const s = (i: number) => demoSubjects[i]?.name ?? ["General Knowledge", "Science", "Mathematics"][i];
    await downloadXlsxTemplate("olympiad-students-template.xlsx", HEADERS, [
      ["Aarav Sharma", demoClass?.label ?? "Class 9", "2011-04-15", "A", "ADM-1024", "Rakesh Sharma", "9876543210", "rakesh.sharma@example.com", s(0), s(1), s(2)],
      ["Diya Verma", demoClass?.label ?? "Class 9", "2011-08-02", "B", "", "Sunita Verma", "9812345678", "", s(0), s(1), s(2)],
    ]);
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const raw = await parseXlsxRows(file);
      const parsed: ParsedRow[] = [];
      const errs: RowIssue[] = [];
      raw.forEach((r, i) => {
        const rowNo = i + 2; // 1-based + header row
        const fullName = cellText(r, "Student Name");
        const classCell = cellText(r, "Class");
        const parentName = cellText(r, "Parent Name");
        const parentPhone = cellText(r, "Parent Phone").replace(/\D/g, "");
        const parentEmail = cellText(r, "Parent Email");
        // Entirely blank row (Excel often keeps trailing ones): skip silently
        if (!fullName && !classCell && !parentName && !parentPhone) return;

        const problems: string[] = [];
        if (!fullName) problems.push("student name is missing");
        const klass = resolveClass(classCell, classes);
        if (!klass) problems.push(`class "${classCell || "(blank)"}" doesn't match a participating class`);
        const dobRaw = Object.entries(r).find(([k]) => k.toLowerCase().includes("birth"))?.[1] ?? "";
        const dobIso = excelCellToDobIso(dobRaw);
        if (!dobIso) problems.push("date of birth must be YYYY-MM-DD");
        if (!parentName) problems.push("parent name is missing");
        if (!PHONE_RE.test(parentPhone)) problems.push("parent phone must be a 10-digit mobile starting 6-9");
        if (parentEmail && !EMAIL_RE.test(parentEmail)) problems.push("parent email is invalid");

        let subjectIds: string[] = [];
        if (klass) {
          const offered = subjectsByGrade?.get(klass.gradeLevelId) ?? [];
          const wanted = [cellText(r, "Subject 1"), cellText(r, "Subject 2"), cellText(r, "Subject 3")].filter(Boolean);
          if (wanted.length === 0) {
            if (offered.length === 3) subjectIds = offered.map((s) => s.id);
            else problems.push(`fill Subject 1-3 (${klass.label} offers ${offered.length} subjects)`);
          } else if (wanted.length !== 3) {
            problems.push("exactly 3 subjects are required");
          } else {
            for (const w of wanted) {
              const hit = offered.find((s) => s.name.toLowerCase() === w.toLowerCase());
              if (!hit) problems.push(`subject "${w}" isn't offered for ${klass.label}`);
              else subjectIds.push(hit.id);
            }
            if (new Set(subjectIds).size !== 3 && problems.length === 0) problems.push("subjects must be 3 different ones");
          }
        }

        if (problems.length > 0) {
          errs.push({ rowNo, message: problems.join("; ") });
        } else if (klass && dobIso) {
          parsed.push({
            rowNo, fullName, klass, dobIso,
            section: cellText(r, "Section"),
            admission: cellText(r, "Admission No"),
            parentName, parentPhone, parentEmail,
            subjectIds,
          });
        }
      });
      if (parsed.length === 0 && errs.length === 0) {
        toast.error("The file has no student rows. Fill the template and re-upload.");
        return;
      }
      setRows(parsed);
      setIssues(errs);
      setPhase("review");
    } catch (e) {
      toastError(e as Error, { fallback: "Couldn't read that file. Is it the .xlsx template?", context: "BulkEnrollStudents" });
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const run = async () => {
    if (runningRef.current || rows.length === 0 || !feeConfirmed) return;
    runningRef.current = true;
    setPhase("running");
    const out: RowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(i + 1);
      try {
        const res = await invokeEdgeFunction<{ oly_student_id: string; roll_number: string }>(
          "oly-cash-enroll",
          {
            oly_school_id: olySchoolId,
            form_data: {
              full_name: row.fullName,
              date_of_birth: row.dobIso,
              class_label: row.klass.label,
              section_label: row.section || null,
              grade_level_id: row.klass.gradeLevelId,
              admission_number: row.admission || null,
              subject_ids: row.subjectIds,
              parent_name: row.parentName,
              parent_phone: row.parentPhone,
              parent_email: row.parentEmail || null,
              fee_collected: true,
            },
          },
        );
        out.push({ fullName: row.fullName, classLabel: row.klass.label, rollNumber: res.roll_number, dobIso: row.dobIso, status: "enrolled" });
      } catch (e) {
        const msg = (e as Error).message;
        out.push({
          fullName: row.fullName,
          classLabel: row.klass.label,
          dobIso: row.dobIso,
          status: msg.includes("Already enrolled") ? "skipped" : "failed",
          message: msg,
        });
      }
    }
    setResults(out);
    setPhase("done");
    runningRef.current = false;
    // One invalidation pass for the whole batch (same keys as the single flow)
    for (const key of ["class-roster", "school-students", "batching-roster", "dashboard", "my-classes"]) {
      queryClient.invalidateQueries({ queryKey: ["olympiad", key] });
    }
    const enrolled = out.filter((r) => r.status === "enrolled").length;
    if (enrolled > 0) toast.success(`${enrolled} student${enrolled === 1 ? "" : "s"} enrolled`);
  };

  const downloadCredentials = () =>
    downloadXlsxData(
      "olympiad-student-signins.xlsx",
      ["Student Name", "Class", "Roll Number", "Date of Birth", "Status"],
      results.map((r) => [r.fullName, r.classLabel, r.rollNumber ?? "", r.dobIso, r.status]),
    );

  const enrolledCount = results.filter((r) => r.status === "enrolled").length;

  return (
    <MobileSheet
      open={open}
      onOpenChange={handleOpenChange}
      title="Bulk upload students"
      subtitle={
        phase === "done"
          ? "Done. Download the sign-in details below."
          : "Download the template, fill it, and upload"
      }
      icon={<FileSpreadsheet className="h-4 w-4" />}
      primaryAction={
        phase === "review"
          ? {
              label: `Enroll ${rows.length} student${rows.length === 1 ? "" : "s"}`,
              onClick: () => void run(),
              disabled: rows.length === 0 || !feeConfirmed,
            }
          : phase === "done"
            ? { label: "Done", onClick: () => handleOpenChange(false) }
            : undefined
      }
      secondaryAction={
        phase === "review"
          ? { label: "Back", onClick: reset }
          : phase === "done"
            ? { label: "Upload another file", onClick: reset }
            : { label: "Close", onClick: () => handleOpenChange(false) }
      }
    >
      <form data-dirty={phase === "review" || phase === "running" ? "true" : "false"} onSubmit={(e) => e.preventDefault()} className="space-y-4">
        {phase === "start" && (
          <>
            <button
              type="button"
              onClick={() => void downloadTemplate()}
              className="flex w-full items-start gap-3 rounded-xl border border-surface-stroke bg-surface-card p-4 text-left transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/[0.04]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                <Download className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink-900">1. Download template</span>
                <span className="block text-xs text-ink-600 mt-0.5">
                  Excel file with the exact headings and 2 example students. Class and subject names match your school.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
              className="flex w-full items-start gap-3 rounded-xl border border-surface-stroke bg-surface-card p-4 text-left transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/[0.04] disabled:opacity-60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink-900">2. Upload filled file</span>
                <span className="block text-xs text-ink-600 mt-0.5">
                  We check every row first and show any problems before enrolling.
                </span>
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </>
        )}

        {phase === "review" && (
          <>
            <div className="rounded-xl border border-surface-stroke bg-surface-card p-4">
              <p className="text-sm font-semibold text-ink-900">
                {rows.length} student{rows.length === 1 ? "" : "s"} ready to enroll
              </p>
              {issues.length > 0 && (
                <div className="mt-2 space-y-1 rounded-lg bg-rose-50 p-3 dark:bg-rose-500/10">
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    {issues.length} row{issues.length === 1 ? "" : "s"} will be skipped:
                  </p>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-rose-700 dark:text-rose-300">
                    {issues.map((e) => (
                      <li key={e.rowNo}>Row {e.rowNo}: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 cursor-pointer dark:border-amber-500/20 dark:bg-amber-500/10">
              <Checkbox checked={feeConfirmed} onCheckedChange={(v) => setFeeConfirmed(!!v)} className="mt-0.5" />
              <span className="text-sm text-ink-800 dark:text-ink-300">
                <strong className="font-semibold text-amber-800 dark:text-amber-300">Fees collected for all these students</strong>
                <br />
                <span className="text-xs text-ink-600">
                  Check only after physically collecting the exam fee in cash for every student in this file.
                </span>
              </span>
            </label>
          </>
        )}

        {phase === "running" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
            <p className="text-sm text-ink-600">
              Enrolling {progress} of {rows.length}...
            </p>
            <p className="text-xs text-ink-500">Keep this sheet open until it finishes.</p>
          </div>
        )}

        {phase === "done" && (
          <>
            <div className="rounded-xl border border-surface-stroke bg-surface-card p-4 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {enrolledCount} enrolled
                {results.length - enrolledCount > 0 && (
                  <span className="flex items-center gap-1 text-rose-600">
                    <XCircle className="h-4 w-4" /> {results.length - enrolledCount} not enrolled
                  </span>
                )}
              </p>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {results.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-ink-900">{r.fullName} <span className="text-ink-500">({r.classLabel})</span></span>
                    {r.status === "enrolled" ? (
                      <span className="shrink-0 font-mono text-emerald-700 dark:text-emerald-400">{r.rollNumber}</span>
                    ) : (
                      <span className="shrink-0 max-w-[50%] truncate text-rose-600" title={r.message}>{r.status === "skipped" ? "already enrolled" : r.message}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-ink-500">Students sign in with their roll number and date of birth.</p>
            </div>
            {enrolledCount > 0 && (
              <Button type="button" variant="outline" className="w-full" onClick={() => void downloadCredentials()}>
                <Download className="mr-2 h-4 w-4" /> Download sign-in details (.xlsx)
              </Button>
            )}
          </>
        )}
      </form>
    </MobileSheet>
  );
}
