import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import type { CreateOlympiadTeacherResult } from "@/hooks/olympiad/useCreateOlympiadTeacher";
import {
  cellText,
  downloadXlsxData,
  downloadXlsxTemplate,
  parseXlsxRows,
  resolveClass,
  EMAIL_RE,
  PHONE_RE,
  type ClassOption,
} from "@/lib/olympiad/bulkUpload";

const HEADERS = ["Teacher Name", "Email", "Phone", "Classes (comma separated)"];

type ParsedRow = {
  rowNo: number;
  fullName: string;
  email: string;
  phone: string;
  gradeLevelIds: string[];
  classLabels: string[];
};

type RowIssue = { rowNo: number; message: string };
type RowResult = {
  fullName: string;
  email: string;
  classLabels: string[];
  tempPassword?: string;
  status: "created" | "failed";
  message?: string;
};

type Phase = "start" | "review" | "running" | "done";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  classes: ClassOption[];
};

/**
 * Bulk teacher creation for onboarded (non-SALCI) schools. Mirrors the single
 * AddTeacherSheet flow: each row goes through the same oly-create-teacher edge
 * function, and each account's one-time password is surfaced in the results
 * panel + the credentials .xlsx (this is the only time passwords are visible).
 */
export function BulkAddTeachersSheet({ open, onOpenChange, olySchoolId, classes }: Props) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("start");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RowResult[]>([]);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);

  const reset = () => {
    setPhase("start");
    setRows([]);
    setIssues([]);
    setProgress(0);
    setResults([]);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o && phase === "running") return;
    // Leaving the done screen discards the one-time passwords; the download
    // button sits right above, so this is deliberate.
    if (!o) reset();
    onOpenChange(o);
  };

  const downloadTemplate = async () => {
    const l1 = classes[0]?.label ?? "Class 9";
    const l2 = classes[1]?.label ?? classes[0]?.label ?? "Class 10";
    // Demo phones deliberately avoid common real-looking numbers -
    // profiles.phone is unique platform-wide, so a colliding demo row would
    // be rejected with "phone already used by another account".
    await downloadXlsxTemplate("olympiad-teachers-template.xlsx", HEADERS, [
      ["Priya Sharma", "priya.sharma@example.com", "9800000101", l1],
      ["Rahul Mehta", "rahul.mehta@example.com", "9800000102", `${l1}, ${l2}`],
    ]);
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const raw = await parseXlsxRows(file);
      const parsed: ParsedRow[] = [];
      const errs: RowIssue[] = [];
      const seenEmails = new Set<string>();
      raw.forEach((r, i) => {
        const rowNo = i + 2;
        const fullName = cellText(r, "Teacher Name");
        const email = cellText(r, "Email").toLowerCase();
        const phone = cellText(r, "Phone").replace(/\D/g, "");
        const classesCell = cellText(r, "Classes");
        if (!fullName && !email && !phone && !classesCell) return; // blank row

        const problems: string[] = [];
        if (!fullName) problems.push("teacher name is missing");
        if (!EMAIL_RE.test(email)) problems.push("email is invalid");
        else if (seenEmails.has(email)) problems.push("duplicate email in this file");
        if (!PHONE_RE.test(phone)) problems.push("phone must be a 10-digit mobile starting 6-9");

        const labels = classesCell.split(",").map((s) => s.trim()).filter(Boolean);
        const resolved: ClassOption[] = [];
        if (labels.length === 0) problems.push("at least one class is required");
        for (const l of labels) {
          const hit = resolveClass(l, classes);
          if (!hit) problems.push(`class "${l}" doesn't match a participating class`);
          else if (!resolved.some((c) => c.gradeLevelId === hit.gradeLevelId)) resolved.push(hit);
        }

        if (problems.length > 0) {
          errs.push({ rowNo, message: problems.join("; ") });
        } else {
          seenEmails.add(email);
          parsed.push({
            rowNo, fullName, email, phone,
            gradeLevelIds: resolved.map((c) => c.gradeLevelId),
            classLabels: resolved.map((c) => c.label),
          });
        }
      });
      if (parsed.length === 0 && errs.length === 0) {
        toast.error("The file has no teacher rows. Fill the template and re-upload.");
        return;
      }
      setRows(parsed);
      setIssues(errs);
      setPhase("review");
    } catch (e) {
      toastError(e as Error, { fallback: "Couldn't read that file. Is it the .xlsx template?", context: "BulkAddTeachers" });
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const run = async () => {
    if (runningRef.current || rows.length === 0) return;
    runningRef.current = true;
    setPhase("running");
    const out: RowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(i + 1);
      try {
        const res = await invokeEdgeFunction<CreateOlympiadTeacherResult>("oly-create-teacher", {
          oly_school_id: olySchoolId,
          full_name: row.fullName,
          email: row.email,
          phone: row.phone,
          grade_level_ids: row.gradeLevelIds,
        });
        out.push({ fullName: row.fullName, email: res.email, classLabels: row.classLabels, tempPassword: res.temp_password, status: "created" });
      } catch (e) {
        out.push({ fullName: row.fullName, email: row.email, classLabels: row.classLabels, status: "failed", message: (e as Error).message });
      }
    }
    setResults(out);
    setPhase("done");
    runningRef.current = false;
    queryClient.invalidateQueries({ queryKey: ["olympiad", "teachers"] });
    const created = out.filter((r) => r.status === "created").length;
    if (created > 0) toast.success(`${created} teacher account${created === 1 ? "" : "s"} created`);
  };

  const downloadCredentials = () =>
    downloadXlsxData(
      "olympiad-teacher-credentials.xlsx",
      ["Teacher Name", "Email", "Temporary Password", "Classes", "Status"],
      results.map((r) => [r.fullName, r.email, r.tempPassword ?? "", r.classLabels.join(", "), r.status]),
    );

  const createdCount = results.filter((r) => r.status === "created").length;

  return (
    <MobileSheet
      open={open}
      onOpenChange={handleOpenChange}
      title="Bulk upload teachers"
      subtitle={
        phase === "done"
          ? "Download the credentials before closing - passwords are shown once."
          : "Download the template, fill it, and upload"
      }
      icon={<FileSpreadsheet className="h-4 w-4" />}
      primaryAction={
        phase === "review"
          ? {
              label: `Create ${rows.length} teacher${rows.length === 1 ? "" : "s"}`,
              onClick: () => void run(),
              disabled: rows.length === 0,
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
                  Excel file with the exact headings and 2 example teachers. Class names match your school.
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
                  We check every row first and show any problems before creating accounts.
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
          <div className="rounded-xl border border-surface-stroke bg-surface-card p-4">
            <p className="text-sm font-semibold text-ink-900">
              {rows.length} teacher{rows.length === 1 ? "" : "s"} ready to create
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-ink-700">
              {rows.map((r) => (
                <li key={r.rowNo} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{r.fullName} <span className="text-ink-500">({r.email})</span></span>
                  <span className="shrink-0 text-ink-500">{r.classLabels.join(", ")}</span>
                </li>
              ))}
            </ul>
            {issues.length > 0 && (
              <div className="mt-3 space-y-1 rounded-lg bg-rose-50 p-3 dark:bg-rose-500/10">
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
        )}

        {phase === "running" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
            <p className="text-sm text-ink-600">
              Creating {progress} of {rows.length}...
            </p>
            <p className="text-xs text-ink-500">Keep this sheet open until it finishes.</p>
          </div>
        )}

        {phase === "done" && (
          <>
            <div className="rounded-xl border border-surface-stroke bg-surface-card p-4 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {createdCount} created
                {results.length - createdCount > 0 && (
                  <span className="flex items-center gap-1 text-rose-600">
                    <XCircle className="h-4 w-4" /> {results.length - createdCount} failed
                  </span>
                )}
              </p>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {results.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-ink-900">{r.fullName} <span className="text-ink-500">({r.email})</span></span>
                    {r.status === "created" ? (
                      <span className="shrink-0 font-mono text-emerald-700 dark:text-emerald-400">{r.tempPassword}</span>
                    ) : (
                      <span className="shrink-0 max-w-[50%] truncate text-rose-600" title={r.message}>{r.message}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                These temporary passwords are shown only once. Download them before closing.
              </p>
            </div>
            {createdCount > 0 && (
              <Button type="button" variant="outline" className="w-full" onClick={() => void downloadCredentials()}>
                <Download className="mr-2 h-4 w-4" /> Download credentials (.xlsx)
              </Button>
            )}
          </>
        )}
      </form>
    </MobileSheet>
  );
}
