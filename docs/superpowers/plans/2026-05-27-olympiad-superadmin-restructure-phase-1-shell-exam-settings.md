# Olympiad Super-Admin Restructure — Phase 1: Shell + Exam Settings (class-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the Olympiad admin tab strip to two tabs (Schools default + Exam Settings), move Campaign into a header "Campaign Settings" sheet, and invert the Subjects catalog into class-first navigation (class = grade level) reusing the existing grade-level-keyed catalog.

**Architecture:** Pure-frontend phase (no migrations, no edge functions). `OlympiadAdminPage` drops to two tabs and gains a `primaryAction`. The Campaign tab's content moves into a `CampaignSettingsSheet` (MobileSheet) reusing the existing `CampaignSettingsForm` + history list. Exam Settings becomes `classes` → `classes/:gradeLevelId` → `classes/:gradeLevelId/subjects/:subjectId`, reusing the existing subject/topic/question/study-material data and the three sub-tab components (modified to filter to one grade via outlet context).

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, Supabase, shadcn/ui, react-router-dom v6.

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-superadmin-restructure-design.md](../specs/2026-05-27-olympiad-superadmin-restructure-design.md) (§3, §5).

**No test infrastructure** — verify each task via §5a: `npx tsc --noEmit` (exit 0), `npx eslint <touched paths>` (no new errors), `npx vite build` (exit 0). TDD does not apply.

---

## Verified facts (read before starting)

- `OlympiadAdminPage.tsx` drives tabs with `MobileTabs` props `value`, `onValueChange`, `options` (array of `{ value, label }`), `className`; navigation is `navigate(path)`.
- `PageHeader` props include `primaryAction?: { label; onClick?; icon?; destructive?; disabled?; menuItems? }`. A plain `onClick` primary renders a filled brand button. Use it for "Campaign Settings".
- `OlympiadCampaignTab.tsx` renders `<CampaignSettingsForm campaign={current} />` (current = campaign whose `campaign_year === new Date().getFullYear()`) + a history list of past campaigns with `<CampaignStatusPill status={c.status} />`, driven by `useOlympiadCampaigns()` from `@/hooks/olympiad/useOlympiadCampaign`. This content moves verbatim into the sheet.
- `OlympiadSubjectsTab.tsx` lists `useOlympiadSubjects()` rows via `<SubjectListRow subject classCount />`. `OlympiadSubject = { id, name, description, status, grade_level_ids: string[] }`.
- `OlympiadSubjectDetailPage.tsx` renders a NavLink sub-tab nav (Topics index / `questions` / `study-material`) + `<Outlet context={{ subject }} />`. The three sub-tabs read `useOutletContext<{ subject }>()` and render an Accordion grouped by every grade in `subject.grade_level_ids`, each grade resolved via a local `useGradeLevelMap` (`queryKey ["grade-levels","map"]`, selecting `id, grade_name, grade_number, display_order` where `is_active`).
- `SubjectEditorSheet` props are `{ open, onOpenChange, subject }`; its `useEffect` seeds the grade checkboxes from `subject.grade_level_ids`. `useUpsertOlympiadSubject` inserts when the subject id is empty/falsy. So a synthetic `subject` with `id: ""` and `grade_level_ids: [gradeLevelId]` opens create-mode with that grade pre-ticked.
- `App.tsx` uses `lazy()` component declarations and wraps `/admin/olympiad` in `<Suspense fallback={<p>Loading...</p>}>`. `Navigate` is already imported. **`/admin/olympiad/schools/:olySchoolId` is a STANDALONE route** — `OlympiadSchoolDetailPage` renders its own `PageShell`; nesting it under the tab-shell parent would double-wrap PageShell and render it below the tab strip. Leave that standalone route untouched.

---

## File Structure

