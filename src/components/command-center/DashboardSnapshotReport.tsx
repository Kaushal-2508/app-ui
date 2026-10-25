import { useMemo, useState } from "react";
import { FileText } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastError } from "@/lib/toast";
import { saveBlob } from "@/lib/native";
import { toast } from "sonner";

import {
  useDashboardKpis,
  useDashboardFlags,
  useClassesTable,
  useStudentsAttention,
  useTeachersTable,
  useRecentExams,
  useSubjectHeatmap,
  useStudentDistribution,
} from "@/hooks/dashboard/useDashboardData";
import type { KpiSummary } from "@/hooks/dashboard/types";

// ── Time range ────────────────────────────────────────────────────────────────
// Most dash_* RPCs return current state (no per-range slicing). The range is
// therefore primarily a *labeled scope* printed on the report. Where the RPC
// genuinely accepts a window (attendance trend), the day-count flows through;
// elsewhere we use current aggregates and stamp "as of {today}".
type RangeKey = "30d" | "term" | "year" | "custom";

const RANGE_LABELS: Record<RangeKey, string> = {
  "30d": "Last 30 days",
  term: "Last term",
  year: "Last academic year",
  custom: "Custom range",
};

interface SnapshotSections {
  flags: boolean;
  overview: boolean;
  tables: boolean;
}

export interface DashboardSnapshotReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionName: string;
}

const TODAY_ISO = new Date().toISOString().slice(0, 10);

