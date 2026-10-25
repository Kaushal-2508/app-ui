# Student Report PDF + Institution Logo — Design

**Date:** 2026-04-27
**Status:** Approved (awaiting plan)
**Owner:** tushar@salci.in

## Background

A school admin viewing a student's dashboard ([src/pages/school/StudentPerformancePage.tsx](../../../src/pages/school/StudentPerformancePage.tsx), reached via the "Access Dashboard" affordance in the User Profile sheet) needs a way to download a complete report of that student's performance and learning passport. Today there is no such export. The page itself is information-dense (KPIs, trend, subject-wise performance, topic mastery, recent exams, learning passport, badges, academic history, subject capabilities) but ephemeral — none of it survives outside the browser.

The user explicitly required a **true PDF** — vector text, searchable, indexable — not an HTML-to-canvas screenshot. The codebase already has `jspdf` (true vector) and `html2pdf.js` (screenshot route) as deps; only `jspdf` is in scope.

In addition, the requested header branding bundles a second feature: each institution should carry its own logo, manageable by the super admin (`bhan@salci.in`), and that logo should be reusable beyond just this PDF. The `institutions` table has no logo column today; a storage bucket `institution-logos` is referenced in the system architecture document but is not wired to any column or upload UI.

## Goals

1. A "Generate Report" button on the student-dashboard page that produces a true vector PDF containing the full performance + learning-passport data set.
2. A first-class institution-logo system: super admin uploads/replaces logos per institution, and consumer surfaces (sidebar + this PDF) read the logo via a shared hook.
3. Both pieces ship in a single branch as two phases: logo first (Phase 1), report second (Phase 2).

## Non-Goals

- Email-template branding with the institution logo (deferred).
- Login-page skinning by institution code (deferred).
- School-admin / coordinator self-service logo upload (super_admin only this round).
- Native vector charts in the PDF — content is rendered as data tables only (user-selected scope).
- Per-exam, question-by-question student detail in the PDF — that's a separate "Detailed Exam Report" feature.
- SVG logo support — uploads restricted to PNG/JPG/WebP this round.

## Phase 1 — Institution Logo Management

### 1.1 Schema

One migration:

```sql
ALTER TABLE public.institutions
  ADD COLUMN logo_url TEXT;
```

`logo_url` is nullable. Existing rows are unaffected; the upload UI populates it on demand.

### 1.2 Storage

Bucket: `institution-logos`. The migration must verify it exists in `storage.buckets` and create it (public read) if missing. Bucket policies on `storage.objects`:

- **SELECT** — public (everyone, no auth).
- **INSERT / UPDATE / DELETE** — `has_role(auth.uid(), 'super_admin')` only.

File path convention: `{institution_id}/logo.{ext}` so re-upload overwrites the same key. The DB column stores the resolved public URL (`getPublicUrl()` output) for read consumers.

### 1.3 Reader hook — `src/hooks/useInstitutionLogo.ts`

```ts
export function useInstitutionLogo(
  institutionId: string | null | undefined
): { logoUrl: string | null; isLoading: boolean }
```

- Reads `institutions.logo_url` for the given id.
- Cached via TanStack Query, key `["institution-logo", institutionId]`.
- Returns `{ logoUrl: null }` when the column is null OR the row is unreadable. **Never throws.** Consumers fall back silently (text-only).

### 1.4 Mutation hook — `src/hooks/useUploadInstitutionLogo.ts`

```ts
useUploadInstitutionLogo() // returns { mutate, mutateAsync, isPending }
// payload: { institutionId: string; file: File }
```

Behavior:

1. Client-side validate: type ∈ {PNG, JPG, WebP}, size ≤ 2 MB. Reject inline before upload (no toast — form-level error).
2. Upload to `institution-logos/{institutionId}/logo.{ext}` with `upsert: true`.
3. Resolve public URL.
4. `UPDATE institutions SET logo_url = '<url>' WHERE id = institutionId`.
5. On `onSuccess`: invalidate `["institution-logo", institutionId]` and any institution list keys.
6. On `onError`: route through `toastError(e, { fallback: "Couldn't upload logo.", context: "uploadInstitutionLogo" })` per CLAUDE.md §19. If the storage upload succeeded but the DB update failed, attempt to delete the orphaned object before surfacing the error.

A sibling `useRemoveInstitutionLogo` clears the column and deletes the storage object.

### 1.5 Upload UI — `src/components/admin/InstitutionLogoUploader.tsx`

Lives in [src/pages/admin/InstitutionsPage.tsx](../../../src/pages/admin/InstitutionsPage.tsx). For each institution row:

- Thumbnail (32×32 rounded) of current logo, or initials placeholder if `logo_url` is null.
- "Upload" / "Replace" / "Remove" button (single dropdown or three small buttons — visual decision in implementation).
- File picker accepts `image/png,image/jpeg,image/webp`.
- Helper text: "Square image recommended, ≥256×256, max 2 MB."
- The page itself is already super-admin-only (existing route guard); UI does not duplicate role checks.

### 1.6 RLS confirmation