- **Create** `src/components/olympiad/admin/CampaignSettingsSheet.tsx` — MobileSheet hosting the campaign form + past-campaign history.
- **Modify** `src/pages/admin/olympiad/OlympiadAdminPage.tsx` — two tabs (Schools default, Exam Settings), `primaryAction` → `CampaignSettingsSheet`, `resolveActive` rewrite.
- **Create** `src/hooks/olympiad/useOlympiadClasses.ts` — grade levels (3–10) + subject counts.
- **Create** `src/components/olympiad/admin/ClassListRow.tsx` — class (grade level) row.
- **Modify** `src/components/olympiad/admin/SubjectListRow.tsx` — optional `to` prop for class-scoped links.
- **Create** `src/pages/admin/olympiad/OlympiadClassDetailPage.tsx` — subjects for one grade + "Add subject".
- **Create** `src/pages/admin/olympiad/OlympiadClassSubjectPage.tsx` — sub-tab nav + `<Outlet context={{ subject, gradeLevelId }} />`.
- **Modify** `src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx`, `OlympiadQuestionsSubTab.tsx`, `OlympiadStudyMaterialSubTab.tsx` — accept optional `gradeLevelId` from outlet context; scope to that single grade; keep all-grades accordion when absent.
- **Create** `src/pages/admin/olympiad/OlympiadClassesTab.tsx` — class list + "Add class" grade picker.
- **Modify** `src/App.tsx` — index → `<Navigate to="schools" replace />`; add `classes` routes; remove old campaign-index + `subjects` routes; keep standalone `schools/:olySchoolId`.
- **Delete** `src/pages/admin/olympiad/OlympiadCampaignTab.tsx`, `OlympiadSubjectsTab.tsx`, `OlympiadSubjectDetailPage.tsx`.

**Build order:** sheet → shell → hook → row → SubjectListRow prop → class pages → sub-tab scoping → classes tab → routes → delete dead files. Sub-tabs stay backward-compatible at every step so nothing breaks mid-flight.

---

## Task 1: `CampaignSettingsSheet`

**Files:** Create `src/components/olympiad/admin/CampaignSettingsSheet.tsx`

- [ ] **Step 1: Create the sheet** (moves `OlympiadCampaignTab`'s body into a `MobileSheet`).

```tsx
import { Loader2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useOlympiadCampaigns } from "@/hooks/olympiad/useOlympiadCampaign";
import { CampaignSettingsForm } from "@/components/olympiad/admin/CampaignSettingsForm";
import { CampaignStatusPill } from "@/components/olympiad/admin/CampaignStatusPill";

type Props = { open: boolean; onOpenChange: (o: boolean) => void };

export function CampaignSettingsSheet({ open, onOpenChange }: Props) {
  const { data: campaigns, isLoading } = useOlympiadCampaigns();
  const currentYear = new Date().getFullYear();
  const current = campaigns?.find((c) => c.campaign_year === currentYear) ?? null;
  const history = (campaigns ?? []).filter((c) => c.campaign_year !== currentYear);

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Campaign settings"
      subtitle="Pricing, exam config, and historical campaigns"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      ) : (
        <div className="space-y-6">
          <CampaignSettingsForm campaign={current} />
          {history.length > 0 && (
            <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
              <header>
                <p className="eyebrow">History</p>
                <h3 className="text-base font-semibold text-ink-900">Past campaigns</h3>
              </header>
              <ul className="divide-y divide-surface-stroke">
                {history.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink-900 font-medium">{c.campaign_year} Olympiad</span>
                    <CampaignStatusPill status={c.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </MobileSheet>
  );
}
```

> If `MobileSheet`'s prop names differ, read `src/components/shared/sheets/MobileSheet.tsx` and match (`title`/`subtitle` are the expected names).

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/components/olympiad/admin/CampaignSettingsSheet.tsx`.
- [ ] **Step 3: Commit** — `git add src/components/olympiad/admin/CampaignSettingsSheet.tsx && git commit -m "feat(olympiad): CampaignSettingsSheet wrapping campaign form + history"`

## Task 2: Shell — two tabs + Campaign Settings button

**Files:** Modify `src/pages/admin/olympiad/OlympiadAdminPage.tsx`

- [ ] **Step 1: Rewrite the shell.**

```tsx
import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Medal, Settings } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { CampaignSettingsSheet } from "@/components/olympiad/admin/CampaignSettingsSheet";

