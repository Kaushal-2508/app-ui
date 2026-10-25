import {
  Activity, BadgeIndianRupee, BarChart3, BookOpenCheck, CalendarClock, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, FileSpreadsheet, FileText, GraduationCap,
  Layers, Receipt, ScrollText,
  ShieldCheck, UserCheck, Users, Wallet,
} from "lucide-react";

import { FEATURE_URL_MAP } from "@/components/admin/institution-wizard/featuresData";

import type { CbseReportType } from "./cbseReportTypes";
import type { ReportCategory, ReportItem } from "./ReportsCenter";

/**
 * Every report a school admin can download or generate anywhere in SALCI,
 * from the 2026-10-06 inventory of the whole app (51 downloads). Left out on
 * purpose: student-only downloads, internal super-admin documents, export
 * buttons that do nothing, two legacy snapshot PDFs no page links to, and
 * the per-exam downloads (analysis, student exam report, question paper)
 * the PTM feedback CSV and QR, and the Olympiad results, flyer and sign-ins,
 * which belong on the exam, meeting or Olympiad pages rather than in a
 * school-wide list (owner's call, 2026-10-06).
 *
 * Reports that need nothing from a particular page are generated in the
 * panel (`run`). The rest open the page that owns their inputs, on the right
 * tab where the page supports one. A report is shown only when its page's
 * feature is on: the same FEATURE_URL_MAP lookup the route guard uses, so the
 * panel can never offer a page the school cannot open.
 *
 * Titles and descriptions stay short enough for one line each at 375px.
 */

export const REPORT_CATEGORIES: ReportCategory[] = [
  { id: "dashboard",  label: "Dashboard",     tone: "teal",   icon: FileBarChart },
  { id: "teachers",   label: "Teachers",      tone: "violet", icon: Users },
  { id: "students",   label: "Students",      tone: "sky",    icon: GraduationCap },
  { id: "lessons",    label: "Lessons",       tone: "teal",   icon: BookOpenCheck },
  { id: "finance",    label: "Finance",       tone: "rose",   icon: Wallet },
  { id: "admin",      label: "Activity",      tone: "violet", icon: ShieldCheck },
  { id: "templates",  label: "Templates",     tone: "mint",   icon: FileSpreadsheet },
];

interface CatalogActions {
  openSchoolReport: () => void;
  openCbse: (type: CbseReportType) => void;
  openLessonPlan: () => void;
  isFeatureEnabled: (featureId: string) => boolean;
}

/** The feature a route needs, looked up the way ProtectedRoute does it. */
const featureOf = (to: string | undefined): string | undefined =>
  to ? FEATURE_URL_MAP[to.split("?")[0]] : undefined;