`institutions` already has policies. Verify in implementation:

- SELECT: any authenticated user can read at least `id, name, logo_url` for their effective institution (and super admin reads all). Add `logo_url` to the projection if any existing policy is column-restricted; otherwise no change.
- UPDATE: super_admin-only. If the existing UPDATE policy is broader, no new policy needed; if narrower, add a super-admin policy. Don't relax existing rules.

## Phase 2 — Consumers

### 2.1 Sidebar / topbar branding

[src/components/layout/AppSidebar.tsx](../../../src/components/layout/AppSidebar.tsx) renders the institution name as text in the sidebar header. Modification:

- Call `useInstitutionLogo(effectiveInstitutionId)`.
- When `logoUrl` is non-null, render a 28–32 px rounded `<img>` to the left of the name.
- When null, current text-only header is preserved.
- The replacement is purely additive — no layout shifts to other rows.

No other chrome surface is in scope this round. (If grep during plan-writing surfaces a duplicate institution-name header elsewhere, the implementer should treat it as a drive-by — same hook, same fallback.)

### 2.2 Generate Student Report PDF

#### 2.2.1 Button

In [src/pages/school/StudentPerformancePage.tsx](../../../src/pages/school/StudentPerformancePage.tsx), top-right of the header (right side of the row that currently holds "Back to Dashboard"):

```tsx
<Button onClick={handleGenerate} disabled={!ready || isGenerating}>
  {isGenerating ? <Spinner /> : <FileText />}
  {isGenerating ? "Preparing report…" : "Generate Report"}
</Button>
```

`ready` is `true` when all of `useStudentPerformanceDetail`, `useStudentPassport`, `useUserBadges`, `useInstitutionLogo` have settled (no `isLoading`). `isGenerating` is local component state guarded around the async generator call.

#### 2.2.2 New module — `src/lib/pdf/`

```
src/lib/pdf/
  studentReport.ts       # entry point: generateStudentReport(input): Promise<void>
  pdfTheme.ts            # palette (#249ca2 primary, #fa920e accent), fonts, page margins, line heights
  pdfPrimitives.ts       # drawHeader, drawFooter, drawSectionTitle, drawKVRow, drawTable, drawProgressBar, ensureRoom
```

Module is pure: no Supabase, no React, no Query. The page hands it everything it needs.

#### 2.2.3 Generator signature

```ts
import type { StudentPerformanceDetail } from "@/hooks/useStudentPerformanceDetail";
import type { StudentPassportData } from "@/hooks/useStudentPassport";
import type { UserBadge } from "@/hooks/useBadges";

export async function generateStudentReport(input: {
  performance: StudentPerformanceDetail;
  passport: StudentPassportData | null;
  badges: UserBadge[];
  generatedBy: { name: string; role: string };
  schoolName: string;
  salciLogoDataUrl: string;        // pre-loaded from /Logo.png
  schoolLogoDataUrl: string | null; // pre-loaded from useInstitutionLogo, null if not set
}): Promise<void>;
```

The button's `onClick`:

1. Fetches `/Logo.png` once and caches the data URL in module-scope memo.
2. If `schoolLogoUrl` is non-null, fetches it as blob → data URL (one-shot, cached per session).
3. Calls `generateStudentReport({...})`.
4. The function builds the PDF and triggers `doc.save(filename)`.

The fetch-to-data-URL helper handles 404 / CORS / load failure by returning `null`, so a broken school-logo URL never blocks the PDF — header falls back to text.

#### 2.2.4 PDF structure

Layout: A4 portrait, 18 mm side margins, helvetica family.

**Page chrome (every page):**

- **Header:** SALCI logo top-left (≤14 mm tall), school logo top-right (≤14 mm tall, omitted if null), school name right-aligned immediately to the left of the school logo on the same baseline (or, when the school logo is null, occupying the top-right slot alone). Thin `#249ca2` accent rule at `y = headerBottom + 2`.
- **Footer:** "Confidential — for internal use" left, "Generated {date} • Page X of Y" right. Page count is back-filled in a final pass after all pages exist.

**Cover page (page 1):**

- Header chrome
- Big title: "Student Performance Report"
- Student card: name, class + section, student ID, email
- Generated-by line: "{generatedByName} ({role}) on {date}"

**Sections (auto-paginated):**

| # | Section | Content |
|---|---|---|
| 1 | Performance summary | KPI grid (drawn boxes, no charts): accuracy, exams taken, correct/attempted, avg time, efficiency. Best / lowest / last-change row beneath. |
| 2 | Subject performance | Table: subject, accuracy %, exams taken, attempted, correct. |
| 3 | Topic mastery | List of up to 50 topics, weakest first. Each row: topic name, mastery %, vector-drawn progress bar (rect + filled rect colored by bucket: emerald >80, blue 60–80, amber 40–60, rose <40), trend marker (`▲ improving` / `▼ declining` / `—`). Footer "…and N more" if truncated. |
| 4 | Recent exams | Table: exam title, date (`MMM d, yyyy`), accuracy %, score (`x/y`), rank or "—". |
| 5 | Performance trend | Table: exam #, exam title, student %, class avg %, topper %. Replaces the line chart on the dashboard. |
| 6 | Learning passport | KV grid: level, total points, exams taken, exams passed, pass rate %, current streak, longest streak, total study time. If passport is null: "Learning passport not available." |
| 7 | Academic history | Table: year, class, school, achievements (one row per record). Empty state: "No academic history recorded." |
| 8 | Subject capabilities | Table: subject, level, mastery %, total attempts, last activity date. |
| 9 | Badges earned | Table: name, tier, awarded date. Empty state: "No badges earned yet." |

