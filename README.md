# SALCI

**Self Analysis For Learning & Competency Improvement** — the multi-tenant school portal (admin / coordinator / teacher / student / parent / employee surfaces) backing the SALCI ecosystem.

> Internal repo. Read [`.claude/CLAUDE.md`](./.claude/CLAUDE.md) before writing code — it documents the production-readiness contract, RLS rules, error-translation policy, service-worker invariants, and module-specific gotchas that aren't obvious from the code.

## Stack

- **Frontend** — React 18 + TypeScript, Vite, Tailwind CSS + shadcn/ui (custom HSL tokens)
- **State / routing** — TanStack React Query v5, React Router v6
- **Backend** — Supabase: PostgreSQL + Auth (GoTrue) + Storage
- **Serverless** — 23+ Supabase Edge Functions (Deno) in [`supabase/functions/`](./supabase/functions/)
- **AI** — OpenAI (GPT-4o-mini) for question generation, OCR, auto-grading, insights

## Quick start

Requires Node.js 18+ and npm. Supabase CLI is installed as a dev dependency (no global install needed — invoke via `npx supabase` or the `db:*` / `fn:*` scripts).

```sh
git clone <repo-url>
cd salci-eco-core-main
npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:5173
```

Backend secrets (OpenAI, Resend, Razorpay, etc.) live in **Supabase Edge Function secrets** — never in `.env*`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build (must exit 0 before merging — see §5a in CLAUDE.md) |
| `npm run lint` | ESLint over the repo |
| `npm run db:status` | List linked Supabase migrations |
| `npm run db:push` | Push pending migrations to the linked project |
| `npm run fn:deploy <fn>` | Deploy a single Edge Function (e.g. `npm run fn:deploy generate-questions`) |

There is no `typecheck` script — run the compiler directly:

```sh
npx tsc --noEmit
```

## Production-readiness contract (mandatory)

Before claiming a task complete, **all three** must exit 0 on the files you touched:

```sh
npx tsc --noEmit                      # zero TypeScript errors
npx eslint <changed-paths>            # zero lint errors (no // eslint-disable, no `as any`)
npx vite build                        # zero build errors (size warnings ≠ failure)
```

`prefer-const` and `@typescript-eslint/no-explicit-any` are HARD errors in this repo's flat config — fix them, don't suppress. Full rules in [`.claude/CLAUDE.md` §5a](./.claude/CLAUDE.md).

## Project structure

```
src/
  components/
    ui/                shadcn/ui primitives (don't hand-roll <button>/<input>)
    shared/            cross-role components (page, surfaces, nav, sheets)
    admin/ teacher/ student/   role-scoped components
  pages/               route-level pages
  hooks/               custom business logic (useQuery / useMutation wrappers)
  lib/                 Supabase client, DB types, toast helpers, utilities
supabase/
  migrations/          DB schema + RLS (institution_id FKs + has_role() checks)
  functions/           Deno edge functions
.claude/
  CLAUDE.md            agent instructions — read first
  skills/              per-module invariants (timetable, syllabus, ui, etc.)
docs/superpowers/      feature plans + design specs
```

## The 4-layer build pattern

Every feature ships through these layers in order:

1. **DATABASE** — migration in `supabase/migrations/` with `institution_id` FK + RLS using `auth.uid()` and `has_role()`.
2. **EDGE FUNCTIONS** — Deno function for any 3rd-party API (OpenAI, Resend, Razorpay) or privileged operation.
3. **FRONTEND** — page + components + `useQuery` / `useMutation` hook.
4. **INTEGRATION** — feature-gating via `useInstitutionFeatures`, audit logging, notifications.

## Roles

Seven strict roles enforced at the DB layer via `user_roles` + the `has_role()` function:

`super_admin` · `super_school_admin` · `school_admin` · `coordinator` · `teacher` · `student` · `employee`

Always check role before exposing UI or mutating data. UI gating alone is not security.

## Module-specific guidance

The non-obvious invariants for each subsystem live in [`.claude/skills/`](./.claude/skills/). Skim the relevant skill before touching:

- **`salci-module-notes`** — Command Center, mobile exam creation, exam templates, question bank + chapter/topic hierarchy, AI question generation, teacher subject dual-table invariant, service worker dirty-form contract
- **`timetable-module`** — `tt_*` / `cal_*` schema (legacy `period_structures` / `timetable_slots` / `lesson_plans` / `academic_calendar` were dropped 2026-04-23)
- **`ui-invariants`** — shadcn Dialog ScrollArea fork, feature-gating sidebar/tile sync, shared `AddSubjectPopover`, `formatClassName` import gotcha
- **`syllabus-and-topics`** — `selectedGrade` is a class_id (not grade_level_id), grade-level resolution, chapter/topic dialogs

## Error handling

Every `onError` and `catch`-toast routes through `toastError(err, { fallback, context })` from [`src/lib/toast.ts`](./src/lib/toast.ts). Never `toast.error(err.message)` — it leaks raw Postgres strings to end users. See [`.claude/CLAUDE.md` §19](./.claude/CLAUDE.md) for the full contract.

## Edge Function deploys

```sh
# single function
npx supabase@latest functions deploy <name> --project-ref gyymkgohcijeksmrzuyw

# or via npm script
npm run fn:deploy <name>
```

Any prompt or logic edit to `generate-questions` (or any other function) requires a redeploy — local changes don't take effect until pushed.

## Design system

Mobile-first. Shared primitives live in `src/components/shared/{page,surfaces,nav,sheets}/`. Brand tokens (`--brand-primary` teal, `--brand-secondary` orange, etc.) are defined in `src/index.css` for both `:root` and `.dark`. Full design rules in [`.claude/rules/design-rules.md`](./.claude/rules/design-rules.md) and CLAUDE.md §20a / §20b.

## Common pitfalls (if you only read one section, read this)

- **`final_results.percentage` is a GENERATED column** — never include it in INSERT/UPSERT. The row will silently drop. (§9)
- **Exam publish blocked without a blueprint** — `useSaveExam` / `useUpdateExam` synthesize defaults for subjective questions. Don't remove. (§10)
- **Service worker must stamp `__BUILD_ID__`** — without the Vite plugin in `vite.config.ts`, deploys are byte-identical and PWAs sit on stale code. (§17)
- **Question bank scope** — direct inserts must include `class_group_id` and call `applyQuestionScope`. (§22)
- **Class groups are above sections** — write subject mappings to `subject_class_group_mappings`, never directly to `subject_class_mappings`. (§22)
- **`admin-operations` invokes** — go through `invokeAdminOperation` from `src/lib/invokeEdgeFunction.ts`. The default `supabase.functions.invoke` swallows the real error message. (§21)
