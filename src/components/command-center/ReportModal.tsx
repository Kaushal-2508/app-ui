import { saveBlob } from "@/lib/native";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateComplianceReport, generateInspectionReport, generateAcademicReport } from "@/utils/generateCBSEReports";
import { generateOnboardingWorkbook, type OnboardingReportRow } from "@/utils/generateOnboardingReport";
import { supabase } from "@/integrations/supabase/client";
import type { CommandCenterData } from "@/hooks/useCommandCenter";
import { CBSE_REPORT_TYPES as REPORT_TYPES, type CbseReportType } from "./cbseReportTypes";

interface ReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: CommandCenterData;
  /**
   * Opened from a specific item of the dashboard's Download report menu: that
   * report is already chosen, so the dialog asks only for the year and term
   * and does not offer the four-way choice again.
   */
  initialType?: CbseReportType;
}

const TERMS = [
  { value: "full_year", label: "Full Year" },
  { value: "term_1", label: "Term 1" },
  { value: "term_2", label: "Term 2" },
];

export function ReportModal({ open, onOpenChange, data, initialType }: ReportModalProps) {
  const [reportType, setReportType] = useState<string>(initialType ?? "compliance");
  const picked = initialType ? REPORT_TYPES.find((t) => t.value === initialType) : undefined;
  const [academicYear, setAcademicYear] = useState<string>("");
  const [term, setTerm] = useState<string>("full_year");
  const [generating, setGenerating] = useState(false);
  const navigate = useNavigate();

  const handleOpenDashboard = () => {
    onOpenChange(false);
    navigate("/school/onboarding-dashboard");
  };

  const isOnboardingReport = reportType === "onboarding";

  const handleGenerate = async () => {
    if (!isOnboardingReport && !academicYear) {
      toast.error("Please select an academic year");
      return;
    }

    setGenerating(true);
    try {
      const reportData = {
        schoolName: data.institutionName || "School",
        academicYear,
        term,
        schoolAvg: data.schoolAvg,
        passRate: data.passRate,
        todayPct: data.todayPct,
        todayPresent: data.todayPresent,
        todayTotal: data.todayTotal,
        studentPositioning: data.studentPositioning,
        examPipeline: data.examPipeline,
        feeDefaulterCount: data.feeDefaulterCount,
        feeDefaulterAmount: data.feeDefaulterAmount,
        feeCollectionPct: data.feeCollectionPct,
        complianceScore: data.complianceScore,
        pendingEvals: data.pendingEvals,
        highestClass: data.highestClass,
        lowestClass: data.lowestClass,
        aiPendingCount: data.aiPendingCount,
        improvementRate: data.improvementRate,
      };

      const hasFeature = (key: string) => {
        if (key === "finance") return data.hasFinanceFeature;
        if (key === "compliance") return true; // always shown
        if (key === "ai_suggestions") return data.hasAIFeature;
        return data.isFeatureEnabled(key);
      };

      let blob: Blob;
      let filename: string;
      const safeSchoolName = (data.institutionName || "School").replace(/\s+/g, "_");

      switch (reportType) {
        case "compliance":
          blob = await generateComplianceReport(reportData, hasFeature);
          filename = `${safeSchoolName}_CBSE_Compliance_${academicYear}_${term}.pdf`;
          break;
        case "inspection":
          blob = await generateInspectionReport(reportData, hasFeature);
          filename = `${safeSchoolName}_Inspection_Readiness_${academicYear}_${term}.pdf`;
          break;
        case "academic":
          blob = await generateAcademicReport(reportData, hasFeature);
          filename = `${safeSchoolName}_Academic_Performance_${academicYear}_${term}.pdf`;
          break;
        case "onboarding": {
          if (!data.institutionId) {
            throw new Error("No institution selected");
          }
          const { data: rows, error } = await supabase.rpc(
            "get_institution_onboarding_progress",
            { _institution_id: data.institutionId },
          );
          if (error) throw error;
          blob = generateOnboardingWorkbook({
            schoolName: data.institutionName || "School",
            rows: (rows as OnboardingReportRow[]) ?? [],
          });
          const dateStamp = new Date().toISOString().slice(0, 10);
          filename = `${safeSchoolName}_Onboarding_Report_${dateStamp}.xlsx`;
          break;
        }
        default:
          throw new Error("Invalid report type");
      }

      // Trigger download
      saveBlob(blob, filename);

      toast.success("Report generated successfully");
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{picked ? picked.title : "Generate Report"}</DialogTitle>
          <DialogDescription>
            {picked
              ? `${picked.description}. Downloads as ${picked.format === "Excel" ? "an Excel workbook" : "a PDF"}.`
              : "Choose a report. CBSE reports download as PDF, onboarding downloads as Excel."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Step 1: Report type (already chosen when opened from the menu) */}
          {!picked && (
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Report type</Label>
            <RadioGroup value={reportType} onValueChange={setReportType} className="grid gap-3">
              {REPORT_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <Label key={type.value} htmlFor={type.value} className="cursor-pointer">
                    <Card className={`transition-colors ${reportType === type.value ? "border-primary ring-1 ring-primary" : "hover:bg-secondary/50"}`}>
                      <CardContent className="p-4 flex items-start gap-3">
                        <RadioGroupItem value={type.value} id={type.value} className="mt-1" />
                        <Icon className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{type.title}</p>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded">
                              {type.format}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{type.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>
          )}

          {/* Step 2: Academic year (hidden for onboarding — snapshot is always current) */}
          {!isOnboardingReport && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Academic year</Label>
              <Select value={academicYear} onValueChange={setAcademicYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Select academic year" />
                </SelectTrigger>
                <SelectContent>
                  {data.academicYears.map((year) => (
                    <SelectItem key={year} value={year}>{year}</SelectItem>
                  ))}
                  {data.academicYears.length === 0 && (
                    <SelectItem value="current" disabled>No academic years found</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Step 3: Term (hidden for onboarding) */}
          {!isOnboardingReport && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Term</Label>
              <RadioGroup value={term} onValueChange={setTerm} className="flex gap-4">
                {TERMS.map((t) => (
                  <div key={t.value} className="flex items-center gap-2">
                    <RadioGroupItem value={t.value} id={`term-${t.value}`} />
                    <Label htmlFor={`term-${t.value}`} className="cursor-pointer text-sm">{t.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {isOnboardingReport && (
            <p className="text-xs text-muted-foreground">
              Downloads the current onboarding snapshot for every teacher and coordinator in this institution as an Excel workbook.
            </p>
          )}

          {/* Action row — onboarding gets a second sibling "Open Dashboard" button */}
          {isOnboardingReport ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={handleGenerate} disabled={generating} className="flex-1">
                {generating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                ) : (
                  "Generate & Download Excel"
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={handleOpenDashboard}
                disabled={generating}
                className="flex-1"
              >
                Open Dashboard
              </Button>
            </div>
          ) : (
            <Button onClick={handleGenerate} disabled={generating} className="w-full">
              {generating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              ) : (
                "Generate & Download PDF"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
