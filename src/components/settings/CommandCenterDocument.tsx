import { forwardRef } from "react";

const CommandCenterDocument = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="bg-white text-gray-900 p-8 max-w-[210mm] mx-auto" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {/* Header */}
      <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">SALCI ERP · Command Center Guide</h1>
        <p className="text-lg text-gray-600">Admin Operations Hub · Feature Reference</p>
        <div className="flex justify-center gap-6 mt-4 text-sm text-gray-500">
          <span>Version 2.0</span>
          <span>|</span>
          <span>September 8, 2026</span>
          <span>|</span>
          <span>Audience: School Admin / Super Admin</span>
        </div>
      </div>

      {/* Section 1 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">1. What is the Command Center</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          The Command Center is the admin's operational hub. It replaced the old Snapshot and Analytics page
          and gives school admins a live, single-scroll view of everything happening in the school, with the
          ability to act on issues without navigating away. It shipped 2026-06-02, the scoped Snapshot for
          coordinators and teachers followed on 2026-06-06, and the whole surface was rebuilt to the
          principal-first blueprint through August 2026 (bento overview and hero-toned tiles, 2026-09-05).
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm text-gray-700 space-y-1">
          <p><strong>Admin surface:</strong> /school/command-center (School Admin, Super School Admin, Super Admin)</p>
          <p><strong>Scoped surface:</strong> /school/snapshot (Coordinator, Teacher)</p>
          <p><strong>Layout:</strong> one centred column capped at 1320px, so tables stay readable on an ultrawide monitor</p>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed mt-3">
          Coordinators and teachers reach the same metrics through the scoped <strong>Snapshot</strong>, which
          reuses the identical components but filters every figure to that user's authority: a coordinator sees
          only their assigned wings, and a teacher sees only the class-and-subject pairs they actually teach.
          Scope is resolved server-side, so no user can be shown a figure outside it.
        </p>
      </section>

      {/* Section 2 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">2. Page Structure</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          The page is a document, not an app screen. A sticky jump nav sits under the header and moves the
          reader between seven anchors. Each panel is an independent query, so a failing panel degrades on its
          own rather than sinking the page, and every panel renders its error state before its empty state.
        </p>

        <div className="mb-5">
          <h3 className="text-base font-semibold text-gray-800 mb-2">Header</h3>
          <ul className="text-sm text-gray-700 leading-relaxed list-disc pl-6 space-y-1">
            <li>Greeting, academic-year context, and a realtime connection-trust signal with a "last updated" time and a retry control, driven by one Realtime channel for the whole dashboard</li>
            <li>Primary action <strong>Download Report</strong> produces the dashboard snapshot PDF; the three CBSE reports moved into the kebab menu</li>
            <li>A banner announces tasks the flag evaluator auto-created since the last visit</li>
          </ul>
        </div>

        <div className="mb-5">
          <h3 className="text-base font-semibold text-gray-800 mb-2">Overview (bento)</h3>
          <ul className="text-sm text-gray-700 leading-relaxed list-disc pl-6 space-y-1">
            <li><strong>Two KPI rows, deliberately not merged.</strong> Roster counts come from <code className="bg-gray-100 px-1 rounded text-xs">dash_admin_roster_counts</code> and answer "how big is the school"; performance KPIs come from <code className="bg-gray-100 px-1 rounded text-xs">dash_kpi_summary</code> and answer "how is it doing". A headcount and a percentage never sit side by side in one strip</li>
            <li>Student and staff attendance are separate tables with separate status vocabularies, so each tile carries its own <code className="bg-gray-100 px-1 rounded text-xs">marked</code> flag. An unmarked day reads "N/A", never a 0% that would look like total absence</li>
            <li>Trends are reported in percentage points against the previous period, or "unchanged" inside a 0.05pp band</li>
            <li>An academic-performance card with the exam trend</li>
            <li>The insights digest is derived in SQL by <code className="bg-gray-100 px-1 rounded text-xs">dash_admin_digest</code> and is <strong>collapsed by default</strong>, because six paragraphs of prose between the tiles and the charts pushed the actual numbers below the fold</li>
            <li>Two judgement tiles with no dedicated route (needs help, decisions waiting) scroll to the section that answers them instead of navigating away</li>
          </ul>
        </div>

        <div className="mb-2">
          <h3 className="text-base font-semibold text-gray-800 mb-2">The six sections</h3>
          <table className="w-full border-collapse border border-gray-300 text-sm mb-2">
            <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Section</th><th className="border border-gray-300 p-2 text-left">What it answers</th></tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-2 font-semibold">Students</td><td className="border border-gray-300 p-2">Class-performance ranking with a wing filter and load-more, the performance-band donut, and the attention queue with its own class picker. Tapping a donut segment opens the actual list of those students in a sheet rather than scrolling to a filtered table</td></tr>
              <tr><td className="border border-gray-300 p-2 font-semibold">Teachers &amp; staff</td><td className="border border-gray-300 p-2">Teacher table, portal adoption and laggards, roster gaps, coordinator and wing standing</td></tr>
              <tr><td className="border border-gray-300 p-2 font-semibold">Academics</td><td className="border border-gray-300 p-2">Subject performance, the class-by-subject heatmap, syllabus coverage, recent exams</td></tr>
              <tr><td className="border border-gray-300 p-2 font-semibold">Attendance</td><td className="border border-gray-300 p-2">Attendance trend and compliance, with the debarment-risk view for senior grades</td></tr>
              <tr><td className="border border-gray-300 p-2 font-semibold">Communication</td><td className="border border-gray-300 p-2">Notice outbox reach and read-through, drawn from the Notice Board audience engine</td></tr>
              <tr><td className="border border-gray-300 p-2 font-semibold">Needs your attention</td><td className="border border-gray-300 p-2">The live flag feed and the task queue: what an admin should act on today</td></tr>
            </tbody>
          </table>
          <p className="text-sm text-gray-700 leading-relaxed">
            Cards carry their own class, wing and date-range filters rather than one page-level filter bar, and
            the layout keeps equal-height rows so short cards do not leave dead columns.
          </p>
        </div>
      </section>

      {/* Section 3 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">3. Flags and Auto-Created Tasks</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-2">
          A 20-flag evaluator writes into <code className="bg-gray-100 px-1 rounded text-xs">dashboard_flags</code>,
          ordered Critical, then Warning, then Info. Each flag carries an inline quick action and a link into the
          owning module. Representative flags:
        </p>
        <ul className="text-sm text-gray-700 leading-relaxed list-disc pl-6 space-y-1 mb-3">
          <li>Students in grades 9 to 12 below 75% attendance (CBSE debarment risk)</li>
          <li>Teachers with overdue evaluation submissions</li>
          <li>Unlogged teaching days and syllabus pacing slippage (the SY1 escalation)</li>
          <li>Fee defaulters overdue 30 days or more, and fee collection below target</li>
          <li>Exams stuck in Draft</li>
          <li>Pending leave requests and unreviewed AI suggestions</li>
        </ul>
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-gray-700 space-y-2">
          <p><strong>Freshness:</strong> the evaluator runs when an admin opens the Command Center. There is no background cron, so flags are exactly as fresh as the most recent admin page-open.</p>
          <p><strong>Task attribution:</strong> flag-to-task auto-assignment is ON and the assigner is always recorded as "SALCI System", never the admin who happened to open the page. Attributing these to the triggering admin was built and deliberately reverted.</p>
          <p><strong>Lifecycle RPCs:</strong> <code className="bg-gray-100 px-1 rounded text-xs">dash_create_task_from_flag</code>, <code className="bg-gray-100 px-1 rounded text-xs">dash_reassign_flag_task</code> and <code className="bg-gray-100 px-1 rounded text-xs">dash_cancel_flag_task</code>, each with a <code className="bg-gray-100 px-1 rounded text-xs">dash_scoped_*</code> twin.</p>
        </div>
      </section>

      {/* Section 4 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">4. Reports</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          The header's primary action is the <strong>dashboard snapshot</strong>, a PDF of what is on screen.
          Three CBSE reports sit in the kebab menu:
        </p>
        <div className="space-y-3 mb-3">
          <div>
            <p className="text-sm text-gray-800"><strong>A) Full CBSE Compliance Report</strong></p>
            <p className="text-sm text-gray-700 leading-relaxed pl-4">Aligned with CBSE Affiliation Bye-Laws Clause 14.19. Covers enrolment, attendance, exams, staff and a compliance scorecard.</p>
          </div>
          <div>
            <p className="text-sm text-gray-800"><strong>B) Inspection Readiness Report</strong></p>
            <p className="text-sm text-gray-700 leading-relaxed pl-4">Covers what CBSE physically verifies on inspection day, formatted for the principal's office.</p>
          </div>
          <div>
            <p className="text-sm text-gray-800"><strong>C) Academic Performance Report</strong></p>
            <p className="text-sm text-gray-700 leading-relaxed pl-4">Deep academic analysis for CBSE SQAA evidence: class-wise, subject-wise and student-level.</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">
          Reports are filtered by academic year and term. Sections that depend on a module the school has not
          enabled are excluded automatically, and a closing note lists what was left out.
        </p>
      </section>

      {/* Section 5 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">5. Feature Gating</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-2">
          Alerts, cards and tiles appear only when the owning module is enabled for the school:
        </p>
        <ul className="text-sm text-gray-700 leading-relaxed list-disc pl-6 space-y-1 mb-3">
          <li>Fee alerts require <code className="bg-gray-100 px-1 rounded text-xs">fee_management</code></li>
          <li>Staff leave alerts require <code className="bg-gray-100 px-1 rounded text-xs">hr_payroll</code></li>
          <li>The communication section requires <code className="bg-gray-100 px-1 rounded text-xs">notice_board</code> or <code className="bg-gray-100 px-1 rounded text-xs">communication</code></li>
          <li>Syllabus coverage requires <code className="bg-gray-100 px-1 rounded text-xs">timetable</code> and <code className="bg-gray-100 px-1 rounded text-xs">syllabus</code></li>
          <li>AI suggestion alerts require the AI features; compliance is always computed from whatever data exists</li>
        </ul>
        <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-gray-700">
          <p><strong>Implementation note.</strong> The Coordinator, School Admin Command Center and Comprehensive Student dashboards render their tiles outside NavigationHub, so each feature tile there must be hand-wrapped in <code className="bg-gray-100 px-1 rounded text-xs">isFeatureEnabled()</code>. A tile added without that wrapper leaks a disabled module back onto the dashboard.</p>
        </div>
      </section>

      {/* Section 6 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">6. Data Sources and Architecture</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-2">
          The Command Center reads existing SALCI modules. No separate data entry is required:
        </p>
        <ul className="text-sm text-gray-700 leading-relaxed list-disc pl-6 space-y-1 mb-3">
          <li>Attendance (student and staff planes, which are separate tables)</li>
          <li>Exams, evaluations and final results, scoped by class group and section</li>
          <li>Syllabus progress and the timetable (<code className="bg-gray-100 px-1 rounded text-xs">tt_*</code> and <code className="bg-gray-100 px-1 rounded text-xs">cal_*</code>)</li>
          <li>Fee management, HR and staff leave</li>
          <li>Tasks and the AI suggestions engine</li>
          <li>Notice Board reach and read receipts</li>
        </ul>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          <code className="bg-gray-100 px-1 rounded text-xs">exams.exam_type</code> is a scheduling classification,
          CHECK-constrained to <code className="bg-gray-100 px-1 rounded text-xs">term</code>,{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">unit</code>,{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">weekly</code> and{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">unspecified</code>. It is returned by the widget RPCs so
          the frontend can group by type without mixing them. Delivery format is a different column,{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">exams.exam_mode</code> (online, offline, hybrid), with
          results-only papers flagged by <code className="bg-gray-100 px-1 rounded text-xs">exams.is_results_only</code>.
          Hybrid attempts live in their own <code className="bg-gray-100 px-1 rounded text-xs">hybrid_*</code> plane
          rather than in <code className="bg-gray-100 px-1 rounded text-xs">student_exam_attempts</code>.
        </p>

        <h3 className="text-base font-semibold text-gray-800 mb-2">Technical architecture</h3>
        <p className="text-sm text-gray-700 leading-relaxed mb-2">
          One set of components serves all three audiences through a{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">DashboardScope</code> context, backed by three parallel
          RPC families:
        </p>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-3">
          <thead><tr className="bg-gray-100"><th className="border border-gray-300 p-2 text-left">Family</th><th className="border border-gray-300 p-2 text-left">Audience</th><th className="border border-gray-300 p-2 text-left">Scope resolution</th></tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2"><code className="text-xs">dash_*</code></td><td className="border border-gray-300 p-2">School admin</td><td className="border border-gray-300 p-2">Whole institution</td></tr>
            <tr><td className="border border-gray-300 p-2"><code className="text-xs">dash_scoped_*</code></td><td className="border border-gray-300 p-2">Coordinator</td><td className="border border-gray-300 p-2"><code className="text-xs">dash_resolve_scoped_classes</code> over the wing mappings</td></tr>
            <tr><td className="border border-gray-300 p-2"><code className="text-xs">dash_teacher_*</code></td><td className="border border-gray-300 p-2">Teacher</td><td className="border border-gray-300 p-2"><code className="text-xs">dash_resolve_teacher_pairs()</code>, never the admin-first ladder</td></tr>
          </tbody>
        </table>
        <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-gray-700 space-y-2">
          <p><strong>Build rule.</strong> Every new dashboard hook needs all applicable variants, with <code className="bg-gray-100 px-1 rounded text-xs">scope</code> in the React Query key so admin and scoped data never collide in cache. Never branch on <code className="bg-gray-100 px-1 rounded text-xs">scope === "scoped"</code> for teachers: teacher authority is subject-scoped, and a class shared with a teacher is not authority over that teacher's students.</p>
          <p><strong>Never</strong> mount <code className="bg-gray-100 px-1 rounded text-xs">useCommandCenter</code> outside <code className="bg-gray-100 px-1 rounded text-xs">CbseReportsModal</code>.</p>
        </div>
      </section>

      {/* Section 7 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">7. Platform Reliability</h2>
        <ul className="text-sm text-gray-700 leading-relaxed list-disc pl-6 space-y-1">
          <li><strong>Build-stamped service worker.</strong> Installed PWAs detect new deploys on tab focus, on an hourly poll and via a build-ID cache key. Dirty forms are protected from auto-reload; admins see a "Refresh available" prompt instead.</li>
          <li><strong>Translated error toasts.</strong> Postgres codes (RLS, foreign key, unique violation) and edge-function failures map to readable copy through the central <code className="bg-gray-100 px-1 rounded text-xs">toastError</code> utility. Raw database strings never reach the user, and a failed query never renders as an empty school.</li>
          <li><strong>Class Groups container.</strong> Counts and KPIs roll up across the <code className="bg-gray-100 px-1 rounded text-xs">class_groups</code> hierarchy ("Class 10" above 10A/10B/10C), so a principal sees one row per group where a group-level figure is the right one.</li>
          <li><strong>Institution-local time.</strong> Every <code className="bg-gray-100 px-1 rounded text-xs">dash_*</code> RPC computes "today" as <code className="bg-gray-100 px-1 rounded text-xs">(now() AT TIME ZONE i.timezone)</code>, so a school's day boundary is its own, not UTC's.</li>
          <li><strong>Server-side aggregation.</strong> Every figure on the page is computed in Postgres. Nothing is counted client-side, which is what keeps the dashboard viable at several thousand concurrent users.</li>
        </ul>
      </section>

      {/* Footer */}
      <div className="mt-12 pt-4 border-t border-gray-300 text-center text-xs text-gray-400">
        SALCI ERP · Command Center Guide v2.0 · Confidential · September 8, 2026
      </div>
    </div>
  );
});

CommandCenterDocument.displayName = "CommandCenterDocument";
export default CommandCenterDocument;