const TABS = [
  { value: "schools", label: "Schools",       path: "/admin/olympiad/schools" },
  { value: "classes", label: "Exam Settings", path: "/admin/olympiad/classes" },
] as const;

type TabValue = typeof TABS[number]["value"];

function resolveActive(pathname: string): TabValue {
  if (pathname.startsWith("/admin/olympiad/classes")) return "classes";
  return "schools";
}

export default function OlympiadAdminPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = resolveActive(pathname);
  const [campaignOpen, setCampaignOpen] = useState(false);

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle="Participating schools and exam settings"
        icon={<Medal className="h-6 w-6" />}
        primaryAction={{
          label: "Campaign Settings",
          icon: <Settings className="h-4 w-4" />,
          onClick: () => setCampaignOpen(true),
        }}
      />
      <MobileTabs
        value={active}
        onValueChange={(v) => {
          const tab = TABS.find((t) => t.value === v);
          if (tab) navigate(tab.path);
        }}
        options={TABS.map((t) => ({ value: t.value, label: t.label }))}
        className="mb-4"
      />
      <Outlet />
      <CampaignSettingsSheet open={campaignOpen} onOpenChange={setCampaignOpen} />
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadAdminPage.tsx`. (Tab nav to `/classes` 404s until Task 9/10 — acceptable mid-phase.)
- [ ] **Step 3: Commit** — `git add src/pages/admin/olympiad/OlympiadAdminPage.tsx && git commit -m "feat(olympiad): two-tab shell (Schools default + Exam Settings) + Campaign Settings button"`

## Task 3: `useOlympiadClasses` hook

**Files:** Create `src/hooks/olympiad/useOlympiadClasses.ts`

A "class" = a grade level. Returns every applicable grade (3–10) + its subject count via `oly_subject_classes`. The mapping set is tiny (≤ ~10 grades × subjects), far under the 1000-row cap.

- [ ] **Step 1: Create the hook.**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OlympiadClass {
  grade_level_id: string;
  grade_name: string;
  grade_number: number;
  subject_count: number;
}

export function useOlympiadClasses() {
  return useQuery({
    queryKey: ["olympiad", "classes"],
    queryFn: async (): Promise<OlympiadClass[]> => {
      const { data: grades, error: gErr } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (gErr) throw gErr;

      const applicable = (grades ?? []).filter((g) => {
        const n = Number(g.grade_number);
        return Number.isFinite(n) && n >= 3 && n <= 10;
      });
      if (applicable.length === 0) return [];

      const { data: links, error: lErr } = await supabase
        .from("oly_subject_classes")
        .select("grade_level_id")
        .in("grade_level_id", applicable.map((g) => g.id));
      if (lErr) throw lErr;

      const counts = new Map<string, number>();
      for (const l of links ?? []) counts.set(l.grade_level_id, (counts.get(l.grade_level_id) ?? 0) + 1);

      return applicable
        .map((g) => ({
          grade_level_id: g.id,
          grade_name: g.grade_name,
          grade_number: Number(g.grade_number),
          subject_count: counts.get(g.id) ?? 0,
        }))
        .sort((a, b) => a.grade_number - b.grade_number);
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/hooks/olympiad/useOlympiadClasses.ts`.
- [ ] **Step 3: Commit** — `git add src/hooks/olympiad/useOlympiadClasses.ts && git commit -m "feat(olympiad): useOlympiadClasses hook (grade levels + subject counts)"`

## Task 4: `ClassListRow`

**Files:** Create `src/components/olympiad/admin/ClassListRow.tsx`

- [ ] **Step 1: Create the row.**

