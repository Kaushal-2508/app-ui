import {
  BookOpen, FileText, Users, BarChart3, ClipboardCheck, ClipboardList, Video,
  MessageSquare, Shield, Layers, GraduationCap, FileCheck, Coins,
  Brain, Calendar, DollarSign, Briefcase, Bell, CalendarDays,
  UserCheck, Fingerprint, Sparkles, Database, Medal, NotebookPen, Target,
} from "lucide-react";

export interface FeatureConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: "core" | "academic" | "operations" | "advanced";
  isDefault: boolean;
}

export const AVAILABLE_FEATURES: FeatureConfig[] = [
  // Core Features (always enabled)
  { id: "dashboard", name: "Dashboard", description: "Role-based dashboards with analytics and insights", icon: BarChart3, category: "core", isDefault: true },
  { id: "user_management", name: "User Management", description: "Manage teachers, students, and coordinators", icon: Users, category: "core", isDefault: true },
  { id: "classes", name: "Classes & Sections", description: "Organize students into classes and sections", icon: Layers, category: "core", isDefault: true },

  // Academic Features
  { id: "exams", name: "Exam Management", description: "Create, publish, and manage online/offline exams", icon: FileText, category: "academic", isDefault: true },
  { id: "homework", name: "Homework and Assignment", description: "Create, distribute, and grade homework and assignments", icon: ClipboardList, category: "academic", isDefault: true },
  { id: "syllabus", name: "Syllabus & Study Materials", description: "Manage subjects, topics, and study resources", icon: BookOpen, category: "academic", isDefault: true },
  { id: "syllabus_segmentation", name: "Syllabus Segmentation", description: "Split a subject's syllabus into named parts such as PA1, Term 1, or Term 2", icon: Layers, category: "academic", isDefault: false },
  { id: "evaluations", name: "Evaluations & Grading", description: "AI-assisted grading and manual evaluations", icon: ClipboardCheck, category: "academic", isDefault: true },
  { id: "reports", name: "Reports & Analytics", description: "Performance reports and insights for all stakeholders", icon: BarChart3, category: "academic", isDefault: true },
  { id: "question_bank", name: "Question Bank", description: "Centralized repository of exam questions by subject and topic", icon: Database, category: "academic", isDefault: false },
  { id: "student_passport", name: "Student Passport / Learning Profile", description: "Comprehensive student learning journey and performance profile", icon: GraduationCap, category: "academic", isDefault: false },
  { id: "timetable", name: "Timetable & Lesson Planning", description: "Manage class timetables and lesson plans", icon: Calendar, category: "academic", isDefault: false },

  // Operations Features
  { id: "tasks", name: "Task Management", description: "Assign and track tasks with evidence submission", icon: FileCheck, category: "operations", isDefault: false },
  { id: "wings", name: "Wings & Coordinators", description: "Organize classes into wings with coordinator oversight", icon: Shield, category: "operations", isDefault: false },
  { id: "proctoring", name: "Live Proctoring", description: "Monitor online exams with face detection and alerts", icon: Video, category: "operations", isDefault: false },
  { id: "recheck_management", name: "Recheck Requests", description: "Allow students to request answer rechecks", icon: MessageSquare, category: "operations", isDefault: false },
  { id: "attendance", name: "Attendance Management", description: "Track student attendance via QR, PIN, face recognition, or biometric", icon: UserCheck, category: "operations", isDefault: false },
  { id: "fee_management", name: "Fee & Finance Management", description: "Fee structures, installments, concessions, and receipts", icon: DollarSign, category: "operations", isDefault: false },
  { id: "hr_payroll", name: "HR & Payroll", description: "Staff directory, salary structures, payroll runs, and leave management", icon: Briefcase, category: "operations", isDefault: false },
  { id: "communication", name: "Communication & Messaging", description: "In-app messaging between teachers, students, and parents", icon: MessageSquare, category: "operations", isDefault: false },
  { id: "notice_board", name: "Notice Board", description: "Issue notices down the hierarchy and track who has read them", icon: Bell, category: "operations", isDefault: false },
  { id: "school_diary", name: "School Diary", description: "Teachers write homework, reminders, remarks and appreciation for a class or a student; families read it the same day", icon: NotebookPen, category: "operations", isDefault: false },
  { id: "ptm_scheduling", name: "PTM Scheduling", description: "Schedule and manage parent-teacher meetings", icon: CalendarDays, category: "operations", isDefault: false },
  { id: "holiday_calendar", name: "Holiday Calendar", description: "Manage academic calendar and holidays", icon: Calendar, category: "operations", isDefault: false },
  { id: "teacher_targets", name: "Teacher Targets", description: "Set exam and homework targets for teachers, by wing or individually, and track them period by period", icon: Target, category: "operations", isDefault: false },
  { id: "admissions", name: "Admissions", description: "Enquiries, the registration fee, admission with the certificate checklist and the admission number, and a public enquiry form for parents", icon: UserCheck, category: "operations", isDefault: false },

  // Advanced Features
  { id: "ai_question_generation", name: "AI Question Generation", description: "Generate exam questions using AI", icon: Brain, category: "advanced", isDefault: false },
  { id: "ocr_scanning", name: "OCR Answer Scanning", description: "Scan and digitize offline answer sheets", icon: GraduationCap, category: "advanced", isDefault: false },
  { id: "billing", name: "Billing & Payments", description: "Subscription and payment management", icon: Coins, category: "advanced", isDefault: false },
  { id: "ai_predictions", name: "AI Performance Predictions", description: "Predict student performance trends using AI analytics", icon: Sparkles, category: "advanced", isDefault: false },
  { id: "ai_grading", name: "AI Grading Assistance", description: "AI-powered automated grading for subjective answers", icon: Brain, category: "advanced", isDefault: false },
  { id: "biometric_attendance", name: "Biometric Attendance", description: "Fingerprint-based attendance tracking integration", icon: Fingerprint, category: "advanced", isDefault: false },
  { id: "olympiad", name: "SALCI Olympiad", description: "Run the SALCI Olympiad campaign for this school", icon: Medal, category: "advanced", isDefault: false },
];

