import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/toast";
import { saveBlob } from "@/lib/native";
import { cn } from "@/lib/utils";
import { useProfileData } from "@/hooks/useProfileData";
import { fetchStudentYearReport } from "@/hooks/useStudentYearReport";
import { buildStudentReportHtml } from "@/lib/report/buildStudentReportHtml";
import { loadImageAsDataUrl } from "@/lib/pdf/studentReport";

const COVER_URL = "/report/cover.jpg";

/**
 * Builds and downloads the student's year report as a PDF.
 *
 * The document is assembled as an HTML string and rendered from a detached
 * node rather than from the live dashboard. The old button printed whatever
 * happened to be on screen, which meant the PDF inherited the dashboard's
 * collapsed sections, its lazy charts and its dark mode.
 *
 * PAGINATION: each `.page` sheet is rasterised to ITS OWN canvas and placed as
 * exactly one A4 page via jsPDF. html2pdf.js is deliberately NOT used - it
 * rasterises the whole document into one tall canvas and slices it by height,
 * and when a sheet ends exactly on a slice boundary its "break after" logic
 * pushes a fully blank page. That is how the first shipped version produced a
 * 12-page PDF with every other page empty.
 *
 * html2canvas and jspdf are hoisted transitive deps of html2pdf.js; importing
 * them directly follows the existing precedent in src/lib/pdf/studentReport.ts
 * (which imports jspdf the same way). Both are dynamically imported (~1 MB) so
 * the dashboard route never pays for them (§23).
 */
export interface DownloadReportButtonProps {
  /**
   * Build the report for THIS student instead of the signed-in user. Routes the
   * fetch through student_year_report_for, which is authorised server-side
   * (migration 20260824120000) - the caller being on an admin screen is not a
   * permission.
   */
  studentId?: string;
  /** Identity for the report header when generating on a student's behalf. The
   *  signed-in profile is the staff member, so it is the wrong person. */
  student?: {
    name: string;
    className: string | null;
    section: string | null;
    rollNumber?: string | null;
    admissionNumber?: string | null;
  };
  label?: string;
  className?: string;
}

export function DownloadReportButton({
  studentId,
  student,
  label = "Download Report",
  className,
}: DownloadReportButtonProps = {}) {
  const { data: profile } = useProfileData();
  const [busy, setBusy] = useState(false);
  // Single-flight: a second click while a 1.3 MB chunk is still downloading
  // would otherwise start a second render and race the first to the filename.
  const runningRef = useRef(false);

  const handleDownload = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);

    const host = document.createElement("div");
    try {
      const [report, html2canvasMod, jsPdfMod, coverDataUrl] = await Promise.all([
        fetchStudentYearReport(studentId),
        import("html2canvas"),
        import("jspdf"),
        loadImageAsDataUrl(COVER_URL),
      ]);

      if (report.snapshot.n_assessments === 0) {
        toast.info(
          student
            ? `${student.name} has no published results yet, so there is nothing to report on.`
            : "No published results yet, so there is nothing to report on.",
        );
        return;
      }

      const studentClass = profile?.studentClass;
      const html = buildStudentReportHtml(report, {
        studentName: student?.name || profile?.full_name || "Student",
        className: student ? student.className : (studentClass?.name ?? null),
        section: student ? student.section : (studentClass?.section ?? null),
        rollNumber: student ? (student.rollNumber ?? null) : (profile?.roll_number ?? null),
        admissionNumber: student
          ? (student.admissionNumber ?? null)
          : (profile?.admission_number ?? null),
        schoolName: profile?.institution?.name || "School",
        // useProfileData selects only (id, name, code) from institutions, and
        // address is populated on 14 of 45 institutions anyway. The cover
        // collapses to the school name rather than carrying an empty line.
        schoolAddress: null,
        coverDataUrl,
        logoDataUrl: null,
      });

      // Off-screen but LAID OUT: html2canvas measures real geometry, so
      // display:none or visibility:hidden would rasterise an empty page.
      host.style.position = "fixed";
      host.style.left = "-10000px";
      host.style.top = "0";
      host.style.width = "210mm";
      host.style.background = "#ffffff";
      host.innerHTML = html;
      document.body.appendChild(host);

      const html2canvas = html2canvasMod.default;
      const { jsPDF } = jsPdfMod;

      const sheets = Array.from(host.querySelectorAll<HTMLElement>(".page"));
      if (sheets.length === 0) throw new Error("Report produced no pages.");

      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
      for (let i = 0; i < sheets.length; i++) {
        const canvas = await html2canvas(sheets[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        if (i > 0) pdf.addPage();
        // One sheet = one page, full bleed. No slicing anywhere in the path.
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297, undefined, "FAST");
      }
      // Named for the SUBJECT of the report, not the person clicking: a
      // principal downloading twenty reports must not get twenty files named
      // after themselves.
      const subject = student?.name || profile?.full_name || "student";
      saveBlob(pdf.output("blob"), `${subject.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report.pdf`);
    } catch (err) {
      toastError(err as Error, {
        fallback: student
          ? "Couldn't build that report. You may not have access to this student."
          : "Couldn't build your report. Please try again in a moment.",
        context: "downloadStudentReport",
      });
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
      runningRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Button
      onClick={handleDownload}
      disabled={busy}
      variant="outline"
      className={cn("gap-2", className)}
    >
      <Download className="h-4 w-4" />
      {busy ? "Building..." : label}
    </Button>
  );
}