const TODAY_LABEL = new Date().toLocaleDateString("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** HTML-escape a string before interpolating into the print container. */
function esc(value: unknown): string {
  if (value == null) return "N/A";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pct(value: number | null | undefined): string {
  return value == null ? "N/A" : `${value}%`;
}

// ── KPI interpretation (mirrors KpiStrip wording, distilled for print) ─────────
function kpiLines(k: KpiSummary): { label: string; value: string; note: string }[] {
  const a = k.attendance_today;
  const s = k.school_avg;
  const n = k.students_need_help;
  const d = k.decisions_waiting;
  return [
    {
      label: "Today's attendance",
      value: !a.marked || a.pct == null ? "N/A" : `${a.pct}%`,
      note: !a.marked || a.pct == null ? "Attendance not yet marked" : "Share of students present today",
    },
    {
      label: "School average this year",
      value: s.pct == null ? "N/A" : `${s.pct}%`,
      note:
        s.pct == null
          ? "No published exams yet"
          : `Across ${s.exams_count} published exam${s.exams_count === 1 ? "" : "s"}`,
    },
    {
      label: "Students who need help",
      value: String(n.count),
      note: n.count === 0 ? "No students flagged right now" : "Flagged for follow-up",
    },
    {
      label: "Decisions waiting",
      value: String(d.count),
      note: d.count === 0 ? "Nothing waiting right now" : "Open flags awaiting action",
    },
  ];
}

export function DashboardSnapshotReport({
  open,
  onOpenChange,
  institutionName,
}: DashboardSnapshotReportProps) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>(TODAY_ISO);
  const [sections, setSections] = useState<SnapshotSections>({
    flags: true,
    overview: true,
    tables: true,
  });
  const [generating, setGenerating] = useState(false);

  // All hooks are cached (the dashboard page already mounted them). Top-10 caps
  // for the drill-down tables — server-side pagination per CLAUDE.md §23.1.
  const kpis = useDashboardKpis();
  const flags = useDashboardFlags();
  const distribution = useStudentDistribution();
  const heatmap = useSubjectHeatmap();
  const classes = useClassesTable({}, 10, 0);
  const students = useStudentsAttention({}, 10, 0);
  const teachers = useTeachersTable({}, 10, 0);
  const exams = useRecentExams({}, 10, 0);

  const rangeLabel = useMemo(() => {
    if (range === "custom") {
      const from = customFrom || "start";
      return `Custom range (${from} → ${customTo || TODAY_ISO})`;
    }
    return RANGE_LABELS[range];
  }, [range, customFrom, customTo]);

  const customInvalid =
    range === "custom" && !!customFrom && !!customTo && customFrom > customTo;

  function buildReportHtml(): string {
    const parts: string[] = [];

    // ── Document header ──────────────────────────────────────────────────────
    parts.push(`
      <header style="border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:20px;">
        <h1 style="margin:0;font-size:22pt;">${esc(institutionName)}</h1>
        <p style="margin:4px 0 0;font-size:13pt;font-weight:600;">Dashboard snapshot</p>
        <p style="margin:6px 0 0;font-size:10pt;color:#444;">
          Scope: ${esc(rangeLabel)} &nbsp;•&nbsp; Generated: ${esc(TODAY_LABEL)} &nbsp;•&nbsp; Figures as of ${esc(TODAY_LABEL)}
        </p>
      </header>
    `);

    // ── Flag summary ─────────────────────────────────────────────────────────
    if (sections.flags) {
      const rows = flags.data ?? [];
      const bySeverity: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const f of rows) {
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
        byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
      }
      const sevOrder = ["critical", "warning", "info"];
      const sevHtml = sevOrder
        .filter((s) => bySeverity[s])
        .map((s) => `<li>${esc(s)}: <strong>${bySeverity[s]}</strong></li>`)
        .join("");
      const catHtml = Object.entries(byCategory)
        .map(([c, count]) => `<li>${esc(c)}: <strong>${count}</strong></li>`)
        .join("");

      const listRows = rows.length
        ? rows
            .map(
              (f) => `
              <tr>
                <td>${esc(f.title)}</td>
                <td>${esc(f.category)}</td>
                <td>${esc(f.severity)}</td>
                <td>${esc(f.status)}</td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="4" style="text-align:center;color:#666;">No open flags.</td></tr>`;

      parts.push(`
        <section>
          <h2>Flag summary</h2>
          <p style="margin:0 0 8px;">Open flags: <strong>${rows.length}</strong></p>
          <div style="display:flex;gap:32px;margin-bottom:12px;">
            <div>
              <h4 style="margin:0 0 4px;">By severity</h4>
              <ul style="margin:0;">${sevHtml || "<li>None</li>"}</ul>
            </div>
            <div>
              <h4 style="margin:0 0 4px;">By category</h4>
              <ul style="margin:0;">${catHtml || "<li>None</li>"}</ul>
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Flag</th><th>Category</th><th>Severity</th><th>Status</th></tr>
            </thead>
            <tbody>${listRows}</tbody>
          </table>
        </section>
      `);
    }

    // ── Overview numbers ─────────────────────────────────────────────────────
    if (sections.overview) {
      let kpiHtml = `<tr><td colspan="3" style="text-align:center;color:#666;">No KPI data.</td></tr>`;
      if (kpis.data) {
        kpiHtml = kpiLines(kpis.data)
          .map(
            (l) => `
            <tr>
              <td>${esc(l.label)}</td>
              <td style="font-weight:700;text-align:center;">${esc(l.value)}</td>
              <td>${esc(l.note)}</td>
            </tr>`,
          )
          .join("");
      }

      const dist = distribution.data;
      const distHtml = dist
        ? `
        <table>
          <thead><tr><th>Band</th><th>Students</th></tr></thead>
          <tbody>
            <tr><td>Doing well</td><td style="text-align:center;">${dist.doing_well}</td></tr>
            <tr><td>Catching up</td><td style="text-align:center;">${dist.catching_up}</td></tr>
            <tr><td>Needs help</td><td style="text-align:center;">${dist.needs_help}</td></tr>
            <tr><td><strong>Evaluated</strong></td><td style="text-align:center;"><strong>${dist.evaluated}</strong> of ${dist.total}</td></tr>
          </tbody>
        </table>`
        : `<p style="color:#666;">No student distribution data.</p>`;

      const hm = heatmap.data;
      let heatHtml = `<p style="color:#666;">No subject heatmap data.</p>`;
      if (hm && hm.rows.length) {
        const groupingLabel = hm.grouping === "wings" ? "Wing" : "Grade band";
        const heatRows = hm.rows
          .map((r) => {
            const cells = r.cells.length
              ? r.cells
                  .map((c) => `${esc(c.subject_name)} (${c.avg_pct}% · ${esc(c.band)})`)
                  .join("; ")
              : "N/A";
            return `<tr><td>${esc(r.band_label)}</td><td>${cells}</td></tr>`;
          })
          .join("");
        heatHtml = `
          <table>
            <thead><tr><th>${groupingLabel}</th><th>Subjects (avg % · band)</th></tr></thead>
            <tbody>${heatRows}</tbody>
          </table>`;
      }

      parts.push(`
        <section>
          <h2>Overview numbers</h2>
          <h3>Key indicators</h3>
          <table>
            <thead><tr><th>Indicator</th><th>Value</th><th>What it means</th></tr></thead>
            <tbody>${kpiHtml}</tbody>
          </table>
          <h3>Student distribution</h3>
          ${distHtml}
          <h3>Class × Subject performance</h3>
          ${heatHtml}
        </section>
      `);
    }

    // ── Drill-down tables ────────────────────────────────────────────────────
    if (sections.tables) {
      const classRows = classes.data?.rows ?? [];
      const studentRows = students.data?.rows ?? [];
      const teacherRows = teachers.data?.rows ?? [];
      const examRows = exams.data?.rows ?? [];

      const emptyRow = (cols: number) =>
        `<tr><td colspan="${cols}" style="text-align:center;color:#666;">No data.</td></tr>`;

      const classesTable = classRows.length
        ? classRows
            .map(
              (c) => `
              <tr>
                <td>${esc(c.name)}</td>
                <td style="text-align:center;">${c.students}</td>
                <td style="text-align:center;">${pct(c.attendance_30d)}</td>
                <td style="text-align:center;">${pct(c.recent_avg)}</td>
                <td style="text-align:center;">${c.active_flags}</td>
              </tr>`,
            )
            .join("")
        : emptyRow(5);

      const studentsTable = studentRows.length
        ? studentRows
            .map(
              (s) => `
              <tr>
                <td>${esc(s.name)}</td>
                <td>${esc(s.class)}</td>
                <td style="text-align:center;">${esc(s.band)}</td>
                <td>${esc(s.reason)}</td>
                <td style="text-align:center;">${pct(s.attendance)}</td>
                <td style="text-align:center;">${pct(s.recent_pct)}</td>
              </tr>`,
            )
            .join("")
        : emptyRow(6);

      const teachersTable = teacherRows.length
        ? teacherRows
            .map(
              (t) => `
              <tr>
                <td>${esc(t.name)}</td>
                <td>${esc(t.role)}</td>
                <td>${esc(t.wing ?? "N/A")}</td>
                <td style="text-align:center;">${t.classes}</td>
                <td style="text-align:center;">${t.lessons_30d}</td>
                <td style="text-align:center;">${t.attendance_days_30d}</td>
                <td style="text-align:center;">${t.homework_30d}</td>
                <td style="text-align:center;">${t.exams_30d}</td>
              </tr>`,
            )
            .join("")
        : emptyRow(8);

      const examsTable = examRows.length
        ? examRows
            .map(
              (e) => `
              <tr>
                <td>${esc(e.title)}</td>
                <td>${esc(e.exam_type)}</td>
                <td>${esc(e.status)}</td>
                <td>${esc(e.exam_date ?? "N/A")}</td>
                <td style="text-align:center;">${e.attempted}/${e.assigned}</td>
                <td style="text-align:center;">${pct(e.avg_pct)}</td>
              </tr>`,
            )
            .join("")
        : emptyRow(6);

      parts.push(`
        <section style="page-break-before:always;">
          <h2>Drill-down tables</h2>
          <p style="margin:0 0 10px;color:#444;font-size:9pt;">Top 10 rows per table.</p>

          <h3>Classes</h3>
          <table>
            <thead><tr><th>Class</th><th>Students</th><th>Attendance (30d)</th><th>Recent avg</th><th>Flags</th></tr></thead>
            <tbody>${classesTable}</tbody>
          </table>

          <h3>Students needing attention</h3>
          <table>
            <thead><tr><th>Student</th><th>Class</th><th>Band</th><th>Reason</th><th>Attendance</th><th>Recent %</th></tr></thead>
            <tbody>${studentsTable}</tbody>
          </table>

          <h3>Teachers</h3>
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Wing</th><th>Classes</th><th>Lessons (30d)</th><th>Days marked (30d)</th><th>Homework (30d)</th><th>Exams (30d)</th></tr></thead>
            <tbody>${teachersTable}</tbody>
          </table>

          <h3>Recent exams</h3>
          <table>
            <thead><tr><th>Exam</th><th>Type</th><th>Status</th><th>Date</th><th>Attempted</th><th>Avg %</th></tr></thead>
            <tbody>${examsTable}</tbody>
          </table>
        </section>
      `);
    }

    parts.push(`
      <footer style="margin-top:28px;padding-top:8px;border-top:1px solid #ccc;font-size:8pt;color:#888;text-align:center;">
        ${esc(institutionName)} · Dashboard snapshot · Generated ${esc(TODAY_LABEL)}
      </footer>
    `);

    return `
      <div style="font-family:Georgia,'Times New Roman',serif;color:#111;padding:8px;font-size:11pt;line-height:1.5;">
        <style>
          h2 { font-size:16pt; margin:20pt 0 8pt; border-bottom:1px solid #ddd; padding-bottom:4pt; }
          h3 { font-size:12pt; margin:14pt 0 6pt; }
          h4 { font-size:10pt; margin:0 0 4pt; }
          table { border-collapse:collapse; width:100%; margin-bottom:10pt; font-size:9.5pt; page-break-inside:avoid; }
          th, td { border:1px solid #ccc; padding:5px 7px; text-align:left; vertical-align:top; }
          th { background:#f3f3f3; font-weight:bold; }
          ul { padding-left:18pt; margin:0; }
          section { page-break-inside:auto; }
        </style>
        ${parts.join("\n")}
      </div>
    `;
  }

  const toggle = (key: keyof SnapshotSections) =>
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleGenerate = async () => {
    if (customInvalid) {
      toast.error("The custom range's start date is after its end date.");
      return;
    }
    if (!sections.flags && !sections.overview && !sections.tables) {
      toast.error("Pick at least one section to include.");
      return;
    }
    setGenerating(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const container = document.createElement("div");
      container.innerHTML = buildReportHtml();

      const safeName = institutionName.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") || "School";
      const filename = `${safeName}_Dashboard_Snapshot_${TODAY_ISO}.pdf`;
      const blob: Blob = await html2pdf()
        .set({
          margin: 12,
          filename,
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(container)
        .outputPdf("blob");
      saveBlob(blob, filename);

      toast.success("Dashboard snapshot generated.");
      onOpenChange(false);
    } catch (err) {
      toastError(err, {
        fallback: "Couldn't generate the dashboard snapshot.",
        context: "dashboardSnapshotReport",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Dashboard snapshot"
      subtitle="Print-ready summary for management meetings"
      icon={<FileText className="h-4 w-4" />}
      primaryAction={{
        label: "Generate report",
        onClick: handleGenerate,
        loading: generating,
        disabled: generating || customInvalid,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-6">
        {/* Time range */}
        <div className="space-y-2">
          <Label className="text-ink-900">Time range</Label>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="term">Last term</SelectItem>
              <SelectItem value="year">Last academic year</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          {range === "custom" && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <Label htmlFor="snap-from" className="text-xs text-ink-600">
                  From
                </Label>
                <Input
                  id="snap-from"
                  type="date"
                  max={TODAY_ISO}
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="snap-to" className="text-xs text-ink-600">
                  To
                </Label>
                <Input
                  id="snap-to"
                  type="date"
                  max={TODAY_ISO}
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
            </div>
          )}

          {customInvalid && (
            <p className="text-xs text-destructive">Start date must be on or before the end date.</p>
          )}

          <p className="text-xs text-ink-500">
            The dashboard figures reflect the current state of the school. The selected range is
            printed as the report&apos;s scope; figures are stamped &ldquo;as of today&rdquo;.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-3">
          <Label className="text-ink-900">Sections to include</Label>
          <div className="space-y-3">
            <label className="flex items-start gap-3">
              <Checkbox
                checked={sections.flags}
                onCheckedChange={() => toggle("flags")}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-ink-900">Flag summary</span>
                <span className="block text-xs text-ink-500">
                  Counts by severity &amp; category, plus the list of open flags.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3">
              <Checkbox
                checked={sections.overview}
                onCheckedChange={() => toggle("overview")}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-ink-900">Overview numbers</span>
                <span className="block text-xs text-ink-500">
                  The four KPIs, student distribution, and the Class × Subject heatmap.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3">
              <Checkbox
                checked={sections.tables}
                onCheckedChange={() => toggle("tables")}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-ink-900">Drill-down tables</span>
                <span className="block text-xs text-ink-500">
                  Top 10 classes, students needing attention, teachers, and recent exams.
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>
    </MobileSheet>
  );
}
