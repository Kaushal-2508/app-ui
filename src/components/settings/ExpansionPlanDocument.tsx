import { forwardRef } from "react";

const STATUS = {
  built: { label: "✅ Built", color: "text-green-700" },
  partial: { label: "🔶 Partial", color: "text-yellow-700" },
  planned: { label: "⬜ Planned", color: "text-gray-500" },
};

function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return <span className={`font-semibold ${s.color}`}>{s.label}</span>;
}

const ExpansionPlanDocument = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="bg-white text-black p-8 max-w-4xl mx-auto font-sans">
      {/* Header */}
      <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">SALCI Platform</h1>
        <p className="text-xl text-gray-600">Expansion Plan &amp; Feature Status</p>
        <p className="text-sm text-gray-500 mt-2">Version 1.6 | September 8, 2026</p>
        <p className="text-xs text-gray-500 mt-1">Scope: the SALCI school platform. The Olympiad campaign product is tracked separately and is out of scope for this document.</p>
      </div>

      {/* 1. Features Built */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">1. Features Built (Complete)</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.1 Core Platform</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Details</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Multi-tenant Architecture</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Full institution isolation, RLS-enforced on every scoped table</td></tr>
            <tr><td className="border border-gray-300 p-2">Role-based Access Control</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">7 roles: super_admin, super_school_admin, school_admin, coordinator, teacher, student, employee</td></tr>
            <tr><td className="border border-gray-300 p-2">Per-user Capability Overrides</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Four grants that raise one user's reach without a role change: tt_manager_overrides, staff_manager_overrides, syllabus_manager_overrides, student_manager_overrides, each with a matching is_*() helper</td></tr>
            <tr><td className="border border-gray-300 p-2">Admin + Teacher Dual Role</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">grant_teacher_role / revoke_teacher_role from Manage Administrators; the view switcher is presentation-only because every server gate is an admin-first OR-union (shipped 2026-09-05)</td></tr>
            <tr><td className="border border-gray-300 p-2">Authentication System</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Email, phone and admission-number login via resolve-login-identifier; password reset, forced first-login change; auth hoisted into one provider so navigation no longer flashes a skeleton</td></tr>
            <tr><td className="border border-gray-300 p-2">Institution Feature Gating</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">29 school modules, per-institution toggle, enforced in the sidebar, on dashboard tiles and at the route via FEATURE_URL_MAP + ProtectedRoute</td></tr>
            <tr><td className="border border-gray-300 p-2">Dark/Light Theme</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">HSL design tokens defined in both :root and .dark, user preference persisted</td></tr>
            <tr><td className="border border-gray-300 p-2">Push Notifications</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Web Push API + service worker, background delivery via send-web-push</td></tr>
            <tr><td className="border border-gray-300 p-2">Profile Photos</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Private user-avatars bucket + profiles.avatar_path, authority checked per request by can_set_user_photo / can_view_user_photo and a path-ownership trigger; camera or upload capture, HEIC-aware WebP pipeline, on-device 6-slot store purged on sign-out; rendered in Manage Users and the app chrome (shipped 2026-09-01)</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Profile Lockdown</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Students can no longer edit their own profile; the two writes they still need (clear_password_reset_flag, mark_onboarding_complete) run through column-scoped RPCs so the lockdown cannot trap a user mid-onboarding</td></tr>
            <tr><td className="border border-gray-300 p-2">Class Groups Container</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">"Class 10" sits above 10A/10B/10C; class_groups + classes.class_group_id, subject catalog and chapters shared at group level; writes go to subject_class_group_mappings and a SECURITY DEFINER trigger fans out to subject_class_mappings</td></tr>
            <tr><td className="border border-gray-300 p-2">Service Worker Build-ID Stamping</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">PWAs detect deploys via build-stamped sw.js + Vite plugin + main.tsx registration; reload is dirty-form aware</td></tr>
            <tr><td className="border border-gray-300 p-2">Error Translation Pipeline</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Central toastError / translateError maps Postgres codes (FK, RLS, unique) and edge-function error context to readable copy; error state renders before empty state</td></tr>
            <tr><td className="border border-gray-300 p-2">User Deletion Cascade Contract</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">admin-operations + DB cascade chain; ownership FKs CASCADE, authorship FKs SET NULL (migration 20260427120000)</td></tr>
            <tr><td className="border border-gray-300 p-2">Transactional Write Helpers</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Relationship saves diff inside one transaction and audit-log the delta instead of DELETE-then-INSERT: setStaffClassAssignments, setClassTeachers, deleteInstitutionSubject, set_student_class, review_student_leave, record_syllabus_progress, create_task_group, post_support_message</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.2 Examination System</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Details</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Exam Builder</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Multi-section, 7 question types, per-question and per-option diagrams, Create Duplicate on every exam card</td></tr>
            <tr><td className="border border-gray-300 p-2">Mobile-First Exam Creation Flow</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Touch-friendly Details / Questions / Review wizard with a clickable step indicator; drafts resume at the right step with subject, chapters and section plan intact</td></tr>
            <tr><td className="border border-gray-300 p-2">Review Step Paper Check</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">The review step renders the full paper through the shared renderer (images included) and blocks a publish that would ship a broken paper (2026-09-04)</td></tr>
            <tr><td className="border border-gray-300 p-2">AI Question Generation</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">gpt-5-mini at medium reasoning effort with subject-based cost routing (Maths and the science family reach the reasoning model, the rest use the basic model); per-user daily quota via user_question_limits; grade resolves from the chapter so early years is calibrated rather than "General"</td></tr>
            <tr><td className="border border-gray-300 p-2">KaTeX Math Authoring</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Dollar-delimited LaTeX end to end; repairLatexEscapes() runs before JSON.parse; MathLive WYSIWYG builder on every manual-entry form and on each MCQ option</td></tr>
            <tr><td className="border border-gray-300 p-2">Online Exam Taking</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Server-authoritative timer, section navigation, auto-submit, flagging, late-entry window (exams.late_entry_minutes), back-button attempt reset closed</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam Integrity Ladder</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Tab switches and fullscreen exits share one 4-strike ladder (2 warnings, a 15s pause, auto-submit on the fourth); iOS and macOS Safari are exempt from the fullscreen lock because it throws synchronously there</td></tr>
            <tr><td className="border border-gray-300 p-2">AI Auto-Grading</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Confidence scores, keyword matching, teacher review; handles both exam_questions.options shapes (legacy map and array)</td></tr>
            <tr><td className="border border-gray-300 p-2">Manual Evaluation</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Override AI, per-question marking, written and voice-dictated feedback</td></tr>
            <tr><td className="border border-gray-300 p-2">Hybrid Exams</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">hybrid_* is a separate data plane from student_exam_attempts / final_results; the phone companion is unauthenticated and the pairing token is the auth; marking is a guided one-question-at-a-time flow with a CBSE-style marks stamp, per-question accordion and aspect-correct annotations, and it works on a phone</td></tr>
            <tr><td className="border border-gray-300 p-2">Results-Only (Already-Created) Exams</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">exams.is_results_only + source_paper_files; two distinct offline-marks pipelines (offline_student_marks and offline_section_marks) keep separate query keys and never cross</td></tr>
            <tr><td className="border border-gray-300 p-2">Offline Marks Lifecycle</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Explicit Absent state, roll or admission identity, one roster order; marks stay editable after results publish; publish no longer silently un-publishes</td></tr>
            <tr><td className="border border-gray-300 p-2">OCR Offline Exams</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Scan upload, digitize, auto-grade pipeline via process-ocr-upload</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam Publication Flow</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Draft, Published, Active, Completed lifecycle; prevent_invalid_exam_publish trigger with blueprint auto-fill in useSaveExam / useUpdateExam</td></tr>
            <tr><td className="border border-gray-300 p-2">Optional-Subject Exam Delivery</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">An optional-subject exam only reaches the students who take that subject, and the offline-marks roster respects the same enrollment</td></tr>
            <tr><td className="border border-gray-300 p-2">Negative Marking &amp; Blueprints</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Per-section and per-question negative marks; marking schemes, AI confidence thresholds and keywords in evaluation_blueprints</td></tr>
            <tr><td className="border border-gray-300 p-2">Question Bank</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">question_bank.class_group_id + optional question_bank_section_scope rows (zero rows = class-wide); recent-first ordering on covering indexes; RLS via three SECURITY DEFINER helpers to avoid 42P17 recursion</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam Templates</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Reusable section and blueprint structures in exam_templates</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.2b Timetable, Calendar &amp; Syllabus Delivery</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Details</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Timetable &amp; Lesson Planning</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Period structures, shared resources, class workspace, substitute mode, lesson planning, teacher and student week views, academic calendar, academic-year rollover; fully on tt_* / cal_* after seven legacy tables were dropped; edge fns copy-timetable-template, tt-notify-substitute, tt-notify-absence-pending, get-working-days</td></tr>
            <tr><td className="border border-gray-300 p-2">Editable Period Structure &amp; "Other" Slots</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Period structures are editable after creation; an "Other" slot type carries a custom_label that renders in the grid, the print view and teacher My Week, and survives year rollover</td></tr>
            <tr><td className="border border-gray-300 p-2">Two-Timeline Syllabus</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Chapter-based syllabus_progress_events (the actual "jar") plus an auto projection over syllabus_sequence; one write path, record_syllabus_progress; non-blocking check-in backlog, corrections mode, projected and actual chapter lines on teacher and student week grids, SY1 escalation flag</td></tr>
            <tr><td className="border border-gray-300 p-2">Note-Only Lesson Logs</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">A chapterless period (surprise test, activity) logs through tt_record_period_note with is_note_only=true, reads as Logged on the week chips, resolves the day for check-out and SY1, and is hidden from students (shipped 2026-09-02)</td></tr>
            <tr><td className="border border-gray-300 p-2">Lesson Plan Export</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Coordinator and admin Excel export of lesson delivery through two read-only SECURITY DEFINER RPCs scoped by tt_user_can_edit_class_slots, with cascading faceted filters</td></tr>
            <tr><td className="border border-gray-300 p-2">Syllabus Segmentation (Parts)</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Named parts such as PA1 or Term 1 scoped to class_group + subject (syllabus_segments, syllabus_segment_chapters); feature flag syllabus_segmentation, off by default</td></tr>
            <tr><td className="border border-gray-300 p-2">Chapter Hierarchy &amp; Ordering</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Chapter and topic tree with CSV import and custom chapters; drag-to-reorder behind a press-and-hold, plus per-user personal ordering in user_topic_orders merged into the read path</td></tr>
            <tr><td className="border border-gray-300 p-2">Study Materials</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Redesigned student Study Materials page; PDFs open directly from Syllabus Parts</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.3 School Administration</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Details</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">User Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">CRUD, bulk import (CSV/Excel) with a skipped-row count, role assignment, photos in the list and detail sheets</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Records</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Editable Student Details with roll and admission uniqueness validation, roster search by admission number, class to section to roll-number picker with batch save and duplicate detection, labelled Bulk Actions menu; coordinators and teachers get the same edit surface narrowed to their own scope</td></tr>
            <tr><td className="border border-gray-300 p-2">Canonical Student Roster</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">institution_student_ids() is the single student-count definition, so profile-based and class-based counts can no longer disagree</td></tr>
            <tr><td className="border border-gray-300 p-2">Class Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Create and edit classes and sections, assign teachers and students; class moves run through the set_student_class RPC with authority checked at both ends</td></tr>
            <tr><td className="border border-gray-300 p-2">Staff Assignment Safety</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Class-assignment writes are atomic, audited and recoverable; removals are named before they happen and the delta lands in class_assignment_deletions, which has no FKs so it survives cascades</td></tr>
            <tr><td className="border border-gray-300 p-2">Subject Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Universal subject catalog with per-institution mapping; edit and delete through deleteInstitutionSubject / unassignSubjectFromClass with audit logging and named blockers</td></tr>
            <tr><td className="border border-gray-300 p-2">Optional Subjects</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Optional Groups are the single enrollment workflow (optional_groups, optional_group_subjects, student_optional_enrollments) with per-student choice and timetable band slots; every narrowing filter is gated behind optional_choices_recorded() so it stays dormant until a section actually records choices; the main/optional classification was retired 2026-08-06</td></tr>
            <tr><td className="border border-gray-300 p-2">Wing System</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Group classes into wings and assign coordinators (wing_assignments × wing_class_mappings, helper is_coordinator_for_class)</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Attendance</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Session-based marking with code verification and biometric support; a student-facing calendar tab; date navigation and a 2-day edit window on the class marker; auto-mark runs in institution-local time via tt_run_attendance_pass_for_institution</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Leave Workflow</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Students apply and track leave; staff approve or reject through review_student_leave, the only decision write path, which retroactively corrects attendance and notifies; teachers can also mark leave directly, and "late" was removed from the student plane entirely</td></tr>
            <tr><td className="border border-gray-300 p-2">Staff Attendance</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Teacher and coordinator attendance merged into one Staff Attendance tab with clickable roster rows and a Reports tab scoped to the viewer's own classes</td></tr>
            <tr><td className="border border-gray-300 p-2">Attendance Reports &amp; Export</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Server-side pivot RPCs with Prev/Next pagination; styled multi-sheet .xlsx export with an overview Summary tab per class and an At-Risk Watchlist</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Activity Export</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Admin-gated summary and event-log RPCs over student_activity_daily, exported as a two-sheet workbook with an overview tab and per-class detail tabs; day bucketing is institution-local</td></tr>
            <tr><td className="border border-gray-300 p-2">Homework &amp; Assignments</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Multi-subject assignments (homework_* tables), student submission with files, marking roster ordered by roll number, publish gate, auto-check cron, delete at any status, student feed; edge fns submit-homework, homework-file-url, homework-notify-pass</td></tr>
            <tr><td className="border border-gray-300 p-2">Fee Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Fee structures, installments, concessions, receipts, payment tracking and reminders</td></tr>
            <tr><td className="border border-gray-300 p-2">HR &amp; Payroll</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Staff directory, documents, salary structures and assignments, payroll runs, staff leave requests and balances</td></tr>
            <tr><td className="border border-gray-300 p-2">Appointments &amp; PTM</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Schedule, approve and manage parent-teacher meetings (ptm_schedules, ptm_bookings)</td></tr>
            <tr><td className="border border-gray-300 p-2">Task Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Create, assign, track with evidence and comments; multi-assignee is a fan-out of N task rows sharing task_group_id, written by create_task_group in one transaction; more than one supervisor per task; delete and cancel; auto-created tasks are always attributed to "SALCI System"</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Promotion</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Batch promote students into the next academic year</td></tr>
            <tr><td className="border border-gray-300 p-2">Institution Wizard</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Guided institution creation with streams, class groups, sections and feature selection; pre-primary grades resolve correctly (their grade_number values are negative and a stream's grade_number is a sequence number, not a grade)</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.4 Intelligence &amp; Analytics</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Details</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Command Center (Admin)</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">/school/command-center rebuilt to the blueprint: bento overview, hero-toned tiles, a KPI strip matching the portal StatTile, an insights digest derived in SQL, per-card class and wing filters, a date-ranged exam trend, and a clickable class-performance ranking with load-more</td></tr>
            <tr><td className="border border-gray-300 p-2">Scoped Snapshot (Coordinator &amp; Teacher)</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">/school/snapshot reuses the Command Center components through DashboardScope; a real wing dashboard for coordinators and a subject-scoped one for teachers, backed by parallel dash_*, dash_scoped_* and dash_teacher_* RPC families (teacher scope resolves via dash_resolve_teacher_pairs, never the admin-first ladder)</td></tr>
            <tr><td className="border border-gray-300 p-2">Flag Evaluator</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">A 20-flag evaluator writes dashboard_flags and can auto-create tasks; freshness comes from the admin on-open kick, there is no cron</td></tr>
            <tr><td className="border border-gray-300 p-2">Syllabus Coverage Analytics</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Coverage dashboards for admin, coordinator and teacher; the teacher scope is derived from tt_slots</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam Insights (AI)</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Strengths, weaknesses and study tips per student</td></tr>
            <tr><td className="border border-gray-300 p-2">Principal AI Insights</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">School-wide analysis reading live snapshots with a per-grade heatmap</td></tr>
            <tr><td className="border border-gray-300 p-2">School Analytics</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Server-side RPC aggregation (the previous URL-bomb client query returned zeros at scale)</td></tr>
            <tr><td className="border border-gray-300 p-2">Learning Passport</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Concept mastery tracked across exams (concept_mastery, student_passport, passport_* tables)</td></tr>
            <tr><td className="border border-gray-300 p-2">Class Aggregates</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Average scores, toppers, subject breakdowns via compute-aggregates</td></tr>
            <tr><td className="border border-gray-300 p-2">Performance Predictions</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">AI forecasting of future performance (the student-facing tab is currently dormant)</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Portal Consolidation</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Two surfaces only, a single-scroll parent-first Dashboard and My Results; the separate Reports destination and dead dashboards were retired; class comparison and subject trajectory come from three SECURITY DEFINER RPCs</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Exam Detail &amp; Chapter Analysis</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Per-exam page with teacher remarks, section breakdown and PDF; chapter-wise analysis chart with wrapped axis labels; a clickable performance-overview chart</td></tr>
            <tr><td className="border border-gray-300 p-2">Student Report (PDF)</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Rebuilt downloadable report with packed pages, correct page breaks and the restrained SALCI palette; the silent result loss in the old builder is fixed</td></tr>
            <tr><td className="border border-gray-300 p-2">Achievements &amp; Gamification</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Player Card achievements page with a tri-colour hero row, a streak spine and grouped explanations of how each badge was earned; server-side leaderboard with "where am I"; ladders now cover classroom, lesson planning, syllabus completion, assessment, marking and teamwork, and the teacher ladder is open to coordinators</td></tr>
            <tr><td className="border border-gray-300 p-2">Staff View of a Student</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Authorised staff see the student's actual dashboard and the real student report, gated per RPC rather than reconstructed client-side</td></tr>
            <tr><td className="border border-gray-300 p-2">AI Mascot Chat</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Learning-support chatbot for students</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.5 Platform Administration</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Details</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Institution Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Create, edit, and toggle features per institution</td></tr>
            <tr><td className="border border-gray-300 p-2">API Key Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">OpenAI, Gemini and OCR keys with enable/disable</td></tr>
            <tr><td className="border border-gray-300 p-2">AI Quota Management</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Per-institution daily and monthly limits, plus a per-user daily question cap</td></tr>
            <tr><td className="border border-gray-300 p-2">Employee Level System</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Tiered employee access with permissions</td></tr>
            <tr><td className="border border-gray-300 p-2">Living Documentation</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Seven in-app super-admin documents (PRD, Architecture, System Maps, Expansion Plan, ERP Roadmap, Builder Guide, Command Center Guide) with text-PDF export</td></tr>
            <tr><td className="border border-gray-300 p-2">Audit &amp; Activity Logs</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">system_audit_logs, user_activity_log, task_audit_logs, ai_config_changes; the user activity feed federates nine source tables</td></tr>
            <tr><td className="border border-gray-300 p-2">Search Visibility Control</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">The app portal is deliberately noindex/nofollow so the marketing site ranks instead</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">1.6 Communication, Notices &amp; Support</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Details</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Notice Board</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Replaces circulars. Hierarchy-scoped notices with multi-target junctions (notice_target_classes, notice_target_wings), audience expansion into materialised notice_recipients, publish_notice, audience preview, read receipts, inbox and outbox feeds, reach rollup, private notice-attachments bucket, and RLS that closed the class-notice leak so a teacher's class notice cannot reach co-teachers. Feature flag notice_board (shipped 2026-08-22)</td></tr>
            <tr><td className="border border-gray-300 p-2">Messaging</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">Direct, group and class-wide conversations; Bulk Send was rebuilt as a Messages tab on the notice audience engine and now sends real direct messages rather than one group thread</td></tr>
            <tr><td className="border border-gray-300 p-2">Salci Support</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">One /support door for every authenticated role with tabs, unread dots and a threaded conversation; reported_issues + support_messages with a guarded internal-note channel; every write goes through post_support_message or _support_apply_status, and every support RPC has PUBLIC and anon EXECUTE revoked; support tickets become real tasks and the task panel links back into the thread; the SALCI-side inbox at /admin/issues adds an awaiting-SALCI filter and ticket deep links; support-notify-email emails the reporter on each status change behind an origin allowlist (shipped 2026-08-31 to 2026-09-02)</td></tr>
            <tr><td className="border border-gray-300 p-2">Broadcast &amp; Transactional Email</td><td className="border border-gray-300 p-2"><StatusBadge status="built" /></td><td className="border border-gray-300 p-2">broadcast-email, send-communication, send-welcome-email, send-fee-reminder, send-task-notifications</td></tr>
          </tbody>
        </table>
      </section>

      {/* 2. Features Partially Built */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">2. Features Partially Built</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">What's Missing</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Online Proctoring</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">Tab-switch detection, the violation ladder and hybrid camera proctoring are live; screen recording and AI behaviour analysis are not implemented</td></tr>
            <tr><td className="border border-gray-300 p-2">Two-Factor Auth</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">UI toggle exists; TOTP/SMS implementation pending</td></tr>
            <tr><td className="border border-gray-300 p-2">Communication Templates</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">The Templates tab was removed from the admin Communication page on 2026-09-07; the communication_templates table and data remain, with no send path wired to them</td></tr>
            <tr><td className="border border-gray-300 p-2">Biometric Attendance</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">Data model + mark-biometric-attendance edge function built; hardware device integration pending</td></tr>
            <tr><td className="border border-gray-300 p-2">Face Recognition Attendance</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">face-api.js loaded and face_enrollments modelled; real-time matching is not production-ready</td></tr>
            <tr><td className="border border-gray-300 p-2">Payment Gateway (School Fees)</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">Fee structures, installments, concessions and receipts are modelled and tracked; there is no live gateway auto-charge or reconciliation for school fees</td></tr>
            <tr><td className="border border-gray-300 p-2">Recheck Requests</td><td className="border border-gray-300 p-2"><StatusBadge status="partial" /></td><td className="border border-gray-300 p-2">recheck_requests modelled with an admin surface; the student-side request-to-resolution loop is thin</td></tr>
          </tbody>
        </table>
      </section>

      {/* 3. Features Planned */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">3. Features Planned (Not Built)</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Feature</th><th className="border border-gray-300 p-2 text-left">Status</th><th className="border border-gray-300 p-2 text-left">Description</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Admissions &amp; Enquiry</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Enquiry capture, application, entrance scheduling and offer-to-enrolment conversion (top ERP gap)</td></tr>
            <tr><td className="border border-gray-300 p-2">Parent Portal</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Dedicated parent role with a child-monitoring dashboard; parent_student_links already exists</td></tr>
            <tr><td className="border border-gray-300 p-2">Library Management</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Book catalog, issue and return tracking, fines</td></tr>
            <tr><td className="border border-gray-300 p-2">Transport Management</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Route management, stop allocation, bus tracking, alerts</td></tr>
            <tr><td className="border border-gray-300 p-2">Inventory &amp; Assets</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Stores, issue registers, asset tagging and depreciation</td></tr>
            <tr><td className="border border-gray-300 p-2">Hostel Management</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Room allocation, mess, in and out register, warden workflows</td></tr>
            <tr><td className="border border-gray-300 p-2">Mobile App (Capacitor)</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Native iOS and Android app for every role, wrapping this web build in a Capacitor shell (design: docs/superpowers/specs/2026-09-16-native-app-capacitor-design.md)</td></tr>
            <tr><td className="border border-gray-300 p-2">White-Label Branding</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Custom domain, logo and colours per institution</td></tr>
            <tr><td className="border border-gray-300 p-2">LMS Integration</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Google Classroom, Moodle and Canvas integration</td></tr>
            <tr><td className="border border-gray-300 p-2">Video Lectures</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Video hosting, live classes, recording</td></tr>
            <tr><td className="border border-gray-300 p-2">Advanced Proctoring</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Screen capture and AI cheating detection on top of the existing ladder</td></tr>
            <tr><td className="border border-gray-300 p-2">Multi-language UI</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">i18n for Hindi and regional languages</td></tr>
            <tr><td className="border border-gray-300 p-2">SMS/WhatsApp Notifications</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Twilio or WhatsApp Business API on top of the notice audience engine</td></tr>
            <tr><td className="border border-gray-300 p-2">Data Export &amp; Compliance</td><td className="border border-gray-300 p-2"><StatusBadge status="planned" /></td><td className="border border-gray-300 p-2">Subject-access data export and audit compliance reporting</td></tr>
          </tbody>
        </table>
      </section>

      {/* 4. Scaling Strategy */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">4. Scaling Strategy</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.1 Current Architecture Scalability</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-4">
          <li><strong>Database</strong>: Supabase managed PostgreSQL, auto-scales with plan tier</li>
          <li><strong>Edge Functions</strong>: serverless Deno, scales per invocation</li>
          <li><strong>Frontend</strong>: static Vite build, CDN-distributed; two production frontends share one Supabase project, so shared code must never hardcode a single domain</li>
          <li><strong>RLS</strong>: all data access is institution-scoped, which gives natural multi-tenant isolation</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.2 Bottleneck Mitigation</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Bottleneck</th><th className="border border-gray-300 p-2 text-left">Current Mitigation</th><th className="border border-gray-300 p-2 text-left">Future Plan</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">AI API Rate Limits</td><td className="border border-gray-300 p-2">Per-institution quotas, per-user daily caps, subject-based cost routing to a cheaper model</td><td className="border border-gray-300 p-2">Queue system, retry with backoff</td></tr>
            <tr><td className="border border-gray-300 p-2">Large Exam Loads</td><td className="border border-gray-300 p-2">Class aggregates computed post-hoc, server-authoritative timer, server-side aggregation RPCs</td><td className="border border-gray-300 p-2">Background job processing for anything over 10s</td></tr>
            <tr><td className="border border-gray-300 p-2">Storage Growth</td><td className="border border-gray-300 p-2">Per-bucket policies and size limits (question-images is capped), private buckets read through signed URLs</td><td className="border border-gray-300 p-2">CDN caching, image compression at upload</td></tr>
            <tr><td className="border border-gray-300 p-2">Concurrent Users</td><td className="border border-gray-300 p-2">React Query caching with explicit staleTime, paginated reads, on-device avatar cache</td><td className="border border-gray-300 p-2">Connection pooling, read replicas</td></tr>
            <tr><td className="border border-gray-300 p-2">Dashboard Fan-out</td><td className="border border-gray-300 p-2">Every dashboard number comes from a dash_* RPC rather than client-side counting</td><td className="border border-gray-300 p-2">Materialised snapshots plus a refresh cron to replace the on-open kick</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.2b High-Concurrency Hardening (post 2026-05-16 incident)</h3>
        <p className="text-gray-700 mb-2 text-sm">After MVP patterns collapsed at roughly 60 active users, the codebase adopted a hard, code-review-gated pattern set targeting 3,000 to 5,000 concurrent users with a 10,000 design ceiling. The rules are enforced by an always-on repo rule that force-triggers a Scale Gate before any data-access code ships:</p>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-2 text-sm">
          <li><code>supabase.auth.getUser()</code> is monkey-patched to read the local session (167 call sites), so there is no per-call auth validation storm; new code reads from the session directly</li>
          <li>Explicit column lists, no <code>select('*')</code>; paginate with <code>range()</code> because PostgREST silently caps at 1000 rows, inside edge functions too. A WHERE filter is not a bound</li>
          <li>Aggregate server-side through an RPC, an embedded <code>count()</code> or <code>{"{ count, head: true }"}</code>; never fetch rows to count them</li>
          <li>Every new FK gets an index in the same migration; RLS policies call SECURITY DEFINER helpers only (inline cross-table EXISTS causes 42P17 recursion) and wrap stable per-row calls as <code>(select auth.uid())</code></li>
          <li>React Query: explicit <code>staleTime</code> of at least 60s, <code>refetchInterval</code> under 30s forbidden without a justification comment, <code>refetchOnWindowFocus:false</code> for heavy tables</li>
          <li>Mutations are idempotent: a single-flight guard, an upsert or ON CONFLICT, or a unique constraint handled gracefully. Two dependent writes are one RPC, never sequential client calls</li>
          <li>Bundle under 500 KB per chunk and 1.5 MB entry; lazy-load every route and every heavy library (XLSX, jsPDF, KaTeX, recharts, pdfjs, exceljs)</li>
          <li>One realtime channel per feature, never per component; edge functions over 10s become background jobs (enqueue, return an id, poll)</li>
        </ul>
        <p className="text-gray-700 mb-4 text-sm"><strong>Infra floor:</strong> Medium compute minimum (Large at 1K, XL at 10K concurrent), Supavisor transaction pooling, read replicas for analytics, Sentry, k6 scripts in <code>scripts/loadtest/</code>, rate limiting on expensive edge functions. Compute has not yet been raised to that floor, which remains the single largest open infrastructure item.</p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.2c Time and Timezone Correctness</h3>
        <p className="text-gray-700 mb-4 text-sm"><code>institutions.timezone</code> (default Asia/Kolkata) is the single source of truth. Any database code comparing wall-clock columns or computing "today" uses <code>(now() AT TIME ZONE i.timezone)</code>. A bare <code>now()::time</code> or <code>CURRENT_DATE</code> reintroduces the 2026-05-25 bug that left attendance auto-mark dead for every IST school until 13:30 local time. Every <code>dash_*</code> RPC follows this pattern.</p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.3 Multi-Tenancy Expansion</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-4">
          <li>Institution isolation via an <code>institution_id</code> FK on every scoped table</li>
          <li>Feature gating allows a customised module set per institution</li>
          <li>Each institution has independent admin, quota, timezone and feature configuration</li>
          <li>Super admin can enter any institution's context</li>
        </ul>
      </section>

      {/* 5. Roadmap */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">5. Development Roadmap</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Phase</th><th className="border border-gray-300 p-2 text-left">Timeline</th><th className="border border-gray-300 p-2 text-left">Scope</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2 font-semibold">Phase 1 (Complete)</td><td className="border border-gray-300 p-2">Q1 2026</td><td className="border border-gray-300 p-2">Core platform, exams, AI evaluation, school administration, feature gating, timetable and lesson planning</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Phase 2 (Complete)</td><td className="border border-gray-300 p-2">Q2 2026</td><td className="border border-gray-300 p-2">Homework module, hybrid and results-only exams, Command Center and scoped snapshot, class groups, high-concurrency hardening, student portal consolidation</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Phase 3 (Complete)</td><td className="border border-gray-300 p-2">Q3 2026</td><td className="border border-gray-300 p-2">Two-timeline syllabus and note-only logs, optional groups, student leave and the removal of "late", attendance and activity reporting, Notice Board and messaging rebuild, Salci Support end to end, profile photos and the student profile lockdown, teacher subject-scoped authority, admin dashboard rebuild to blueprint, achievements expansion</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Phase 4 (Current)</td><td className="border border-gray-300 p-2">Q4 2026</td><td className="border border-gray-300 p-2">School ERP build-out, running on two long-lived branches since 2026-09-07 (tushar-erp full stack, naman-erp frontend only) and merged centrally. Priority order: Admissions and Enquiry, Parent Portal, Library, Transport, Inventory and Assets, Hostel. See the ERP Roadmap document for module-level status</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Phase 5</td><td className="border border-gray-300 p-2">2027</td><td className="border border-gray-300 p-2">Native mobile app, LMS integrations, white-labeling, video lectures, multi-language, compliance reporting</td></tr>
          </tbody>
        </table>
      </section>

      {/* 6. Summary Stats */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">6. Platform Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-green-700">88</div>
            <div className="text-sm text-green-600">Features Built</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-yellow-700">7</div>
            <div className="text-sm text-yellow-600">Partially Built</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-gray-700">14</div>
            <div className="text-sm text-gray-600">Planned Features</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-blue-700">37</div>
            <div className="text-sm text-blue-600">Edge Functions</div>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3 text-center">Counts cover the SALCI school platform only. 183 tables, 3 views, 260 database functions, 458 migrations, 97 pages and 29 gateable modules, all excluding the Olympiad subsystem that also lives in this repository.</p>
      </section>

      {/* Footer */}
      <div className="text-center text-sm text-gray-500 mt-12 pt-6 border-t border-gray-300">
        <p>SALCI Platform · Expansion Plan v1.6</p>
        <p>Last updated September 8, 2026 | Confidential</p>
      </div>
    </div>
  );
});

ExpansionPlanDocument.displayName = "ExpansionPlanDocument";

export default ExpansionPlanDocument;