export function buildReportCatalog(a: CatalogActions): ReportItem[] {
  const all: (ReportItem & { feature?: string })[] = [
    // ---------------------------------------------------- dashboard & CBSE
    {
      id: "school-performance", category: "dashboard", icon: FileBarChart,
      title: "School performance", formats: ["PDF"],
      description: "Wings, classes, exams and attendance",
      run: a.openSchoolReport, keywords: "dashboard principal summary report",
    },
    {
      id: "cbse-compliance", category: "dashboard", icon: FileText,
      title: "CBSE compliance", formats: ["PDF"],
      description: "Affiliation Bye-Laws Clause 14.19",
      run: () => a.openCbse("compliance"), keywords: "cbse affiliation bye-laws full report",
    },
    {
      id: "cbse-inspection", category: "dashboard", icon: ClipboardCheck,
      title: "CBSE inspection readiness", formats: ["PDF"],
      description: "What CBSE checks on inspection day",
      run: () => a.openCbse("inspection"), keywords: "cbse inspection",
    },
    {
      id: "cbse-academic", category: "dashboard", icon: BarChart3,
      title: "CBSE academic performance", formats: ["PDF"],
      description: "SQAA averages, class results, toppers",
      run: () => a.openCbse("academic"), keywords: "cbse sqaa results",
    },
    {
      id: "cbse-onboarding", category: "admin", icon: Users,
      title: "Onboarding report", formats: ["Excel"],
      description: "Each teacher's onboarding milestones",
      run: () => a.openCbse("onboarding"), keywords: "onboarding journey milestones coordinator",
    },

    // ---------------------------------------------------- teachers & staff
    {
      id: "teacher-details", category: "teachers", icon: Users,
      title: "Teachers details", formats: ["Excel"],
      description: "Email, phone, classes and subjects",
      to: "/school/users?tab=teachers&report=teacher-details", place: "Teachers",
      keywords: "teacher list phone number classes subjects",
    },
    {
      id: "teacher-activity", category: "teachers", icon: Activity,
      title: "Teachers activity", formats: ["Excel"],
      description: "Last active and work done, 7 to 90 days",
      to: "/school/users?tab=teachers&report=teacher-activity", place: "Teachers",
      keywords: "teacher activity log last active engagement exams homework",
    },
    {
      id: "staff-attendance", category: "teachers", icon: UserCheck,
      title: "Staff attendance", formats: ["Excel"],
      description: "Daily check-in status for all staff",
      to: "/school/attendance?tab=reports", place: "Attendance reports",
      keywords: "staff check-in workday",
    },
    {
      id: "payroll", category: "finance", icon: Wallet,
      title: "Payroll", formats: ["Excel"],
      description: "Monthly pay, allowances and deductions",
      to: "/school/hr", place: "HR & Payroll",
      keywords: "salary payroll hr run",
    },
    {
      id: "salary-slip", category: "finance", icon: Receipt,
      title: "Salary slips", formats: ["PDF", "Print"],
      description: "One staff member's monthly slip",
      to: "/school/hr", place: "HR & Payroll",
      keywords: "salary slip payslip",
    },

    // ------------------------------------------------------------ students
    {
      id: "student-activity", category: "students", icon: Activity,
      title: "Student activity", formats: ["Excel"],
      description: "Sign-ins, exams, homework, attendance",
      to: "/school/attendance?tab=reports", place: "Attendance reports",
      keywords: "student activity login homework rechecks",
    },
    {
      id: "student-report-card", category: "students", icon: ScrollText,
      title: "Student year report", formats: ["PDF"],
      description: "One student's year report card",
      to: "/school/users?tab=students", place: "Students",
      keywords: "report card student pdf progress",
    },
    {
      id: "student-attendance", category: "students", icon: CalendarDays,
      title: "Student attendance", formats: ["Excel"],
      description: "Daily register and at-risk watchlist",
      to: "/school/attendance?tab=reports", place: "Attendance reports",
      keywords: "register present absent leave",
    },

    // ---------------------------------------------------- lessons & timetable
    {
      id: "lesson-plan", category: "lessons", icon: BookOpenCheck,
      title: "Lesson plan delivery", formats: ["Excel"],
      description: "Planned against taught, slot by slot",
      run: a.openLessonPlan, feature: "timetable",
      keywords: "lesson plan syllabus delivery week month year",
    },
    {
      id: "class-timetable", category: "lessons", icon: CalendarClock,
      title: "Class timetable", formats: ["Print"],
      description: "A class's weekly timetable",
      to: "/school/timetable", place: "Timetable",
      keywords: "timetable schedule periods optional baskets",
    },

    // ---------------------------------------------------- fees & billing
    {
      id: "fee-analytics", category: "finance", icon: BadgeIndianRupee,
      title: "Fee collection", formats: ["Excel"],
      description: "Collected, pending, overdue, defaulters",
      to: "/school/fees", place: "Fees",
      keywords: "fees collection defaulters category",
    },
    {
      id: "fee-receipt", category: "finance", icon: Receipt,
      title: "Fee receipts", formats: ["PDF", "Print"],
      description: "Receipt for one payment",
      to: "/school/fees", place: "Fees",
      keywords: "fee receipt payment",
    },
    {
      id: "billing-receipt", category: "finance", icon: Receipt,
      title: "Subscription receipts", formats: ["Print"],
      description: "Your SALCI subscription payments",
      to: "/school/billing", place: "Billing",
      keywords: "subscription billing invoice salci",
    },

    // ---------------------------------------------------- activity & onboarding
    {
      id: "activity-logs", category: "admin", icon: ClipboardList,
      title: "Activity logs", formats: ["CSV"],
      description: "Who did what, and when",
      to: "/school/activity", place: "Activity logs",
      keywords: "audit log history",
    },
    {
      id: "onboarding-dashboard", category: "admin", icon: Layers,
      title: "Onboarding progress", formats: ["PDF"],
      description: "Progress, funnel and pending steps",
      to: "/school/onboarding-dashboard", place: "Onboarding dashboard",
      keywords: "onboarding progress funnel",
    },

    // ---------------------------------------------------- upload templates
    {
      id: "tpl-students", category: "templates", icon: FileSpreadsheet,
      title: "Student templates", formats: ["CSV"],
      description: "Bulk add or update students",
      to: "/school/users?tab=students", place: "Students", keywords: "template bulk upload csv",
    },
    {
      id: "tpl-teachers", category: "templates", icon: FileSpreadsheet,
      title: "Teacher template", formats: ["CSV"],
      description: "Bulk add teachers",
      to: "/school/users?tab=teachers", place: "Teachers", keywords: "template bulk upload csv",
    },
    {
      id: "tpl-questions", category: "templates", icon: FileSpreadsheet,
      title: "Question templates", formats: ["CSV"],
      description: "One sheet per question type",
      to: "/question-bank", place: "Question bank", keywords: "template questions bank csv",
    },
    {
      id: "tpl-syllabus", category: "templates", icon: FileSpreadsheet,
      title: "Syllabus templates", formats: ["CSV"],
      description: "Chapters, topics and study materials",
      to: "/school/syllabus", place: "Syllabus", keywords: "template chapters topics materials csv",
    },
  ];

  // Both the page's own feature and any extra one a report declares.
  return all.filter((i) =>
    [featureOf(i.to), i.feature].every((f) => !f || a.isFeatureEnabled(f)));
}
