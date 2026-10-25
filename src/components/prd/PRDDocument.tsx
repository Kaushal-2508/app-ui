import { forwardRef } from "react";

const PRDDocument = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="bg-white text-black p-8 max-w-4xl mx-auto font-sans">
      {/* Header */}
      <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">SALCI Platform</h1>
        <p className="text-xl text-gray-600">Comprehensive Product Requirements Document</p>
        <p className="text-sm text-gray-500 mt-2">Version 3.0 | September 8, 2026</p>
        <p className="text-xs text-gray-500 mt-1">Scope: the SALCI school platform. The Olympiad subsystem shares this repository and Supabase project but is documented separately and is excluded from every count in this document.</p>
      </div>

      {/* Table of Contents */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">Table of Contents</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>1. Executive Summary</div>
          <div>2. Core Problems Addressed</div>
          <div>3. Technology Stack</div>
          <div>4. User Roles & Permissions</div>
          <div>5. Database Schema (All Tables)</div>
          <div>6. Exam Creation System</div>
          <div>7. AI-Powered Evaluation</div>
          <div>8. Offline Exam Support (OCR)</div>
          <div>9. Online Proctoring System</div>
          <div>10. Learning Intelligence System</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm mt-2">
          <div>11. Task Management System</div>
          <div>12. Analytics & Dashboards</div>
          <div>13. Payments & Billing</div>
          <div>14. Badge & Gamification System</div>
          <div>15. Wing & Coordinator System</div>
          <div>16. Edge Cases & Error Handling</div>
          <div>17. Security & RLS Policies</div>
          <div>18. Edge Functions</div>
          <div>19. Storage Buckets</div>
          <div>20. Recent System Improvements (v2.1–v2.3)</div>
          <div>21. New Pages & Features (v2.2)</div>
          <div>22. Institution Feature Gating System (v2.3)</div>
          <div>23. Timetable & Lesson Planning Module (v2.4)</div>
          <div>24. Recent Improvements (v2.5)</div>
          <div>25. Class Groups, Reliability & Mobile Exam Flow (v2.7)</div>
          <div>26. Mobile Visual Identity, AI Reliability &amp; UX (v2.8)</div>
          <div>27. Optional Subjects (v3.0)</div>
          <div>28. Homework &amp; Assignment System (v3.0)</div>
          <div>29. Hybrid &amp; Results-Only Exams (v3.0)</div>
          <div>30. Command Center &amp; Scoped Dashboards (v3.0)</div>
          <div>31. High-Concurrency Hardening (v3.0)</div>
          <div>32. Notice Board, Messaging &amp; Communication (v3.0)</div>
          <div>33. Salci Support (v3.0)</div>
          <div>34. Profile Photos &amp; Student Profile Lockdown (v3.0)</div>
          <div>35. Attendance, Leave &amp; Reporting (v3.0)</div>
          <div>36. Syllabus Delivery: Two Timelines, Notes &amp; Parts (v3.0)</div>
          <div>37. Teacher Authority &amp; Role Scoping (v3.0)</div>
          <div>38. Student Experience &amp; Achievements (v3.0)</div>
          <div>39. Exam Platform Enhancements (v3.0)</div>
          <div>40. Database &amp; Production Operations (v3.0)</div>
        </div>
      </section>

      {/* Executive Summary */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">1. Executive Summary</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          SALCI (Smart AI-powered Learning & Comprehensive Intelligence) is an enterprise-grade examination 
          and learning management platform designed for educational institutions. It combines AI-powered 
          evaluation, intelligent learning recommendations, and comprehensive analytics to transform 
          traditional assessment into adaptive, insight-driven education.
        </p>
        
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <h3 className="font-semibold text-gray-900 mb-2">Vision</h3>
          <p className="text-gray-700 italic">"Empowering educators with AI-driven insights while keeping human judgment at the center of learning."</p>
        </div>

        <div className="bg-blue-50 p-4 rounded-lg">
          <h3 className="font-semibold text-blue-900 mb-2">Key Capabilities</h3>
          <ul className="list-disc list-inside text-blue-800 space-y-1 text-sm">
            <li>Multi-role platform across seven roles, with subject-scoped teacher authority enforced in the database</li>
            <li>Online, offline (OCR), hybrid and results-only exam modes</li>
            <li>AI question generation calibrated to the resolved grade level, and AI auto-grading with teacher override</li>
            <li>Proctoring with a shared 4-strike violation ladder across tab switches and fullscreen exits</li>
            <li>Timetable, lesson logging and a two-timeline syllabus that shows planned against actual coverage</li>
            <li>Homework end to end: assignment, submission, marking roster, publish gate</li>
            <li>Attendance with institution-local auto-mark, student and staff leave workflows, and paginated exportable reporting</li>
            <li>Notice Board audience engine with materialised recipients and read receipts, plus direct and bulk messaging</li>
            <li>Salci Support: threaded tickets that become tasks, with reporter email notifications</li>
            <li>Command Center for admins and a scope-resolved Snapshot for coordinators and teachers, every figure computed server-side</li>
            <li>Concept mastery, learning recommendations, achievements and a server-side leaderboard</li>
            <li>Task management with evidence-based approval and multi-assignee fan-out</li>
            <li>Installable PWA with build-stamped deploy detection, mobile-first to 375px, full light and dark themes</li>
          </ul>
        </div>
        <p className="text-gray-600 text-xs mt-3">
          Platform footprint as of this revision: 97 pages, 120 routes, 183 database tables, 260 database functions, 458 migrations, 37 edge functions, 16 storage buckets and 29 gateable modules. All counts exclude the Olympiad subsystem, which shares the repository and Supabase project but is documented separately.
        </p>
      </section>

      {/* Core Problems */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">2. Core Problems Addressed</h2>
        <table className="w-full border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-3 text-left">Problem</th>
              <th className="border border-gray-300 p-3 text-left">SALCI Solution</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 p-3">Manual evaluation is time-consuming</td>
              <td className="border border-gray-300 p-3">AI-powered auto-grading with keyword matching and confidence scores</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-3">Paper-based exams lack analytics</td>
              <td className="border border-gray-300 p-3">OCR digitization with handwriting recognition + comprehensive analytics</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-3">No personalized learning paths</td>
              <td className="border border-gray-300 p-3">Concept mastery tracking + AI-generated learning actions</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-3">Limited visibility for administrators</td>
              <td className="border border-gray-300 p-3">Role-based dashboards with real-time insights and heatmaps</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-3">Exam creation is fragmented</td>
              <td className="border border-gray-300 p-3">Unified 6-step wizard with AI question generation</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-3">Online exam integrity</td>
              <td className="border border-gray-300 p-3">Real-time proctoring with face detection, tab monitoring, screenshots</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-3">Teacher accountability</td>
              <td className="border border-gray-300 p-3">Task Management System with evidence upload and approval workflow</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Technology Stack */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">3. Technology Stack</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Frontend</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>React 18 + TypeScript</li>
              <li>Vite (Build Tool)</li>
              <li>Tailwind CSS + shadcn/ui</li>
              <li>TanStack Query (Data Fetching)</li>
              <li>Framer Motion (Animations)</li>
              <li>Recharts (Charts)</li>
              <li>face-api.js (Face Detection)</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Backend</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>Supabase (PostgreSQL)</li>
              <li>Edge Functions (Deno)</li>
              <li>Row Level Security (RLS)</li>
              <li>Two AI plumbing paths (see below)</li>
              <li>Real-time Subscriptions</li>
              <li>Supabase Storage (16 buckets)</li>
              <li>Resend (Email)</li>
            </ul>
          </div>
        </div>
        <div className="bg-amber-50 p-4 rounded-lg mt-4">
          <h3 className="font-semibold text-amber-900 mb-2">AI Provider: Two Distinct Paths</h3>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><strong>Question generation</strong> (<code className="bg-white px-1 rounded">generate-questions</code>) routes through <code className="bg-white px-1 rounded">supabase/functions/_shared/aiProvider.ts</code>, switched by the <code className="bg-white px-1 rounded">AI_PROVIDER</code> env var: <code className="bg-white px-1 rounded">openai</code> (default) or <code className="bg-white px-1 rounded">gemini</code>. Production runs <code className="bg-white px-1 rounded">gpt-5-mini</code> at <code className="bg-white px-1 rounded">medium</code> reasoning effort, with subject-based cost routing to <code className="bg-white px-1 rounded">OPENAI_MODEL_BASIC</code> for non-science subjects. See §39.3.</li>
            <li><strong>Everything else</strong> (auto-grade-submission, process-ocr-upload, generate-predictions, generate-exam-insights, generate-principal-ai-insights, mascot-chat) calls the Lovable AI gateway (<code className="bg-white px-1 rounded">ai.gateway.lovable.dev</code>, secret <code className="bg-white px-1 rounded">LOVABLE_API_KEY</code>) with Google Gemini models. No Anthropic in production.</li>
          </ul>
        </div>
      </section>

      {/* User Roles */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">4. User Roles & Permissions</h2>
        
        <h3 className="text-lg font-semibold text-gray-800 mb-3">4.1 Role Hierarchy</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Role</th>
              <th className="border border-gray-300 p-2 text-left">Scope</th>
              <th className="border border-gray-300 p-2 text-left">Key Capabilities</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">super_admin</td>
              <td className="border border-gray-300 p-2">Global</td>
              <td className="border border-gray-300 p-2">All institutions, quotas, global settings, payments, syllabus, question bank</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-2 font-semibold">super_school_admin</td>
              <td className="border border-gray-300 p-2">Institution</td>
              <td className="border border-gray-300 p-2">Owner role: full school_admin parity plus oversight</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">school_admin</td>
              <td className="border border-gray-300 p-2">Institution</td>
              <td className="border border-gray-300 p-2">Manage users, classes, wings, subjects, view analytics, billing</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-2 font-semibold">coordinator</td>
              <td className="border border-gray-300 p-2">Wing (subset of classes)</td>
              <td className="border border-gray-300 p-2">Oversee teachers across all subjects in their wings, review tasks, manage schedules. Scoped via wing_assignments x wing_class_mappings</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">teacher</td>
              <td className="border border-gray-300 p-2"><strong>Class + subject pair</strong></td>
              <td className="border border-gray-300 p-2">Create exams, evaluate, log lessons, mark attendance and leave, set homework. Authority is the class-and-subject pair, not the class: see §37</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-2 font-semibold">student</td>
              <td className="border border-gray-300 p-2">Self</td>
              <td className="border border-gray-300 p-2">Attempt exams, view results, submit homework, apply for leave, earn badges. Cannot edit their own profile</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">employee</td>
              <td className="border border-gray-300 p-2">Configurable</td>
              <td className="border border-gray-300 p-2">Custom employee levels with granular permissions</td>
            </tr>
          </tbody>
        </table>

        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-amber-900 mb-2">Dual roles and per-user grants</h4>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><strong>Scopes never union.</strong> A teacher who is also a coordinator sees two separate scopes, not their combination. <code className="bg-white px-1 rounded">ViewRole</code> is declared once in <code className="bg-white px-1 rounded">ActiveRoleContext</code> and <code className="bg-white px-1 rounded">viewRoles[0]</code> is the default, so teacher plus coordinator defaults to teacher and admin plus teacher defaults to admin.</li>
            <li><strong>An admin may also teach</strong> via <code className="bg-white px-1 rounded">grant_teacher_role</code> from Manage Administrators, requiring at least one class-and-subject pair. The view toggle is presentation-only because every server gate is an admin-first OR-union.</li>
            <li><strong>Four per-user capability grants</strong> raise one named user without changing their role: <code className="bg-white px-1 rounded">tt_manager_overrides</code>, <code className="bg-white px-1 rounded">staff_manager_overrides</code>, <code className="bg-white px-1 rounded">syllabus_manager_overrides</code> and <code className="bg-white px-1 rounded">student_manager_overrides</code>.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">4.2 Password Reset Permissions</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Role</th>
              <th className="border border-gray-300 p-2 text-left">Can Reset Passwords For</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">Super Admin</td><td className="border border-gray-300 p-2">Any student in any institution</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">School Admin</td><td className="border border-gray-300 p-2">Any student in their institution</td></tr>
            <tr><td className="border border-gray-300 p-2">Coordinator</td><td className="border border-gray-300 p-2">Students in classes of teachers they coordinate</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">Teacher</td><td className="border border-gray-300 p-2">Students in their assigned classes only</td></tr>
          </tbody>
        </table>
      </section>

      {/* Page Break */}
      <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>

      {/* DATABASE SCHEMA - COMPREHENSIVE */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">5. Complete Database Schema</h2>
        <p className="text-gray-600 text-sm mb-2">School-platform tables: 183 | Views: 3 (all <code className="bg-gray-100 px-1 rounded">security_invoker=on</code>) | Database functions: 260 | Enums: 10 | Migrations: 458</p>
        <p className="text-gray-600 text-xs mb-4">The schema spans several module-specific families: <code className="bg-gray-100 px-1 rounded">homework_*</code> (8), <code className="bg-gray-100 px-1 rounded">hybrid_*</code> (8), <code className="bg-gray-100 px-1 rounded">tt_*</code> and <code className="bg-gray-100 px-1 rounded">cal_*</code> (10), <code className="bg-gray-100 px-1 rounded">syllabus_*</code> progress and segmentation (4), <code className="bg-gray-100 px-1 rounded">optional_*</code> plus <code className="bg-gray-100 px-1 rounded">student_optional_enrollments</code> (6), <code className="bg-gray-100 px-1 rounded">notice_*</code> (4), <code className="bg-gray-100 px-1 rounded">support_*</code> with <code className="bg-gray-100 px-1 rounded">reported_issues</code> (3), <code className="bg-gray-100 px-1 rounded">dash</code>-facing <code className="bg-gray-100 px-1 rounded">dashboard_flags</code>, the four <code className="bg-gray-100 px-1 rounded">*_manager_overrides</code> grant tables, and the offline-marks pair. Detailed in Sections 27 to 40. The sub-sections below list the core entities; the module families are documented in their own sections rather than repeated here.</p>
        
        {/* Core Entities */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3">5.1 Core Entity Tables</h3>
        
        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-blue-50 p-2 rounded">institutions</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">name</td><td className="border border-gray-300 p-1">TEXT NOT NULL</td><td className="border border-gray-300 p-1">School name</td></tr>
              <tr><td className="border border-gray-300 p-1">code</td><td className="border border-gray-300 p-1">TEXT UNIQUE</td><td className="border border-gray-300 p-1">Short code (e.g., "AIS")</td></tr>
              <tr><td className="border border-gray-300 p-1">address</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Physical address</td></tr>
              <tr><td className="border border-gray-300 p-1">contact_email</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Primary contact email</td></tr>
              <tr><td className="border border-gray-300 p-1">contact_phone</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Contact phone number</td></tr>
              <tr><td className="border border-gray-300 p-1">is_active</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Active subscription status</td></tr>
              <tr><td className="border border-gray-300 p-1">max_admins</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Max school admins allowed</td></tr>
              <tr><td className="border border-gray-300 p-1">created_at, updated_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">Audit timestamps</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-blue-50 p-2 rounded">profiles</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK (FK auth.users)</td><td className="border border-gray-300 p-1">Links to Supabase auth</td></tr>
              <tr><td className="border border-gray-300 p-1">full_name</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Display name</td></tr>
              <tr><td className="border border-gray-300 p-1">email</td><td className="border border-gray-300 p-1">TEXT UNIQUE</td><td className="border border-gray-300 p-1">Email address</td></tr>
              <tr><td className="border border-gray-300 p-1">phone_number</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Phone number</td></tr>
              <tr><td className="border border-gray-300 p-1">institution_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Belongs to institution</td></tr>
              <tr><td className="border border-gray-300 p-1">admission_number</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Student admission ID</td></tr>
              <tr><td className="border border-gray-300 p-1">roll_number</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Class roll number</td></tr>
              <tr><td className="border border-gray-300 p-1">avatar_url</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Profile picture URL</td></tr>
              <tr><td className="border border-gray-300 p-1">password_expires_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">Password expiry (7 days)</td></tr>
              <tr><td className="border border-gray-300 p-1">must_reset_password</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Force password reset</td></tr>
              <tr><td className="border border-gray-300 p-1">mascot_name</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Custom mascot name</td></tr>
              <tr><td className="border border-gray-300 p-1">mascot_persona</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Mascot personality type</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-blue-50 p-2 rounded">user_roles</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">user_id</td><td className="border border-gray-300 p-1">UUID FK profiles</td><td className="border border-gray-300 p-1">User reference</td></tr>
              <tr><td className="border border-gray-300 p-1">role</td><td className="border border-gray-300 p-1">app_role ENUM</td><td className="border border-gray-300 p-1">super_admin|school_admin|coordinator|teacher|student|employee</td></tr>
              <tr><td className="border border-gray-300 p-1">institution_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Role scope (null for super_admin)</td></tr>
              <tr><td className="border border-gray-300 p-1">employee_level_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">For employee role only</td></tr>
              <tr><td className="border border-gray-300 p-1">granted_by</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Who assigned this role</td></tr>
              <tr><td className="border border-gray-300 p-1">granted_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">When role was assigned</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-1">Note: Users can have multiple roles (e.g., teacher + coordinator)</p>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-blue-50 p-2 rounded">classes</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">institution_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Parent institution</td></tr>
              <tr><td className="border border-gray-300 p-1">name</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Class name (e.g., "10")</td></tr>
              <tr><td className="border border-gray-300 p-1">section</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Section (e.g., "A", "B")</td></tr>
              <tr><td className="border border-gray-300 p-1">academic_year</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">e.g., "2025-26"</td></tr>
              <tr><td className="border border-gray-300 p-1">is_active</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Active status</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-blue-50 p-2 rounded">class_assignments</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">user_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Teacher or Student</td></tr>
              <tr><td className="border border-gray-300 p-1">class_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Assigned class</td></tr>
              <tr><td className="border border-gray-300 p-1">role</td><td className="border border-gray-300 p-1">app_role</td><td className="border border-gray-300 p-1">"teacher" or "student"</td></tr>
              <tr><td className="border border-gray-300 p-1">subject_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">For teachers: which subject they teach</td></tr>
              <tr><td className="border border-gray-300 p-1">assigned_by</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Who made assignment</td></tr>
            </tbody>
          </table>
        </div>

        {/* Page Break */}
        <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>

        {/* Syllabus & Subject Tables */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3">5.2 Syllabus & Subject Tables</h3>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-green-50 p-2 rounded">grade_levels</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">grade_number</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">1-12 for school grades</td></tr>
              <tr><td className="border border-gray-300 p-1">grade_name</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"Class 10", "Grade 5"</td></tr>
              <tr><td className="border border-gray-300 p-1">display_order</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Sort order</td></tr>
              <tr><td className="border border-gray-300 p-1">is_active</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Active status</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-green-50 p-2 rounded">universal_subjects</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">name</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"Mathematics", "Science"</td></tr>
              <tr><td className="border border-gray-300 p-1">name_hindi</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Hindi translation</td></tr>
              <tr><td className="border border-gray-300 p-1">code</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"MATH", "SCI"</td></tr>
              <tr><td className="border border-gray-300 p-1">category</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"core", "language", "elective"</td></tr>
              <tr><td className="border border-gray-300 p-1">grade_level_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">For grade-specific subjects</td></tr>
              <tr><td className="border border-gray-300 p-1">institution_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">NULL = global, else school-specific</td></tr>
              <tr><td className="border border-gray-300 p-1">is_active</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Active status</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-green-50 p-2 rounded">syllabus_topics</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">topic_name</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"Quadratic Equations"</td></tr>
              <tr><td className="border border-gray-300 p-1">topic_name_hindi</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Hindi translation</td></tr>
              <tr><td className="border border-gray-300 p-1">subject_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Parent subject</td></tr>
              <tr><td className="border border-gray-300 p-1">grade_level_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Which grade</td></tr>
              <tr><td className="border border-gray-300 p-1">institution_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">NULL = global topic</td></tr>
              <tr><td className="border border-gray-300 p-1">chapter_number</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Chapter sequence</td></tr>
              <tr><td className="border border-gray-300 p-1">difficulty_level</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"easy", "medium", "hard"</td></tr>
              <tr><td className="border border-gray-300 p-1">expected_hours</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Teaching hours</td></tr>
              <tr><td className="border border-gray-300 p-1">learning_outcomes</td><td className="border border-gray-300 p-1">JSONB</td><td className="border border-gray-300 p-1">Array of outcomes</td></tr>
              <tr><td className="border border-gray-300 p-1">sub_topics</td><td className="border border-gray-300 p-1">JSONB</td><td className="border border-gray-300 p-1">Nested subtopics</td></tr>
              <tr><td className="border border-gray-300 p-1">cbse_aligned</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">CBSE curriculum flag</td></tr>
              <tr><td className="border border-gray-300 p-1">nep_aligned</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">NEP 2020 alignment</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-green-50 p-2 rounded">study_materials</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, topic_id, institution_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">title</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Material title</td></tr>
              <tr><td className="border border-gray-300 p-1">material_type</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"video", "pdf", "link", "notes"</td></tr>
              <tr><td className="border border-gray-300 p-1">url</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Resource URL</td></tr>
              <tr><td className="border border-gray-300 p-1">description</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Description</td></tr>
              <tr><td className="border border-gray-300 p-1">is_active</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Active status</td></tr>
            </tbody>
          </table>
        </div>

        {/* Exam System Tables */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-6">5.3 Exam System Tables</h3>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-purple-50 p-2 rounded">exams</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">institution_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Owning institution</td></tr>
              <tr><td className="border border-gray-300 p-1">title</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Exam title</td></tr>
              <tr><td className="border border-gray-300 p-1">description</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Exam description</td></tr>
              <tr><td className="border border-gray-300 p-1">status</td><td className="border border-gray-300 p-1">exam_status</td><td className="border border-gray-300 p-1">draft|ready|published|active|completed|archived</td></tr>
              <tr><td className="border border-gray-300 p-1">exam_mode</td><td className="border border-gray-300 p-1">exam_mode</td><td className="border border-gray-300 p-1">online|offline|hybrid</td></tr>
              <tr><td className="border border-gray-300 p-1">scheduled_date</td><td className="border border-gray-300 p-1">DATE</td><td className="border border-gray-300 p-1">Exam date</td></tr>
              <tr><td className="border border-gray-300 p-1">start_time, end_time</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">Exam window</td></tr>
              <tr><td className="border border-gray-300 p-1">duration_minutes</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Time limit</td></tr>
              <tr><td className="border border-gray-300 p-1">total_marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Maximum marks</td></tr>
              <tr><td className="border border-gray-300 p-1">pass_marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Minimum to pass</td></tr>
              <tr><td className="border border-gray-300 p-1">instructions</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Exam instructions</td></tr>
              <tr><td className="border border-gray-300 p-1">is_blueprint_ready</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">All questions have blueprints</td></tr>
              <tr><td className="border border-gray-300 p-1">created_by</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Exam creator</td></tr>
              <tr><td className="border border-gray-300 p-1">published_by, published_at</td><td className="border border-gray-300 p-1">UUID, TIMESTAMP</td><td className="border border-gray-300 p-1">Publication audit</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-purple-50 p-2 rounded">exam_sections</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, exam_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">title</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"Section A", "Part 1"</td></tr>
              <tr><td className="border border-gray-300 p-1">section_type</td><td className="border border-gray-300 p-1">section_type</td><td className="border border-gray-300 p-1">mcq|true_false|fill_blank|short_answer|long_answer|matching|comprehension|case_study</td></tr>
              <tr><td className="border border-gray-300 p-1">section_order</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Display order</td></tr>
              <tr><td className="border border-gray-300 p-1">default_marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Default per question</td></tr>
              <tr><td className="border border-gray-300 p-1">negative_marking</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Negative marks</td></tr>
              <tr><td className="border border-gray-300 p-1">instructions</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Section instructions</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-purple-50 p-2 rounded">exam_questions</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, section_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">question_text</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Question content (HTML)</td></tr>
              <tr><td className="border border-gray-300 p-1">question_type</td><td className="border border-gray-300 p-1">question_type</td><td className="border border-gray-300 p-1">mcq|short_answer|long_answer|true_false|fill_blank|matching</td></tr>
              <tr><td className="border border-gray-300 p-1">question_order</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Order in section</td></tr>
              <tr><td className="border border-gray-300 p-1">marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Max marks</td></tr>
              <tr><td className="border border-gray-300 p-1">negative_marks</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Penalty for wrong answer</td></tr>
              <tr><td className="border border-gray-300 p-1">options</td><td className="border border-gray-300 p-1">JSONB</td><td className="border border-gray-300 p-1">[{`{id, text, isCorrect}`}]</td></tr>
              <tr><td className="border border-gray-300 p-1">correct_answer</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">For non-MCQ</td></tr>
              <tr><td className="border border-gray-300 p-1">explanation</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Answer explanation</td></tr>
              <tr><td className="border border-gray-300 p-1">difficulty_level</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">1-5 difficulty</td></tr>
              <tr><td className="border border-gray-300 p-1">tags</td><td className="border border-gray-300 p-1">TEXT[]</td><td className="border border-gray-300 p-1">Topic tags</td></tr>
            </tbody>
          </table>
        </div>

        {/* Page Break */}
        <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>

        {/* Student Attempt Tables */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3">5.4 Student Attempt & Answer Tables</h3>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-orange-50 p-2 rounded">student_exam_attempts</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Attempt ID</td></tr>
              <tr><td className="border border-gray-300 p-1">exam_id, student_id, class_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">started_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">When attempt started</td></tr>
              <tr><td className="border border-gray-300 p-1">submitted_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">When submitted</td></tr>
              <tr><td className="border border-gray-300 p-1">is_submitted</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Submission flag</td></tr>
              <tr><td className="border border-gray-300 p-1">auto_submitted</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Timeout auto-submit</td></tr>
              <tr><td className="border border-gray-300 p-1">is_locked</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Locked for editing</td></tr>
              <tr><td className="border border-gray-300 p-1">lock_reason</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Why locked</td></tr>
              <tr><td className="border border-gray-300 p-1">time_spent_seconds</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Total time</td></tr>
              <tr><td className="border border-gray-300 p-1">evaluation_status</td><td className="border border-gray-300 p-1">evaluation_status</td><td className="border border-gray-300 p-1">pending|ai_evaluated|teacher_reviewed|finalized|disputed</td></tr>
              <tr><td className="border border-gray-300 p-1">is_finalized</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Evaluation complete</td></tr>
              <tr><td className="border border-gray-300 p-1">finalized_by, finalized_at</td><td className="border border-gray-300 p-1">UUID, TIMESTAMP</td><td className="border border-gray-300 p-1">Finalization audit</td></tr>
              <tr><td className="border border-gray-300 p-1">is_offline</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Offline exam flag</td></tr>
              <tr><td className="border border-gray-300 p-1">ocr_processed</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">OCR complete</td></tr>
              <tr><td className="border border-gray-300 p-1">answer_sheet_url</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Scanned sheet URL</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-orange-50 p-2 rounded">student_answers</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Answer ID</td></tr>
              <tr><td className="border border-gray-300 p-1">attempt_id, question_id</td><td className="border border-gray-300 p-1">UUID FK (UNIQUE)</td><td className="border border-gray-300 p-1">One answer per question</td></tr>
              <tr><td className="border border-gray-300 p-1">answer_source</td><td className="border border-gray-300 p-1">answer_source</td><td className="border border-gray-300 p-1">online|offline_ocr|offline_manual</td></tr>
              <tr><td className="border border-gray-300 p-1">answer_text</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Text answer</td></tr>
              <tr><td className="border border-gray-300 p-1">answer_options</td><td className="border border-gray-300 p-1">JSONB</td><td className="border border-gray-300 p-1">Selected MCQ options</td></tr>
              <tr><td className="border border-gray-300 p-1">answer_file_url</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Uploaded file</td></tr>
              <tr><td className="border border-gray-300 p-1">answered_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">When answered</td></tr>
              <tr><td className="border border-gray-300 p-1">ocr_extracted_text</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Raw OCR output</td></tr>
              <tr><td className="border border-gray-300 p-1">ocr_confidence</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">0-1 confidence</td></tr>
              <tr><td className="border border-gray-300 p-1">ocr_needs_review</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Low confidence flag</td></tr>
            </tbody>
          </table>
        </div>

        {/* AI & Evaluation Tables */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-6">5.5 AI & Evaluation Tables</h3>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-red-50 p-2 rounded">evaluation_blueprints</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, exam_id, question_id, section_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">max_marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Maximum marks</td></tr>
              <tr><td className="border border-gray-300 p-1">keywords</td><td className="border border-gray-300 p-1">TEXT[]</td><td className="border border-gray-300 p-1">Expected keywords</td></tr>
              <tr><td className="border border-gray-300 p-1">marking_scheme</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Detailed rubric</td></tr>
              <tr><td className="border border-gray-300 p-1">partial_marking_allowed</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Allow partial marks</td></tr>
              <tr><td className="border border-gray-300 p-1">negative_marking</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Wrong answer penalty</td></tr>
              <tr><td className="border border-gray-300 p-1">ai_evaluation_enabled</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Use AI grading</td></tr>
              <tr><td className="border border-gray-300 p-1">ai_confidence_threshold</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Min confidence (default 0.7)</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-red-50 p-2 rounded">ai_evaluations</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, answer_id</td><td className="border border-gray-300 p-1">UUID (1:1)</td><td className="border border-gray-300 p-1">One AI eval per answer</td></tr>
              <tr><td className="border border-gray-300 p-1">suggested_marks</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">AI suggested score</td></tr>
              <tr><td className="border border-gray-300 p-1">max_marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Maximum possible</td></tr>
              <tr><td className="border border-gray-300 p-1">confidence_score</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">0-1 confidence</td></tr>
              <tr><td className="border border-gray-300 p-1">matched_keywords</td><td className="border border-gray-300 p-1">TEXT[]</td><td className="border border-gray-300 p-1">Keywords found</td></tr>
              <tr><td className="border border-gray-300 p-1">evaluation_reasoning</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">AI explanation</td></tr>
              <tr><td className="border border-gray-300 p-1">feedback_suggestion</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Suggested feedback</td></tr>
              <tr><td className="border border-gray-300 p-1">requires_teacher_review</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Low confidence flag</td></tr>
              <tr><td className="border border-gray-300 p-1">is_accepted</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Teacher accepted</td></tr>
              <tr><td className="border border-gray-300 p-1">model_used</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"gpt-4o-mini"</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-red-50 p-2 rounded">teacher_overrides</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, answer_id</td><td className="border border-gray-300 p-1">UUID (1:1)</td><td className="border border-gray-300 p-1">One override per answer</td></tr>
              <tr><td className="border border-gray-300 p-1">ai_evaluation_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Link to AI eval</td></tr>
              <tr><td className="border border-gray-300 p-1">final_marks</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Final awarded marks</td></tr>
              <tr><td className="border border-gray-300 p-1">max_marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Maximum possible</td></tr>
              <tr><td className="border border-gray-300 p-1">accepted_ai_suggestion</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Used AI score</td></tr>
              <tr><td className="border border-gray-300 p-1">override_reason</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Why different from AI</td></tr>
              <tr><td className="border border-gray-300 p-1">teacher_feedback</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Feedback to student</td></tr>
              <tr><td className="border border-gray-300 p-1">internal_notes</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Private notes</td></tr>
              <tr><td className="border border-gray-300 p-1">evaluated_by</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Teacher who evaluated</td></tr>
              <tr><td className="border border-gray-300 p-1">is_verified</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Double-checked</td></tr>
              <tr><td className="border border-gray-300 p-1">is_auto_graded</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">MCQ auto-grade</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-red-50 p-2 rounded">final_results</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, attempt_id</td><td className="border border-gray-300 p-1">UUID (1:1)</td><td className="border border-gray-300 p-1">One result per attempt</td></tr>
              <tr><td className="border border-gray-300 p-1">total_marks_obtained</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Final score</td></tr>
              <tr><td className="border border-gray-300 p-1">total_max_marks</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Maximum possible</td></tr>
              <tr><td className="border border-gray-300 p-1">percentage</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Score percentage</td></tr>
              <tr><td className="border border-gray-300 p-1">grade</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"A", "B", "C"...</td></tr>
              <tr><td className="border border-gray-300 p-1">is_pass</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Pass/fail</td></tr>
              <tr><td className="border border-gray-300 p-1">rank_in_class</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Class rank</td></tr>
              <tr><td className="border border-gray-300 p-1">section_scores</td><td className="border border-gray-300 p-1">JSONB</td><td className="border border-gray-300 p-1">Per-section breakdown</td></tr>
              <tr><td className="border border-gray-300 p-1">is_published</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Visible to student</td></tr>
              <tr><td className="border border-gray-300 p-1">published_by, published_at</td><td className="border border-gray-300 p-1">UUID, TIMESTAMP</td><td className="border border-gray-300 p-1">Publication audit</td></tr>
              <tr><td className="border border-gray-300 p-1">finalized_by, finalized_at</td><td className="border border-gray-300 p-1">UUID, TIMESTAMP</td><td className="border border-gray-300 p-1">Finalization audit</td></tr>
            </tbody>
          </table>
        </div>

        {/* Page Break */}
        <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>

        {/* Analytics Tables */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3">5.6 Analytics & Aggregation Tables</h3>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-yellow-50 p-2 rounded">student_performance_snapshots</h4>
          <p className="text-xs text-gray-600 mb-1">Created on attempt finalization via DB trigger</p>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, student_id, attempt_id, exam_id, class_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">total_questions</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Questions in exam</td></tr>
              <tr><td className="border border-gray-300 p-1">questions_attempted</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Questions answered</td></tr>
              <tr><td className="border border-gray-300 p-1">questions_correct</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Correct answers</td></tr>
              <tr><td className="border border-gray-300 p-1">questions_skipped</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Skipped questions</td></tr>
              <tr><td className="border border-gray-300 p-1">total_time_seconds</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Total attempt time</td></tr>
              <tr><td className="border border-gray-300 p-1">accuracy_percent</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">(correct/attempted)*100</td></tr>
              <tr><td className="border border-gray-300 p-1">avg_time_per_question_seconds</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">time/questions</td></tr>
              <tr><td className="border border-gray-300 p-1">efficiency_score</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">accuracy/time ratio</td></tr>
              <tr><td className="border border-gray-300 p-1">snapshot_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">When computed</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-yellow-50 p-2 rounded">class_aggregates</h4>
          <p className="text-xs text-gray-600 mb-1">Computed via compute-aggregates edge function</p>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, class_id, exam_id, subject_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">total_students</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Students in class</td></tr>
              <tr><td className="border border-gray-300 p-1">students_attempted</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Who attempted</td></tr>
              <tr><td className="border border-gray-300 p-1">students_passed</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Who passed</td></tr>
              <tr><td className="border border-gray-300 p-1">avg_score_percent</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Class average %</td></tr>
              <tr><td className="border border-gray-300 p-1">avg_accuracy_percent</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Class accuracy</td></tr>
              <tr><td className="border border-gray-300 p-1">avg_efficiency_score</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Class efficiency</td></tr>
              <tr><td className="border border-gray-300 p-1">avg_time_per_question_seconds</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Class avg time</td></tr>
              <tr><td className="border border-gray-300 p-1">topper_student_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Class topper</td></tr>
              <tr><td className="border border-gray-300 p-1">topper_name</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">Topper name</td></tr>
              <tr><td className="border border-gray-300 p-1">topper_accuracy_percent</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Topper accuracy</td></tr>
              <tr><td className="border border-gray-300 p-1">score_distribution</td><td className="border border-gray-300 p-1">JSONB</td><td className="border border-gray-300 p-1">Histogram data</td></tr>
              <tr><td className="border border-gray-300 p-1">subject_averages</td><td className="border border-gray-300 p-1">JSONB</td><td className="border border-gray-300 p-1">Per-subject breakdown</td></tr>
              <tr><td className="border border-gray-300 p-1">computed_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">When computed</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-yellow-50 p-2 rounded">student_topic_performance</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, student_id, topic_id, subject_id, exam_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">questions_attempted</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Topic questions attempted</td></tr>
              <tr><td className="border border-gray-300 p-1">questions_correct</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Correct in topic</td></tr>
              <tr><td className="border border-gray-300 p-1">accuracy_percent</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Topic accuracy</td></tr>
              <tr><td className="border border-gray-300 p-1">total_time_seconds</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Time on topic</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-yellow-50 p-2 rounded">concept_mastery</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id, student_id, topic_id, subject_id, institution_id</td><td className="border border-gray-300 p-1">UUID</td><td className="border border-gray-300 p-1">References</td></tr>
              <tr><td className="border border-gray-300 p-1">mastery_level</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">0-100 mastery %</td></tr>
              <tr><td className="border border-gray-300 p-1">total_questions_attempted</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Lifetime attempts</td></tr>
              <tr><td className="border border-gray-300 p-1">total_questions_correct</td><td className="border border-gray-300 p-1">INTEGER</td><td className="border border-gray-300 p-1">Lifetime correct</td></tr>
              <tr><td className="border border-gray-300 p-1">avg_time_per_question_seconds</td><td className="border border-gray-300 p-1">DECIMAL</td><td className="border border-gray-300 p-1">Avg time</td></tr>
              <tr><td className="border border-gray-300 p-1">trend</td><td className="border border-gray-300 p-1">TEXT</td><td className="border border-gray-300 p-1">"improving"|"declining"|"stable"</td></tr>
              <tr><td className="border border-gray-300 p-1">last_exam_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Most recent exam</td></tr>
              <tr><td className="border border-gray-300 p-1">last_updated</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">Last update</td></tr>
            </tbody>
          </table>
        </div>

        {/* More tables continue... */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-6">5.7 Additional Important Tables</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-gray-50 p-2 rounded">
            <strong>OCR System:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>ocr_uploads - Sheet uploads</li>
              <li>ocr_extractions - Per-question OCR</li>
              <li>ocr_review_logs - Review audit</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-2 rounded">
            <strong>Proctoring:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>proctoring_sessions - Per-attempt session</li>
              <li>proctoring_events - Events (tab switch, etc.)</li>
              <li>proctoring_review_logs - Teacher review</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-2 rounded">
            <strong>Task Management:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>tasks - Task definitions</li>
              <li>task_assignments - Assignee/assigner</li>
              <li>task_evidence - Proof uploads</li>
              <li>task_comments - Discussion</li>
              <li>task_audit_logs - State changes</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-2 rounded">
            <strong>Badges & Gamification:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>badge_definitions - Badge types</li>
              <li>user_badges - Earned badges</li>
              <li>badge_progress - Progress tracking</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-2 rounded">
            <strong>Payments:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>institution_subscriptions</li>
              <li>payment_records</li>
              <li>payment_receipts</li>
              <li>subscription_alerts</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-2 rounded">
            <strong>Wings & Coordinators:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>wings - Organizational units</li>
              <li>wing_assignments - Coordinators</li>
              <li>wing_class_mappings - Classes in wing</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-2 rounded">
            <strong>AI Usage:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>ai_usage_quotas - Per-institution limits</li>
              <li>ai_daily_usage - Daily consumption</li>
              <li>ai_monthly_usage - Monthly rollup</li>
              <li>ai_usage_logs - Request logs</li>
              <li>user_question_limits - Per-user limits</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-2 rounded">
            <strong>Learning & Actions:</strong>
            <ul className="list-disc list-inside mt-1">
              <li>learning_actions - Recommendations</li>
              <li>ai_suggested_tasks - AI tasks</li>
              <li>student_passport - Achievement summary</li>
            </ul>
          </div>
        </div>

        {/* Page Break */}
        <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>

        {/* Enums */}
        <h3 className="text-lg font-semibold text-gray-800 mb-3">5.8 Database Enums</h3>
        <table className="w-full border-collapse border border-gray-300 text-xs mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Enum Name</th>
              <th className="border border-gray-300 p-2 text-left">Values</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2 font-mono">app_role</td><td className="border border-gray-300 p-2">super_admin, school_admin, coordinator, teacher, student, employee</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">exam_status</td><td className="border border-gray-300 p-2">draft, ready, published, active, completed, archived</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">exam_mode</td><td className="border border-gray-300 p-2">online, offline, hybrid</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">question_type</td><td className="border border-gray-300 p-2">mcq, short_answer, long_answer, true_false, fill_blank, matching</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">section_type</td><td className="border border-gray-300 p-2">mcq, true_false, fill_blank, short_answer, long_answer, matching, comprehension, case_study</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">answer_source</td><td className="border border-gray-300 p-2">online, offline_ocr, offline_manual</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">evaluation_status</td><td className="border border-gray-300 p-2">pending, ai_evaluated, teacher_reviewed, finalized, disputed</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">attempt_action</td><td className="border border-gray-300 p-2">started, resumed, answer_saved, answer_changed, submitted, auto_submitted, timed_out, abandoned</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">task_status</td><td className="border border-gray-300 p-2">open, in_progress, done_pending_approval, completed, rejected</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">task_type</td><td className="border border-gray-300 p-2">exam_related, academic_content, student_support, administrative, general</td></tr>
          </tbody>
        </table>
      </section>

      {/* Exam Creation System */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">6. Exam Creation System</h2>
        
        <h3 className="text-lg font-semibold text-gray-800 mb-3">6.1 Six-Step Wizard</h3>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <div className="flex items-center justify-between text-sm">
            <div className="text-center">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-1">1</div>
              <span>Context</span>
              <p className="text-xs text-gray-500">Class, Subject</p>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2"></div>
            <div className="text-center">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-1">2</div>
              <span>Metadata</span>
              <p className="text-xs text-gray-500">Title, Time, Mode</p>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2"></div>
            <div className="text-center">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-1">3</div>
              <span>Sections</span>
              <p className="text-xs text-gray-500">A, B, C...</p>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2"></div>
            <div className="text-center">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-1">4</div>
              <span>Questions</span>
              <p className="text-xs text-gray-500">Add/Generate</p>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2"></div>
            <div className="text-center">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-1">5</div>
              <span>Blueprint</span>
              <p className="text-xs text-gray-500">Keywords, Rubric</p>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2"></div>
            <div className="text-center">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-1">6</div>
              <span>Review</span>
              <p className="text-xs text-gray-500">Publish</p>
            </div>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">6.2 Question Addition Methods</h3>
        <table className="w-full border-collapse border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Method</th>
              <th className="border border-gray-300 p-2 text-left">Description</th>
              <th className="border border-gray-300 p-2 text-left">Best For</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">Manual Entry</td>
              <td className="border border-gray-300 p-2">Form-based with rich text, options, marks</td>
              <td className="border border-gray-300 p-2">Custom questions</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-2 font-semibold">AI Generated</td>
              <td className="border border-gray-300 p-2">GPT-4o-mini generates from topic + difficulty</td>
              <td className="border border-gray-300 p-2">Quick creation</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">Copy-Paste</td>
              <td className="border border-gray-300 p-2">AI parses pasted text into structured format</td>
              <td className="border border-gray-300 p-2">Migration from Word/PDF</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-2 font-semibold">Question Bank</td>
              <td className="border border-gray-300 p-2">Select from pre-approved global/school bank</td>
              <td className="border border-gray-300 p-2">Standardized tests</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">Bulk Upload</td>
              <td className="border border-gray-300 p-2">CSV import with validation</td>
              <td className="border border-gray-300 p-2">Large question sets</td>
            </tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-4">6.3 Exam Status Lifecycle</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-center justify-center text-sm space-x-2">
            <span className="bg-gray-200 px-3 py-1 rounded">Draft</span>
            <span>→</span>
            <span className="bg-yellow-100 px-3 py-1 rounded">Ready</span>
            <span>→</span>
            <span className="bg-green-100 px-3 py-1 rounded">Published</span>
            <span>→</span>
            <span className="bg-blue-100 px-3 py-1 rounded">Active</span>
            <span>→</span>
            <span className="bg-purple-100 px-3 py-1 rounded">Completed</span>
            <span>→</span>
            <span className="bg-gray-400 text-white px-3 py-1 rounded">Archived</span>
          </div>
          <p className="text-xs text-center mt-2 text-gray-600">Cannot revert from Published to Draft. Structure locked after publish.</p>
        </div>
      </section>

      {/* Page Break */}
      <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>

      {/* Analytics Dashboards */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">12. Analytics Dashboards</h2>
        
        <h3 className="text-lg font-semibold text-gray-800 mb-3">12.1 Metrics Dictionary</h3>
        <table className="w-full border-collapse border border-gray-300 text-xs mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Metric</th>
              <th className="border border-gray-300 p-2 text-left">Formula</th>
              <th className="border border-gray-300 p-2 text-left">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">Accuracy %</td>
              <td className="border border-gray-300 p-2 font-mono">(correct / attempted) × 100</td>
              <td className="border border-gray-300 p-2">student_performance_snapshots.accuracy_percent</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-2 font-semibold">Efficiency Score</td>
              <td className="border border-gray-300 p-2 font-mono">accuracy / avg_time_seconds</td>
              <td className="border border-gray-300 p-2">student_performance_snapshots.efficiency_score</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">Pass Rate</td>
              <td className="border border-gray-300 p-2 font-mono">(passed / total) × 100</td>
              <td className="border border-gray-300 p-2">Computed from final_results</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 p-2 font-semibold">Consistency</td>
              <td className="border border-gray-300 p-2 font-mono">100 - stdev(percentages)</td>
              <td className="border border-gray-300 p-2">Computed client-side</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2 font-semibold">Difficulty Index</td>
              <td className="border border-gray-300 p-2 font-mono">1 - (avg_score / max_score)</td>
              <td className="border border-gray-300 p-2">Computed from teacher_overrides</td>
            </tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-4">12.2 Performance Rating (School Admin)</h3>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-blue-900 mb-2">
            The School Performance Rating is a composite metric displayed on the Admin Dashboard with an interactive info (ⓘ) icon 
            that reveals the full calculation logic via a modal.
          </p>
          <table className="w-full border-collapse border border-blue-200 text-xs mb-2">
            <thead>
              <tr className="bg-blue-100">
                <th className="border border-blue-200 p-2 text-left">Component</th>
                <th className="border border-blue-200 p-2 text-left">Weight</th>
                <th className="border border-blue-200 p-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border border-blue-200 p-2">Average Score %</td><td className="border border-blue-200 p-2">40%</td><td className="border border-blue-200 p-2">Mean of final_results.percentage across institution exams</td></tr>
              <tr className="bg-blue-50"><td className="border border-blue-200 p-2">Pass Rate %</td><td className="border border-blue-200 p-2">35%</td><td className="border border-blue-200 p-2">(students with is_pass=true / total attempts) × 100</td></tr>
              <tr><td className="border border-blue-200 p-2">Improvement Trend</td><td className="border border-blue-200 p-2">25%</td><td className="border border-blue-200 p-2">Normalized: 50 + (recent30d_avg − prior30d_avg) × 2.5, clamped 0–100</td></tr>
            </tbody>
          </table>
          <div className="text-xs font-mono bg-white p-2 rounded border border-blue-200">
            Rating = (AvgScore × 0.4) + (PassRate × 0.35) + (ImprovementIndex × 0.25)
          </div>
          <div className="grid grid-cols-5 gap-1 mt-2 text-xs text-center">
            <div className="bg-red-100 text-red-800 p-1 rounded">&lt;40 Critical</div>
            <div className="bg-orange-100 text-orange-800 p-1 rounded">40-54 Needs Improvement</div>
            <div className="bg-amber-100 text-amber-800 p-1 rounded">55-69 Average</div>
            <div className="bg-blue-100 text-blue-800 p-1 rounded">70-84 Good</div>
            <div className="bg-green-100 text-green-800 p-1 rounded">≥85 Excellent</div>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">12.3 Status Classifications</h3>
        <div className="grid grid-cols-4 gap-2 text-sm mb-4">
          <div className="bg-red-100 text-red-800 p-2 rounded text-center">
            <strong>Needs Attention</strong><br/>&lt; 50%
          </div>
          <div className="bg-yellow-100 text-yellow-800 p-2 rounded text-center">
            <strong>Developing</strong><br/>50-65%
          </div>
          <div className="bg-green-100 text-green-800 p-2 rounded text-center">
            <strong>Stable</strong><br/>65-85%
          </div>
          <div className="bg-blue-100 text-blue-800 p-2 rounded text-center">
            <strong>Excellent</strong><br/>≥ 85%
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">12.4 Dashboard Per Role</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 p-3 rounded-lg text-sm">
            <h4 className="font-semibold text-green-900 mb-2">Student Dashboard</h4>
            <ul className="list-disc list-inside text-green-800 space-y-1 text-xs">
              <li>Overall accuracy, efficiency, pass rate</li>
              <li>Exams taken count</li>
              <li>Performance trend (improving/stable/declining)</li>
              <li>Strongest & weakest subjects</li>
              <li>Percentile rank in class</li>
              <li>Class comparison table</li>
              <li>Concept mastery visualization</li>
              <li>Learning actions assigned</li>
            </ul>
          </div>
          <div className="bg-blue-50 p-3 rounded-lg text-sm">
            <h4 className="font-semibold text-blue-900 mb-2">Teacher Dashboard</h4>
            <ul className="list-disc list-inside text-blue-800 space-y-1 text-xs">
              <li>Total students across classes</li>
              <li>Class-wise performance overview</li>
              <li>Student categorization (NA/Developing/Stable)</li>
              <li>Topic gaps identification</li>
              <li>Question difficulty analysis</li>
              <li>Score distribution charts</li>
              <li>Quadrant scatter plot (accuracy vs time)</li>
              <li>AI-suggested interventions</li>
            </ul>
          </div>
          <div className="bg-purple-50 p-3 rounded-lg text-sm">
            <h4 className="font-semibold text-purple-900 mb-2">Principal Dashboard</h4>
            <ul className="list-disc list-inside text-purple-800 space-y-1 text-xs">
              <li>Total students, teachers, classes</li>
              <li>School-wide average accuracy</li>
              <li>Class performance heatmap</li>
              <li>Cross-class comparisons</li>
              <li>Teacher effectiveness metrics</li>
              <li>Subject risk indicators</li>
              <li>At-risk student identification</li>
              <li>Performance trend over time</li>
            </ul>
          </div>
          <div className="bg-orange-50 p-3 rounded-lg text-sm">
            <h4 className="font-semibold text-orange-900 mb-2">Super Admin Dashboard</h4>
            <ul className="list-disc list-inside text-orange-800 space-y-1 text-xs">
              <li>Total institutions (active/inactive)</li>
              <li>Total users across platform</li>
              <li>Total exams by status</li>
              <li>AI quota consumption</li>
              <li>Revenue overview (MRR)</li>
              <li>Institution-level analytics</li>
              <li>Subscription alerts</li>
              <li>System-wide audit logs</li>
            </ul>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-4">12.5 Data Flow</h3>
        <div className="bg-gray-50 p-4 rounded-lg text-xs">
          <pre className="whitespace-pre-wrap font-mono">
{`student_answers → teacher_overrides → final_results
                                           ↓
                         [compute_student_performance_snapshot() trigger]
                                           ↓
                            student_performance_snapshots
                                           ↓
                         [compute-aggregates edge function]
                                           ↓
                    class_aggregates + school_aggregates
                                           ↓
                           Dashboard Queries (real-time)`}
          </pre>
        </div>
      </section>

      {/* Edge Cases */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">16. Edge Cases & Error Handling</h2>
        
        <table className="w-full border-collapse border border-gray-300 text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Scenario</th>
              <th className="border border-gray-300 p-2 text-left">Handling</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">No exams in institution</td><td className="border border-gray-300 p-2">Show "No data" message, metrics = 0</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">Student starts but doesn't submit</td><td className="border border-gray-300 p-2">Not counted in analytics</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam window expires mid-attempt</td><td className="border border-gray-300 p-2">Auto-submit with auto_submitted=true</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">Low OCR confidence (&lt;0.7)</td><td className="border border-gray-300 p-2">ocr_needs_review=true, flagged for teacher</td></tr>
            <tr><td className="border border-gray-300 p-2">All teachers deleted from class</td><td className="border border-gray-300 p-2">Exams remain, need reassignment</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">Division by zero (no questions)</td><td className="border border-gray-300 p-2">Return 0 for percentages</td></tr>
            <tr><td className="border border-gray-300 p-2">Finalization without full review</td><td className="border border-gray-300 p-2">DB trigger blocks (validate_attempt_finalization)</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">Attempt retake same exam</td><td className="border border-gray-300 p-2">Blocked - one attempt per student per exam</td></tr>
            <tr><td className="border border-gray-300 p-2">Exam structure change after publish</td><td className="border border-gray-300 p-2">Blocked by prevent_exam_structure_change trigger</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">Network disconnect during attempt</td><td className="border border-gray-300 p-2">Answers saved on each change, resume on reconnect</td></tr>
            <tr><td className="border border-gray-300 p-2">&gt;1000 students in dashboard query</td><td className="border border-gray-300 p-2">Use count: "exact", head: true (not array length)</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">Proctoring high-severity event</td><td className="border border-gray-300 p-2">Session flagged requires_review=true</td></tr>
          </tbody>
        </table>
      </section>

      {/* Security */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">17. Security & RLS Policies</h2>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-red-50 p-4 rounded-lg">
            <h3 className="font-semibold text-red-900 mb-2">Row Level Security (RLS)</h3>
            <p className="text-red-800 text-sm">
              All tables protected with PostgreSQL RLS. Users can only access data within their 
              institution scope. Helper functions: is_super_admin(), get_user_institution(), 
              has_role_at_institution(), is_assigned_to_class().
            </p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold text-green-900 mb-2">Authentication</h3>
            <p className="text-green-800 text-sm">
              Supabase Auth with email/password. Password expires in 7 days for students.
              must_reset_password flag forces reset on login. Session-based auth with JWT.
            </p>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">Key Security Functions</h3>
        <table className="w-full border-collapse border border-gray-300 text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Function</th>
              <th className="border border-gray-300 p-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2 font-mono">has_role(user_id, role)</td><td className="border border-gray-300 p-2">The base role check, used by essentially every policy</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">is_super_admin(user_id)</td><td className="border border-gray-300 p-2">Check if the user holds super_admin</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">is_institution_admin(user_id, institution_id)</td><td className="border border-gray-300 p-2">school_admin or super_school_admin at that institution</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">is_assigned_to_class(user_id, class_id)</td><td className="border border-gray-300 p-2">Check class assignment</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">is_coordinator_for_class(user_id, class_id)</td><td className="border border-gray-300 p-2">Wing coordinator access, over wing_assignments x wing_class_mappings</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">teacher_controls_student(teacher, student)</td><td className="border border-gray-300 p-2"><strong>THE</strong> teacher predicate: subject-scoped authority for every teacher read and write except attendance (see §37)</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">can_edit_student_details(...)</td><td className="border border-gray-300 p-2">Admits class-scoped teachers and coordinators to student-detail edits</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">institution_student_ids(institution_id)</td><td className="border border-gray-300 p-2">The single canonical student roster definition, so counts cannot disagree</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">optional_choices_recorded(...)</td><td className="border border-gray-300 p-2">Dormancy gate: all optional-subject narrowing stays inert until a section records choices</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">can_set_user_photo / can_view_user_photo</td><td className="border border-gray-300 p-2">Per-request authority on the private avatar bucket</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">can_review_student_leave(...)</td><td className="border border-gray-300 p-2">Class-scoped gate on the single leave decision path</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">can_evaluate_attempt(user_id, attempt_id)</td><td className="border border-gray-300 p-2">Check evaluation permissions</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">can_access_support_ticket / is_support_ticket_reporter</td><td className="border border-gray-300 p-2">Support thread authority, reporter versus SALCI side</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">dash_resolve_teacher_pairs()</td><td className="border border-gray-300 p-2">Resolves teacher dashboard scope. Never use the admin-first ladder for a teacher view</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">tt_is_timetable_manager / is_staff_manager / is_syllabus_manager / is_student_manager</td><td className="border border-gray-300 p-2">The four per-user capability grants, each raising one named user without a role change</td></tr>
          </tbody>
        </table>
        <div className="bg-red-50 p-4 rounded-lg mt-4">
          <h3 className="font-semibold text-red-900 mb-2">Policy construction rules</h3>
          <ul className="list-disc list-inside text-red-900 text-sm space-y-1">
            <li>Policies call SECURITY DEFINER helpers <strong>only</strong>. An inline cross-table <code className="bg-white px-1 rounded">EXISTS</code> in a mutually-referencing policy pair aborts with <code className="bg-white px-1 rounded">42P17 infinite recursion detected in policy</code>.</li>
            <li>Wrap stable per-row calls as <code className="bg-white px-1 rounded">(select auth.uid())</code> so the planner treats them as an initplan rather than a per-row call.</li>
            <li>Every UPDATE policy needs both <code className="bg-white px-1 rounded">USING</code> and <code className="bg-white px-1 rounded">WITH CHECK</code>. A missing <code className="bg-white px-1 rounded">WITH CHECK</code> silently rejects every write.</li>
            <li>Every new SECURITY DEFINER function must <code className="bg-white px-1 rounded">REVOKE EXECUTE ... FROM anon</code> by name; the Supabase default grants it and revoking from PUBLIC does not strip it.</li>
            <li>Views that gate on the caller stay <code className="bg-white px-1 rounded">security_invoker=on</code>.</li>
          </ul>
        </div>
      </section>

      {/* Edge Functions */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">18. Edge Functions</h2>
        
        <table className="w-full border-collapse border border-gray-300 text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Function</th>
              <th className="border border-gray-300 p-2 text-left">Purpose</th>
              <th className="border border-gray-300 p-2 text-left">Trigger</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2 font-mono">auto-grade-submission</td><td className="border border-gray-300 p-2">AI evaluation of subjective answers</td><td className="border border-gray-300 p-2">After submission</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">compute-aggregates</td><td className="border border-gray-300 p-2">Calculate class/school stats</td><td className="border border-gray-300 p-2">Manual/Exam complete</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">generate-questions</td><td className="border border-gray-300 p-2">AI question generation</td><td className="border border-gray-300 p-2">User request</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">generate-exam-insights</td><td className="border border-gray-300 p-2">AI-powered performance analysis</td><td className="border border-gray-300 p-2">After finalization</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">generate-learning-actions</td><td className="border border-gray-300 p-2">AI learning recommendations</td><td className="border border-gray-300 p-2">After exam results</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">process-ocr-upload</td><td className="border border-gray-300 p-2">OCR text extraction</td><td className="border border-gray-300 p-2">Sheet upload</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">admin-operations</td><td className="border border-gray-300 p-2">Privileged admin actions (create/delete users, bulk update profiles, role changes)</td><td className="border border-gray-300 p-2">Admin requests</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">mascot-chat</td><td className="border border-gray-300 p-2">AI mascot conversations</td><td className="border border-gray-300 p-2">Student chat</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">send-welcome-email</td><td className="border border-gray-300 p-2">Welcome email via Resend</td><td className="border border-gray-300 p-2">User creation</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">import-syllabus-csv</td><td className="border border-gray-300 p-2">Bulk syllabus import</td><td className="border border-gray-300 p-2">CSV upload</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">generate-predictions</td><td className="border border-gray-300 p-2">AI-powered performance predictions &amp; trend forecasting</td><td className="border border-gray-300 p-2">Dashboard request</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">generate-principal-ai-insights</td><td className="border border-gray-300 p-2">AI insights for principal dashboard</td><td className="border border-gray-300 p-2">Dashboard request</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">generate-principal-tasks</td><td className="border border-gray-300 p-2">AI-suggested tasks for admins</td><td className="border border-gray-300 p-2">Dashboard request</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">send-task-notifications</td><td className="border border-gray-300 p-2">Email notifications for task events</td><td className="border border-gray-300 p-2">Task creation/update</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">invite-admin</td><td className="border border-gray-300 p-2">Create admin users for institutions</td><td className="border border-gray-300 p-2">Super admin action</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">resolve-login-identifier</td><td className="border border-gray-300 p-2">Resolve email/phone/admission number to auth email</td><td className="border border-gray-300 p-2">Login form</td></tr>
            <tr><td className="border border-gray-300 p-2" colSpan={3}><strong>Module families (not listed individually above):</strong> Hybrid (5, see §29), Homework (3: <span className="font-mono">submit-homework</span>, <span className="font-mono">homework-file-url</span>, <span className="font-mono">homework-notify-pass</span>; see §28), Timetable (4: <span className="font-mono">copy-timetable-template</span>, <span className="font-mono">get-working-days</span>, <span className="font-mono">tt-notify-substitute</span>, <span className="font-mono">tt-notify-absence-pending</span>), Support (1: <span className="font-mono">support-notify-email</span>, see §33). <strong>37 school-platform edge functions, plus a <span className="font-mono">_shared</span> module.</strong> All <span className="font-mono">admin-operations</span> call sites go through <span className="font-mono">invokeAdminOperation</span>, a direct authenticated fetch, because <span className="font-mono">supabase.functions.invoke</span> sends an empty Bearer token in this client setup.</td></tr>
          </tbody>
        </table>
      </section>

      {/* Storage Buckets */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">19. Storage Buckets</h2>
        
        <table className="w-full border-collapse border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-left">Bucket</th>
              <th className="border border-gray-300 p-2 text-left">Public</th>
              <th className="border border-gray-300 p-2 text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2">user-avatars</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Profile photos. Every read is authorised by <code>can_view_user_photo</code>, writes by <code>can_set_user_photo</code> plus a path-ownership trigger. There is no public profile-photos bucket</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">question-images</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Question and per-option diagrams; bucket-level size limits</td></tr>
            <tr><td className="border border-gray-300 p-2">exam-sheets</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Source papers for results-only exams, institution-scoped RLS</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">answer-sheets</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Scanned answer sheets for OCR</td></tr>
            <tr><td className="border border-gray-300 p-2">hybrid-answer-sheets</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Phone-captured hybrid pages, written by the hybrid upload functions</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">homework-files</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Homework submissions. Owner-only; markers read through the <code>homework-file-url</code> broker</td></tr>
            <tr><td className="border border-gray-300 p-2">notice-attachments</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Notice Board attachments, audience-scoped</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">message-attachments</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Conversation attachments, participant-scoped</td></tr>
            <tr><td className="border border-gray-300 p-2">study-materials</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Subject and Syllabus Parts PDFs, institution-scoped read</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">staff-documents</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">HR documents, HR and owner only</td></tr>
            <tr><td className="border border-gray-300 p-2">task-evidence</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Task completion evidence</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">task-voice-comments</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Audio comments on tasks</td></tr>
            <tr><td className="border border-gray-300 p-2">proctoring-screenshots</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Proctoring evidence</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">face-photos</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Face enrolment for attendance</td></tr>
            <tr><td className="border border-gray-300 p-2">institution-logos</td><td className="border border-gray-300 p-2">Yes</td><td className="border border-gray-300 p-2">Institution branding, admin write</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2">circular-attachments</td><td className="border border-gray-300 p-2">No</td><td className="border border-gray-300 p-2">Legacy circular documents, superseded by notice-attachments</td></tr>
          </tbody>
        </table>
        <p className="text-gray-600 text-xs mt-2">16 school-platform buckets. Anything holding student work, identity or staff data is private and read through a signed URL or a broker edge function, never a public URL.</p>
      </section>

      {/* Recent System Improvements */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">20. Recent System Improvements (v2.1–v2.3)</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.1 Exam Draft Deduplication</h3>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-green-900 mb-2">
            Previously, each "Save Draft" action created a new exam record, leading to duplicate drafts. 
            The system now tracks the <code className="bg-white px-1 rounded">examId</code> across the wizard lifecycle.
          </p>
          <ul className="list-disc list-inside text-green-800 text-xs space-y-1">
            <li><strong>First save:</strong> INSERT new exam record, capture returned ID</li>
            <li><strong>Subsequent saves:</strong> UPDATE existing record using stored ID</li>
            <li><strong>Child records</strong> (sections, classes, subjects): Deleted and re-inserted on each save</li>
            <li><strong>Race condition guard:</strong> <code className="bg-white px-1 rounded">isSavingRef</code> prevents concurrent save operations</li>
            <li><strong>Scope:</strong> <code className="bg-white px-1 rounded">examId</code> added to ExamFormData type, managed via useExamForm hook</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.2 Report Download Isolation</h3>
        <div className="bg-yellow-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-yellow-900 mb-2">
            Report downloads previously captured the entire webpage (sidebar, navigation). 
            Now the report content is cloned into a temporary hidden container before PDF generation.
          </p>
          <ul className="list-disc list-inside text-yellow-800 text-xs space-y-1">
            <li>Target element cloned via <code className="bg-white px-1 rounded">cloneNode(true)</code></li>
            <li>Clone placed in off-screen container with fixed dimensions</li>
            <li>html2pdf processes only the isolated clone</li>
            <li>Temporary container removed after export completes</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.3 Student Count Fix</h3>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-blue-900">
            Dashboard student count was always showing 1 due to querying <code className="bg-white px-1 rounded">profiles</code> directly. 
            Fixed to count from <code className="bg-white px-1 rounded">class_assignments</code> where <code className="bg-white px-1 rounded">role = 'student'</code> and 
            institution matches via class → institution_id join.
          </p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.4 Wing Assignment Deduplication</h3>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-purple-900">
            Wing-class mappings previously duplicated on reassignment. Fixed using 
            <code className="bg-white px-1 rounded">upsert</code> with <code className="bg-white px-1 rounded">onConflict: 'wing_id,class_id'</code> 
            to prevent duplicate entries instead of delete-and-reinsert pattern.
          </p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.5 Proctoring Flag System</h3>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-red-900 mb-2">
            Proctoring Review Page now includes a comprehensive Flag Reference documenting all event types, 
            severity levels, and calculation logic.
          </p>
          <table className="w-full border-collapse border border-red-200 text-xs">
            <thead>
              <tr className="bg-red-100">
                <th className="border border-red-200 p-1 text-left">Event Type</th>
                <th className="border border-red-200 p-1 text-left">Severity</th>
                <th className="border border-red-200 p-1 text-left">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border border-red-200 p-1 font-mono">tab_switch</td><td className="border border-red-200 p-1">High</td><td className="border border-red-200 p-1">Student switched browser tab</td></tr>
              <tr><td className="border border-red-200 p-1 font-mono">window_blur</td><td className="border border-red-200 p-1">High</td><td className="border border-red-200 p-1">Browser window lost focus</td></tr>
              <tr><td className="border border-red-200 p-1 font-mono">fullscreen_exit</td><td className="border border-red-200 p-1">Medium</td><td className="border border-red-200 p-1">Exited fullscreen mode</td></tr>
              <tr><td className="border border-red-200 p-1 font-mono">face_not_detected</td><td className="border border-red-200 p-1">Medium</td><td className="border border-red-200 p-1">No face in camera frame</td></tr>
              <tr><td className="border border-red-200 p-1 font-mono">multiple_faces</td><td className="border border-red-200 p-1">High</td><td className="border border-red-200 p-1">Multiple faces detected</td></tr>
              <tr><td className="border border-red-200 p-1 font-mono">screenshot_captured</td><td className="border border-red-200 p-1">Info</td><td className="border border-red-200 p-1">Periodic screenshot for review</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-red-800 mt-2">
            <strong>Flag count formula:</strong> Total = count of all proctoring_events for the session. 
            Sessions with any high-severity event are auto-flagged with <code className="bg-white px-1 rounded">requires_review = true</code>.
          </p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.6 Admin Dashboard Enhancements</h3>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-gray-800 text-xs space-y-1">
            <li>Performance Rating Card with weighted composite score and info modal</li>
            <li>Quick metrics row: Average Score, Pass Rate, 30-day Trend with trend indicators</li>
            <li>Student count sourced from class_assignments (accurate count)</li>
            <li>"Create Exam" CTA accessible from Exams section header</li>
            <li>Performance data fetched via <code className="bg-white px-1 rounded">useSchoolPerformanceMetrics</code> hook</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.7 Individual User Deletion (v2.2)</h3>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-red-900 mb-2">
            Admin users can now delete individual students and teachers directly from their respective management pages
            via a "Delete" option in the row action dropdown menu.
          </p>
          <ul className="list-disc list-inside text-red-800 text-xs space-y-1">
            <li>Red <code className="bg-white px-1 rounded">Trash2</code> menu item in the dropdown, gated by <code className="bg-white px-1 rounded">isEffectiveAdmin</code></li>
            <li>Confirmation via <code className="bg-white px-1 rounded">AlertDialog</code> warning about permanent removal of auth, profiles, roles, and assignments</li>
            <li>Calls <code className="bg-white px-1 rounded">admin-operations</code> edge function with <code className="bg-white px-1 rounded">delete_user</code> action</li>
            <li>Backend validates caller is admin of the same institution before executing</li>
            <li>Access: <strong>super_admin, super_school_admin, school_admin</strong> only</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.8 Bulk User Deletion (v2.2)</h3>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-red-900 mb-2">
            Admins can select multiple students or teachers via checkboxes and delete them in bulk.
            Operations respect active class/section filters, naturally scoping selections.
          </p>
          <ul className="list-disc list-inside text-red-800 text-xs space-y-1">
            <li><strong>Students page:</strong> New checkbox column (select-all header + per-row) and floating bulk action bar</li>
            <li><strong>Teachers page:</strong> "Delete Selected" button added to existing bulk selection bar</li>
            <li>Bulk action bar shows "{'{N}'} selected" badge, "Clear" button, and destructive "Delete Selected" button</li>
            <li>Confirmation <code className="bg-white px-1 rounded">AlertDialog</code> warns about permanent removal of all selected users</li>
            <li>Sequentially invokes <code className="bg-white px-1 rounded">admin-operations → delete_user</code> for each selected ID</li>
            <li>Summary toast reports success/failure counts; queries invalidated on completion</li>
            <li>Access: <strong>super_admin, super_school_admin, school_admin</strong> only</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">20.9 Bulk Task Assignment (v2.2)</h3>
        <div className="bg-indigo-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-indigo-900 mb-2">
            A new <code className="bg-white px-1 rounded">BulkAssignTaskDialog</code> component allows assigning the same task
            to multiple selected students or teachers at once.
          </p>
          <ul className="list-disc list-inside text-indigo-800 text-xs space-y-1">
            <li>Reusable dialog at <code className="bg-white px-1 rounded">src/components/shared/BulkAssignTaskDialog.tsx</code></li>
            <li>Form fields: Title (required), Description, Task Type, Priority, Due Date, Supervisor (searchable select)</li>
            <li>Displays assignee list as badges at the top of the dialog</li>
            <li>Loops through each assignee calling <code className="bg-white px-1 rounded">useCreateTask().mutateAsync()</code></li>
            <li>Summary toast: "Task assigned to N person(s)" with failure count if any</li>
            <li>Available on both <strong>Students</strong> and <strong>Teachers</strong> pages in the bulk selection bar</li>
            <li>Access: <strong>super_admin, super_school_admin, school_admin, coordinator</strong></li>
          </ul>
          <h4 className="font-semibold text-indigo-900 text-xs mt-3 mb-1">Access Control Matrix (Bulk Features)</h4>
          <table className="w-full border-collapse border border-indigo-200 text-xs">
            <thead>
              <tr className="bg-indigo-100">
                <th className="border border-indigo-200 p-1 text-left">Feature</th>
                <th className="border border-indigo-200 p-1">super_admin</th>
                <th className="border border-indigo-200 p-1">super_school_admin</th>
                <th className="border border-indigo-200 p-1">school_admin</th>
                <th className="border border-indigo-200 p-1">coordinator</th>
                <th className="border border-indigo-200 p-1">teacher</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border border-indigo-200 p-1">Bulk Delete</td><td className="border border-indigo-200 p-1 text-center">✓</td><td className="border border-indigo-200 p-1 text-center">✓</td><td className="border border-indigo-200 p-1 text-center">✓</td><td className="border border-indigo-200 p-1 text-center">N/A</td><td className="border border-indigo-200 p-1 text-center">N/A</td></tr>
              <tr className="bg-indigo-50"><td className="border border-indigo-200 p-1">Bulk Task Assign</td><td className="border border-indigo-200 p-1 text-center">✓</td><td className="border border-indigo-200 p-1 text-center">✓</td><td className="border border-indigo-200 p-1 text-center">✓</td><td className="border border-indigo-200 p-1 text-center">✓</td><td className="border border-indigo-200 p-1 text-center">N/A</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 21: New Pages & Features (v2.2) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">21. New Pages & Features (v2.2)</h2>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.1 Manage Admins Page</h3>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-blue-900 mb-2">
            Institutional administrators can manage peer admins within their school via <code className="bg-white px-1 rounded">/school/admins</code>.
          </p>
          <ul className="list-disc list-inside text-blue-800 text-xs space-y-1">
            <li>Lists all <code className="bg-white px-1 rounded">school_admin</code> and <code className="bg-white px-1 rounded">super_school_admin</code> users for the institution</li>
            <li>Create new admin accounts with auto-generated or manual passwords</li>
            <li><strong>Designations:</strong> Stored in <code className="bg-white px-1 rounded">admin_title</code> column on <code className="bg-white px-1 rounded">user_roles</code> table (Principal, Vice-Principal, Owner, Custom)</li>
            <li>Inline designation editing via edit dialog</li>
            <li><strong>Promote/Demote:</strong> Flow between <code className="bg-white px-1 rounded">school_admin</code> ↔ <code className="bg-white px-1 rounded">super_school_admin</code> (Owner)</li>
            <li><strong>Safety check:</strong> Prevents deletion of the institution's final administrator</li>
            <li>KPI cards showing total admins and owner count</li>
            <li>Access: <strong>super_school_admin</strong> and <strong>super_admin</strong> only</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.2 Workforce Overview Page</h3>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-green-900 mb-2">
            A comprehensive task-based workforce monitoring dashboard at <code className="bg-white px-1 rounded">/school/workforce</code>.
          </p>
          <ul className="list-disc list-inside text-green-800 text-xs space-y-1">
            <li>KPI cards: Total Staff, Open Tasks, Overdue Tasks, Completion Rate</li>
            <li><strong>Workforce Table:</strong> Per-user breakdown of assigned, open, in-progress, overdue, completed tasks with completion %</li>
            <li><strong>Filters:</strong> Role, Wing, Overdue threshold, Completion range, Activity status (active/inactive in last 7 days)</li>
            <li><strong>Staff Detail Panel:</strong> Slide-out panel showing open tasks, overdue tasks (with days overdue), tasks assigned by them, and completed tasks</li>
            <li><strong>Wing Comparison Table:</strong> Compare task metrics across wings</li>
            <li><strong>Admin Performance Table:</strong> Track tasks created, closed, overdue under each admin, avg closure days</li>
            <li>Data sourced from <code className="bg-white px-1 rounded">useWorkforceData</code> hook aggregating tasks, wings, and user roles</li>
            <li>Access: <strong>super_admin, super_school_admin, school_admin, coordinator</strong></li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.3 Predictions Tab (Principal Dashboard)</h3>
        <div className="bg-violet-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-violet-900 mb-2">
            A new "Predictions" tab on the Principal Dashboard providing data-driven performance forecasting.
          </p>
          <ul className="list-disc list-inside text-violet-800 text-xs space-y-1">
            <li><strong>Class Predictions:</strong> Current vs. predicted average scores per class using linear regression on historical exam results</li>
            <li><strong>Student Predictions:</strong> Individual student trend analysis (improving/stable/declining) with confidence levels</li>
            <li><strong>Teacher Trends:</strong> Per-teacher class performance trends over time</li>
            <li><strong>Subject Forecasts:</strong> Subject-level score predictions with moving averages</li>
            <li><strong>Score Distribution Buckets:</strong> 0-40, 40-60, 60-80, 80-100 breakdown</li>
            <li><strong>At-Risk &amp; Improving Students:</strong> Highlight top 8 declining and improving students</li>
            <li><strong>AI Outlook:</strong> Optional AI-generated narrative via <code className="bg-white px-1 rounded">generate-predictions</code> edge function</li>
            <li>Filters: Grade, Section, Subject</li>
            <li>Math: <code className="bg-white px-1 rounded">linearSlope()</code>, <code className="bg-white px-1 rounded">movingAverage()</code>, <code className="bg-white px-1 rounded">predictNext()</code> functions in <code className="bg-white px-1 rounded">usePredictionAnalytics</code></li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.4 Super Admin Omnivisibility</h3>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-amber-900 mb-2">
            Super Admins can impersonate any institution's admin, teacher, or student view directly from their dashboard.
          </p>
          <ul className="list-disc list-inside text-amber-800 text-xs space-y-1">
            <li><code className="bg-white px-1 rounded">OmnivisibilitySelector</code> component on Super Admin Dashboard</li>
            <li><strong>Three perspectives:</strong> School Admin view, Teacher view (select specific teacher), Student view (select class → student)</li>
            <li>Renders the actual dashboard component for the selected perspective</li>
            <li>Data fetched via <code className="bg-white px-1 rounded">useOmnivisibility</code> hook with cascading institution → class → user selectors</li>
            <li>Read-only mode, no mutations performed as the impersonated user</li>
            <li>Access: <strong>super_admin</strong> only</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.5 Recheck Management Page</h3>
        <div className="bg-orange-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-orange-900 mb-2">
            Admins can review and resolve student recheck requests at <code className="bg-white px-1 rounded">/school/rechecks</code>.
          </p>
          <ul className="list-disc list-inside text-orange-800 text-xs space-y-1">
            <li><strong>Tabs:</strong> Pending, Completed, Rejected recheck requests</li>
            <li>Each request shows: student name, exam title, question text, request reason, previous marks</li>
            <li><strong>Resolve dialog:</strong> Admin can accept (with new marks) or reject with resolution notes</li>
            <li>Updates <code className="bg-white px-1 rounded">recheck_requests</code> table with resolved_at, resolved_by, new_marks, resolution_notes, marks_changed</li>
            <li>Data sourced from <code className="bg-white px-1 rounded">useRecheckManagement</code> hook with deep joins to exam data</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.6 Bulk Student Profile Update</h3>
        <div className="bg-teal-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-teal-900 mb-2">
            Administrators can bulk update existing student profiles via Excel/CSV upload.
          </p>
          <ul className="list-disc list-inside text-teal-800 text-xs space-y-1">
            <li>Updatable fields: admission number, phone number, roll number</li>
            <li><strong>Matching key:</strong> Email address (case-insensitive)</li>
            <li><strong>Validation preview:</strong> Shows matched vs. unmatched records before committing</li>
            <li>Processes updates in batches of 500 via <code className="bg-white px-1 rounded">admin-operations</code> edge function (<code className="bg-white px-1 rounded">bulk_update_student_profiles</code> action)</li>
            <li>Component: <code className="bg-white px-1 rounded">BulkUpdateStudentsDialog</code> on the Students page</li>
            <li>Hook: <code className="bg-white px-1 rounded">useBulkUpdateProfiles</code></li>
            <li>Access: <strong>super_admin, super_school_admin, school_admin</strong></li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.7 Student Passport System</h3>
        <div className="bg-yellow-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-yellow-900 mb-2">
            A comprehensive student profile card aggregating all performance and engagement metrics.
          </p>
          <ul className="list-disc list-inside text-yellow-800 text-xs space-y-1">
            <li>Metrics: Total exams taken/passed, average/highest percentage, badges earned, total points</li>
            <li><strong>Passport Levels:</strong> Beginner (🌱), Intermediate (📚), Advanced (⭐), Expert (🏆), Master (👑)</li>
            <li><strong>Level formula:</strong> <code className="bg-white px-1 rounded">score = points + (exams × 10) + (avgPercentage × 2)</code></li>
            <li>Thresholds: Beginner ≤49, Intermediate 50-199, Advanced 200-499, Expert 500-999, Master ≥1000</li>
            <li>Falls back to computed data from <code className="bg-white px-1 rounded">student_exam_attempts</code>, <code className="bg-white px-1 rounded">final_results</code>, and <code className="bg-white px-1 rounded">user_badges</code> if no passport record exists</li>
            <li>Hook: <code className="bg-white px-1 rounded">useStudentPassport</code> with <code className="bg-white px-1 rounded">student_passport</code> table</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.8 School Admin Onboarding Wizard</h3>
        <div className="bg-emerald-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-emerald-900 mb-2">
            Guided onboarding wizard for new School Admins, surfaced on the Principal Dashboard.
          </p>
          <ul className="list-disc list-inside text-emerald-800 text-xs space-y-1">
            <li><strong>Checklist steps:</strong> Add Subjects, Add Teachers, Add Students, Create First Exam</li>
            <li>Each step validates completion via database queries (e.g., count of <code className="bg-white px-1 rounded">subject_class_mappings</code>)</li>
            <li>Progress bar showing completion percentage</li>
            <li>Auto-dismisses when all steps are complete; remembers dismissal in <code className="bg-white px-1 rounded">localStorage</code></li>
            <li>CTA buttons navigate to the relevant pages</li>
            <li>Component: <code className="bg-white px-1 rounded">SchoolAdminOnboardingWizard</code></li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.9 Promote Teacher to Coordinator</h3>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-purple-900 mb-2">
            Teachers can be promoted to coordinators directly from the Teachers page with wing assignment.
          </p>
          <ul className="list-disc list-inside text-purple-800 text-xs space-y-1">
            <li><code className="bg-white px-1 rounded">PromoteToCoordinatorDialog</code> with wing selection</li>
            <li>Adds the <code className="bg-white px-1 rounded">coordinator</code> role to the user's <code className="bg-white px-1 rounded">user_roles</code> and assigns selected wings</li>
            <li>Supports the <code className="bg-white px-1 rounded">hasDualTeacherCoordinatorRole</code> pattern</li>
            <li>Available in the teacher's action dropdown menu</li>
            <li>Access: <strong>super_admin, super_school_admin, school_admin</strong></li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.10 Comparison Sheet</h3>
        <div className="bg-sky-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-sky-900 mb-2">
            Side-by-side comparison tool for classes, teachers, or subjects on the Principal Dashboard.
          </p>
          <ul className="list-disc list-inside text-sky-800 text-xs space-y-1">
            <li>Select any two entities of the same type (class vs class, teacher vs teacher, etc.)</li>
            <li>Compares metrics: average score, pass rate, total students, improvement trends</li>
            <li>Rendered in a slide-out sheet via <code className="bg-white px-1 rounded">ComparisonSheet</code> component</li>
            <li>Available as a quick action from dashboard tables</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.11 Assign School Owner (Super Admin)</h3>
        <div className="bg-rose-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-rose-900 mb-2">
            Super Admins can assign a <code className="bg-white px-1 rounded">super_school_admin</code> (Owner) to any institution from the Institutions page.
          </p>
          <ul className="list-disc list-inside text-rose-800 text-xs space-y-1">
            <li><code className="bg-white px-1 rounded">AssignSchoolOwnerDialog</code> creates a new user account with the <code className="bg-white px-1 rounded">super_school_admin</code> role</li>
            <li>Generates credentials and displays them for the super admin to share</li>
            <li>Invoked via <code className="bg-white px-1 rounded">invite-admin</code> edge function</li>
            <li>Access: <strong>super_admin</strong> only</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.12 Notification Queue System</h3>
        <div className="bg-cyan-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-cyan-900 mb-2">
            Server-side notification pipeline for email delivery via the <code className="bg-white px-1 rounded">notification_queue</code> table and <code className="bg-white px-1 rounded">send-task-notifications</code> edge function.
          </p>
          <ul className="list-disc list-inside text-cyan-800 text-xs space-y-1">
            <li>Queued notifications with priority, retry logic (attempts, last_attempt_at), and error tracking</li>
            <li>Supports scheduled delivery (<code className="bg-white px-1 rounded">scheduled_for</code>) and multiple notification types</li>
            <li>Integrates with task lifecycle: creation, assignment, status changes, overdue reminders</li>
            <li>Real-time in-app notifications via <code className="bg-white px-1 rounded">notifications</code> table with <code className="bg-white px-1 rounded">useNotificationRealtime</code> hook</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">21.13 Login Identifier Resolution</h3>
        <div className="bg-slate-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-slate-900 mb-2">
            Users can log in using email, phone number, or admission number, not just email.
          </p>
          <ul className="list-disc list-inside text-slate-800 text-xs space-y-1">
            <li><code className="bg-white px-1 rounded">resolve-login-identifier</code> edge function resolves the identifier to an auth email</li>
            <li>Checks <code className="bg-white px-1 rounded">profiles</code> table for matching <code className="bg-white px-1 rounded">email</code>, <code className="bg-white px-1 rounded">phone_number</code>, or <code className="bg-white px-1 rounded">admission_number</code></li>
            <li>Returns the corresponding email for Supabase Auth sign-in</li>
            <li>Especially useful for students who may not have email addresses</li>
          </ul>
        </div>
      </section>

      {/* Section 22: Institution Feature Gating System */}
      <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">22. Institution Feature Gating System (v2.3)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          A comprehensive feature management system that allows Super Admins to control which modules are available to each institution.
          Disabled features are hidden from navigation, sidebar, and command center, and direct URL access is blocked with a redirect.
        </p>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <p className="text-purple-900 text-sm">
            <strong>Institution-TYPE gating (distinct from the per-institution toggles above):</strong> a second, separate mechanism keys off <code className="bg-white px-1 rounded">institutions.is_existing_salci_school</code> rather than the <code className="bg-white px-1 rounded">institution_features</code> toggle rows, and can restrict an institution's whole navigation surface by type. It never affects super admins or existing SALCI schools. When adding any type-level restriction, keep it out of the feature-flag path: mixing the two makes a school's visible surface impossible to reason about from the toggles alone.
          </p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">22.1 Feature Management (Super Admin)</h3>
        <div className="mb-4">
          <h4 className="font-semibold text-gray-700 bg-blue-50 p-2 rounded">institution_features</h4>
          <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1">Column</th>
              <th className="border border-gray-300 p-1">Type</th>
              <th className="border border-gray-300 p-1">Description</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">id</td><td className="border border-gray-300 p-1">UUID PK</td><td className="border border-gray-300 p-1">Primary key</td></tr>
              <tr><td className="border border-gray-300 p-1">institution_id</td><td className="border border-gray-300 p-1">UUID FK</td><td className="border border-gray-300 p-1">Target institution</td></tr>
              <tr><td className="border border-gray-300 p-1">feature_id</td><td className="border border-gray-300 p-1">TEXT NOT NULL</td><td className="border border-gray-300 p-1">Feature identifier (e.g., "fee_management")</td></tr>
              <tr><td className="border border-gray-300 p-1">is_enabled</td><td className="border border-gray-300 p-1">BOOLEAN</td><td className="border border-gray-300 p-1">Whether the feature is active</td></tr>
              <tr><td className="border border-gray-300 p-1">created_at</td><td className="border border-gray-300 p-1">TIMESTAMPTZ</td><td className="border border-gray-300 p-1">Audit timestamp</td></tr>
            </tbody>
          </table>
          <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
            <li><strong>26 configurable modules</strong> across 4 categories: Core (3), Academic (6), Operations (10), Advanced (6)</li>
            <li>Core features (Dashboard, User Management, Classes) are <strong>always enabled</strong> and cannot be toggled off</li>
            <li>Managed via <strong>Features tab</strong> in <code className="bg-gray-100 px-1 rounded">EditInstitutionDialog</code></li>
            <li>RLS: Super admins have full CRUD; institution users have read access to their own institution's features</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">22.2 Feature Gating Hook</h3>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-gray-700 mb-2">useInstitutionFeatures()</h4>
          <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
            <li>Fetches enabled features for the <strong>effective institution</strong> (supports super admin impersonation via <code className="bg-white px-1 rounded">useEffectiveInstitution</code>)</li>
            <li>Returns <code className="bg-white px-1 rounded">isFeatureEnabled(featureId: string): boolean</code> check function</li>
            <li>Returns <code className="bg-white px-1 rounded">enabledFeatures: string[]</code> list and <code className="bg-white px-1 rounded">isLoading</code> state</li>
            <li>Consumed by: Command Center, Sidebar, and ProtectedRoute</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">22.3 UI Enforcement: Command Center</h3>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
            <li><code className="bg-white px-1 rounded">FEATURE_URL_MAP</code> maps 12 URLs to feature IDs (e.g., <code className="bg-white px-1 rounded">/school/fees → fee_management</code>)</li>
            <li>Category nav groups filtered, disabled features hidden from grids</li>
            <li>Empty categories are auto-hidden from the landing view</li>
            <li>Dynamic card descriptions generated from enabled feature names (max 3 shown + "& more")</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">22.4 UI Enforcement: Sidebar</h3>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
            <li>Sidebar items filtered using <code className="bg-white px-1 rounded">FEATURE_URL_MAP</code> for <code className="bg-white px-1 rounded">school_admin</code> and <code className="bg-white px-1 rounded">super_school_admin</code> roles</li>
            <li>Super admin managing an institution also sees the filtered sidebar</li>
            <li>Sidebar groups with no visible items are auto-hidden</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">22.5 Direct URL Blocking (ProtectedRoute)</h3>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-red-900 text-sm space-y-1">
            <li><code className="bg-white px-1 rounded">ProtectedRoute</code> checks <code className="bg-white px-1 rounded">location.pathname</code> against <code className="bg-white px-1 rounded">FEATURE_URL_MAP</code></li>
            <li>If feature is disabled → redirects to <code className="bg-white px-1 rounded">/dashboard</code> with toast error: "This feature is not enabled for your institution."</li>
            <li>Enforced for: <code className="bg-white px-1 rounded">school_admin</code>, <code className="bg-white px-1 rounded">super_school_admin</code>, and <code className="bg-white px-1 rounded">super_admin</code> managing an institution</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">22.6 Multilingual Greeting Rotation</h3>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <p className="text-sm text-purple-900 mb-2">
            The Command Center header cycles through greetings in 16 languages every 40 seconds with animated transitions.
          </p>
          <ul className="list-disc list-inside text-purple-800 text-xs space-y-1">
            <li>Languages: English, Hindi, Spanish, German, French, Japanese, Punjabi, Marathi, Italian, Portuguese, Korean, Turkish, Russian, Chinese, Thai, Arabic</li>
            <li>Animated via <code className="bg-white px-1 rounded">framer-motion</code> <code className="bg-white px-1 rounded">AnimatePresence</code> with fade + slide transitions</li>
            <li>Personalized with user's first name from profile data</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">22.7 Feature URL Map Reference</h3>
        <table className="w-full border-collapse border border-gray-300 text-xs">
          <thead><tr className="bg-gray-100">
            <th className="border border-gray-300 p-1">URL Path</th>
            <th className="border border-gray-300 p-1">Feature ID</th>
          </tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-1">/school/fees</td><td className="border border-gray-300 p-1">fee_management</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/hr</td><td className="border border-gray-300 p-1">hr_payroll</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/attendance</td><td className="border border-gray-300 p-1">attendance</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/communication</td><td className="border border-gray-300 p-1">communication</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/billing</td><td className="border border-gray-300 p-1">billing</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/exams</td><td className="border border-gray-300 p-1">exams</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/rechecks</td><td className="border border-gray-300 p-1">recheck_management</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/syllabus</td><td className="border border-gray-300 p-1">syllabus</td></tr>
            <tr><td className="border border-gray-300 p-1">/question-bank</td><td className="border border-gray-300 p-1">question_bank</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/analytics</td><td className="border border-gray-300 p-1">reports</td></tr>
            <tr><td className="border border-gray-300 p-1">/school/wings</td><td className="border border-gray-300 p-1">wings</td></tr>
            <tr><td className="border border-gray-300 p-1">/tasks</td><td className="border border-gray-300 p-1">tasks</td></tr>
          </tbody>
        </table>
      </section>

      {/* Section 23: Timetable & Lesson Planning Module */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">23. Timetable & Lesson Planning Module (v2.4)</h2>
        <div className="border-2 border-red-400 bg-red-50 p-4 rounded-lg mb-4">
          <p className="text-red-900 text-sm font-semibold mb-1">⚠ HISTORICAL (v2.4), schema superseded.</p>
          <p className="text-red-900 text-sm">
            The legacy tables described below (<code className="bg-white px-1 rounded">day_templates</code>, <code className="bg-white px-1 rounded">calendar_exceptions</code>, <code className="bg-white px-1 rounded">lesson_plan_entries</code>, etc.) were <strong>DROPPED on 2026-04-23</strong>. The platform is now fully on the <code className="bg-white px-1 rounded">tt_*</code>/<code className="bg-white px-1 rounded">cal_*</code> schema, see Section 25.7 for the current model. This section is preserved for historical context only; the contradiction with 25.7 is intentional.
          </p>
        </div>
        <p className="text-gray-700 leading-relaxed mb-4">
          A comprehensive timetable management and lesson planning system with role-based views for school admins, coordinators, and teachers. Supports day templates, calendar exceptions, version-controlled scheduling, lesson plan tracking, topic pacing, and offline PWA support.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">23.1 Database Schema</h3>
        <table className="w-full border-collapse border border-gray-300 text-xs mb-4">
          <thead><tr className="bg-gray-100">
            <th className="border border-gray-300 p-2 text-left">Table</th>
            <th className="border border-gray-300 p-2 text-left">Purpose</th>
          </tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2 font-mono">day_templates</td><td className="border border-gray-300 p-2">Named period structures per academic year</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">day_template_slots</td><td className="border border-gray-300 p-2">Individual slots within a template (class, recess, prayer, lunch)</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">day_of_week_template_map</td><td className="border border-gray-300 p-2">Maps weekdays (Mon–Sat) to day templates</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">calendar_exceptions</td><td className="border border-gray-300 p-2">Holidays, overrides, early dismissals per date</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">timetable_versions</td><td className="border border-gray-300 p-2">Draft/published/archived versions per wing</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">timetable_slots</td><td className="border border-gray-300 p-2">Teacher + subject + class + room assigned to a template slot + version</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">teacher_workload_settings</td><td className="border border-gray-300 p-2">Max periods per week per teacher</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">timetable_acknowledgements</td><td className="border border-gray-300 p-2">Teacher confirmation of published timetable</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">lesson_plan_entries</td><td className="border border-gray-300 p-2">Per-slot per-date lesson record with topic, notes, status</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-mono">topic_pacing_targets (DROPPED 2026-04-18)</td><td className="border border-gray-300 p-2">Target periods per topic per grade level. Superseded by the tt_*/cal_* rebuild; do not reference</td></tr>
            <tr><td className="border border-gray-300 p-2 font-mono">admin_conflict_flags</td><td className="border border-gray-300 p-2">Cross-wing teacher scheduling conflicts</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">23.2 Postgres RPCs</h3>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-gray-700 text-sm space-y-2">
            <li><code className="bg-white px-1 rounded">get_session_state(p_user_id, p_institution_id)</code>, Returns role-specific state string</li>
            <li><code className="bg-white px-1 rounded">replace_timetable_slot(old_slot_id, new_data, p_published_edit)</code>, Atomic slot mutation with conflict checking</li>
            <li><code className="bg-white px-1 rounded">get_pacing_summary(p_institution_id, p_class_id, p_academic_year)</code>, Topic-level pacing data</li>
            <li><code className="bg-white px-1 rounded">rollover_session(p_institution_id, p_from_year, p_to_year)</code>, Clones structures for new academic year</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">23.3 Role-Based Views</h3>
        <table className="w-full border-collapse border border-gray-300 text-xs mb-4">
          <thead><tr className="bg-blue-50">
            <th className="border border-gray-300 p-2 text-left">Role</th>
            <th className="border border-gray-300 p-2 text-left">View</th>
            <th className="border border-gray-300 p-2 text-left">Key Features</th>
          </tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-2 font-semibold">School Admin</td><td className="border border-gray-300 p-2">AdminTimetableView</td><td className="border border-gray-300 p-2">Calendar setup, day template builder, workload settings, rollover, conflict flags</td></tr>
            <tr className="bg-gray-50"><td className="border border-gray-300 p-2 font-semibold">Coordinator</td><td className="border border-gray-300 p-2">CoordinatorTimetableView</td><td className="border border-gray-300 p-2">Grid + slot assignment, publish flow, completion tracker, topic cleanup</td></tr>
            <tr><td className="border border-gray-300 p-2 font-semibold">Teacher</td><td className="border border-gray-300 p-2">TeacherTimetableView</td><td className="border border-gray-300 p-2">Personal grid, lesson plan panel, pacing tracker, topic repository</td></tr>
          </tbody>
        </table>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">23.4 Session State Machine</h3>
        <div className="bg-teal-50 p-4 rounded-lg mb-4">
          <table className="w-full border-collapse border border-teal-200 text-xs">
            <thead><tr className="bg-teal-100">
              <th className="border border-teal-200 p-2 text-left">State</th>
              <th className="border border-teal-200 p-2 text-left">Role</th>
              <th className="border border-teal-200 p-2 text-left">Action</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-teal-200 p-2 font-mono">calendar_pending</td><td className="border border-teal-200 p-2">Admin</td><td className="border border-teal-200 p-2">Setup wizard</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">setup_complete</td><td className="border border-teal-200 p-2">Admin</td><td className="border border-teal-200 p-2">Overview dashboard</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">awaiting_setup</td><td className="border border-teal-200 p-2">Coordinator</td><td className="border border-teal-200 p-2">Locked card</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">planning_open</td><td className="border border-teal-200 p-2">Coordinator</td><td className="border border-teal-200 p-2">Grid + slot assignment</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">timetable_published</td><td className="border border-teal-200 p-2">Coordinator</td><td className="border border-teal-200 p-2">Editable with warnings</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">awaiting_timetable</td><td className="border border-teal-200 p-2">Teacher</td><td className="border border-teal-200 p-2">Info card</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">timetable_pending_ack</td><td className="border border-teal-200 p-2">Teacher</td><td className="border border-teal-200 p-2">Acknowledge banner</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">lesson_plans_incomplete</td><td className="border border-teal-200 p-2">Teacher</td><td className="border border-teal-200 p-2">Grid with status dots</td></tr>
              <tr><td className="border border-teal-200 p-2 font-mono">all_current</td><td className="border border-teal-200 p-2">Teacher</td><td className="border border-teal-200 p-2">All up to date</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">23.5 Slot Resolution Pipeline</h3>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <ol className="list-decimal list-inside text-amber-800 text-sm space-y-1">
            <li>Check <code className="bg-white px-1 rounded">calendar_exceptions</code> for the date</li>
            <li>Resolve day template via <code className="bg-white px-1 rounded">day_of_week_template_map</code></li>
            <li>Load template slots from <code className="bg-white px-1 rounded">day_template_slots</code></li>
            <li>Overlay timetable assignments from <code className="bg-white px-1 rounded">timetable_slots</code></li>
            <li>Attach lesson plan data from <code className="bg-white px-1 rounded">lesson_plan_entries</code></li>
            <li>Compute status indicators (green/grey/amber/red)</li>
          </ol>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">23.6 Key Components</h3>
        <div className="bg-indigo-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-indigo-900 text-sm space-y-1">
            <li><strong>TimetableGrid:</strong> Weekly grid with mobile horizontal scroll and sticky period column</li>
            <li><strong>SlotCell:</strong> Renders empty/filled/non-class/holiday states with status dots</li>
            <li><strong>SlotAssignmentSheet:</strong> Sheet with pickers and workload badges</li>
            <li><strong>LessonPlanPanel:</strong> Slide-over with bilingual TopicSearchInput</li>
            <li><strong>CalendarExceptionPicker:</strong> Visual calendar for holidays</li>
            <li><strong>DayTemplateBuilder:</strong> 7-day cards with template and slot creation</li>
            <li><strong>CompletionTracker:</strong> Per-teacher 14-day completion bars</li>
            <li><strong>PacingTracker:</strong> Topic progress bars vs targets</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">23.7 PWA Offline Support</h3>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-green-900 text-sm space-y-1">
            <li>IndexedDB store <code className="bg-white px-1 rounded">salci_lesson_plan_queue</code> for offline saves</li>
            <li><code className="bg-white px-1 rounded">useOfflineQueue</code> hook with queue/flush/pendingCount</li>
            <li>Amber banner when offline items pending</li>
            <li>Background Sync API via service worker</li>
          </ul>
        </div>
      </section>

      {/* Section 24: Recent Improvements v2.5 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">24. Recent Improvements (v2.5)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Version 2.5 includes critical authentication fixes, communication platform enhancements, and UI improvements across the platform.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">24.1 Password Management Fixes</h3>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-green-900 text-sm space-y-2">
            <li><strong>Change Password (Settings):</strong> Now verifies current password via <code className="bg-white px-1 rounded">supabase.auth.signInWithPassword</code> before allowing update. Shows inline error if current password is incorrect.</li>
            <li><strong>Forgot Password / Reset Password:</strong> Added PKCE code exchange support (<code className="bg-white px-1 rounded">supabase.auth.exchangeCodeForSession</code>) for modern Supabase recovery flows. Legacy hash-based flow retained as fallback.</li>
            <li><strong>PASSWORD_RECOVERY Event Listener:</strong> Added <code className="bg-white px-1 rounded">onAuthStateChange</code> listener as additional fallback for detecting recovery sessions.</li>
            <li><strong>Post-Reset Sign Out:</strong> After successful password reset, user is signed out and redirected to login for clean session.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">24.2 Communication Platform Enhancements</h3>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-blue-900 text-sm space-y-2">
            <li><strong>Role-Isolated Views:</strong> Uses <code className="bg-white px-1 rounded">useActiveRole</code> for strict view isolation for dual-role users (e.g., Teacher+Coordinator). Teacher-specific views render when context is set to teacher.</li>
            <li><strong>Cascading Recipient Filters:</strong> Class → Section → Student cascading filters with multi-selection visualized as dismissible Badge components.</li>
            <li><strong>Chat Header Resolution:</strong> Message threads display resolved recipient names or announcement titles with avatars.</li>
            <li><strong>Multi-File Attachments:</strong> Circulars support multi-file document attachments with acknowledgment tracking.</li>
            <li><strong>PTM & Appointments:</strong> Integrated management for scheduling, slot booking, and feedback.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">24.3 Command Center & Navigation</h3>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-purple-900 text-sm space-y-2">
            <li><strong>Curriculum Tab Reorder:</strong> Curriculum section (Syllabus, Question Bank) now appears above Examinations in the Academics tab for better logical flow.</li>
            <li><strong>Question Bank Feature:</strong> Added to Command Center as a feature-gated module under Curriculum.</li>
            <li><strong>Timetable Integration:</strong> Timetable module accessible from sidebar and Command Center with feature gating.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">24.4 Updated Feature URL Map</h3>
        <table className="w-full border-collapse border border-gray-300 text-xs mb-4">
          <thead><tr className="bg-gray-100">
            <th className="border border-gray-300 p-1">URL Path</th>
            <th className="border border-gray-300 p-1">Feature ID</th>
            <th className="border border-gray-300 p-1">New in v2.5</th>
          </tr></thead>
          <tbody>
            <tr><td className="border border-gray-300 p-1">/timetable</td><td className="border border-gray-300 p-1">timetable</td><td className="border border-gray-300 p-1">✅</td></tr>
            <tr><td className="border border-gray-300 p-1">/question-bank</td><td className="border border-gray-300 p-1">question_bank</td><td className="border border-gray-300 p-1">✅</td></tr>
          </tbody>
        </table>
      </section>

      {/* Section 25: Class Groups, Reliability & Mobile Exam Flow (v2.7) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">25. Class Groups, Reliability & Mobile Exam Flow (v2.7)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Version 2.7 (April 2026) introduces a parent <strong>class_groups</strong> container above section-level classes, ships platform-wide reliability work (translated error toasts, build-stamped service worker, hardened user-deletion cascade), and lands a mobile-first exam creation flow with auto-filled blueprints.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">25.1 Class Groups Container</h3>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <p className="text-blue-900 text-sm mb-2">
            Section rows in <code className="bg-white px-1 rounded">classes</code> now sit under a parent <code className="bg-white px-1 rounded">class_groups</code> row ("Class 10" contains 10A/10B/10C). The refactor is additive and fully shipped (Phases 1–4).
          </p>
          <ul className="list-disc list-inside text-blue-900 text-sm space-y-1">
            <li><strong>Schema:</strong> new <code className="bg-white px-1 rounded">class_groups</code> table; <code className="bg-white px-1 rounded">classes.class_group_id NOT NULL</code>; <code className="bg-white px-1 rounded">grade_levels</code> stays global (no <code className="bg-white px-1 rounded">institution_id</code>).</li>
            <li><strong>Subject catalog:</strong> written via <code className="bg-white px-1 rounded">subject_class_group_mappings</code>; an AFTER trigger (SECURITY DEFINER) materializes one row per child section into legacy <code className="bg-white px-1 rounded">subject_class_mappings</code> so existing readers (<code className="bg-white px-1 rounded">useTeacherAssignedSubjects</code>, <code className="bg-white px-1 rounded">useClassSubjects</code>, RLS JOINs) keep working. Admin surfaces never write the legacy table directly.</li>
            <li><strong>Chapters & topics:</strong> shared at the class-group level via <code className="bg-white px-1 rounded">chapter_topics.class_group_id</code> and <code className="bg-white px-1 rounded">topic_class_mappings.class_group_id</code>. Phase 4 dropped the legacy <code className="bg-white px-1 rounded">class_id</code> columns and rewrote six RLS policies to join through <code className="bg-white px-1 rounded">classes.class_group_id</code>.</li>
            <li><strong>Section-level scope:</strong> teachers/attendance/timetable/lessons/study materials/exams continue to key off <code className="bg-white px-1 rounded">class_id</code>. Fees are deferred and untouched.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">25.2 Question Bank Section Scope</h3>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <p className="text-purple-900 text-sm mb-2">
            Each question carries <code className="bg-white px-1 rounded">class_group_id</code> + optional <code className="bg-white px-1 rounded">question_bank_section_scope(question_id, class_id)</code> rows:
          </p>
          <ul className="list-disc list-inside text-purple-900 text-sm space-y-1">
            <li>Zero scope rows → <strong>class-wide</strong>: every teacher of the class_group sees it; students in the group see it.</li>
            <li>≥1 scope row → <strong>section-scoped</strong>: only teachers whose <code className="bg-white px-1 rounded">class_assignments.class_id</code> matches.</li>
            <li><code className="bg-white px-1 rounded">class_group_id IS NULL</code> (legacy) → institution-wide fallback.</li>
            <li>Admins/coordinators see the full pool; students see class-wide only.</li>
          </ul>
          <p className="text-purple-900 text-sm mt-2">
            <strong>RLS recursion fix (migration 20260426120000):</strong> the <code className="bg-white px-1 rounded">question_bank</code> SELECT policy and <code className="bg-white px-1 rounded">question_bank_section_scope</code> policies call SECURITY DEFINER helpers (<code className="bg-white px-1 rounded">question_has_section_scope</code>, <code className="bg-white px-1 rounded">user_is_in_question_scope</code>, <code className="bg-white px-1 rounded">get_question_institution_id</code>) instead of inline EXISTS subqueries, required because <code className="bg-white px-1 rounded">.insert(...).select()</code> was triggering <code className="bg-white px-1 rounded">42P17 infinite recursion</code>.
          </p>
          <p className="text-purple-900 text-sm mt-2">
            Three entry points: <code className="bg-white px-1 rounded">ManualQuestionForm</code>, <code className="bg-white px-1 rounded">AIGenerateQuestions</code>, and the admin <code className="bg-white px-1 rounded">AddQuestionToBankDialog</code>. Every saved question is class-wide by default (zero rows in <code className="bg-white px-1 rounded">question_bank_section_scope</code>), the per-upload audience picker was removed so authors don't have to make a routing decision on every question.
          </p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">25.3 Mobile-First Exam Creation Flow</h3>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-green-900 text-sm space-y-2">
            <li><strong>Touch-friendly wizard:</strong> exam creation is fully usable on a phone for the first time.</li>
            <li><strong>Blueprint auto-fill (mandatory):</strong> the new flow has no blueprint editor UI, so <code className="bg-white px-1 rounded">useSaveExam</code> and <code className="bg-white px-1 rounded">useUpdateExam</code> synthesize default blueprints (<code className="bg-white px-1 rounded">max_marks=q.marks</code>, <code className="bg-white px-1 rounded">partial_marking_allowed=true</code>, <code className="bg-white px-1 rounded">negative_marking=0</code>, <code className="bg-white px-1 rounded">ai_evaluation_enabled=true</code>, <code className="bg-white px-1 rounded">ai_confidence_threshold=0.75</code>) for every subjective question not in the user-configured set. Without this the <code className="bg-white px-1 rounded">prevent_invalid_exam_publish</code> trigger rejects publish.</li>
            <li><strong>AI Question Generation (board-paper rigor):</strong> difficulty is hardcoded to 5 (product decision: "always hardest, calibrated to grade level"). System prompt enforces JEE/NEET/Olympiad/CBSE rigor with mandatory KaTeX delimiters (<code className="bg-white px-1 rounded">$...$</code> inline, <code className="bg-white px-1 rounded">$$...$$</code> block), the frontend only renders dollar-delimited LaTeX so plain-text math is a HARD FAIL. <code className="bg-white px-1 rounded">repairLatexEscapes()</code> doubles backslash-letter sequences before <code className="bg-white px-1 rounded">JSON.parse</code> to prevent <code className="bg-white px-1 rounded">\f→U+000C</code>, <code className="bg-white px-1 rounded">\t→U+0009</code> destruction of LaTeX.</li>
            <li><strong>final_results.percentage is GENERATED:</strong> never include <code className="bg-white px-1 rounded">percentage</code> in INSERT/UPSERT. The column is <code className="bg-white px-1 rounded">NUMERIC(5,2) GENERATED ALWAYS AS (ROUND((total_marks_obtained / total_max_marks) * 100, 2)) STORED</code>; including it raises <code className="bg-white px-1 rounded">"cannot insert a non-DEFAULT value"</code> and the row is silently dropped. Fixed in <code className="bg-white px-1 rounded">useValidateExamResults</code> April 17, 2026.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">25.4 Error Translation Pipeline</h3>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <p className="text-amber-900 text-sm mb-2">
            Every <code className="bg-white px-1 rounded">onError</code>/<code className="bg-white px-1 rounded">catch</code>-toast routes through <code className="bg-white px-1 rounded">toastError(err, &#123; fallback, context &#125;)</code> from <code className="bg-white px-1 rounded">src/lib/toast.ts</code>. Raw Postgres strings never surface to users.
          </p>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><code className="bg-white px-1 rounded">23503</code> (FK violation) → "Can't complete this. Something it depends on is missing."</li>
            <li><code className="bg-white px-1 rounded">23505</code> (unique violation) → "This already exists."</li>
            <li><code className="bg-white px-1 rounded">42501</code> / RLS → "You don't have permission…"</li>
            <li>Edge function 4xx/5xx, <code className="bg-white px-1 rounded">supabase.functions.invoke</code> v2.89+ returns the generic string <code className="bg-white px-1 rounded">"Edge Function returned a non-2xx status code"</code> with the real body on <code className="bg-white px-1 rounded">error.context</code>. <code className="bg-white px-1 rounded">invokeAdminOperation</code> (<code className="bg-white px-1 rounded">src/lib/invokeEdgeFunction.ts</code>) reads <code className="bg-white px-1 rounded">error.context</code> and throws the real message.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">25.5 Service Worker Build-ID Stamping</h3>
        <div className="bg-cyan-50 p-4 rounded-lg mb-4">
          <p className="text-cyan-900 text-sm mb-2">
            Pre-fix, the cache name was hardcoded <code className="bg-white px-1 rounded">'salci-v1'</code>, deploys produced byte-identical <code className="bg-white px-1 rounded">sw.js</code>, <code className="bg-white px-1 rounded">controllerchange</code> never fired, and installed PWAs sat on stale builds. The three-file contract:
          </p>
          <ol className="list-decimal list-inside text-cyan-900 text-sm space-y-1">
            <li><code className="bg-white px-1 rounded">public/sw.js</code>, keeps the literal <code className="bg-white px-1 rounded">__BUILD_ID__</code> token in <code className="bg-white px-1 rounded">const CACHE = 'salci-__BUILD_ID__'</code>; <code className="bg-white px-1 rounded">install</code> calls <code className="bg-white px-1 rounded">skipWaiting()</code>, <code className="bg-white px-1 rounded">activate</code> calls <code className="bg-white px-1 rounded">clients.claim()</code>.</li>
            <li><code className="bg-white px-1 rounded">vite.config.ts</code> <code className="bg-white px-1 rounded">swBuildIdPlugin</code> rewrites the token in <code className="bg-white px-1 rounded">dist/sw.js</code> on every prod build (<code className="bg-white px-1 rounded">$&#123;Date.now().toString(36)&#125;-$&#123;rand&#125;</code>).</li>
            <li><code className="bg-white px-1 rounded">src/main.tsx</code> registration, <code className="bg-white px-1 rounded">registration.update()</code> on <code className="bg-white px-1 rounded">visibilitychange</code>, hourly polling, and <code className="bg-white px-1 rounded">controllerchange</code> handler that returns early on first-ever visits.</li>
          </ol>
          <p className="text-cyan-900 text-sm mt-2">
            <strong>Dirty-form coordination:</strong> auto-reload only fires when no <code className="bg-white px-1 rounded">form[data-dirty="true"]</code> is present. Otherwise a <code className="bg-white px-1 rounded">salci-update-ready</code> event is dispatched and <code className="bg-white px-1 rounded">App.tsx</code> shows a Sonner toast. Forms with unsaved input MUST set <code className="bg-white px-1 rounded">data-dirty="true"</code>.
          </p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">25.6 User Deletion Cascade Contract</h3>
        <div className="bg-rose-50 p-4 rounded-lg mb-4">
          <p className="text-rose-900 text-sm mb-2">
            Profile deletion goes through <code className="bg-white px-1 rounded">supabase.functions.invoke("admin-operations", &#123; action: "delete_user" &#125;)</code> → <code className="bg-white px-1 rounded">auth.admin.deleteUser(userId)</code>, relying on the DB cascade chain: <code className="bg-white px-1 rounded">auth.users → profiles → every FK pointing at profiles(id)</code>.
          </p>
          <ul className="list-disc list-inside text-rose-900 text-sm space-y-1">
            <li><strong>CASCADE:</strong> ownership columns: <code className="bg-white px-1 rounded">user_id</code>, <code className="bg-white px-1 rounded">student_id</code>, <code className="bg-white px-1 rounded">teacher_id</code>, <code className="bg-white px-1 rounded">parent_id</code>, <code className="bg-white px-1 rounded">assignee_id</code>, <code className="bg-white px-1 rounded">participant_id</code>. The row belongs to the user.</li>
            <li><strong>SET NULL:</strong> authoring columns: <code className="bg-white px-1 rounded">created_by</code>, <code className="bg-white px-1 rounded">published_by</code>, <code className="bg-white px-1 rounded">reviewed_by</code>, <code className="bg-white px-1 rounded">approved_by</code>, <code className="bg-white px-1 rounded">actor_id</code>, <code className="bg-white px-1 rounded">sender_id</code>, <code className="bg-white px-1 rounded">uploaded_by</code>, <code className="bg-white px-1 rounded">supervisor_id</code>, etc. Row survives with author unknown.</li>
            <li>Set by migration <code className="bg-white px-1 rounded">20260427120000_fix_user_delete_cascade</code>.</li>
          </ul>
          <p className="text-rose-900 text-sm mt-2">
            <strong>Invariant for new FKs:</strong> always include an explicit <code className="bg-white px-1 rounded">ON DELETE</code> clause. Never default <code className="bg-white px-1 rounded">NO ACTION</code>. Never <code className="bg-white px-1 rounded">SET NULL</code> on a <code className="bg-white px-1 rounded">NOT NULL</code> column, cascade tries to write NULL, NOT NULL raises, and the entire delete aborts.
          </p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">25.7 Timetable Rebuild: Complete</h3>
        <p className="text-gray-700 mb-3 text-sm">
          The <code>tt_*</code>/<code>cal_*</code> rebuild is shipped (Phases 1–6). Seven legacy tables, <code>day_templates</code>, <code>day_template_slots</code>, <code>day_of_week_template_map</code>, <code>calendar_exceptions</code>, <code>timetable_versions</code>, <code>timetable_slots</code>, <code>lesson_plan_entries</code>, <code>topic_pacing_targets</code>, <code>academic_calendar</code>, were DROPPED on 2026-04-23 / 2026-05-03. New schema:
        </p>
        <ul className="list-disc list-inside text-gray-700 space-y-1 text-sm mb-3">
          <li><strong>Period structures</strong>: <code>tt_period_structures</code>, <code>tt_period_slots</code>, <code>tt_class_structure</code>.</li>
          <li><strong>Slots & substitutions</strong>: <code>tt_slots</code> (subject + teacher + class + day → period), <code>tt_substitutions</code> (date-based overrides), <code>tt_resources</code> (rooms/labs/shared).</li>
          <li><strong>Lesson plans</strong>: <code>tt_lesson_plans</code> (per-slot per-date with topic pacing & completion).</li>
          <li><strong>Calendar</strong>: <code>cal_academic_years</code>, <code>cal_events</code>.</li>
        </ul>
        <p className="text-gray-700 text-sm">
          Section 23 (Timetable & Lesson Planning Module) is preserved for historical context but the <em>tables it references no longer exist</em>. Always reference the timetable-module skill or the migration files for the current schema.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-3 mt-4">25.8 Production Readiness: Zero-Error Contract</h3>
        <p className="text-gray-700 mb-2 text-sm">
          Touched files must be production-clean before any task is claimed complete. Run all three on every change:
        </p>
        <ul className="list-disc list-inside text-gray-700 space-y-1 text-sm">
          <li><strong>TypeScript:</strong> <code>npx tsc --noEmit</code>, exit 0.</li>
          <li><strong>ESLint (touched files):</strong> <code>npx eslint &lt;changed-paths&gt;</code>, zero errors. Never silence with <code>// eslint-disable-next-line</code> or <code>as any</code>. <code>prefer-const</code> and <code>@typescript-eslint/no-explicit-any</code> are HARD errors in this repo's flat config.</li>
          <li><strong>Production build:</strong> <code>npx vite build</code>, exit 0. Bundle-size warnings ({">"}500 kB) are not failures; only treat exit ≠ 0 as a block.</li>
        </ul>
      </section>

      {/* Section 26: Mobile Visual Identity, AI Reliability & UX (v2.8) */}
      <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">26. Mobile Visual Identity, AI Reliability & UX (v2.8)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Version 2.8 (May 2026) ships Phase 9 of the mobile redesign, a full visual identity retheme with dark-mode support, along with iOS Safari fullscreen fixes, AI question generation reliability patches, and the bi-directional onboarding milestone.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">26.1 Phase 9: Visual Identity Skin + Day↔Night Mode</h3>
        <div className="bg-indigo-50 p-4 rounded-lg mb-4">
          <p className="text-indigo-900 text-sm mb-2">
            Phases 5/7/8 wired the right primitives but token values were muted. Phase 9 retunes everything and adds complete dark-mode wiring plus a theme-aware dashboard scene banner.
          </p>
          <h4 className="font-semibold text-indigo-900 mb-2 mt-2">Token System (<code className="bg-white px-1 rounded">src/index.css</code>)</h4>
          <p className="text-indigo-900 text-xs mb-2">Every color / shadow / radius goes through a CSS variable defined in <strong>both</strong> <code className="bg-white px-1 rounded">:root</code> (light) <strong>and</strong> <code className="bg-white px-1 rounded">.dark</code> (night). Key tokens:</p>
          <table className="w-full border-collapse border border-indigo-200 text-xs mb-3">
            <thead><tr className="bg-indigo-100">
              <th className="border border-indigo-200 p-1 text-left">Token</th>
              <th className="border border-indigo-200 p-1 text-left">Light</th>
              <th className="border border-indigo-200 p-1 text-left">Dark</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-indigo-200 p-1 font-mono">--surface-base</td><td className="border border-indigo-200 p-1">warm cream (30 30% 98%)</td><td className="border border-indigo-200 p-1">deep navy (232 28% 10%)</td></tr>
              <tr><td className="border border-indigo-200 p-1 font-mono">--surface-card</td><td className="border border-indigo-200 p-1">pure white</td><td className="border border-indigo-200 p-1">dark slate (230 22% 16%)</td></tr>
              <tr><td className="border border-indigo-200 p-1 font-mono">--ink-900..--ink-400</td><td className="border border-indigo-200 p-1">dark slate text scale</td><td className="border border-indigo-200 p-1">inverted to light scale</td></tr>
              <tr><td className="border border-indigo-200 p-1 font-mono">--shadow-card-{"{sm,,lg}"}</td><td className="border border-indigo-200 p-1">deeper-blue 5–10% alpha</td><td className="border border-indigo-200 p-1">black-cast 30–50% alpha</td></tr>
              <tr><td className="border border-indigo-200 p-1 font-mono">--radius-card</td><td className="border border-indigo-200 p-1">1.25rem (20px)</td><td className="border border-indigo-200 p-1">same</td></tr>
            </tbody>
          </table>
          <h4 className="font-semibold text-indigo-900 mb-1">Utility Classes</h4>
          <ul className="list-disc list-inside text-indigo-900 text-xs space-y-1">
            <li><code className="bg-white px-1 rounded">.surface-gradient</code>, page backdrop; layered radial overlays over <code className="bg-white px-1 rounded">--surface-base</code>. Has <code className="bg-white px-1 rounded">.dark</code> override with aurora colors over the navy floor.</li>
            <li><code className="bg-white px-1 rounded">.surface-card</code>, card body with <code className="bg-white px-1 rounded">--radius-card</code> (20px). No alpha + blur (that combo killed the float effect pre-Phase-9).</li>
            <li><code className="bg-white px-1 rounded">.frosted-shadow</code> / <code className="bg-white px-1 rounded">.frosted-shadow-lg</code>, wired to <code className="bg-white px-1 rounded">--shadow-card</code> and <code className="bg-white px-1 rounded">--shadow-card-lg</code>.</li>
            <li><code className="bg-white px-1 rounded">.app-bar-frost</code>, AppLayout header; saturate-blur over 65%-alpha surface-card, no border. Reverting to <code className="bg-white px-1 rounded">bg-card/80 + border-b</code> reintroduces the white seam.</li>
            <li><code className="bg-white px-1 rounded">.eyebrow</code>, <code className="bg-white px-1 rounded">text-[11px] uppercase tracking-[0.06em] text-ink-500</code> for tiny captions above values.</li>
          </ul>
          <h4 className="font-semibold text-indigo-900 mb-1 mt-2">New Primitives</h4>
          <ul className="list-disc list-inside text-indigo-900 text-xs space-y-1">
            <li><strong>HeroCard</strong> (<code className="bg-white px-1 rounded">@/components/shared/surfaces</code>), saturated dark teal/violet/warm gradient for <em>small</em> CTA tiles. Never as a page-spanning top banner.</li>
            <li><strong>SchoolSceneIllustration</strong> (<code className="bg-white px-1 rounded">@/components/shared/illustrations</code>), the "Clay School" 3D dashboard banner (three.js, loaded after the dashboard's own data). It follows the school's clock (morning, midday, golden hour, dusk) and shows night in dark mode. Until the scene is up, the banner shows its sky gradient (<code className="bg-white px-1 rounded">--ssi-sky-*</code> tokens) or a cached poster of the scene.</li>
          </ul>
          <h4 className="font-semibold text-indigo-900 mb-1 mt-2">Dashboard Greeting Pattern (All Roles)</h4>
          <p className="text-indigo-900 text-xs mb-1">Every role dashboard uses <code className="bg-white px-1 rounded">useRotatingGreeting()</code> cycling 15 multilingual greetings every 5 s (Hello / नमस्ते / Hola / Hallo / Bonjour / こんにちは / ਸਤ ਸ੍ਰੀ ਅਕਾਲ / नमस्कार / Ciao / Olá / 안녕하세요 / Merhaba / Привет / 你好 / Sawadee). Layout: <code className="bg-white px-1 rounded">SchoolSceneIllustration</code> → eyebrow "Welcome back" → bold h1 → role + institution subtitle → content. No HeroCard banner and no 👋 emoji on h1s.</p>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">26.2 Phase 7 & 8: School Admin & Student Mobile UI Coverage</h3>
        <div className="bg-teal-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-teal-900 mb-2">Phase 7: School-Admin surfaces (2026-04-28)</h4>
          <ul className="list-disc list-inside text-teal-900 text-xs space-y-1">
            <li>Pages migrated: <code className="bg-white px-1 rounded">ManageUsersPage</code>, <code className="bg-white px-1 rounded">ManageAdminsPage</code>, <code className="bg-white px-1 rounded">SchoolStudentsPage</code>, <code className="bg-white px-1 rounded">SchoolCoordinatorsPage</code>, <code className="bg-white px-1 rounded">HRDashboardPage</code>, <code className="bg-white px-1 rounded">AnalyticsPage</code>, <code className="bg-white px-1 rounded">PrincipalDashboard</code>.</li>
            <li>5+ action buttons per page collapse into <code className="bg-white px-1 rounded">PageHeader.secondaryActions</code> kebab menu.</li>
            <li><code className="bg-white px-1 rounded">HRDashboardPage</code> dropped its own <code className="bg-white px-1 rounded">&lt;AppLayout&gt;</code> wrapper, <code className="bg-white px-1 rounded">ProtectedRoute</code> already provides one.</li>
          </ul>
          <h4 className="font-semibold text-teal-900 mb-2 mt-2">Phase 8: Student surfaces (2026-04-28)</h4>
          <ul className="list-disc list-inside text-teal-900 text-xs space-y-1">
            <li>Pages migrated: <code className="bg-white px-1 rounded">StudentResultsPage</code>, <code className="bg-white px-1 rounded">StudentReportsPage</code>, <code className="bg-white px-1 rounded">StudentExamsPage</code>, <code className="bg-white px-1 rounded">ComprehensiveStudentDashboard</code>, <code className="bg-white px-1 rounded">StudentWeekPageV2</code>, <code className="bg-white px-1 rounded">StudentRechecksPage</code>, <code className="bg-white px-1 rounded">StudentStudyMaterialsPage</code>, <code className="bg-white px-1 rounded">StudentFeesView</code>, <code className="bg-white px-1 rounded">StudentPassportPage</code>, <code className="bg-white px-1 rounded">StudentAnalyticsDashboard</code>, <code className="bg-white px-1 rounded">AppointmentsPage</code>.</li>
            <li><code className="bg-white px-1 rounded">StudentFeesView</code> dropped a <code className="bg-white px-1 rounded">SidebarProvider + AppSidebar</code> double-wrap.</li>
            <li><code className="bg-white px-1 rounded">BookAppointmentDialog</code> converted to <code className="bg-white px-1 rounded">MobileSheet</code> with controlled open/onOpenChange.</li>
            <li><strong>Recharts fix:</strong> <code className="bg-white px-1 rounded">ResponsiveContainer</code> inside flex/grid parents must have explicit inline <code className="bg-white px-1 rounded">style=&#123;&#123; width: "100%", height: 256 &#125;&#125;</code>, Tailwind <code className="bg-white px-1 rounded">h-64</code> collapses to zero on mobile.</li>
            <li><code className="bg-white px-1 rounded">GradientKPICard</code> quartet on the student dashboard replaced by neutral <code className="bg-white px-1 rounded">StatTile</code>.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">26.3 iOS Safari Fullscreen Fix</h3>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <p className="text-red-900 text-sm mb-2">
            iPhone Safari does not implement <code className="bg-white px-1 rounded">requestFullscreen</code> on arbitrary elements, calling it throws <code className="bg-white px-1 rounded">TypeError: requestFullscreen is not a function</code> <em>synchronously</em>, before any <code className="bg-white px-1 rounded">.catch()</code>, kicking the React error boundary on the entire online exam flow.
          </p>
          <ul className="list-disc list-inside text-red-900 text-sm space-y-1">
            <li>All exam-flow fullscreen calls now go through <code className="bg-white px-1 rounded">src/lib/fullscreen.ts</code> helpers: <code className="bg-white px-1 rounded">requestFullscreen(el)</code>, <code className="bg-white px-1 rounded">exitFullscreen()</code>, <code className="bg-white px-1 rounded">getFullscreenElement()</code>, <code className="bg-white px-1 rounded">onFullscreenChange()</code>, <code className="bg-white px-1 rounded">isFullscreenSupported()</code>.</li>
            <li>Helpers feature-detect the API and resolve to a no-op when unavailable.</li>
            <li>The fullscreen-exit auto-submit handler in <code className="bg-white px-1 rounded">ExamAttemptPage</code> early-returns when <code className="bg-white px-1 rounded">isFullscreenSupported()</code> is false, iPhone students still get camera + tab-switch proctoring.</li>
            <li><strong>Never bypass these helpers:</strong> calling <code className="bg-white px-1 rounded">el.requestFullscreen()</code> directly will reintroduce the crash.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">26.4 Building New Pages: Strict Checklist</h3>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <p className="text-gray-700 text-sm mb-2">Every new page, component, dialog, or section MUST follow these invariants to preserve the visual identity from Phases 5/7/8/9:</p>
          <table className="w-full border-collapse border border-gray-300 text-xs">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1 text-left">#</th>
              <th className="border border-gray-300 p-1 text-left">Rule</th>
            </tr></thead>
            <tbody>
              <tr><td className="border border-gray-300 p-1">1</td><td className="border border-gray-300 p-1">Wrap in <code className="bg-white px-1 rounded">&lt;PageShell&gt;</code>. Never render <code className="bg-white px-1 rounded">&lt;AppLayout&gt;</code>, <code className="bg-white px-1 rounded">SidebarProvider</code>, or <code className="bg-white px-1 rounded">AppSidebar</code> yourself.</td></tr>
              <tr className="bg-gray-50"><td className="border border-gray-300 p-1">2</td><td className="border border-gray-300 p-1">Heading text: <code className="bg-white px-1 rounded">text-ink-900</code>. Subtitles: <code className="bg-white px-1 rounded">text-ink-600</code>. Captions: <code className="bg-white px-1 rounded">.eyebrow</code>. Never raw greys (<code className="bg-white px-1 rounded">text-gray-700</code>).</td></tr>
              <tr><td className="border border-gray-300 p-1">3</td><td className="border border-gray-300 p-1">Tab strips: <code className="bg-white px-1 rounded">&lt;MobileTabs&gt;</code>. Never shadcn <code className="bg-white px-1 rounded">&lt;Tabs&gt;</code> for top-level strips, they clip at 375 px.</td></tr>
              <tr className="bg-gray-50"><td className="border border-gray-300 p-1">4</td><td className="border border-gray-300 p-1">Cards: <code className="bg-white px-1 rounded">surface-card frosted-shadow rounded-card</code>. Never <code className="bg-white px-1 rounded">bg-white shadow-md rounded-lg</code>.</td></tr>
              <tr><td className="border border-gray-300 p-1">5</td><td className="border border-gray-300 p-1">Stat tiles: <code className="bg-white px-1 rounded">&lt;StatTile&gt;</code> + <code className="bg-white px-1 rounded">&lt;StatTileGrid&gt;</code>. Never the deprecated <code className="bg-white px-1 rounded">GradientKPICard</code>.</td></tr>
              <tr className="bg-gray-50"><td className="border border-gray-300 p-1">6</td><td className="border border-gray-300 p-1">Sheets / modals: <code className="bg-white px-1 rounded">&lt;MobileSheet&gt;</code> (built on shadcn Sheet, not Dialog). Pass controlled <code className="bg-white px-1 rounded">open</code>/<code className="bg-white px-1 rounded">onOpenChange</code>.</td></tr>
              <tr><td className="border border-gray-300 p-1">7</td><td className="border border-gray-300 p-1">Every new color via a CSS variable in both <code className="bg-white px-1 rounded">:root</code> and <code className="bg-white px-1 rounded">.dark</code>. No hex / hsl literals in primitives.</td></tr>
              <tr className="bg-gray-50"><td className="border border-gray-300 p-1">8</td><td className="border border-gray-300 p-1">Recharts: wrap <code className="bg-white px-1 rounded">ResponsiveContainer</code> in <code className="bg-white px-1 rounded">&lt;div style=&#123;&#123; width:"100%", height:256 &#125;&#125;&gt;</code>, Tailwind <code className="bg-white px-1 rounded">h-64</code> collapses on mobile.</td></tr>
              <tr><td className="border border-gray-300 p-1">9</td><td className="border border-gray-300 p-1">Dark mode smoke: toggle dark, backdrop, cards, text, shadows ALL flip. Any cream/white in dark = missing <code className="bg-white px-1 rounded">.dark</code> token override.</td></tr>
              <tr className="bg-gray-50"><td className="border border-gray-300 p-1">10</td><td className="border border-gray-300 p-1">Pre-ship: <code className="bg-white px-1 rounded">npx tsc --noEmit</code> exit 0 + <code className="bg-white px-1 rounded">npx eslint &lt;touched paths&gt;</code> zero new errors + <code className="bg-white px-1 rounded">npx vite build</code> exit 0.</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">26.5 AI Question Generation: Reliability Fixes (May 2026)</h3>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-amber-900 mb-2">LLM Under-Delivery Auto Top-Up (fixed 2026-05-01)</h4>
          <p className="text-amber-900 text-sm mb-2">
            The model occasionally returns fewer questions than requested (e.g. requested 7, returned 5, silently). Pre-fix <code className="bg-white px-1 rounded">handleGenerate</code> blindly pushed <code className="bg-white px-1 rounded">data.questions</code> and moved on, so a 50-question request commonly resolved as 47–48.
          </p>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><strong>Per-batch top-up:</strong> if a chapter call returns fewer than <code className="bg-white px-1 rounded">req.count</code>, one more call fires for the deficit on the same chapter/topic.</li>
            <li><strong>Final aggregate top-up:</strong> a second pass against the largest request if the running total is still short.</li>
            <li>Case-study / comprehension excluded (single-passage shape; retry semantics differ).</li>
          </ul>
          <h4 className="font-semibold text-amber-900 mb-2 mt-3">AI Add Flow: Single-Flight Guard (fixed 2026-05-01)</h4>
          <p className="text-amber-900 text-sm mb-2">
            Re-tapping "Add selected" during the multi-second <code className="bg-white px-1 rounded">question_bank</code> insert loop spawned a duplicate pass, causing a 50-cap section to end at 144 / 50 after three taps.
          </p>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><strong><code className="bg-white px-1 rounded">isAddingRef</code>:</strong> a synchronous ref guard (state alone has a render-cycle gap a fast double-tap can slip through).</li>
            <li><strong>Slot clamping:</strong> <code className="bg-white px-1 rounded">selected = selectedAll.slice(0, remainingSlots)</code> so an over-selected list never overshoots the section cap.</li>
            <li><strong>Early close:</strong> <code className="bg-white px-1 rounded">setGeneratedQuestions([])</code> + <code className="bg-white px-1 rounded">onComplete?.()</code> immediately after the synchronous <code className="bg-white px-1 rounded">onAddQuestion</code> loop; <code className="bg-white px-1 rounded">question_bank</code> writes run in the background.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">26.6 Onboarding Milestone: Bi-Directional Task Assignment (2026-05-09)</h3>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <p className="text-green-900 text-sm mb-2">
            The <code className="bg-white px-1 rounded">first_task_assigned</code> onboarding milestone previously fired only when a task was received (assignee). From 2026-05-09 it fires on <code className="bg-white px-1 rounded">OR(assignee_id, assigner_id)</code> so creating a task also counts.
          </p>
          <ul className="list-disc list-inside text-green-900 text-sm space-y-1">
            <li>Column name is unchanged, <code className="bg-white px-1 rounded">first_task_assigned</code>.</li>
            <li>UI label updated to "First task created or received".</li>
            <li>New milestones must apply the same "active half" test: fire if the user played any active role in the event.</li>
          </ul>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-3">26.7 Workforce & Syllabus Bug Fixes</h3>
        <div className="bg-slate-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-slate-900 text-sm space-y-2">
            <li><strong>Workforce: institution_id mismatch backfill:</strong> Profiles whose <code className="bg-white px-1 rounded">institution_id</code> didn't match their <code className="bg-white px-1 rounded">user_roles</code> row were silently excluded from the workforce table. A backfill migration and query fix corrects the join.</li>
            <li><strong>Workforce: 1 000-row pagination:</strong> Staff SELECTs that hit the PostgREST default 1 000-row cap now paginate so no staff are dropped in large institutions.</li>
            <li><strong>Syllabus: hidden chapters leak:</strong> Hidden chapters were only suppressed in the tree view but appeared in downstream consumers (topic pickers, exam creation). The visibility filter now applies everywhere, not just the tree.</li>
            <li><strong>Syllabus: delete toast copy:</strong> Hiding a chapter now shows "Chapter deleted" (unified UX with the actual delete action) so the affordance reads consistently.</li>
          </ul>
        </div>
      </section>

      {/* Section 27: Optional Subjects (v3.0) */}
      <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">27. Optional Subjects (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Optional subjects let individual students opt into electives, with app-wide filtering so an optional cohort is scoped correctly everywhere. The model was rebuilt in July 2026: <strong>Optional Groups are now the single enrollment workflow</strong>, and the earlier per-subject toggle list and the main/optional classification have both been retired.
        </p>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-blue-900 text-sm space-y-1">
            <li><strong>Optional Groups</strong>: <code className="bg-white px-1 rounded">optional_groups</code> defines an elective basket scoped to a class group, <code className="bg-white px-1 rounded">optional_group_subjects</code> lists the subjects inside it, and each student picks from the basket.</li>
            <li><strong>Single enrollment store</strong>: <code className="bg-white px-1 rounded">student_optional_enrollments</code> is where every choice lands. Its <code className="bg-white px-1 rounded">class_id</code> column is always NULL, so never read it.</li>
            <li><strong>Timetable bands</strong>: <code className="bg-white px-1 rounded">optional_band_slots</code> places optional subjects into shared timetable bands.</li>
            <li><strong>Teacher access</strong>: teachers get Subjects-tab access for their optional subjects with an optional-only roster, and can edit choices only for students they already share a class with. They cannot change a student's optional subjects outside that scope.</li>
            <li><strong>Superseded plane</strong>: <code className="bg-white px-1 rounded">optional_batches</code> and <code className="bg-white px-1 rounded">optional_batch_students</code> still exist and one route still reaches them, but they are no longer the workflow. Do not add writers.</li>
            <li><strong>Retired</strong>: the main/optional classification was removed on 2026-08-06. Every optional choice is MAIN, pinned by a CHECK constraint.</li>
          </ul>
        </div>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <p className="text-red-900 text-sm">
            <strong>The dormancy gate.</strong> Every optional-narrowing filter in the platform sits behind <code className="bg-white px-1 rounded">optional_choices_recorded()</code>, so optional logic stays completely inert until a section actually records choices. An ungated filter blacked out a live school on 2026-08-25: students with no recorded choice were narrowed to nothing. Any new query that filters by optional enrollment must be gated the same way.
          </p>
        </div>
      </section>

      {/* Section 28: Homework & Assignment System (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">28. Homework &amp; Assignment System (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Shipped 2026-06-02, the homework module covers assignment creation, multi-subject targeting, student submission, marking, publishing and a student feed. The <code className="bg-gray-100 px-1 rounded">homework</code> feature flag is default-on.
        </p>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-green-900 text-sm space-y-1">
            <li><strong>Tables (8)</strong>: <code className="bg-white px-1 rounded">homework_assignments</code>, <code className="bg-white px-1 rounded">homework_assignment_classes</code>, <code className="bg-white px-1 rounded">homework_assignment_subjects</code>, <code className="bg-white px-1 rounded">homework_submissions</code>, <code className="bg-white px-1 rounded">homework_submission_files</code>, <code className="bg-white px-1 rounded">homework_results</code>, <code className="bg-white px-1 rounded">homework_mark_audit</code>, <code className="bg-white px-1 rounded">homework_notifications_sent</code>. <code className="bg-white px-1 rounded">homework.subject_id</code> is <code className="bg-white px-1 rounded">ON DELETE RESTRICT</code>.</li>
            <li><strong>Marking roster RPC</strong> needs <code className="bg-white px-1 rounded">::text</code> casts to avoid a 42804 type mismatch, and orders by roll number numerically.</li>
            <li><strong>Owner-only storage</strong>: submission files are owner-readable; markers read them through the <code className="bg-white px-1 rounded">homework-file-url</code> signed-URL broker.</li>
            <li><strong>Publish gate and auto-check cron</strong>: results stay unpublished until released, and a cron auto-checks pending work.</li>
            <li><strong>Deletion</strong>: an assignment can be deleted at any status through the delete RPC.</li>
            <li><strong>Scope</strong>: the create form is scoped to the active teacher or coordinator view, so a teacher cannot target a class they do not teach.</li>
            <li><strong>Edge functions</strong>: <code className="bg-white px-1 rounded">submit-homework</code>, <code className="bg-white px-1 rounded">homework-file-url</code>, <code className="bg-white px-1 rounded">homework-notify-pass</code>.</li>
            <li><strong>Routes</strong>: <code className="bg-white px-1 rounded">/homework</code>, <code className="bg-white px-1 rounded">/homework/create</code>, <code className="bg-white px-1 rounded">/homework/edit/:id</code>, <code className="bg-white px-1 rounded">/homework/:id</code>; <code className="bg-white px-1 rounded">/student/homework</code> and <code className="bg-white px-1 rounded">/student/homework/:id</code> for students.</li>
          </ul>
        </div>
      </section>

      {/* Section 29: Hybrid & Results-Only Exams (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">29. Hybrid &amp; Results-Only Exams (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Two alternate exam-delivery modes that run as separate data planes from the standard online attempt flow.
        </p>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-purple-900 mb-2">Hybrid exam mode</h4>
          <ul className="list-disc list-inside text-purple-900 text-sm space-y-1">
            <li><strong>Tables (8)</strong>: <code className="bg-white px-1 rounded">hybrid_exam_attempts</code>, <code className="bg-white px-1 rounded">hybrid_exam_attempt_logs</code>, <code className="bg-white px-1 rounded">hybrid_exam_settings</code>, <code className="bg-white px-1 rounded">hybrid_pairing_tokens</code>, <code className="bg-white px-1 rounded">hybrid_answer_sheet_pages</code>, <code className="bg-white px-1 rounded">hybrid_sheet_annotations</code>, <code className="bg-white px-1 rounded">hybrid_question_marks</code>, <code className="bg-white px-1 rounded">hybrid_proctoring_snapshots</code>. A SEPARATE data plane from <code className="bg-white px-1 rounded">student_exam_attempts</code> and <code className="bg-white px-1 rounded">final_results</code>.</li>
            <li>The <strong>phone companion is unauthenticated</strong>: the pairing token IS the authorisation. Its route, <code className="bg-white px-1 rounded">/student/hybrid-upload/:token</code>, is the platform's only unauthenticated write surface.</li>
            <li><strong>Marking workspace</strong>: rebuilt as a guided one-question-at-a-time flow with a CBSE-style marks stamp, a per-question accordion, aspect-correct annotations, an information button carrying the feedback note, and voice-dictated per-question feedback. It works on a phone, and the answer sheet sizes itself to the screen.</li>
            <li><strong>Camera proctoring</strong> is a real toggle in <code className="bg-white px-1 rounded">hybrid_exam_settings</code>, not the inert switch it began as.</li>
            <li><strong>5 edge functions</strong>: <code className="bg-white px-1 rounded">generate-hybrid-pairing-token</code>, <code className="bg-white px-1 rounded">validate-hybrid-pairing-token</code>, <code className="bg-white px-1 rounded">upload-hybrid-page</code>, <code className="bg-white px-1 rounded">upload-hybrid-sheet</code>, <code className="bg-white px-1 rounded">publish-hybrid-marks</code>.</li>
            <li>Student reads route through the sanitised <code className="bg-white px-1 rounded">get_exam_paper</code>, so the answer key never reaches the client.</li>
          </ul>
        </div>
        <div className="bg-orange-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-orange-900 mb-2">Results-only (already-created) offline exam</h4>
          <ul className="list-disc list-inside text-orange-900 text-sm space-y-1">
            <li><code className="bg-white px-1 rounded">exams.is_results_only</code> flag plus <code className="bg-white px-1 rounded">exams.source_paper_files</code> (a COLUMN on <code className="bg-white px-1 rounded">exams</code>, not a table).</li>
            <li><strong>Two distinct offline pipelines</strong>: <code className="bg-white px-1 rounded">offline_student_marks</code> and <code className="bg-white px-1 rounded">offline_section_marks</code>, with distinct query keys that must never cross.</li>
            <li><strong>Explicit Absent state</strong>, roll or admission identity, and one roster order shared across the surfaces (2026-08-29).</li>
            <li>Marks stay editable after results publish, and publishing no longer silently un-publishes a previously released set.</li>
            <li>The roster respects optional-subject enrollment, so a student who does not take the subject is not listed.</li>
            <li>Scanned papers live in the <code className="bg-white px-1 rounded">exam-sheets</code> bucket under institution-scoped RLS.</li>
          </ul>
        </div>
      </section>

      {/* Section 30: Command Center & Scoped Dashboards (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">30. Command Center &amp; Scoped Dashboards (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Shipped 2026-06-02 with the scoped snapshot on 2026-06-06, then rebuilt to a principal-first blueprint through August 2026 and given a bento overview on 2026-09-05. The admin Command Center and the coordinator and teacher Snapshot share components but resolve different data scopes.
        </p>
        <div className="bg-cyan-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-cyan-900 text-sm space-y-1">
            <li><code className="bg-white px-1 rounded">/school/command-center</code> (admin) and <code className="bg-white px-1 rounded">/school/snapshot</code> (coordinator and teacher) share components through the <code className="bg-white px-1 rounded">DashboardScope</code> context.</li>
            <li><strong>Three parallel RPC families</strong>, 79 functions in total: <code className="bg-white px-1 rounded">dash_*</code> for the admin, <code className="bg-white px-1 rounded">dash_scoped_*</code> for coordinators (resolved by <code className="bg-white px-1 rounded">dash_resolve_scoped_classes</code>) and <code className="bg-white px-1 rounded">dash_teacher_*</code> for teachers (resolved by <code className="bg-white px-1 rounded">dash_resolve_teacher_pairs</code>). Every hook needs its variants with <code className="bg-white px-1 rounded">scope</code> in the query key, and you must never branch on <code className="bg-white px-1 rounded">scope === "scoped"</code> for teachers.</li>
            <li><strong>Page structure</strong>: a header with a realtime freshness signal, a jump nav, a bento overview with two deliberately separate KPI rows (roster counts versus performance), an SQL-derived insights digest collapsed by default, and six anchored sections: Students, Teachers and staff, Academics, Attendance, Communication, and Needs your attention.</li>
            <li><strong>Per-card filters</strong>: class, wing and date range live on the cards themselves rather than in one page-level bar. Tapping a distribution segment opens the actual list of those students.</li>
            <li>A <strong>20-flag evaluator</strong> writes the <code className="bg-white px-1 rounded">dashboard_flags</code> table, and can create tasks from a flag. Auto-created tasks are always attributed to "SALCI System", never to the admin who opened the page.</li>
            <li>Flag freshness depends on the <strong>admin on-open kick</strong>. There is no cron.</li>
            <li>Every figure is computed server-side. Nothing on this page is counted in the browser.</li>
            <li><strong>Never</strong> mount <code className="bg-white px-1 rounded">useCommandCenter</code> outside <code className="bg-white px-1 rounded">CbseReportsModal</code>. Dashboards that render tiles outside <code className="bg-white px-1 rounded">NavigationHub</code> must hand-wrap each tile in <code className="bg-white px-1 rounded">isFeatureEnabled()</code>.</li>
          </ul>
        </div>
      </section>

      {/* Section 31: High-Concurrency Hardening (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">31. High-Concurrency Hardening (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          After the 2026-05-16 incident, when MVP patterns collapsed at roughly 60 active users, the platform adopted a hard concurrency contract targeting <strong>3,000 to 5,000 concurrent users with a 10,000 design ceiling</strong>. The rules are gated at code review by an always-on repo rule that force-triggers a Scale Gate before any data-access code ships. No task is exempt: not small, not internal, not urgent.
        </p>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-red-900 text-sm space-y-1">
            <li><strong>Auth</strong>: never call <code className="bg-white px-1 rounded">supabase.auth.getUser()</code> without a JWT argument. A containment monkey-patch reads the local session for 167 existing call sites and must not be removed; new code reads the session directly.</li>
            <li><strong>Queries</strong>: explicit column lists, no <code className="bg-white px-1 rounded">select('*')</code> outside admin tooling. Paginate with <code className="bg-white px-1 rounded">range()</code>, because PostgREST silently caps at 1000 rows inside edge functions too, and a WHERE filter is not a bound.</li>
            <li><strong>Aggregation</strong>: compute counts and sums server-side through an RPC, an embedded <code className="bg-white px-1 rounded">count()</code> or a head-only count. Never fetch rows to count them.</li>
            <li><strong>Schema</strong>: every new FK gets an index in the same migration. RLS policies call SECURITY DEFINER helpers only, and wrap stable per-row calls as <code className="bg-white px-1 rounded">(select auth.uid())</code>.</li>
            <li><strong>Writes</strong>: mutations are idempotent through a single-flight guard, an upsert or a unique constraint handled gracefully. Two dependent writes are one RPC, never sequential client calls.</li>
            <li><strong>React Query</strong>: explicit <code className="bg-white px-1 rounded">staleTime</code> of at least 60s; <code className="bg-white px-1 rounded">refetchInterval</code> under 30s forbidden without a justification comment; <code className="bg-white px-1 rounded">refetchOnWindowFocus: false</code> for heavy tables; every subscribing effect cleans up.</li>
            <li><strong>Bundle</strong>: under 500 KB per chunk and 1.5 MB entry. Lazy-load every route and every heavy library (XLSX, jsPDF, KaTeX, recharts, pdfjs, exceljs). One realtime channel per feature, never per component.</li>
            <li><strong>Edge functions</strong>: anything over 10 seconds becomes a background job, enqueue and poll. Paginate every database call inside them.</li>
            <li><strong>Infra floor</strong>: Medium compute minimum, Large at 1K and XL at 10K concurrent users, Supavisor transaction pooling, read replicas for analytics, Sentry, k6 scripts in <code className="bg-white px-1 rounded">scripts/loadtest/</code>, and rate limiting on expensive edge functions. Compute has not yet been raised to that floor, and it remains the single largest open infrastructure item.</li>
          </ul>
        </div>
      </section>

      {/* Section 32: Notice Board, Messaging & Communication (v3.0) */}
      <div className="page-break" style={{ pageBreakAfter: 'always' }}></div>
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">32. Notice Board, Messaging &amp; Communication (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Shipped 2026-08-22. Circulars were renamed to notices and rebuilt as a hierarchy-scoped audience engine, which is now the hub every other module publishes through. Feature flag <code className="bg-gray-100 px-1 rounded">notice_board</code>.
        </p>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-blue-900 mb-2">32.1 Notice Board</h4>
          <ul className="list-disc list-inside text-blue-900 text-sm space-y-1">
            <li><strong>Tables</strong>: <code className="bg-white px-1 rounded">notices</code> with multi-target junctions <code className="bg-white px-1 rounded">notice_target_classes</code> and <code className="bg-white px-1 rounded">notice_target_wings</code>, plus a <strong>materialised</strong> <code className="bg-white px-1 rounded">notice_recipients</code> set.</li>
            <li><strong>Publishing</strong>: <code className="bg-white px-1 rounded">publish_notice</code> expands the audience into that recipient set, which is what makes read receipts, inbox and outbox feeds and the reach rollup cheap to query. <code className="bg-white px-1 rounded">communication_overview</code> and the composer option RPCs back the compose surface with an audience preview.</li>
            <li><strong>Scope enforced in RLS</strong>, not the client. This closed the leak where a teacher's class notice reached co-teachers.</li>
            <li><strong>Attachments</strong> live in a private <code className="bg-white px-1 rounded">notice-attachments</code> bucket; images preview inline.</li>
            <li>Legacy circular values were normalised during the rename, and the duplicate staff Notice Board nav row was removed.</li>
          </ul>
        </div>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-green-900 mb-2">32.2 Messaging</h4>
          <ul className="list-disc list-inside text-green-900 text-sm space-y-1">
            <li>Direct, group and class-wide conversations over <code className="bg-white px-1 rounded">conversations</code>, <code className="bg-white px-1 rounded">conversation_participants</code> and <code className="bg-white px-1 rounded">conversation_messages</code>, with attachments.</li>
            <li><strong>Bulk Send was rebuilt as a Messages tab</strong> riding the notice audience engine, and it now sends real direct messages rather than collapsing every recipient into one group thread.</li>
            <li>The admin Communication page's <strong>Templates tab was removed on 2026-09-07</strong>. <code className="bg-white px-1 rounded">communication_templates</code> and its data remain, with no send path wired to them.</li>
          </ul>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-gray-800 mb-2">32.3 Delivery channels</h4>
          <p className="text-gray-700 text-sm">
            In-app, Web Push (VAPID, through the service worker, queued in <code className="bg-white px-1 rounded">notification_queue</code>) and email through Resend (<code className="bg-white px-1 rounded">broadcast-email</code>, <code className="bg-white px-1 rounded">send-communication</code>, <code className="bg-white px-1 rounded">send-welcome-email</code>, <code className="bg-white px-1 rounded">send-fee-reminder</code>, <code className="bg-white px-1 rounded">send-task-notifications</code>). SMS and WhatsApp are not built; when they are, they should be new senders behind the existing audience expansion, not a second audience model.
          </p>
        </div>
      </section>

      {/* Section 33: Salci Support (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">33. Salci Support (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Shipped 2026-08-31 to 2026-09-02. An end-to-end helpdesk: any authenticated user raises a ticket, it becomes a threaded conversation and a real task, and the reporter is emailed at each step.
        </p>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-blue-900 text-sm space-y-1">
            <li><strong>Tables</strong>: <code className="bg-white px-1 rounded">reported_issues</code> holds the ticket (category, priority, first response, resolution, per-side last-read timestamps and a task link), <code className="bg-white px-1 rounded">support_messages</code> holds the thread including a guarded internal-note channel reporters never see, and <code className="bg-white px-1 rounded">support_settings</code> holds configuration.</li>
            <li><strong>Two single write paths</strong>: <code className="bg-white px-1 rounded">post_support_message</code> (idempotent) and <code className="bg-white px-1 rounded">_support_apply_status</code>. Status changes and message posts never bypass them, and both <code className="bg-white px-1 rounded">set_support_ticket_status</code> and <code className="bg-white px-1 rounded">resolve_support_task</code> route through the same place.</li>
            <li><strong>Grants</strong>: every support RPC has EXECUTE revoked from PUBLIC <em>and</em> from <code className="bg-white px-1 rounded">anon</code> by name, verified behaviourally and against <code className="bg-white px-1 rounded">information_schema.routine_privileges</code>.</li>
            <li><strong>Reporter surface</strong>: one <code className="bg-white px-1 rounded">/support</code> door for every authenticated role, with tabs, unread dots and a thread sheet. It is hidden from SALCI's own admins, who work the inbox instead.</li>
            <li><strong>SALCI inbox</strong>: <code className="bg-white px-1 rounded">/admin/issues</code> with an awaiting-SALCI filter, unread dots, category filters and ticket deep links. The list is fetched once and sliced per tab, and the inbox is lazy-loaded.</li>
            <li><strong>Ticket to task</strong>: a support request becomes a real task, and the task panel deep-links back into the conversation and refreshes the support caches.</li>
            <li><strong>Email</strong>: <code className="bg-white px-1 rounded">support-notify-email</code> sends a best-effort email on each reply and status change, behind an origin allowlist, authorising the <em>recipient</em> rather than only the ticket.</li>
            <li><strong>Migration note</strong>: all 41 pre-existing tickets and their 14 internal notes were backfilled into the thread. Dropping <code className="bg-white px-1 rounded">reported_issues.admin_notes</code> ahead of the frontend deploy broke the live ticket UI on 2026-08-31 and the column had to be re-added empty. Ship order matters.</li>
          </ul>
        </div>
      </section>

      {/* Section 34: Profile Photos & Student Profile Lockdown (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">34. Profile Photos &amp; Student Profile Lockdown (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Shipped 2026-08-31 to 2026-09-01. Role-scoped profile photos with per-request authorisation, and the removal of student self-editing.
        </p>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-purple-900 mb-2">34.1 Photos</h4>
          <ul className="list-disc list-inside text-purple-900 text-sm space-y-1">
            <li>Photos live in the <strong>private</strong> <code className="bg-white px-1 rounded">user-avatars</code> bucket, referenced by <code className="bg-white px-1 rounded">profiles.avatar_path</code>. There is no public bucket and no stored URL. Any documentation describing a public profile-photos bucket with owner write is wrong.</li>
            <li><strong>Authority per request</strong>: <code className="bg-white px-1 rounded">can_set_user_photo</code> for writes, <code className="bg-white px-1 rounded">can_view_user_photo</code> for reads, plus a trigger that rejects a path which does not belong to the row it is written on. Cross-tenant and RPC test coverage pins this.</li>
            <li><strong>Capture pipeline</strong>: camera or upload, HEIC-aware, WebP output, with <code className="bg-white px-1 rounded">CameraCapture</code> parameterised by facing mode and filename prefix.</li>
            <li><strong>On-device store</strong>: at most six avatars cached, keyed on an encoded cache key, invalidating in-flight loads on forget, and purged entirely on sign-out.</li>
            <li><code className="bg-white px-1 rounded">UserAvatar</code> fetches only when it scrolls into the viewport and falls back to shared initials. Photos render in Manage Users, the user sheet header, the profile page and the app chrome.</li>
          </ul>
        </div>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-amber-900 mb-2">34.2 Student profile lockdown</h4>
          <p className="text-amber-900 text-sm">
            Students can no longer edit their own profile; <code className="bg-white px-1 rounded">/profile</code> is read-only for them. The two self-writes they still legitimately need, <code className="bg-white px-1 rounded">clear_password_reset_flag</code> and <code className="bg-white px-1 rounded">mark_onboarding_complete</code>, were moved to column-scoped RPCs <em>before</em> the lockdown landed, so it could not trap a student part-way through first login. <code className="bg-white px-1 rounded">student_personal_details</code> remains school-managed: students read-only, and no DELETE policy at all.
          </p>
        </div>
      </section>

      {/* Section 35: Attendance, Leave & Reporting (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">35. Attendance, Leave &amp; Reporting (v3.0)</h2>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-blue-900 mb-2">35.1 Institution-local time is mandatory</h4>
          <p className="text-blue-900 text-sm">
            <code className="bg-white px-1 rounded">institutions.timezone</code> (default Asia/Kolkata) is the single source of truth. Any database code comparing a wall-clock column or computing "today" must use <code className="bg-white px-1 rounded">(now() AT TIME ZONE i.timezone)</code>. A bare <code className="bg-white px-1 rounded">now()::time</code>, <code className="bg-white px-1 rounded">CURRENT_DATE</code> or <code className="bg-white px-1 rounded">AT TIME ZONE 'UTC'</code> reintroduces the 2026-05-25 bug that left attendance auto-mark dead for every IST school until 13:30 local time. Entry point: <code className="bg-white px-1 rounded">tt_run_attendance_pass_for_institution(uuid)</code>, on a 15-minute cron plus a session-guarded page-view kick. Auto-mark is decoupled from the staff substitution setting.
          </p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-green-900 mb-2">35.2 Student leave, and the removal of "late"</h4>
          <ul className="list-disc list-inside text-green-900 text-sm space-y-1">
            <li>Students apply for and track leave; staff approve or reject. <code className="bg-white px-1 rounded">review_student_leave</code> is the <strong>only</strong> decision write path: it retroactively corrects attendance and notifies, in one transaction. <code className="bg-white px-1 rounded">can_review_student_leave</code> gates it, class-scoped, and a cross-tenant forgery path was closed during review.</li>
            <li>Teachers can also mark a student's leave directly (2026-09-04), giving a third "Leave" pill on the roster.</li>
            <li><strong>"Late" was removed from the student plane entirely</strong>, with existing rows backfilled to present. "Leave" counts in the TOTAL but never as present, and is banned from the tile headline.</li>
            <li>Leave is excluded from attendance ratios, so a school's percentage is not distorted by approved absence.</li>
            <li>Feature-gated on <code className="bg-white px-1 rounded">attendance</code>: a school without attendance has nothing to apply against.</li>
          </ul>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-purple-900 mb-2">35.3 Surfaces and reporting</h4>
          <ul className="list-disc list-inside text-purple-900 text-sm space-y-1">
            <li><strong>Student calendar</strong> at <code className="bg-white px-1 rounded">/student/attendance</code>, showing every calendar-event kind.</li>
            <li><strong>Class marker</strong> with clickable roster rows, date navigation and a 2-day edit window.</li>
            <li><strong>Staff Attendance</strong>: teacher and coordinator attendance merged into one tab, with a Reports tab scoped to the viewer's own classes and a per-user detail page.</li>
            <li><strong>Reports</strong>: server-side pivot RPCs for both the student and staff planes, paginated with Prev/Next rather than fetched whole, and a styled multi-sheet .xlsx export with one tab per class, an overview Summary tab and an At-Risk Watchlist.</li>
            <li><strong>Student activity export</strong>: admin-gated summary and event-log RPCs over <code className="bg-white px-1 rounded">student_activity_daily</code>, exported as a two-sheet workbook with an overview tab and per-class detail tabs. Day bucketing is institution-local.</li>
          </ul>
        </div>
      </section>

      {/* Section 36: Syllabus Delivery (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">36. Syllabus Delivery: Two Timelines, Notes &amp; Parts (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Built through July to September 2026. Syllabus delivery is modelled as two timelines rather than one percentage, so slippage is visible rather than inferred.
        </p>
        <div className="bg-cyan-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-cyan-900 text-sm space-y-1">
            <li><strong>The actual jar</strong>: <code className="bg-white px-1 rounded">syllabus_progress_events</code> is an append-only stream of chapter-level progress, written by exactly one RPC, <code className="bg-white px-1 rounded">record_syllabus_progress</code>.</li>
            <li><strong>The projection</strong>: an automatic forward walk over <code className="bg-white px-1 rounded">syllabus_sequence</code> and the timetable, saying where a class <em>should</em> be. Both lines render on the teacher and student week grids.</li>
            <li><strong>Non-blocking backlog</strong>: an unlogged past lesson raises a check-in backlog sheet instead of a login gate, and capture happens at check-out. The popup opens only when a backlog actually exists.</li>
            <li><strong>Corrections mode</strong> lets a mistaken completion be deleted, and chapter completion must not overwrite a note-only period.</li>
            <li><strong>Note-only periods</strong> (2026-09-02): a chapterless period such as a surprise test or an activity is logged through <code className="bg-white px-1 rounded">tt_record_period_note</code> with <code className="bg-white px-1 rounded">is_note_only=true</code>. It reads as Logged on the week chips, resolves the day for check-out and for the SY1 flag, appears in the export with a badge, and is hidden from students, who read only <code className="bg-white px-1 rounded">session_type='teaching'</code>.</li>
            <li><strong>Duplicated predicate</strong>: the "was this day logged?" OR-predicate exists in both <code className="bg-white px-1 rounded">teacher_pending_syllabus_days</code> and <code className="bg-white px-1 rounded">dash_evaluate_syllabus_flags</code> and the two MUST stay identical.</li>
            <li><strong>SY1 escalation flag</strong> surfaces pacing slippage on the dashboards, alongside coverage analytics for admin, coordinator and teacher. The teacher scope derives from <code className="bg-white px-1 rounded">tt_slots</code>.</li>
            <li><strong>Segmentation (Parts)</strong>: <code className="bg-white px-1 rounded">syllabus_segments</code> and <code className="bg-white px-1 rounded">syllabus_segment_chapters</code> split a subject's syllabus into named parts such as PA1 or Term 1, scoped to class group plus subject, behind the off-by-default <code className="bg-white px-1 rounded">syllabus_segmentation</code> flag.</li>
            <li><strong>Personal chapter order</strong>: <code className="bg-white px-1 rounded">user_topic_orders</code> merges a per-user ordering into the read path without changing the shared sequence. Drag-to-reorder sits behind a press-and-hold.</li>
            <li><strong>Lesson plan export</strong>: coordinators and admins download delivery as Excel through two read-only SECURITY DEFINER RPCs scoped by <code className="bg-white px-1 rounded">tt_user_can_edit_class_slots</code>, with cascading faceted filters.</li>
            <li><strong>Gotcha</strong>: in SchoolSyllabusPage, <code className="bg-white px-1 rounded">selectedGrade</code> is a <em>class id</em>, not a grade level id. Resolve the real grade level by name regex before any topic write.</li>
          </ul>
        </div>
      </section>

      {/* Section 37: Teacher Authority & Role Scoping (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">37. Teacher Authority &amp; Role Scoping (v3.0)</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Shipped 2026-08-26 and extended through September. Teacher authority is the class-and-subject <em>pair</em>, and this is enforced in the database rather than in the client.
        </p>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <ul className="list-disc list-inside text-red-900 text-sm space-y-1">
            <li><code className="bg-white px-1 rounded">teacher_controls_student(teacher, student)</code> is THE predicate for every teacher read and write except attendance. <strong>Sharing a class is not authority</strong>, and a <code className="bg-white px-1 rounded">class_assignments</code> row with no <code className="bg-white px-1 rounded">subject_id</code> grants nothing at all.</li>
            <li>Teachers can no longer change a student's optional subjects outside a shared class, and personal-details editing stays admin and coordinator only.</li>
            <li><strong>Dual-role users keep their scopes strictly separate.</strong> Teacher plus coordinator never unions the two lists; <code className="bg-white px-1 rounded">isXOnly</code> booleans hide data rather than merge it. <code className="bg-white px-1 rounded">ViewRole</code> is declared once, in <code className="bg-white px-1 rounded">ActiveRoleContext</code>, and <code className="bg-white px-1 rounded">viewRoles[0]</code> is the default, so teacher plus coordinator still defaults to teacher.</li>
            <li><strong>An admin may also teach</strong> (2026-09-05): <code className="bg-white px-1 rounded">grant_teacher_role</code> and <code className="bg-white px-1 rounded">revoke_teacher_role</code> from Manage Administrators, requiring at least one class-and-subject pair. The view toggle is presentation-only, because every server gate is an admin-first OR-union. Teacher dashboard scope must therefore resolve through <code className="bg-white px-1 rounded">dash_resolve_teacher_pairs()</code>, never the admin-first ladder.</li>
            <li><strong>Per-user capability grants</strong> raise one named user without a role change: <code className="bg-white px-1 rounded">tt_manager_overrides</code>, <code className="bg-white px-1 rounded">staff_manager_overrides</code>, <code className="bg-white px-1 rounded">syllabus_manager_overrides</code> and <code className="bg-white px-1 rounded">student_manager_overrides</code>, each with its own check.</li>
            <li><strong>The defect class this exposed</strong>: 73 teacher surfaces were swept in August 2026 and five were rendering a failed query as "zero students" or "no classes". A failed query must never read as an empty school, and the error state has to cover the stat tiles and headers, not just the list.</li>
          </ul>
        </div>
      </section>

      {/* Section 38: Student Experience & Achievements (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">38. Student Experience &amp; Achievements (v3.0)</h2>
        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-green-900 mb-2">38.1 Portal consolidation</h4>
          <ul className="list-disc list-inside text-green-900 text-sm space-y-1">
            <li>The student portal is <strong>two surfaces</strong>: a single-scroll parent-first Dashboard and My Results. The separate Reports destination and several dead dashboards were retired.</li>
            <li><strong>My Results</strong> carries filters, real class comparison and subject trajectory (three SECURITY DEFINER RPCs), and a chapter-wise analysis chart with wrapped axis labels.</li>
            <li><strong>Exam detail page</strong> with teacher remarks, section breakdown and PDF; the performance overview chart is clickable.</li>
            <li><strong>Downloadable report</strong> rebuilt with packed pages, correct page breaks and the restrained SALCI palette. The silent result loss in the old builder is fixed.</li>
            <li><strong>My Week</strong> rebuilt as a real timetable: days as rows, the clock across the top, real dates and subject accents. It no longer blanks a whole week behind a single holiday.</li>
            <li><strong>Study Materials</strong> redesigned, with PDFs opening directly from Syllabus Parts.</li>
            <li><strong>Staff view</strong>: authorised staff see the student's <em>actual</em> dashboard and the real student report, gated per RPC rather than reconstructed client-side.</li>
          </ul>
        </div>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-amber-900 mb-2">38.2 Achievements</h4>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><strong>Player Card</strong> achievements page with a tri-colour hero row, a streak spine, and grouped explanations of exactly how each badge was earned.</li>
            <li><strong>Leaderboard</strong> computed server-side, on the tri-colour system, with a "where am I" marker and an explanation per rank rather than hero cards.</li>
            <li><strong>Ladders</strong> now cover classroom activity, lesson planning, syllabus completion, assessment, marking and teamwork. The teacher ladder is open to coordinators, and rarity cohorts were re-paced from real production numbers rather than guesses.</li>
            <li>Homework badges appear in the Quest Log; the attendance tile was replaced by a live streak.</li>
          </ul>
        </div>
      </section>

      {/* Section 39: Exam Platform Enhancements (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">39. Exam Platform Enhancements (v3.0)</h2>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-blue-900 mb-2">39.1 Authoring</h4>
          <ul className="list-disc list-inside text-blue-900 text-sm space-y-1">
            <li><strong>Diagrams on every question type</strong> (2026-08-22) and <strong>per-option diagrams for MCQs</strong> (2026-09-02), delivered to students at a readable size and no longer cropped at upload. The <code className="bg-white px-1 rounded">question-images</code> bucket carries size limits.</li>
            <li><strong>Review step</strong> renders the full paper through the shared renderer, images included, checks it, and blocks a publish that would ship a broken paper. Draft papers print through the same renderer.</li>
            <li><strong>Draft resume</strong> reopens at the right step with subject, chapters and section plan intact; the step indicator is clickable.</li>
            <li><strong>Create Duplicate</strong> on every exam card; the My Exams status and mode filters were reworked, and Hybrid no longer hides behind Online.</li>
            <li><strong>MathLive equation builder</strong> on every manual-entry form and on each MCQ option.</li>
            <li><strong>Question bank</strong>: recent-first ordering backed by covering indexes.</li>
          </ul>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-purple-900 mb-2">39.2 Delivery and integrity</h4>
          <ul className="list-disc list-inside text-purple-900 text-sm space-y-1">
            <li><strong>Server-authoritative timer</strong>, and the back-button attempt reset is closed.</li>
            <li><strong>Late entry window</strong>: <code className="bg-white px-1 rounded">exams.late_entry_minutes</code> feeds an entry deadline. It is now actually enforced (it was previously written and never read), and unsetting it no longer saves 0 and instantly expires the exam.</li>
            <li><strong>4-strike violation ladder</strong>: tab switches and fullscreen exits share ONE ladder, with two warnings, a 15-second pause and auto-submit on the fourth. iOS and macOS are exempt from the fullscreen lock because Safari throws synchronously; fullscreen goes through <code className="bg-white px-1 rounded">src/lib/fullscreen.ts</code>.</li>
            <li><strong>Optional-subject delivery</strong>: an optional-subject exam only reaches students who take that subject.</li>
            <li><strong>Abandoned attempts</strong> auto-close, and array-shaped MCQ options auto-grade correctly.</li>
          </ul>
        </div>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-amber-900 mb-2">39.3 AI question generation</h4>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><strong>Production model is <code className="bg-white px-1 rounded">gpt-5-mini</code> at <code className="bg-white px-1 rounded">medium</code> reasoning effort.</strong> Never lower the effort to <code className="bg-white px-1 rounded">low</code>: it was hand-verified to produce mathematically wrong MCQs.</li>
            <li><strong>Subject-based cost routing</strong>: only Maths and the science family reach the reasoning model; other subjects use the basic model, and an institution can be opted out by env.</li>
            <li><strong>Per-user daily quota</strong> in <code className="bg-white px-1 rounded">user_question_limits</code>, so one teacher cannot exhaust a school's budget.</li>
            <li><strong>Grade must reach the prompt.</strong> It resolves from the chapter with the class as fallback. When it did not, every generation said "Grade Level: General" and a Nursery letter-recognition chapter produced persuasive-writing questions. Class 1 and below clamp to difficulty 2 or 3, get an early-years rule block, and bypass the reasoning model. Pre-primary grade numbers are negative.</li>
            <li><strong>No difficulty selector</strong>: hardcoded to 5, "always hardest, calibrated to grade level".</li>
            <li><strong>KaTeX is mandatory</strong>, and <code className="bg-white px-1 rounded">repairLatexEscapes()</code> must run before <code className="bg-white px-1 rounded">JSON.parse</code>. The control-letter repair is allowlist-based, because an unescaped <code className="bg-white px-1 rounded">\f</code> becomes a form feed and destroys the LaTeX irrecoverably.</li>
            <li><strong>Keep the under-delivery top-up and the single-flight add guard.</strong> Removing either reopens short-count or duplicate-question bugs.</li>
          </ul>
        </div>
      </section>

      {/* Section 40: Database & Production Operations (v3.0) */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">40. Database &amp; Production Operations (v3.0)</h2>
        <div className="bg-red-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-red-900 mb-2">40.1 Destructive writes go through RPCs only</h4>
          <p className="text-red-900 text-sm mb-2">
            Client code must never DELETE-then-INSERT a relationship table. On 2026-08-07 that pattern silently wiped two teachers' entire portals with no audit trail. Two or more dependent writes are ONE RPC, never sequential client calls, and any save that removes existing rows must confirm first, naming what it will remove.
          </p>
          <p className="text-red-900 text-sm">
            The transactional helpers: <code className="bg-white px-1 rounded">setStaffClassAssignments</code>, <code className="bg-white px-1 rounded">setClassTeachers</code>, <code className="bg-white px-1 rounded">deleteInstitutionSubject</code>, <code className="bg-white px-1 rounded">unassignSubjectFromClass</code>, <code className="bg-white px-1 rounded">set_student_class</code>, <code className="bg-white px-1 rounded">review_student_leave</code>, <code className="bg-white px-1 rounded">record_syllabus_progress</code>, <code className="bg-white px-1 rounded">create_task_group</code>, <code className="bg-white px-1 rounded">post_support_message</code> and <code className="bg-white px-1 rounded">_support_apply_status</code>. They diff in one transaction, name blockers before writing, and audit-log the delta into <code className="bg-white px-1 rounded">class_assignment_deletions</code>, which deliberately has no foreign keys so it survives cascades.
          </p>
        </div>
        <div className="bg-amber-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-amber-900 mb-2">40.2 RLS and grant landmines</h4>
          <ul className="list-disc list-inside text-amber-900 text-sm space-y-1">
            <li><strong>New SECURITY DEFINER functions must <code className="bg-white px-1 rounded">REVOKE EXECUTE ... FROM anon</code> BY NAME.</strong> Supabase default privileges grant it, and <code className="bg-white px-1 rounded">REVOKE FROM PUBLIC</code> does not strip it. Verify through <code className="bg-white px-1 rounded">information_schema.routine_privileges</code>. Two sweeps have already been needed.</li>
            <li><strong>Every RLS UPDATE policy needs both <code className="bg-white px-1 rounded">USING</code> and <code className="bg-white px-1 rounded">WITH CHECK</code>.</strong> A missing <code className="bg-white px-1 rounded">WITH CHECK</code> silently rejected 100% of teachers' offline-marks saves for two days.</li>
            <li><strong>A PostgREST DELETE blocked by RLS looks identical to success.</strong> For permission-sensitive deletes, re-SELECT by id and treat "the row is gone" as the only proof.</li>
            <li>Views that gate on the caller must stay <code className="bg-white px-1 rounded">security_invoker=on</code>.</li>
            <li>Policies call SECURITY DEFINER helpers only. An inline cross-table <code className="bg-white px-1 rounded">EXISTS</code> aborts with <code className="bg-white px-1 rounded">42P17</code>.</li>
          </ul>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-gray-800 mb-2">40.3 Operating production</h4>
          <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
            <li><strong>The migration ledger is not maintained.</strong> <code className="bg-white px-1 rounded">supabase_migrations.schema_migrations</code> does not reflect what is applied. Verify against <code className="bg-white px-1 rounded">pg_proc</code>, <code className="bg-white px-1 rounded">information_schema</code> and <code className="bg-white px-1 rounded">pg_indexes</code>, and apply production SQL through the Management API.</li>
            <li><strong>A unique INDEX is invisible to <code className="bg-white px-1 rounded">pg_constraint</code></strong>. Check <code className="bg-white px-1 rounded">pg_indexes</code> before concluding <code className="bg-white px-1 rounded">ON CONFLICT</code> is impossible.</li>
            <li><strong>Ship order matters.</strong> A migration that drops or narrows a column must not land before the frontend that stops reading it.</li>
            <li><strong>Regenerate types after a merge</strong> when two branches both touched the generated Supabase types: an auto-merge once silently dropped 206 lines of schema.</li>
            <li><strong>Zero-error contract</strong>: <code className="bg-white px-1 rounded">npm run typecheck</code>, ESLint on touched files, and <code className="bg-white px-1 rounded">vite build</code> must all exit 0 before any change is called complete. A bare <code className="bg-white px-1 rounded">tsc --noEmit</code> at the root is a no-op and once masked 77 errors.</li>
            <li><strong>Standing audit debt</strong>: security, performance, slowness, optional-subjects and teacher-portal audits from July and August 2026 remain partly open in <code className="bg-white px-1 rounded">docs/</code>. Two structural root causes recur: edge functions that check a role but not ownership, and controls enforced only in the React client. Verify an item's current status in code or production before trusting its stated severity.</li>
          </ul>
        </div>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <h4 className="font-semibold text-blue-900 mb-2">40.4 Current build phase</h4>
          <p className="text-blue-900 text-sm">
            The school ERP build-out began on 2026-09-07 and runs on two long-lived branches cut from main, one full-stack and one frontend-only, merged centrally. The frontend-only branch never touches <code className="bg-white px-1 rounded">supabase/</code>, never writes SQL and never reaches production; a task needing a schema change is handed over rather than guessed at. Priority order for the remaining modules is Admissions and Enquiry, the fee payment gateway, the Parent Portal, Library, payroll computation, and Transportation. See the ERP Roadmap document for module-level status.
          </p>
        </div>
      </section>

      {/* Footer */}
      <div className="mt-12 pt-6 border-t-2 border-gray-300 text-center text-gray-500 text-sm">
        <p>SALCI Platform PRD v3.0 | Comprehensive Documentation</p>
        <p>Last updated: September 8, 2026</p>
        <p>Scope: the SALCI school platform. The Olympiad subsystem shares this repository and Supabase project but is documented separately.</p>
        <p>© 2026 SALCI. All rights reserved.</p>
      </div>
    </div>
  );
});

PRDDocument.displayName = "PRDDocument";

export default PRDDocument;
