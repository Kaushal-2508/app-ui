# Olympiad Super-Admin Restructure — Phase 4: Managed-Mode Access + Final Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire an "Access school admin dashboard" button into the Olympiad school detail page that enters in-app managed mode for the school's institution, then run the whole-restructure §5a sweep + a closing review.

**Architecture:** Reuse `InstitutionContext.startManaging(institutionId)` (the same path `InstitutionsPage` uses). The detail page needs the linked `institutions.id`, which `useOlympiadSchool` does not currently return — Task 1 adds it. The magic-link `ImpersonateDialog` (Phase 5b) stays available as a secondary action.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, Supabase, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-superadmin-restructure-design.md](../specs/2026-05-27-olympiad-superadmin-restructure-design.md) (§8, §12).

**Depends on:** Phase 1 (detail route), Phase 3 (detail dashboards). Lands the access button on the existing detail page; if Phase 3 introduced the in-progress/done fork, the button sits in the shared header button row that covers both.

**No test infrastructure** — verify via §5a.

---

## Verified facts (read before starting)

- **Context hook:** `import { useInstitutionContext } from "@/contexts/InstitutionContext"`. Method: `startManaging(institutionId: string): void`. There is NO `useInstitution` export — `useInstitutionContext` is the consumer hook.
- **Reference** `InstitutionsPage.handleAccessAsAdmin`: `startManaging(institutionId); navigate("/school/teachers");` + a `useToast()` success toast, no try/catch.
- **`useOlympiadSchool`** (`src/hooks/olympiad/useOlympiadSchool.ts`): selects `oly_schools` joined to `institutions(name)` but does NOT currently select/return `institution_id`. The loaded row variable on the detail page is `school`.
- **`ImpersonateDialog`** is a controlled `AlertDialog` (`open`/`onOpenChange`/`olySchoolId`/`schoolName`) opened by the existing outline `size="sm"` "View as Admin" button — already a secondary action.
- **Detail page button row:** `<div className="flex flex-wrap items-center gap-2 pt-2">` holding "View as Admin" + "Archive".

---

## File Structure

- **Modify** `src/hooks/olympiad/useOlympiadSchool.ts` — add `institution_id` to the select, the `SchoolDetail` type, and the returned object.
- **Modify** `src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx` — add the "Access school admin dashboard" primary button; keep "View as Admin" secondary.

---

## Task 1: Surface `institution_id` from `useOlympiadSchool`

**Files:** Modify `src/hooks/olympiad/useOlympiadSchool.ts`

- [ ] **Step 1: Read the file.** Make three exact edits using its current content:
  1. Add `institution_id: string;` to the `SchoolDetail` (or equivalent) type.
  2. Add `institution_id` to the `oly_schools` `select(...)` column string.
  3. Add `institution_id: <row>.institution_id` to the returned object.
  `oly_schools.institution_id` is a real NOT-NULL FK column, so it type-checks without a cast.
- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/hooks/olympiad/useOlympiadSchool.ts`.
- [ ] **Step 3: Commit** — `git add src/hooks/olympiad/useOlympiadSchool.ts && git commit -m "feat(olympiad): surface institution_id from useOlympiadSchool for managed-mode access"`

## Task 2: "Access school admin dashboard" button

**Files:** Modify `src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx`

- [ ] **Step 1: Read the file.** Add imports (merge into existing lines; do not duplicate): `useNavigate` from `react-router-dom`, `LogIn` from `lucide-react`, `useInstitutionContext` from `@/contexts/InstitutionContext`, `useToast` from `@/hooks/use-toast` (match the project's toast hook path), and `toastError` from `@/lib/toast`.
- [ ] **Step 2: Add the handler** inside the component:

```tsx
const navigate = useNavigate();
const { startManaging } = useInstitutionContext();
const { toast } = useToast();