// Maps URL paths to feature IDs for gating. URLs not in this map are always shown (core features).
// IMPORTANT: when a feature has both an admin and a student/teacher counterpart
// (e.g. "/school/fees" + "/student/fees"), BOTH urls must be mapped. The
// sidebar's filterItemsByFeature treats an unmapped url as "always show" —
// missing the role-specific entry leaks the tab back into the sidebar even
// when the institution has the feature switched off.
export const FEATURE_URL_MAP: Record<string, string> = {
  "/school/admissions": "admissions",
  "/school/fees": "fee_management",
  "/student/fees": "fee_management",
  "/school/hr": "hr_payroll",
  "/school/attendance": "attendance",
  "/student/attendance": "attendance",
  // Leave requests are part of the attendance module — when a school runs
  // without attendance there is nothing to apply against.
  "/student/leave": "attendance",
  "/school/communication": "communication",
  "/school/notices": "notice_board",
  "/school/billing": "billing",
  "/school/exams": "exams",
  "/exams/create": "exams",
  "/school/rechecks": "recheck_management",
  "/school/syllabus": "syllabus",
  "/question-bank": "question_bank",
  "/school/analytics": "reports",
  "/school/wings": "wings",
  "/tasks": "tasks",
  "/staff/my-salary": "hr_payroll",
  // Staff leave follows the student rule above: it is part of attendance,
  // not payroll, so a school without HR still lets its teachers apply
  // (2026-09-26). Balances stay an HR extra the page shows only when set.
  "/staff/workday": "attendance",
  // Old address of Workday, now a redirect; gated the same way.
  "/staff/my-leaves": "attendance",
  "/timetable": "timetable",
  "/school/timetable": "timetable",
  "/school/period-structures": "timetable",
  "/school/shared-resources": "timetable",
  "/teacher/my-week": "timetable",
  "/student/my-week": "timetable",
  "/appointments": "ptm_scheduling",
  "/school/calendar": "holiday_calendar",
  "/school/olympiad": "olympiad",
  "/school/olympiad/teachers": "olympiad",
  "/school/olympiad/marketing": "olympiad",
  "/school/olympiad/resource-planning": "olympiad",
  "/school/olympiad/labs": "olympiad",
  "/school/olympiad/revenue": "olympiad",
  "/school/olympiad/exam-paper": "olympiad",
  "/school/olympiad/exam-planning": "olympiad",
  "/school/olympiad/study-material": "olympiad",
  "/school/olympiad/batches": "olympiad",
  "/school/olympiad/pin-custody": "olympiad",
  "/school/olympiad/absentees": "olympiad",
  "/school/olympiad/publish-status": "olympiad",
  "/teacher/olympiad": "olympiad",
  "/student/olympiad": "olympiad",
  "/student/olympiad/pin-entry": "olympiad",
  "/student/olympiad/exam": "olympiad",
  "/student/olympiad/exam/submitted": "olympiad",
  "/student/olympiad/review": "olympiad",
  "/homework": "homework",
  "/homework/create": "homework",
  "/student/homework": "homework",
  "/school/teacher-targets": "teacher_targets",
  "/teacher/my-targets": "teacher_targets",
};

export const CATEGORY_LABELS = {
  core: { label: "Core Features", description: "Essential features enabled by default" },
  academic: { label: "Academic", description: "Teaching and learning modules" },
  operations: { label: "Operations", description: "Administrative and management tools" },
  advanced: { label: "Advanced", description: "Premium and AI-powered features" },
};
