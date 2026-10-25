# SALCI — Tech Onboarding

Welcome to the tech team. This document exists so you can understand, in one read, what SALCI is technically, how the system is put together, and how we work day to day. Read it once end to end, then keep it open as a reference for your first two weeks. Nothing here is confidential beyond the codebase itself. When something in the doc disagrees with the actual code, the code wins, and you should tell us so we can fix the doc.

A note on honesty up front: parts of our older sales and pitch material describe the product as more complete than it is. This doc does not. Where a module is half-built or a piece of the schema is known to be wrong, it says so. You will be more useful faster if you know where the bodies are buried.

---

## 1. What SALCI is

SALCI is a multi-tenant school operating system for K-12 schools in India, aimed at CBSE-affiliated schools with roughly 500 to 1,500 students. "Multi-tenant" means one deployment, one database, many schools, with each school's data isolated from every other school's. A school in our system is called an **institution**, and almost every row in the database carries an `institution_id` that ties it to one school.

It is not a teaching-assistant app and not a pure academics tool. The pitch we hold internally is that it is the operating system a school runs on: management, staff, parents, and students on one platform, across both academics and operations. What happens in a classroom becomes what a coordinator sees, what a principal decides, and what a parent knows. That sentence is the product thesis; keep it in mind when you build, because features that don't ladder up to it usually don't belong.

SALCI is now a **family of platforms**, not one app, and this repository is specifically the **core school OS** described above. The siblings have been split out so that each runs on its **own isolated Supabase project** rather than sharing this one database:

- **SALCI Olympiad** — a paid competency-based exam product we use to get into new schools. It began life as a module *inside* this codebase, but in July 2026 it was extracted into a fully standalone platform: its own repository, its own Supabase project and organisation, and its own domain (`olympiad.salci.ai`), now live. The legacy `oly_*` tables and `oly-*` Edge Functions still sit in this database, but they are a frozen copy pending cleanup — Olympiad work no longer happens here.
- **The internal operations tool** (`salci.sale`, repo `harmony-ops`) — our own company's CRM / sales / HR / attendance system (leads, tasks, OKRs, demos, leave). It is not a school-facing product; it's how we run the company. As of July 2026 it too has been moved onto its own Supabase project ("SALCI House"); its `lms_*` tables likewise remain here as a stale copy until cutover is confirmed and they're dropped.

The practical upshot for you: you work on the **core school system** in this repo. The sibling platforms live in their own repos and databases, and you generally won't touch them from here. When you see `oly_*` or `lms_*` objects in this database, treat them as legacy — not something to build against.

---

## 2. The two-minute architecture

The system is a single-page web app talking to a serverless backend. There is no traditional server that we run, patch, or scale. The pieces:

**Frontend.** A React 18 app written in TypeScript, built with Vite, styled with Tailwind and shadcn/ui components. It is a Progressive Web App, so it installs on phones and tablets and has a service worker for offline behaviour and auto-updates. It is hosted on Vercel, which deploys automatically when we push to the `main` branch.

**Backend.** Everything server-side is **Supabase**. That single word covers five things we rely on: a PostgreSQL database (the heart of the system), authentication (GoTrue, email/password and magic links), file storage (S3-compatible, for answer sheets, PDFs, study materials, logos), realtime subscriptions over WebSockets (for live notifications and updates), and Edge Functions (serverless Deno functions where our server-side logic and AI calls live).

**AI layer.** We call OpenAI models (GPT-4o-mini today) from inside Edge Functions, never from the frontend. AI does question generation, grading of subjective answers, OCR of handwritten sheets, and various analytics narratives. More on this in section 8.

The data flow is: the browser talks to Supabase over HTTPS with a JWT, Edge Functions talk to OpenAI, and the frontend is served from Vercel's CDN. That's the whole shape.

One clarification on "one database": that describes **this platform**, the school OS — every school shares this single Postgres instance. It does not mean the whole company runs on one database. The sibling platforms (Olympiad, the internal ops tool) each have their own separate Supabase project now; see the ecosystem note in section 1. Within this repo, though, "one deployment, one database, many schools" holds.

```
Browser (React PWA on Vercel CDN)
        |  HTTPS + JWT
        v
Supabase  ──  PostgreSQL (with Row-Level Security)
          ──  Auth (GoTrue)
          ──  Storage (S3)
          ──  Realtime (WebSockets)
          ──  Edge Functions (Deno)  ──  OpenAI (GPT-4o-mini)
```