```tsx
import { ChevronRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { type OlympiadClass } from "@/hooks/olympiad/useOlympiadClasses";

export function ClassListRow({ klass }: { klass: OlympiadClass }) {
  return (
    <NavLink
      to={`/admin/olympiad/classes/${klass.grade_level_id}`}
      className="flex items-center gap-3 px-4 py-3 surface-card frosted-shadow rounded-card hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-900 truncate">{klass.grade_name}</p>
        <p className="text-xs text-ink-500 mt-0.5">
          {klass.subject_count} subject{klass.subject_count === 1 ? "" : "s"}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
    </NavLink>
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/components/olympiad/admin/ClassListRow.tsx`.
- [ ] **Step 3: Commit** — `git add src/components/olympiad/admin/ClassListRow.tsx && git commit -m "feat(olympiad): ClassListRow"`

## Task 5: `SubjectListRow` optional `to` prop

**Files:** Modify `src/components/olympiad/admin/SubjectListRow.tsx`

- [ ] **Step 1:** Read the file. Add an optional `to?: string` prop. Where the row links to `/admin/olympiad/subjects/:id`, use `to ?? \`/admin/olympiad/subjects/${subject.id}\``. Keep existing props (`subject`, `classCount`, any `onEdit`) intact.
- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/components/olympiad/admin/SubjectListRow.tsx`.
- [ ] **Step 3: Commit** — `git add src/components/olympiad/admin/SubjectListRow.tsx && git commit -m "feat(olympiad): SubjectListRow optional 'to' prop for class-scoped links"`

## Task 6: `OlympiadClassDetailPage` (subjects for a grade + Add subject)

**Files:** Create `src/pages/admin/olympiad/OlympiadClassDetailPage.tsx`

- [ ] **Step 1: Create the page.** Filters `useOlympiadSubjects()` to subjects whose `grade_level_ids` include this grade. "Add subject" opens `SubjectEditorSheet` seeded with a create-mode synthetic subject pre-ticking this grade. Grade name comes from `useOlympiadClasses()`.

```tsx
import { useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Medal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadSubjects, type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { SubjectListRow } from "@/components/olympiad/admin/SubjectListRow";
import { SubjectEditorSheet } from "@/components/olympiad/admin/SubjectEditorSheet";

export default function OlympiadClassDetailPage() {
  const { gradeLevelId } = useParams();
  const { data: subjects, isLoading } = useOlympiadSubjects();
  const { data: classes } = useOlympiadClasses();
  const [editorOpen, setEditorOpen] = useState(false);

  const klass = classes?.find((c) => c.grade_level_id === gradeLevelId);
  const classSubjects = useMemo(
    () => (subjects ?? []).filter((s) => (gradeLevelId ? s.grade_level_ids.includes(gradeLevelId) : false)),
    [subjects, gradeLevelId],
  );

  // Create-mode seed with this grade pre-ticked (id:"" => insert).
  const seedSubject: OlympiadSubject = {
    id: "",
    name: "",
    description: null,
    status: "active",
    grade_level_ids: gradeLevelId ? [gradeLevelId] : [],
  };

  return (
    <div className="space-y-4 py-4">
      <NavLink to="/admin/olympiad/classes" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" />
        All classes
      </NavLink>

      <div className="flex items-center justify-between gap-3">
        <header className="min-w-0">
          <p className="eyebrow">Class</p>
          <h2 className="text-xl font-semibold text-ink-900 truncate">{klass?.grade_name ?? "Class"}</h2>
        </header>
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add subject
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : classSubjects.length === 0 ? (
        <EmptyState
          icon={<Medal className="h-7 w-7" />}
          title="No subjects for this class yet"
          description="Add a subject to start building this class's question bank."
          action={{ label: "Add subject", onClick: () => setEditorOpen(true), icon: <Plus className="h-4 w-4" /> }}
        />
      ) : (
        <div className="space-y-2">
          {classSubjects.map((s) => (
            <SubjectListRow
              key={s.id}
              subject={s}
              classCount={s.grade_level_ids.length}
              to={`/admin/olympiad/classes/${gradeLevelId}/subjects/${s.id}`}
            />
          ))}
        </div>
      )}

      <SubjectEditorSheet open={editorOpen} onOpenChange={setEditorOpen} subject={seedSubject} />
    </div>
  );
}
```

> If `SubjectEditorSheet`'s `subject` prop type rejects the synthetic shape, read its prop type and pass a matching object — it only needs `id`, `name`, `description`, `status`, `grade_level_ids` to seed.

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadClassDetailPage.tsx`.
- [ ] **Step 3: Commit** — `git add src/pages/admin/olympiad/OlympiadClassDetailPage.tsx && git commit -m "feat(olympiad): OlympiadClassDetailPage (subjects for a grade + add subject)"`

