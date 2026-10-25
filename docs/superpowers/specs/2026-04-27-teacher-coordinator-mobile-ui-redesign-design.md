# Teacher + Coordinator Mobile UI Redesign — Design Spec

**Date:** 2026-04-27
**Author:** Tushar (with Claude)
**Status:** Awaiting user review
**Scope:** Teacher and Coordinator views — mobile-first UI/UX overhaul. Pure presentation work. No changes to hooks, queries, mutations, routing, or business logic.

---

## 1. Context

The user shared 22 mobile screenshots taken from real devices (iPhone Safari). Across the teacher and coordinator surfaces, the UI exhibits the same broken patterns repeatedly:

- Header action buttons clip primary CTAs ("+ Add Teacher" → "Add Teache...", "+ Assign Task" → "+ Assi...")
- Bright full-bleed colored stat cards consume the entire fold before any data shows; on the Tasks page (Image 6), 5 stacked cards take ~700px of vertical scroll
- Horizontal page overflow forces the page wider than the viewport (Tasks Image 6, Task Detail Image 8 — content cut off on the LEFT edge)
- Tab strips fail mobile in three different ways: wrap to multiple rows (6-tab Tasks strip), clip the last tab ("No..." in Student List), or render the active pill floating above the inactive row
- The `+` FAB lands in the wrong place on multiple pages (mid-viewport on Image 21, overlapping inline CTAs on Image 16, colliding with tab strips on Image 3/10)
- Filter rows render three full-width dropdowns stacked vertically (Question Bank, Exams) — eats half the screen
- A `<input type="time">` field renders invisible text on iOS Safari in the Schedule & Publish sheet, blocking exam publishing
- Empty states are bland one-liners that lose visual hierarchy to the loud stat cards above them

The user has chosen the **CoachPro dashboard** (desktop reference) and a **mobile finance dashboard** (mobile reference) as the visual targets. Same design tokens used across both breakpoints; layout adapts.

## 2. Goals & non-goals

**Goals**

- Single mobile-first design system applied uniformly across teacher + coordinator pages
- Eliminate every issue circled in the 22 source screenshots
- Cohesive visual language: gradient page backdrop, frosted cards, neutral surfaces with brand-tinted accents, generous whitespace
- Zero changes to data flow, business logic, hooks, queries, mutations, props, or routes
- Production-clean output (TypeScript zero-error, ESLint zero-error, Vite build exit 0 on all touched files per CLAUDE.md §5a)

**Non-goals**