---

## 3. The frontend, in more detail

The stack you will live in every day:

- **React 18 + TypeScript in strict mode.** Strict mode is not optional and `any` is banned. ESLint treats `no-explicit-any` and `prefer-const` as hard errors, so a build with a stray `any` fails. This is deliberate. Lean on real types.
- **Vite** for the build and dev server. Sub-second hot reload. Production builds are verified with `tsc --noEmit` followed by `vite build` before anything ships.
- **Tailwind CSS + shadcn/ui.** shadcn components are built on Radix primitives, so they are accessible by default. Colours come from HSL design tokens, not hardcoded hex. Use the tokens.
- **TanStack React Query v5** for all server state. This is important: we do not fetch data with raw `useEffect` and `fetch`. Query handles caching, background refetching, and deduplication. Query keys are centralised in `src/lib/queryKeys.ts` so the cache stays consistent. When you add a data fetch, add a hook and a query key; don't scatter fetches through components.
- **React Router v6** for routing, with lazy loading and role-protected routes. The `ProtectedRoute` component in `src/components/layout/` gates access by role.
- **React Hook Form + Zod** for forms. Every form is schema-validated with Zod before it hits the backend. When you build a form, you write a Zod schema for it.
- **Recharts** for charts, **KaTeX** for rendering exam-quality maths (plain-text maths is treated as a defect in exam content), **Framer Motion** for animation, and **html2pdf.js / jsPDF** for client-side PDF generation of report cards and results.

Business logic is pushed into **custom hooks** rather than sitting in components. There are a large number of these in `src/hooks/` (files like `useExamData.ts`, `useAttendance.ts`, `useStudentPassport.ts`, `useFeeCollection.ts`). The pattern to internalise: a page component is thin and mostly layout; the hook holds the data fetching and the logic. When you need data or behaviour, look for an existing hook before writing a new fetch.

The app is mobile-responsive down to 375px width. A meaningful share of our users are on phones, so "it works on my laptop" is not "it works."

---

## 4. The backend and Edge Functions

We have no application server. Server-side logic lives in **Edge Functions**: individual Deno functions under `supabase/functions/`, each in its own folder with an `index.ts`. They run at the edge with fast cold starts and are deployed one at a time.

What Edge Functions are for, broadly:
- **AI work** that must not run in the browser (question generation, grading, OCR, insights, predictions).
- **Privileged operations** that need secrets or elevated database access (user creation and role changes, admin invitations, student promotion at year-end).
- **Communication** (emails, web push, task notifications, fee reminders).
- **Anything with a secret.** Backend secrets (the OpenAI key, service-role keys) live only in the Edge Function environment. They are never in the frontend bundle. The only keys the frontend sees are `VITE_`-prefixed public keys, which are safe to expose by design.

A rule that matters: **the frontend never holds a secret and never calls OpenAI directly.** If a task needs a secret or elevated privilege, it belongs in an Edge Function. If you find yourself wanting to put a key in frontend code, stop; that's the signal you need a function.

You deploy a function with the Supabase CLI:

```bash
npx supabase@latest functions deploy <function-name> --project-ref <ref>
```

Representative functions you'll encounter: `generate-questions`, `auto-grade-submission`, `process-ocr-upload`, `generate-exam-insights`, `admin-operations`, `resolve-login-identifier`, `promote-students`, `send-communication`. The names are self-describing, which is the intent.

---

## 5. The database — read this section twice

The database is the centre of gravity of this whole system. If you understand the data model, the rest follows. If you don't, you will make mistakes that RLS or a trigger will punish.

**Engine.** PostgreSQL, managed by Supabase. The schema has been built up over a large number of migration files under `supabase/migrations/`, each timestamped. It is not a prototype schema; it has been shaped by real pilot use, which also means it carries real scars (see the known issue below).

**Multi-tenancy.** Every school-scoped table has an `institution_id`. This is how one database serves many schools without leaking data between them. When you add a table that holds school data, it needs `institution_id`, and it needs RLS policies. No exceptions.

**Row-Level Security (RLS).** This is the single most important thing to understand about our security model. RLS is a PostgreSQL feature that enforces *at the database level* who can see and change which rows. It is not a check in our frontend code that a clever user could bypass; it is enforced by Postgres itself on every query. A student's query for exam attempts only returns their own rows because the policy says so, not because the UI filtered them. A teacher sees data only for classes they're assigned to, for the same reason.

