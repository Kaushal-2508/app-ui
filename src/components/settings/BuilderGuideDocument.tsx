import { forwardRef } from "react";

const BuilderGuideDocument = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="bg-white text-gray-900 p-8 max-w-[210mm] mx-auto" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {/* Header */}
      <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">SALCI ERP · Builder Guide</h1>
        <p className="text-lg text-gray-600">Step-by-Step Technical Build Manual for Unbuilt Modules</p>
        <div className="flex justify-center gap-6 mt-4 text-sm text-gray-500">
          <span>Version 3.0</span>
          <span>|</span>
          <span>September 8, 2026</span>
          <span>|</span>
          <span>Audience: Super Admin / Dev Team</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">Scope: the SALCI school ERP. The Olympiad subsystem is out of scope for this guide.</p>
      </div>

      {/* Table of Contents */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">Table of Contents</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
          <li>Introduction &amp; How to Use This Guide (incl. Recently Shipped callout)</li>
          <li>Phase 1: Academic Management, Homework &amp; Timetable (✅ both shipped)</li>
          <li>Phase 2: Fee &amp; Payment Gateway (⬜ not built)</li>
          <li>Phase 3: Communication Engine (🔶 in-app, push and email shipped; SMS and WhatsApp remain)</li>
          <li>Phase 4: HR &amp; Payroll Completion (🔶 leave and staff attendance shipped; payroll computation remains)</li>
          <li>Phase 5: Transportation Management</li>
          <li>Phase 6: Library Management</li>
          <li>Phase 7: Student Information Completion</li>
          <li>Phase 8: Security & Compliance</li>
          <li>Phase 9: Mobile & Expansion</li>
          <li>Pre-Launch Checklist</li>
        </ol>
      </section>

      {/* 1. Introduction */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">1. Introduction</h2>
        <p className="text-sm text-gray-700 mb-3">
          This guide covers <strong>the features and modules not yet built</strong> in the SALCI ERP platform. Each phase gives the database tables, edge functions, frontend components and verification steps needed to ship that module, in dependency order. <strong>Note (September 2026):</strong> a large number of phases originally listed here have since shipped. Read the callout below before treating any section as work-to-do.
        </p>

        <div className="bg-amber-50 border-2 border-amber-300 rounded p-4 text-sm text-amber-900 mb-4">
          <strong className="text-base">⚠ Already Shipped, No Longer In Scope</strong>
          <p className="mt-1 mb-2">These were unbuilt when the guide was first written and are now <strong>in production</strong>. Do not rebuild them from this guide. Consult the linked module skill for current invariants instead:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Homework &amp; Assignments</strong> (2026-06-02): <code>homework_*</code> tables, marking and publish gates, student feed. See <code>homework-module</code>. <em>(Phase 1.1 below is superseded.)</em></li>
            <li><strong>Timetable &amp; Calendar</strong>: <code>tt_*</code> and <code>cal_*</code> schema; seven legacy tables dropped. See <code>timetable-module</code>. <em>(Phase 1.2 below is superseded.)</em></li>
            <li><strong>Command Center + Scoped Snapshot</strong>: rebuilt to the principal-first blueprint through August 2026. Three RPC families, <code>dash_*</code>, <code>dash_scoped_*</code> and <code>dash_teacher_*</code>. See <code>command-center-dashboards</code>.</li>
            <li><strong>Optional Subjects</strong>: Optional Groups is now the single enrollment workflow (<code>optional_groups</code>, <code>optional_group_subjects</code>, <code>student_optional_enrollments</code>), with a dormancy gate. The batches plane is superseded. See <code>optional-subjects</code>.</li>
            <li><strong>Hybrid &amp; Results-Only Exams</strong>: <code>hybrid_*</code> separate data plane, phone companion paired by token, results-only upload. See <code>hybrid-and-offline-exams</code>.</li>
            <li><strong>Notice Board &amp; Messaging</strong> (2026-08-22): hierarchy-scoped notices with a materialised audience, read receipts and reach rollup; Bulk Send rebuilt on the same engine. <em>(Phase 3 below is now only about the external SMS and WhatsApp channels.)</em></li>
            <li><strong>Salci Support</strong> (2026-08-31 to 09-02): <code>reported_issues</code> + <code>support_messages</code>, two single write paths, ticket-to-task, reporter email. See <code>support-module</code>.</li>
            <li><strong>Profile Photos &amp; Student Profile Lockdown</strong> (2026-09-01): private <code>user-avatars</code> bucket, per-request authority, on-device cache; students can no longer edit their own profile. See <code>profile-photos</code>.</li>
            <li><strong>Student Leave &amp; the removal of "late"</strong> (2026-07-07): <code>leave_requests</code> with <code>review_student_leave</code> as the only decision path; teacher-marked leave followed on 2026-09-04.</li>
            <li><strong>Staff Leave &amp; Staff Attendance</strong>: <code>staff_leave_requests</code>, <code>staff_leave_balances</code> and one merged Staff Attendance tab with reports. <em>(Phase 4's leave-management half is superseded.)</em></li>
            <li><strong>Two-Timeline Syllabus &amp; Note-Only Logs</strong> (2026-07 to 09): the actual jar plus an automatic projection, one write RPC, and a chapterless note escape.</li>
            <li><strong>Attendance &amp; Activity Reporting</strong> (2026-07): server-side pivot RPCs, paginated tables and styled multi-sheet exports.</li>
            <li><strong>Achievements</strong>: badge ladders across classroom, lesson planning, syllabus completion, assessment, marking and teamwork, with a server-side leaderboard.</li>
          </ul>
          <p className="mt-2">Genuinely unbuilt and still valid build targets: <strong>Admissions and Enquiry, Fee Payment Gateway, Parent Portal, Library, Transportation, Payroll computation, DPDPA compliance and the native mobile app.</strong></p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800 mb-4">
          <strong>How to use:</strong> Treat each phase as a sprint. For every phase: (1) Run the migration SQL, (2) Deploy edge functions, (3) Build frontend components, (4) Complete the verification checklist before moving to the next phase.
        </div>
        <p className="text-sm text-gray-700 mb-4">
          All modules follow the <strong>standardized 4-layer architecture</strong>: Database Layer → Edge Function Layer → Frontend Layer → Integration Layer. Refer to the ERP Roadmap Section 7 for architectural details.
        </p>

        <div className="bg-emerald-50 border border-emerald-200 rounded p-4 text-sm text-emerald-900">
          <strong>Shared platform infrastructure (use, don't reinvent, shipped April to June 2026):</strong>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><strong>Class Groups container:</strong> every new academic table that scopes to a class should reference <code>class_group_id</code> (parent) <em>and</em> <code>class_id</code> (section) per the dual-table invariant. Write to <code>subject_class_group_mappings</code>; the AFTER trigger fans out to legacy <code>subject_class_mappings</code>. Never write the legacy table directly.</li>
            <li><strong>Error toasts:</strong> wire every <code>onError</code>/<code>catch</code> to <code>toastError(err, &#123; fallback, context &#125;)</code> from <code>src/lib/toast.ts</code>. Never call <code>toast.error(error.message)</code>, it leaks raw Postgres.</li>
            <li><strong>Edge function invoke:</strong> for any new <code>admin-operations</code> action, call through <code>invokeAdminOperation</code> in <code>src/lib/invokeEdgeFunction.ts</code>. The helper reads <code>error.context</code> so the real Postgres error reaches <code>toastError</code> instead of "Edge Function returned a non-2xx status code".</li>
            <li><strong>Service worker:</strong> keep the <code>__BUILD_ID__</code> token in <code>public/sw.js</code> intact. Forms with unsaved input MUST set <code>data-dirty="true"</code> so the update mechanism doesn't auto-reload the user's work.</li>
            <li><strong>FK on profiles(id):</strong> every new column referencing <code>profiles(id)</code> must declare an explicit <code>ON DELETE</code> clause. Ownership columns (user_id, student_id, teacher_id, parent_id, assignee_id, participant_id) → CASCADE. Authoring columns (created_by, published_by, sender_id, etc.) → SET NULL. Never <code>SET NULL</code> + <code>NOT NULL</code>, it aborts the cascade.</li>
            <li><strong>Generated columns:</strong> never include them in INSERT/UPSERT. <code>final_results.percentage</code> is <code>GENERATED ALWAYS AS (…) STORED</code>; including it in a write raises <code>"cannot insert a non-DEFAULT value"</code> and the row is silently dropped. Check migration DDL before writing.</li>
            <li><strong>AI question generation:</strong> when extending <code>generate-questions</code>, keep the <code>repairLatexEscapes()</code> step before <code>JSON.parse</code> and the dollar-delimited LaTeX system prompt. Plain-text math is a HARD FAIL (the frontend only renders KaTeX).</li>
            <li><strong>High-concurrency patterns (target 3K to 5K concurrent, 10K ceiling, after the 2026-05-16 incident):</strong> never call <code>supabase.auth.getUser()</code> without a JWT (read from the local session; a containment monkey-patch already covers 167 call sites); no <code>select('*')</code> outside admin tooling; paginate every unbounded list with <code>range()</code> (PostgREST silently caps at 1000 rows, and a WHERE filter is not a bound); aggregate server-side rather than counting fetched rows; lazy-load page routes and heavy libs (XLSX, jsPDF, KaTeX, recharts, pdfjs, exceljs); <code>staleTime</code> of at least 60s and no <code>refetchInterval</code> under 30s without a justification comment; index every new FK in the same migration. An always-on repo rule force-triggers a Scale Gate before any data-access code ships, and no task is exempt.</li>
            <li><strong>Transactional writes:</strong> client code must NEVER DELETE-then-INSERT a relationship table; that pattern silently wiped two teachers' portals in August 2026. Two or more dependent writes are ONE RPC. Any save that removes existing rows must confirm first, naming what it will remove, and audit-log the delta. A PostgREST DELETE blocked by RLS looks identical to success, so re-SELECT by id and treat "the row is gone" as the only proof.</li>
            <li><strong>Error state before empty state:</strong> a failed query resolving as "zero rows" is this codebase's most common defect. Never destructure <code>data</code> from <code>useQuery</code> without handling <code>error</code>, and the error state must cover stat tiles and headers, not just the list.</li>
            <li><strong>Teacher authority is SUBJECT-scoped:</strong> <code>teacher_controls_student()</code> is the predicate for every teacher read and write except attendance. Sharing a class is not authority, and a <code>class_assignments</code> row with no <code>subject_id</code> grants nothing. Never union a dual-role user's scopes.</li>
            <li><strong>Grant hygiene:</strong> every new SECURITY DEFINER function must <code>REVOKE EXECUTE ... FROM anon</code> BY NAME (Supabase default privileges grant it, and revoking from PUBLIC does not strip it), verified through <code>information_schema.routine_privileges</code>. Every RLS UPDATE policy needs both <code>USING</code> and <code>WITH CHECK</code>: a missing <code>WITH CHECK</code> silently rejected 100% of teachers' offline-marks saves for two days.</li>
            <li><strong>Command Center scope:</strong> the admin Command Center and the coordinator/teacher Snapshot share components via <code>DashboardScope</code>. Every dashboard hook needs its <code>dash_*</code>, <code>dash_scoped_*</code> and <code>dash_teacher_*</code> variants with <code>scope</code> in the query key. Never branch on <code>scope === "scoped"</code> for teachers; teacher scope resolves through <code>dash_resolve_teacher_pairs()</code>.</li>
            <li><strong>Institution-local timezone:</strong> <code>institutions.timezone</code> (default <code>Asia/Kolkata</code>) is the single source of truth for ALL wall-clock comparisons. Use <code>(now() AT TIME ZONE i.timezone)</code>, never a bare <code>now()::time</code> or <code>CURRENT_DATE</code>. Attendance auto-mark runs through <code>tt_run_attendance_pass_for_institution</code>.</li>
            <li><strong>Ship order:</strong> a migration that drops or narrows a column must not land before the frontend that stops reading it. Dropping a support column ahead of the deploy broke the live ticket UI and had to be re-added empty.</li>
            <li><strong>Migration ledger is not maintained:</strong> verify applied SQL against <code>pg_proc</code>, <code>information_schema</code> and <code>pg_indexes</code>, never against <code>schema_migrations</code>. A unique INDEX is invisible to <code>pg_constraint</code>, so check <code>pg_indexes</code> before concluding <code>ON CONFLICT</code> is impossible.</li>
            <li><strong>Dual prod frontends:</strong> two production frontends share one Supabase project. Never hardcode either domain in shared code, and never narrow a CORS allow-list to one of them.</li>
            <li><strong>No em-dashes in user-facing text:</strong> labels, toasts, empty states, emails and PDFs. Use a comma, a colon, "to" for a range, or a middle dot for a tight join.</li>
          </ul>
        </div>
      </section>

      {/* Phase 1 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">2. Phase 1: Academic Management</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Homework/Assignments and Timetable/Scheduling, the foundation for daily school operations</p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">2.1 Homework & Assignments Module, ✅ ALREADY BUILT (shipped 2026-06-02)</h3>

        <div className="bg-green-50 border border-green-200 rounded p-4 text-sm text-green-800 mb-4">
          <strong>✅ This module has shipped to production.</strong> Do not build it from the steps below, they are preserved for historical reference only and the actual implementation differs. The live module uses the <code>homework_*</code> table family (assignments, assignment-class/subject mappings, submissions + files, results, mark audit, notifications-sent), the <code>submit-homework</code> / <code>homework-file-url</code> / <code>homework-notify-pass</code> edge functions, marking + publish gates, and a student feed at <code>/student/homework</code>. <strong>See the <code>homework-module</code> skill for current invariants</strong> (e.g. <code>homework.subject_id</code> is <code>ON DELETE RESTRICT</code>; storage is owner-only and markers read via the file-url edge fn).
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Original Planned Database Tables (Superseded)</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3 opacity-60">{`-- assignments table
CREATE TABLE public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  class_id UUID REFERENCES classes(id) NOT NULL,
  subject_id UUID REFERENCES subjects(id),
  created_by UUID REFERENCES profiles(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignment_type TEXT DEFAULT 'homework', -- homework, classwork, project
  due_date TIMESTAMPTZ NOT NULL,
  max_marks INTEGER DEFAULT 100,
  attachment_urls JSONB,
  is_published BOOLEAN DEFAULT false,
  allow_late_submission BOOLEAN DEFAULT false,
  late_penalty_percent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- submissions table
CREATE TABLE public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES profiles(id) NOT NULL,
  submission_text TEXT,
  attachment_urls JSONB,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  is_late BOOLEAN DEFAULT false,
  marks_obtained INTEGER,
  feedback TEXT,
  graded_by UUID REFERENCES profiles(id),
  graded_at TIMESTAMPTZ,
  plagiarism_score NUMERIC,
  status TEXT DEFAULT 'submitted', -- submitted, graded, returned, resubmitted
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(assignment_id, student_id)
);

-- Enable RLS
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Original Planned Edge Functions (Superseded)</h4>
        <table className="w-full text-sm border-collapse mb-3 opacity-60">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Trigger</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">plagiarism-checker</td><td className="border border-gray-200 px-3 py-2">Compare submissions against each other + external sources</td><td className="border border-gray-200 px-3 py-2">On submission</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">assignment-reminder</td><td className="border border-gray-200 px-3 py-2">Notify students of upcoming due dates</td><td className="border border-gray-200 px-3 py-2">Cron (daily)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">auto-grade-mcq</td><td className="border border-gray-200 px-3 py-2">Auto-grade MCQ-type assignments (reuse AI engine)</td><td className="border border-gray-200 px-3 py-2">On submission</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Original Planned Frontend Components (Superseded)</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3 opacity-60">{`src/pages/AssignmentsPage.tsx          — Main listing with filters
src/components/assignments/
  ├── CreateAssignmentDialog.tsx        — Form wizard for creating assignments
  ├── AssignmentCard.tsx                — Card view with status badges
  ├── SubmissionsList.tsx               — Teacher view of all submissions
  ├── SubmitAssignmentForm.tsx          — Student submission with file upload
  ├── GradingPanel.tsx                  — Teacher grading interface
  └── PlagiarismReport.tsx             — Plagiarism score visualization`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2 mt-6">2.2 Timetable & Scheduling Module, ✅ ALREADY BUILT</h3>
        
        <div className="bg-green-50 border border-green-200 rounded p-4 text-sm text-green-800 mb-4">
          <strong>✅ This module has been fully implemented in v2.4.</strong> The actual implementation uses a more sophisticated architecture than originally planned:
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><strong>11 tables</strong> (ALL DROPPED 2026-04-18/2026-05-03 by the later tt_*/cal_* rebuild, kept here only as history): day_templates, day_template_slots, day_of_week_template_map, calendar_exceptions, timetable_versions, timetable_slots, teacher_workload_settings, timetable_acknowledgements, lesson_plan_entries, topic_pacing_targets, admin_conflict_flags</li>
            <li><strong>4 Postgres RPCs</strong>: get_session_state, replace_timetable_slot, get_pacing_summary, rollover_session</li>
            <li><strong>Session state machine</strong>: calendar_pending → setup_complete → planning_open → timetable_published → lesson_plans_incomplete → all_current</li>
            <li><strong>Role-based views</strong>: Admin (calendar setup, template builder), Coordinator (grid assignment, publish flow, completion tracker), Teacher (personal grid, lesson plans, pacing)</li>
            <li><strong>PWA offline support</strong>: IndexedDB queue for offline lesson plan saves with background sync</li>
          </ul>
          <p className="mt-2">The original planned schema below is preserved for reference, but the actual implementation differs. See PRD Section 23 for the complete specification.</p>
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Original Planned Database Tables (Superseded)</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3 opacity-60">{`CREATE TABLE public.timetable_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  class_id UUID REFERENCES classes(id) NOT NULL,
  subject_id UUID REFERENCES subjects(id),
  teacher_id UUID REFERENCES profiles(id),
  room_id UUID REFERENCES rooms(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_type TEXT DEFAULT 'class', -- class, break, assembly, lab
  is_active BOOLEAN DEFAULT true,
  academic_year TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER,
  room_type TEXT DEFAULT 'classroom', -- classroom, lab, auditorium, library
  floor TEXT,
  has_projector BOOLEAN DEFAULT false,
  has_ac BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE public.substitution_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable_slot_id UUID REFERENCES timetable_slots(id) NOT NULL,
  original_teacher_id UUID REFERENCES profiles(id) NOT NULL,
  substitute_teacher_id UUID REFERENCES profiles(id) NOT NULL,
  date DATE NOT NULL,
  reason TEXT,
  approved_by UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent double-booking
CREATE UNIQUE INDEX idx_no_teacher_overlap
  ON timetable_slots (institution_id, teacher_id, day_of_week, start_time, academic_year)
  WHERE is_active = true;

CREATE UNIQUE INDEX idx_no_room_overlap
  ON timetable_slots (institution_id, room_id, day_of_week, start_time, academic_year)
  WHERE is_active = true;`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">timetable-solver</td><td className="border border-gray-200 px-3 py-2">AI constraint solver, generates conflict-free timetables using backtracking algorithm</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">substitution-finder</td><td className="border border-gray-200 px-3 py-2">Auto-suggest available substitute teachers based on free slots &amp; subject expertise</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Frontend Components</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`src/pages/TimetablePage.tsx             — Weekly grid view with drag-drop
src/components/timetable/
  ├── TimetableGrid.tsx                 — Interactive weekly calendar grid
  ├── SlotEditor.tsx                    — Edit slot details (subject, teacher, room)
  ├── AutoGenerateDialog.tsx            — AI timetable generation wizard
  ├── SubstitutionManager.tsx           — Manage teacher substitutions
  ├── RoomManager.tsx                   — CRUD for rooms and facilities
  └── ConflictResolver.tsx             — Visual conflict detection and resolution`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 1 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Teacher can create, publish, and unpublish assignments</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Students can submit assignments with file attachments</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Late submission detection and penalty works</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Plagiarism check runs on submission</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Timetable grid displays correctly with drag-drop editing</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Teacher double-booking is prevented by DB constraint</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Substitution workflow (request → approve) works end-to-end</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">AI timetable solver generates conflict-free schedules</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 2 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">3. Phase 2: Fee &amp; Payment Gateway ⬜ NOT BUILT</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Gateway integration, automated fee management, and financial reporting</p>

        <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800 mb-4">
          <strong>What already exists:</strong> the fee data model is in place. <code>fee_structures</code>, <code>fee_categories</code>, <code>fee_installments</code>, <code>fee_concessions</code>, <code>fee_receipts</code>, <code>student_fee_assignments</code>, <code>payment_records</code> and <code>payment_receipts</code> all ship today, and the Command Center already flags defaulters overdue 30 days or more. What is missing is the gateway itself: there is no live auto-charge or reconciliation for school fees, so parents pay offline and an admin records it by hand. Treat the tables below as the delta to build, and reconcile the names against the live schema before writing a migration rather than creating a parallel set.
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800 mb-4">
          <strong>Money representation:</strong> store amounts in rupees on NUMERIC columns and multiply by 100 only at the gateway boundary, where the provider demands the smallest unit. Never let paise into the database or the UI. Gateway webhooks retry, so the webhook handler must be idempotent.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Database Tables</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`CREATE TABLE public.fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  class_id UUID REFERENCES classes(id),
  fee_type TEXT NOT NULL, -- tuition, transport, lab, library, exam
  amount NUMERIC(10,2) NOT NULL,
  frequency TEXT DEFAULT 'monthly', -- monthly, quarterly, annual, one-time
  due_day INTEGER DEFAULT 10,
  late_fee_per_day NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  student_id UUID REFERENCES profiles(id) NOT NULL,
  fee_structure_id UUID REFERENCES fee_structures(id),
  amount NUMERIC(10,2) NOT NULL,
  late_fee NUMERIC(10,2) DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL,
  payment_method TEXT, -- razorpay, stripe, cash, cheque, bank_transfer
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  gateway_signature TEXT,
  status TEXT DEFAULT 'pending', -- pending, success, failed, refunded
  payment_date TIMESTAMPTZ,
  receipt_number TEXT UNIQUE,
  academic_year TEXT,
  month TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.refund_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES payment_transactions(id) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  gateway_refund_id TEXT,
  status TEXT DEFAULT 'initiated', -- initiated, processed, failed
  processed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.fee_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  student_id UUID REFERENCES profiles(id) NOT NULL,
  fee_structure_id UUID REFERENCES fee_structures(id),
  reminder_type TEXT DEFAULT 'upcoming', -- upcoming, overdue, final_notice
  sent_at TIMESTAMPTZ DEFAULT now(),
  channel TEXT DEFAULT 'in_app', -- in_app, sms, email, whatsapp
  status TEXT DEFAULT 'sent'
);`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Security</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">create-payment-order</td><td className="border border-gray-200 px-3 py-2">Create Razorpay/Stripe order with amount verification</td><td className="border border-gray-200 px-3 py-2">Auth required</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">payment-webhook</td><td className="border border-gray-200 px-3 py-2">Verify signature &amp; update transaction status</td><td className="border border-gray-200 px-3 py-2">Signature verification</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">late-fee-calculator</td><td className="border border-gray-200 px-3 py-2">Daily cron to calculate and apply late fees</td><td className="border border-gray-200 px-3 py-2">Cron only</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">receipt-generator</td><td className="border border-gray-200 px-3 py-2">Generate PDF receipt with institution branding</td><td className="border border-gray-200 px-3 py-2">Auth required</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">fee-defaulter-alert</td><td className="border border-gray-200 px-3 py-2">Weekly cron to send reminders to defaulters</td><td className="border border-gray-200 px-3 py-2">Cron only</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Frontend Components</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`src/pages/FeesPage.tsx                  — Fee dashboard with collection stats
src/components/fees/
  ├── FeeStructureManager.tsx           — CRUD for fee structures
  ├── PaymentForm.tsx                   — Razorpay/Stripe checkout integration
  ├── PaymentHistory.tsx                — Student payment history with receipts
  ├── DefaultersList.tsx                — Overdue payments with bulk reminder
  ├── ReceiptViewer.tsx                 — Downloadable receipt with school branding
  ├── FinancialDashboard.tsx            — Revenue charts, collection rates
  └── RefundDialog.tsx                 — Process refunds with reason tracking`}</pre>

        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800 mb-3">
          <strong>⚠ PCI-DSS Compliance:</strong> Never store raw card details. Use Razorpay/Stripe tokenization. Gateway keys go in Supabase Edge Function secrets, never in frontend code. Verify webhook signatures server-side.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 2 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Fee structures can be created per class/type/frequency</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Razorpay checkout opens and completes a test payment</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Webhook correctly updates transaction status</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Late fee auto-calculates after due date</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Receipt PDF generates with school branding</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Defaulter alerts are sent on schedule</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Refund workflow processes correctly through gateway</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 3 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">4. Phase 3: Communication Engine 🔶 PARTIAL</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Multi-channel messaging: SMS, WhatsApp and email with a template system and bulk campaigns</p>

        <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800 mb-4">
          <strong>Mostly shipped, read before building.</strong> The in-app half of this phase is live: the <strong>Notice Board</strong> (2026-08-22) is the audience engine, with multi-target junctions, expansion into a materialised <code>notice_recipients</code> set, audience preview, read receipts, inbox and outbox feeds and a reach rollup. Bulk Send was rebuilt as a Messages tab on that same engine and sends real direct messages. Transactional email runs through Resend, and Web Push runs through the service worker. <strong>What remains is the external channels only:</strong> SMS (with TRAI DLT registration) and WhatsApp Business. Build those as new senders behind the existing audience expansion, and reuse <code>notification_queue</code>. Do not create a second audience model, and note that <code>communication_templates</code> already exists but its admin tab was removed on 2026-09-07, so it has no send path.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Database Tables</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`CREATE TABLE public.message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL, -- sms, whatsapp, email
  subject TEXT, -- for email
  body TEXT NOT NULL, -- supports {{variable}} placeholders
  variables JSONB, -- list of available variables
  dlt_template_id TEXT, -- TRAI DLT registration ID (SMS only)
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.bulk_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  template_id UUID REFERENCES message_templates(id),
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  target_type TEXT NOT NULL, -- all, class, wing, individual
  target_ids JSONB, -- array of class/wing/user IDs
  scheduled_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft', -- draft, scheduled, sending, completed, failed
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES bulk_campaigns(id),
  recipient_id UUID REFERENCES profiles(id),
  channel TEXT NOT NULL,
  recipient_address TEXT NOT NULL, -- phone or email
  status TEXT DEFAULT 'queued', -- queued, sent, delivered, failed, bounced
  gateway_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Provider</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">send-sms</td><td className="border border-gray-200 px-3 py-2">Send individual/bulk SMS with DLT header</td><td className="border border-gray-200 px-3 py-2">Twilio / MSG91</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">send-whatsapp</td><td className="border border-gray-200 px-3 py-2">WhatsApp Business API messages (templates only)</td><td className="border border-gray-200 px-3 py-2">Meta Cloud API</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">send-email</td><td className="border border-gray-200 px-3 py-2">Transactional and bulk email delivery</td><td className="border border-gray-200 px-3 py-2">Resend / SendGrid</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">campaign-processor</td><td className="border border-gray-200 px-3 py-2">Queue-based batch processor for bulk campaigns (100/batch)</td><td className="border border-gray-200 px-3 py-2">Internal</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">delivery-webhook</td><td className="border border-gray-200 px-3 py-2">Receive delivery status callbacks from providers</td><td className="border border-gray-200 px-3 py-2">All providers</td></tr>
          </tbody>
        </table>

        <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800 mb-3">
          <strong>🇮🇳 TRAI DLT Compliance (India):</strong> All SMS messages must use pre-registered DLT templates with approved sender IDs. Store DLT template IDs in message_templates. Non-compliant SMS will be blocked by Indian telecom operators.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Frontend Components</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`src/pages/CommunicationPage.tsx         — Campaign dashboard with stats
src/components/communication/
  ├── TemplateBuilder.tsx               — Create/edit message templates with variable insertion
  ├── CampaignWizard.tsx                — Step-by-step campaign creation
  ├── RecipientSelector.tsx             — Select by class, wing, or individual
  ├── DeliveryTracker.tsx               — Real-time delivery status tracking
  ├── ChannelConfig.tsx                 — Configure SMS/WhatsApp/Email providers
  └── CampaignAnalytics.tsx            — Open rates, delivery rates, failure analysis`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 3 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Templates can be created with variable placeholders</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">SMS sends via test provider (with DLT template ID)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">WhatsApp template message delivered successfully</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Email sends with school branding</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Bulk campaign processes 500+ recipients without timeout</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Delivery status webhook updates logs in real-time</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 4 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">5. Phase 4: HR &amp; Payroll Completion 🔶 PARTIAL</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Leave management, payroll automation, tax compliance for Indian schools</p>

        <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800 mb-4">
          <strong>The leave half is already built.</strong> <code>staff_leave_requests</code> (with leave type, reviewer, reviewer notes and status) and <code>staff_leave_balances</code> ship today, alongside a My Leaves surface, an approvals surface, and staff attendance merged into one tab with reports. Approval already feeds substitution in the timetable. <strong>Do not create <code>leave_types</code> / <code>leave_balances</code> as new tables</strong>: extend what exists, or you will end up with two leave systems. <code>payroll_runs</code>, <code>payroll_entries</code>, <code>staff_salary_structures</code> and <code>staff_salary_assignments</code> also exist and capture a run with gross, deduction and net totals. <strong>The real remaining work is the computation layer:</strong> component-by-component calculation, payslip PDFs, an approval step before a run is finalised, and statutory compliance. A run over hundreds of employees will exceed 10 seconds, so it must be an enqueue-and-poll background job, not a request.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Database Tables</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`CREATE TABLE public.leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  name TEXT NOT NULL, -- Casual, Sick, Earned, Maternity, etc.
  annual_quota INTEGER NOT NULL,
  is_paid BOOLEAN DEFAULT true,
  carry_forward BOOLEAN DEFAULT false,
  max_carry_forward INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE public.leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  leave_type_id UUID REFERENCES leave_types(id) NOT NULL,
  academic_year TEXT NOT NULL,
  total_allocated INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  carried_forward INTEGER DEFAULT 0,
  UNIQUE(user_id, leave_type_id, academic_year)
);

CREATE TABLE public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  leave_type_id UUID REFERENCES leave_types(id) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending', -- pending, approved, rejected, cancelled
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  month TEXT NOT NULL, -- '2026-03'
  status TEXT DEFAULT 'draft', -- draft, processing, completed, locked
  processed_by UUID REFERENCES profiles(id),
  total_gross NUMERIC(12,2) DEFAULT 0,
  total_deductions NUMERIC(12,2) DEFAULT 0,
  total_net NUMERIC(12,2) DEFAULT 0,
  employee_count INTEGER DEFAULT 0,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID REFERENCES payroll_runs(id) NOT NULL,
  employee_id UUID REFERENCES profiles(id) NOT NULL,
  basic_salary NUMERIC(10,2) NOT NULL,
  hra NUMERIC(10,2) DEFAULT 0,
  da NUMERIC(10,2) DEFAULT 0,
  special_allowance NUMERIC(10,2) DEFAULT 0,
  pf_deduction NUMERIC(10,2) DEFAULT 0,
  esi_deduction NUMERIC(10,2) DEFAULT 0,
  tds NUMERIC(10,2) DEFAULT 0,
  professional_tax NUMERIC(10,2) DEFAULT 0,
  other_deductions NUMERIC(10,2) DEFAULT 0,
  gross_salary NUMERIC(10,2) NOT NULL,
  total_deductions NUMERIC(10,2) NOT NULL,
  net_salary NUMERIC(10,2) NOT NULL,
  days_worked INTEGER,
  leave_days INTEGER DEFAULT 0,
  -- Encrypt sensitive fields with pgcrypto
  bank_account_encrypted BYTEA,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(payroll_run_id, employee_id)
);`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">payroll-calculator</td><td className="border border-gray-200 px-3 py-2">Calculate gross/deductions/net for all employees in a run, applying Indian tax slabs (Old &amp; New Regime)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">form16-generator</td><td className="border border-gray-200 px-3 py-2">Generate Form 16 PDF for income tax filing (annual)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">leave-balance-reset</td><td className="border border-gray-200 px-3 py-2">Annual cron to reset leave balances &amp; apply carry-forward rules</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">payslip-emailer</td><td className="border border-gray-200 px-3 py-2">Email payslips to all employees after payroll lock</td></tr>
          </tbody>
        </table>

        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 mb-3">
          <strong>🔐 Security Critical:</strong> Salary data must use <code>pgcrypto</code> field-level encryption for bank account numbers. The decryption key is stored only in Edge Function secrets. TDS rates must follow current Indian Income Tax slabs, keep slab config in a JSON constant within the edge function for easy annual updates.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Frontend Components</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`src/pages/LeaveManagementPage.tsx       — Leave calendar and request management
src/pages/PayrollPage.tsx               — Monthly payroll dashboard
src/components/hr/
  ├── LeaveRequestForm.tsx              — Apply for leave with date picker
  ├── LeaveApprovalQueue.tsx            — Admin approval/rejection queue
  ├── LeaveBalanceCard.tsx              — Visual leave balance by type
  ├── PayrollRunWizard.tsx              — Step-by-step payroll processing
  ├── PayslipViewer.tsx                 — Employee payslip with download
  ├── SalaryStructureEditor.tsx         — Define salary components per employee
  └── TaxSummaryDashboard.tsx          — Institutional tax liability overview`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 4 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Leave request → approval → balance deduction flow works</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Carry-forward rules apply correctly at year-end</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Payroll calculator produces correct gross/deductions/net</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">PF, ESI, and TDS deductions match Indian tax rules</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Bank account numbers are encrypted at rest</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Payslip PDF generates and emails correctly</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Form 16 generation produces valid document</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 5 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">6. Phase 5: Transportation Management</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Real-time GPS tracking, route optimization, fleet management, parent alerts</p>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Database Tables</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  vehicle_number TEXT NOT NULL,
  vehicle_type TEXT DEFAULT 'bus', -- bus, van, auto
  capacity INTEGER NOT NULL,
  driver_name TEXT,
  driver_phone TEXT,
  gps_device_id TEXT,
  insurance_expiry DATE,
  fitness_expiry DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  name TEXT NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id),
  route_type TEXT DEFAULT 'pickup', -- pickup, drop, both
  stops JSONB NOT NULL, -- [{name, lat, lng, time, order}]
  estimated_duration_minutes INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.transport_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES profiles(id) NOT NULL,
  route_id UUID REFERENCES transport_routes(id) NOT NULL,
  stop_name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(student_id, academic_year)
);

CREATE TABLE public.gps_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  speed NUMERIC(5,2),
  heading NUMERIC(5,2),
  recorded_at TIMESTAMPTZ DEFAULT now()
);

-- Partition gps_pings by month for performance
-- CREATE TABLE gps_pings_2026_03 PARTITION OF gps_pings
--   FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">gps-webhook</td><td className="border border-gray-200 px-3 py-2">Receive GPS pings from tracking devices, insert into gps_pings, broadcast via Supabase Realtime</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">route-optimizer</td><td className="border border-gray-200 px-3 py-2">Optimize stop order using Google Maps Distance Matrix API or OSRM</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">geofence-alerter</td><td className="border border-gray-200 px-3 py-2">Notify parents when bus enters/exits school geofence or is near their stop</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">fleet-compliance-checker</td><td className="border border-gray-200 px-3 py-2">Weekly cron to flag expiring insurance/fitness certificates</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Frontend Components</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`src/pages/TransportPage.tsx             — Fleet dashboard with live map
src/components/transport/
  ├── LiveTrackingMap.tsx                — Mapbox/Google Maps with real-time bus positions
  ├── RouteBuilder.tsx                   — Create/edit routes with drag-drop stops on map
  ├── VehicleManager.tsx                 — Fleet CRUD with compliance status
  ├── StudentRouteAssignment.tsx         — Assign students to routes/stops
  ├── ParentTrackingView.tsx             — Parent-facing bus tracker
  └── ComplianceDashboard.tsx           — Insurance/fitness expiry alerts`}</pre>

        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800 mb-3">
          <strong>🗺 Map Integration:</strong> Use Mapbox GL JS (free tier: 50K loads/month) or Google Maps Platform. GPS pings are broadcast via Supabase Realtime channels scoped by <code>institution_id:vehicle_id</code> for efficient subscription.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 5 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Vehicles and routes can be created with map visualization</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">GPS pings update bus position on map in real-time (&lt;3s delay)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Parents receive notification when bus is near their stop</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Route optimizer reduces total travel time vs manual ordering</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Compliance alerts fire for expiring documents</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 6 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">7. Phase 6: Library Management</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Digital catalog, barcode/RFID scanning, circulation, fines, e-book storage</p>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Database Tables</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`CREATE TABLE public.books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  isbn TEXT,
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  category TEXT, -- fiction, non-fiction, textbook, reference
  subject TEXT,
  barcode TEXT UNIQUE,
  total_copies INTEGER DEFAULT 1,
  available_copies INTEGER DEFAULT 1,
  shelf_location TEXT,
  cover_image_url TEXT,
  ebook_url TEXT, -- Supabase Storage path
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.circulation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID REFERENCES books(id) NOT NULL,
  borrower_id UUID REFERENCES profiles(id) NOT NULL,
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT now(),
  due_date DATE NOT NULL,
  returned_at TIMESTAMPTZ,
  renewed_count INTEGER DEFAULT 0,
  max_renewals INTEGER DEFAULT 2,
  status TEXT DEFAULT 'issued', -- issued, returned, overdue, lost
  issued_by UUID REFERENCES profiles(id)
);

CREATE TABLE public.library_fines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circulation_id UUID REFERENCES circulation_records(id) NOT NULL,
  borrower_id UUID REFERENCES profiles(id) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  reason TEXT DEFAULT 'overdue', -- overdue, lost, damaged
  is_paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">overdue-calculator</td><td className="border border-gray-200 px-3 py-2">Daily cron to mark overdue books and generate fines (₹X/day configurable)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">isbn-lookup</td><td className="border border-gray-200 px-3 py-2">Fetch book metadata from Google Books API / Open Library by ISBN</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">overdue-notifier</td><td className="border border-gray-200 px-3 py-2">Send reminders to borrowers with overdue books</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Frontend Components</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`src/pages/LibraryPage.tsx               — Book catalog with search/filter
src/components/library/
  ├── BookCatalog.tsx                    — Searchable grid/list view with cover images
  ├── AddBookDialog.tsx                  — Manual entry or ISBN auto-fill
  ├── BarcodeScanner.tsx                 — Web USB API barcode reader for issue/return
  ├── CirculationDesk.tsx                — Issue/return/renew books
  ├── FineManager.tsx                    — View and collect fines
  ├── EbookViewer.tsx                    — In-browser PDF/EPUB reader
  └── LibraryDashboard.tsx             — Circulation stats, popular books, overdue count`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 6 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Books can be added via ISBN auto-fill and manually</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Barcode scanner issues and returns books correctly</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Available copies decrement/increment on issue/return</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Overdue fines auto-generate after due date</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">E-books can be uploaded and viewed in-browser</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Renewal limit enforcement works (max 2 renewals)</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 7 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">8. Phase 7: Student Information Completion ⬜ HIGHEST PRIORITY</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Admissions pipeline, document verification, medical records, transfers, alumni tracking</p>

        <div className="bg-emerald-50 border border-emerald-300 rounded p-3 text-sm text-emerald-900 mb-4">
          <strong>Build this phase first.</strong> The admissions half is the single largest gap in the ERP, it has no upstream dependencies, and it feeds the entire student lifecycle. Two notes before you start: the public enquiry intake endpoint will be the platform's only unauthenticated write surface, so it needs rate limiting and abuse protection from the first commit; and converting an accepted offer into a student must happen in <strong>one RPC</strong> that creates the profile, the role and the class assignment together, never as a sequence of client calls. Guardian contacts and date of birth already live on <code>student_personal_details</code> (school-managed, students read-only, no DELETE policy), and internal class moves already go through <code>set_student_class</code>, so reuse both rather than duplicating them.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Database Tables</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`CREATE TABLE public.admission_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  student_name TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  parent_email TEXT,
  parent_phone TEXT NOT NULL,
  applying_for_class TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  previous_school TEXT,
  status TEXT DEFAULT 'inquiry', -- inquiry, application, test_scheduled,
                                  -- interview, offered, accepted, enrolled, rejected
  documents JSONB, -- [{type, url, verified, verified_by}]
  notes TEXT,
  assigned_to UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.medical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES profiles(id) NOT NULL,
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  blood_group TEXT,
  allergies JSONB, -- [{allergen, severity, notes}]
  chronic_conditions JSONB,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  insurance_provider TEXT,
  insurance_policy_number TEXT,
  last_physical_date DATE,
  vaccination_records JSONB, -- [{vaccine, date, dose}]
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id)
);

