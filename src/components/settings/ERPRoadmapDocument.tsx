import { forwardRef } from "react";

const STATUS = {
  built: { label: "✅ Built", color: "text-green-700" },
  partial: { label: "🔶 Partial", color: "text-yellow-700" },
  notbuilt: { label: "⬜ Not Built", color: "text-gray-500" },
};

function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return <span className={`font-semibold ${s.color}`}>{s.label}</span>;
}

function ModuleTable({ title, rows }: { title: string; rows: { feature: string; status: keyof typeof STATUS; details: string }[] }) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-2">{title}</h3>
      <table className="w-full border-collapse border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 p-2 text-left">Sub-Feature</th>
            <th className="border border-gray-300 p-2 text-left w-28">Status</th>
            <th className="border border-gray-300 p-2 text-left">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="border border-gray-300 p-2">{r.feature}</td>
              <td className="border border-gray-300 p-2"><StatusBadge status={r.status} /></td>
              <td className="border border-gray-300 p-2">{r.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ERPRoadmapDocument = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="bg-white text-black p-8 max-w-4xl mx-auto font-sans">
      {/* Header */}
      <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">SALCI ERP Roadmap</h1>
        <p className="text-xl text-gray-600">Module-by-Module Status &amp; Build Priority</p>
        <p className="text-sm text-gray-500 mt-2">Version 2.0 | September 8, 2026</p>
        <p className="text-xs text-gray-500 mt-1">Scope: the SALCI school ERP. The Olympiad campaign product is tracked separately and is out of scope for this roadmap.</p>
      </div>

      {/* 1. Platform Overview */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">1. Platform Overview</h2>
        <p className="text-sm text-gray-700 mb-3">
          SALCI ERP digitises K-12 school operations across <strong>12 modules</strong>, serving administrators, principals, coordinators, teachers, students, parents and support staff from one multi-tenant platform. As of September 2026 the academic core is essentially complete and the operational periphery, admissions, transport, library and payroll automation, is where the remaining build sits.
        </p>
        <div className="bg-gray-50 p-4 rounded border border-gray-200 text-sm">
          <p className="font-semibold mb-2">Modules:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-700">
            <li>Student Information Management</li>
            <li>Attendance Management</li>
            <li>Academic Management</li>
            <li>Fee &amp; Finance Management</li>
            <li>Transportation Management</li>
            <li>Library Management</li>
            <li>HR &amp; Payroll Management</li>
            <li>Communication &amp; Collaboration</li>
            <li>Appointments &amp; Meetings</li>
            <li>Mobile Application</li>
            <li>Security &amp; Compliance</li>
            <li>Support &amp; Helpdesk</li>
          </ol>
        </div>
        <div className="bg-gray-50 p-4 rounded border border-gray-200 text-sm mt-3">
          <p className="font-semibold mb-2">User Ecosystem:</p>
          <ul className="list-disc list-inside space-y-1 text-gray-700">
            <li><strong>Super Admin</strong>: platform-wide management, institution creation, billing</li>
            <li><strong>School Admin / Principal</strong>: institution administration, analytics, approvals</li>
            <li><strong>Coordinator</strong>: wing management and teacher oversight</li>
            <li><strong>Teacher</strong>: exam creation, grading, attendance, lesson logging, communication. Authority is the class-and-subject pair, not the class</li>
            <li><strong>Student</strong>: exams, results, homework, learning passport, achievements</li>
            <li><strong>Parent</strong>: child monitoring, fees, PTM scheduling, notifications (portal not yet built; the student dashboard is deliberately parent-first)</li>
            <li><strong>Support Staff</strong>: HR, finance and, in future, library and transport operations</li>
          </ul>
        </div>
      </section>

      {/* 2. Module-by-Module Status Matrix */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">2. Module-by-Module Status Matrix</h2>

        <ModuleTable
          title="Module 1: Student Information Management · 🔶 Partial"
          rows={[
            { feature: "Student Profiles & Demographics", status: "built", details: "Full profile CRUD with role-based visibility; private photos on the profile, the user sheet and the Manage Users lists; students are read-only on their own profile since 2026-09-01, with the two writes they still need moved to column-scoped RPCs first" },
            { feature: "Editable Student Details", status: "built", details: "Roll and admission uniqueness validation, class to section to roll-number picker with batch save and duplicate detection, roster search by admission number, labelled bulk actions; coordinators and teachers get the same surface narrowed to their own scope" },
            { feature: "Canonical Roster Definition", status: "built", details: "institution_student_ids() is the single student-count definition, so profile-based and class-based counts can no longer disagree (the 253-versus-252 class of bug)" },
            { feature: "Enrollment & Class Assignment", status: "built", details: "Bulk import via CSV and Excel with a skipped-row count, class assignment, academic-year management, batch promotion" },
            { feature: "Guardian & Contact Records", status: "built", details: "student_personal_details holds date of birth and guardian name, email and phone. School-managed: students are read-only and there is no DELETE policy" },
            { feature: "Student Transfer (internal)", status: "built", details: "set_student_class moves a student in one transaction with authority checked at both the source and the destination; teachers are excluded from this path" },
            { feature: "Optional Subject Enrollment", status: "built", details: "Optional Groups are the single enrollment workflow; every narrowing filter is gated so it stays dormant until a section actually records choices" },
            { feature: "Pre-Admission Enquiry System", status: "notbuilt", details: "Lead capture, application forms, entrance scheduling, offer to enrolment conversion. The largest single ERP gap" },
            { feature: "Automated Document Verification", status: "notbuilt", details: "Document upload and AI-assisted verification pipeline" },
            { feature: "Medical & Emergency Records", status: "notbuilt", details: "Health records, allergies, dedicated emergency-contact chain beyond the guardian fields" },
            { feature: "Transfer Certificate Generation", status: "notbuilt", details: "Inter-school transfer paperwork and record portability" },
            { feature: "Alumni Tracking", status: "notbuilt", details: "Post-graduation tracking and alumni network" },
          ]}
        />

        <ModuleTable
          title="Module 2: Attendance Management · ✅ Mostly Built"
          rows={[
            { feature: "Session-Based Student Attendance", status: "built", details: "Teacher creates a session and marks the class; clickable roster rows; date navigation with a 2-day edit window on the class marker" },
            { feature: "Institution-Local Auto-Mark", status: "built", details: "tt_run_attendance_pass_for_institution on a 15-minute cron plus a session-guarded page-view kick. All wall-clock comparisons use (now() AT TIME ZONE i.timezone); a bare now() left auto-mark dead for every IST school until 13:30 local time in May 2026" },
            { feature: "Code Verification Check-in", status: "built", details: "Students enter a session code to mark presence (attendance_pins)" },
            { feature: "Student Leave Workflow", status: "built", details: "Students apply and track leave; staff approve or reject through review_student_leave, the only decision write path, which retroactively corrects attendance and notifies. Teachers can also mark leave directly. \"Late\" was removed from the student plane entirely; \"leave\" counts in the total but never as present" },
            { feature: "Staff Attendance", status: "built", details: "Teacher and coordinator attendance merged into one Staff Attendance tab, with a Reports tab scoped to the viewer's own classes" },
            { feature: "Attendance Analytics & Reports", status: "built", details: "Server-side pivot RPCs with Prev/Next pagination, styled multi-sheet .xlsx export with an overview Summary tab per class and an At-Risk Watchlist, plus attendance trend and compliance cards on the dashboards" },
            { feature: "Student Attendance Calendar", status: "built", details: "A student-facing month calendar showing every calendar-event kind" },
            { feature: "Biometric Sync (Fingerprint)", status: "partial", details: "Data model and the mark-biometric-attendance function are built; hardware device integration is pending" },
            { feature: "Facial Recognition", status: "partial", details: "face-api.js is loaded and face_enrollments is modelled; real-time matching is not production-ready" },
            { feature: "Mobile Check-in (GPS)", status: "notbuilt", details: "Geofenced check-in from a native app" },
            { feature: "Parent Auto-Alerts on Absence", status: "notbuilt", details: "Automatic SMS or push to a parent on absence, blocked on the parent portal and an SMS provider" },
          ]}
        />

        <ModuleTable
          title="Module 3: Academic Management · ✅ Built"
          rows={[
            { feature: "Exam Builder (7 question types)", status: "built", details: "Multi-section papers; MCQ, short, long, true/false, fill-in-the-blank, matching and assertion-reason; diagrams on every question type and on each MCQ option; Create Duplicate on every exam card" },
            { feature: "Mobile-First Exam Creation Flow", status: "built", details: "Touch-friendly Details, Questions and Review wizard with a clickable step indicator; drafts resume at the right step with subject, chapters and section plan intact; blueprint auto-fill in useSaveExam and useUpdateExam so the prevent_invalid_exam_publish trigger accepts subjective exams without a blueprint editor" },
            { feature: "Review Step Paper Check", status: "built", details: "The review step renders the whole paper through the shared renderer, images included, and blocks a publish that would ship a broken paper" },
            { feature: "AI Question Generation", status: "built", details: "gpt-5-mini at medium reasoning effort with subject-based cost routing; per-user daily quota; grade resolves from the chapter so early years is calibrated instead of defaulting to \"General\"; difficulty is hardcoded to 5 with an early-years clamp for Class 1 and below" },
            { feature: "KaTeX Math Authoring", status: "built", details: "Dollar-delimited LaTeX end to end, repairLatexEscapes() before JSON.parse, and a MathLive WYSIWYG builder on every manual-entry form and on each MCQ option" },
            { feature: "Online Exam Taking", status: "built", details: "Server-authoritative timer, section navigation, auto-submit, flagging, a late-entry window, and a closed back-button attempt reset" },
            { feature: "Exam Integrity Ladder", status: "built", details: "Tab switches and fullscreen exits share one 4-strike ladder: two warnings, a 15-second pause, auto-submit on the fourth. iOS and macOS Safari are exempt from the fullscreen lock because it throws synchronously there" },
            { feature: "AI Auto-Grading", status: "built", details: "Confidence scores, keyword matching, teacher override; handles both historical exam_questions.options shapes" },
            { feature: "Hybrid Exams", status: "built", details: "A separate hybrid_* data plane with an unauthenticated phone companion whose pairing token is the authorisation; marking is a guided one-question-at-a-time flow with a CBSE-style marks stamp, per-question accordion, aspect-correct annotations and voice-dictated feedback, and it works on a phone" },
            { feature: "Results-Only (Already-Created) Exams", status: "built", details: "exams.is_results_only plus source_paper_files; two distinct offline-marks pipelines that never cross; explicit Absent state; marks stay editable after results publish" },
            { feature: "OCR Offline Exam Pipeline", status: "built", details: "Scan, digitise and auto-grade for offline papers" },
            { feature: "Question Bank", status: "built", details: "Scoped by class_group_id with optional section-scope rows (zero rows means class-wide); recent-first ordering on covering indexes; RLS through three SECURITY DEFINER helpers to avoid recursion" },
            { feature: "Timetable & Schedule Management", status: "built", details: "Fully on tt_* and cal_*: period structures (editable after creation, with an \"Other\" slot type carrying a custom label), class workspace, shared resources, substitutions, academic calendar and year rollover. Seven legacy tables were dropped" },
            { feature: "Lesson Planning & Delivery", status: "built", details: "Per-slot per-date lesson records, a note-only escape for chapterless periods (surprise tests, activities), and a coordinator and admin Excel export of lesson delivery through two scoped read-only RPCs" },
            { feature: "Two-Timeline Syllabus", status: "built", details: "An append-only actual jar of chapter-level progress events written by one RPC, plus an automatic projection over the sequence; both lines render on the teacher and student week grids; non-blocking check-in backlog, corrections mode and an SY1 escalation flag" },
            { feature: "Syllabus Segmentation (Parts)", status: "built", details: "Named parts such as PA1 or Term 1 scoped to class group and subject, behind an off-by-default feature flag" },
            { feature: "Chapter Hierarchy & Ordering", status: "built", details: "Chapter and topic tree with CSV import and custom chapters, drag-to-reorder behind a press-and-hold, and per-user personal ordering merged into the read path" },
            { feature: "Homework & Assignments", status: "built", details: "Multi-subject assignments, student submission with files, marking roster ordered by roll number, publish gate, auto-check cron, delete at any status, student feed; three dedicated edge functions; submission storage is owner-only and markers read through a signed-URL broker" },
            { feature: "Report Cards & Transcripts", status: "built", details: "Rebuilt downloadable PDF report with packed pages, correct page breaks and the restrained SALCI palette; the silent result loss in the old builder is fixed" },
            { feature: "Concept Mastery & Learning Passport", status: "built", details: "Chapter-level mastery tracked across exams" },
            { feature: "Student Portal", status: "built", details: "Consolidated to two surfaces, a single-scroll parent-first Dashboard and My Results, with class comparison, subject trajectory, chapter-wise analysis and a per-exam detail page. The separate Reports destination and the dead dashboards were retired" },
            { feature: "Achievements & Gamification", status: "built", details: "Player Card page with a tri-colour hero row, a streak spine and grouped explanations of how each badge was earned; a server-side leaderboard with \"where am I\"; ladders cover classroom, lesson planning, syllabus completion, assessment, marking and teamwork, and the teacher ladder is open to coordinators" },
            { feature: "Command Center & Scoped Dashboards", status: "built", details: "The admin Command Center and the coordinator and teacher Snapshot share components through DashboardScope, backed by three parallel RPC families (dash_*, dash_scoped_*, dash_teacher_*) and a 20-flag evaluator. Rebuilt to a principal-first blueprint through August 2026" },
            { feature: "Class Groups Container", status: "built", details: "class_groups sits above section rows; subject catalog and chapters are shared at group level and fan out by trigger to the legacy per-section table" },
            { feature: "Plagiarism Detection", status: "notbuilt", details: "Similarity checking across homework and subjective answers" },
            { feature: "Virtual Classrooms", status: "notbuilt", details: "Integrated video, whiteboard and recording" },
          ]}
        />

        <ModuleTable
          title="Module 4: Fee & Finance Management · 🔶 Partial"
          rows={[
            { feature: "Fee Structure Definition", status: "built", details: "Multi-tier structures and fee categories, assigned per student" },
            { feature: "Installments & Concessions", status: "built", details: "fee_installments and fee_concessions model staged payment and per-student relief" },
            { feature: "Payment Tracking & Receipts", status: "built", details: "Record payments, view history, generate receipts (payment_records, payment_receipts, fee_receipts)" },
            { feature: "Defaulter Visibility", status: "partial", details: "The Command Center flags fee defaulters overdue 30 days or more and collection below target; there is no automated escalation or access restriction" },
            { feature: "Payment Gateway Integration", status: "notbuilt", details: "No live gateway auto-charge or reconciliation for school fees. Parents pay offline and an admin records it manually, which is the module's main UX cost" },
            { feature: "Late Fee Automation", status: "notbuilt", details: "Automatic late-fee calculation and penalty rules" },
            { feature: "Scholarship Management", status: "notbuilt", details: "Merit and need-based scholarship workflows on top of the existing concession model" },
            { feature: "Financial Reporting & Audit", status: "notbuilt", details: "Income and expense reporting, tax compliance, GST" },
            { feature: "PCI-DSS Compliance", status: "notbuilt", details: "Tokenised card handling, required before any gateway work ships" },
            { feature: "Multi-Currency Support", status: "notbuilt", details: "International-school currency handling" },
          ]}
        />

        <ModuleTable
          title="Module 5: Transportation Management · ⬜ Not Built"
          rows={[
            { feature: "Route & Stop Management", status: "notbuilt", details: "Route definition, stop allocation, student-to-route mapping" },
            { feature: "GPS Live Tracking", status: "notbuilt", details: "Real-time vehicle location for parents and admin" },
            { feature: "Route Optimisation", status: "notbuilt", details: "Automated route planning and stop sequencing" },
            { feature: "Fleet Management", status: "notbuilt", details: "Vehicle inventory, maintenance scheduling, driver records" },
            { feature: "Parent Live Location & ETA", status: "notbuilt", details: "Arrival alerts and estimated time of arrival" },
            { feature: "Boarding Tracking", status: "notbuilt", details: "RFID or face scan on boarding and deboarding, feeding attendance" },
            { feature: "Transport Fee Integration", status: "notbuilt", details: "Route-based fee calculation billed through the fee module" },
          ]}
        />

        <ModuleTable
          title="Module 6: Library Management · ⬜ Not Built"
          rows={[
            { feature: "Digital Catalog", status: "notbuilt", details: "Book and journal inventory with search and categorisation" },
            { feature: "Barcode / RFID Integration", status: "notbuilt", details: "Scan-based issue and return, inventory audits" },
            { feature: "Circulation Management", status: "notbuilt", details: "Issue, return, renew and reserve workflows" },
            { feature: "Overdue Tracking & Fines", status: "notbuilt", details: "Automatic fine calculation and reminders" },
            { feature: "E-Library", status: "notbuilt", details: "PDF and ebook repository with reading progress. Note that subject study materials already have their own bucket and student surface" },
            { feature: "Reading Analytics", status: "notbuilt", details: "Reading habits, genre preferences, recommendations" },
          ]}
        />

        <ModuleTable
          title="Module 7: HR & Payroll Management · 🔶 Partial"
          rows={[
            { feature: "Staff Directory & Profiles", status: "built", details: "Employee profiles, department assignment, contact details, documents (staff_documents), a Workforce directory surface" },
            { feature: "Salary Structures & Assignments", status: "built", details: "staff_salary_structures and staff_salary_assignments define components and attach them per employee" },
            { feature: "Payroll Runs", status: "partial", details: "payroll_runs and payroll_entries capture a monthly run with gross, deductions and net totals and a run status. Automated component-by-component computation, payslip PDFs and approval chains are not built" },
            { feature: "Staff Leave Management", status: "built", details: "staff_leave_requests with leave types, reviewer, reviewer notes and status, plus staff_leave_balances and a My Leaves surface. Approval feeds the substitution flow in the timetable" },
            { feature: "Staff Attendance & Timesheet", status: "built", details: "Staff attendance records with an admin roster surface and per-user detail; hours-based timesheets are not modelled" },
            { feature: "My Salary (staff view)", status: "built", details: "A staff-facing salary surface" },
            { feature: "Tax Compliance (TDS / PF / ESI)", status: "notbuilt", details: "Indian tax regime compliance, Form 16, provident fund returns" },
            { feature: "Recruitment Pipeline", status: "notbuilt", details: "Job posting, applicant tracking, interview scheduling" },
            { feature: "Performance Reviews", status: "notbuilt", details: "Appraisal cycles and goal tracking. teacher_effectiveness and teacher_engagement_monthly exist as analytics, not as an appraisal workflow" },
          ]}
        />

        <ModuleTable
          title="Module 8: Communication & Collaboration · ✅ Mostly Built"
          rows={[
            { feature: "Notice Board", status: "built", details: "Replaced circulars in August 2026. Hierarchy-scoped notices with multi-target junctions, audience expansion into a materialised recipient set, audience preview, read receipts, inbox and outbox feeds, a reach rollup, a private attachment bucket, and RLS that closed the leak where a teacher's class notice reached co-teachers" },
            { feature: "In-App Messaging", status: "built", details: "Direct, group and class-wide conversations with attachments" },
            { feature: "Bulk Communication Engine", status: "built", details: "Bulk Send was rebuilt as a Messages tab riding the Notice Board audience engine, and it sends real direct messages rather than collapsing everyone into one group thread" },
            { feature: "Transactional Email", status: "built", details: "Resend-backed delivery for welcome, fee reminder, task notification, support and broadcast email" },
            { feature: "Push Notifications", status: "built", details: "VAPID Web Push through the service worker, with a notification queue" },
            { feature: "Communication Reach Analytics", status: "partial", details: "Read receipts and a reach rollup exist for notices; there is no cross-channel delivery or engagement analytics" },
            { feature: "Email Templates & Campaigns", status: "partial", details: "The Templates tab was removed from the admin Communication page on 2026-09-07. communication_templates and its data remain, with no send path wired to them" },
            { feature: "SMS Integration", status: "notbuilt", details: "Bulk SMS through a provider, with TRAI DLT template registration" },
            { feature: "WhatsApp Business API", status: "notbuilt", details: "Template messages and automated notifications" },
          ]}
        />

        <ModuleTable
          title="Module 9: Appointments & Meetings · ✅ Built"
          rows={[
            { feature: "PTM Scheduling", status: "built", details: "Parent-teacher meeting creation with slot management (ptm_schedules)" },
            { feature: "Slot Booking", status: "built", details: "Time-slot selection with conflict prevention (ptm_bookings)" },
            { feature: "Approval Workflows", status: "built", details: "Request, approve or reject, then notify" },
            { feature: "Virtual Meeting Integration", status: "notbuilt", details: "Automatic video-conference link generation" },
            { feature: "Recurring Appointments", status: "notbuilt", details: "Weekly or monthly recurring schedules" },
          ]}
        />

        <ModuleTable
          title="Module 10: Mobile Application · 🔶 Partial"
          rows={[
            { feature: "Installable PWA", status: "built", details: "The web app installs as a PWA with a build-stamped service worker, so a deploy is detected on tab focus and on an hourly poll, and the reload is dirty-form aware" },
            { feature: "Mobile-First UI", status: "built", details: "Every surface is built to work at 375px, with MobileTabs and MobileSheet as the standard patterns. Hybrid marking and homework forms were specifically reworked for phones" },
            { feature: "Push Notifications (Web)", status: "built", details: "Web Push through the service worker" },
            { feature: "Native iOS App", status: "notbuilt", details: "Capacitor shell around this web build, App Store listing" },
            { feature: "Native Android App", status: "notbuilt", details: "Capacitor shell around this web build, Play Store listing" },
            { feature: "Offline Mode", status: "notbuilt", details: "Local sync, offline exam taking, queued uploads" },
            { feature: "Native Push (APNs / FCM)", status: "notbuilt", details: "Native push channels" },
            { feature: "Biometric App Lock", status: "notbuilt", details: "Face ID or fingerprint app access" },
          ]}
        />

        <ModuleTable
          title="Module 11: Security & Compliance · 🔶 Partial"
          rows={[
            { feature: "Role-Based Access Control", status: "built", details: "7 roles with institution scoping, plus four per-user capability grants that raise one named user without a role change, and an admin-plus-teacher dual role whose view toggle is presentation-only because every server gate is an admin-first OR-union" },
            { feature: "Row-Level Security", status: "built", details: "RLS on every scoped table. Policies call SECURITY DEFINER helpers only, and wrap stable per-row calls so the planner treats them as initplans" },
            { feature: "Subject-Scoped Teacher Authority", status: "built", details: "teacher_controls_student() is the predicate for every teacher read and write except attendance. Sharing a class is not authority, and an assignment row with no subject grants nothing" },
            { feature: "Feature Gating", status: "built", details: "29 per-institution toggles enforced in the sidebar, on dashboard tiles and at the route. Tiles rendered outside NavigationHub must be hand-wrapped" },
            { feature: "Audit Trails", status: "built", details: "system_audit_logs, user_activity_log, task_audit_logs, homework_mark_audit and class_assignment_deletions (which has no FKs so it survives cascades). The user activity feed federates nine source tables" },
            { feature: "Transactional Write Contract", status: "built", details: "Client code never DELETE-then-INSERTs a relationship table. Destructive saves go through transactional RPCs that name their blockers, diff in one transaction and audit-log the delta, after that pattern silently wiped two teachers' portals in August 2026" },
            { feature: "User Deletion Cascade Contract", status: "built", details: "admin-operations, then auth.admin.deleteUser, then the DB cascade chain. Ownership FKs CASCADE and authorship FKs SET NULL; every new FK to profiles must declare an explicit ON DELETE" },
            { feature: "Error Translation Pipeline", status: "built", details: "Central toastError and translateError map Postgres codes and edge-function failures to readable copy. Error state renders before empty state, so a failed query never reads as an empty school" },
            { feature: "Service Worker Build-ID Stamping", status: "built", details: "A templated cache key rewritten at build time, so installed PWAs detect deploys instead of sitting on a stale bundle for days" },
            { feature: "Grant Hygiene", status: "partial", details: "New SECURITY DEFINER functions must revoke EXECUTE from anon by name, since Supabase default privileges grant it and revoking from PUBLIC does not strip it. Two sweeps have already been needed, on the audit-log function and on the whole dash_* surface. This needs to become a checked step, not a remembered one" },
            { feature: "Two-Factor Authentication", status: "partial", details: "A UI toggle exists; TOTP or SMS is not implemented" },
            { feature: "Data Encryption at Rest", status: "partial", details: "Supabase default encryption; field-level encryption for salary and personal data is not implemented" },
            { feature: "Standing Audit Debt", status: "partial", details: "Security, performance, slowness, optional-subjects and teacher-portal audits from July and August 2026 are partly open in docs/. Two structural root causes recur: edge functions that check a role but not ownership, and controls enforced only in the React client" },
            { feature: "DPDPA 2023 Compliance", status: "notbuilt", details: "Consent management, data-principal rights, deletion request workflows, privacy dashboard" },
            { feature: "Penetration Testing", status: "notbuilt", details: "Scheduled third-party VAPT and vulnerability scanning" },
            { feature: "Breach Notification Protocol", status: "notbuilt", details: "72-hour notification process and an incident response playbook" },
          ]}
        />

        <ModuleTable
          title="Module 12: Support & Helpdesk · ✅ Built"
          rows={[
            { feature: "Reporter Surface", status: "built", details: "One /support door for every authenticated role, with tabs, unread dots and a threaded conversation. Hidden from SALCI's own admins, who work the inbox instead" },
            { feature: "Threaded Tickets", status: "built", details: "reported_issues holds the ticket and support_messages the thread, including a guarded internal-note channel reporters never see. The 41 pre-existing tickets and their 14 internal notes were backfilled into the thread" },
            { feature: "Single Write Paths", status: "built", details: "post_support_message (idempotent) and _support_apply_status are the only writes. Every support RPC has EXECUTE revoked from PUBLIC and from anon by name, verified against routine_privileges" },
            { feature: "SALCI Inbox", status: "built", details: "/admin/issues with an awaiting-SALCI filter, unread dots, category filters and ticket deep links; the ticket list is fetched once and sliced per tab" },
            { feature: "Ticket to Task", status: "built", details: "A support request becomes a real task, and the task panel deep-links back into the conversation and refreshes the support caches" },
            { feature: "Email Notifications", status: "built", details: "support-notify-email sends the reporter a best-effort email on each reply and status change, behind an origin allowlist, authorising the recipient rather than only the ticket" },
            { feature: "SLA Tracking & Reporting", status: "notbuilt", details: "first_response_at and resolved_at are captured, but there is no SLA target, breach alerting or helpdesk reporting on top of them" },
          ]}
        />
      </section>

      {/* 3. Integrations & APIs Status */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">3. Integrations &amp; APIs Status</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Integration</th>
              <th className="border border-gray-300 p-2 text-left w-28">Status</th>
              <th className="border border-gray-300 p-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">OpenAI API</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Question generation on gpt-5-mini at medium reasoning effort, with subject-based cost routing to a cheaper model</td></tr>
            <tr><td className="border border-gray-300 p-2">Google Gemini (Lovable gateway)</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Auto-grading, OCR, predictions, exam and principal insights, mascot chat</td></tr>
            <tr><td className="border border-gray-300 p-2">OCR Service</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Handwriting recognition for offline exam digitisation</td></tr>
            <tr><td className="border border-gray-300 p-2">Resend (Email)</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Transactional email for welcome, invitations, fee reminders, task notifications, support replies and broadcasts</td></tr>
            <tr><td className="border border-gray-300 p-2">Supabase Storage</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">16 buckets; sensitive ones private and read through signed URLs or a broker function</td></tr>
            <tr><td className="border border-gray-300 p-2">Supabase Edge Functions</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">37 school-platform functions: server logic, third-party calls, cron passes</td></tr>
            <tr><td className="border border-gray-300 p-2">Web Push API</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">VAPID push through the service worker</td></tr>
            <tr><td className="border border-gray-300 p-2">Payment Gateway</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">No gateway is wired to school fees. Razorpay integration patterns exist elsewhere in the codebase and can be reused</td></tr>
            <tr><td className="border border-gray-300 p-2">Biometric Device SDK</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">Data model and intake function ready; hardware SDK pending</td></tr>
            <tr><td className="border border-gray-300 p-2">SMS Provider</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Transactional and promotional SMS, requires TRAI DLT registration</td></tr>
            <tr><td className="border border-gray-300 p-2">WhatsApp Business API</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Template messages and automated notifications</td></tr>
            <tr><td className="border border-gray-300 p-2">GPS / Fleet Tracking</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Real-time vehicle tracking, blocked with the transport module</td></tr>
            <tr><td className="border border-gray-300 p-2">Video Conferencing</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Meeting creation, link generation, recording</td></tr>
            <tr><td className="border border-gray-300 p-2">Sentry / APM</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Named in the concurrency infra floor but not yet wired. Error triage currently runs off the Supabase logs</td></tr>
          </tbody>
        </table>
      </section>

      {/* 4. Recommended Build Priority */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">4. Recommended Build Priority</h2>
        <p className="text-sm text-gray-700 mb-4">
          The ERP build-out began on 2026-09-07 and runs on two long-lived branches cut from main, one full-stack and one frontend-only, merged centrally. Priorities below reflect that split: anything needing schema work belongs to the full-stack branch.
        </p>

        <div className="space-y-6">
          <div className="bg-green-50 p-4 rounded border border-green-200">
            <h3 className="text-lg font-bold text-green-800 mb-2">Phase 1: Close the Operational Gaps (Q4 2026)</h3>
            <p className="text-sm text-green-700 mb-2">Focus: the modules a school notices are missing on day one.</p>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
              <li><strong>Admissions &amp; Enquiry</strong>: lead capture through offer to enrolment. The single largest gap, and it feeds the whole student lifecycle</li>
              <li><strong>Fee Payment Gateway</strong>: revenue-critical and the top standing UX complaint, since parents currently pay offline and an admin records it by hand</li>
              <li><strong>Late Fee Automation &amp; Defaulter Escalation</strong>: builds directly on the gateway and the existing Command Center flag</li>
              <li><strong>Parent Portal</strong>: parent_student_links already exists; this unblocks absence alerts, fee notifications and PTM self-service</li>
              <li><strong>Library Management</strong>: standalone, low inter-dependency, a common tender requirement</li>
              <li><strong>Payroll Computation &amp; Payslips</strong>: the run and structure tables exist, the calculation and PDF do not</li>
            </ol>
          </div>

          <div className="bg-blue-50 p-4 rounded border border-blue-200">
            <h3 className="text-lg font-bold text-blue-800 mb-2">Phase 2: Reach &amp; Reliability (Q1 2027)</h3>
            <p className="text-sm text-blue-700 mb-2">Focus: getting the platform's output to the people who need it, and proving it holds under load.</p>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
              <li><strong>SMS and WhatsApp channels</strong> on top of the existing notice audience engine, with TRAI DLT registration</li>
              <li><strong>Raise the infrastructure floor</strong>: compute to at least Medium, Supavisor pooling, read replicas for analytics, Sentry, and the k6 suite in CI</li>
              <li><strong>Close the standing audit debt</strong>: ownership scoping on edge functions, and moving client-only controls into the database</li>
              <li><strong>Transportation Management</strong>: route and stop modelling first, GPS hardware second</li>
              <li><strong>DPDPA 2023 compliance</strong>: consent, data-principal rights, deletion workflows</li>
            </ol>
          </div>

          <div className="bg-purple-50 p-4 rounded border border-purple-200">
            <h3 className="text-lg font-bold text-purple-800 mb-2">Phase 3: Intelligence &amp; Native (Q2 to Q3 2027)</h3>
            <p className="text-sm text-purple-700 mb-2">Focus: differentiation on top of a complete ERP.</p>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
              <li><strong>Native mobile app</strong> with offline exam taking and native push</li>
              <li><strong>ML-powered learning paths</strong> built on the existing concept-mastery and two-timeline syllabus data</li>
              <li><strong>Anomaly detection</strong>: attendance irregularities and grade manipulation</li>
              <li><strong>Advanced proctoring</strong>: screen capture and behaviour analysis on top of the existing violation ladder</li>
              <li><strong>Plagiarism detection</strong> across homework and subjective answers</li>
              <li><strong>Multi-language UI</strong> for Hindi and regional languages</li>
            </ol>
          </div>

          <div className="bg-orange-50 p-4 rounded border border-orange-200">
            <h3 className="text-lg font-bold text-orange-800 mb-2">Phase 4: Ecosystem (Q4 2027 onward)</h3>
            <p className="text-sm text-orange-700 mb-2">Focus: a platform beyond the core ERP.</p>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
              <li><strong>Inventory, Assets and Hostel</strong> modules for larger institutions</li>
              <li><strong>Alumni management</strong>: tracking, networking, donations</li>
              <li><strong>LMS integration hub</strong>: Google Classroom, Moodle, Canvas</li>
              <li><strong>White-label and franchise</strong> deployment for school chains</li>
              <li><strong>Virtual classrooms</strong>: video, whiteboard and recording</li>
              <li><strong>Blockchain-verified certificates</strong></li>
            </ol>
          </div>
        </div>
      </section>

      {/* 5. Known UX Issues */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">5. Known UX Issues</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-3">
          <thead>
            <tr className="bg-red-50">
              <th className="border border-gray-300 p-2 text-left">Issue</th>
              <th className="border border-gray-300 p-2 text-left">Severity</th>
              <th className="border border-gray-300 p-2 text-left">Description &amp; impact</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Fee Payment UX</td><td className="border border-gray-300 p-2 text-red-600 font-semibold">P0</td><td className="border border-gray-300 p-2">No online payment option. Parents pay offline and an admin records it manually, which is both friction and a reconciliation risk</td></tr>
            <tr><td className="border border-gray-300 p-2">No Parent Surface</td><td className="border border-gray-300 p-2 text-red-600 font-semibold">P0</td><td className="border border-gray-300 p-2">Parents have no login. The student dashboard was made parent-first as a stopgap, but absence alerts, fee notices and PTM booking all wait on a real portal</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam Builder Learning Curve</td><td className="border border-gray-300 p-2 text-orange-600 font-semibold">P1</td><td className="border border-gray-300 p-2">Multi-section creation is powerful but still dense for a first-time teacher, despite the mobile wizard and the clickable step indicator</td></tr>
            <tr><td className="border border-gray-300 p-2">Settings Tab Overflow</td><td className="border border-gray-300 p-2 text-yellow-600 font-semibold">P2</td><td className="border border-gray-300 p-2">Ten tabs on the super-admin Settings page, seven of them documents. Needs categorisation or a sidebar</td></tr>
            <tr><td className="border border-gray-300 p-2">Two Optional-Subject Planes</td><td className="border border-gray-300 p-2 text-yellow-600 font-semibold">P2</td><td className="border border-gray-300 p-2">Optional Groups is the live workflow, but the superseded batches plane still exists in the schema and behind one route. It should be retired rather than left as a second way to do the same thing</td></tr>
          </tbody>
        </table>
        <div className="bg-green-50 p-4 rounded border border-green-200 text-sm text-gray-700">
          <p className="font-semibold text-green-800 mb-1">Resolved since the last revision</p>
          <p><strong>Navigation complexity</strong> was addressed by collapsible sidebar groups for every role and an admin Home that leads with the Dashboard tile. <strong>Home screen density</strong> was addressed by the Command Center rebuild: a bento overview, a collapsed insights digest and equal-height card rows. <strong>Mobile responsiveness</strong> on admin surfaces was swept as part of the same pass, with hybrid marking and the homework form specifically reworked for phones.</p>
        </div>
      </section>

      {/* 6. Compliance Roadmap */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">6. Compliance Roadmap</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Compliance Area</th>
              <th className="border border-gray-300 p-2 text-left w-28">Status</th>
              <th className="border border-gray-300 p-2 text-left">Requirements &amp; timeline</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Security Audits &amp; VAPT</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Internal audits exist and are partly open; no third-party penetration test has been run. Target: Q4 2026, ahead of any new tenant onboarding at scale</td></tr>
            <tr><td className="border border-gray-300 p-2">DPDPA 2023 (India)</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Consent management, data-principal rights and deletion workflows. The user deletion cascade contract is the foundation this builds on. Target: Q1 2027</td></tr>
            <tr><td className="border border-gray-300 p-2">RBI Payment Regulations</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Payment aggregator guidelines and recurring mandate handling. Required before the fee gateway ships, so it moves with Phase 1</td></tr>
            <tr><td className="border border-gray-300 p-2">TRAI DLT (SMS)</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">DLT registration and template approval. Moves with the SMS channel in Phase 2</td></tr>
            <tr><td className="border border-gray-300 p-2">International Data Sovereignty</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Region-specific storage and GDPR for international schools. Not required by the current customer base. Target: when the first non-India tenant signs</td></tr>
            <tr><td className="border border-gray-300 p-2">ISO 27001</td><td className="border border-gray-300 p-2"><StatusBadge status="notbuilt" /></td><td className="border border-gray-300 p-2">Information security management system. Target: Q3 2027</td></tr>
          </tbody>
        </table>
      </section>

      {/* 7. ERP System Architecture Plan */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">7. ERP System Architecture Plan</h2>
        <p className="text-sm text-gray-700 mb-4">
          Every new module is architected the same way and integrated into the existing platform, following a standard 4-layer pattern. This is what keeps a dozen modules interoperable rather than a dozen small applications sharing a login.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">7.1 Current Architecture Foundation</h3>
        <pre className="bg-gray-50 p-4 rounded border border-gray-200 text-xs font-mono overflow-x-auto mb-4 whitespace-pre">{`
┌─────────────────────────────────────────────────────────────────┐
│                     SALCI ERP · FULL STACK                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              FRONTEND (React 18 + TypeScript)            │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │   │
│  │  │Exams │ │Attend│ │ Fees │ │  HR  │ │Notice│ │Suppt │  │   │
│  │  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘  │   │
│  │  ┌──▼────────▼────────▼────────▼────────▼────────▼───┐   │   │
│  │  │         TanStack Query (state + cache)            │   │   │
│  │  └──────────────────────┬────────────────────────────┘   │   │
│  │  ┌──────────────────────▼────────────────────────────┐   │   │
│  │  │        Supabase Client (@supabase/supabase-js)    │   │   │
│  │  └──────────────────────┬────────────────────────────┘   │   │
│  └─────────────────────────┼──────────────────────────────┘   │
│  ┌─────────────────────────▼──────────────────────────────┐   │
│  │               SUPABASE BACKEND (cloud)                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │ PostgreSQL  │  │    Auth     │  │  Edge Functions │  │   │
│  │  │   + RLS     │  │  (GoTrue)   │  │  (Deno runtime) │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │   Storage   │  │   Realtime  │  │ Cron (pg_cron)  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │  External: OpenAI, Gemini gateway, Resend, future  │ │   │
│  │  │            payment / SMS / maps providers          │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
`}</pre>

        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Technology</th>
              <th className="border border-gray-300 p-2 text-left">Role in the ERP</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">React 18 + TypeScript</td><td className="border border-gray-300 p-2">Module UI: pages, forms, dashboards, reports</td></tr>
            <tr><td className="border border-gray-300 p-2">Build tool</td><td className="border border-gray-300 p-2">Vite</td><td className="border border-gray-300 p-2">Code splitting and per-module lazy loading; the service-worker build-ID plugin</td></tr>
            <tr><td className="border border-gray-300 p-2">Styling</td><td className="border border-gray-300 p-2">Tailwind + shadcn/ui</td><td className="border border-gray-300 p-2">One design system, semantic tokens defined in both themes</td></tr>
            <tr><td className="border border-gray-300 p-2">State and cache</td><td className="border border-gray-300 p-2">TanStack Query v5</td><td className="border border-gray-300 p-2">Server state, explicit staleTime, targeted cache invalidation</td></tr>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">PostgreSQL (Supabase)</td><td className="border border-gray-300 p-2">All ERP data, tenant-isolated by institution_id and enforced by RLS</td></tr>
            <tr><td className="border border-gray-300 p-2">Auth</td><td className="border border-gray-300 p-2">Supabase Auth (GoTrue)</td><td className="border border-gray-300 p-2">Multi-role auth across admin, coordinator, teacher, student and staff</td></tr>
            <tr><td className="border border-gray-300 p-2">Server logic</td><td className="border border-gray-300 p-2">Edge Functions (Deno)</td><td className="border border-gray-300 p-2">Business rules, third-party calls, webhooks, cron passes</td></tr>
            <tr><td className="border border-gray-300 p-2">Storage</td><td className="border border-gray-300 p-2">Supabase Storage</td><td className="border border-gray-300 p-2">Documents, photos, answer sheets, submissions, attachments</td></tr>
            <tr><td className="border border-gray-300 p-2">Real-time</td><td className="border border-gray-300 p-2">Supabase Realtime</td><td className="border border-gray-300 p-2">Notifications, messaging, dashboard freshness signal</td></tr>
            <tr><td className="border border-gray-300 p-2">Routing</td><td className="border border-gray-300 p-2">React Router v6</td><td className="border border-gray-300 p-2">Role-guarded, feature-gated, lazy-loaded module routes</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">7.2 Standard Module Architecture Pattern</h3>
        <p className="text-sm text-gray-700 mb-3">Every new ERP module MUST be built in this order. Shipping a layer out of sequence is how a migration lands before the frontend that stops reading the old column.</p>
        <pre className="bg-gray-50 p-4 rounded border border-gray-200 text-xs font-mono overflow-x-auto mb-4 whitespace-pre">{`
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: DATABASE                                      │
│  ├── Tables, every one carrying institution_id          │
│  ├── RLS policies calling SECURITY DEFINER helpers      │
│  ├── An index for EVERY new foreign key, same migration │
│  ├── Transactional RPCs for any multi-write save        │
│  └── REVOKE EXECUTE FROM anon on every new DEFINER fn   │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: EDGE FUNCTIONS                                │
│  ├── Business logic and third-party API calls           │
│  ├── Webhooks, with signature verification              │
│  ├── Cron passes, all institution-timezone aware        │
│  └── Anything over 10s becomes an enqueue-and-poll job  │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: FRONTEND                                      │
│  ├── Pages under the right role directory, lazy-loaded  │
│  ├── Components on the shared primitives                │
│  ├── Hooks with explicit staleTime and bounded reads    │
│  ├── Error state BEFORE empty state, toastError always  │
│  └── Regenerated types, never hand-edited               │
├─────────────────────────────────────────────────────────┤
│  LAYER 4: INTEGRATION                                   │
│  ├── Feature gating: catalog entry + FEATURE_URL_MAP    │
│  ├── Audit logging on every destructive operation       │
│  ├── Notifications through the existing engine          │
│  └── Dashboard RPCs in all three scope variants         │
└─────────────────────────────────────────────────────────┘
`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">7.3 Module-Wise Architecture Plans</h3>

        <h4 className="text-md font-semibold text-gray-700 mb-2 mt-4">Admissions &amp; Enquiry Module</h4>
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Components</th>
              <th className="border border-gray-300 p-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">admission_enquiries, applications, application_documents, entrance_slots, offers</td><td className="border border-gray-300 p-2">Stage machine on the application; an accepted offer converts into a profile plus a class assignment in one transaction</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">enquiry-intake (public), offer-notify, application-to-student</td><td className="border border-gray-300 p-2">The public intake endpoint is the only unauthenticated surface and needs rate limiting from day one</td></tr>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">EnquiryInbox, ApplicationDetail, EntranceScheduler, OfferBoard</td><td className="border border-gray-300 p-2">Reuses the notice audience engine for follow-up communication</td></tr>
            <tr><td className="border border-gray-300 p-2">Integration</td><td className="border border-gray-300 p-2">Converts into Student Information; fees raised on enrolment</td><td className="border border-gray-300 p-2">Conversion must go through one RPC, never a client-side create-then-assign</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mb-2 mt-4">Payment Gateway Module</h4>
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Components</th>
              <th className="border border-gray-300 p-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">payment_transactions, refund_records, gateway_config, extending payment_records</td><td className="border border-gray-300 p-2">Immutable transaction log; no card data stored, tokenisation only. Store money in rupees and multiply at the gateway boundary only</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">payment-create-order, payment-webhook, refund-processor</td><td className="border border-gray-300 p-2">HMAC webhook verification; the webhook must be idempotent because gateways retry</td></tr>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">PaymentCheckout, TransactionHistory, RefundManager, ReceiptGenerator</td><td className="border border-gray-300 p-2">Automatic receipt PDF on settlement</td></tr>
            <tr><td className="border border-gray-300 p-2">Integration</td><td className="border border-gray-300 p-2">Fee installment, payment, receipt, then parent notification</td><td className="border border-gray-300 p-2">Links transactions to fee_installments; feeds the Command Center collection KPI</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mb-2 mt-4">Parent Portal Module</h4>
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Components</th>
              <th className="border border-gray-300 p-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">Extends parent_student_links; a parent role in the existing enum path</td><td className="border border-gray-300 p-2">A parent's reach is the union of their linked children and nothing else. This needs its own SECURITY DEFINER predicate, not a reused teacher one</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">parent-invite, absence-alert-pass</td><td className="border border-gray-300 p-2">The absence pass must run in institution-local time like every other cron</td></tr>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">ParentDashboard, ChildSwitcher, FeeCentre, PTMBooking</td><td className="border border-gray-300 p-2">The parent-first student dashboard is the starting point, narrowed to read-only</td></tr>
            <tr><td className="border border-gray-300 p-2">Integration</td><td className="border border-gray-300 p-2">Attendance, results, homework, fees, notices, PTM</td><td className="border border-gray-300 p-2">Every existing module gains a parent-visible read path, each one gated separately</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mb-2 mt-4">Library Module</h4>
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Components</th>
              <th className="border border-gray-300 p-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">books, book_copies, circulation_records, fines, reservations</td><td className="border border-gray-300 p-2">Full-text search on title and author; JSONB for catalog metadata</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">overdue-pass, isbn-lookup, fine-generator</td><td className="border border-gray-300 p-2">Daily overdue scan on pg_cron, in institution-local time</td></tr>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">BookCatalog, CirculationDesk, BarcodeScanner, FineManager</td><td className="border border-gray-300 p-2">The catalog list is the classic unbounded read: paginate it with range() from the first commit</td></tr>
            <tr><td className="border border-gray-300 p-2">Integration</td><td className="border border-gray-300 p-2">Ebook storage, overdue notices through the notice engine, fines into the fee module</td><td className="border border-gray-300 p-2">Its own storage bucket, private by default</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mb-2 mt-4">Transportation Module</h4>
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Components</th>
              <th className="border border-gray-300 p-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">transport_routes, vehicles, gps_pings, route_students, driver_profiles</td><td className="border border-gray-300 p-2">gps_pings is the one table here that will outgrow everything else: partition it by date and index the coordinates from the start</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">route-optimizer, gps-webhook, eta-calculator</td><td className="border border-gray-300 p-2">Maps provider integration; the ping webhook is high-frequency and must be cheap</td></tr>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">RouteMapView, VehicleList, LiveTracking, RouteBuilder</td><td className="border border-gray-300 p-2">One realtime channel for the whole tracking feature, never one per vehicle marker</td></tr>
            <tr><td className="border border-gray-300 p-2">Integration</td><td className="border border-gray-300 p-2">Parent arrival alerts; boarding can auto-mark attendance</td><td className="border border-gray-300 p-2">Depends on the parent portal for the alert half to be useful</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mb-2 mt-4">Payroll Automation</h4>
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Components</th>
              <th className="border border-gray-300 p-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">Extends payroll_runs and payroll_entries with payslips and statutory components</td><td className="border border-gray-300 p-2">Field-level encryption for salary data; audit triggers on every change</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">payroll-calculator, payslip-pdf, form16-generator</td><td className="border border-gray-300 p-2">A run over hundreds of employees exceeds 10 seconds, so it must be an enqueue-and-poll job, not a request</td></tr>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">PayrollDashboard, PayslipViewer, SalaryStructureEditor</td><td className="border border-gray-300 p-2">Strictly role-restricted views with an approval step before a run is finalised</td></tr>
            <tr><td className="border border-gray-300 p-2">Integration</td><td className="border border-gray-300 p-2">Staff attendance and leave feed deductions</td><td className="border border-gray-300 p-2">Both source tables already exist, which is what makes this tractable</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-6">7.4 Cross-Module Data Flow</h3>
        <pre className="bg-gray-50 p-4 rounded border border-gray-200 text-xs font-mono overflow-x-auto mb-4 whitespace-pre">{`
┌──────────────────────────────────────────────────────────────────────┐
│                 SALCI ERP · CROSS-MODULE DATA FLOW                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Enquiry ──► Application ──► Offer ──► Student Enrolment             │
│                                             │                        │
│  Student ──► Class Group ──► Timetable ──► Attendance ──► Leave      │
│     │                            │                                   │
│     │                            └──► Lesson Log ──► Syllabus Jar    │
│     │                                        │                       │
│     │                                        └──► Coverage + Flags   │
│     ├──► Fee Structure ──► Payment ──► Receipt                       │
│     ├──► Transport Route ──► GPS ──► Parent Alert        (planned)   │
│     └──► Library Card ──► Circulation ──► Fine           (planned)   │
│                                                                      │
│  Exam ──► Attempt ──► Grading ──► Final Results ──► Report Card      │
│              │                          │                            │
│              └──► Concept Mastery ──────┴──► Passport + Achievements │
│                                                                      │
│  Staff ──► Leave ──► Substitution ──► Timetable Update               │
│     └──► Attendance ──► Payroll Run                                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  NOTICE + MESSAGING ENGINE  ◄──── every module publishes here  │  │
│  │  audience expansion · materialised recipients · read receipts  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  DASHBOARD RPC LAYER        ◄──── every module reports here    │  │
│  │  dash_* · dash_scoped_* · dash_teacher_* · 20-flag evaluator   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  SUPPORT                    ◄──── any user, any module         │  │
│  │  ticket ──► thread ──► task ──► resolution ──► email           │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-6">7.5 Scaling &amp; Performance Strategy</h3>
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Area</th>
              <th className="border border-gray-300 p-2 text-left">Current state</th>
              <th className="border border-gray-300 p-2 text-left">Target</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Database</td><td className="border border-gray-300 p-2">Single Supabase instance, 183 tables, institution_id tenant isolation, 458 migrations</td><td className="border border-gray-300 p-2">Read replicas for analytics, partitioning for the high-volume tables the transport and communication modules will add, Supavisor transaction pooling</td></tr>
            <tr><td className="border border-gray-300 p-2">Frontend</td><td className="border border-gray-300 p-2">Route-based code splitting on all 120 routes, heavy libraries dynamically imported</td><td className="border border-gray-300 p-2">Hold under 500 KB per chunk and 1.5 MB entry as modules are added; per-module prefetch on hover</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">37 school-platform functions</td><td className="border border-gray-300 p-2">Queue-based processing with retry and dead-letter handling for payroll, campaigns and any run over 10 seconds</td></tr>
            <tr><td className="border border-gray-300 p-2">Aggregation</td><td className="border border-gray-300 p-2">79 dash_* RPCs compute every dashboard figure server-side</td><td className="border border-gray-300 p-2">Materialised snapshots plus a refresh cron, to replace the admin on-open kick that flag freshness currently depends on</td></tr>
            <tr><td className="border border-gray-300 p-2">Real-time</td><td className="border border-gray-300 p-2">One channel per feature</td><td className="border border-gray-300 p-2">Institution-scoped channels with presence and connection multiplexing when transport tracking lands</td></tr>
            <tr><td className="border border-gray-300 p-2">Storage</td><td className="border border-gray-300 p-2">16 buckets, private by default, size-limited where abuse is plausible</td><td className="border border-gray-300 p-2">Per-module buckets for new modules, plus an image optimisation pipeline at upload</td></tr>
            <tr><td className="border border-gray-300 p-2">Monitoring</td><td className="border border-gray-300 p-2">Supabase log triage, no APM</td><td className="border border-gray-300 p-2">Sentry error tracking, performance monitoring, alerting, and the k6 suite running in CI</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-6">7.6 Build Sequence</h3>
        <p className="text-sm text-gray-700 mb-3">Ordered by dependency and business impact. The first three are complete.</p>
        <div className="bg-gray-50 p-4 rounded border border-gray-200 text-sm mb-4">
          <ol className="list-decimal list-inside space-y-2">
            <li><strong>✅ Timetable &amp; Scheduling</strong>: COMPLETE. Nine tt_ and cal_ tables, four edge functions, role-based views, year rollover</li>
            <li><strong>✅ Homework &amp; Assignments</strong>: COMPLETE. Depends on the timetable for class and period linkage, reuses the AI evaluation engine</li>
            <li><strong>✅ Communication Engine</strong>: COMPLETE for in-app, push and email. The Notice Board audience engine is the hub every other module publishes through. External channels (SMS, WhatsApp) remain</li>
            <li><strong>Admissions &amp; Enquiry</strong>: no dependencies, feeds the whole student lifecycle. Start here</li>
            <li><strong>Payment Gateway</strong>: unblocks fee collection; the fee data model already exists</li>
            <li><strong>Parent Portal</strong>: unblocks absence alerts, fee notifications and PTM self-service, and makes the transport module worth building</li>
            <li><strong>Library</strong>: standalone, low inter-dependency, quick to demo</li>
            <li><strong>Payroll Automation</strong>: attendance, leave, structures and runs all exist; the calculation and payslip layer does not</li>
            <li><strong>Transportation</strong>: needs hardware and the parent portal to be worth the complexity</li>
          </ol>
        </div>
        <pre className="bg-gray-50 p-4 rounded border border-gray-200 text-xs font-mono overflow-x-auto mb-4 whitespace-pre">{`
BUILD DEPENDENCY GRAPH

  ✅ Timetable ────┬──► ✅ Homework
                    └──► Substitution ◄── ✅ Staff Leave

  Admissions ──► Student Enrolment ──► (everything downstream)

  Payment Gateway ──► Fee Collection ──► Defaulter Escalation
        │
        └──► Parent Portal ──┬──► Absence Alerts
                             ├──► Fee Notifications
                             └──► Transportation (parent alerts)

  Library (standalone) ──► Overdue Notices ──► ✅ Notice Engine

  Staff Attendance + Leave + Salary Structures ──► Payroll Automation

  ✅ Notice Engine ◄──── every module publishes notifications here
`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-6">7.7 High-Concurrency Hardening (target 3K to 5K concurrent, 10K ceiling)</h3>
        <p className="text-sm text-gray-700 mb-3">
          After the 2026-05-16 load incident, when MVP patterns collapsed at roughly 60 active users through per-call auth validation, retry amplification and IO exhaustion, this pattern set became a hard requirement gated at code review. It applies to every new query, hook, edge function, migration and RLS policy, with no exemption for a module being small, internal or urgent.
        </p>
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Area</th>
              <th className="border border-gray-300 p-2 text-left">Required pattern</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Auth</td><td className="border border-gray-300 p-2">Never call supabase.auth.getUser() without a JWT argument. Read from the local session; a containment monkey-patch backs 167 existing call sites and must not be removed</td></tr>
            <tr><td className="border border-gray-300 p-2">Queries</td><td className="border border-gray-300 p-2">Explicit column lists, no select(&quot;*&quot;) outside admin tooling. Aggregate server-side through an RPC or an embedded count; never pull rows to count them</td></tr>
            <tr><td className="border border-gray-300 p-2">Pagination</td><td className="border border-gray-300 p-2">Every unbounded list uses range(). PostgREST silently caps at 1000 rows, inside edge functions too, and a WHERE filter is not a bound</td></tr>
            <tr><td className="border border-gray-300 p-2">Schema and RLS</td><td className="border border-gray-300 p-2">An index for every new FK in the same migration; policies call SECURITY DEFINER helpers only; UPDATE policies carry both USING and WITH CHECK</td></tr>
            <tr><td className="border border-gray-300 p-2">Writes</td><td className="border border-gray-300 p-2">Mutations are idempotent. Two dependent writes are one RPC, never sequential client calls</td></tr>
            <tr><td className="border border-gray-300 p-2">React Query</td><td className="border border-gray-300 p-2">Explicit staleTime of at least 60s; refetchInterval under 30s forbidden without a justification comment; refetchOnWindowFocus false for heavy tables; every subscribing effect cleans up</td></tr>
            <tr><td className="border border-gray-300 p-2">Realtime</td><td className="border border-gray-300 p-2">One channel per feature, never per component</td></tr>
            <tr><td className="border border-gray-300 p-2">Bundle</td><td className="border border-gray-300 p-2">Under 500 KB per chunk and 1.5 MB entry; lazy-load every route and every heavy library</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions</td><td className="border border-gray-300 p-2">Anything over 10 seconds becomes an enqueue-and-poll job; paginate every database call inside them</td></tr>
            <tr><td className="border border-gray-300 p-2">Time</td><td className="border border-gray-300 p-2">Every wall-clock comparison uses (now() AT TIME ZONE i.timezone). A bare now() or CURRENT_DATE is a bug waiting for a non-UTC school</td></tr>
          </tbody>
        </table>
        <div className="bg-yellow-50 p-4 rounded border border-yellow-200 text-sm">
          <p className="font-semibold text-yellow-800 mb-1">Infra floor</p>
          <p className="text-gray-700">
            Medium compute minimum, Large at 1K and XL at 10K concurrent users, Supavisor transaction pooling, read replicas for analytics, Sentry error tracking, k6 load-test scripts in <code>scripts/loadtest/</code>, and rate limiting on expensive edge functions. Compute has not yet been raised to that floor, and it is the single largest open infrastructure item ahead of any scale event.
          </p>
        </div>
      </section>

      {/* Footer */}
      <div className="text-center pt-6 border-t-2 border-gray-300 text-sm text-gray-500">
        <p>SALCI ERP Roadmap v2.0 · Confidential Internal Document</p>
        <p>Last updated September 8, 2026</p>
      </div>
    </div>
  );
});

ERPRoadmapDocument.displayName = "ERPRoadmapDocument";

export default ERPRoadmapDocument;
