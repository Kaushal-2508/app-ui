import { forwardRef } from "react";

const SystemMapsDocument = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="bg-white text-black p-8 max-w-4xl mx-auto font-sans">
      {/* Header */}
      <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">SALCI Platform</h1>
        <p className="text-xl text-gray-600">System Maps &amp; Navigation Reference</p>
        <p className="text-sm text-gray-500 mt-2">Version 3.0 | September 8, 2026</p>
        <p className="text-xs text-gray-500 mt-1">Scope: the SALCI school platform. The Olympiad subsystem also lives in this repository but is documented separately and is excluded throughout.</p>
      </div>

      {/* 1. Route Map */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">1. Route Map</h2>
        <p className="text-sm text-gray-600 mb-4">120 school-platform routes are declared in <code>src/App.tsx</code>. Every page route is lazy-loaded. Routes are gated by <code>ProtectedRoute</code> plus <code>FEATURE_URL_MAP</code>, so a path that maps to a disabled module is unreachable even by typing the URL.</p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.1 Public / Unauthenticated</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Path</th><th className="border border-gray-300 p-2 text-left">Page</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">/</td><td className="border border-gray-300 p-2">Login (the marketing site is a separate property)</td></tr>
            <tr><td className="border border-gray-300 p-2">/login</td><td className="border border-gray-300 p-2">Login</td></tr>
            <tr><td className="border border-gray-300 p-2">/forgot-password</td><td className="border border-gray-300 p-2">Forgot Password</td></tr>
            <tr><td className="border border-gray-300 p-2">/reset-password</td><td className="border border-gray-300 p-2">Reset Password</td></tr>
            <tr><td className="border border-gray-300 p-2">/password-reset-required</td><td className="border border-gray-300 p-2">Forced Password Change</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/hybrid-upload/:token</td><td className="border border-gray-300 p-2">Hybrid phone companion. Deliberately unauthenticated: the pairing token IS the authorisation</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.2 Authenticated, All Roles</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Path</th><th className="border border-gray-300 p-2 text-left">Page</th><th className="border border-gray-300 p-2 text-left">Notes</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">/dashboard</td><td className="border border-gray-300 p-2">Role-based Dashboard</td><td className="border border-gray-300 p-2">Admins land on "Home" with the Dashboard tile leading the grid</td></tr>
            <tr><td className="border border-gray-300 p-2">/profile</td><td className="border border-gray-300 p-2">Profile</td><td className="border border-gray-300 p-2">Read-only for students; own-photo affordance for everyone else</td></tr>
            <tr><td className="border border-gray-300 p-2">/settings</td><td className="border border-gray-300 p-2">Settings</td><td className="border border-gray-300 p-2">Super-admin sees the seven living-doc tabs here</td></tr>
            <tr><td className="border border-gray-300 p-2">/support</td><td className="border border-gray-300 p-2">Salci Support</td><td className="border border-gray-300 p-2">One reporter door for every authenticated role; hidden from SALCI's own admins, who use /admin/issues</td></tr>
            <tr><td className="border border-gray-300 p-2">/achievements</td><td className="border border-gray-300 p-2">Achievements (Player Card)</td><td className="border border-gray-300 p-2">Badge ladders with grouped "how you earned this" explanations</td></tr>
            <tr><td className="border border-gray-300 p-2">/leaderboard</td><td className="border border-gray-300 p-2">Badge Leaderboard</td><td className="border border-gray-300 p-2">Server-side ranking with a "where am I" marker</td></tr>
            <tr><td className="border border-gray-300 p-2">/tasks</td><td className="border border-gray-300 p-2">Task Management</td><td className="border border-gray-300 p-2">Feature-gated on <code>tasks</code></td></tr>
            <tr><td className="border border-gray-300 p-2">/appointments</td><td className="border border-gray-300 p-2">Appointments / PTM</td><td className="border border-gray-300 p-2">Feature-gated on <code>ptm_scheduling</code></td></tr>
            <tr><td className="border border-gray-300 p-2">/prd</td><td className="border border-gray-300 p-2">Standalone PRD Viewer</td><td className="border border-gray-300 p-2">Super admin</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.3 School Admin</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Path</th><th className="border border-gray-300 p-2 text-left">Page</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">/school/command-center</td><td className="border border-gray-300 p-2">Command Center (admin dashboard)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/snapshot</td><td className="border border-gray-300 p-2">Scoped Snapshot (coordinator and teacher)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/onboarding-dashboard</td><td className="border border-gray-300 p-2">Onboarding Journey</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/users</td><td className="border border-gray-300 p-2">User Management (Manage Users)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/manage-teachers</td><td className="border border-gray-300 p-2">Manage Teaching Staff</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/manage-students</td><td className="border border-gray-300 p-2">Manage Students</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/workforce</td><td className="border border-gray-300 p-2">Workforce Directory</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/classes</td><td className="border border-gray-300 p-2">Class &amp; Section Management</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/subjects</td><td className="border border-gray-300 p-2">Subject Management</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/syllabus</td><td className="border border-gray-300 p-2">Syllabus Management (chapters, topics, Parts, Optional Groups)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/wings</td><td className="border border-gray-300 p-2">Wing Management</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/teacher-targets</td><td className="border border-gray-300 p-2">Teacher Targets (admin and coordinator; feature-gated, off by default)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/exams</td><td className="border border-gray-300 p-2">School Exams</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/rechecks</td><td className="border border-gray-300 p-2">Recheck Requests</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/attendance</td><td className="border border-gray-300 p-2">Attendance (student roster, Staff Attendance, Reports)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/attendance/user/:userId</td><td className="border border-gray-300 p-2">Per-user Attendance Detail</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/notices</td><td className="border border-gray-300 p-2">Notice Board (replaced /school/circulars)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/communication</td><td className="border border-gray-300 p-2">Communication (Messages tab; the Templates tab was removed 2026-09-07)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/fees</td><td className="border border-gray-300 p-2">Fee Management</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/hr</td><td className="border border-gray-300 p-2">HR &amp; Payroll</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/billing</td><td className="border border-gray-300 p-2">Subscription &amp; Billing</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/analytics</td><td className="border border-gray-300 p-2">School Analytics (server-side RPC)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/activity</td><td className="border border-gray-300 p-2">Activity Logs</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/timetable</td><td className="border border-gray-300 p-2">Timetable Hub</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/timetable/:classId</td><td className="border border-gray-300 p-2">Class Timetable Workspace</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/calendar</td><td className="border border-gray-300 p-2">Academic Calendar</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/shared-resources</td><td className="border border-gray-300 p-2">Shared Resources (rooms, labs)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/optional-batches</td><td className="border border-gray-300 p-2">Optional Batches (legacy plane, off the sidebar)</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/class/:classId</td><td className="border border-gray-300 p-2">Class Detail</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/teacher/:teacherId</td><td className="border border-gray-300 p-2">Teacher Detail</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/subject/:subjectId</td><td className="border border-gray-300 p-2">Subject Detail</td></tr>
            <tr><td className="border border-gray-300 p-2">/school/student/:studentId</td><td className="border border-gray-300 p-2">Student Detail. Authorised staff see the student's real dashboard and report, gated per RPC</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mb-4">Legacy paths kept as redirects: /school/teachers, /school/students, /school/coordinators, /school/admins, /school/evaluations, /school/period-structures, /school/timetable-v2.</p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.4 Exams, Evaluation &amp; Homework</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Path</th><th className="border border-gray-300 p-2 text-left">Page</th><th className="border border-gray-300 p-2 text-left">Roles</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">/exams</td><td className="border border-gray-300 p-2">My Exams (status and mode filters, Create Duplicate)</td><td className="border border-gray-300 p-2">Admin, Teacher, Coordinator</td></tr>
            <tr><td className="border border-gray-300 p-2">/exams/create</td><td className="border border-gray-300 p-2">Exam Creation Flow (Details, Questions, Review)</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/exams/edit/:id</td><td className="border border-gray-300 p-2">Edit Exam</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/exams/:examId/results</td><td className="border border-gray-300 p-2">Exam Results</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/exams/:examId/evaluate/:attemptId</td><td className="border border-gray-300 p-2">Evaluate Attempt</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/exams/:examId/offline-marks</td><td className="border border-gray-300 p-2">Offline Marks Entry (explicit Absent state)</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/evaluations/hybrid</td><td className="border border-gray-300 p-2">Hybrid Evaluation Queue</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/evaluations/hybrid/:attemptId</td><td className="border border-gray-300 p-2">Hybrid Marking Workspace (one question at a time, works on a phone)</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/ocr-review</td><td className="border border-gray-300 p-2">OCR Review</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/scan-sheets</td><td className="border border-gray-300 p-2">Answer Sheet Scanning</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/proctoring/live</td><td className="border border-gray-300 p-2">Live Proctoring</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/question-bank</td><td className="border border-gray-300 p-2">Question Bank</td><td className="border border-gray-300 p-2">Admin, Teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">/homework, /homework/create, /homework/edit/:id, /homework/:id</td><td className="border border-gray-300 p-2">Homework list, create, edit, detail and marking</td><td className="border border-gray-300 p-2">Admin, Teacher, Coordinator</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.5 Teacher &amp; Coordinator</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Path</th><th className="border border-gray-300 p-2 text-left">Page</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">/teacher/my-week</td><td className="border border-gray-300 p-2">Teacher Week View (lesson logging, note-only periods, projected and actual chapter lines)</td></tr>
            <tr><td className="border border-gray-300 p-2">/teacher/students</td><td className="border border-gray-300 p-2">My Students, narrowed by <code>teacher_controls_student()</code></td></tr>
            <tr><td className="border border-gray-300 p-2">/coordinator/classes</td><td className="border border-gray-300 p-2">Wing Classes</td></tr>
            <tr><td className="border border-gray-300 p-2">/coordinator/students</td><td className="border border-gray-300 p-2">Wing Students</td></tr>
            <tr><td className="border border-gray-300 p-2">/coordinator/teachers</td><td className="border border-gray-300 p-2">Wing Teachers</td></tr>
            <tr><td className="border border-gray-300 p-2">/coordinator/exams</td><td className="border border-gray-300 p-2">Wing Exams</td></tr>
            <tr><td className="border border-gray-300 p-2">/coordinator/tasks</td><td className="border border-gray-300 p-2">Wing Tasks</td></tr>
            <tr><td className="border border-gray-300 p-2">/coordinator/analytics, /coordinator/rechecks</td><td className="border border-gray-300 p-2">Wing-scoped analytics and rechecks</td></tr>
            <tr><td className="border border-gray-300 p-2">/staff/workday</td><td className="border border-gray-300 p-2">Workday (own check-in, attendance history and leave requests)</td></tr>
            <tr><td className="border border-gray-300 p-2">/staff/my-salary</td><td className="border border-gray-300 p-2">My Salary</td></tr>
            <tr><td className="border border-gray-300 p-2">/teacher/my-targets</td><td className="border border-gray-300 p-2">My Targets (teacher and coordinator; open period progress plus closed history)</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.6 Student</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Path</th><th className="border border-gray-300 p-2 text-left">Page</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">/student/exams</td><td className="border border-gray-300 p-2">Available Exams (optional-subject aware)</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/exams/:examId/attempt</td><td className="border border-gray-300 p-2">Exam Attempt (server-authoritative timer, 4-strike integrity ladder)</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/hybrid-exam/:attemptId</td><td className="border border-gray-300 p-2">Hybrid Attempt</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/hybrid-result/:attemptId</td><td className="border border-gray-300 p-2">Hybrid Result</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/results</td><td className="border border-gray-300 p-2">My Results (filters, class comparison, subject trajectory, chapter analysis)</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/results/:resultId</td><td className="border border-gray-300 p-2">Exam Detail (teacher remarks, section breakdown, PDF)</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/reports</td><td className="border border-gray-300 p-2">Downloadable Report</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/passport</td><td className="border border-gray-300 p-2">Learning Passport</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/homework, /student/homework/:id</td><td className="border border-gray-300 p-2">Homework feed and detail</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/my-week</td><td className="border border-gray-300 p-2">My Week (real timetable grid, days as rows, subject accents)</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/attendance</td><td className="border border-gray-300 p-2">Attendance Calendar</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/leave</td><td className="border border-gray-300 p-2">Apply Leave and Track Leaves (gated on the <code>attendance</code> feature)</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/study-materials</td><td className="border border-gray-300 p-2">Study Materials</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/rechecks</td><td className="border border-gray-300 p-2">Recheck Requests</td></tr>
            <tr><td className="border border-gray-300 p-2">/student/fees</td><td className="border border-gray-300 p-2">My Fees</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.7 Super Admin</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Path</th><th className="border border-gray-300 p-2 text-left">Page</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">/admin/institutions</td><td className="border border-gray-300 p-2">Institution Management (creation wizard, feature toggles)</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/users</td><td className="border border-gray-300 p-2">Global User Management</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/teachers, /admin/students</td><td className="border border-gray-300 p-2">Cross-institution teacher and student directories</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/access</td><td className="border border-gray-300 p-2">Access &amp; Overrides</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/employee-levels</td><td className="border border-gray-300 p-2">Employee Levels</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/issues</td><td className="border border-gray-300 p-2">Salci Support Inbox (awaiting-SALCI filter, unread dots, ticket deep links)</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/syllabus, /admin/question-bank, /admin/exams</td><td className="border border-gray-300 p-2">Platform-level syllabus, question bank and exam tooling</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/analytics, /admin/activity</td><td className="border border-gray-300 p-2">Platform analytics and activity</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/ai-quotas</td><td className="border border-gray-300 p-2">AI Quota Management</td></tr>
            <tr><td className="border border-gray-300 p-2">/admin/payments</td><td className="border border-gray-300 p-2">Payments</td></tr>
            <tr><td className="border border-gray-300 p-2">/analytics, /performance</td><td className="border border-gray-300 p-2">Cross-role analytics and performance surfaces</td></tr>
          </tbody>
        </table>
      </section>

      {/* 2. Component Hierarchy */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">2. Component Hierarchy</h2>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`main.tsx  (service-worker registration: PROD registers, DEV self-heals by unregistering)
└── App.tsx
    ├── AuthProvider                 one provider, hoisted 2026-09-04 so navigation
    │                                stops flashing the route skeleton
    ├── QueryClientProvider (TanStack Query v5)
    ├── ActiveRoleContext            ViewRole = "admin" | "teacher" | "coordinator"
    │                                declared ONCE here; viewRoles[0] is the default
    ├── BrowserRouter
    │   ├── Public routes (Login, password flows, hybrid phone companion)
    │   └── ProtectedRoute           auth check + FEATURE_URL_MAP gate
    │       └── PageShell            every page wraps in this, never AppLayout directly
    │           ├── AppSidebar       collapsible groups, role-filtered, feature-filtered
    │           ├── App bar          UserAvatar, active-role chip, notifications
    │           └── Page content (all lazy-loaded)
    │               ├── RoleBasedDashboard → NavigationHub tiles (auto-gated)
    │               ├── CommandCenterV5Page / ScopedSnapshotPage (DashboardScope)
    │               ├── ExamsPage → CreateExam → EditExam
    │               └── SettingsPage → 7 living-doc tabs
    └── Toaster + Sonner

Shared primitives live in src/components/shared/: page, surface, nav, sheet.
Cards are surface-card frosted-shadow rounded-card; tabs are MobileTabs; modals
are MobileSheet rather than Dialog; stat tiles are StatTile; empty states are
EmptyState. DialogContent is a project fork that auto-wraps children in a
ScrollArea.

DEAD CODE, never use as a reference: TeacherDashboard.tsx, SchoolAdminDashboard.tsx.`}</pre>
      </section>

      {/* 3. Database Schema Map */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">3. Database Schema Map</h2>
        <p className="text-sm text-gray-600 mb-4">183 school-platform tables, 3 views and 260 database functions across 458 migrations.</p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.1 Identity &amp; Access</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`auth.users (Supabase managed)
    │
    ├──→ profiles (1:1, pre-created by the handle_new_user trigger; after
    │    │         auth.admin.createUser always UPSERT ON id, never bare INSERT)
    │    ├── full_name, email, phone
    │    ├── avatar_path        private user-avatars bucket; a trigger enforces that
    │    │                      the path belongs to the row it is written on
    │    ├── institution_id (FK → institutions)
    │    └── admission_number, parent_email, parent_phone
    │
    ├──→ user_roles (1:many)
    │    ├── role  super_admin | super_school_admin | school_admin | coordinator
    │    │         | teacher | student | employee
    │    ├── institution_id
    │    └── employee_level_id (FK → employee_levels, nullable)
    │
    ├──→ user_preferences (1:1)   theme, email/push/sound notification prefs
    │
    └──→ per-user capability overrides (a grant WITHOUT a role change)
         ├── tt_manager_overrides       → tt_is_timetable_manager()
         ├── staff_manager_overrides    → is_staff_manager()
         ├── syllabus_manager_overrides → is_syllabus_manager()
         └── student_manager_overrides  → is_student_manager()

Authority helpers used by RLS (SECURITY DEFINER, never inline EXISTS):
    has_role(), is_coordinator_for_class(), teacher_controls_student(),
    can_edit_student_details(), can_set_user_photo(), can_view_user_photo(),
    institution_student_ids(), optional_choices_recorded()`}</pre>

        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Teacher authority is SUBJECT-scoped</p>
          <p><code>teacher_controls_student(teacher, student)</code> is the predicate for every teacher read and write except attendance. Sharing a class is not authority, and a <code>class_assignments</code> row with no <code>subject_id</code> grants nothing. Dual-role users (teacher + coordinator, or admin + teacher) keep their scopes strictly separate: the lists are never unioned.</p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.2 Academic Structure (Class Groups)</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`grade_levels   GLOBAL, no institution_id. Resolve by name regex, never filter by
               institution. Pre-primary grade_number values are NEGATIVE
               (Pre Nursery -4 … UKG -1/0), and a stream's grade_number is a
               sequence number, not a grade.

institutions
    ├── class_groups ("Class 10", "Class 12 Science")
    │       ├── classes (sections 10A/10B/10C; class_group_id NOT NULL)
    │       │       └── class_assignments (→ profiles, with role + subject_id)
    │       │               └── class_assignment_deletions (audit; NO FKs, so it
    │       │                   survives cascades)
    │       ├── subject_class_group_mappings   ← catalog writes go HERE
    │       │       └── TRIGGER fanout → subject_class_mappings (legacy per-section)
    │       ├── chapter_topics        (class_id column DROPPED)
    │       └── topic_class_mappings  (class_id column DROPPED)
    ├── wings → wing_assignments, wing_class_mappings
    ├── subjects → FK universal_subjects
    ├── syllabus_topics (shared at class-group level)
    │       └── concept_mastery, concept_mastery_history
    ├── question_bank (class_group_id)
    │       └── question_bank_section_scope (zero rows = class-wide)
    └── institution_features (feature gating)`}</pre>

        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Dual-table invariant</p>
          <p>Never write <code>subject_class_mappings</code> directly. Catalog writes go to <code>subject_class_group_mappings</code> and a SECURITY DEFINER trigger fans them out. Writing the legacy table directly desyncs the catalog and blacks out a teacher's whole portal.</p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.3 Exam Pipeline</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`exams
    ├── exam_mode: online | offline | hybrid    (delivery format)
    ├── exam_type: term | unit | weekly | unspecified   (scheduling class)
    ├── is_results_only + source_paper_files    (already-created paper upload)
    ├── late_entry_minutes                      (entry window after start)
    ├── exam_sections
    │       └── exam_questions
    │               ├── question_type: mcq | short | long | true_false |
    │               │                  fill_blank | matching | assertion_reason
    │               ├── options (JSONB, TWO shapes: legacy {a,b,c,d} map, or
    │               │            array [{id,text,isCorrect}]; auto-grade branches
    │               │            on Array.isArray)
    │               ├── diagram/image per question AND per option
    │               └── parent_question_id (self-ref for sub-questions)
    ├── exam_classes / exam_subjects / exam_topics
    ├── evaluation_blueprints  (is_blueprint_ready gates publish via the
    │                           prevent_invalid_exam_publish trigger)
    └── exam_templates

student_exam_attempts
    ├── student_answers → ai_evaluations
    ├── exam_attempt_logs, attempt_question_telemetry, attempt_section_telemetry
    ├── proctoring_sessions → proctoring_events, proctoring_review_logs
    └── exam_insights (AI, 1:1)

final_results
    └── percentage is NUMERIC(5,2) GENERATED ALWAYS AS ... STORED.
        NEVER include it in an INSERT/UPSERT: the row is silently NOT written.
        Never swallow a final_results write error; always throw.`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.4 Hybrid &amp; Offline Marks</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`hybrid_*  SEPARATE data plane from student_exam_attempts / final_results.
          The phone companion is unauthenticated: the pairing token IS the auth.
    ├── hybrid_exam_attempts → hybrid_exam_attempt_logs
    ├── hybrid_exam_settings          (camera-proctoring toggle)
    ├── hybrid_pairing_tokens
    ├── hybrid_answer_sheet_pages → hybrid_sheet_annotations
    ├── hybrid_question_marks
    └── hybrid_proctoring_snapshots

Offline marks: TWO pipelines, distinct query keys, they never cross:
    ├── offline_student_marks     (per-student totals)
    └── offline_section_marks     (per-section marks)
    Explicit Absent state; rows stay editable after results publish.
    Buckets: exam-sheets, answer-sheets, hybrid-answer-sheets`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.5 Timetable, Calendar &amp; Syllabus Progress</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`institutions
    ├── cal_academic_years (start/end, current AY)
    ├── cal_events (holidays, overrides, exceptions per date)
    ├── tt_period_structures (named per AY, editable after creation)
    │       └── tt_period_slots (ordered periods and breaks; "other" slot type
    │                            carries a custom_label)
    ├── tt_class_structure (which structure applies to which class)
    ├── tt_resources (rooms, labs)
    ├── tt_slots (subject + teacher + class + day → period slot)
    ├── tt_substitutions (date-based substitution and cancellation overrides)
    └── tt_lesson_plans (per-slot per-date record)
            └── is_note_only  a chapterless period (surprise test, activity)
                              written by tt_record_period_note

Two-timeline syllabus:
    ├── syllabus_progress_events   the ACTUAL jar; one write path,
    │                              record_syllabus_progress
    ├── syllabus_sequence          the ordering the projection walks
    ├── syllabus_segments → syllabus_segment_chapters   named Parts (PA1, Term 1)
    └── user_topic_orders          per-user personal chapter ordering

NOTE: the seven legacy timetable tables (day_templates, day_template_slots,
timetable_versions, timetable_slots, lesson_plan_entries, topic_pacing_targets,
academic_calendar) were DROPPED. Do not reference them.`}</pre>

        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">The "was this day logged?" predicate is duplicated</p>
          <p>The OR-predicate that decides whether a teaching day counts as logged appears in both <code>teacher_pending_syllabus_days</code> and <code>dash_evaluate_syllabus_flags</code>, and the two MUST stay identical. Students read only <code>session_type=&apos;teaching&apos;</code>.</p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.6 Attendance &amp; Leave</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`attendance_settings (per institution; wall-clock columns compared in
                     institution-local time, never UTC)
attendance_sessions → attendance_records      (student plane)
attendance_pins, biometric_enrollments, face_enrollments
staff_attendance_records                      (staff plane, separate vocabulary)

leave_requests
    └── review_student_leave()   the ONLY decision write path. Retroactively
        corrects attendance and notifies. Teachers can also mark leave directly.
        "late" was removed from the student plane entirely; "leave" counts in
        the TOTAL but never as present, and never leads a tile headline.

staff_leave_requests, staff_leave_balances    (HR plane)

Entry point: tt_run_attendance_pass_for_institution(uuid)
             15-minute cron + a sessionStorage-guarded page-view kick.
             Auto-mark is decoupled from staff_substitution_enabled.`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.7 Optional Subjects</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`optional_groups                 elective baskets scoped to a class group
    ├── optional_group_subjects  the subjects inside a basket
    └── student_optional_enrollments   THE enrollment store (soe.class_id is
                                       always NULL, do not read it)

optional_band_slots             timetable bands for optional periods
optional_batches / optional_batch_students   superseded plane, off the sidebar

GATE: every narrowing filter sits behind optional_choices_recorded(), so
optional logic stays DORMANT until a section actually records choices. An
ungated filter blacked out a live school on 2026-08-25.
The main/optional classification was RETIRED 2026-08-06: every choice is MAIN.`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.8 Homework</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`homework_assignments (subject_id → ON DELETE RESTRICT)
    ├── homework_assignment_classes (many:many → classes)
    ├── homework_assignment_subjects (many:many → subjects)
    ├── homework_submissions
    │       └── homework_submission_files  (storage owner-only; markers read
    │                                       through the homework-file-url fn)
    ├── homework_results
    ├── homework_mark_audit
    └── homework_notifications_sent
Marking-roster RPC needs ::text casts or it raises 42804.
Bucket: homework-files. Feature flag: homework (default ON).`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.9 Notices, Messaging &amp; Support</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`notices                          (renamed from circulars; legacy values normalised)
    ├── notice_target_classes     ┐ multi-target junctions
    ├── notice_target_wings       ┘
    └── notice_recipients          MATERIALISED audience + read receipts
    publish_notice() expands the audience; communication_overview backs the
    composer. RLS enforces scope, which closed the class-notice leak where a
    teacher's class notice reached co-teachers.
    Bucket: notice-attachments (private)

conversations → conversation_participants → conversation_messages
    Bulk Send is a Messages tab riding the same audience engine, and sends real
    DIRECT messages rather than one group thread.
    Bucket: message-attachments

reported_issues                  Salci Support tickets
    └── support_messages          the thread, incl. a guarded internal-note channel
support_settings
    Single write paths: post_support_message(), _support_apply_status().
    Every support RPC has EXECUTE revoked from PUBLIC and anon BY NAME.
    Tickets become real tasks; the task panel deep-links into the thread.
    Edge fn: support-notify-email (origin allowlist, authorises the RECIPIENT)`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.10 Tasks, Dashboards &amp; Misc</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`tasks
    ├── task_assignments   task_id is NOT NULL UNIQUE and feeds get_task_assignee()
    │                      into 6 RLS policies + enforce_task_status_transition.
    │                      Multi-assignee is a FAN-OUT: one instruction for N
    │                      people = N tasks rows sharing tasks.task_group_id,
    │                      written by create_task_group() in ONE transaction.
    │                      A single assignee leaves task_group_id NULL.
    ├── task_supervisors (more than one supervisor allowed)
    ├── task_comments, task_evidence, task_links, task_audit_logs
    └── ai_suggested_tasks

dashboard_flags       written by the 20-flag evaluator; freshness comes from the
                      admin on-open kick, there is NO cron
badge_definitions → badge_progress → user_badges
student_activity_daily, user_activity_log, system_audit_logs
student_personal_details   school-managed: students read-only, no DELETE policy

Views (3), all security_invoker=on so they gate on the CALLER:
    student_eligible_exams, v_class_groups_with_sections,
    v_subject_class_mappings_unified`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.11 Teacher Targets</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`teacher_targets           definitions: scope='wing' (a pool owned by one
                          coordinator) or scope='teacher' (a per-teacher
                          target, linked to its pool via parent_target_id)
teacher_target_periods    the FROZEN ledger, scope='teacher' only. A wing's
                          number is a SUM over its children, never a second
                          stored copy. Both source counts (exams published,
                          homework published) hard-delete with no tombstone,
                          so freezing target/achieved at period close is the
                          only way "check it after the deadline" stays true.

RPCs: tgt_create_wing_target, tgt_split_wing_target (admin only creates;
the owning coordinator splits — an allocation gap is ALLOWED, never
blocked), tgt_create_teacher_targets, tgt_stop_target (never deletes),
tgt_targets_overview / tgt_my_targets (reads), tgt_evaluate_targets
(nightly pg_cron: closes periods, notifies). Metric is
'exams_published' | 'homework_published'; cadence is day/week/month or
NULL for a one-off range.

Feature flag teacher_targets, off by default. Routes /school/teacher-targets
(admin, coordinator) and /teacher/my-targets (teacher, coordinator) both
carry a FEATURE_URL_MAP entry; the write RPCs' notifications link to
/teacher/my-targets.`}</pre>
      </section>

      {/* 4. Storage Buckets */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">4. Storage Buckets</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Bucket</th><th className="border border-gray-300 p-2 text-left">Contents &amp; access</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">user-avatars</td><td className="border border-gray-300 p-2">Profile photos. <strong>Private</strong>, checked per request by can_view_user_photo; there is no public profile-photos bucket</td></tr>
            <tr><td className="border border-gray-300 p-2">question-images</td><td className="border border-gray-300 p-2">Question and per-option diagrams; size-limited at the bucket</td></tr>
            <tr><td className="border border-gray-300 p-2">exam-sheets</td><td className="border border-gray-300 p-2">Source paper files for results-only exams</td></tr>
            <tr><td className="border border-gray-300 p-2">answer-sheets, hybrid-answer-sheets</td><td className="border border-gray-300 p-2">Scanned and phone-captured answer sheets</td></tr>
            <tr><td className="border border-gray-300 p-2">homework-files</td><td className="border border-gray-300 p-2">Homework submissions. Owner-only; markers read via the homework-file-url edge function</td></tr>
            <tr><td className="border border-gray-300 p-2">notice-attachments</td><td className="border border-gray-300 p-2">Notice Board attachments. Private</td></tr>
            <tr><td className="border border-gray-300 p-2">message-attachments</td><td className="border border-gray-300 p-2">Conversation attachments</td></tr>
            <tr><td className="border border-gray-300 p-2">study-materials</td><td className="border border-gray-300 p-2">Subject study material PDFs</td></tr>
            <tr><td className="border border-gray-300 p-2">staff-documents</td><td className="border border-gray-300 p-2">HR documents</td></tr>
            <tr><td className="border border-gray-300 p-2">task-evidence, task-voice-comments</td><td className="border border-gray-300 p-2">Task completion evidence and voice notes</td></tr>
            <tr><td className="border border-gray-300 p-2">proctoring-screenshots, face-photos</td><td className="border border-gray-300 p-2">Proctoring captures and face enrolment</td></tr>
            <tr><td className="border border-gray-300 p-2">institution-logos, circular-attachments</td><td className="border border-gray-300 p-2">Institution branding; circular-attachments is legacy, superseded by notice-attachments</td></tr>
          </tbody>
        </table>
      </section>

      {/* 5. Feature Dependency Map */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">5. Feature Dependency Map</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Feature</th>
              <th className="border border-gray-300 p-2 text-left">Depends On</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Exam Creation</td><td className="border border-gray-300 p-2">Classes, class groups, subjects, syllabus chapters; blueprint auto-fill in useSaveExam / useUpdateExam</td></tr>
            <tr><td className="border border-gray-300 p-2">AI Question Generation</td><td className="border border-gray-300 p-2">Exam sections, AI config and API keys, institution quotas, user_question_limits, and a resolvable grade level on the chapter</td></tr>
            <tr><td className="border border-gray-300 p-2">Auto-Grading</td><td className="border border-gray-300 p-2">Student answers, evaluation blueprints, AI config; handles both options shapes</td></tr>
            <tr><td className="border border-gray-300 p-2">OCR Processing</td><td className="border border-gray-300 p-2">Storage (answer-sheets), AI config, exam sections</td></tr>
            <tr><td className="border border-gray-300 p-2">Hybrid Exams</td><td className="border border-gray-300 p-2">hybrid_* plane, pairing tokens, the five hybrid edge functions, hybrid-answer-sheets bucket</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam Insights</td><td className="border border-gray-300 p-2">Completed attempts, AI evaluations</td></tr>
            <tr><td className="border border-gray-300 p-2">Learning Passport</td><td className="border border-gray-300 p-2">Concept mastery, exam history, badge progress</td></tr>
            <tr><td className="border border-gray-300 p-2">Attendance</td><td className="border border-gray-300 p-2">Classes, class assignments, attendance_settings, institutions.timezone, tt_run_attendance_pass_for_institution</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Leave</td><td className="border border-gray-300 p-2">Attendance feature flag, leave_requests, can_review_student_leave, review_student_leave</td></tr>
            <tr><td className="border border-gray-300 p-2">Notice Board</td><td className="border border-gray-300 p-2">notices + target junctions, publish_notice audience expansion, notice_recipients, wings and classes, notice-attachments bucket</td></tr>
            <tr><td className="border border-gray-300 p-2">Salci Support</td><td className="border border-gray-300 p-2">reported_issues, support_messages, the two write-path RPCs, the tasks module, support-notify-email</td></tr>
            <tr><td className="border border-gray-300 p-2">Profile Photos</td><td className="border border-gray-300 p-2">user-avatars bucket, profiles.avatar_path, can_set_user_photo / can_view_user_photo, the path-ownership trigger, the on-device avatar store</td></tr>
            <tr><td className="border border-gray-300 p-2">Command Center</td><td className="border border-gray-300 p-2">institution_features, user role, dash_* RPC families, dashboard_flags, DashboardScope</td></tr>
            <tr><td className="border border-gray-300 p-2">Scoped Snapshot</td><td className="border border-gray-300 p-2">dash_scoped_* (coordinator, via dash_resolve_scoped_classes) and dash_teacher_* (teacher, via dash_resolve_teacher_pairs)</td></tr>
            <tr><td className="border border-gray-300 p-2">Timetable</td><td className="border border-gray-300 p-2">tt_period_structures, tt_period_slots, tt_class_structure, tt_resources, cal_academic_years, cal_events</td></tr>
            <tr><td className="border border-gray-300 p-2">Lesson Planning</td><td className="border border-gray-300 p-2">tt_slots (published), tt_lesson_plans, syllabus_topics, chapter_topics</td></tr>
            <tr><td className="border border-gray-300 p-2">Syllabus Coverage</td><td className="border border-gray-300 p-2">syllabus_progress_events, syllabus_sequence, tt_slots for the teacher scope, dash_syllabus_coverage family</td></tr>
            <tr><td className="border border-gray-300 p-2">Optional Subjects</td><td className="border border-gray-300 p-2">optional_groups, student_optional_enrollments, optional_choices_recorded() as the dormancy gate</td></tr>
            <tr><td className="border border-gray-300 p-2">Class Groups</td><td className="border border-gray-300 p-2">class_groups, classes.class_group_id, global grade_levels, subject_class_group_mappings with trigger fanout</td></tr>
            <tr><td className="border border-gray-300 p-2">Question Bank Scope</td><td className="border border-gray-300 p-2">question_bank.class_group_id, question_bank_section_scope, three SECURITY DEFINER helpers (question_has_section_scope, user_is_in_question_scope, get_question_institution_id)</td></tr>
            <tr><td className="border border-gray-300 p-2">Service Worker Updates</td><td className="border border-gray-300 p-2">public/sw.js (__BUILD_ID__ token), the vite swBuildIdPlugin, src/main.tsx registration with dirty-form coordination</td></tr>
            <tr><td className="border border-gray-300 p-2">Error Translation</td><td className="border border-gray-300 p-2">src/lib/errorMessages.ts (translateError), src/lib/toast.ts (toastError), src/lib/invokeEdgeFunction.ts (invokeAdminOperation)</td></tr>
            <tr><td className="border border-gray-300 p-2">Notifications</td><td className="border border-gray-300 p-2">push_subscriptions, notification_queue, the service worker, send-web-push</td></tr>
          </tbody>
        </table>
      </section>

      {/* 6. Navigation Flow */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">6. Navigation Flow Map</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">6.1 School Admin</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`Login → Home (NavigationHub tiles, Dashboard tile leads the grid)
  ├── Command Center  (/school/command-center)
  │     ├── Overview bento → KPI rows, collapsed insights digest
  │     ├── Students / Teachers / Academics / Attendance / Communication
  │     ├── Needs your attention → flag feed → create or reassign a task
  │     └── Download Report (snapshot PDF) · kebab → 3 CBSE reports
  ├── People
  │     ├── Manage Users → add, edit, bulk import, photos
  │     ├── Manage Teaching Staff → class + subject assignment (atomic, audited)
  │     └── Manage Students → details, roll numbers, optional choices, bulk actions
  ├── Academics
  │     ├── Classes → sections, class groups
  │     ├── Subjects → institution catalog
  │     ├── Syllabus → chapters, topics, Parts, Optional Groups
  │     ├── Exams → create, publish, results, offline marks
  │     └── Question Bank
  ├── Operations
  │     ├── Attendance → roster, Staff Attendance, Reports, exports
  │     ├── Timetable → period structures, class workspace, calendar, resources
  │     ├── Notices → compose, audience preview, reach and read receipts
  │     ├── Communication → Messages
  │     ├── Fees · HR · Billing
  │     └── Tasks
  └── Settings`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">6.2 Teacher</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`Login → Dashboard (own subjects and classes only)
  ├── Snapshot (/school/snapshot)  subject-scoped, dash_teacher_* RPCs
  ├── My Week → log the period (chapter, or note-only), see projected vs actual
  ├── My Students → narrowed by teacher_controls_student()
  ├── Exams → create for assigned subjects → questions (manual, AI, or bank)
  │     → Review step checks the whole paper → publish
  ├── Evaluations → review AI marks, override per question, voice feedback
  ├── Hybrid marking → one question at a time, on a phone if needed
  ├── Homework → create, mark roster, publish
  ├── Attendance → mark class, mark student leave
  └── Tasks · Support`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">6.3 Student</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`Login → Dashboard (single scroll, parent-first)
  ├── Exams → available exams → attempt (timer is server-authoritative)
  ├── My Results → filters, class comparison, subject trajectory,
  │     chapter-wise analysis → exam detail → PDF
  ├── Homework feed → submit with files
  ├── My Week → real timetable grid
  ├── Attendance calendar → Apply Leave / Track Leaves
  ├── Study Materials → PDFs from Syllabus Parts
  ├── Learning Passport → concept mastery
  ├── Achievements → Player Card, streak spine, leaderboard
  └── Profile (READ-ONLY: students cannot edit their own profile)`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">6.4 Timetable Flow (multi-role)</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`Admin
  ├── /school/period-structures → tt_period_structures / tt_period_slots
  ├── /school/calendar          → cal_academic_years, cal_events
  ├── /school/shared-resources  → tt_resources
  ├── /school/timetable/:classId→ tt_class_structure
  └── AY rollover               → copy-timetable-template (preserves custom_label)

Coordinator / Admin → /school/timetable/:classId
  ├── Grid → assign teacher + subject to a period slot (tt_slots)
  ├── Substitute Mode → cover absences (tt_substitutions; tt-notify-substitute)
  ├── Download Lesson Plan → Excel export via two scoped read-only RPCs
  └── Publish → notify teachers

Teacher → /teacher/my-week
  ├── Weekly grid → assigned periods + substitutions
  ├── Log a period → chapter progress, or a note-only log for a chapterless
  │                  period; check-out backlog is non-blocking
  └── Absence → flag pending absence (tt-notify-absence-pending)

Student → /student/my-week
  └── Weekly grid, teaching sessions only`}</pre>
      </section>

      {/* 7. Edge Function API Map */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">7. Edge Function API Map</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Category</th>
              <th className="border border-gray-300 p-2 text-left">Functions</th>
              <th className="border border-gray-300 p-2 text-left">Trigger</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">AI Generation</td><td className="border border-gray-300 p-2">generate-questions, auto-grade-submission, process-ocr-upload</td><td className="border border-gray-300 p-2">Teacher or admin action</td></tr>
            <tr><td className="border border-gray-300 p-2">AI Analytics</td><td className="border border-gray-300 p-2">generate-exam-insights, generate-learning-actions, generate-predictions</td><td className="border border-gray-300 p-2">Post-exam completion</td></tr>
            <tr><td className="border border-gray-300 p-2">Admin AI</td><td className="border border-gray-300 p-2">generate-principal-ai-insights, generate-principal-tasks</td><td className="border border-gray-300 p-2">Admin dashboard load</td></tr>
            <tr><td className="border border-gray-300 p-2">Hybrid (5)</td><td className="border border-gray-300 p-2">generate-hybrid-pairing-token, validate-hybrid-pairing-token, upload-hybrid-page, upload-hybrid-sheet, publish-hybrid-marks</td><td className="border border-gray-300 p-2">Phone pairing and sheet upload</td></tr>
            <tr><td className="border border-gray-300 p-2">Homework (3)</td><td className="border border-gray-300 p-2">submit-homework, homework-file-url, homework-notify-pass</td><td className="border border-gray-300 p-2">Student submit, marker file read, notify cron</td></tr>
            <tr><td className="border border-gray-300 p-2">Timetable (4)</td><td className="border border-gray-300 p-2">copy-timetable-template, get-working-days, tt-notify-substitute, tt-notify-absence-pending</td><td className="border border-gray-300 p-2">Template clone, calendar, substitution notify</td></tr>
            <tr><td className="border border-gray-300 p-2">Support (1)</td><td className="border border-gray-300 p-2">support-notify-email</td><td className="border border-gray-300 p-2">Ticket status change and reply, behind an origin allowlist</td></tr>
            <tr><td className="border border-gray-300 p-2">Communication</td><td className="border border-gray-300 p-2">send-web-push, send-communication, broadcast-email, send-welcome-email, send-fee-reminder, send-task-notifications</td><td className="border border-gray-300 p-2">Event-driven and scheduled</td></tr>
            <tr><td className="border border-gray-300 p-2">Admin Ops</td><td className="border border-gray-300 p-2">admin-operations, invite-admin, promote-students</td><td className="border border-gray-300 p-2">Admin action. All call sites go through invokeAdminOperation, a direct authenticated fetch</td></tr>
            <tr><td className="border border-gray-300 p-2">Data Import</td><td className="border border-gray-300 p-2">import-syllabus, import-syllabus-csv</td><td className="border border-gray-300 p-2">Admin upload</td></tr>
            <tr><td className="border border-gray-300 p-2">Auth</td><td className="border border-gray-300 p-2">resolve-login-identifier</td><td className="border border-gray-300 p-2">Login form submit (email, phone or admission number)</td></tr>
            <tr><td className="border border-gray-300 p-2">Attendance</td><td className="border border-gray-300 p-2">mark-biometric-attendance</td><td className="border border-gray-300 p-2">Biometric device</td></tr>
            <tr><td className="border border-gray-300 p-2">Student</td><td className="border border-gray-300 p-2">mascot-chat, snapshot-student-passport</td><td className="border border-gray-300 p-2">Student interaction</td></tr>
            <tr><td className="border border-gray-300 p-2">Analytics</td><td className="border border-gray-300 p-2">compute-aggregates</td><td className="border border-gray-300 p-2">Post-grading</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">37 school-platform edge functions plus a <code>_shared</code> module. AI runs two distinct plumbing paths: <code>generate-questions</code> goes through <code>supabase/functions/_shared/aiProvider.ts</code> (<code>AI_PROVIDER</code> env, OpenAI <code>gpt-5-mini</code> by default at medium reasoning effort, or Gemini); every other AI function calls the Lovable AI gateway with Google Gemini. No Anthropic model runs in production.</p>
      </section>

      {/* 8. Performance & Reliability */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">8. Performance &amp; Reliability Constraints</h2>
        <p className="text-sm text-gray-700 mb-3">Hard requirements gated at code review after the 2026-05-16 incident. Target 3,000 to 5,000 concurrent users, design ceiling 10,000:</p>
        <ul className="list-disc pl-6 text-sm text-gray-700 mb-4 space-y-1">
          <li><code>supabase.auth.getUser()</code> is monkey-patched to read the local session (167 call sites depend on it). Never call it without a JWT argument; new code reads from the session.</li>
          <li>Explicit column lists only, no <code>select(&apos;*&apos;)</code> outside admin tooling.</li>
          <li>Paginate every unbounded list with <code>range()</code>. PostgREST silently caps at 1000 rows, inside edge functions too, and a WHERE filter is not a bound.</li>
          <li>Aggregate server-side. Never fetch rows to <code>.length</code> them.</li>
          <li>Every new FK gets an index in the same migration. RLS policies call SECURITY DEFINER helpers only, and wrap stable per-row calls as <code>(select auth.uid())</code>.</li>
          <li>React Query: explicit <code>staleTime</code> of at least 60s; <code>refetchInterval</code> under 30s forbidden without a justification comment; <code>refetchOnWindowFocus:false</code> for heavy tables.</li>
          <li>Mutations are idempotent. Two dependent writes are one RPC, never sequential client calls.</li>
          <li>Bundle under 500 KB per chunk and 1.5 MB entry. Lazy-load every page route and every heavy library (XLSX, jsPDF, KaTeX, recharts, pdfjs, exceljs). One realtime channel per feature.</li>
          <li>Edge functions over 10s become background jobs. Infra floor: Medium compute (Large at 1K, XL at 10K), Supavisor pooling, read replicas, Sentry, k6 in <code>scripts/loadtest/</code>. Compute has not yet been raised to that floor.</li>
        </ul>
        <div className="bg-sky-50 border-l-4 border-sky-400 p-4 mb-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Scoped dashboards</p>
          <p>The admin Command Center and the coordinator/teacher Snapshot share components through <code>DashboardScope</code>. Every dashboard hook needs its <code>dash_*</code>, <code>dash_scoped_*</code> and <code>dash_teacher_*</code> variants with <code>scope</code> in the query key, or scoped users silently see the wrong figures. Never branch on <code>scope === &quot;scoped&quot;</code> for teachers.</p>
        </div>
        <div className="bg-red-50 border-l-4 border-red-400 p-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Database operations</p>
          <p><code>supabase_migrations.schema_migrations</code> is not maintained, so verify applied SQL against <code>pg_proc</code>, <code>information_schema</code> and <code>pg_indexes</code> rather than the ledger. Every new SECURITY DEFINER RPC must <code>REVOKE EXECUTE FROM anon</code> by name, because Supabase default privileges grant it and <code>REVOKE FROM PUBLIC</code> does not strip it. Every RLS UPDATE policy needs both <code>USING</code> and <code>WITH CHECK</code>: a missing <code>WITH CHECK</code> silently rejected 100% of teachers' offline-marks saves for two days.</p>
        </div>
      </section>

      {/* Footer */}
      <div className="text-center text-sm text-gray-500 mt-12 pt-6 border-t border-gray-300">
        <p>SALCI Platform · System Maps Document v3.0</p>
        <p>Last updated September 8, 2026 | Confidential</p>
      </div>
    </div>
  );
});

SystemMapsDocument.displayName = "SystemMapsDocument";

export default SystemMapsDocument;
