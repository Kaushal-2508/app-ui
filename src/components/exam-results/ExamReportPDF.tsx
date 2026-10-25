import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ExamAnalytics } from "@/hooks/useExamAnalytics";
import { useInstitutionBranding } from "@/hooks/useInstitutionBranding";
import { buildLetterheadHtml, loadLogoDataUrl } from "@/components/exam/paper";
import { renderTextWithMathToHtml } from "@/lib/renderMathInHtml";
import { escapeHtml } from "@/lib/escapeHtml";
import { saveBlob } from "@/lib/native";

interface ExamReportPDFProps {
  analytics: ExamAnalytics;
}

export function ExamReportPDF({ analytics }: ExamReportPDFProps) {
  const [generating, setGenerating] = useState(false);
  const { branding } = useInstitutionBranding();

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const a = analytics;
      const logoDataUrl = await loadLogoDataUrl(branding?.logoUrl ?? null);
      const letterhead = buildLetterheadHtml(branding, a.exam.title, logoDataUrl, "Exam Analysis Report");

      const maxBucket = Math.max(...a.scoreDistribution.map(b => b.count), 1);

      const distBars = a.scoreDistribution.map(b => `
        <div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;">
          <span style="width: 60px; font-size: 11px; text-align: right;">${b.bucket}%</span>
          <div style="flex: 1; background: #e2e8f0; border-radius: 4px; height: 20px; position: relative;">
            <div style="width: ${(b.count / maxBucket) * 100}%; background: linear-gradient(90deg, #3b82f6, #6366f1); height: 100%; border-radius: 4px;"></div>
          </div>
          <span style="width: 30px; font-size: 11px;">${b.count}</span>
        </div>
      `).join("");

      const sectionRows = a.sectionAnalysis.map(s => `
        <tr>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0;">${escapeHtml(s.sectionName)}</td>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0; text-align: center;">${s.avgScore}</td>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0; text-align: center;">${s.maxPossible}</td>
          <td style="padding: 6px 8px; border: 1px solid #e2e8f0; text-align: center;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <div style="flex: 1; background: #e2e8f0; border-radius: 4px; height: 14px;">
                <div style="width: ${s.accuracyPercent}%; background: ${s.accuracyPercent >= 60 ? '#10b981' : s.accuracyPercent >= 40 ? '#f59e0b' : '#ef4444'}; height: 100%; border-radius: 4px;"></div>
              </div>
              <span style="font-size: 11px; min-width: 35px;">${s.accuracyPercent}%</span>
            </div>
          </td>
        </tr>
      `).join("");

      const sorted = [...a.questionAnalysis].sort((x, y) => x.correctRate - y.correctRate);
      const hardest5 = sorted.slice(0, 5).map(q => q.questionId);
      const easiest5 = sorted.slice(-5).map(q => q.questionId);

      const questionRows = a.questionAnalysis.map((q, i) => {
        const isHard = hardest5.includes(q.questionId);
        const isEasy = easiest5.includes(q.questionId);
        const bg = isHard ? "background: #fef2f2;" : isEasy ? "background: #f0fdf4;" : "";
        const diffColor = q.difficulty === "hard" ? "#ef4444" : q.difficulty === "medium" ? "#f59e0b" : "#10b981";
        return `
        <tr style="${bg}">
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">Q${i + 1}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; font-size: 11px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${renderTextWithMathToHtml(q.questionText)}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${q.marks}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${q.avgScore}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${q.correctRate}%</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;"><span style="color: ${diffColor}; font-weight: 600; text-transform: capitalize;">${q.difficulty}</span></td>
        </tr>`;
      }).join("");

      const rankRows = a.studentResults.map(s => `
        <tr style="${!s.passed ? 'background: #fef2f2;' : ''}">
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-weight: 600;">${s.rank}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(s.rollNo) || '-'}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(s.admissionNo) || '-'}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(s.studentName)}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${s.totalScore}/${a.exam.totalMarks}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${s.percentage}%</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px;">${escapeHtml(s.grade)}</td>
          <td style="padding: 5px 6px; border: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: ${s.passed ? '#10b981' : '#ef4444'}; font-weight: 600;">${s.passed ? 'Pass' : 'Fail'}</td>
        </tr>
      `).join("");

      const content = document.createElement("div");
      content.innerHTML = `
        <div style="font-family: 'Segoe UI', sans-serif; padding: 20px; color: #1e293b;">
          ${letterhead}

          <div style="display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0;">
            <div style="flex: 1; min-width: 100px; padding: 12px; background: #eff6ff; border-radius: 8px; text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #1d4ed8;">${a.totalAttempted}</div>
              <div style="font-size: 10px; color: #64748b;">Students</div>
            </div>
            <div style="flex: 1; min-width: 100px; padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #15803d;">${a.avgScore}%</div>
              <div style="font-size: 10px; color: #64748b;">Average</div>
            </div>
            <div style="flex: 1; min-width: 100px; padding: 12px; background: #faf5ff; border-radius: 8px; text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #7c3aed;">${a.median}%</div>
              <div style="font-size: 10px; color: #64748b;">Median</div>
            </div>
            <div style="flex: 1; min-width: 100px; padding: 12px; background: #fefce8; border-radius: 8px; text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #a16207;">${a.standardDeviation}</div>
              <div style="font-size: 10px; color: #64748b;">Std Dev</div>
            </div>
            <div style="flex: 1; min-width: 100px; padding: 12px; background: ${a.passRate >= 60 ? '#f0fdf4' : '#fef2f2'}; border-radius: 8px; text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: ${a.passRate >= 60 ? '#15803d' : '#dc2626'};">${a.passRate}%</div>
              <div style="font-size: 10px; color: #64748b;">Pass Rate</div>
            </div>
          </div>

          <div style="display: flex; gap: 16px; margin: 20px 0;">
            <div style="flex: 2;">
              <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">Score Distribution</h3>
              ${distBars}
            </div>
            <div style="flex: 1; text-align: center;">
              <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">Pass / Fail</h3>
              <div style="display: flex; justify-content: center; gap: 24px; margin-top: 12px;">
                <div>
                  <div style="font-size: 28px; font-weight: 700; color: #10b981;">${a.passCount}</div>
                  <div style="font-size: 11px; color: #64748b;">Passed</div>
                </div>
                <div>
                  <div style="font-size: 28px; font-weight: 700; color: #ef4444;">${a.failCount}</div>
                  <div style="font-size: 11px; color: #64748b;">Failed</div>
                </div>
              </div>
              <div style="margin-top: 12px;">
                <p style="font-size: 11px; color: #64748b;">Highest: <strong>${a.highestScore}%</strong> | Lowest: <strong>${a.lowestScore}%</strong></p>
              </div>
            </div>
          </div>

          <!-- PAGE 2: Section Analysis -->
          <div style="page-break-before: always;"></div>
          <h2 style="font-size: 16px; margin-bottom: 12px; color: #0f172a;">Section Analysis</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="padding: 8px; border: 1px solid #e2e8f0; text-align: left;">Section</th>
                <th style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">Avg Score</th>
                <th style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">Max Marks</th>
                <th style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">Accuracy</th>
              </tr>
            </thead>
            <tbody>${sectionRows}</tbody>
          </table>

          <!-- PAGE 3: Question Analysis -->
          <div style="page-break-before: always;"></div>
          <h2 style="font-size: 16px; margin-bottom: 12px; color: #0f172a;">Question Analysis</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Q#</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0;">Question</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Marks</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Avg</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Correct %</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Difficulty</th>
              </tr>
            </thead>
            <tbody>${questionRows}</tbody>
          </table>

          <!-- PAGE 4: Rank List -->
          <div style="page-break-before: always;"></div>
          <h2 style="font-size: 16px; margin-bottom: 12px; color: #0f172a;">Rank List</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Rank</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0;">Roll No</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0;">Admission No</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0;">Name</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Score</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">%</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Grade</th>
                <th style="padding: 6px; border: 1px solid #e2e8f0; text-align: center;">Result</th>
              </tr>
            </thead>
            <tbody>${rankRows}</tbody>
          </table>

          <p style="margin-top: 24px; font-size: 9px; color: #94a3b8; text-align: center;">Generated on ${new Date().toLocaleString()}</p>
        </div>
      `;

      const filename = `${a.exam.title.replace(/\s+/g, "_")}_Exam_Report.pdf`;
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

  return (
    <Button onClick={handleGenerate} variant="default" size="sm" disabled={generating}>
      {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
      {generating ? "Generating..." : "Download Exam Report"}
    </Button>
  );
}