const handleAccessAsAdmin = () => {
  if (!school?.institution_id) {
    toastError(new Error("School is not linked to an institution"), {
      fallback: "This school has no linked institution to manage.",
      context: "olyAccessAsAdmin",
    });
    return;
  }
  startManaging(school.institution_id);
  navigate("/school");
  toast({
    title: "Managing school",
    description: "You are now managing this school as an admin. Use the sidebar to navigate.",
  });
};
```

> `navigate("/school")` follows the spec §8 contract. If `App.tsx` has no `/school` index route, use `navigate("/school/teachers")` to match `InstitutionsPage` exactly — confirm against `App.tsx` first.

- [ ] **Step 3: Add the primary button** as the FIRST child of the existing `<div className="flex flex-wrap items-center gap-2 pt-2">` button row (so it leads; "View as Admin" stays the secondary outline button after it):

```tsx
<Button size="sm" onClick={handleAccessAsAdmin}>
  <LogIn className="h-4 w-4 mr-1" />
  Access school admin dashboard
</Button>
```

If Phase 3 forked the layout into in-progress/done bodies, this row sits ABOVE the fork (shared header), so one button covers both modes. If Phase 3 duplicated the row per mode, add the button to both copies.

- [ ] **Step 4: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx`, `npx vite build`.
- [ ] **Step 5: Commit** — `git add src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx && git commit -m "feat(olympiad): managed-mode 'Access school admin dashboard' on school detail"`

## Task 3: Whole-restructure §5a sweep

- [ ] **Step 1:** Derive the touched surface: `git diff --name-only main...HEAD | grep -E "olympiad|institution"`.
- [ ] **Step 2: Run all three** at repo root:
  - `npx tsc --noEmit` (exit 0)
  - `npx eslint "src/pages/admin/olympiad/**" "src/components/olympiad/admin/**" "src/hooks/olympiad/**" src/App.tsx src/components/admin/institution-wizard/featuresData.ts` (no new errors)
  - `npx vite build` (exit 0; bundle-size warnings are not failures)
- [ ] **Step 3:** Fix any failures in the file that caused them; re-run until all three are green. Commit fixes: `git commit -am "fix(olympiad): restructure §5a sweep fixes"` (only if there were fixes).

## Task 4: Closing review

- [ ] **Step 1: Dispatch a code-review subagent** over the whole restructure (`git diff main...HEAD` on the olympiad surface) checking:
  - §23: every new `useQuery`/`useInfiniteQuery` has explicit `staleTime`; all new RPCs SECURITY DEFINER + super-admin gated + paginated; no `select("*")` in non-admin paths; no client `.length` over capped reads.
  - §19: every new `onError`/catch routes through `toastError`.
  - §20/§20b: shadcn primitives + tokens (no raw hex/grey); `StatTile` clickables wrapped in `<button>`; MobileSheet/MobileTabs/EmptyState used; mobile-first at 375px.
  - Feature-gating intact: `/admin/olympiad*` is super-admin-only (not institution-feature-gated); the Phase-1 `FEATURE_URL_MAP` Olympiad sub-route entries (school-side) are untouched.
  - Derived-stage correctness: zero-batch schools never bucket as `done`; in/done partition is exhaustive.
  - The detail page is still a standalone `PageShell` route (not double-wrapped).
- [ ] **Step 2:** Triage findings — apply real fixes, ignore false positives, commit: `git commit -am "fix(olympiad): restructure final-review fixes"`.

## Task 5: Manual end-to-end smoke

- [ ] Shell: 2 tabs, Schools default, Campaign Settings sheet.
- [ ] Exam Settings: class list → class → subject → grade-scoped topics/questions/material; add flows work.
- [ ] Schools: onboard a new school (auto codes + admin creds), it appears in in-progress; filter New/Onboarded.
- [ ] In-progress detail: stage/counts/payment drilldown. Done detail: revenue + result summary.
- [ ] "Access school admin dashboard" → managed mode → lands in the school app as that institution; exiting managed mode returns to super-admin.
- [ ] 375px + dark mode pass across all new surfaces.

---

## Self-review

- **Spec coverage:** §8 (Tasks 1,2), §12 final review (Tasks 3,4,5). Covered.
- **Placeholders:** none — Task 1/2 are precise edits over read files; complete handler code given.
- **Consistency:** uses `useInstitutionContext` (verified export name) + `startManaging`; null-guards the unlinked-institution case via `toastError`.
- **Cross-phase:** button sits in the shared header row so it covers Phase 3's in-progress/done fork; magic-link `ImpersonateDialog` retained as secondary.
