import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ExamAnalytics } from "@/hooks/useExamAnalytics";
import { useInstitutionBranding } from "@/hooks/useInstitutionBranding";
import { buildLetterheadHtml, loadLogoDataUrl } from "@/components/exam/paper";
import { escapeHtml } from "@/lib/escapeHtml";
import { saveBlob } from "@/lib/native";

interface StudentReportPDFProps {
  analytics: ExamAnalytics;
  studentId: string;
  iconOnly?: boolean;
}

export function StudentReportPDF({ analytics, studentId, iconOnly }: StudentReportPDFProps) {
  const [generating, setGenerating] = useState(false);
  const { branding } = useInstitutionBranding();

  const student = analytics.studentResults.find(s => s.studentId === studentId);
  if (!student) return null;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const a = analytics;
      const s = student;
      const logoDataUrl = await loadLogoDataUrl(branding?.logoUrl ?? null);
      const letterhead = buildLetterheadHtml(branding, a.exam.title, logoDataUrl, `Student Performance Report: ${s.studentName}`);
      const betterThan = Math.round(((a.totalAttempted - s.rank) / a.totalAttempted) * 100);

      const sectionRows = s.sectionScores.map(ss => {
        const classAvg = a.sectionAnalysis.find(sa => sa.sectionName === ss.sectionName)?.avgScore || 0;
        const pct = ss.maxMarks > 0 ? (ss.score / ss.maxMarks) * 100 : 0;
        const classPct = ss.maxMarks > 0 ? (classAvg / ss.maxMarks) * 100 : 0;
        const status = pct >= 80 ? "Excellent" : pct >= 60 ? "Good" : pct >= 40 ? "Average" : "Needs Work";
        const statusColor = pct >= 80 ? "#10b981" : pct >= 60 ? "#3b82f6" : pct >= 40 ? "#f59e0b" : "#ef4444";
        return `
        <tr>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0; font-size: 12px;">${escapeHtml(ss.sectionName)}</td>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0; text-align: center; font-size: 12px;">${ss.score}/${ss.maxMarks}</td>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0; text-align: center; font-size: 12px;">${classAvg}</td>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0;">
            <div style="display: flex; gap: 4px; align-items: center;">
              <div style="flex: 1; background: #e2e8f0; border-radius: 4px; height: 14px; position: relative;">
                <div style="width: ${classPct}%; background: #94a3b8; height: 100%; border-radius: 4px; position: absolute;"></div>
                <div style="width: ${pct}%; background: ${statusColor}; height: 100%; border-radius: 4px; position: absolute;"></div>
              </div>
            </div>
          </td>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: ${statusColor}; font-weight: 600;">${status}</td>
        </tr>`;
      }).join("");

      const questionRows = a.questionAnalysis.map((q, i) => {
        const qs = s.questionScores.find(x => x.questionId === q.questionId);
        const score = qs?.score || 0;
        const time = qs?.timeSeconds || 0;
        const mins = Math.floor(time / 60);
        const secs = time % 60;
        return `
        <tr>
          <td style="padding: 4px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Q${i + 1}</td>
          <td style="padding: 4px 6px; border: 1px solid #e2e8f0; font-size: 11px;">${q.tags.length > 0 ? escapeHtml(q.tags.join(', ')) : '-'}</td>
          <td style="padding: 4px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: ${score >= q.marks * 0.8 ? '#10b981' : score >= q.marks * 0.5 ? '#f59e0b' : '#ef4444'}; font-weight: 600;">${score}</td>
          <td style="padding: 4px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${q.marks}</td>
          <td style="padding: 4px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${time > 0 ? `${mins}m ${secs}s` : '-'}</td>
        </tr>`;
      }).join("");

      const strengthTags = s.strengths.length > 0
        ? s.strengths.map(t => `<span style="display: inline-block; padding: 3px 10px; background: #dcfce7; color: #15803d; border-radius: 12px; font-size: 11px; margin: 2px;">${escapeHtml(t)}</span>`).join("")
        : '<span style="color: #94a3b8; font-size: 12px;">No strong topics identified</span>';

      const weakTags = s.weakTopics.length > 0
        ? s.weakTopics.map(t => `<span style="display: inline-block; padding: 3px 10px; background: #fee2e2; color: #dc2626; border-radius: 12px; font-size: 11px; margin: 2px;">${escapeHtml(t)}</span>`).join("")
        : '<span style="color: #94a3b8; font-size: 12px;">No weak topics identified</span>';

      const studyTips = s.weakTopics.length > 0
        ? `<ul style="font-size: 12px; color: #475569; padding-left: 16px; margin-top: 8px;">
            ${s.weakTopics.slice(0, 3).map(t => `<li style="margin: 4px 0;">Focus on <strong>${escapeHtml(t)}</strong>: practice more questions and review core concepts.</li>`).join("")}
           </ul>`
        : '<p style="font-size: 12px; color: #64748b;">Great performance! Keep up the good work.</p>';

      const content = document.createElement("div");
      content.innerHTML = `
        <div style="font-family: 'Segoe UI', sans-serif; padding: 20px; color: #1e293b;">
          ${letterhead}

          <div style="display: flex; gap: 16px; margin: 16px 0;">
            <div style="flex: 1;">
              <table style="font-size: 12px; width: 100%;">
                <tr><td style="padding: 4px 0; color: #64748b;">Student Name</td><td style="padding: 4px 0; font-weight: 600;">${escapeHtml(s.studentName)}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;">Roll Number</td><td style="padding: 4px 0;">${escapeHtml(s.rollNo) || '-'}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;">Admission Number</td><td style="padding: 4px 0;">${escapeHtml(s.admissionNo) || '-'}</td></tr>
              </table>
            </div>
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0;">
            <div style="flex: 1; min-width: 80px; padding: 12px; background: #eff6ff; border-radius: 8px; text-align: center;">
              <div style="font-size: 20px; font-weight: 700; color: #1d4ed8;">${s.totalScore}/${a.exam.totalMarks}</div>
              <div style="font-size: 10px; color: #64748b;">Score</div>
            </div>
            <div style="flex: 1; min-width: 80px; padding: 12px; background: ${s.passed ? '#f0fdf4' : '#fef2f2'}; border-radius: 8px; text-align: center;">
              <div style="font-size: 20px; font-weight: 700; color: ${s.passed ? '#15803d' : '#dc2626'};">${s.percentage}%</div>
              <div style="font-size: 10px; color: #64748b;">Percentage</div>
            </div>
            <div style="flex: 1; min-width: 80px; padding: 12px; background: #faf5ff; border-radius: 8px; text-align: center;">
              <div style="font-size: 20px; font-weight: 700; color: #7c3aed;">${s.grade}</div>
              <div style="font-size: 10px; color: #64748b;">Grade</div>
            </div>
            <div style="flex: 1; min-width: 80px; padding: 12px; background: #fefce8; border-radius: 8px; text-align: center;">
              <div style="font-size: 20px; font-weight: 700; color: #a16207;">#${s.rank}</div>
              <div style="font-size: 10px; color: #64748b;">Rank</div>
            </div>
            <div style="flex: 1; min-width: 80px; padding: 12px; background: ${s.passed ? '#f0fdf4' : '#fef2f2'}; border-radius: 8px; text-align: center;">
              <div style="font-size: 16px; font-weight: 700; color: ${s.passed ? '#15803d' : '#dc2626'};">${s.passed ? 'PASSED' : 'FAILED'}</div>
              <div style="font-size: 10px; color: #64748b;">Result</div>
            </div>
          </div>

          <div style="padding: 10px 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; margin: 12px 0;">
            <p style="font-size: 12px; color: #475569; margin: 0;">
              📊 You scored higher than <strong>${betterThan}%</strong> of your class.
              Class average: <strong>${a.avgScore}%</strong>
            </p>
          </div>

          <!-- PAGE 2: Section Performance -->
          <div style="page-break-before: always;"></div>
          <h2 style="font-size: 15px; margin-bottom: 12px; color: #0f172a;">Section Performance</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="padding: 7px 8px; border: 1px solid #e2e8f0; text-align: left; font-size: 11px;">Section</th>
                <th style="padding: 7px 8px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Your Score</th>
                <th style="padding: 7px 8px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Class Avg</th>
                <th style="padding: 7px 8px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Comparison</th>
                <th style="padding: 7px 8px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Status</th>
              </tr>
            </thead>
            <tbody>${sectionRows}</tbody>
          </table>

          <!-- PAGE 3: Strengths & Weaknesses -->
          <div style="page-break-before: always;"></div>
          <h2 style="font-size: 15px; margin-bottom: 12px; color: #0f172a;">Strengths & Areas for Improvement</h2>
          
          <div style="display: flex; gap: 16px; margin-bottom: 16px;">
            <div style="flex: 1; padding: 14px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
              <h3 style="font-size: 13px; font-weight: 600; color: #15803d; margin: 0 0 8px;">💪 Strengths</h3>
              <div>${strengthTags}</div>
            </div>
            <div style="flex: 1; padding: 14px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
              <h3 style="font-size: 13px; font-weight: 600; color: #dc2626; margin: 0 0 8px;">📝 Needs Improvement</h3>
              <div>${weakTags}</div>
            </div>
          </div>

          <div style="padding: 12px 14px; background: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe;">
            <h3 style="font-size: 13px; font-weight: 600; color: #1d4ed8; margin: 0 0 6px;">📚 Study Tips</h3>
            ${studyTips}
          </div>

          <!-- PAGE 4: Question-wise Breakdown -->
          <div style="page-break-before: always;"></div>
          <h2 style="font-size: 15px; margin-bottom: 12px; color: #0f172a;">Question-wise Breakdown</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Q#</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; font-size: 11px;">Chapter Tags</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Your Score</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Max</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Time</th>
              </tr>
            </thead>
            <tbody>${questionRows}</tbody>
          </table>

          <p style="margin-top: 24px; font-size: 9px; color: #94a3b8; text-align: center;">Generated on ${new Date().toLocaleString()}</p>
        </div>
      `;

      const filename = `${s.studentName.replace(/\s+/g, "_")}_Report.pdf`;
      const blob: Blob = await html2pdf().set({
        margin: 10,
        filename,
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4" },
        pagebreak: { mode: ["css", "legacy"] },
      }).from(content).outputPdf("blob");
      saveBlob(blob, filename);
    } finally {
      setGenerating(false);
    }
  };

  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon" onClick={handleGenerate} disabled={generating} title="Download Student Report">
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Button onClick={handleGenerate} variant="outline" size="sm" disabled={generating}>
      {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
      {generating ? "Generating..." : "Download Report"}
    </Button>
  );
}