## Task 7: `OlympiadClassSubjectPage` (sub-tab nav + context)

**Files:** Create `src/pages/admin/olympiad/OlympiadClassSubjectPage.tsx`

- [ ] **Step 1: Create the page** (mirrors `OlympiadSubjectDetailPage` with class-scoped back link + `{ subject, gradeLevelId }` context).

```tsx
import { NavLink, Outlet, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";

const SUB_TABS = [
  { label: "Topics",         to: ""               },
  { label: "Questions",      to: "questions"      },
  { label: "Study material", to: "study-material" },
] as const;

export default function OlympiadClassSubjectPage() {
  const { gradeLevelId, subjectId } = useParams();
  const { data: subjects, isLoading } = useOlympiadSubjects();
  const subject = subjects?.find((s) => s.id === subjectId);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (!subject) {
    return (
      <div className="py-6 text-sm text-ink-600">
        Subject not found.{" "}
        <NavLink to={`/admin/olympiad/classes/${gradeLevelId}`} className="underline">Back to class</NavLink>.
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      <NavLink to={`/admin/olympiad/classes/${gradeLevelId}`} className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" />
        Back to class
      </NavLink>

      <header>
        <p className="eyebrow">Subject</p>
        <h2 className="text-xl font-semibold text-ink-900">{subject.name}</h2>
        {subject.description && <p className="text-sm text-ink-600 mt-1">{subject.description}</p>}
      </header>

      <nav className="-mx-4 px-4 flex gap-2 overflow-x-auto scrollbar-hide">
        {SUB_TABS.map((t) => (
          <NavLink
            key={t.label}
            end={t.to === ""}
            to={t.to}
            className={({ isActive }) =>
              `inline-flex items-center px-3.5 py-1.5 rounded-full whitespace-nowrap text-xs font-medium transition-colors ${
                isActive ? "bg-brand-primary text-white" : "bg-surface-card text-ink-700 hover:bg-surface-card/80"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ subject, gradeLevelId }} />
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadClassSubjectPage.tsx`.
- [ ] **Step 3: Commit** — `git add src/pages/admin/olympiad/OlympiadClassSubjectPage.tsx && git commit -m "feat(olympiad): OlympiadClassSubjectPage (sub-tab nav + grade context)"`

## Task 8: Filter the three sub-tabs to a single grade

**Files:** Modify `src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx`, `OlympiadQuestionsSubTab.tsx`, `OlympiadStudyMaterialSubTab.tsx`

Each currently reads `useOutletContext<{ subject }>()` and renders an accordion over `subject.grade_level_ids` (resolved via local `useGradeLevelMap`). Make them grade-aware, backward-compatible.

- [ ] **Step 1: For EACH file:**
  1. Change the context type to `useOutletContext<{ subject: OlympiadSubject; gradeLevelId?: string }>()`.
  2. Compute `const applicable = (grades ?? []).filter((g) => gradeLevelId ? g.id === gradeLevelId : subject.grade_level_ids.includes(g.id));` and iterate `applicable` everywhere the code currently iterates the grade list.
  3. When `gradeLevelId` is set, `applicable` is a 1-element array — render its single grade's section directly (skip the Accordion wrapper) so the class-first view shows just that grade; keep the Accordion for the all-grades (absent) case. Iterating the 1-element array through the existing Accordion is an acceptable minimal-diff fallback if extracting a single-grade branch is awkward.
  4. Do not change the per-grade fetch/add logic — it already keys off `(subject_id, grade_level_id)`.

  Read each file first; the existing per-grade body (topic list + add, question table + add/import, materials list + upload) is reused unchanged.

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx src/pages/admin/olympiad/OlympiadQuestionsSubTab.tsx src/pages/admin/olympiad/OlympiadStudyMaterialSubTab.tsx`.
- [ ] **Step 3: Commit** — `git add src/pages/admin/olympiad/OlympiadTopicsSubTab.tsx src/pages/admin/olympiad/OlympiadQuestionsSubTab.tsx src/pages/admin/olympiad/OlympiadStudyMaterialSubTab.tsx && git commit -m "feat(olympiad): sub-tabs filter to a single grade via outlet context"`

