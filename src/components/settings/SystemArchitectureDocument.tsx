import { forwardRef } from "react";

const SystemArchitectureDocument = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="bg-white text-black p-8 max-w-4xl mx-auto font-sans">
      {/* Header */}
      <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">SALCI Platform</h1>
        <p className="text-xl text-gray-600">System Architecture Document</p>
        <p className="text-sm text-gray-500 mt-2">Version 3.0 | September 8, 2026</p>
        <p className="text-xs text-gray-500 mt-1">Scope: the SALCI school platform. The Olympiad subsystem shares this repository and Supabase project but is documented separately and excluded from every count below.</p>
      </div>

      {/* Table of Contents */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">Table of Contents</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>1. Technology Stack Overview</div>
          <div>2. Frontend Architecture</div>
          <div>3. Backend Architecture (Supabase)</div>
          <div>4. Authentication &amp; Authorization</div>
          <div>5. Database Architecture</div>
          <div>6. Storage Architecture</div>
          <div>7. Edge Functions (Serverless)</div>
          <div>8. AI Integration Layer</div>
          <div>9. Real-time Features</div>
          <div>10. Deployment &amp; Infrastructure</div>
          <div>11. Class Groups Architecture</div>
          <div>12. Error Translation Pipeline</div>
          <div>13. Service Worker Update Mechanism</div>
          <div>14. User Deletion Cascade Contract</div>
          <div>15. Transactional Write Contract</div>
          <div>16. Hybrid, Results-Only &amp; Homework Planes</div>
          <div>17. Command Center &amp; Scoped Dashboards</div>
          <div>18. Syllabus Delivery: Two Timelines</div>
          <div>19. Notices, Messaging &amp; Support</div>
          <div>20. Profile Photos &amp; Profile Lockdown</div>
          <div>21. High-Concurrency Hardening</div>
          <div>22. Database Operations &amp; Security Posture</div>
        </div>
      </section>

      {/* 1. Technology Stack */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">1. Technology Stack Overview</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Layer</th>
              <th className="border border-gray-300 p-2 text-left">Technology</th>
              <th className="border border-gray-300 p-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Framework</td><td className="border border-gray-300 p-2">React 18 + TypeScript</td><td className="border border-gray-300 p-2">UI rendering, type safety</td></tr>
            <tr><td className="border border-gray-300 p-2">Build Tool</td><td className="border border-gray-300 p-2">Vite</td><td className="border border-gray-300 p-2">Fast HMR, route-level code splitting, the service-worker build-ID plugin</td></tr>
            <tr><td className="border border-gray-300 p-2">Styling</td><td className="border border-gray-300 p-2">Tailwind CSS + shadcn/ui</td><td className="border border-gray-300 p-2">Utility-first CSS over HSL design tokens defined in both :root and .dark</td></tr>
            <tr><td className="border border-gray-300 p-2">State Management</td><td className="border border-gray-300 p-2">TanStack React Query v5</td><td className="border border-gray-300 p-2">Server state, caching, mutations</td></tr>
            <tr><td className="border border-gray-300 p-2">Routing</td><td className="border border-gray-300 p-2">React Router v6</td><td className="border border-gray-300 p-2">Client-side routing and guards; 120 lazy-loaded routes</td></tr>
            <tr><td className="border border-gray-300 p-2">Backend</td><td className="border border-gray-300 p-2">Supabase (PostgreSQL, GoTrue, Storage, Edge)</td><td className="border border-gray-300 p-2">Database, auth, files, serverless</td></tr>
            <tr><td className="border border-gray-300 p-2">AI</td><td className="border border-gray-300 p-2">Two paths: <code>aiProvider.ts</code> (OpenAI or Gemini) + Lovable AI gateway (Google Gemini)</td><td className="border border-gray-300 p-2">Question generation, grading, OCR, insights (see section 8)</td></tr>
            <tr><td className="border border-gray-300 p-2">Animation</td><td className="border border-gray-300 p-2">Framer Motion</td><td className="border border-gray-300 p-2">Page fades and dialog transitions only; ordinary hovers use Tailwind transitions</td></tr>
            <tr><td className="border border-gray-300 p-2">Charts</td><td className="border border-gray-300 p-2">Recharts</td><td className="border border-gray-300 p-2">Analytics visualisation. Wrappers need an explicit inline width and height</td></tr>
            <tr><td className="border border-gray-300 p-2">Forms</td><td className="border border-gray-300 p-2">React Hook Form + Zod</td><td className="border border-gray-300 p-2">Schema-driven validation</td></tr>
            <tr><td className="border border-gray-300 p-2">Math</td><td className="border border-gray-300 p-2">KaTeX + MathLive</td><td className="border border-gray-300 p-2">Dollar-delimited LaTeX rendering and a WYSIWYG equation builder</td></tr>
            <tr><td className="border border-gray-300 p-2">PDF Export</td><td className="border border-gray-300 p-2">Browser print pipeline (<code>exportTextPdf</code>) + jsPDF and html2canvas where a rendered page is needed</td><td className="border border-gray-300 p-2">Text-based, selectable and searchable PDFs</td></tr>
            <tr><td className="border border-gray-300 p-2">Spreadsheets</td><td className="border border-gray-300 p-2">exceljs, xlsx, PapaParse</td><td className="border border-gray-300 p-2">Styled multi-sheet exports, CSV and Excel import</td></tr>
            <tr><td className="border border-gray-300 p-2">Media</td><td className="border border-gray-300 p-2">heic2any, compressorjs, face-api.js, tus-js-client</td><td className="border border-gray-300 p-2">HEIC-aware avatar pipeline, image compression, face enrolment, resumable uploads</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-500">Every heavy library above is lazy-loaded at the route or component that needs it, never in the entry chunk.</p>
      </section>

      {/* 2. Frontend Architecture */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">2. Frontend Architecture</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">2.1 Project Structure</h3>
        <pre className="bg-gray-50 p-4 rounded text-xs mb-4 overflow-x-auto">{`src/
├── components/
│   ├── ui/              shadcn/ui primitives ONLY (Button, Card, Dialog, …)
│   ├── shared/          cross-role primitives: page, surface, nav, sheet
│   ├── admin/ school/ teacher/ student/    role-scoped surfaces
│   ├── command-center/  dashboard bento, widgets, tables, dash/ sections
│   ├── exam/ exam-creation/ exam-checking/ exam-results/ evaluation/
│   ├── hybrid/ offline-scan/ scan-sheets/ proctoring/
│   ├── homework/ homework-creation/  syllabus/  timetable-v2/  calendar/
│   ├── notices/ communication/ issues/    notice board, messaging, support
│   ├── achievements/ badges/ passport/ learning/  student intelligence
│   ├── attendance/ hr/ workforce/ fees/ payments/  operations
│   ├── onboarding/ onboarding-dashboard/  institution journey
│   ├── prd/ settings/   the seven living documents
│   └── layout/          AppSidebar, ProtectedRoute, app chrome
├── hooks/               286 files. dashboard/ and notices/ are module subdirs
├── integrations/        Supabase client + generated types
├── lib/                 toast, errorMessages, invokeEdgeFunction, staffAssignments,
│                        subjectAdmin, avatarStore, fullscreen, export helpers
├── pages/               97 school-platform pages
│   ├── admin/ school/ teacher/ student/ staff/ proctoring/ public/
└── App.tsx              route definitions`}</pre>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">2.2 Component Architecture Patterns</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-4">
          <li><strong>Shared primitives first.</strong> Pages wrap in <code>PageShell</code>, never <code>AppLayout</code> directly. Cards are <code>surface-card frosted-shadow rounded-card</code>, tabs are <code>MobileTabs</code>, modals are <code>MobileSheet</code>, stat tiles are <code>StatTile</code>, empty states are <code>EmptyState</code>.</li>
          <li><strong>Role-based rendering.</strong> Components read <code>useUserRole()</code> and <code>useActiveRole()</code>. <code>ViewRole</code> is declared once, in <code>ActiveRoleContext</code>.</li>
          <li><strong>Lazy loading.</strong> Every route is <code>React.lazy()</code>, and heavy libraries are dynamically imported at the point of use.</li>
          <li><strong>forwardRef for documents.</strong> The living-document components take a ref so the PDF exporter can read their DOM.</li>
          <li><strong>Custom hooks hold the business logic.</strong> <code>useInstitutionFeatures</code>, <code>useEffectiveInstitution</code>, <code>useUserRole</code>, the <code>dashboard/</code> family, and so on.</li>
          <li><strong>Project fork:</strong> <code>DialogContent</code> auto-wraps its children in a <code>ScrollArea</code>. Do not add another.</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">2.3 Design System</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1">
          <li>HSL custom properties for every colour and shadow, defined in BOTH <code>:root</code> and <code>.dark</code> in <code>src/index.css</code>. A token defined in only one place breaks the other theme.</li>
          <li>Brand primary <code>--brand-primary</code> is #249ca2 teal. <code>--brand-secondary</code> is lilac (257 35% 62%) in the live token set, despite older documents calling it orange; use an explicit hex when brand orange is wanted.</li>
          <li>Text uses <code>text-ink-*</code> tokens, never raw greys. Spacing stays on the 4/8/12/16/24 scale. No inline styles.</li>
          <li>Mobile-first, and every surface must work at 375px with dark mode fully flipped.</li>
          <li>No em-dashes in user-facing text: use a comma, a colon, "to" for ranges, or a middle dot for a tight join.</li>
          <li>Exam fullscreen goes through <code>src/lib/fullscreen.ts</code>, because iOS Safari throws synchronously otherwise.</li>
        </ul>
      </section>

      {/* 3. Backend Architecture */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">3. Backend Architecture (Supabase)</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.1 Supabase Services Used</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Service</th>
              <th className="border border-gray-300 p-2 text-left">Usage</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">PostgreSQL</td><td className="border border-gray-300 p-2">183 school-platform tables, 3 views, 260 functions, 458 migrations</td></tr>
            <tr><td className="border border-gray-300 p-2">Auth (GoTrue)</td><td className="border border-gray-300 p-2">Email and password sessions; login accepts email, phone or admission number, resolved server-side</td></tr>
            <tr><td className="border border-gray-300 p-2">Storage</td><td className="border border-gray-300 p-2">16 buckets (see section 6). Sensitive buckets are private and read through signed URLs or a broker function</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge Functions (Deno)</td><td className="border border-gray-300 p-2">37 school-platform functions plus a <code>_shared</code> module: AI, email, admin ops, Hybrid x5, Homework x3, Timetable x4, Support x1</td></tr>
            <tr><td className="border border-gray-300 p-2">Row Level Security</td><td className="border border-gray-300 p-2">Enabled on every scoped table; policies call SECURITY DEFINER helpers only</td></tr>
            <tr><td className="border border-gray-300 p-2">Realtime</td><td className="border border-gray-300 p-2">One channel per feature. The dashboard's single channel drives its "last updated" trust signal</td></tr>
            <tr><td className="border border-gray-300 p-2">pg_cron</td><td className="border border-gray-300 p-2">Attendance passes every 15 minutes, homework notification pass, other scheduled sweeps</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">3.2 RLS Policy Architecture</h3>
        <p className="text-gray-700 mb-2">Policies are built from SECURITY DEFINER predicates so they never recurse and never re-plan a cross-table EXISTS per row:</p>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li><code>(select auth.uid())</code>, wrapped so the planner treats it as a stable initplan rather than a per-row call</li>
          <li><code>has_role(user_id, role)</code> and <code>is_institution_admin(user_id, institution_id)</code></li>
          <li><code>is_coordinator_for_class()</code> for wing scope, <code>teacher_controls_student()</code> for subject scope</li>
          <li><code>institution_student_ids()</code> as the one canonical roster definition</li>
          <li><code>optional_choices_recorded()</code> as the dormancy gate on all optional-subject narrowing</li>
          <li>Institution scoping on essentially every query through <code>institution_id</code></li>
        </ul>
        <div className="bg-red-50 border-l-4 border-red-400 p-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Two RLS landmines this codebase has actually hit</p>
          <p>An inline cross-table <code>EXISTS</code> in a policy pair aborts with <code>42P17 infinite recursion detected in policy</code>. And an UPDATE policy with a <code>USING</code> clause but no <code>WITH CHECK</code> silently rejects every write: that shape rejected 100% of teachers' offline-marks saves for two days in August 2026.</p>
        </div>
      </section>

      {/* 4. Auth & Authorization */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">4. Authentication &amp; Authorization</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.1 Auth Flow</h3>
        <ol className="list-decimal list-inside text-gray-700 space-y-1 mb-4">
          <li>The user submits an identifier: email, phone or admission number</li>
          <li><code>resolve-login-identifier</code> resolves it to an email address</li>
          <li>Supabase Auth issues a session and JWT</li>
          <li>One hoisted <code>AuthProvider</code> holds the session, so route changes no longer flash the skeleton</li>
          <li><code>useUserRole()</code> reads <code>user_roles</code>; <code>ActiveRoleContext</code> derives <code>viewRoles</code> and defaults to <code>viewRoles[0]</code></li>
          <li><code>ProtectedRoute</code> checks role plus the feature gate before rendering</li>
          <li>The sidebar and dashboard tiles filter by enabled features</li>
        </ol>
        <p className="text-gray-700 mb-4 text-sm">
          Logout is deliberately more than <code>signOut()</code>: it purges the <code>sb-*-auth-token</code> localStorage keys, clears the on-device avatar cache, and hard-redirects with <code>window.location.replace</code>. Do not simplify it.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.2 Role Hierarchy</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Role</th>
              <th className="border border-gray-300 p-2 text-left">Scope</th>
              <th className="border border-gray-300 p-2 text-left">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">super_admin</td><td className="border border-gray-300 p-2">Platform-wide</td><td className="border border-gray-300 p-2">Full access, manages all institutions</td></tr>
            <tr><td className="border border-gray-300 p-2">super_school_admin</td><td className="border border-gray-300 p-2">Institution</td><td className="border border-gray-300 p-2">Owner role: school_admin parity plus oversight</td></tr>
            <tr><td className="border border-gray-300 p-2">school_admin</td><td className="border border-gray-300 p-2">Institution</td><td className="border border-gray-300 p-2">Manages classes, staff, students, exams</td></tr>
            <tr><td className="border border-gray-300 p-2">coordinator</td><td className="border border-gray-300 p-2">Wing</td><td className="border border-gray-300 p-2">Oversees assigned wings across all subjects, via wing_assignments x wing_class_mappings</td></tr>
            <tr><td className="border border-gray-300 p-2">teacher</td><td className="border border-gray-300 p-2">Class + subject</td><td className="border border-gray-300 p-2">Authority is the class-and-subject PAIR, not the class</td></tr>
            <tr><td className="border border-gray-300 p-2">student</td><td className="border border-gray-300 p-2">Own data</td><td className="border border-gray-300 p-2">Takes exams, views own results; cannot edit their own profile</td></tr>
            <tr><td className="border border-gray-300 p-2">employee</td><td className="border border-gray-300 p-2">Level-based</td><td className="border border-gray-300 p-2">Platform employees with tiered access</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.3 Teacher Authority Is Subject-Scoped</h3>
        <p className="text-gray-700 mb-3">
          <code>teacher_controls_student(teacher, student)</code> is the predicate for every teacher read and write except attendance. Sharing a class is not authority, and a <code>class_assignments</code> row with no <code>subject_id</code> grants nothing at all. Teachers see only their own subject's students on every surface.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">4.4 Dual Roles and Per-User Overrides</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li><strong>Dual-role users keep their scopes strictly separate.</strong> Teacher plus coordinator never unions the two lists; <code>isXOnly</code> booleans hide data rather than merge it. Teacher plus coordinator defaults to "teacher"; admin plus teacher defaults to "admin".</li>
          <li><strong>An admin may also teach.</strong> <code>grant_teacher_role</code> and <code>revoke_teacher_role</code> run from Manage Administrators and require at least one class-and-subject pair. The view toggle is presentation-only, because every server gate is an admin-first OR-union.</li>
          <li><strong>Four per-user capability grants raise one named user without a role change,</strong> each with its own table and check: <code>tt_manager_overrides</code> (read by <code>useIsTimetableManager</code>, enforced in SQL by <code>tt_is_timetable_manager()</code>), <code>staff_manager_overrides</code> (<code>is_staff_manager()</code>), <code>syllabus_manager_overrides</code> (<code>is_syllabus_manager()</code>) and <code>student_manager_overrides</code> (<code>is_student_manager()</code>).</li>
          <li><strong>Teacher dashboard scope</strong> resolves through <code>dash_resolve_teacher_pairs()</code>, never the admin-first ladder, or a teacher who is also an admin sees the whole school on their teacher view.</li>
        </ul>
      </section>

      {/* 5. Database Architecture */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">5. Database Architecture</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">5.1 Core Table Groups</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Group</th>
              <th className="border border-gray-300 p-2 text-left">Tables</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2 font-semibold">Identity</td><td className="border border-gray-300 p-2">profiles (with avatar_path), user_roles, user_preferences, employee_levels, institutions, student_personal_details (school-managed, students read-only, no DELETE policy), teacher_overrides, and the four <code>*_manager_overrides</code> tables</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Academic</td><td className="border border-gray-300 p-2">class_groups, classes (class_group_id NOT NULL), subjects, universal_subjects, subject_class_group_mappings, subject_class_mappings, class_assignments, class_assignment_deletions, wings, wing_assignments, wing_class_mappings, grade_levels (global), grade_subject_assignments, syllabus_topics, school_custom_topics, chapter_topics, topic_class_mappings, user_topic_orders, institution_hidden_topics, study_materials</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Syllabus delivery</td><td className="border border-gray-300 p-2">syllabus_progress_events, syllabus_sequence, syllabus_segments, syllabus_segment_chapters</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Examination</td><td className="border border-gray-300 p-2">exams (exam_mode, exam_type, is_results_only, source_paper_files, late_entry_minutes), exam_sections, exam_questions, exam_classes, exam_subjects, exam_topics, exam_templates, exam_publication_logs, evaluation_blueprints, question_bank, question_bank_section_scope, final_results (percentage is GENERATED ALWAYS, never write it), recheck_requests</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Attempts &amp; proctoring</td><td className="border border-gray-300 p-2">student_exam_attempts, student_answers, exam_attempt_logs, attempt_question_telemetry, attempt_section_telemetry, proctoring_sessions, proctoring_events, proctoring_review_logs, face_enrollments</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Hybrid exams <span className="text-xs font-normal text-gray-500 italic">(separate plane)</span></td><td className="border border-gray-300 p-2">hybrid_exam_attempts, hybrid_exam_attempt_logs, hybrid_exam_settings, hybrid_pairing_tokens, hybrid_answer_sheet_pages, hybrid_sheet_annotations, hybrid_question_marks, hybrid_proctoring_snapshots <span className="text-xs text-gray-500 italic">(phone companion unauthenticated: the pairing token IS the auth)</span></td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Offline marks &amp; OCR</td><td className="border border-gray-300 p-2">offline_student_marks, offline_section_marks <span className="text-xs text-gray-500 italic">(two DISTINCT pipelines, never cross)</span>, ocr_uploads, ocr_extractions, ocr_review_logs</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Homework</td><td className="border border-gray-300 p-2">homework_assignments, homework_assignment_classes, homework_assignment_subjects, homework_submissions, homework_submission_files, homework_results, homework_mark_audit, homework_notifications_sent <span className="text-xs text-gray-500 italic">(subject_id is ON DELETE RESTRICT)</span></td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">AI</td><td className="border border-gray-300 p-2">ai_evaluations, ai_usage_logs, ai_daily_usage, ai_monthly_usage, ai_usage_quotas, ai_config_changes, global_ai_config, teacher_ai_quotas, user_question_limits, ai_suggested_tasks</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Analytics</td><td className="border border-gray-300 p-2">class_aggregates, school_aggregates, teacher_aggregates, teacher_effectiveness, teacher_engagement_monthly, student_performance_snapshots, student_topic_performance, student_activity_daily, exam_insights, learning_actions, concept_mastery, concept_mastery_history, onboarding_snapshots</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Passport</td><td className="border border-gray-300 p-2">student_passport, passport_academic_records, passport_subject_capabilities</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Attendance &amp; leave</td><td className="border border-gray-300 p-2">attendance_records, attendance_sessions, attendance_settings, attendance_pins, biometric_enrollments, staff_attendance_records, leave_requests, staff_leave_requests, staff_leave_balances</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Timetable</td><td className="border border-gray-300 p-2">tt_period_structures, tt_period_slots, tt_class_structure, tt_resources, tt_slots, tt_substitutions, tt_lesson_plans (is_note_only), cal_academic_years, cal_events, holiday_calendar <span className="text-xs text-gray-500 italic">(seven legacy timetable tables were dropped; do not reference them)</span></td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Optional subjects</td><td className="border border-gray-300 p-2">optional_groups, optional_group_subjects, student_optional_enrollments, optional_band_slots, optional_batches, optional_batch_students <span className="text-xs text-gray-500 italic">(the batches pair is a superseded plane)</span></td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Notices &amp; messaging</td><td className="border border-gray-300 p-2">notices, notice_target_classes, notice_target_wings, notice_recipients, conversations, conversation_messages, conversation_participants, communication_templates, institution_communication_settings, notifications, notification_queue, push_subscriptions</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Support</td><td className="border border-gray-300 p-2">reported_issues, support_messages, support_settings</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Tasks</td><td className="border border-gray-300 p-2">tasks, task_assignments (task_id NOT NULL UNIQUE), task_supervisors, task_comments, task_evidence, task_links, task_audit_logs</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Finance &amp; HR</td><td className="border border-gray-300 p-2">fee_structures, fee_categories, fee_installments, fee_concessions, fee_receipts, student_fee_assignments, payment_records, payment_receipts, payroll_runs, payroll_entries, staff_salary_structures, staff_salary_assignments, staff_documents</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Gamification</td><td className="border border-gray-300 p-2">badge_definitions, badge_progress, user_badges</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Dashboards</td><td className="border border-gray-300 p-2">dashboard_flags <span className="text-xs text-gray-500 italic">(written by the 20-flag evaluator, see section 17)</span></td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Platform</td><td className="border border-gray-300 p-2">institution_features, institution_subscriptions, subscription_alerts, institution_symbol_usage, contact_submissions, demo_requests, system_audit_logs, user_activity_log, appointments, ptm_schedules, ptm_bookings, student_groups, student_remarks, parent_student_links</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">5.2 Key Relationships</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li><code>profiles</code> to <code>user_roles</code> is one-to-many: a user can hold more than one role</li>
          <li><code>institutions</code> reaches every scoped table through <code>institution_id</code></li>
          <li><code>class_groups</code> contains <code>classes</code> ("Class 10" above 10A/10B/10C)</li>
          <li><code>subject_class_group_mappings</code> fans out by trigger into <code>subject_class_mappings</code></li>
          <li><code>exams</code> to <code>exam_sections</code> to <code>exam_questions</code>, hierarchical, with self-referencing sub-questions</li>
          <li><code>student_exam_attempts</code> to <code>student_answers</code> to <code>ai_evaluations</code> is the evaluation chain</li>
          <li><code>classes</code> and <code>profiles</code> meet at <code>class_assignments</code>, carrying both role and <code>subject_id</code></li>
          <li><code>question_bank</code> plus <code>question_bank_section_scope</code>: zero scope rows means class-wide</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">5.3 Generated Columns</h3>
        <p className="text-gray-700 mb-3">
          <code>final_results.percentage</code> is <code>NUMERIC(5,2) GENERATED ALWAYS AS (...) STORED</code>. Including it in an INSERT or UPSERT raises "cannot insert a non-DEFAULT value" and the row is <strong>not written</strong>. Never include it, and never swallow a <code>final_results</code> write error with a console log: always throw. A success toast over zero inserted rows is exactly how results silently vanished in April 2026. The same rule applies to any computed column: read the migration DDL before writing.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">5.4 Views</h3>
        <p className="text-gray-700">
          Three views: <code>student_eligible_exams</code>, <code>v_class_groups_with_sections</code> and <code>v_subject_class_mappings_unified</code>. All three are <code>security_invoker=on</code> so they evaluate RLS as the caller. A view that gates on the caller must never be flipped back to definer semantics.
        </p>
      </section>

      {/* 6. Storage */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">6. Storage Architecture</h2>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Bucket</th>
              <th className="border border-gray-300 p-2 text-left">Purpose</th>
              <th className="border border-gray-300 p-2 text-left">Access</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">user-avatars</td><td className="border border-gray-300 p-2">Profile photos</td><td className="border border-gray-300 p-2">Private. Every read is authorised by can_view_user_photo; writes are checked by can_set_user_photo plus a path-ownership trigger. There is no public profile-photos bucket</td></tr>
            <tr><td className="border border-gray-300 p-2">question-images</td><td className="border border-gray-300 p-2">Question and per-option diagrams</td><td className="border border-gray-300 p-2">Authenticated read, author write; bucket-level size limits</td></tr>
            <tr><td className="border border-gray-300 p-2">exam-sheets</td><td className="border border-gray-300 p-2">Source papers for results-only exams</td><td className="border border-gray-300 p-2">Institution-scoped RLS</td></tr>
            <tr><td className="border border-gray-300 p-2">answer-sheets</td><td className="border border-gray-300 p-2">Scanned answer sheets for OCR</td><td className="border border-gray-300 p-2">Teacher upload, function read</td></tr>
            <tr><td className="border border-gray-300 p-2">hybrid-answer-sheets</td><td className="border border-gray-300 p-2">Phone-captured hybrid pages</td><td className="border border-gray-300 p-2">Written by the hybrid upload functions</td></tr>
            <tr><td className="border border-gray-300 p-2">homework-files</td><td className="border border-gray-300 p-2">Homework submissions</td><td className="border border-gray-300 p-2">Owner-only. Markers read through the homework-file-url signed-URL broker</td></tr>
            <tr><td className="border border-gray-300 p-2">notice-attachments</td><td className="border border-gray-300 p-2">Notice Board attachments</td><td className="border border-gray-300 p-2">Private, audience-scoped</td></tr>
            <tr><td className="border border-gray-300 p-2">message-attachments</td><td className="border border-gray-300 p-2">Conversation attachments</td><td className="border border-gray-300 p-2">Participant-scoped</td></tr>
            <tr><td className="border border-gray-300 p-2">study-materials</td><td className="border border-gray-300 p-2">Subject and Parts PDFs</td><td className="border border-gray-300 p-2">Institution-scoped read</td></tr>
            <tr><td className="border border-gray-300 p-2">staff-documents</td><td className="border border-gray-300 p-2">HR documents</td><td className="border border-gray-300 p-2">HR and owner only</td></tr>
            <tr><td className="border border-gray-300 p-2">task-evidence, task-voice-comments</td><td className="border border-gray-300 p-2">Task completion evidence and voice notes</td><td className="border border-gray-300 p-2">Task participants</td></tr>
            <tr><td className="border border-gray-300 p-2">proctoring-screenshots, face-photos</td><td className="border border-gray-300 p-2">Proctoring captures, face enrolment</td><td className="border border-gray-300 p-2">Private, staff read</td></tr>
            <tr><td className="border border-gray-300 p-2">institution-logos</td><td className="border border-gray-300 p-2">Institution branding</td><td className="border border-gray-300 p-2">Public read, admin write</td></tr>
            <tr><td className="border border-gray-300 p-2">circular-attachments</td><td className="border border-gray-300 p-2">Legacy circular documents</td><td className="border border-gray-300 p-2">Institution scoped. Superseded by notice-attachments</td></tr>
          </tbody>
        </table>
      </section>

      {/* 7. Edge Functions */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">7. Edge Functions (Serverless)</h2>
        <p className="text-gray-700 mb-3">37 Deno functions serve the school platform, plus a shared module. Core functions:</p>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Function</th>
              <th className="border border-gray-300 p-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">admin-operations</td><td className="border border-gray-300 p-2">Multi-action admin API: AI config, quotas, user creation and deletion</td></tr>
            <tr><td className="border border-gray-300 p-2">generate-questions</td><td className="border border-gray-300 p-2">AI question generation with grade calibration and cost routing</td></tr>
            <tr><td className="border border-gray-300 p-2">auto-grade-submission</td><td className="border border-gray-300 p-2">AI evaluation of student answers</td></tr>
            <tr><td className="border border-gray-300 p-2">process-ocr-upload</td><td className="border border-gray-300 p-2">OCR for scanned offline sheets</td></tr>
            <tr><td className="border border-gray-300 p-2">generate-exam-insights / generate-learning-actions / generate-predictions</td><td className="border border-gray-300 p-2">Per-student insight, recommendation and forecast generation</td></tr>
            <tr><td className="border border-gray-300 p-2">generate-principal-ai-insights / generate-principal-tasks</td><td className="border border-gray-300 p-2">School-level AI analytics and suggested tasks</td></tr>
            <tr><td className="border border-gray-300 p-2">compute-aggregates</td><td className="border border-gray-300 p-2">Class-level score aggregation</td></tr>
            <tr><td className="border border-gray-300 p-2">resolve-login-identifier</td><td className="border border-gray-300 p-2">Email, phone or admission-number login resolution</td></tr>
            <tr><td className="border border-gray-300 p-2">invite-admin / promote-students</td><td className="border border-gray-300 p-2">Admin provisioning and batch year promotion</td></tr>
            <tr><td className="border border-gray-300 p-2">import-syllabus / import-syllabus-csv</td><td className="border border-gray-300 p-2">Syllabus bulk import</td></tr>
            <tr><td className="border border-gray-300 p-2">send-web-push / send-communication / broadcast-email</td><td className="border border-gray-300 p-2">Push and email dispatch</td></tr>
            <tr><td className="border border-gray-300 p-2">send-welcome-email / send-fee-reminder / send-task-notifications</td><td className="border border-gray-300 p-2">Transactional and scheduled email</td></tr>
            <tr><td className="border border-gray-300 p-2">support-notify-email</td><td className="border border-gray-300 p-2">Support replies and status changes, behind an origin allowlist, authorising the recipient</td></tr>
            <tr><td className="border border-gray-300 p-2">mark-biometric-attendance</td><td className="border border-gray-300 p-2">Biometric device intake</td></tr>
            <tr><td className="border border-gray-300 p-2">mascot-chat / snapshot-student-passport</td><td className="border border-gray-300 p-2">Student chatbot and passport snapshotting</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">7.1 Hybrid Exam Family (5)</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Function</th><th className="border border-gray-300 p-2 text-left">Purpose</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">generate-hybrid-pairing-token / validate-hybrid-pairing-token</td><td className="border border-gray-300 p-2">Mint and verify the phone-companion token, which IS the authorisation</td></tr>
            <tr><td className="border border-gray-300 p-2">upload-hybrid-page / upload-hybrid-sheet</td><td className="border border-gray-300 p-2">Ingest captured pages and assembled sheets</td></tr>
            <tr><td className="border border-gray-300 p-2">publish-hybrid-marks</td><td className="border border-gray-300 p-2">Publish marked hybrid results</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">7.2 Homework Family (3)</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Function</th><th className="border border-gray-300 p-2 text-left">Purpose</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">submit-homework</td><td className="border border-gray-300 p-2">Student submission intake</td></tr>
            <tr><td className="border border-gray-300 p-2">homework-file-url</td><td className="border border-gray-300 p-2">Signed-URL broker so markers can read owner-only submission files</td></tr>
            <tr><td className="border border-gray-300 p-2">homework-notify-pass</td><td className="border border-gray-300 p-2">Cron pass for due and published homework</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">7.3 Timetable Family (4)</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Function</th><th className="border border-gray-300 p-2 text-left">Purpose</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">copy-timetable-template</td><td className="border border-gray-300 p-2">Clone a period structure across classes or into the next academic year, preserving custom_label</td></tr>
            <tr><td className="border border-gray-300 p-2">get-working-days</td><td className="border border-gray-300 p-2">Resolve working days from the academic calendar</td></tr>
            <tr><td className="border border-gray-300 p-2">tt-notify-substitute / tt-notify-absence-pending</td><td className="border border-gray-300 p-2">Substitution and pending-absence notifications</td></tr>
          </tbody>
        </table>

        <div className="bg-sky-50 border-l-4 border-sky-400 p-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Invoke contract</p>
          <p>Every <code>admin-operations</code> call site goes through <code>invokeAdminOperation</code> in <code>src/lib/invokeEdgeFunction.ts</code>, a direct authenticated fetch, because <code>supabase.functions.invoke</code> sends an empty Bearer token in this client setup and produced spurious 403s. It reads the token from the local session, sets both <code>Authorization</code> and <code>apikey</code>, refreshes an expired token and retries once on a 401, and throws any <code>{"{ error }"}</code> body as a real Error so <code>toastError</code> can translate it.</p>
        </div>
      </section>

      {/* 8. AI Integration */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">8. AI Integration Layer</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">8.1 AI Services</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-4">
          <li><strong>Question generation</strong> from syllabus chapters, calibrated to the resolved grade</li>
          <li><strong>Auto-grading</strong> of subjective answers with confidence scores and keyword matching</li>
          <li><strong>OCR</strong> digitisation of scanned answer sheets, then auto-evaluation</li>
          <li><strong>Exam insights</strong>: strengths, weaknesses and study tips per student</li>
          <li><strong>Learning actions</strong>: recommendations derived from concept mastery</li>
          <li><strong>Performance predictions</strong> for future exams</li>
          <li><strong>Principal insights</strong>: school-wide analysis for administrators</li>
          <li><strong>Mascot chat</strong>: a learning-support chatbot for students</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">8.2 Two-Path AI Architecture</h3>
        <p className="text-gray-700 mb-2">AI plumbing splits into two distinct paths. No Anthropic model runs in production:</p>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Path</th>
              <th className="border border-gray-300 p-2 text-left">Used by</th>
              <th className="border border-gray-300 p-2 text-left">Provider and config</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Configurable provider</td><td className="border border-gray-300 p-2"><code>generate-questions</code></td><td className="border border-gray-300 p-2"><code>supabase/functions/_shared/aiProvider.ts</code>, keyed on the <code>AI_PROVIDER</code> env (<code>openai</code> by default, or <code>gemini</code>)</td></tr>
            <tr><td className="border border-gray-300 p-2">Lovable AI gateway</td><td className="border border-gray-300 p-2"><code>auto-grade-submission</code>, <code>process-ocr-upload</code>, <code>generate-predictions</code>, <code>generate-exam-insights</code>, <code>generate-principal-ai-insights</code>, <code>mascot-chat</code></td><td className="border border-gray-300 p-2"><code>ai.gateway.lovable.dev</code> (secret <code>LOVABLE_API_KEY</code>) running Google Gemini</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">8.3 Question Generation Invariants</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-4">
          <li><strong>Model.</strong> Production runs <code>gpt-5-mini</code> at <code>medium</code> reasoning effort (secrets <code>OPENAI_MODEL</code> and <code>OPENAI_REASONING_EFFORT</code>). Effort must never be lowered to <code>low</code>: that was hand-verified to produce mathematically wrong MCQs.</li>
          <li><strong>Cost routing.</strong> Only Maths and the science family reach the reasoning model; other subjects use <code>OPENAI_MODEL_BASIC</code>. An institution can be opted out through <code>REASONING_SCIENCE_EXCLUDE_INSTITUTIONS</code>.</li>
          <li><strong>No difficulty selector.</strong> Difficulty is hardcoded to 5, "always hardest, calibrated to grade level".</li>
          <li><strong>Grade must reach the prompt.</strong> It resolves from the chapter (<code>syllabus_topics.grade_level_id</code>) with the class as fallback. When it did not, every generation said "Grade Level: General" and a Nursery letter-recognition chapter produced persuasive-writing questions. Class 1 and below clamp to difficulty 2 or 3, get an early-years rule block, and bypass the reasoning model. Pre-primary grade numbers are negative.</li>
          <li><strong>KaTeX is mandatory.</strong> Plain-text maths is a hard fail, and <code>repairLatexEscapes()</code> must run before <code>JSON.parse</code> because an unescaped <code>\f</code> becomes a form feed and destroys the LaTeX irrecoverably.</li>
          <li><strong>Delivery guards.</strong> An automatic top-up covers LLM under-delivery, and a single-flight add guard prevents duplicate questions. Removing either reopens a shipped bug.</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">8.4 Quota Management</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1">
          <li>Per-institution daily and monthly question and token limits (<code>ai_usage_quotas</code>, <code>ai_daily_usage</code>, <code>ai_monthly_usage</code>)</li>
          <li>A per-user daily question cap in <code>user_question_limits</code>, so one teacher cannot exhaust a school's budget</li>
          <li>Feature toggles per institution for question generation and OCR</li>
          <li>Keys held in Supabase secrets and managed from Settings. Provider billing auto-recharge must stay on: an exhausted balance produced a platform-wide 429</li>
        </ul>
      </section>

      {/* 9. Real-time */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">9. Real-time Features</h2>
        <ul className="list-disc list-inside text-gray-700 space-y-1">
          <li><strong>Notifications</strong> delivered over Supabase Realtime</li>
          <li><strong>Messaging</strong>: live conversation updates</li>
          <li><strong>Dashboard trust signal</strong>: one channel per dashboard drives the "last updated" indicator and its retry control</li>
          <li><strong>Push notifications</strong>: Web Push through the service worker for background alerts</li>
          <li><strong>Exam monitoring</strong>: live proctoring events and violation detection at a sanctioned 5s poll</li>
        </ul>
        <p className="text-gray-700 text-sm mt-3">One channel per feature, never one per component. Where a poll will do, <code>refetchInterval: 60_000</code> is preferred over a new subscription, and every subscribing effect must clean up.</p>
      </section>

      {/* 10. Deployment */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">10. Deployment &amp; Infrastructure</h2>
        <ul className="list-disc list-inside text-gray-700 space-y-1">
          <li><strong>Frontend hosting</strong>: Vite build to static assets, CDN distributed</li>
          <li><strong>Backend</strong>: Supabase managed PostgreSQL, Auth, Storage and Edge</li>
          <li><strong>Migrations</strong>: version-controlled SQL in <code>supabase/migrations/</code> (458 files)</li>
          <li><strong>Environment variables</strong>: <code>VITE_</code> prefixed for the client, Supabase secrets for functions. Backend secrets never enter the frontend</li>
          <li><strong>Dual production frontends</strong>: two distinct web frontends share the single Supabase project. Never hardcode one domain, and never narrow a CORS allow-list to one of them, in shared code</li>
          <li><strong>Separate deployments exist</strong> for other SALCI products in their own repositories and Supabase projects. A change here does not reach them</li>
          <li><strong>Service worker</strong>: registration is production-only; the development branch self-heals by unregistering service workers and deleting <code>salci-*</code> caches (see section 13)</li>
          <li><strong>Institution-local timezone</strong>: <code>institutions.timezone</code> (default Asia/Kolkata) is the single source of truth for every wall-clock comparison. Database code uses <code>(now() AT TIME ZONE i.timezone)</code>, never a bare <code>now()::time</code> or <code>CURRENT_DATE</code>. Attendance auto-mark runs through <code>tt_run_attendance_pass_for_institution(uuid)</code> on a 15-minute cron plus a session-guarded page-view kick</li>
          <li><strong>Compute sizing</strong>: the high-concurrency floor is Medium minimum, Large at 1K and XL at 10K concurrent users. Compute has not yet been raised to that floor and remains the largest open infrastructure item (see section 21)</li>
          <li><strong>Branching</strong>: the ERP build-out runs on two long-lived branches cut from main since 2026-09-07, merged centrally</li>
        </ul>
      </section>

      {/* 11. Class Groups */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">11. Class Groups Architecture</h2>
        <p className="text-gray-700 mb-3">
          Section rows in <code>classes</code> sit under a parent <code>class_groups</code> row: "Class 10" contains 10A, 10B and 10C. The refactor is additive and fully shipped.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">11.1 Scope by Level</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Concept</th>
              <th className="border border-gray-300 p-2 text-left">Level</th>
              <th className="border border-gray-300 p-2 text-left">Tables</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Parent container</td><td className="border border-gray-300 p-2">Class group</td><td className="border border-gray-300 p-2"><code>class_groups</code> + <code>classes.class_group_id NOT NULL</code></td></tr>
            <tr><td className="border border-gray-300 p-2">Subject catalog</td><td className="border border-gray-300 p-2">Class group (shared)</td><td className="border border-gray-300 p-2"><code>subject_class_group_mappings</code>, fanned out into <code>subject_class_mappings</code></td></tr>
            <tr><td className="border border-gray-300 p-2">Chapters and topics</td><td className="border border-gray-300 p-2">Class group (shared)</td><td className="border border-gray-300 p-2"><code>syllabus_topics</code>, <code>chapter_topics.class_group_id</code>, <code>topic_class_mappings.class_group_id</code></td></tr>
            <tr><td className="border border-gray-300 p-2">Question bank</td><td className="border border-gray-300 p-2">Class group + optional section</td><td className="border border-gray-300 p-2"><code>question_bank.class_group_id</code> + <code>question_bank_section_scope</code></td></tr>
            <tr><td className="border border-gray-300 p-2">Teachers, attendance, timetable, lessons, materials, exams</td><td className="border border-gray-300 p-2">Section</td><td className="border border-gray-300 p-2"><code>class_assignments</code>, <code>attendance_*</code>, <code>tt_slots</code>, <code>tt_lesson_plans</code>, <code>study_materials</code>, <code>exam_classes</code></td></tr>
            <tr><td className="border border-gray-300 p-2">Fees</td><td className="border border-gray-300 p-2">Section (not migrated)</td><td className="border border-gray-300 p-2"><code>fee_structures</code>, <code>student_fee_assignments</code></td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">11.2 Trigger-Backed Fanout</h3>
        <p className="text-gray-700 mb-2">
          Writing to <code>subject_class_group_mappings</code> is the canonical entry point. An AFTER INSERT/UPDATE/DELETE SECURITY DEFINER trigger materialises one row per child section into the legacy <code>subject_class_mappings</code> table, preserving the dual-table invariant that <code>useTeacherAssignedSubjects</code>, <code>useClassSubjects</code> and several RLS joins depend on.
        </p>
        <p className="text-gray-700 mb-3">
          <strong>Never write <code>subject_class_mappings</code> directly.</strong> Doing so desyncs the catalog and blacks out a teacher's entire portal. Both <code>AddSubjectPopover</code> and the teacher-assignment dialog use the shared write path.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">11.3 Grade Level Resolution</h3>
        <p className="text-gray-700 mb-3">
          <code>grade_levels</code> is <strong>global</strong>, with no <code>institution_id</code>. Resolve <code>grade_level_id</code> by name regex and never filter by institution. Never treat a stream's <code>grade_number</code> as a grade: those are sequence numbers, and that mistake once put 133 class groups on the wrong grade level. Pre-primary grade numbers are negative, from Pre Nursery at -4 up to UKG at -1 or 0.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">11.4 Question Bank Scope Semantics</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li>Zero scope rows means <strong>class-wide</strong>: every teacher of the class group sees it, and so do students in the group</li>
          <li>One or more scope rows means <strong>section-scoped</strong>: only teachers whose <code>class_assignments.class_id</code> matches</li>
          <li><code>class_group_id IS NULL</code> is the legacy institution-wide fallback</li>
          <li>Admins and coordinators see the full pool; students see class-wide only</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">11.5 RLS Recursion Guard</h3>
        <p className="text-gray-700">
          The <code>question_bank</code> SELECT policy and the <code>question_bank_section_scope</code> policies reference each other. An inline <code>EXISTS</code> subquery over the other table reopens a cycle that aborts with <code>42P17 infinite recursion detected in policy</code>. Both policies must call the SECURITY DEFINER helpers <code>question_has_section_scope</code>, <code>user_is_in_question_scope</code> and <code>get_question_institution_id</code>.
        </p>
      </section>

      {/* 12. Error Translation */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">12. Error Translation Pipeline</h2>
        <p className="text-gray-700 mb-3">
          Every <code>onError</code> and every <code>catch</code>-toast routes through <code>toastError(err, &#123; fallback, context &#125;)</code> from <code>src/lib/toast.ts</code>. <code>toast</code> from sonner is for success and info only. Raw Postgres strings never surface to a user.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">12.1 Postgres Code Mapping</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Code</th>
              <th className="border border-gray-300 p-2 text-left">User message</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2"><code>23503</code> foreign key violation</td><td className="border border-gray-300 p-2">"Can't complete this, something it depends on is missing."</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>23505</code> unique violation</td><td className="border border-gray-300 p-2">"This already exists."</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>42501</code> or an RLS rejection</td><td className="border border-gray-300 p-2">"You don't have permission…"</td></tr>
          </tbody>
        </table>
        <p className="text-gray-700 mb-3 text-sm">
          Domain-specific copy stays inline by regex-testing first and then falling back to <code>toastError</code>. A preflight <code>throw new Error("Grade 12 isn't set up yet…")</code> passes through unchanged, because <code>isLikelyUserFriendly()</code> lets short non-technical messages by.
        </p>

        <div className="bg-red-50 border-l-4 border-red-400 p-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Error state renders BEFORE empty state</p>
          <p>A failed query resolving as "zero rows" is this codebase's single most common defect. 73 teacher surfaces were swept in August 2026 and five were rendering a failure as an empty school. Never destructure <code>data</code> from <code>useQuery</code> without also handling <code>error</code>, and the error state must cover the stat tiles and headers, not just the list.</p>
        </div>
      </section>

      {/* 13. Service Worker */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">13. Service Worker Update Mechanism</h2>
        <p className="text-gray-700 mb-3">
          The cache name used to be hardcoded, so deploys produced a byte-identical <code>sw.js</code>, <code>controllerchange</code> never fired, and installed PWAs sat on stale builds for days. The fix is a three-file contract:
        </p>
        <ol className="list-decimal list-inside text-gray-700 space-y-2 mb-3">
          <li><code>public/sw.js</code> keeps the literal token <code>__BUILD_ID__</code> inside <code>const CACHE = 'salci-__BUILD_ID__'</code>. <code>install</code> calls <code>self.skipWaiting()</code> and <code>activate</code> calls <code>clients.claim()</code>.</li>
          <li><code>vite.config.ts</code> holds <code>swBuildIdPlugin</code>, which rewrites that token in <code>dist/sw.js</code> on every production build.</li>
          <li><code>src/main.tsx</code> calls <code>registration.update()</code> on <code>visibilitychange</code> and hourly, capturing whether a controller already existed <em>before</em> registering, so a first-ever visit does not refresh itself.</li>
        </ol>
        <p className="text-gray-700">
          <strong>Dirty-form coordination:</strong> <code>controllerchange</code> auto-reloads only when no <code>form[data-dirty="true"]</code> exists. Otherwise it dispatches <code>salci-update-ready</code> and the app shows a refresh prompt. Any form with unsaved input MUST set <code>data-dirty="true"</code>.
        </p>
      </section>

      {/* 14. Cascade Contract */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">14. User Deletion Cascade Contract</h2>
        <p className="text-gray-700 mb-3">
          Deleting a profile goes through <code>admin-operations</code>, which calls <code>auth.admin.deleteUser(userId)</code> and relies on the cascade chain <code>auth.users → profiles → every FK pointing at profiles(id)</code>.
        </p>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Action</th>
              <th className="border border-gray-300 p-2 text-left">Applies to</th>
              <th className="border border-gray-300 p-2 text-left">Reasoning</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2"><strong>CASCADE</strong></td><td className="border border-gray-300 p-2">user_id, student_id, teacher_id, parent_id, assignee_id, participant_id</td><td className="border border-gray-300 p-2">The row belongs to the user and goes with them</td></tr>
            <tr><td className="border border-gray-300 p-2"><strong>SET NULL</strong></td><td className="border border-gray-300 p-2">created_by, published_by, reviewed_by, approved_by, actor_id, sender_id, uploaded_by, supervisor_id</td><td className="border border-gray-300 p-2">The row survives with its author unknown</td></tr>
          </tbody>
        </table>
        <p className="text-gray-700">
          <strong>Invariant for every new FK to profiles(id):</strong> declare an explicit <code>ON DELETE</code>. Never leave it at the <code>NO ACTION</code> default, and never combine <code>SET NULL</code> with <code>NOT NULL</code>: the cascade tries to write NULL, the constraint raises, and the entire delete aborts.
        </p>
      </section>

      {/* 15. Transactional Write Contract */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">15. Transactional Write Contract</h2>
        <p className="text-gray-700 mb-3">
          Client code must never DELETE-then-INSERT a relationship table. In August 2026 that pattern silently wiped two teachers' entire portals with no audit trail. Two or more dependent writes are <strong>one RPC</strong>, never sequential client calls.
        </p>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Helper</th><th className="border border-gray-300 p-2 text-left">What it guards</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2"><code>setStaffClassAssignments</code>, <code>setClassTeachers</code></td><td className="border border-gray-300 p-2">Staff to class and subject assignment. Diffs in one transaction and logs the delta to <code>class_assignment_deletions</code>, which has no FKs so it survives cascades</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>deleteInstitutionSubject</code>, <code>unassignSubjectFromClass</code></td><td className="border border-gray-300 p-2">Subject removal, naming its blockers before writing anything</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>set_student_class</code></td><td className="border border-gray-300 p-2">Moving a student, with authority checked at both the source and the destination</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>review_student_leave</code></td><td className="border border-gray-300 p-2">The only leave decision path: it corrects attendance retroactively and notifies</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>record_syllabus_progress</code>, <code>tt_record_period_note</code></td><td className="border border-gray-300 p-2">The only syllabus-progress and note-only lesson write paths</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>create_task_group</code></td><td className="border border-gray-300 p-2">Multi-assignee fan-out: N task rows sharing one <code>task_group_id</code>, in one transaction</td></tr>
            <tr><td className="border border-gray-300 p-2"><code>post_support_message</code>, <code>_support_apply_status</code></td><td className="border border-gray-300 p-2">The single idempotent message and status write paths for support</td></tr>
          </tbody>
        </table>
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Two rules that follow from this</p>
          <p>Any save that removes existing rows must confirm first, naming exactly what it will remove. And a PostgREST DELETE blocked by RLS looks identical to success (empty data, no error), so for permission-sensitive deletes, re-SELECT by id and treat "the row is gone" as the only proof.</p>
        </div>
      </section>

      {/* 16. Hybrid / Results-Only / Homework */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">16. Hybrid, Results-Only &amp; Homework Data Planes</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">16.1 Hybrid Exam Mode</h3>
        <p className="text-gray-700 mb-2">
          Hybrid exams run on a <strong>separate data plane</strong>, the <code>hybrid_*</code> family, which never crosses <code>student_exam_attempts</code>, <code>student_answers</code> or <code>final_results</code>. A student answers on paper while a <strong>phone companion</strong> captures the sheet. That companion is deliberately <strong>unauthenticated</strong>: the pairing token itself is the authorisation.
        </p>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li>The pairing functions mint and verify the token; the upload functions ingest pages into <code>hybrid_answer_sheet_pages</code></li>
          <li>Marking is a guided one-question-at-a-time flow with a CBSE-style marks stamp, a per-question accordion, aspect-correct annotations and voice-dictated feedback, and it works on a phone</li>
          <li><code>publish-hybrid-marks</code> finalises; student reads go through the sanitised <code>get_exam_paper</code> so the answer key never ships to the client</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">16.2 Results-Only (Already-Created) Exams</h3>
        <p className="text-gray-700 mb-3">
          For a paper conducted entirely offline, <code>exams.is_results_only</code> flags the exam and <code>exams.source_paper_files</code> (a column on <code>exams</code>, not a table) holds the uploaded paper. Marks flow through <strong>two distinct pipelines that must never cross</strong>: <code>offline_student_marks</code> per student and <code>offline_section_marks</code> per section, each with its own query keys. Rows carry an explicit Absent state and stay editable after results publish.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">16.3 Homework Module</h3>
        <p className="text-gray-700">
          Eight <code>homework_*</code> tables back assignments, multi-class and multi-subject targeting, submissions with files, results, mark audit and notification tracking. <code>homework.subject_id</code> is <strong>ON DELETE RESTRICT</strong>. Submission storage is owner-only, so markers read through the <code>homework-file-url</code> signed-URL broker. The marking roster RPC needs <code>::text</code> casts or it raises 42804. A publish gate and an auto-check cron complete the loop.
        </p>
      </section>

      {/* 17. Command Center */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">17. Command Center &amp; Scoped Dashboards</h2>
        <p className="text-gray-700 mb-3">
          The school-admin <strong>Command Center</strong> and the coordinator and teacher <strong>Snapshot</strong> share one set of components through a <code>DashboardScope</code> context. The admin surface was rebuilt to a principal-first blueprint through August 2026: a bento overview, two deliberately separate KPI rows, a SQL-derived insights digest collapsed by default, six anchored sections and per-card filters.
        </p>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li><strong>Three parallel RPC families.</strong> <code>dash_*</code> for the admin, <code>dash_scoped_*</code> for coordinators (resolved by <code>dash_resolve_scoped_classes</code>) and <code>dash_teacher_*</code> for teachers (resolved by <code>dash_resolve_teacher_pairs</code>). 79 <code>dash_*</code> functions exist today. Every hook needs its variants with <code>scope</code> in the query key, and you must never branch on <code>scope === "scoped"</code> for teachers.</li>
          <li><strong>20-flag evaluator</strong> writes <code>dashboard_flags</code>. There is no cron, so freshness depends on the admin on-open kick. Flag-created tasks are always attributed to "SALCI System", never to the admin who opened the page.</li>
          <li><strong>Hand-rolled tile gating.</strong> Dashboards that render tiles outside <code>NavigationHub</code> must wrap each feature tile in <code>isFeatureEnabled()</code> by hand.</li>
          <li><strong>Never</strong> mount <code>useCommandCenter</code> outside <code>CbseReportsModal</code>.</li>
        </ul>
      </section>

      {/* 18. Syllabus delivery */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">18. Syllabus Delivery: Two Timelines</h2>
        <p className="text-gray-700 mb-3">
          Syllabus delivery is modelled as two timelines rather than one percentage. The <strong>actual jar</strong> is an append-only stream of chapter-level <code>syllabus_progress_events</code>, written by exactly one RPC, <code>record_syllabus_progress</code>. The <strong>projection</strong> walks <code>syllabus_sequence</code> forward over the timetable to say where a class should be. Both lines render on the teacher and student week grids, so slippage is visible rather than inferred.
        </p>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li><strong>Non-blocking backlog.</strong> An unlogged past lesson raises a check-in backlog sheet rather than a login gate. Capture happens at check-out.</li>
          <li><strong>Note-only periods.</strong> A chapterless period (a surprise test, an activity) is logged by <code>tt_record_period_note</code> with <code>is_note_only=true</code>. It reads as Logged on the week chips, resolves the day for check-out and for the SY1 flag, and is hidden from students, who see only <code>session_type=&apos;teaching&apos;</code>.</li>
          <li><strong>Duplicated predicate.</strong> The "was this day logged?" OR-predicate lives in both <code>teacher_pending_syllabus_days</code> and <code>dash_evaluate_syllabus_flags</code> and the two must stay byte-for-byte equivalent.</li>
          <li><strong>Corrections mode</strong> allows a mistaken completion to be deleted; chapter completion must not overwrite a note-only period.</li>
          <li><strong>Segmentation (Parts).</strong> <code>syllabus_segments</code> and <code>syllabus_segment_chapters</code> split a subject's syllabus into named parts such as PA1 or Term 1, scoped to class group plus subject, behind the <code>syllabus_segmentation</code> flag.</li>
        </ul>
      </section>

      {/* 19. Notices, Messaging & Support */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">19. Notices, Messaging &amp; Support</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">19.1 Notice Board</h3>
        <p className="text-gray-700 mb-3">
          Circulars were renamed to notices and rebuilt as a hierarchy-scoped audience engine. A notice targets classes and wings through junction tables; <code>publish_notice</code> expands that into a <strong>materialised</strong> <code>notice_recipients</code> set, which is what makes read receipts, inbox and outbox feeds and the reach rollup cheap to query. RLS enforces the scope in the database, which is what closed the leak where a teacher's class notice reached co-teachers. Attachments live in a private bucket.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">19.2 Messaging</h3>
        <p className="text-gray-700 mb-3">
          Direct, group and class-wide conversations. Bulk Send was rebuilt as a Messages tab riding the same audience engine, and it sends real direct messages rather than collapsing everyone into one group thread. The admin Communication page's Templates tab was removed in September 2026; the table remains but has no send path.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">19.3 Salci Support</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1">
          <li><code>reported_issues</code> holds the ticket, <code>support_messages</code> holds the thread, including a guarded internal-note channel that reporters never see</li>
          <li>Two single write paths: <code>post_support_message</code> (idempotent) and <code>_support_apply_status</code>. Status changes never bypass them</li>
          <li>Every support RPC has EXECUTE revoked from PUBLIC <em>and</em> from <code>anon</code> by name, verified against <code>information_schema.routine_privileges</code></li>
          <li>A ticket becomes a real task, and the task panel deep-links back into the conversation</li>
          <li><code>support-notify-email</code> emails the reporter on each status change and reply, behind an origin allowlist, authorising the recipient rather than only the ticket</li>
          <li>One reporter door at <code>/support</code> for every authenticated role, hidden from SALCI's own admins, who work the inbox at <code>/admin/issues</code></li>
        </ul>
      </section>

      {/* 20. Profile photos */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">20. Profile Photos &amp; Profile Lockdown</h2>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li>Photos live in the <strong>private</strong> <code>user-avatars</code> bucket, referenced by <code>profiles.avatar_path</code>. There is no public bucket and no stored URL</li>
          <li>Authority is checked per request: <code>can_set_user_photo</code> for writes, <code>can_view_user_photo</code> for reads, plus a trigger that rejects a path which does not belong to the row it is written on</li>
          <li>The capture pipeline is HEIC-aware and outputs WebP; <code>CameraCapture</code> is parameterised by facing mode</li>
          <li>An on-device store caches at most six avatars, keyed on an encoded cache key, invalidates in-flight loads on forget, and is purged on sign-out</li>
          <li><code>UserAvatar</code> fetches only when it enters the viewport, and falls back to shared initials</li>
        </ul>
        <p className="text-gray-700">
          <strong>Student profile lockdown.</strong> Students can no longer edit their own profile. The two self-writes they still legitimately need, clearing the password-reset flag and marking onboarding complete, were moved to column-scoped RPCs first, so the lockdown could not trap a user part-way through first login.
        </p>
      </section>

      {/* 21. High-concurrency */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">21. High-Concurrency Hardening</h2>
        <p className="text-gray-700 mb-3">
          After the 2026-05-16 incident, when MVP patterns collapsed at roughly 60 active users through per-call auth validation, retry amplification and IO exhaustion on undersized compute, the platform adopted a hard concurrency contract targeting <strong>3,000 to 5,000 concurrent users with a 10,000 design ceiling</strong>. It is gated at code review by an always-on repo rule that force-triggers a Scale Gate before any data-access code ships.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">21.1 Code Contract</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Rule</th>
              <th className="border border-gray-300 p-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Auth reads</td><td className="border border-gray-300 p-2">Never call <code>supabase.auth.getUser()</code> without a JWT argument. A containment monkey-patch in <code>client.ts</code> reads the local session for 167 existing call sites and must not be removed, but new code reads from the session directly</td></tr>
            <tr><td className="border border-gray-300 p-2">Column lists</td><td className="border border-gray-300 p-2">Explicit columns. No <code>select("*")</code> outside admin tooling</td></tr>
            <tr><td className="border border-gray-300 p-2">Pagination</td><td className="border border-gray-300 p-2">Every unbounded list uses <code>range()</code>. PostgREST silently caps at 1000 rows, inside edge functions too, and a WHERE filter is not a bound</td></tr>
            <tr><td className="border border-gray-300 p-2">Aggregation</td><td className="border border-gray-300 p-2">Compute counts and sums server-side through an RPC, an embedded <code>count()</code> or <code>{"{ count, head: true }"}</code>. Never fetch rows to count them</td></tr>
            <tr><td className="border border-gray-300 p-2">FK indexes</td><td className="border border-gray-300 p-2">Every new foreign key gets an index in the same migration</td></tr>
            <tr><td className="border border-gray-300 p-2">RLS helpers</td><td className="border border-gray-300 p-2">Policies call SECURITY DEFINER helpers only, and wrap stable per-row calls as <code>(select auth.uid())</code></td></tr>
            <tr><td className="border border-gray-300 p-2">React Query</td><td className="border border-gray-300 p-2">Explicit <code>staleTime</code> of at least 60s; <code>refetchInterval</code> under 30s forbidden without a justification comment; <code>refetchOnWindowFocus: false</code> for heavy tables; every subscribing effect cleans up</td></tr>
            <tr><td className="border border-gray-300 p-2">Idempotency</td><td className="border border-gray-300 p-2">Mutations use a single-flight guard, an upsert or ON CONFLICT, or a unique constraint handled gracefully</td></tr>
            <tr><td className="border border-gray-300 p-2">Realtime</td><td className="border border-gray-300 p-2">One channel per feature, never per component</td></tr>
            <tr><td className="border border-gray-300 p-2">Bundle</td><td className="border border-gray-300 p-2">Under 500 KB per chunk and 1.5 MB entry. Lazy-load every page route and every heavy library</td></tr>
            <tr><td className="border border-gray-300 p-2">Edge functions</td><td className="border border-gray-300 p-2">Anything over 10s becomes a background job: enqueue, return an id, poll</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">21.2 Infrastructure Floor</h3>
        <ul className="list-disc list-inside text-gray-700 space-y-1">
          <li>Medium compute minimum, Large at 1K and XL at 10K concurrent users. Compute has not yet been raised to that floor</li>
          <li>Supavisor transaction pooling; read replicas for analytics</li>
          <li>Sentry for error monitoring; k6 load-test scripts in <code>scripts/loadtest/</code></li>
          <li>Rate limiting on expensive edge functions</li>
        </ul>
      </section>

      {/* 22. DB ops */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">22. Database Operations &amp; Security Posture</h2>
        <ul className="list-disc list-inside text-gray-700 space-y-1 mb-3">
          <li><strong>The migration ledger is not maintained.</strong> <code>supabase_migrations.schema_migrations</code> does not reflect what is actually applied. Verify against <code>pg_proc</code>, <code>information_schema</code> and <code>pg_indexes</code> instead, and apply production SQL through the Management API.</li>
          <li><strong>New SECURITY DEFINER functions must revoke <code>anon</code> by name.</strong> Supabase default privileges grant EXECUTE to <code>anon</code>, and <code>REVOKE FROM PUBLIC</code> does not strip it. Verify through <code>information_schema.routine_privileges</code>. Two sweeps have already been needed, on the audit-log function and on the whole <code>dash_*</code> surface.</li>
          <li><strong>Every RLS UPDATE policy needs both <code>USING</code> and <code>WITH CHECK</code>.</strong></li>
          <li><strong>A unique INDEX is invisible to <code>pg_constraint</code>.</strong> Check <code>pg_indexes</code> before concluding that <code>ON CONFLICT</code> is impossible.</li>
          <li><strong>Ship order matters.</strong> A migration that drops or narrows a column must not land before the frontend that stops reading it. Dropping a support column ahead of the deploy broke the live ticket UI and the column had to be re-added empty.</li>
          <li><strong>Regenerate types after a merge.</strong> When two branches both touch the generated Supabase types, regenerate from production: an auto-merge once silently dropped 206 lines of schema.</li>
        </ul>
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 text-sm text-gray-800">
          <p className="font-semibold mb-1">Standing audit debt</p>
          <p>Several audits from July and August 2026 remain partly open and live in <code>docs/</code>: a security audit (with two structural root causes, edge functions that check a role but not ownership, and controls enforced only in the React client), a performance audit, a slowness diagnosis, an optional-subjects audit and a teacher-portal audit. These files are not kept up to date, so verify an item's current status in code or in production before trusting its stated severity.</p>
        </div>
      </section>

      {/* Footer */}
      <div className="text-center text-sm text-gray-500 mt-12 pt-6 border-t border-gray-300">
        <p>SALCI Platform · System Architecture Document v3.0</p>
        <p>Last updated September 8, 2026 | Confidential</p>
      </div>
    </div>
  );
});

SystemArchitectureDocument.displayName = "SystemArchitectureDocument";

export default SystemArchitectureDocument;
