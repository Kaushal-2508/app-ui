import { Step } from "react-joyride";

export interface TourConfig {
  steps: Step[];
  tourId: string;
}

// Student Tour Steps
export const studentTourSteps: Step[] = [
  {
    target: '[data-tour="sidebar"]',
    content: "Welcome to SALCI! 👋 This is your navigation sidebar. Click here to access different sections of the portal.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard"]',
    content: "Your Dashboard shows your overall performance, upcoming exams, and recent activity at a glance.",
    placement: "right",
  },
  {
    target: '[data-tour="exams"]',
    content: "View and attempt your assigned exams here. You'll see upcoming, ongoing, and completed exams.",
    placement: "right",
  },
  {
    target: '[data-tour="results"]',
    content: "Check your exam results, grades, and detailed performance reports. You can also download personalized reports!",
    placement: "right",
  },
  {
    target: '[data-tour="study-materials"]',
    content: "Access study materials uploaded by your teachers - PDFs, videos, and more organized by subject and chapter.",
    placement: "right",
  },
  {
    target: '[data-tour="profile"]',
    content: "Manage your profile settings, update your information, and customize your experience.",
    placement: "bottom",
  },
  {
    target: '[data-tour="notifications"]',
    content: "Stay updated! You'll receive notifications about new exams, results, and important announcements here.",
    placement: "bottom",
  },
];

// Teacher Tour Steps
export const teacherTourSteps: Step[] = [
  {
    target: '[data-tour="sidebar"]',
    content: "Welcome to SALCI! 👋 This sidebar helps you navigate through all teaching tools and features.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard"]',
    content: "Your Dashboard shows pending evaluations, class performance overview, and your upcoming tasks.",
    placement: "right",
  },
  {
    target: '[data-tour="exams"]',
    content: "Create, manage, and publish exams for your classes. You can use AI to generate questions!",
    placement: "right",
  },
  {
    target: '[data-tour="evaluations"]',
    content: "Evaluate student answers here. AI assists with auto-grading, and you can review and override marks.",
    placement: "right",
  },
  {
    target: '[data-tour="tasks"]',
    content: "View and manage tasks assigned to you. Submit evidence and track your task completion.",
    placement: "right",
  },
  // The Reports step was dropped with the teacher Reports tab (2026-08-18);
  // its target [data-tour="reports"] no longer exists in the teacher sidebar.
  {
    target: '[data-tour="notifications"]',
    content: "Important updates about evaluations, student submissions, and administrative notices appear here.",
    placement: "bottom",
  },
];

// School Admin Tour Steps
export const schoolAdminTourSteps: Step[] = [
  {
    target: '[data-tour="sidebar"]',
    content: "Welcome to SALCI Admin Portal! 👋 Here you can manage your entire school's examination system.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard"]',
    content: "Get a bird's eye view of school performance, pending tasks, and AI-generated recommendations.",
    placement: "right",
  },
  {
    target: '[data-tour="classes"]',
    content: "Manage classes, sections, and academic years. Assign students and teachers to classes.",
    placement: "right",
  },
  {
    target: '[data-tour="teachers"]',
    content: "View and manage teachers. Assign them to classes and subjects, and monitor their performance.",
    placement: "right",
  },
  {
    target: '[data-tour="students"]',
    content: "Manage student enrollments, class assignments, and view individual student performance.",
    placement: "right",
  },
  {
    target: '[data-tour="subjects"]',
    content: "Configure subjects offered by your school and map them to appropriate grades.",
    placement: "right",
  },
  {
    target: '[data-tour="syllabus"]',
    content: "Manage curriculum chapters and study materials organized by subject and grade.",
    placement: "right",
  },
  {
    target: '[data-tour="analytics"]',
    content: "Deep dive into school-wide analytics, teacher effectiveness, and identify areas for improvement.",
    placement: "right",
  },
  {
    target: '[data-tour="tasks"]',
    content: "Create and assign tasks to teachers and coordinators. AI suggests tasks based on performance data.",
    placement: "right",
  },
];

// Coordinator Tour Steps
export const coordinatorTourSteps: Step[] = [
  {
    target: '[data-tour="sidebar"]',
    content: "Welcome to SALCI! 👋 As a coordinator, you oversee multiple classes and their performance.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard"]',
    content: "Your Dashboard shows wing-level performance, pending approvals, and AI-suggested actions.",
    placement: "right",
  },
  {
    target: '[data-tour="exams"]',
    content: "Monitor exams across your wing. View status, student performance, and ensure timely evaluations.",
    placement: "right",
  },
  {
    target: '[data-tour="analytics"]',
    content: "Access detailed analytics for your wing - compare classes, identify trends, and spot improvement areas.",
    placement: "right",
  },
  {
    target: '[data-tour="tasks"]',
    content: "Manage tasks for your wing. Create tasks for teachers and track their completion.",
    placement: "right",
  },
  // The Reports step was dropped with the coordinator Reports tab (2026-09-10);
  // its target [data-tour="reports"] no longer exists in any sidebar.
];

// Super Admin Tour Steps
export const superAdminTourSteps: Step[] = [
  {
    target: '[data-tour="sidebar"]',
    content: "Welcome to SALCI Super Admin! 👋 You have access to manage all institutions and system settings.",
    placement: "right",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard"]',
    content: "Platform-wide overview showing all institutions, usage statistics, and system health.",
    placement: "right",
  },
  {
    target: '[data-tour="institutions"]',
    content: "Create and manage schools/institutions. Configure their settings, quotas, and subscriptions.",
    placement: "right",
  },
  {
    target: '[data-tour="users"]',
    content: "Manage all users across institutions. Assign roles, reset passwords, and handle access.",
    placement: "right",
  },
  {
    target: '[data-tour="syllabus"]',
    content: "Manage the universal syllabus database - grades, subjects, and chapters that all schools can use.",
    placement: "right",
  },
  {
    target: '[data-tour="question-bank"]',
    content: "Access the global question bank. Add, edit, and organize questions by subject and chapter.",
    placement: "right",
  },
  {
    target: '[data-tour="ai-quota"]',
    content: "Monitor AI usage across the platform. Set quotas and view consumption analytics.",
    placement: "right",
  },
  {
    target: '[data-tour="payments"]',
    content: "Track subscriptions, payments, and billing for all institutions.",
    placement: "right",
  },
];

export function getTourByRole(role: string): TourConfig {
  switch (role) {
    case "student":
      return { steps: studentTourSteps, tourId: "student-onboarding" };
    case "teacher":
      return { steps: teacherTourSteps, tourId: "teacher-onboarding" };
    case "school_admin":
      return { steps: schoolAdminTourSteps, tourId: "school-admin-onboarding" };
    case "coordinator":
      return { steps: coordinatorTourSteps, tourId: "coordinator-onboarding" };
    case "super_admin":
      return { steps: superAdminTourSteps, tourId: "super-admin-onboarding" };
    default:
      return { steps: studentTourSteps, tourId: "default-onboarding" };
  }
}