## Task 9: `OlympiadClassesTab` (class list + Add class)

**Files:** Create `src/pages/admin/olympiad/OlympiadClassesTab.tsx`

Lists classes with `subject_count > 0`. "Add class" opens a shadcn `Dialog` (intentional: a one-field grade picker, not a multi-field form) offering grades with `subject_count === 0`; selecting one navigates to its empty class profile.

- [ ] **Step 1: Create the tab.**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { ClassListRow } from "@/components/olympiad/admin/ClassListRow";

export default function OlympiadClassesTab() {
  const navigate = useNavigate();
  const { data: classes, isLoading } = useOlympiadClasses();
  const [pickerOpen, setPickerOpen] = useState(false);

  const configured = (classes ?? []).filter((c) => c.subject_count > 0);
  const available = (classes ?? []).filter((c) => c.subject_count === 0);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Classes</p>
        <Button size="sm" onClick={() => setPickerOpen(true)} disabled={available.length === 0}>
          <Plus className="h-4 w-4 mr-1" />
          Add class
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : configured.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-7 w-7" />}
          title="No classes configured"
          description="Add a class to start building its subjects and question bank."
          action={available.length > 0 ? { label: "Add class", onClick: () => setPickerOpen(true), icon: <Plus className="h-4 w-4" /> } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {configured.map((c) => <ClassListRow key={c.grade_level_id} klass={c} />)}
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a class</DialogTitle>
            <DialogDescription>Pick a grade level that has no Olympiad subjects yet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {available.length === 0 ? (
              <p className="text-sm text-ink-600">All grade levels already have classes.</p>
            ) : (
              available.map((c) => (
                <button
                  key={c.grade_level_id}
                  onClick={() => { setPickerOpen(false); navigate(`/admin/olympiad/classes/${c.grade_level_id}`); }}
                  className="w-full text-left flex items-center gap-3 rounded-md border border-surface-stroke p-3 hover:bg-surface-card/80 transition-colors"
                >
                  <GraduationCap className="h-4 w-4 text-brand-primary" />
                  <span className="text-sm font-medium text-ink-900">{c.grade_name}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadClassesTab.tsx`.
- [ ] **Step 3: Commit** — `git add src/pages/admin/olympiad/OlympiadClassesTab.tsx && git commit -m "feat(olympiad): OlympiadClassesTab (class list + add-class grade picker)"`

## Task 10: Routes

**Files:** Modify `src/App.tsx`

- [ ] **Step 1:** Add `lazy()` declarations near the other Olympiad ones; remove the deleted ones (`OlympiadCampaignTab`, `OlympiadSubjectsTab`, `OlympiadSubjectDetailPage`):

```tsx
const OlympiadClassesTab = lazy(() => import("@/pages/admin/olympiad/OlympiadClassesTab"));
const OlympiadClassDetailPage = lazy(() => import("@/pages/admin/olympiad/OlympiadClassDetailPage"));
const OlympiadClassSubjectPage = lazy(() => import("@/pages/admin/olympiad/OlympiadClassSubjectPage"));
```

- [ ] **Step 2:** In the `/admin/olympiad` parent route block, set the index redirect + class routes (match the EXISTING `ProtectedRoute`/`Suspense` parent wrapper exactly; only change children + index):

```tsx
<Route index element={<Navigate to="schools" replace />} />
<Route path="schools" element={<OlympiadSchoolsTab />} />
<Route path="classes" element={<OlympiadClassesTab />} />
<Route path="classes/:gradeLevelId" element={<OlympiadClassDetailPage />} />
<Route path="classes/:gradeLevelId/subjects/:subjectId" element={<OlympiadClassSubjectPage />}>
  <Route index element={<OlympiadTopicsSubTab />} />
  <Route path="questions" element={<OlympiadQuestionsSubTab />} />
  <Route path="study-material" element={<OlympiadStudyMaterialSubTab />} />
</Route>
```

Remove the old index (campaign), `subjects`, and `subjects/:subjectId` routes. **Do NOT touch the standalone `/admin/olympiad/schools/:olySchoolId` route** — it stays separate (its own PageShell).

- [ ] **Step 3: Verify** — `npx tsc --noEmit`, `npx eslint src/App.tsx`.
- [ ] **Step 4: Commit** — `git add src/App.tsx && git commit -m "feat(olympiad): route shell to classes-first + schools default; drop subjects routes"`

## Task 11: Delete retired pages + full build

**Files:** Delete `OlympiadCampaignTab.tsx`, `OlympiadSubjectsTab.tsx`, `OlympiadSubjectDetailPage.tsx`

- [ ] **Step 1:** `git rm src/pages/admin/olympiad/OlympiadCampaignTab.tsx src/pages/admin/olympiad/OlympiadSubjectsTab.tsx src/pages/admin/olympiad/OlympiadSubjectDetailPage.tsx`
- [ ] **Step 2:** Grep for stragglers: `grep -rn "OlympiadSubjectsTab\|OlympiadSubjectDetailPage\|OlympiadCampaignTab" src` — remove any remaining imports.
- [ ] **Step 3: Full §5a verify** — `npx tsc --noEmit` (exit 0), `npx eslint "src/pages/admin/olympiad/**" "src/components/olympiad/admin/**" "src/hooks/olympiad/**" src/App.tsx` (clean), `npx vite build` (exit 0).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore(olympiad): remove retired campaign/subjects pages; phase 1 build green"`

## Task 12: Manual smoke

- [ ] `npm run dev`, sign in as super_admin, open `/admin/olympiad`:
  - Lands on Schools (default). Tab strip shows only Schools + Exam Settings.
  - "Campaign Settings" opens the sheet (form + past campaigns).
  - Exam Settings → class list (grades with subjects). "Add class" offers empty grades; picking one opens an empty class profile.
  - Open a class → its subjects. "Add subject" pre-ticks this grade.
  - Open a subject → Topics/Questions/Study material show ONLY this grade; add flows still work.
- [ ] At 375px: no horizontal scroll, tab strip scroll-snaps; dark-mode toggle flips all surfaces.

---

## Self-review

- **Spec coverage:** §3 (Tasks 1,2,10), §5.1 (Tasks 3,4,9), §5.2 (Tasks 5,6), §5.3 (Tasks 7,8), retirement (Task 11). Covered.
- **Placeholders:** none — complete code for new units; precise edits for modifications.
- **Consistency:** route/component/hook names match across tasks. `OlympiadSchoolsTab` + standalone `schools/:olySchoolId` left intact for Phases 2–3.
- **Gotcha guarded:** standalone detail route not nested (own PageShell); `Navigate` already imported; create-mode seed via `id:""`.