CREATE TABLE public.transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES profiles(id) NOT NULL,
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  transfer_type TEXT NOT NULL, -- section_change, school_transfer, withdrawal
  from_class_id UUID REFERENCES classes(id),
  to_class_id UUID REFERENCES classes(id),
  reason TEXT,
  tc_number TEXT, -- Transfer Certificate number
  tc_document_url TEXT,
  status TEXT DEFAULT 'pending', -- pending, approved, completed, rejected
  approved_by UUID REFERENCES profiles(id),
  effective_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.alumni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  passing_year TEXT NOT NULL,
  last_class TEXT NOT NULL,
  current_occupation TEXT,
  current_organization TEXT,
  higher_education TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  is_contactable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">document-verifier</td><td className="border border-gray-200 px-3 py-2">AI-powered OCR to extract and verify student documents (birth certificate, marksheet)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">tc-generator</td><td className="border border-gray-200 px-3 py-2">Generate Transfer Certificate PDF with CBSE/state board format</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">admission-pipeline-notifier</td><td className="border border-gray-200 px-3 py-2">Send status update emails/SMS at each admission stage</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Frontend Components</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`src/pages/AdmissionsPage.tsx            — Kanban-style admission pipeline
src/components/student-info/
  ├── AdmissionPipeline.tsx             — Drag-drop Kanban (inquiry → enrolled)
  ├── ApplicationForm.tsx               — Public-facing admission form
  ├── DocumentUploader.tsx              — Multi-doc upload with verification status
  ├── MedicalRecordForm.tsx             — Student medical profile editor
  ├── TransferCertificate.tsx           — TC generation and download
  ├── AlumniDirectory.tsx               — Searchable alumni database
  └── StudentProfileComplete.tsx       — Comprehensive student 360° view`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 7 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Admission inquiry flows through all pipeline stages</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Document upload and AI verification returns results</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Medical records store and display correctly</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Transfer Certificate generates with correct format</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Alumni directory is searchable by year/name/occupation</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 8 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">9. Phase 8: Security &amp; Compliance 🔶 PARTIAL</h2>
        <p className="text-sm text-gray-600 mb-4 italic">DPDPA 2023 compliance, 2FA, penetration testing, breach protocols, audit trails</p>

        <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800 mb-4">
          <strong>Audit trails are already built.</strong> <code>system_audit_logs</code>, <code>user_activity_log</code>, <code>task_audit_logs</code>, <code>homework_mark_audit</code> and <code>class_assignment_deletions</code> (which deliberately has no foreign keys so it survives cascades) all ship today, and the user activity feed federates nine source tables. Any new user-action table must be federated into that feed. Also already in place: the user deletion cascade contract, the transactional write contract, and the error translation pipeline. <strong>What remains here is DPDPA consent and data-principal rights, real 2FA, field-level encryption for salary and personal data, a third-party penetration test, and a breach notification protocol.</strong> Note also that several internal audits from July and August 2026 are still partly open in <code>docs/</code>, with two recurring root causes: edge functions that check a role but not ownership, and controls enforced only in the React client. Closing those is security work that should be scheduled alongside this phase.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Database Tables</h4>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mb-3">{`CREATE TABLE public.consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  consent_type TEXT NOT NULL, -- data_processing, marketing, biometric, photo
  is_granted BOOLEAN NOT NULL,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  ip_address TEXT,
  consent_text TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  institution_id UUID REFERENCES institutions(id),
  request_type TEXT NOT NULL, -- deletion, export, correction
  status TEXT DEFAULT 'pending', -- pending, processing, completed, rejected
  data_categories JSONB, -- ['personal', 'academic', 'financial', 'biometric']
  processed_by UUID REFERENCES profiles(id),
  completed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.security_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  institution_id UUID REFERENCES institutions(id),
  action TEXT NOT NULL, -- login, logout, data_access, data_modify, permission_change
  resource_type TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  risk_level TEXT DEFAULT 'low', -- low, medium, high, critical
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Partition audit logs by month
-- Index for quick lookups
CREATE INDEX idx_audit_logs_user ON security_audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_logs_risk ON security_audit_logs (risk_level, created_at DESC);`}</pre>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Implementation Steps</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Step</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Action</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">1</td><td className="border border-gray-200 px-3 py-2">Enable Supabase MFA</td><td className="border border-gray-200 px-3 py-2">TOTP-based 2FA using <code>supabase.auth.mfa.enroll()</code></td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">2</td><td className="border border-gray-200 px-3 py-2">RLS Audit</td><td className="border border-gray-200 px-3 py-2">Review all 50+ tables for proper institution_id scoping</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">3</td><td className="border border-gray-200 px-3 py-2">Consent Flow</td><td className="border border-gray-200 px-3 py-2">First-login consent collection for DPDPA compliance</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">4</td><td className="border border-gray-200 px-3 py-2">Data Export</td><td className="border border-gray-200 px-3 py-2">Edge function to generate user data ZIP (Right to Portability)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">5</td><td className="border border-gray-200 px-3 py-2">Data Deletion</td><td className="border border-gray-200 px-3 py-2">Cascading deletion with audit trail (Right to Erasure)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">6</td><td className="border border-gray-200 px-3 py-2">Rate Limiting</td><td className="border border-gray-200 px-3 py-2">Add rate limits on auth endpoints and API-heavy routes</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">7</td><td className="border border-gray-200 px-3 py-2">Penetration Test</td><td className="border border-gray-200 px-3 py-2">Engage third-party security auditor before production launch</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Edge Functions</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Function</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">data-export</td><td className="border border-gray-200 px-3 py-2">Generate ZIP of all user data (personal, academic, financial), DPDPA Right to Portability</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">data-deletion</td><td className="border border-gray-200 px-3 py-2">Cascade-delete user data with pre-deletion audit snapshot</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">breach-notifier</td><td className="border border-gray-200 px-3 py-2">DPDPA-mandated 72-hour breach notification to authorities and affected users</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-mono text-xs">anomaly-detector</td><td className="border border-gray-200 px-3 py-2">Flag suspicious patterns (bulk downloads, unusual login locations, after-hours access)</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 8 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">2FA enrollment and login flow works for all admin roles</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Consent collection appears on first login</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Data export generates complete ZIP within 5 minutes</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Data deletion cascades across all related tables</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">All API endpoints have rate limiting enabled</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Audit logs capture all sensitive operations</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Penetration test report has no critical findings</td></tr>
          </tbody>
        </table>
      </section>

      {/* Phase 9 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">10. Phase 9: Mobile &amp; Expansion 🔶 PARTIAL</h2>
        <p className="text-sm text-gray-600 mb-4 italic">PWA optimisation, native app considerations, offline sync, marketplace</p>

        <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800 mb-4">
          <strong>The PWA half is done.</strong> The app installs, and the build-stamped service worker means a deploy is picked up on tab focus and on an hourly poll, with a dirty-form-aware reload so an update never discards a half-filled form. Every surface is built to work at 375px. <strong>What remains is native:</strong> iOS and Android apps with feature parity, offline exam taking with queued uploads, native push through APNs and FCM, and a biometric app lock. Before starting native work, note that the infrastructure floor in the concurrency contract is still unmet, and raising compute is a cheaper reliability win than a second client.
        </div>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Technology Decision Matrix</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Option</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Pros</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Cons</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Recommendation</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2 font-semibold">PWA (Current)</td><td className="border border-gray-200 px-3 py-2">No app store, shared codebase, instant updates</td><td className="border border-gray-200 px-3 py-2">Limited native APIs, iOS restrictions</td><td className="border border-gray-200 px-3 py-2 text-green-700 font-semibold">Phase 1, Optimize first</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-semibold">React Native</td><td className="border border-gray-200 px-3 py-2">Code reuse from React, native feel</td><td className="border border-gray-200 px-3 py-2">Separate codebase, maintenance cost</td><td className="border border-gray-200 px-3 py-2">Phase 2, If PWA insufficient</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2 font-semibold">Capacitor</td><td className="border border-gray-200 px-3 py-2">Wraps existing web app, native plugins</td><td className="border border-gray-200 px-3 py-2">Performance ceiling, plugin availability</td><td className="border border-gray-200 px-3 py-2">Chosen 2026-09-16 (see docs/superpowers/specs/2026-09-16-native-app-capacitor-design.md)</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">PWA Optimization Steps</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Step</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Action</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Impact</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">1</td><td className="border border-gray-200 px-3 py-2">Service Worker caching strategy (stale-while-revalidate)</td><td className="border border-gray-200 px-3 py-2">Offline read access to cached data</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">2</td><td className="border border-gray-200 px-3 py-2">IndexedDB for offline queue (attendance, submissions)</td><td className="border border-gray-200 px-3 py-2">Works without internet, syncs on reconnect</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">3</td><td className="border border-gray-200 px-3 py-2">Background Sync API for queued writes</td><td className="border border-gray-200 px-3 py-2">Reliable data sync even after app close</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">4</td><td className="border border-gray-200 px-3 py-2">App Shell architecture with skeleton screens</td><td className="border border-gray-200 px-3 py-2">Perceived instant loading</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">5</td><td className="border border-gray-200 px-3 py-2">Bundle analysis and code splitting by route</td><td className="border border-gray-200 px-3 py-2">Reduce initial load to &lt;200KB</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">Expansion Modules</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left">Module</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Description</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Priority</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">Alumni Network</td><td className="border border-gray-200 px-3 py-2">Alumni portal with directory, events, mentorship matching</td><td className="border border-gray-200 px-3 py-2">Medium</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">LMS Integration</td><td className="border border-gray-200 px-3 py-2">Connect with Google Classroom, Moodle, Canvas via APIs</td><td className="border border-gray-200 px-3 py-2">Medium</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">Marketplace</td><td className="border border-gray-200 px-3 py-2">School supplies/uniforms ordering with vendor management</td><td className="border border-gray-200 px-3 py-2">Low</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">Parent Portal 2.0</td><td className="border border-gray-200 px-3 py-2">Dedicated parent app with fee payment, bus tracking, report cards</td><td className="border border-gray-200 px-3 py-2">High</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">Multi-Branch</td><td className="border border-gray-200 px-3 py-2">Central dashboard for school chains managing 10+ branches</td><td className="border border-gray-200 px-3 py-2">High</td></tr>
          </tbody>
        </table>

        <h4 className="text-md font-semibold text-gray-700 mt-3 mb-2">✅ Phase 9 Verification Checklist</h4>
        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">PWA scores 90+ on Lighthouse (Performance, Accessibility, PWA)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Offline mode allows viewing cached attendance and timetable</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Background sync queues attendance data when offline</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Initial bundle size is under 200KB (gzipped)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">App installs correctly on Android and iOS home screen</td></tr>
          </tbody>
        </table>
      </section>

      {/* Pre-Launch Checklist */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-3 border-b border-gray-200 pb-2">11. Pre-Launch Checklist</h2>
        <p className="text-sm text-gray-600 mb-4 italic">Complete all items before deploying to production with real school data</p>

        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-200 px-3 py-2 text-left w-8">✓</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Category</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Item</th>
              <th className="border border-gray-200 px-3 py-2 text-left">Phase</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-200 px-3 py-2">☑</td><td className="border border-gray-200 px-3 py-2">Academic</td><td className="border border-gray-200 px-3 py-2">Homework assignment, submission and grading flow tested</td><td className="border border-gray-200 px-3 py-2">1 (done)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☑</td><td className="border border-gray-200 px-3 py-2">Academic</td><td className="border border-gray-200 px-3 py-2">Timetable runs without conflicts across a full school, with year rollover</td><td className="border border-gray-200 px-3 py-2">1 (done)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Admissions</td><td className="border border-gray-200 px-3 py-2">Enquiry, application, entrance, offer and enrolment conversion in one transaction</td><td className="border border-gray-200 px-3 py-2">7</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Financial</td><td className="border border-gray-200 px-3 py-2">End-to-end payment: fee, checkout, receipt, refund; webhook replay is idempotent</td><td className="border border-gray-200 px-3 py-2">2</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Financial</td><td className="border border-gray-200 px-3 py-2">Payroll generates correct payslips for 50+ employees as a background job</td><td className="border border-gray-200 px-3 py-2">4</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☑</td><td className="border border-gray-200 px-3 py-2">Communication</td><td className="border border-gray-200 px-3 py-2">Notice reaches its full audience with read receipts, and no notice leaks outside its scope</td><td className="border border-gray-200 px-3 py-2">3 (done)</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Communication</td><td className="border border-gray-200 px-3 py-2">Bulk SMS or WhatsApp campaign with 1000+ recipients succeeds, DLT templates approved</td><td className="border border-gray-200 px-3 py-2">3</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Parents</td><td className="border border-gray-200 px-3 py-2">A parent sees only their linked children, on every module surface</td><td className="border border-gray-200 px-3 py-2">7</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Transport</td><td className="border border-gray-200 px-3 py-2">GPS tracking shows live bus positions with &lt;5s latency</td><td className="border border-gray-200 px-3 py-2">5</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Library</td><td className="border border-gray-200 px-3 py-2">Issue/return cycle with barcode scanner works end-to-end</td><td className="border border-gray-200 px-3 py-2">6</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Security</td><td className="border border-gray-200 px-3 py-2">2FA enabled for all admin roles</td><td className="border border-gray-200 px-3 py-2">8</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Security</td><td className="border border-gray-200 px-3 py-2">DPDPA consent flow and data deletion tested</td><td className="border border-gray-200 px-3 py-2">8</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Security</td><td className="border border-gray-200 px-3 py-2">Penetration test passed with no critical vulnerabilities</td><td className="border border-gray-200 px-3 py-2">8</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Security</td><td className="border border-gray-200 px-3 py-2">Every SECURITY DEFINER function verified to have EXECUTE revoked from anon</td><td className="border border-gray-200 px-3 py-2">8</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Security</td><td className="border border-gray-200 px-3 py-2">Every RLS UPDATE policy carries both USING and WITH CHECK</td><td className="border border-gray-200 px-3 py-2">8</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Security</td><td className="border border-gray-200 px-3 py-2">Standing audit findings in docs/ triaged and either fixed or explicitly accepted</td><td className="border border-gray-200 px-3 py-2">8</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Performance</td><td className="border border-gray-200 px-3 py-2">App loads in under 3s on a 3G connection</td><td className="border border-gray-200 px-3 py-2">9</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Performance</td><td className="border border-gray-200 px-3 py-2">k6 run sustains 3,000 concurrent users without degradation</td><td className="border border-gray-200 px-3 py-2">9</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Performance</td><td className="border border-gray-200 px-3 py-2">Every new list read is bounded and every new count is computed server-side</td><td className="border border-gray-200 px-3 py-2">All</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Infrastructure</td><td className="border border-gray-200 px-3 py-2">Compute raised to at least Medium, with Supavisor transaction pooling enabled</td><td className="border border-gray-200 px-3 py-2">9</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Infrastructure</td><td className="border border-gray-200 px-3 py-2">Automated daily backups with a tested restore procedure</td><td className="border border-gray-200 px-3 py-2">9</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Infrastructure</td><td className="border border-gray-200 px-3 py-2">Sentry configured with alert channels</td><td className="border border-gray-200 px-3 py-2">9</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Quality</td><td className="border border-gray-200 px-3 py-2">npm run typecheck, eslint on touched files, and vite build all exit 0</td><td className="border border-gray-200 px-3 py-2">All</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Quality</td><td className="border border-gray-200 px-3 py-2">Every new surface verified at 375px and in dark mode, with error state before empty state</td><td className="border border-gray-200 px-3 py-2">All</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Documentation</td><td className="border border-gray-200 px-3 py-2">All API endpoints documented with examples</td><td className="border border-gray-200 px-3 py-2">All</td></tr>
            <tr><td className="border border-gray-200 px-3 py-2">☐</td><td className="border border-gray-200 px-3 py-2">Documentation</td><td className="border border-gray-200 px-3 py-2">User manual for school admins and teachers created</td><td className="border border-gray-200 px-3 py-2">All</td></tr>
          </tbody>
        </table>
      </section>

      {/* Footer */}
      <div className="border-t-2 border-gray-300 pt-4 mt-8 text-center text-xs text-gray-500">
        <p>SALCI ERP Builder Guide v3.0 · Confidential Internal Document</p>
        <p className="mt-1">Most of Phases 1, 3 and 4 have shipped (see the Already Shipped callout in Section 1). Refer to the ERP Roadmap and the module skills for current build status before starting any phase.</p>
        <p className="mt-1">Last updated September 8, 2026 | For development team use only</p>
      </div>
    </div>
  );
});

BuilderGuideDocument.displayName = "BuilderGuideDocument";

export default BuilderGuideDocument;
