import { BarChart3, ClipboardCheck, FileText, Users } from "lucide-react";

/**
 * The four CBSE / onboarding reports. One list, read by both the dashboard's
 * Download report menu and the ReportModal that generates them, so a report
 * named in the menu is exactly the one the dialog builds.
 */
export const CBSE_REPORT_TYPES = [
  {
    value: "compliance",
    icon: FileText,
    title: "Full CBSE Compliance Report",
    description: "Complete record · CBSE Affiliation Bye-Laws Clause 14.19",
    format: "PDF",
  },
  {
    value: "inspection",
    icon: ClipboardCheck,
    title: "Inspection Readiness Report",
    description: "What CBSE physically checks on inspection day",
    format: "PDF",
  },
  {
    value: "academic",
    icon: BarChart3,
    title: "Academic Performance Report",
    description: "Academic analysis for CBSE SQAA evidence",
    format: "PDF",
  },
  {
    value: "onboarding",
    icon: Users,
    title: "Onboarding Report",
    description: "Teacher & coordinator onboarding journey · Excel workbook",
    format: "Excel",
  },
] as const;

export type CbseReportType = (typeof CBSE_REPORT_TYPES)[number]["value"];