Because of this, two habits are mandatory:
- Every new table gets RLS policies from the start. A table without policies is either invisible or a leak, never "fine for now."
- Complex access checks are done through `SECURITY DEFINER` helper functions (for example a `has_role()` function), not by writing recursive subqueries inline in a policy. Inline recursion in RLS causes infinite-loop traps; the helper-function pattern avoids them. Follow the existing pattern; don't invent a new one.

**Integrity is enforced in the database, not hoped for in the app.** We use foreign keys, CHECK constraints, generated columns, and triggers. A concrete example: a results table's `percentage` column is a *generated* column, computed by the database, never inserted by hand. Another: some group-level writes fan out to section-level rows automatically via triggers. And cascade behaviour is deliberate: ownership foreign keys use `ON DELETE CASCADE` (delete the owner, the owned data goes), while attribution foreign keys use `ON DELETE SET NULL` (delete a user, and the record they created stays but is de-attributed). When you design a relationship, decide consciously which of those two it is.

**The known architectural problem you must know about.** The `classes` table currently conflates grade and section into one flat structure with no proper parent-child hierarchy. In plain terms: "Class 10" and its sections "10A, 10B, 10C" are not modelled as a clean parent with children the way they should be. The intended design is a class-group-to-section hierarchy, and some of the newer code and the pitch talk as if that hierarchy already exists everywhere. It does not, consistently. Fixing it requires a careful parallel migration (an expand-and-contract approach) because there is live pilot data we cannot break. Until that's done, be careful whenever you touch anything that reasons about grades versus sections, and ask before assuming the hierarchy is clean. This is the most important caveat in the codebase.

**Types come from the schema.** The Supabase CLI generates TypeScript types from the database into `src/integrations/supabase/types.ts`. When the schema changes, regenerate the types; don't hand-write them.

---

## 6. Auth and the role model

**Authentication** is Supabase GoTrue: email/password and magic links, with JWT sessions that auto-refresh. Students can log in flexibly by email, phone number, or roll number; that resolution happens in the `resolve-login-identifier` Edge Function rather than in the client. Admins can force a password reset on first login.

**Authorization** runs on a role hierarchy. The roles, from most to least privileged:

```
super_admin            (us — platform level)
  super_school_admin   (owner across multiple schools)
    school_admin       (a school's administrator / principal)
      coordinator      (manages a wing / set of classes)
      teacher
      employee         (non-teaching staff)
    student            (and by extension, parent visibility)
```

Roles live in a `user_roles` table and are checked through a `has_role()` database function. Authorization is enforced in two layers that must agree: the frontend hides or shows routes and UI via `ProtectedRoute` and role hooks, and RLS enforces the real boundary at the database. The frontend layer is for user experience; the database layer is the actual security. Never rely on the frontend check alone.

On top of roles there is **per-institution feature gating**. Not every school has every module turned on. The `useInstitutionFeatures` hook tells you which features an institution has enabled, and UI should respect it. The product principle here is that gated-off features are omitted *silently* from the UI and from generated PDFs; we do not show a school a loud "you don't have this, upgrade" banner in the middle of their workflow.

---

## 7. How the codebase is laid out

Frontend lives under `src/`. The parts you'll use most:

- `src/pages/` — route-level page components, organised by area: top-level pages, plus `admin/`, `school/`, `student/`, `staff/`, `teacher/`, `proctoring/`. Pages are thin.
- `src/components/` — the bulk of the UI, grouped by domain. You'll see folders like `exam/`, `exam-results/`, `attendance/`, `timetable/`, `syllabus/`, `fees/`, `hr/`, `communication/`, `dashboards/`, `reports/`, `analytics/`, `proctoring/`, `passport/`, `payments/`, `offline-scan/`, and a `shared/` folder for reusable pieces (`DataTable`, `MetricCard`, `FilterBar`, `StatusBadge`, and similar).
- `src/hooks/` — business-logic hooks, one concern each. This is where most logic lives.
- `src/lib/` — cross-cutting utilities: `queryKeys.ts` (the query-key factory), `utils.ts`, number and text formatting, class-promotion logic.
- `src/integrations/supabase/` — the Supabase `client.ts` and generated `types.ts`.
- `src/utils/` and `src/types/` — smaller helpers and shared type definitions.

Backend lives under `supabase/`: `functions/` for Edge Functions and `migrations/` for the schema history.