- Student-facing pages (out of scope for this round)
- Admin / super-admin / school-admin pages (out of scope; some shared components will benefit anyway because they're cross-role)
- Backend, edge function, schema, or RLS changes
- New features or new flows
- Component-library replacement (we keep shadcn/ui — we extend it with our own shared primitives)

## 3. Design tokens

Added as CSS variables in [src/index.css](../../../src/index.css), exposed through Tailwind via [tailwind.config.js](../../../tailwind.config.js).

```
--brand-primary:    #249ca2   /* teal — primary actions, active states, hero gradient base */
--brand-secondary:  #6f5ba2   /* muted violet — pairs with teal in gradient, secondary accents */
--brand-accent:     #fa920e   /* warm orange — sparingly: highlights, badges, accents only */

--surface-base:     hsl(220 25% 98%)        /* near-white page floor under the gradient */
--surface-card:     hsl(0 0% 100% / 0.85)   /* frosted card body */
--surface-stroke:   hsl(220 15% 92%)        /* hairline borders */

--surface-gradient:                          /* universal page backdrop */
  radial-gradient(1200px 800px at 0% 0%,    rgba(36,156,162,0.12), transparent 60%),
  radial-gradient(1000px 700px at 100% 0%,  rgba(111,91,162,0.10), transparent 60%),
  linear-gradient(180deg, hsl(220 25% 98%), hsl(220 25% 99%));
```

**Type scale** (Inter, already in the project):

- Display 28/34 — page title (`Tasks`, `Reports & Analytics`); 22/28 on `<sm` viewports
- H2 20/28 — section headers (`Students List`, `Custom Questions`)
- Body 15/22 — default reading
- Meta 13/18 — labels, helpers, table cells
- Micro 12/16 uppercase tracking-wide — eyebrow labels (`WORK`, `GROWTH`)

**Spacing:** Tailwind 4 / 8 / 12 / 16 / 24 only (per CLAUDE.md §UI rules). Card padding `p-5` mobile, `p-6` desktop. Section gap `space-y-5` mobile, `space-y-8` desktop. Page side padding `px-4` mobile, `px-8` desktop.

**Radii:** `rounded-2xl` cards/tiles, `rounded-3xl` hero, `rounded-full` pills/avatars/FAB, `rounded-xl` inputs.

**Shadows:** `shadow-[0_2px_8px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.04)]` — soft, layered, never harsh black drops.

## 4. PageShell

The wrapper around every authenticated page.

- Full viewport `min-h-[100dvh]`, `--surface-gradient` as `background` with `background-attachment: fixed` (gradient stays anchored on scroll)
- Top app bar (existing hamburger / search / bell / avatar header) restyled to sit cleanly on the gradient: `backdrop-blur-sm` + `bg-white/70`, no hard border, soft 1px hairline below
- Content region: `max-w-7xl mx-auto`, side padding scales with breakpoint, vertical scroll only — `overflow-x-hidden` on the shell to lock horizontal at the root (kills the Tasks-page overflow class of bug)
- Safe-area insets baked in: `pb-[max(env(safe-area-inset-bottom),16px)]`, `pt-[env(safe-area-inset-top)]`
- Renders a single bottom-right slot for `MobileFab` that pages can fill via a context or render-prop

**File:** `src/components/shared/page/PageShell.tsx`

## 5. Primitives

All primitives live under `src/components/shared/{page,surfaces,nav,sheets}/`. Re-exported from `src/components/shared/index.ts` for clean imports.

### 5.1 PageHeader

Replacement for every page's title block. Lives directly under the top app bar.

**Structure:**

```
[ Icon disc ] Title                                   [Primary CTA] [Kebab •••]
              Subtitle (1 line, truncates)
```

- Icon disc 40×40 `rounded-2xl`, soft pastel tint background (brand at 10% opacity), brand-colored 18px icon. Optional.
- Title: Display 28/34, `slate-900`, `font-semibold`. Drops to 22/28 on mobile.
- Subtitle: Body 15/22, `slate-500`, max 2 lines.
- Right cluster floats right on desktop; on mobile narrower than 480px the cluster stacks below subtitle.
- No card wrapper — sits directly on the gradient.

**Props:**

```ts
{
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  primaryAction?: { label: string; onClick(): void; icon?: ReactNode };
  secondaryActions?: { label: string; onClick(): void; icon?: ReactNode; destructive?: boolean }[];
}
```

### 5.2 ActionMenu (logic, not standalone)

Decides where each action renders based on viewport + count:

| Viewport | secondaryActions | Render |
|---|---|---|
| Desktop (≥ 1024px) | any | All inline + primary CTA solid |
| Tablet (640–1023px) | ≤ 2 | All inline |
| Tablet | ≥ 3 | First inline + kebab for rest |
| Mobile (< 640px) | 0 | Just primary CTA |
| Mobile | ≥ 1 | Primary CTA + kebab dropdown for ALL secondary |

Kebab uses shadcn `DropdownMenu`. Destructive items: rose-600 text + leading icon.

### 5.3 MobileFab

The floating "+" button. Single source of truth for the FAB pattern.

- 56×56 circle, solid `#249ca2`, white 24px icon
- Soft brand-glow shadow `shadow-[0_8px_24px_rgba(36,156,162,0.35)]`
- Pressed: scale to 0.94, `transition-transform`
- Hidden on `lg:` breakpoints and up (mobile + tablet only)
- Pinned `fixed bottom-6 right-6` plus safe-area: `bottom-[max(env(safe-area-inset-bottom),24px)]`
- Z-index `z-40` (above content, below dialogs)
- **Auto-hide rule:** when an element with `data-sticky-bottom` enters the bottom of the viewport, FAB slides out (`translate-y-24 opacity-0`). Detected via `IntersectionObserver`.
- **Empty-state collision:** page can pass `hideFabWhenEmpty` so the FAB disappears when an inline empty-state CTA is the only thing on screen (fixes the Image 16 double-CTA collision).

**Props:**

```ts
{ label: string; icon?: ReactNode; onClick(): void; hideWhen?: boolean }
```

### 5.4 StatTile

Replaces the loud full-bleed colored cards on Teachers / Tasks / Students / Reports / Question Bank / Syllabus.

**Visual:** white frosted card, icon disc top-left, value (Display 28), label (Meta 13/18). Optional trailing delta indicator.

**`tone` prop** drives only the icon-disc tint (not the whole card):

| tone | icon bg | icon color |
|---|---|---|
| `teal` | `bg-[#249ca2]/10` | `text-[#249ca2]` |
| `violet` | `bg-[#6f5ba2]/10` | `text-[#6f5ba2]` |
| `peach` | `bg-[#fa920e]/10` | `text-[#fa920e]` |
| `mint` | `bg-emerald-500/10` | `text-emerald-600` |
| `sky` | `bg-sky-500/10` | `text-sky-600` |
| `rose` | `bg-rose-500/10` | `text-rose-600` |

**`StatTileGrid`** layout helper:

- Mobile: `grid grid-cols-2 gap-3` always
- Desktop: 4-up = `grid-cols-4 gap-4`; 3-up = `grid-cols-3`

### 5.5 HeroSummaryCard

Used on **only** the role dashboards (Teacher Dashboard, Coordinator Dashboard). Inner pages do not use it.

- Background `linear-gradient from-[#249ca2] via-[#2bb3b8] to-[#6f5ba2]`
- Decorative floating circles top-right at 8% white opacity (matches mobile finance reference's credit-card flourish)
- White text throughout, `rounded-3xl`, `p-6`, brand-tinted shadow
- Content: top label ("Welcome back, Tushar 👋"), big metric, descriptor, delta + "View all →" link

### 5.6 FeatureTile

The WORK / GROWTH navigation grid on the role dashboards.

- Same frosted card as StatTile
- 44×44 icon disc top-left, `rounded-xl`, brand-tinted
- Title H2 18/24 + 2-line subtitle Meta 13/18
- Whole card is a `<Link>` (full-card touch target)
- Hover: `shadow-md`; Active: `scale-[0.98]` 150ms transition
- Layout: section eyebrow Micro 12 uppercase tracking-wide `slate-400`, then `grid grid-cols-2 gap-3`

### 5.7 ListRow

Replaces all the bespoke list-on-mobile + table-on-mobile patterns.

- White card, `rounded-2xl`, `p-4`
- Avatar/icon: 40×40, `rounded-xl` for content / `rounded-full` for people
- Title 15/22 font-medium, subtitle 13/18 slate-500
- Trailing slot: chevron / amount text / inline action button
- Optional second row for inline actions ("Mark as Done", "Pay Now" — matches mobile reference's transaction pattern)

### 5.8 EmptyState

Replaces the bland "No X yet" one-liners.

- 64×64 icon disc, pastel tint, brand-colored icon
- H2 20/28 heading, Meta 13/18 helper (max 2 lines, max 280px wide)
- Optional inline CTA — solid teal, `rounded-xl`

**`variant` prop:**

- `noResults` → magnifier, "No matches" / "Try adjusting your filters"
- `noData` → category-specific icon, "No X yet" / "Add Y to see them here"
- `error` → alert icon + Retry button

### 5.9 MobileSheet

Bottom sheet for forms, multi-field flows, detail views on mobile.

- Built on shadcn `Sheet` (NOT `Dialog` — avoids the project's auto-wrap-in-ScrollArea fork; per [.claude/skills/ui-invariants/SKILL.md](../../../.claude/skills/ui-invariants/SKILL.md))
- Slides up from bottom, 4×40px grab handle at the top
- `rounded-t-3xl`, white frosted body, soft top-edge shadow
- **Three regions:** sticky header (icon + title + close), scrollable body (`overflow-y-auto overscroll-contain`), sticky footer (primary right + ghost cancel left)
- Max height `max-h-[90dvh]`; min content-driven, never less than 50% viewport
- Backdrop `bg-slate-900/40 backdrop-blur-sm`
- Drag-to-dismiss past 25% of sheet height
- Safe-area inset bottom padding on the footer

**Props:**

```ts
{
  open: boolean; onOpenChange: (v: boolean) => void;
  title: string; subtitle?: string; icon?: ReactNode;
  primaryAction?: { label: string; onClick(): void; loading?: boolean; disabled?: boolean };
  secondaryAction?: { label: string; onClick(): void };
  children: ReactNode;
}
```

### 5.10 MobileTabs

Single horizontal scroll-snap row of pill tabs. Same component for any tab count from 2 to 10+.

- `overflow-x-auto`, `snap-x snap-mandatory`, `scrollbar-hide`
- Each pill: `rounded-full px-4 py-2 whitespace-nowrap snap-start`, min 40px height
- Active: solid `#249ca2` fill + white text + soft teal glow
- Inactive: transparent bg, `slate-600` text, hover `bg-slate-100`
- Optional count badge inside the pill
- 24px linear-gradient mask on left/right edges (overflow affordance)
- Auto `scrollIntoView({ inline: "center" })` on the active pill on mount + value change

**`density` prop:**

- `default` (40px) — top-level tabs
- `compact` (32px) — nested sub-tabs

**Props:**

```ts
{
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string; count?: number; icon?: ReactNode }[];
  density?: "default" | "compact";
}
```

Desktop (≥ 1024px) keeps shadcn `Tabs` — they work fine at width.

### 5.11 FilterRow

For pages with **≤ 2 filters**.

- Horizontal flex `gap-2`, wraps only if it must
- Each filter: shadcn `Select` styled as `rounded-full` chip — `bg-white/85 border border-slate-200 px-4 py-2`
- Non-default value → teal hairline border + `text-[#249ca2]` (signals "this is filtering")
- "Clear all" ghost button appears at the end when ≥ 1 filter is non-default
- Sticks under the app bar (`sticky top-[app-bar-height]`) on mobile

### 5.12 FilterSheet

For pages with **≥ 3 filters**.

- Inline `FilterRow` shows the most-used filter (e.g. "All Classes")
- A single `Filters` button with active count opens a `MobileSheet` on mobile (popover on desktop)
- Sheet body: each filter rendered full-width (Select / RadioGroup / Switch), labeled
- Sticky footer: `[Reset]` ghost + `[Apply]` solid teal
- Active filter count appears as a teal dot on the trigger

**Decision rule (auto, not per-page):** ≤ 2 filters → FilterRow only; ≥ 3 filters → FilterRow shows 1 primary + Filters trigger; rest live in the sheet.

## 6. Form-field standards

Standardized to fix Image 4's invisible time field and prevent recurrence.

**Field container:**

```
Label (Meta 13/18 slate-700 font-medium)
[ Input / Select / DatePicker — full width, h-11 ]
Helper text or error (Meta 12/16 slate-500 / rose-600)
```

- Every input full-width on mobile, side-by-side on tablet+ via `grid grid-cols-2 gap-3`
- Min height `h-11` (44px touch target)
- shadcn `<Input>` / `<Select>` / `<Textarea>` only — never raw HTML inputs
- Date picker: shadcn `<Popover>` + `react-day-picker` (already in project). On mobile inside a sheet, render inline below trigger.
- Time picker: `<Input type="time">` plus this CSS in [src/index.css](../../../src/index.css):
  ```css
  input[type="time"] { color: hsl(222 47% 11%); }
  input[type="time"]::-webkit-datetime-edit { color: hsl(222 47% 11%); }
  input[type="time"]::-webkit-datetime-edit-fields-wrapper { color: hsl(222 47% 11%); }
  ```
- Number / duration: `<Input type="number" inputMode="numeric">` (numeric keypad on iOS)
- Errors: `aria-invalid="true"` flips border to `rose-300`, helper turns `text-rose-600`. Rendered below input, never above.
- Sheet body has `scroll-padding-bottom: 100px` so focused field stays visible above sticky footer + keyboard

## 7. Per-screen application

The 22 screenshots compress to 11 unique pages plus 2 dashboards.

### 7.1 Teacher Dashboard
**Source:** the teacher home page rendered via the role router

- `PageShell` + restyled top app bar
- `PageHeader` greeting ("Hello, Tushar 👋") + role/institution subtitle
- `HeroSummaryCard` "Open Tasks: 29" + delta + "View all →" link
- Eyebrow `WORK` → 2-col `FeatureTile` grid (My Students / Syllabus / Question Bank / Tasks / Reports)
- Eyebrow `GROWTH` → 2-col `FeatureTile` grid (Achievements / Leaderboard) — orange-tone icon discs
- `MobileFab` hidden (no per-page primary action)

### 7.2 Coordinator Dashboard
**Source:** shares parent with Teacher Dashboard

Same structure as 7.1 with coordinator-specific metric and tiles. `HeroSummaryCard` shows the coordinator's primary metric (data already fetched).

### 7.3 Teachers list — `SchoolTeachersPage` (Images 1, 21)
**Source:** [src/pages/school/SchoolTeachersPage.tsx](../../../src/pages/school/SchoolTeachersPage.tsx)

- `PageHeader` title "Teachers" + subtitle, primary CTA "+ Add Teacher", kebab houses Assign Task to All / Generate Report / Bulk Upload
- 2-col / 3-col `StatTileGrid` (Total Teachers / Total Classes / Subjects Covered)
- Search input full-width, `FilterRow` with "All Classes" + Sort
- Section card "Teachers List": list of `ListRow`s (initials avatar, name, email + subject count, chevron)
- `EmptyState` when no teachers
- `MobileFab` "+ Add Teacher" — fixes Image 21 mid-page bug

### 7.4 Students list — `TeacherStudentsPage` (Images 11, 12)
**Source:** [src/pages/teacher/TeacherStudentsPage.tsx](../../../src/pages/teacher/TeacherStudentsPage.tsx)

- `PageHeader` "Students", kebab houses "Assign Task to All"
- 2-col `StatTileGrid` (Total Students / Classes)
- `FilterRow`: search, "All Classes"
- Section card "Students List" with `ListRow`s
- `EmptyState` "No students yet"

### 7.5 Question Bank — `QuestionBankPage` (Images 2, 15)
**Source:** [src/pages/admin/QuestionBankPage.tsx](../../../src/pages/admin/QuestionBankPage.tsx)

- `PageHeader` "Question Bank", primary CTA "+ Add Question"
- 2×2 `StatTileGrid` (Total Questions / Question Types / Average Marks / +1)
- Search bar full width; `FilterRow` shows "All Classes" + `⚙ Filters · 2`; sheet contains Subjects + Types
- Section card "Custom Questions" with `ListRow`s
- `EmptyState` "No questions found"
- `MobileFab` "+"

### 7.6 Syllabus & Study Materials — `SchoolSyllabusPage` (Images 3, 10, 13, 14)
**Source:** [src/pages/school/SchoolSyllabusPage.tsx](../../../src/pages/school/SchoolSyllabusPage.tsx)

- `PageHeader` "Syllabus & Study Materials", primary CTA "+ Add New" (split-button)
- Tree/Panel becomes a `Segmented` (shadcn ToggleGroup) inline below the header — NOT a stat tile (retires Image 13's UX bug)
- 2×2 `StatTileGrid`: Grades / Subjects / Chapters / Topics
- `FilterRow`: search, "Select Chapters"; "Expand All" → small icon button (`⤢`)
- Section card with class `ListRow`s
- `MobileFab` "+"

### 7.7 Tasks page — `TasksPage` (Images 6, 7, 17, 18)
**Source:** [src/pages/TasksPage.tsx](../../../src/pages/TasksPage.tsx)

Worst offender; full rebuild:

- `PageHeader` "Tasks", primary CTA "+ Assign Task", kebab houses "Workforce Overview"
- 2-col `StatTileGrid` for 5–6 metrics; tablet+ goes 3-col, wide desktop 6-col
- `MobileTabs` (default density, scroll-snap) for the 6 tabs
- Section card hosts the active tab's task `ListRow`s (title + category pill + due date + inline action)
- `EmptyState` "No active tasks"
- `MobileFab` "+ Assign Task" — auto-hides when empty-state CTA is in viewport

### 7.8 Task detail (Images 8, 9)
**Source:** the detail view inside [src/pages/TasksPage.tsx](../../../src/pages/TasksPage.tsx)

- `MobileSheet` on mobile, full-page route on desktop
- Header: title pill (status), close `×`
- Body content stacks single-column at viewports < 380px; `Assigned By / Assigned To` collapses into a 2-col grid at ≥ 380px (fixes the cut-off labels in Image 8 where the page was forcing horizontal overflow at narrow widths)
- Section "Status" with overdue alert (rose-50 bg + alert icon)
- Sticky footer with primary action ("Mark as Done") — fixes Image 9's floating Done badge
- Section "Evidence" — `ListRow`s + "+ Add Evidence"
- Section "Comments" — list + sticky `<Input>` with send icon

### 7.9 Schedule & Publish sheet — `ReviewPublishScreen` (Image 4)
**Source:** [src/components/exam-creation/screens/ReviewPublishScreen.tsx](../../../src/components/exam-creation/screens/ReviewPublishScreen.tsx)

- Standardized as `MobileSheet`
- Body: Exam date → Start time + Duration (2-col ≥ 380px) → Late entry → Result visibility radio group
- Sticky footer: `[Cancel]` + `[Publish exam]`
- Time field fix: explicit `text-slate-900` plus the `::-webkit-datetime-edit` rule from §6

### 7.10 Exam evaluation / Student list (Image 5)
**Source:** [src/pages/EvaluationsPage.tsx](../../../src/pages/EvaluationsPage.tsx)

- `PageHeader` exam name + back chevron
- 2-col `StatTileGrid` (Pending Review / Not Attempted / Checked / Not Checked)
- Section card "Student List":
  - `MobileTabs`: All / Not Checked / Checked / Not Started
  - `ListRow`s on mobile (avatar + name + status pill + score)
  - On tablet+: keep proper table

### 7.11 Reports & Analytics (Images 19, 20)
**Source:** the reports / evaluations page

- `PageHeader` "Reports & Analytics"
- Top-level `MobileTabs`: Teacher Overview / Exam Reports / Class Reports / Student Reports — single row, scroll-snap
- Section card "Teaching Insights Dashboard" (existing summary, restyled)
- 2×2 `StatTileGrid` (Subject Class Average / Top Performer / Avg Time/Question / Class Efficiency) tones `sky / peach / mint / violet`
- 3-up `StatTileGrid` (Needs Attention `rose` / Developing `peach` / Stable `mint`)
- Nested `MobileTabs` (compact density): Class Overview / Students / Recommendations
- `MobileFab` hidden

### 7.12 Exams list (Image 16)
**Source:** locate via grep on "No drafts yet" text

- `PageHeader` "Exams", primary CTA "+ Create Exam"
- "No drafts yet" → compact info strip below header (not a 200px-fold-hogging card)
- `FilterRow` + `FilterSheet`: search + "All Exams" inline + `⚙ Filters · 2`
- Grid/list view toggle → `Segmented` icon-only control on the right of the filter row
- Section card with exam list (`ListRow`s in list mode, 2-col grid in grid mode)
- `EmptyState` (no drafts AND no exams) — illustrative + "+ Create Exam"
- `MobileFab` "+" — auto-hides when empty-state CTA is visible

## 8. Implementation order

Six phases. Each independently shippable. After each phase: `npx tsc --noEmit` exit 0, `npx eslint <touched paths>` zero errors, `npx vite build` exit 0 (per CLAUDE.md §5a).

### Phase 1 — Foundation
1. Add CSS tokens + `--surface-gradient` to [src/index.css](../../../src/index.css)
2. Extend [tailwind.config.js](../../../tailwind.config.js) to expose new tokens
3. Build `PageShell` at `src/components/shared/page/PageShell.tsx`
4. Smoke-test by wrapping the Teacher Dashboard with `PageShell` ONLY (no other primitives swapped yet) to verify gradient + safe-area render correctly on iOS Safari, Chrome desktop, Chrome Android. The full Teacher-Dashboard redesign happens in Phase 5 step 11 — this step exists only to validate the shell.

### Phase 2 — Simple primitives (no inter-deps)
1. `PageHeader` + `ActionMenu` — `src/components/shared/page/PageHeader.tsx`
2. `MobileFab` — `src/components/shared/page/MobileFab.tsx`
3. `StatTile` + `StatTileGrid` — `src/components/shared/surfaces/StatTile.tsx`
4. `ListRow` — `src/components/shared/surfaces/ListRow.tsx`
5. `EmptyState` — `src/components/shared/surfaces/EmptyState.tsx`
6. `FeatureTile` — `src/components/shared/surfaces/FeatureTile.tsx`
7. `HeroSummaryCard` — `src/components/shared/surfaces/HeroSummaryCard.tsx`

Dev-only `/dev/primitives` route renders all primitives in isolation for visual review.

### Phase 3 — Sheet foundation
1. `MobileSheet` — `src/components/shared/sheets/MobileSheet.tsx` (built on shadcn `Sheet`, NOT `Dialog`)
2. Form-field CSS standards added to [src/index.css](../../../src/index.css), including the `<input type="time">` iOS color override

### Phase 4 — Navigation primitives
1. `MobileTabs` — `src/components/shared/nav/MobileTabs.tsx`
2. `FilterRow` — `src/components/shared/nav/FilterRow.tsx`
3. `FilterSheet` — `src/components/shared/nav/FilterSheet.tsx` (depends on MobileSheet)

### Phase 5 — Apply primitives to pages (worst-pain order)

1. Tasks page — fixes biggest bug class
2. Schedule & Publish sheet — unblocks exam publishing
3. Task detail — fixes zoom-out / cut-label bug
4. Teachers list — fixes mid-page FAB bug
5. Reports & Analytics — fixes broken 2×2 tab grid
6. Question Bank — fixes triple-stack filters
7. Exams list — fixes filter stack + FAB collision
8. Syllabus & Materials — fixes Add-New overlap + Current-View UX bug
9. Students list — fixes loud cards + bland empty
10. Exam evaluation — fixes broken tab strip
11. Teacher Dashboard — final polish + brand moment
12. Coordinator Dashboard — final polish

**Per-screen exit criteria:**
- Real-iPhone-Safari check (the device the original screenshots came from)
- All circled issues from the source screenshots resolved
- Zero TypeScript / ESLint errors on touched files; Vite build exit 0
- Diff is markup + classNames + component swaps only — no logic, hooks, queries, mutations, or props touched

### Phase 6 — Verification + cleanup
1. End-to-end manual run-through on a real iPhone
2. Remove or dev-gate `/dev/primitives` route
3. Update [.claude/CLAUDE.md](../../../.claude/CLAUDE.md) with a "Mobile Design System" section pointing at the primitives directory and this spec

## 9. Constraints & invariants

- **No business logic changes** — pure UI work. Any diff that touches a hook, query, mutation, route, or prop signature is out of scope and rejected.
- **shadcn/ui primitives only** for inputs / dropdowns / dialogs (CLAUDE.md §UI rules).
- **CSS variables from tailwind.config** — no inline styles (CLAUDE.md §UI rules).
- **Mobile responsive from 375px** (CLAUDE.md §UI rules).
- **Dialog vs Sheet:** `MobileSheet` is built on shadcn `Sheet`, never on `Dialog`, so the project's auto-wrap-in-ScrollArea fork (per [.claude/skills/ui-invariants/SKILL.md](../../../.claude/skills/ui-invariants/SKILL.md)) doesn't apply at the new entry point. Centered confirmation dialogs continue to use the existing `Dialog` fork.
- **CLAUDE.md §5a — production-clean:** no `any`, no eslint-disable, no relaxed lint config. `tsc --noEmit` zero, `eslint` zero on touched files, `vite build` exit 0.
- **CLAUDE.md §17 — Service Worker:** no changes to [public/sw.js](../../../public/sw.js), [vite.config.ts](../../../vite.config.ts) `swBuildIdPlugin`, or [src/main.tsx](../../../src/main.tsx) registration. New work is style + structure only.
- **Toast errors** continue to route through `toastError` from [src/lib/toast.ts](../../../src/lib/toast.ts) (CLAUDE.md §6, §19) — though we shouldn't be adding any new error paths in pure UI work.

## 10. Out of scope

- Student-facing pages
- Admin / super-admin pages
- Backend / edge-function / RLS / migration changes
- Service worker, PWA, or build-pipeline changes
- New features, new flows, new data
- Replacing shadcn/ui or any underlying library
- Storybook (we use a single `/dev/primitives` route for visual review)

## 11. Open questions

None at the time of writing. All clarifying questions answered during the brainstorming session:
- Approach: option C (shared primitives + system) ✓
- FAB anchoring: option 1 (FAB) ✓
- Hero card placement: option C (role dashboards only) ✓
- Tab pattern: option a (horizontal scroll-snap pills) ✓
- Universal gradient backdrop on every page ✓
- Color palette and accent rules ✓