#### 2.2.5 Filename

`salci-{slug}-report-{YYYY-MM-DD}.pdf`

`{slug}` = student name lowercased, non-alphanumerics → `-`, collapsed runs, trimmed (e.g., "Student1" → `student1`, "Harri Potter" → `harri-potter`).

## Behavior, Errors, Edge Cases

### Loading

- Generate Report button: disabled while any of the four queries is loading. Shows "Preparing report…" + spinner during the async logo-loading + jsPDF-build phase.
- Logo upload: standard upload progress; thumbnail updates optimistically on success.

### Errors (all routed through `toastError` per CLAUDE.md §19)

| Failure | Behavior |
|---|---|
| Logo upload validation (size/type) | Inline form error, no toast. |
| Storage upload fails | `toastError(e, { fallback: "Couldn't upload logo.", context: "uploadInstitutionLogo" })`. |
| `institutions.logo_url` UPDATE fails | Same channel; orphaned storage object deleted first. |
| `useInstitutionLogo` read fails | Returns `{ logoUrl: null }`, never throws — silent text fallback. |
| School logo URL 404s during PDF gen | Helper returns null, PDF header falls back to text. No toast. |
| PDF generation throws | `toastError(e, { fallback: "Couldn't generate the report.", context: "generateStudentReport" })`; button returns to idle. |

### Edge cases

- **Zero exams:** KPI section shows "No exams yet"; subject/topic/recent tables render their empty-state line; passport + badges + history still attempt to render.
- **No passport row:** section 6 prints "Learning passport not available", report still completes.
- **Long content:** topic mastery hard-capped at 50; tables auto-paginate via `ensureRoom(doc, neededHeight)` helper.
- **Non-ASCII names:** out of scope this round. Helvetica (Latin-1) is the only registered font. If a field contains non-ASCII, helvetica may render `?`. Acceptable for now; revisit if it becomes common.
- **Storage bucket missing:** migration creates it; if a deploy somehow predates the migration, upload fails clearly via `toastError`.

### Permissions

- `institutions.logo_url` SELECT: visible to any authenticated user who already reads the institution row.
- `institutions.logo_url` UPDATE: super_admin only.
- Storage bucket `institution-logos`: public READ, super_admin write.
- Generate Report button: visible to anyone who can already reach `StudentPerformancePage` (school_admin, coordinator, super_school_admin, super_admin via existing route guards). No new gating.

## Testing

**Manual (golden path):**

1. Sign in as super admin (`bhan@salci.in`). Open Institutions page. Upload a PNG logo for one institution. Confirm thumbnail updates.
2. Sign in as a school_admin of that institution. Confirm logo appears in the sidebar header.
3. Open a student's dashboard. Click Generate Report. Verify:
   - PDF downloads with filename `salci-{slug}-report-{date}.pdf`.
   - SALCI logo top-left, school logo top-right of every page.
   - All 9 sections present with student's actual data.
   - Footer reads "Page 1 of N", "Page 2 of N", … (back-filled correctly).
   - Open in Adobe / Chrome PDF viewer; Ctrl+F finds the student name and a known topic name (proves it's true vector text, not an image).
   - File size < 500 KB.
4. Repeat on an institution with no uploaded logo — confirm sidebar reverts to text-only and PDF header omits the school logo, no broken-image artifact.
5. Generate report for a brand-new student with zero exams — confirm clean empty-state lines, no crashes.

**Unit (light):** a focused test for `pdfPrimitives.drawTable` with 0 / 1 / 50 rows, asserting no throws and that the cursor advances. PDF binary itself is not snapshotted.

**No automated visual regression** — verification is "open the PDF and look" against the screenshots referenced in this spec.

## Implementation Order (for the plan)

1. Migration — `institutions.logo_url` + bucket policy verification.
2. Reader hook `useInstitutionLogo` (depends on schema).
3. Mutation hooks `useUploadInstitutionLogo` / `useRemoveInstitutionLogo`.
4. `InstitutionLogoUploader` component + wire into `InstitutionsPage`.
5. Sidebar consumer (small change, low risk).
6. `lib/pdf/pdfTheme.ts` + `lib/pdf/pdfPrimitives.ts` (no DOM, fully testable).
7. `lib/pdf/studentReport.ts` (the orchestrator).
8. Generate Report button on `StudentPerformancePage`.
9. Manual end-to-end pass.

Each step can land as its own commit; phases 1–5 are independently usable (institution-logo system) without phase 6+, which is a useful intermediate reviewable state.