Config sits at the root: `package.json`, `vite.config.ts`, `tailwind.config.ts`, `tsconfig*.json`, `eslint.config.js`, `vercel.json`, and `components.json` (shadcn config). The PWA service worker is `public/sw.js`. The brand logo is `public/Logo.png` — use this exact asset on any SALCI-branded surface; never substitute typed-out wordmark text.

When you're hunting for where something lives, the folder names are honest, so search by domain first (`exam`, `fees`, `attendance`) rather than guessing.

---

## 8. The AI layer

AI is woven into the core exam workflow rather than bolted on as a chatbot. The main uses:

- **Question generation** (`generate-questions`): produces board-exam-quality questions with proper LaTeX maths formatting, grounded in syllabus content.
- **Auto-grading** (`auto-grade-submission`): evaluates subjective answers against configurable evaluation blueprints, with confidence thresholds that decide when a human needs to verify.
- **OCR** (`process-ocr-upload`): digitises handwritten offline answer sheets so they can be graded.
- **Analytics narratives**: exam insights, student performance predictions, learning-action recommendations, and principal-level insight summaries.
- **Student mascot chat** (`mascot-chat`): a study companion for students.

Two engineering guardrails matter. First, **LaTeX correctness is non-negotiable for exam content** — plain-text maths is a hard fail, and there is a JSON escape-repair step in the pipeline specifically to stop LaTeX from getting corrupted when the model's JSON is parsed. Second, **grading confidence gates human review**: low-confidence auto-grades are routed to a teacher rather than trusted blindly. When you work near AI features, respect these; they exist because we broke things without them.

All of this runs in Edge Functions with the OpenAI key held server-side. The model in use today is GPT-4o-mini; treat the specific model as a detail that can change, and don't hardcode assumptions about it across the codebase.

---

## 9. PWA and offline behaviour

The app is installable and has a custom service worker (`public/sw.js`). A few behaviours worth knowing because they're easy to break:

- **Auto-update.** Each build stamps a build ID into the service worker. The app detects a new deployment (on tab-visibility change and via hourly polling) and updates itself. Users don't go to an app store.
- **Dirty-form safety.** If a user has unsaved form data, the app will *not* silently auto-reload to a new version; it shows an update prompt instead. So an update never eats someone's half-finished data entry.
- **Offline exam marking.** Teachers can capture and mark offline answer sheets even without a live connection, syncing later.
- **Push notifications** use the Web Push API for tasks, exam alerts, and fee reminders.

If you change build or caching behaviour, test the update flow and the dirty-form case explicitly; both are subtle.

---

## 10. How we work

**Development tool.** Development is done primarily through **Claude Code**. The project moved off Lovable onto Claude Code, and there is a `CLAUDE.md` at the root that encodes our structural conventions. Because `CLAUDE.md` already handles structure, prompts we write for Claude Code focus on *logic and expected outcomes*, not on restating conventions. We also tell Claude Code to discover the schema for itself before building against it, rather than assuming table shapes, and to surface ambiguities rather than guess. When you start writing prompts, follow that style: plain prose, logic and outcomes, self-discovery of schema, flag ambiguity.

**Deployment.**
- Frontend: push to `main`, Vercel builds and deploys automatically. There is no separate manual frontend deploy.
- Edge Functions: deploy individually with the Supabase CLI command in section 4.
- Database: schema changes are migrations, always; we do not hand-edit the live database. But do NOT run `supabase db push`: the migration ledger in prod is not maintained and the CLI would try to replay hundreds of already-applied files. Migrations are applied to production by Tushar through the Management API (`scripts/run-sql.ps1`) and verified against `pg_proc` / `information_schema`, never against the ledger (see `CLAUDE.md` §26 and the `prod-operations` skill). As a new engineer you write the migration file with a `NOT applied to prod` header and say so in your PR; you never apply it yourself.

**Quality bar, non-negotiable.**
- TypeScript strict mode, zero `any`. ESLint errors block the build.
- Every change is verified with `tsc --noEmit` and `vite build` before shipping.
- Errors shown to users are friendly, translated messages; raw Postgres errors are never surfaced to a user. There is a central error-translation path (`translateError()` / `toastError()`) — use it, don't `alert()` a database error.
- Forms validate with Zod before submitting.
- Data fetches go through React Query hooks with centralised query keys, not ad-hoc `fetch` calls.

**Engineering principles that reflect how the team thinks.** These come up constantly, so internalise them early:

- **Additive-only, protect live data.** We have real schools with real data in the system. Changes preserve existing behaviour and existing data. When you modify a feature, you don't touch unrelated downstream computation, and you never break the pilot schools' data. If a change can't be made additively, that's a design conversation before it's a code change.
- **Name things honestly.** A metric is never labelled as something the underlying data can't actually support. The standing example: a number derived from attendance and lesson signals is called "Lesson Delivery %," not "Syllabus Coverage %," because it doesn't truly measure coverage. This naming-integrity rule runs through the whole analytics layer, and it's a real review criterion, not a nicety.
- **Depth is opt-in, readability is default.** Dashboards and visualisations should be readable by a non-technical user with no legend, while still letting an interested user drill into depth. The dashboard mantra is: show what's red, say why, say who needs help.
- **Tight scope, human-enforced correctness where sensible.** We prefer a clean small v1 over an over-engineered one, and we sometimes prefer a human enforcing correctness over the system rigidly enforcing it, when that keeps things simple. Don't gold-plate.
- **Silent feature gating.** As above: excluded features are omitted quietly from UI and PDFs, not flagged loudly.

**Working style.** Decisions are made one at a time. The expectation is that you surface a single ambiguity or decision, get it settled, then move on, rather than opening ten questions at once or re-opening things already decided. Honest pushback is wanted: if something is a bad idea, a risk, or mis-named, say so. Nobody here wants a yes-machine.

---

## 11. What is real vs. what is aspirational

This is the section our older pitch material won't tell you, and it's the one that will save you time. The platform is genuinely substantial, but not everything described as "built" is finished or in production use. Treat this as your map of the terrain.

**Solid and in real use:** the core multi-tenant foundation (institutions, RLS, roles, auth), the assessment and exam engine (online, offline, and hybrid handwritten modes with on-screen marking, question bank, AI generation, result validation, performance analytics), timetable and lesson planning, syllabus and coverage tracking, the student portal, attendance, and the admin command centre. This is the mature heart of the product.

**In active build / partial:** Homework/assignment is an early version. Various analytics surfaces are still being shaped. (Olympiad used to live in this list as a mid-build module; it has since been extracted into its own live platform — see section 1 — so it's no longer part of this codebase's roadmap.)

**Exists in the code and the PRD but is not the finished, load-bearing thing the pitch implies — approach with eyes open:**
- **Fees / finance.** There are fees and payments components and hooks in the tree, but the fee-management and finance *spine* is not actually complete, despite the pitch describing "Fees Management" as done. This is a known gap and a priority, and it's the piece schools actually pay to have working. If you're assigned here, assume you're building the real thing, not polishing a finished one.
- **HR / workforce.** Similarly present in the tree as components and hooks, but the non-teaching-staff entities and the people-operations layer are still foundational work, not a shipped module. Non-academic staff (front office, accountant, guard, housekeeping, and so on) with proper role-based permissions are on the roadmap, not done.

**Known issue that outranks all others:** the grade/section flat-`classes` problem described in section 5. Everything that reasons about the class hierarchy is living on top of that unresolved foundation. Keep it in mind on every task that touches classes, grades, or sections.

The counts and superlatives in the marketing deck (exact numbers of pages, hooks, functions, migrations) are approximate and drift as we build; don't treat any specific figure as gospel, and don't quote them back to anyone as fact. The code is the source of truth. Always.

---

## 12. Your first week

A reasonable path in:

1. Get the app running locally. Confirm the Vite dev server, a successful `tsc --noEmit`, and a clean `vite build`. If the build isn't clean out of the box, that's your first thing to raise.
2. Read `CLAUDE.md` at the root. It's the structural rulebook and it saves you re-deriving conventions.
3. Open `src/lib/queryKeys.ts`, `src/integrations/supabase/client.ts`, and one full feature slice end to end — pick `exam` — reading its page, its components, and its hook together. Seeing one domain wired from route to database teaches the pattern for all of them.
4. Read a handful of recent migration files to get a feel for how the schema is expressed and how RLS policies are written.
5. Skim the roles section again and trace one `ProtectedRoute` plus one RLS policy for the same table, so you see both layers of authorization on one concrete example.
6. Ask about the class/section hierarchy issue before you touch anything grade- or section-related. It's the one landmine we can point you around in advance.

When in doubt, ask one clear question, get it settled, and move. That's how the team runs, and it's how you'll ramp fastest.

Welcome aboard.
