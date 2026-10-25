# Teacher + Coordinator Mobile UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a unified mobile-first design language (CoachPro + mobile-finance reference aesthetic) across every teacher and coordinator surface by introducing a small set of shared primitives and rebuilding 11 pages on top of them — pure UI work, zero data-flow changes.

**Architecture:** Six phases. Phase 1 establishes design tokens and the page shell. Phases 2–4 build 12 shared primitives in dependency order (`src/components/shared/{page,surfaces,nav,sheets}/`). Phase 5 applies those primitives to each affected page in worst-pain order. Phase 6 removes scaffolding and documents the new system in `.claude/CLAUDE.md`. Each task is a self-contained UI swap that can ship independently.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix primitives), TanStack Query v5 (untouched in this work), `lucide-react` icons, `class-variance-authority`, `react-router-dom` v6.

**Validation regime (this codebase has no test runner):** every task validates via (1) mount-in-gallery visual smoke, (2) `npx tsc --noEmit` exit 0, (3) `npx eslint <touched-paths>` zero errors, (4) `npx vite build` exit 0. Logic-bearing primitives (MobileFab auto-hide, MobileTabs scroll-into-view, ActionMenu responsive rule) additionally require manual real-device behavior checks on iOS Safari + Chrome desktop.

**Reference:** Design spec at [docs/superpowers/specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md](../specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md).

---

## File Structure

**New files (created in Phases 1–4):**

```
src/
  components/
    shared/
      page/
        PageShell.tsx           # Phase 1
        PageHeader.tsx          # Phase 2 (Task 3)
        MobileFab.tsx           # Phase 2 (Task 4)
        index.ts
      surfaces/
        StatTile.tsx            # Phase 2 (Task 5)
        ListRow.tsx             # Phase 2 (Task 6)
        EmptyState.tsx          # Phase 2 (Task 7)
        FeatureTile.tsx         # Phase 2 (Task 8)
        HeroSummaryCard.tsx     # Phase 2 (Task 9)
        index.ts
      nav/
        MobileTabs.tsx          # Phase 4 (Task 11)
        FilterRow.tsx           # Phase 4 (Task 12)
        FilterSheet.tsx         # Phase 4 (Task 13)
        index.ts
      sheets/
        MobileSheet.tsx         # Phase 3 (Task 10)
        index.ts
      design-system.ts          # Phase 2 (Task 5) — shared tone tokens
  pages/
    dev/
      PrimitivesGallery.tsx     # Phase 2 (Task 2) — dev-only visual harness
```

**Modified files:**

- `src/index.css` — Phase 1 (tokens, gradient) + Phase 3 (form-field overrides)
- `tailwind.config.ts` — Phase 1 (token exposure)
- `src/App.tsx` — Phase 2 Task 2 (gallery route), Phase 6 (gallery removal)
- 12 page files (Phase 5)
- `.claude/CLAUDE.md` — Phase 6 (design-system section)

---

# Phase 1 — Foundation

## Task 1: Add design tokens, gradient, and PageShell

**Files:**
- Modify: `src/index.css` (extend `:root` block + add component layer)
- Modify: `tailwind.config.ts` (extend `colors` and `backgroundImage`)
- Create: `src/components/shared/page/PageShell.tsx`
- Create: `src/components/shared/page/index.ts`
- Modify: `src/pages/teacher/TeacherStudentsPage.tsx` (smoke-test page wrapping)

- [ ] **Step 1.1: Add brand and surface tokens to `src/index.css`**

In `src/index.css`, locate the `:root { … }` block (currently around lines 11–93). Add the following lines just before the closing `}` of that `:root` block, after the existing `--spacing` line:

```css
    /* === Mobile UI Redesign tokens (2026-04-27) === */
    /* Brand — exact values per design spec */
    --brand-primary: 183 64% 39%;        /* #249ca2 teal */
    --brand-secondary: 257 28% 50%;      /* #6f5ba2 muted violet */
    --brand-accent: 34 96% 52%;          /* #fa920e warm orange */

    /* Surfaces */
    --surface-base: 220 25% 98%;         /* near-white page floor */
    --surface-card: 0 0% 100%;           /* card body (alpha applied per use) */
    --surface-stroke: 220 15% 92%;       /* hairline borders */

    /* Neutral text scale (slate range, used across primitives) */
    --ink-900: 222 47% 11%;
    --ink-700: 220 15% 25%;
    --ink-600: 220 9% 46%;
    --ink-500: 220 9% 56%;
    --ink-400: 220 9% 66%;
```

- [ ] **Step 1.2: Add the universal page-backdrop gradient utility to `src/index.css`**

After the existing `@layer components { … }` block (around line 195), add a new components layer:

```css
@layer components {
  .surface-gradient {
    background-color: hsl(var(--surface-base));
    background-image:
      radial-gradient(1200px 800px at 0% 0%, hsl(var(--brand-primary) / 0.12), transparent 60%),
      radial-gradient(1000px 700px at 100% 0%, hsl(var(--brand-secondary) / 0.10), transparent 60%);
    background-attachment: fixed;
  }

  .surface-card {
    background-color: hsl(var(--surface-card) / 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid hsl(var(--surface-stroke));
  }

  .frosted-shadow {
    box-shadow:
      0 2px 8px rgba(15, 23, 42, 0.04),
      0 8px 24px rgba(15, 23, 42, 0.04);
  }
}
```

- [ ] **Step 1.3: Expose new tokens in `tailwind.config.ts`**

In `tailwind.config.ts`, inside `theme.extend.colors` (around line 16), add new entries. Final `colors` block should be:

```ts
colors: {
  border: 'hsl(var(--border))',
  input: 'hsl(var(--input))',
  ring: 'hsl(var(--ring))',
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: {
    DEFAULT: 'hsl(var(--primary))',
    foreground: 'hsl(var(--primary-foreground))',
  },
  secondary: {
    DEFAULT: 'hsl(var(--secondary))',
    foreground: 'hsl(var(--secondary-foreground))',
  },
  destructive: {
    DEFAULT: 'hsl(var(--destructive))',
    foreground: 'hsl(var(--destructive-foreground))',
  },
  muted: {
    DEFAULT: 'hsl(var(--muted))',
    foreground: 'hsl(var(--muted-foreground))',
  },
  accent: {
    DEFAULT: 'hsl(var(--accent))',
    foreground: 'hsl(var(--accent-foreground))',
  },
  popover: {
    DEFAULT: 'hsl(var(--popover))',
    foreground: 'hsl(var(--popover-foreground))',
  },
  card: {
    DEFAULT: 'hsl(var(--card))',
    foreground: 'hsl(var(--card-foreground))',
  },
  sidebar: {
    DEFAULT: 'hsl(var(--sidebar-background))',
    foreground: 'hsl(var(--sidebar-foreground))',
    primary: 'hsl(var(--sidebar-primary))',
    'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
    accent: 'hsl(var(--sidebar-accent))',
    'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
    border: 'hsl(var(--sidebar-border))',
    ring: 'hsl(var(--sidebar-ring))',
  },
  brand: {
    primary: 'hsl(var(--brand-primary))',
    secondary: 'hsl(var(--brand-secondary))',
    accent: 'hsl(var(--brand-accent))',
  },
  surface: {
    base: 'hsl(var(--surface-base))',
    card: 'hsl(var(--surface-card))',
    stroke: 'hsl(var(--surface-stroke))',
  },
  ink: {
    900: 'hsl(var(--ink-900))',
    700: 'hsl(var(--ink-700))',
    600: 'hsl(var(--ink-600))',
    500: 'hsl(var(--ink-500))',
    400: 'hsl(var(--ink-400))',
  },
},
```

- [ ] **Step 1.4: Create `PageShell` component**

Create `src/components/shared/page/PageShell.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Slot for a single MobileFab. The FAB is rendered as a fixed-position child
   * of the shell so it always appears in the same place regardless of the page's
   * own scroll context. Pages that don't need a FAB simply omit this prop.
   */
  fab?: React.ReactNode;
}

/**
 * Wrapper around every authenticated page. Paints the universal gradient backdrop,
 * locks horizontal scroll at the root, and reserves a fixed slot for MobileFab.
 *
 * Existing top app bars (hamburger / search / bell / avatar) continue to live
 * outside the shell — PageShell is the content-area wrapper, not an app-shell.
 */
export function PageShell({ children, className, fab }: PageShellProps) {
  return (
    <div
      className={cn(
        "relative min-h-[100dvh] w-full overflow-x-hidden surface-gradient",
        "pb-[max(env(safe-area-inset-bottom),16px)]",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
      {fab}
    </div>
  );
}
```

- [ ] **Step 1.5: Create the page-shared barrel export**

Create `src/components/shared/page/index.ts`:

```ts
export { PageShell } from "./PageShell";
```

- [ ] **Step 1.6: Smoke-test PageShell on the Teacher Students page**

Open `src/pages/teacher/TeacherStudentsPage.tsx`. Identify the top-level JSX wrapper (the outermost `<div>` or fragment that contains the page content). Wrap it with `<PageShell>` while leaving every prop, hook call, and child unchanged.

For example, if the file currently looks like:

```tsx
return (
  <div className="container py-6">
    {/* existing content */}
  </div>
);
```

Change it to:

```tsx
import { PageShell } from "@/components/shared/page";
// ... other imports unchanged ...

return (
  <PageShell>
    <div className="py-6">
      {/* existing content unchanged */}
    </div>
  </PageShell>
);
```

> **Important:** drop only the `container` class (PageShell already handles `max-w` + `mx-auto` + horizontal padding). Keep all other classNames, and do NOT modify any hook, query, mutation, prop, or event handler. The diff for this step should be: 1 import added, 1 wrapper added, `container` class removed.

- [ ] **Step 1.7: Validate Phase 1**

Run all four checks:

```bash
npx tsc --noEmit
npx eslint src/index.css src/components/shared/page src/pages/teacher/TeacherStudentsPage.tsx tailwind.config.ts
npx vite build
```

Expected: each command exits with code 0. Bundle-size warnings (>500 kB) are not failures.

Then run `npm run dev`, sign in as a teacher, navigate to the Students page, and verify visually:
- The soft teal-violet gradient is visible across the page background
- Cards / content render without layout regression
- No horizontal scroll on iPhone Safari (DevTools mobile emulation is sufficient for this smoke check; full real-device check happens in Phase 5)
- The top app bar continues to function (hamburger, search, bell, avatar)

- [ ] **Step 1.8: Commit**

```bash
git add src/index.css tailwind.config.ts src/components/shared/page src/pages/teacher/TeacherStudentsPage.tsx
git commit -m "feat(ui): add design tokens, surface gradient, and PageShell

Foundation for the teacher/coordinator mobile UI redesign.
- Adds brand + surface CSS variables (--brand-primary, --brand-secondary,
  --brand-accent, --surface-*, --ink-*)
- Adds .surface-gradient, .surface-card, .frosted-shadow component
  utilities for the universal page backdrop and frosted-card aesthetic
- Exposes new tokens through tailwind.config.ts (brand.*, surface.*, ink.*)
- Introduces PageShell wrapper that paints the gradient, locks horizontal
  scroll, and reserves a fixed slot for MobileFab
- Smoke-tests the shell by wrapping TeacherStudentsPage; full primitive
  application happens in Phase 5

Refs: docs/superpowers/specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md"
```

---

# Phase 2 — Simple primitives (no inter-deps)

## Task 2: PrimitivesGallery dev-only route

This task creates the visual harness used to validate every subsequent primitive in isolation. Every Phase 2 / 3 / 4 task adds a section to this gallery as part of its definition-of-done.

**Files:**
- Create: `src/pages/dev/PrimitivesGallery.tsx`
- Modify: `src/App.tsx` (add the gallery route, gated by `import.meta.env.DEV`)

- [ ] **Step 2.1: Create the empty gallery page**

Create `src/pages/dev/PrimitivesGallery.tsx`:

```tsx
import * as React from "react";

import { PageShell } from "@/components/shared/page";

/**
 * Dev-only gallery for visually verifying shared primitives in isolation.
 * Mounted at /dev/primitives, gated to development builds in src/App.tsx.
 *
 * Each primitive task adds a <Section> below as part of its definition-of-done.
 * Removed entirely (or hidden behind a stronger gate) in Phase 6.
 */
export default function PrimitivesGallery() {
  return (
    <PageShell>
      <div className="py-8 space-y-12">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Internal</p>
          <h1 className="text-3xl font-semibold text-ink-900">Primitives Gallery</h1>
          <p className="text-sm text-ink-500">
            Visual harness for shared primitives. Not linked from the app navigation.
          </p>
        </header>

        {/* Section markers added by subsequent tasks. */}
      </div>
    </PageShell>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-ink-700">{title}</h2>
      <div className="space-y-6">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2.2: Mount the gallery route in `src/App.tsx`**

Open `src/App.tsx`. Add a lazy import near the other lazy imports (around line 20):

```ts
const PrimitivesGallery = lazy(() => import("./pages/dev/PrimitivesGallery"));
```

Then locate the `<Routes>` block. Add the dev-only route inside it (placement: before the catch-all `*` route, alongside other top-level routes). Wrap with the dev gate:

```tsx
{import.meta.env.DEV && (
  <Route
    path="/dev/primitives"
    element={
      <Suspense fallback={null}>
        <PrimitivesGallery />
      </Suspense>
    }
  />
)}
```

> Match the indentation and `<Suspense>` pattern of the surrounding lazy routes — examine the existing `SettingsPage` / `PRDPage` / `CommandCenterPage` mounts for the exact shape, and copy that shape.

- [ ] **Step 2.3: Validate**

```bash
npx tsc --noEmit
npx eslint src/pages/dev/PrimitivesGallery.tsx src/App.tsx
npx vite build
```

All exit 0. Then `npm run dev`, navigate to `/dev/primitives`, and verify:
- The gradient backdrop renders
- The "Primitives Gallery" heading is visible
- No primitives sections shown yet (correct — they're added later)

- [ ] **Step 2.4: Commit**

```bash
git add src/pages/dev/PrimitivesGallery.tsx src/App.tsx
git commit -m "feat(ui): add /dev/primitives gallery for primitive validation

Dev-only route (gated by import.meta.env.DEV) for visually verifying
shared primitives in isolation. Each subsequent primitive task adds
a section here as part of its definition-of-done. Removed in Phase 6."
```

---

## Task 3: PageHeader + ActionMenu

**Files:**
- Create: `src/components/shared/page/PageHeader.tsx`
- Modify: `src/components/shared/page/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 3.1: Create PageHeader**

Create `src/components/shared/page/PageHeader.tsx`:

```tsx
import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface PageHeaderAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  primaryAction?: PageHeaderAction;
  secondaryActions?: PageHeaderAction[];
  className?: string;
}

/**
 * Standard page title block. Sits directly under the top app bar on the
 * gradient (no card wrapper). Decides where each action renders based on
 * viewport width and the count of secondary actions:
 *
 * - lg+: all actions inline
 * - md (640-1023px): ≤2 secondary inline, ≥3 → first inline + kebab
 * - <640px: primary CTA + kebab containing ALL secondary actions
 *
 * The kebab uses shadcn DropdownMenu. Destructive items render in rose-600.
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  primaryAction,
  secondaryActions = [],
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 py-4 sm:py-6 md:flex-row md:items-start md:gap-6", className)}>
      <div className="flex flex-1 items-start gap-3 min-w-0">
        {icon && (
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-2xl font-semibold text-ink-900 sm:text-[28px] sm:leading-[34px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-500 sm:text-[15px] sm:leading-[22px]">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {(primaryAction || secondaryActions.length > 0) && (
        <ActionCluster primaryAction={primaryAction} secondaryActions={secondaryActions} />
      )}
    </header>
  );
}

function ActionCluster({
  primaryAction,
  secondaryActions,
}: {
  primaryAction?: PageHeaderAction;
  secondaryActions: PageHeaderAction[];
}) {
  const inlineSecondary: PageHeaderAction[] = [];
  const kebabSecondary: PageHeaderAction[] = [];

  // Mobile-first split: by default everything secondary goes into the kebab.
  // The lg:flex utility below promotes inline rendering when we have horizontal room.
  // We use CSS responsive classes (not JS viewport detection) to keep SSR-safe and avoid hydration mismatch.
  for (const action of secondaryActions) {
    inlineSecondary.push(action); // visible on lg+
    kebabSecondary.push(action);  // visible on <lg
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Inline secondary actions (lg+ only) */}
      {inlineSecondary.length > 0 && (
        <div className="hidden lg:flex items-center gap-2">
          {inlineSecondary.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              size="sm"
              onClick={action.onClick}
              disabled={action.disabled}
              className={cn(action.destructive && "text-rose-600 hover:text-rose-700")}
            >
              {action.icon && <span className="mr-1">{action.icon}</span>}
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {/* Primary CTA — always visible */}
      {primaryAction && (
        <Button
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
        >
          {primaryAction.icon && <span className="mr-2">{primaryAction.icon}</span>}
          {primaryAction.label}
        </Button>
      )}

      {/* Kebab — visible on <lg when there are secondary actions */}
      {kebabSecondary.length > 0 && (
        <div className="lg:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {kebabSecondary.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  onSelect={() => action.onClick()}
                  disabled={action.disabled}
                  className={cn(action.destructive && "text-rose-600 focus:text-rose-700")}
                >
                  {action.icon && <span className="mr-2">{action.icon}</span>}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3.2: Re-export from the page barrel**

Edit `src/components/shared/page/index.ts`:

```ts
export { PageShell } from "./PageShell";
export { PageHeader } from "./PageHeader";
export type { PageHeaderAction, PageHeaderProps } from "./PageHeader";
```

- [ ] **Step 3.3: Add a PageHeader section to the gallery**

Open `src/pages/dev/PrimitivesGallery.tsx`. Add to the imports:

```tsx
import { Plus, Upload, FileDown, ListChecks, GraduationCap } from "lucide-react";

import { PageHeader } from "@/components/shared/page";
```

The `Section` helper is already declared inside `PrimitivesGallery.tsx` (from Task 2.1, where it's exported alongside the default `PrimitivesGallery` component). Inside this same file, reference it directly — no import needed.

Replace the `{/* Section markers added by subsequent tasks. */}` comment with:

```tsx
<Section title="PageHeader">
  <div className="rounded-2xl surface-card frosted-shadow p-1">
    <PageHeader
      icon={<GraduationCap className="h-5 w-5" />}
      title="Teachers"
      subtitle="Manage your school's teaching staff"
      primaryAction={{
        label: "Add Teacher",
        icon: <Plus className="h-4 w-4" />,
        onClick: () => console.log("primary"),
      }}
      secondaryActions={[
        { label: "Assign Task to All", icon: <ListChecks className="h-4 w-4" />, onClick: () => {} },
        { label: "Generate Report", icon: <FileDown className="h-4 w-4" />, onClick: () => {} },
        { label: "Bulk Upload", icon: <Upload className="h-4 w-4" />, onClick: () => {} },
      ]}
    />
  </div>
</Section>
```

> The wrapping `<div className="rounded-2xl surface-card frosted-shadow p-1">` exists ONLY in the gallery so each primitive sits on its own card for visual review — it's NOT part of the PageHeader API.

- [ ] **Step 3.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/page/PageHeader.tsx src/components/shared/page/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. Then `npm run dev` → `/dev/primitives`. Verify:
- Title "Teachers" + subtitle render with the icon disc on the left
- Primary "Add Teacher" button is solid teal, never clipped
- On a < 1024px viewport: only primary + kebab visible. Click kebab → see all 3 secondary actions in a dropdown
- On ≥ 1024px viewport: all 3 secondary actions inline + primary

- [ ] **Step 3.5: Commit**

```bash
git add src/components/shared/page src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add PageHeader with responsive ActionCluster

Single source of truth for page title blocks across teacher/coordinator
surfaces. ActionCluster decides inline vs kebab based on viewport:
- lg+: all secondary actions inline
- <lg: primary CTA + kebab dropdown for all secondary actions

Resolves the header-action overload across SchoolTeachersPage, TasksPage,
SchoolSyllabusPage, ExamsPage where the primary CTA was getting clipped
on mobile."
```

---

## Task 4: MobileFab

**Files:**
- Create: `src/components/shared/page/MobileFab.tsx`
- Modify: `src/components/shared/page/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 4.1: Create MobileFab**

Create `src/components/shared/page/MobileFab.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface MobileFabProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /**
   * When true, the FAB is hidden (translated off-screen + faded). Used by
   * pages that want to hide the FAB whenever an inline empty-state CTA is
   * already in viewport.
   */
  hideWhen?: boolean;
}

/**
 * Floating Action Button. Mobile + tablet only — hidden at lg+ breakpoint
 * because desktop uses the inline header CTA from PageHeader.
 *
 * Auto-hide rule: any element with [data-sticky-bottom] inside the page
 * triggers the FAB to slide out when it intersects the bottom of the viewport,
 * preventing visual collision with sticky toolbars / tab strips / inline CTAs.
 */
export function MobileFab({ label, icon, onClick, hideWhen = false }: MobileFabProps) {
  const [autoHidden, setAutoHidden] = React.useState(false);

  React.useEffect(() => {
    const sentinels = document.querySelectorAll<HTMLElement>("[data-sticky-bottom]");
    if (sentinels.length === 0) {
      setAutoHidden(false);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        // Hide FAB when ANY sentinel is intersecting near the bottom edge.
        const anyVisible = entries.some((entry) => entry.isIntersecting);
        setAutoHidden(anyVisible);
      },
      {
        // Top of root margin pulled in 60% so we only react when the sentinel
        // is in the LOWER 40% of the viewport (where the FAB sits).
        rootMargin: "-60% 0px 0px 0px",
        threshold: 0,
      },
    );

    sentinels.forEach((s) => io.observe(s));
    return () => io.disconnect();
  });

  const hidden = hideWhen || autoHidden;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "fixed z-40 lg:hidden",
        "right-6 bottom-[max(env(safe-area-inset-bottom),24px)]",
        "inline-flex h-14 w-14 items-center justify-center rounded-full",
        "bg-brand-primary text-white",
        "shadow-[0_8px_24px_rgba(36,156,162,0.35)]",
        "transition-[transform,opacity] duration-200 ease-out",
        "active:scale-[0.94]",
        hidden && "translate-y-24 opacity-0 pointer-events-none",
      )}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{icon}</span>
    </button>
  );
}
```

- [ ] **Step 4.2: Re-export from the page barrel**

Edit `src/components/shared/page/index.ts`:

```ts
export { PageShell } from "./PageShell";
export { PageHeader } from "./PageHeader";
export { MobileFab } from "./MobileFab";
export type { PageHeaderAction, PageHeaderProps } from "./PageHeader";
export type { MobileFabProps } from "./MobileFab";
```

- [ ] **Step 4.3: Add a MobileFab section to the gallery**

Append a new section in `PrimitivesGallery.tsx`:

```tsx
<Section title="MobileFab">
  <p className="text-sm text-ink-500">
    The FAB is fixed to the viewport bottom-right. It hides when an element with
    <code className="mx-1 rounded bg-ink-400/10 px-1.5 py-0.5 text-xs">data-sticky-bottom</code>
    enters the bottom 40% of the viewport. Resize the window to verify it disappears at lg+.
  </p>
  <div data-sticky-bottom className="rounded-2xl surface-card frosted-shadow p-4 text-sm text-ink-500">
    Imagine this is a sticky bottom toolbar. The FAB at the screen's bottom-right should
    fade out while this row is visible at the bottom.
  </div>
  <MobileFab
    label="Add Teacher"
    icon={<Plus className="h-6 w-6" />}
    onClick={() => console.log("fab")}
  />
</Section>
```

(The `Plus` import is already present from Task 3.)

Update the import line at the top of `PrimitivesGallery.tsx` to include `MobileFab`:

```tsx
import { PageHeader, PageShell, MobileFab } from "@/components/shared/page";
```

`Section` is still referenced directly because it lives in this same file.

- [ ] **Step 4.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/page/MobileFab.tsx src/components/shared/page/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. Then `npm run dev` → `/dev/primitives` (mobile width):
- Teal FAB visible bottom-right with soft glow shadow
- Scroll until the "sticky bottom toolbar" section is in the lower part of the viewport — FAB should fade/translate out
- Scroll up so the section is no longer in the lower viewport — FAB returns
- Resize to ≥ 1024px (lg) — FAB hidden entirely (lg:hidden)
- Press the FAB — `console.log("fab")` fires

- [ ] **Step 4.5: Commit**

```bash
git add src/components/shared/page src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add MobileFab with IntersectionObserver auto-hide

Floating Action Button pinned bottom-right, mobile + tablet only.
Auto-hides when any [data-sticky-bottom] element enters the bottom
40% of the viewport — prevents collisions with sticky toolbars,
tab strips, and inline empty-state CTAs.

Resolves the FAB positioning bugs visible in SchoolTeachersPage
(mid-page placement), ExamsPage (overlapping inline Create Exam),
and SchoolSyllabusPage (overlapping Tree/Panel toggle)."
```

---

## Task 5: StatTile + StatTileGrid + design-system tones

**Files:**
- Create: `src/components/shared/design-system.ts`
- Create: `src/components/shared/surfaces/StatTile.tsx`
- Create: `src/components/shared/surfaces/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 5.1: Create the shared tone token map**

Create `src/components/shared/design-system.ts`:

```ts
/**
 * Shared tone tokens used by StatTile, FeatureTile, EmptyState icon discs,
 * and any future primitive that needs a tinted icon/disc background.
 *
 * Each tone is a pair of Tailwind class fragments: a soft tinted background
 * for the disc, and a saturated foreground color for the icon glyph.
 */
export const TONES = {
  teal:   { bg: "bg-brand-primary/10",   fg: "text-brand-primary" },
  violet: { bg: "bg-brand-secondary/10", fg: "text-brand-secondary" },
  peach:  { bg: "bg-brand-accent/10",    fg: "text-brand-accent" },
  mint:   { bg: "bg-emerald-500/10",     fg: "text-emerald-600" },
  sky:    { bg: "bg-sky-500/10",         fg: "text-sky-600" },
  rose:   { bg: "bg-rose-500/10",        fg: "text-rose-600" },
} as const;

export type Tone = keyof typeof TONES;
```

- [ ] **Step 5.2: Create StatTile and StatTileGrid**

Create `src/components/shared/surfaces/StatTile.tsx`:

```tsx
import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  delta?: { value: string; direction: "up" | "down" };
  className?: string;
}

export function StatTile({ label, value, icon, tone = "teal", delta, className }: StatTileProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "surface-card frosted-shadow rounded-2xl p-5 flex flex-col gap-3",
        className,
      )}
    >
      {icon && (
        <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-xl", t.bg, t.fg)}>
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <p className="text-[28px] leading-[34px] font-semibold tabular-nums text-ink-900">{value}</p>
        <p className="text-[13px] leading-[18px] font-medium text-ink-500">{label}</p>
      </div>
      {delta && (
        <div
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium",
            delta.direction === "up" ? "text-emerald-600" : "text-rose-600",
          )}
        >
          {delta.direction === "up" ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" />
          )}
          {delta.value}
        </div>
      )}
    </div>
  );
}

export interface StatTileGridProps {
  /** Mobile column count (default 2). 1 valid for narrow stacks. */
  cols?: 1 | 2;
  /** Desktop column count at md+ (default 3). */
  mdCols?: 2 | 3 | 4;
  /** Wide-desktop column count at lg+ (default = mdCols). */
  lgCols?: 2 | 3 | 4 | 5 | 6;
  children: React.ReactNode;
  className?: string;
}

export function StatTileGrid({
  cols = 2,
  mdCols = 3,
  lgCols,
  children,
  className,
}: StatTileGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:gap-4",
        cols === 1 ? "grid-cols-1" : "grid-cols-2",
        mdCols === 2 ? "md:grid-cols-2" : mdCols === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
        lgCols === 2 && "lg:grid-cols-2",
        lgCols === 3 && "lg:grid-cols-3",
        lgCols === 4 && "lg:grid-cols-4",
        lgCols === 5 && "lg:grid-cols-5",
        lgCols === 6 && "lg:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 5.3: Create the surfaces barrel export**

Create `src/components/shared/surfaces/index.ts`:

```ts
export { StatTile, StatTileGrid } from "./StatTile";
export type { StatTileProps, StatTileGridProps } from "./StatTile";
```

- [ ] **Step 5.4: Add a StatTile section to the gallery**

In `PrimitivesGallery.tsx`, add to imports:

```tsx
import { Users, BookOpen, Target, AlertTriangle } from "lucide-react";

import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
```

And append a new section:

```tsx
<Section title="StatTile + StatTileGrid">
  <StatTileGrid mdCols={4}>
    <StatTile label="Total Teachers" value="24" icon={<Users className="h-5 w-5" />} tone="teal" />
    <StatTile label="Total Classes" value="80" icon={<BookOpen className="h-5 w-5" />} tone="violet" />
    <StatTile label="Top Performer" value="92.4%" icon={<Target className="h-5 w-5" />} tone="peach" delta={{ value: "+2.1%", direction: "up" }} />
    <StatTile label="Needs Attention" value="3" icon={<AlertTriangle className="h-5 w-5" />} tone="rose" delta={{ value: "-1", direction: "down" }} />
  </StatTileGrid>
</Section>
```

- [ ] **Step 5.5: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/design-system.ts src/components/shared/surfaces src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `npm run dev` → `/dev/primitives`. Verify:
- 4 StatTiles render in 2-col grid on mobile, 4-col on desktop
- Each tile has white frosted card body, soft shadow, distinct tinted icon disc
- "Total Teachers" tile uses teal disc; "Total Classes" violet; "Top Performer" peach; "Needs Attention" rose
- The delta indicators show in green (up) and rose (down)
- Numbers render with tabular-nums (consistent digit width)

- [ ] **Step 5.6: Commit**

```bash
git add src/components/shared/design-system.ts src/components/shared/surfaces src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add StatTile + StatTileGrid + tone tokens

Neutral white frosted-card stat tiles with brand-tinted icon discs.
Replaces the loud full-bleed colored stat cards on Tasks, Teachers,
Students, Reports & Analytics, and Question Bank pages. StatTileGrid
provides responsive 2-col mobile / 3-4 col desktop layout.

design-system.ts establishes the shared TONES map used by StatTile,
FeatureTile, and EmptyState for consistent icon-disc treatment."
```

---

## Task 6: ListRow

**Files:**
- Create: `src/components/shared/surfaces/ListRow.tsx`
- Modify: `src/components/shared/surfaces/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 6.1: Create ListRow**

Create `src/components/shared/surfaces/ListRow.tsx`:

```tsx
import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ListRowProps {
  /** 40×40 leading slot — avatar (rounded-full), icon disc (rounded-xl), or anything 40px square. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Compact trailing slot. Pass a chevron (default), amount text, status pill, etc. */
  trailing?: React.ReactNode;
  /** Optional inline action row beneath title/subtitle (e.g. "Mark as Done", "Pay Now"). */
  inlineAction?: React.ReactNode;
  /** Whole-row click handler — wraps the row in a button for keyboard / a11y. */
  onClick?: () => void;
  /** Render as a list element when used inside a `<ul>` parent. */
  as?: "div" | "li";
  className?: string;
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  inlineAction,
  onClick,
  as: Wrapper = "div",
  className,
}: ListRowProps) {
  const content = (
    <div className="flex items-center gap-3">
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-[15px] leading-[22px] font-medium text-ink-900">{title}</div>
        {subtitle && (
          <div className="truncate text-[13px] leading-[18px] text-ink-500">{subtitle}</div>
        )}
      </div>
      {trailing !== undefined ? (
        <div className="shrink-0">{trailing}</div>
      ) : (
        onClick && <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />
      )}
    </div>
  );

  const inner = (
    <>
      {content}
      {inlineAction && <div className="mt-3 flex items-center gap-2">{inlineAction}</div>}
    </>
  );

  const baseClasses = cn(
    "surface-card frosted-shadow rounded-2xl p-4",
    onClick && "cursor-pointer transition-transform active:scale-[0.99] hover:shadow-md",
    className,
  );

  if (onClick) {
    return (
      <Wrapper className={baseClasses}>
        <button
          type="button"
          onClick={onClick}
          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-2xl"
        >
          {inner}
        </button>
      </Wrapper>
    );
  }

  return <Wrapper className={baseClasses}>{inner}</Wrapper>;
}
```

- [ ] **Step 6.2: Re-export from surfaces barrel**

Edit `src/components/shared/surfaces/index.ts`:

```ts
export { StatTile, StatTileGrid } from "./StatTile";
export { ListRow } from "./ListRow";
export type { StatTileProps, StatTileGridProps } from "./StatTile";
export type { ListRowProps } from "./ListRow";
```

- [ ] **Step 6.3: Add a ListRow section to the gallery**

Append to `PrimitivesGallery.tsx` (add `Avatar`-like initial circle inline; no new imports needed):

```tsx
<Section title="ListRow">
  <ul className="space-y-2 list-none p-0">
    <ListRow
      as="li"
      leading={<span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary text-sm font-semibold">HS</span>}
      title="Hello Singh"
      subtitle="hsingh@salci.co.in · 2 subjects"
      onClick={() => console.log("row 1")}
    />
    <ListRow
      as="li"
      leading={<span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-secondary/10 text-brand-secondary text-sm font-semibold">SS</span>}
      title="Sandeep Singla"
      subtitle="t1@salci.co.in · No subjects"
      trailing={<span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">In Progress</span>}
      inlineAction={
        <button className="rounded-xl bg-brand-primary px-4 py-1.5 text-sm font-medium text-white">
          Mark as Done
        </button>
      }
    />
  </ul>
</Section>
```

- [ ] **Step 6.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/surfaces/ListRow.tsx src/components/shared/surfaces/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `npm run dev` → `/dev/primitives`. Verify:
- Two ListRows render with frosted card style
- First row has chevron trailing (because `onClick` is set, no explicit `trailing`)
- Second row has status pill trailing + Mark-as-Done inline-action button
- Pressing first row triggers `onClick`
- Long subtitle text truncates with ellipsis (try widening the `subtitle` value to test)

- [ ] **Step 6.5: Commit**

```bash
git add src/components/shared/surfaces src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add ListRow primitive

Standard list-item card with leading avatar/icon slot, title + subtitle,
optional trailing chevron/pill/amount, and optional inline action row.
Replaces bespoke list/table-on-mobile patterns across teacher and
coordinator pages (Tasks list, Teachers/Students lists, Question Bank
items, Class rows in Syllabus)."
```

---

## Task 7: EmptyState

**Files:**
- Create: `src/components/shared/surfaces/EmptyState.tsx`
- Modify: `src/components/shared/surfaces/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 7.1: Create EmptyState**

Create `src/components/shared/surfaces/EmptyState.tsx`:

```tsx
import * as React from "react";

import { Button } from "@/components/ui/button";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  tone?: Tone;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  variant?: "noResults" | "noData" | "error";
  className?: string;
}

/**
 * Centered illustrative empty state. Replaces the bland inline "No X yet"
 * placeholders. The variant prop is documentation-oriented; visual treatment
 * is identical across variants — it's just a hint to the consumer about
 * which empty case they're rendering.
 */
export function EmptyState({
  icon,
  title,
  description,
  tone = "teal",
  action,
  className,
}: EmptyStateProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-10 px-4 text-center",
        className,
      )}
    >
      <span className={cn("inline-flex h-16 w-16 items-center justify-center rounded-2xl", t.bg, t.fg)}>
        {icon}
      </span>
      <div className="space-y-1 max-w-[280px]">
        <h3 className="text-[20px] leading-[28px] font-semibold text-ink-700">{title}</h3>
        {description && <p className="text-[13px] leading-[18px] text-ink-500">{description}</p>}
      </div>
      {action && (
        <Button
          onClick={action.onClick}
          className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98] rounded-xl"
        >
          {action.icon && <span className="mr-2">{action.icon}</span>}
          {action.label}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 7.2: Re-export from surfaces barrel**

Edit `src/components/shared/surfaces/index.ts`:

```ts
export { StatTile, StatTileGrid } from "./StatTile";
export { ListRow } from "./ListRow";
export { EmptyState } from "./EmptyState";
export type { StatTileProps, StatTileGridProps } from "./StatTile";
export type { ListRowProps } from "./ListRow";
export type { EmptyStateProps } from "./EmptyState";
```

- [ ] **Step 7.3: Add an EmptyState section to the gallery**

Append to `PrimitivesGallery.tsx` (the `Search`, `Inbox` icons need importing):

```tsx
import { Search, Inbox } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
```

```tsx
<Section title="EmptyState">
  <div className="rounded-2xl surface-card frosted-shadow">
    <EmptyState
      icon={<Inbox className="h-7 w-7" />}
      tone="teal"
      title="No active tasks"
      description="When work is assigned to you it will appear here."
      action={{
        label: "Assign Task",
        icon: <Plus className="h-4 w-4" />,
        onClick: () => console.log("assign"),
      }}
    />
  </div>
  <div className="rounded-2xl surface-card frosted-shadow">
    <EmptyState
      icon={<Search className="h-7 w-7" />}
      tone="violet"
      title="No matches"
      description="Try adjusting your filters or searching for a different term."
      variant="noResults"
    />
  </div>
</Section>
```

- [ ] **Step 7.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/surfaces/EmptyState.tsx src/components/shared/surfaces/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `npm run dev` → `/dev/primitives`. Verify:
- First empty state: teal icon disc, "No active tasks" heading, helper text, teal CTA button
- Second empty state: violet icon disc, "No matches" heading, no CTA
- Layout is centered, max ~280px description wrap

- [ ] **Step 7.5: Commit**

```bash
git add src/components/shared/surfaces src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add EmptyState primitive

Centered illustrative empty state with brand-tinted icon disc, optional
description, optional CTA. Replaces the bland 'No X yet' inline copy
across Tasks list, Students list, Exams list, Question Bank, Syllabus.
The 'variant' prop is a hint for consumers about which empty case they
are rendering (noResults vs noData vs error)."
```

---

## Task 8: FeatureTile

**Files:**
- Create: `src/components/shared/surfaces/FeatureTile.tsx`
- Modify: `src/components/shared/surfaces/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 8.1: Create FeatureTile**

Create `src/components/shared/surfaces/FeatureTile.tsx`:

```tsx
import * as React from "react";
import { Link } from "react-router-dom";

import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface FeatureTileProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  to: string;
  tone?: Tone;
  className?: string;
}

/**
 * Whole-card link for the WORK / GROWTH grids on the Teacher and Coordinator
 * dashboards. Click anywhere on the card → navigates to `to`.
 */
export function FeatureTile({ icon, title, description, to, tone = "teal", className }: FeatureTileProps) {
  const t = TONES[tone];
  return (
    <Link
      to={to}
      className={cn(
        "block surface-card frosted-shadow rounded-2xl p-5 transition-transform active:scale-[0.98] hover:shadow-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
        className,
      )}
    >
      <span className={cn("inline-flex h-11 w-11 items-center justify-center rounded-xl mb-4", t.bg, t.fg)}>
        {icon}
      </span>
      <div className="space-y-1">
        <h3 className="text-[18px] leading-[24px] font-semibold text-ink-900">{title}</h3>
        {description && (
          <p className="text-[13px] leading-[18px] text-ink-500 line-clamp-2">{description}</p>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 8.2: Re-export**

Edit `src/components/shared/surfaces/index.ts`:

```ts
export { StatTile, StatTileGrid } from "./StatTile";
export { ListRow } from "./ListRow";
export { EmptyState } from "./EmptyState";
export { FeatureTile } from "./FeatureTile";
export type { StatTileProps, StatTileGridProps } from "./StatTile";
export type { ListRowProps } from "./ListRow";
export type { EmptyStateProps } from "./EmptyState";
export type { FeatureTileProps } from "./FeatureTile";
```

- [ ] **Step 8.3: Add a FeatureTile section to the gallery**

Append to `PrimitivesGallery.tsx` (add `Trophy`, `Award` icon imports):

```tsx
import { Trophy, Award } from "lucide-react";

import { FeatureTile } from "@/components/shared/surfaces";
```

```tsx
<Section title="FeatureTile">
  <p className="text-xs font-medium uppercase tracking-wider text-ink-400">WORK</p>
  <div className="grid grid-cols-2 gap-3">
    <FeatureTile
      to="/students"
      icon={<Users className="h-5 w-5" />}
      title="My Students"
      description="Students in your classes"
      tone="teal"
    />
    <FeatureTile
      to="/syllabus"
      icon={<BookOpen className="h-5 w-5" />}
      title="Syllabus"
      description="Curriculum & syllabus mapping"
      tone="teal"
    />
  </div>
  <p className="text-xs font-medium uppercase tracking-wider text-ink-400 mt-2">GROWTH</p>
  <div className="grid grid-cols-2 gap-3">
    <FeatureTile
      to="/achievements"
      icon={<Trophy className="h-5 w-5" />}
      title="Achievements"
      description="Badges & milestones earned"
      tone="peach"
    />
    <FeatureTile
      to="/leaderboard"
      icon={<Award className="h-5 w-5" />}
      title="Leaderboard"
      description="Rankings & standings"
      tone="peach"
    />
  </div>
</Section>
```

- [ ] **Step 8.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/surfaces/FeatureTile.tsx src/components/shared/surfaces/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `npm run dev` → `/dev/primitives`. Verify:
- WORK eyebrow + 2 teal-toned tiles in 2-col grid
- GROWTH eyebrow + 2 peach-toned tiles
- Each tile is a clickable link (full card target) — clicking navigates (gracefully shows 404 since these target paths don't exist; that's fine for the gallery)
- Active state: tile scales to 0.98 briefly on press

- [ ] **Step 8.5: Commit**

```bash
git add src/components/shared/surfaces src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add FeatureTile primitive

Whole-card navigation tile for the WORK / GROWTH dashboard grids on
Teacher and Coordinator dashboards. Replaces the existing dashboard
tile markup with a primitive that locks the icon disc, title,
description treatment and uses react-router Link for the full-card
touch target."
```

---

## Task 9: HeroSummaryCard

**Files:**
- Create: `src/components/shared/surfaces/HeroSummaryCard.tsx`
- Modify: `src/components/shared/surfaces/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 9.1: Create HeroSummaryCard**

Create `src/components/shared/surfaces/HeroSummaryCard.tsx`:

```tsx
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, ArrowDownRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface HeroSummaryCardProps {
  /** Top label, e.g. "Welcome back, Tushar 👋" or "This week". */
  eyebrow: string;
  /** Big metric value. */
  value: React.ReactNode;
  /** Description for the value, e.g. "Open Tasks". */
  metric: string;
  delta?: { value: string; direction: "up" | "down" };
  /** Optional link rendered bottom-right ("View all →"). */
  link?: { label: string; to: string };
  className?: string;
}

/**
 * Big teal→violet gradient hero card. Used on the Teacher and Coordinator
 * dashboards only — never on inner pages. Inspired by the credit-card
 * hero in the mobile finance reference.
 */
export function HeroSummaryCard({ eyebrow, value, metric, delta, link, className }: HeroSummaryCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl p-6 text-white",
        "bg-gradient-to-br from-brand-primary via-[#2bb3b8] to-brand-secondary",
        "shadow-[0_12px_40px_-8px_hsl(var(--brand-primary)/0.45)]",
        className,
      )}
    >
      {/* Decorative floating circles top-right (matches mobile-finance reference) */}
      <span aria-hidden className="pointer-events-none absolute -top-8 -right-8 h-40 w-40 rounded-full bg-white/8" />
      <span aria-hidden className="pointer-events-none absolute top-6 right-16 h-16 w-16 rounded-full bg-white/10" />

      <div className="relative space-y-4">
        <p className="text-sm font-medium text-white/80">{eyebrow}</p>
        <div className="space-y-1">
          <p className="text-4xl font-semibold tabular-nums">{value}</p>
          <p className="text-base text-white/80">{metric}</p>
        </div>
        <div className="flex items-end justify-between gap-4 pt-2">
          {delta ? (
            <div className="inline-flex items-center gap-1 text-sm font-medium">
              {delta.direction === "up" ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              {delta.value}
            </div>
          ) : (
            <span />
          )}
          {link && (
            <Link
              to={link.to}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-sm hover:bg-white/25 transition-colors"
            >
              {link.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9.2: Re-export**

Edit `src/components/shared/surfaces/index.ts`:

```ts
export { StatTile, StatTileGrid } from "./StatTile";
export { ListRow } from "./ListRow";
export { EmptyState } from "./EmptyState";
export { FeatureTile } from "./FeatureTile";
export { HeroSummaryCard } from "./HeroSummaryCard";
export type { StatTileProps, StatTileGridProps } from "./StatTile";
export type { ListRowProps } from "./ListRow";
export type { EmptyStateProps } from "./EmptyState";
export type { FeatureTileProps } from "./FeatureTile";
export type { HeroSummaryCardProps } from "./HeroSummaryCard";
```

- [ ] **Step 9.3: Add a HeroSummaryCard section to the gallery**

Append to `PrimitivesGallery.tsx`:

```tsx
import { HeroSummaryCard } from "@/components/shared/surfaces";
```

```tsx
<Section title="HeroSummaryCard">
  <HeroSummaryCard
    eyebrow="Welcome back, Tushar 👋"
    value={29}
    metric="Open Tasks"
    delta={{ value: "+12% this week", direction: "up" }}
    link={{ label: "View all", to: "/tasks" }}
  />
</Section>
```

- [ ] **Step 9.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/surfaces/HeroSummaryCard.tsx src/components/shared/surfaces/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `npm run dev` → `/dev/primitives`. Verify:
- Teal → violet gradient card renders
- Decorative circles visible top-right
- "29 / Open Tasks" reads cleanly in white
- Delta indicator + "View all →" pill at the bottom
- Soft brand-tinted shadow under the card

- [ ] **Step 9.5: Commit**

```bash
git add src/components/shared/surfaces src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add HeroSummaryCard for role dashboards

Big teal→violet gradient hero card with decorative floating circles,
big metric, optional delta indicator, and optional 'View all' pill link.
Used only on the Teacher Dashboard and Coordinator Dashboard — inner
pages stay focused on their actual content per the design spec."
```

---

# Phase 3 — Sheet foundation

## Task 10: MobileSheet + form-field CSS overrides

**Files:**
- Create: `src/components/shared/sheets/MobileSheet.tsx`
- Create: `src/components/shared/sheets/index.ts`
- Modify: `src/index.css` (add form-field overrides)
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 10.1: Add iOS time-field color overrides to `src/index.css`**

In `src/index.css`, append a new CSS block after the existing print styles (around line 220):

```css
/* === Form field overrides (Mobile UI Redesign) === */
/* iOS Safari renders <input type="time"> typed values in the system "datetime
   text" color which is invisible on white card surfaces. Force the value to
   ink-900 across all webkit datetime sub-controls. */
input[type="time"],
input[type="date"],
input[type="datetime-local"] {
  color: hsl(var(--ink-900));
}
input[type="time"]::-webkit-datetime-edit,
input[type="date"]::-webkit-datetime-edit,
input[type="datetime-local"]::-webkit-datetime-edit {
  color: hsl(var(--ink-900));
}
input[type="time"]::-webkit-datetime-edit-fields-wrapper,
input[type="date"]::-webkit-datetime-edit-fields-wrapper,
input[type="datetime-local"]::-webkit-datetime-edit-fields-wrapper {
  color: hsl(var(--ink-900));
}

/* Hide scrollbars on horizontal scroll-snap rows (used by MobileTabs, FilterRow). */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
```

- [ ] **Step 10.2: Create MobileSheet**

Create `src/components/shared/sheets/MobileSheet.tsx`:

```tsx
import * as React from "react";
import { X } from "lucide-react";

import { Sheet, SheetContent, SheetPortal, SheetOverlay } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MobileSheetAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export interface MobileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  primaryAction?: MobileSheetAction;
  secondaryAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
  className?: string;
}

/**
 * Bottom sheet for forms, multi-field flows, and detail views on mobile.
 * Built on shadcn Sheet (NOT Dialog) — the project's DialogContent fork
 * auto-wraps children in ScrollArea, which we don't want here because the
 * sheet manages its own scrollable body.
 *
 * Three regions: sticky header, scrollable body, sticky footer.
 * Includes safe-area inset bottom padding on the footer so the primary
 * action stays above the iOS home indicator.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  icon,
  primaryAction,
  secondaryAction,
  children,
  className,
}: MobileSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetOverlay className="bg-slate-900/40 backdrop-blur-sm" />
        <SheetContent
          side="bottom"
          className={cn(
            "p-0 max-h-[90dvh] flex flex-col",
            "rounded-t-3xl border-t border-surface-stroke",
            "bg-white",
            className,
          )}
        >
          {/* Grab handle */}
          <div className="flex justify-center pt-3 pb-1">
            <span className="block h-1 w-10 rounded-full bg-ink-400/30" />
          </div>

          {/* Sticky header */}
          <div className="flex items-start gap-3 px-5 pb-3 border-b border-surface-stroke">
            {icon && (
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                {icon}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-ink-900">{title}</h2>
              {subtitle && <p className="text-sm text-ink-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-400/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable body */}
          <div
            className="flex-1 overflow-y-auto overscroll-contain px-5 py-4"
            style={{ scrollPaddingBottom: "100px" }}
          >
            {children}
          </div>

          {/* Sticky footer */}
          {(primaryAction || secondaryAction) && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-5 py-4 border-t border-surface-stroke pb-[max(env(safe-area-inset-bottom),16px)]">
              {secondaryAction && (
                <Button
                  variant="ghost"
                  onClick={secondaryAction.onClick}
                  className="w-full sm:w-auto"
                >
                  {secondaryAction.label}
                </Button>
              )}
              {primaryAction && (
                <Button
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled || primaryAction.loading}
                  className="w-full sm:w-auto bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
                >
                  {primaryAction.loading ? "Working…" : primaryAction.label}
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}
```

- [ ] **Step 10.3: Create the sheets barrel export**

Create `src/components/shared/sheets/index.ts`:

```ts
export { MobileSheet } from "./MobileSheet";
export type { MobileSheetProps, MobileSheetAction } from "./MobileSheet";
```

- [ ] **Step 10.4: Add a MobileSheet section to the gallery**

Append to `PrimitivesGallery.tsx`:

```tsx
import { CalendarClock } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
```

Above the `return`, add a small wrapping component (place below the default export OR use a top-level state — the simplest path is to convert the default export to use state):

Modify `PrimitivesGallery` to declare state:

```tsx
export default function PrimitivesGallery() {
  const [sheetOpen, setSheetOpen] = React.useState(false);

  return (
    <PageShell>
      {/* …existing content… */}

      <Section title="MobileSheet">
        <button
          onClick={() => setSheetOpen(true)}
          className="rounded-xl bg-brand-primary px-4 py-2 text-white"
        >
          Open Schedule & Publish
        </button>
        <MobileSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          icon={<CalendarClock className="h-4 w-4" />}
          title="Schedule & publish"
          subtitle="Configure when and for how long the exam runs."
          primaryAction={{ label: "Publish exam", onClick: () => setSheetOpen(false) }}
          secondaryAction={{ label: "Cancel", onClick: () => setSheetOpen(false) }}
        >
          <form className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Exam date</label>
              <input type="date" className="block w-full h-11 rounded-xl border border-surface-stroke bg-white px-3 text-ink-900" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Start time</label>
                <input type="time" className="block w-full h-11 rounded-xl border border-surface-stroke bg-white px-3 text-ink-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Duration (min)</label>
                <input type="number" inputMode="numeric" defaultValue={60} className="block w-full h-11 rounded-xl border border-surface-stroke bg-white px-3 text-ink-900" />
              </div>
            </div>
          </form>
        </MobileSheet>
      </Section>
    </PageShell>
  );
}
```

- [ ] **Step 10.5: Validate**

```bash
npx tsc --noEmit
npx eslint src/index.css src/components/shared/sheets src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `npm run dev` → `/dev/primitives`. Verify on iPhone Safari (or DevTools mobile emulation):
- Press "Open Schedule & Publish" → sheet slides up from the bottom
- Grab handle visible at top, title + subtitle + close button in sticky header
- Body scrolls independently
- Time field shows the typed value in dark text (this is the bug fix — verify by typing into it; the value must be visible)
- Sticky footer: Cancel + Publish exam buttons
- Pulling the grab handle down ≥ 25% of sheet height closes the sheet
- Backdrop is dim with backdrop-blur

- [ ] **Step 10.6: Commit**

```bash
git add src/index.css src/components/shared/sheets src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add MobileSheet + iOS form-field overrides

MobileSheet: bottom sheet built on shadcn Sheet (not Dialog) with
sticky header, scrollable body, sticky footer with safe-area inset.
Drag-to-dismiss via Radix Dialog primitive.

Form-field CSS in index.css fixes the iOS Safari quirk where
<input type='time'>, <input type='date'>, and <input type='datetime-local'>
typed values render in invisible system color. Adds .scrollbar-hide
utility for the upcoming MobileTabs and FilterRow primitives."
```

---

# Phase 4 — Navigation primitives

## Task 11: MobileTabs

**Files:**
- Create: `src/components/shared/nav/MobileTabs.tsx`
- Create: `src/components/shared/nav/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 11.1: Create MobileTabs**

Create `src/components/shared/nav/MobileTabs.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface MobileTabOption {
  value: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export interface MobileTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  options: MobileTabOption[];
  /** "default" 40px (top-level tabs) or "compact" 32px (nested sub-tabs). */
  density?: "default" | "compact";
  className?: string;
}

/**
 * Horizontal scroll-snap row of pill tabs. Single source of truth for tab
 * strips on mobile across teacher / coordinator pages. Auto-scrolls the
 * active pill into view on mount and whenever `value` changes.
 *
 * Edge fade affordance on left/right via mask-image so users see "there's more".
 */
export function MobileTabs({
  value,
  onValueChange,
  options,
  density = "default",
  className,
}: MobileTabsProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const activeBtnRef = React.useRef<HTMLButtonElement | null>(null);

  // Auto-scroll the active pill into view (centered) on value change.
  React.useEffect(() => {
    if (!activeBtnRef.current) return;
    activeBtnRef.current.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value]);

  const sizeClasses =
    density === "compact"
      ? "h-8 px-3 text-[13px]"
      : "h-10 px-4 text-sm";

  return (
    <div
      className={cn("relative", className)}
      style={{
        // Edge-fade mask so content fades into the gradient backdrop on overflow.
        WebkitMaskImage: "linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)",
        maskImage: "linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)",
      }}
    >
      <div
        ref={containerRef}
        role="tablist"
        className="flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory px-1 py-1"
      >
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              ref={isActive ? activeBtnRef : null}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onValueChange(option.value)}
              className={cn(
                "snap-start shrink-0 inline-flex items-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors",
                sizeClasses,
                isActive
                  ? "bg-brand-primary text-white shadow-[0_4px_12px_-2px_hsl(var(--brand-primary)/0.4)]"
                  : "bg-transparent text-ink-600 hover:bg-ink-400/10",
              )}
            >
              {option.icon && <span className="shrink-0">{option.icon}</span>}
              <span>{option.label}</span>
              {typeof option.count === "number" && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums",
                    density === "compact" ? "h-4" : "h-5",
                    isActive ? "bg-white/20 text-white" : "bg-ink-400/15 text-ink-700",
                  )}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: Create the nav barrel export**

Create `src/components/shared/nav/index.ts`:

```ts
export { MobileTabs } from "./MobileTabs";
export type { MobileTabsProps, MobileTabOption } from "./MobileTabs";
```

- [ ] **Step 11.3: Add a MobileTabs section to the gallery**

Append to `PrimitivesGallery.tsx`:

```tsx
import { MobileTabs } from "@/components/shared/nav";
```

Add new state to the gallery component:

```tsx
const [tab, setTab] = React.useState("overview");
```

Then add the section JSX:

```tsx
<Section title="MobileTabs">
  <MobileTabs
    value={tab}
    onValueChange={setTab}
    options={[
      { value: "overview", label: "Overview" },
      { value: "to-me", label: "Assigned TO Me", count: 30 },
      { value: "by-me", label: "Assigned BY Me", count: 42 },
      { value: "supervising", label: "Supervising" },
      { value: "pending", label: "Pending" },
      { value: "completed", label: "Completed", count: 1 },
    ]}
  />
  <p className="text-xs text-ink-500">Active tab: <code className="rounded bg-ink-400/10 px-1.5 py-0.5">{tab}</code></p>

  <MobileTabs
    density="compact"
    value={tab}
    onValueChange={setTab}
    options={[
      { value: "overview", label: "Class Overview" },
      { value: "students", label: "Students" },
      { value: "recommendations", label: "Recommendations" },
    ]}
  />
</Section>
```

- [ ] **Step 11.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/nav src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `npm run dev` → `/dev/primitives` (mobile width). Verify:
- 6 pills render in a single row, scroll horizontally with snap
- Active pill is solid teal with white text, soft glow shadow
- Inactive pills have transparent background, slate text
- Edge fade visible on left/right when content is scrollable
- Click a pill → it becomes active and scrolls to center
- Programmatic value change ALSO auto-scrolls (verify by setting `tab` to a different value via the inactive pill)
- Compact density renders smaller, still functional
- Count badges render inside active and inactive pills correctly

- [ ] **Step 11.5: Commit**

```bash
git add src/components/shared/nav src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add MobileTabs scroll-snap pill component

Single horizontal scroll-snap row of pill tabs with auto-scroll-to-active,
edge-fade mask, optional count badges, and density variants. Replaces all
broken tab strips on mobile (TasksPage 6-tab wrap, EvaluationsPage 4-tab
2x2 grid, ReportsPage nested tabs, exam evaluation Student List clipping)."
```

---

## Task 12: FilterRow

**Files:**
- Create: `src/components/shared/nav/FilterRow.tsx`
- Modify: `src/components/shared/nav/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 12.1: Create FilterRow**

Create `src/components/shared/nav/FilterRow.tsx`:

```tsx
import * as React from "react";
import { ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface FilterChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  /** Override the chevron with a custom trailing element. */
  trailing?: React.ReactNode;
}

/**
 * Pill-shaped Select trigger. Use as the visible part of a shadcn Select,
 * or as a standalone button when paired with a popover/sheet.
 */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ label, active, onClick, className, trailing }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-2 h-10 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors",
          "bg-white/85 backdrop-blur-sm border",
          active
            ? "border-brand-primary text-brand-primary"
            : "border-surface-stroke text-ink-700 hover:bg-ink-400/5",
          className,
        )}
      >
        <span>{label}</span>
        {trailing ?? <ChevronDown className="h-4 w-4 shrink-0 text-ink-500" />}
      </button>
    );
  },
);
FilterChip.displayName = "FilterChip";

export interface FilterRowProps {
  /** Optional active filter count (drives the "Clear all" button visibility). */
  activeCount?: number;
  /** Callback for the "Clear all" affordance. Hidden if activeCount is 0/undefined. */
  onClear?: () => void;
  /** Pass FilterChip / shadcn Select / etc. as children — they sit in a horizontal scroll row on mobile. */
  children: React.ReactNode;
  className?: string;
}

export function FilterRow({ activeCount, onClear, children, className }: FilterRowProps) {
  const showClear = (activeCount ?? 0) > 0 && Boolean(onClear);
  return (
    <div className={cn("flex items-center gap-2 overflow-x-auto scrollbar-hide py-1", className)}>
      {children}
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-surface-stroke px-3 h-10 text-xs font-medium text-ink-600 hover:bg-ink-400/5"
        >
          <X className="h-3.5 w-3.5" />
          Clear all
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 12.2: Re-export**

Edit `src/components/shared/nav/index.ts`:

```ts
export { MobileTabs } from "./MobileTabs";
export { FilterRow, FilterChip } from "./FilterRow";
export type { MobileTabsProps, MobileTabOption } from "./MobileTabs";
export type { FilterRowProps, FilterChipProps } from "./FilterRow";
```

- [ ] **Step 12.3: Add a FilterRow section to the gallery**

Append to `PrimitivesGallery.tsx`:

```tsx
import { FilterRow, FilterChip } from "@/components/shared/nav";
```

```tsx
<Section title="FilterRow + FilterChip">
  <FilterRow
    activeCount={1}
    onClear={() => console.log("clear")}
  >
    <FilterChip label="All Classes" />
    <FilterChip label="Mathematics" active />
    <FilterChip label="Sort: Newest" />
  </FilterRow>
</Section>
```

- [ ] **Step 12.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/nav/FilterRow.tsx src/components/shared/nav/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `/dev/primitives` should show 3 chips + "Clear all" button. The active chip ("Mathematics") has a teal hairline border and teal text. The row scrolls horizontally if it overflows.

- [ ] **Step 12.5: Commit**

```bash
git add src/components/shared/nav src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add FilterRow + FilterChip primitives

Horizontal scroll-snap row of pill-shaped filter chips with optional
'Clear all' affordance. Used standalone for pages with ≤ 2 filters
(Teachers, Students) or paired with FilterSheet for pages with 3+
filters (Question Bank, Exams, Syllabus)."
```

---

## Task 13: FilterSheet

**Files:**
- Create: `src/components/shared/nav/FilterSheet.tsx`
- Modify: `src/components/shared/nav/index.ts`
- Modify: `src/pages/dev/PrimitivesGallery.tsx`

- [ ] **Step 13.1: Create FilterSheet**

Create `src/components/shared/nav/FilterSheet.tsx`:

```tsx
import * as React from "react";
import { Settings2 } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { cn } from "@/lib/utils";

export interface FilterSheetProps {
  /** How many filters are currently set away from default. Drives the trigger badge. */
  activeCount: number;
  /** Apply the pending filter selections — typically commits state into the parent. */
  onApply: () => void;
  /** Reset filters to defaults. */
  onReset: () => void;
  /** Sheet body — render whatever filter controls (Selects, Switches, RadioGroups) needed. */
  children: React.ReactNode;
  /** Override the trigger label (default "Filters"). */
  triggerLabel?: string;
  className?: string;
}

/**
 * Trigger + bottom sheet for pages with 3+ filters. The trigger renders
 * inline (e.g. inside a FilterRow) — when pressed, opens a MobileSheet
 * with the filter controls and a sticky [Reset] / [Apply] footer.
 */
export function FilterSheet({
  activeCount,
  onApply,
  onReset,
  children,
  triggerLabel = "Filters",
  className,
}: FilterSheetProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 h-10 rounded-full px-4 text-sm font-medium",
          "bg-white/85 backdrop-blur-sm border border-surface-stroke",
          "hover:bg-ink-400/5",
          activeCount > 0 && "border-brand-primary text-brand-primary",
          className,
        )}
      >
        <Settings2 className="h-4 w-4" />
        <span>{triggerLabel}</span>
        {activeCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-primary px-1.5 text-xs font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>

      <MobileSheet
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        primaryAction={{
          label: "Apply",
          onClick: () => {
            onApply();
            setOpen(false);
          },
        }}
        secondaryAction={{
          label: "Reset",
          onClick: onReset,
        }}
      >
        <div className="space-y-4">{children}</div>
      </MobileSheet>
    </>
  );
}
```

- [ ] **Step 13.2: Re-export**

Edit `src/components/shared/nav/index.ts`:

```ts
export { MobileTabs } from "./MobileTabs";
export { FilterRow, FilterChip } from "./FilterRow";
export { FilterSheet } from "./FilterSheet";
export type { MobileTabsProps, MobileTabOption } from "./MobileTabs";
export type { FilterRowProps, FilterChipProps } from "./FilterRow";
export type { FilterSheetProps } from "./FilterSheet";
```

- [ ] **Step 13.3: Add a FilterSheet section to the gallery**

Append to `PrimitivesGallery.tsx`:

```tsx
import { FilterSheet } from "@/components/shared/nav";
```

```tsx
<Section title="FilterSheet">
  <FilterRow>
    <FilterChip label="All Classes" />
    <FilterSheet
      activeCount={2}
      onApply={() => console.log("apply")}
      onReset={() => console.log("reset")}
    >
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Subject</label>
        <select className="block w-full h-11 rounded-xl border border-surface-stroke bg-white px-3">
          <option>Any</option>
          <option>Mathematics</option>
          <option>Science</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Question Type</label>
        <select className="block w-full h-11 rounded-xl border border-surface-stroke bg-white px-3">
          <option>Any</option>
          <option>Multiple Choice</option>
          <option>Short Answer</option>
        </select>
      </div>
    </FilterSheet>
  </FilterRow>
</Section>
```

- [ ] **Step 13.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/shared/nav/FilterSheet.tsx src/components/shared/nav/index.ts src/pages/dev/PrimitivesGallery.tsx
npx vite build
```

All exit 0. `/dev/primitives`. Verify:
- Filters trigger renders with teal hairline + count badge "2"
- Click trigger → MobileSheet opens with Subject + Question Type controls
- Sticky footer: Reset (ghost) + Apply (solid teal)
- Apply closes the sheet; Reset stays open

- [ ] **Step 13.5: Commit**

```bash
git add src/components/shared/nav src/pages/dev/PrimitivesGallery.tsx
git commit -m "feat(ui): add FilterSheet for filter-heavy pages

Trigger pill + bottom-sheet pattern for pages with 3+ filters.
Replaces the stacked-dropdown disaster on Question Bank, Exams,
and Syllabus pages where 3 full-width Selects ate half the
viewport before any data showed."
```

---

# Phase 5 — Apply primitives to pages (worst-pain order)

> **Important constraint for every Phase 5 task:** the diff must be UI-only. Hooks (`useQuery`, `useMutation`, custom hooks), prop signatures, route paths, event handlers, business logic, and data flow MUST stay byte-identical. The only changes permitted are: JSX structure, classNames, component swaps from raw markup → shared primitives, imports added/removed accordingly. If a task seems to require touching a hook, stop and re-scope.
>
> **Per-task validation:** after edits, run `npx tsc --noEmit`, `npx eslint <touched-paths>`, `npx vite build` — each must exit 0. Then real-device test on iPhone Safari (the device the original screenshots came from), confirming every circled issue from the original screenshots is resolved AND no other functionality regressed.

## Task 14: Tasks page redesign

**Files:**
- Modify: `src/pages/TasksPage.tsx`

**Source images covered:** 6, 7, 17, 18

- [ ] **Step 14.1: Read the existing file end-to-end**

```bash
# Open the file. Note: total line count, where hooks live, where JSX returns,
# what state variables hold. Make a mental map. Do NOT change anything yet.
```

Specifically identify:
- All `useQuery` / `useMutation` / `useState` / `useEffect` calls (these stay untouched)
- The top-level JSX `return(...)` and where the page wraps content
- Where the 5 stat cards are rendered (they will become `StatTileGrid`)
- Where the tab strip is rendered (currently broken — replaces with `MobileTabs`)
- Where the FAB / "+ Assign Task" lives (will become `MobileFab`)
- Where the header buttons live (will become `PageHeader` with `ActionMenu`)

- [ ] **Step 14.2: Add the imports for the new primitives**

At the top of `src/pages/TasksPage.tsx`, add (alongside existing imports):

```tsx
import { Plus, Inbox, ClipboardList, Clock, Eye, CheckCircle2, AlertCircle, Building2, Users } from "lucide-react";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
```

> Adjust the `lucide-react` import if some icons are already imported elsewhere in the file — never duplicate imports. Use whichever icon names already exist for the existing stat cards if they're conceptually right; otherwise pick from the list above.

- [ ] **Step 14.3: Replace the page wrapper + header**

Locate the outermost `return(...)` JSX block. Replace the wrapper with `PageShell` + `PageHeader`. Pseudo-shape (adapt to whatever the existing JSX is named — keep all data-binding props identical):

```tsx
const tabs: MobileTabOption[] = React.useMemo(
  () => [
    { value: "overview", label: "Overview", icon: <Building2 className="h-4 w-4" /> },
    { value: "to-me", label: "Assigned TO Me", count: assignedToMeCount },
    { value: "by-me", label: "Assigned BY Me", count: assignedByMeCount },
    { value: "supervising", label: "Supervising", icon: <Eye className="h-4 w-4" /> },
    { value: "pending", label: "Pending", icon: <AlertCircle className="h-4 w-4" /> },
    { value: "completed", label: "Completed", icon: <CheckCircle2 className="h-4 w-4" /> },
  ],
  [assignedToMeCount, assignedByMeCount],
);

return (
  <PageShell
    fab={
      <MobileFab
        label="Assign Task"
        icon={<Plus className="h-6 w-6" />}
        onClick={handleAssignTask}
      />
    }
  >
    <PageHeader
      icon={<ClipboardList className="h-5 w-5" />}
      title="Tasks"
      subtitle="Manage your assigned tasks and approvals"
      primaryAction={{
        label: "Assign Task",
        icon: <Plus className="h-4 w-4" />,
        onClick: handleAssignTask,
      }}
      secondaryActions={[
        {
          label: "Workforce Overview",
          icon: <Users className="h-4 w-4" />,
          onClick: handleWorkforceOverview,
        },
      ]}
    />

    <StatTileGrid mdCols={3} lgCols={6} className="mt-2">
      <StatTile label="Wing Tasks" value={wingTasksCount} icon={<Building2 className="h-5 w-5" />} tone="violet" />
      <StatTile label="Open" value={openCount} icon={<Inbox className="h-5 w-5" />} tone="peach" />
      <StatTile label="In Progress" value={inProgressCount} icon={<Clock className="h-5 w-5" />} tone="sky" />
      <StatTile label="Pending" value={pendingCount} icon={<AlertCircle className="h-5 w-5" />} tone="peach" />
      <StatTile label="Supervising" value={supervisingCount} icon={<Eye className="h-5 w-5" />} tone="violet" />
      <StatTile label="Completed" value={completedCount} icon={<CheckCircle2 className="h-5 w-5" />} tone="mint" />
    </StatTileGrid>

    <div className="mt-6 sticky top-[var(--app-bar-height,64px)] z-20 -mx-4 px-4 py-2 surface-gradient">
      <MobileTabs value={activeTab} onValueChange={setActiveTab} options={tabs} />
    </div>

    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-2 sm:p-4 space-y-2" data-sticky-bottom>
      {tasksForActiveTab.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          tone="teal"
          title="No active tasks"
          description="When tasks are assigned to you they will appear here."
          action={{
            label: "Assign Task",
            icon: <Plus className="h-4 w-4" />,
            onClick: handleAssignTask,
          }}
        />
      ) : (
        <ul className="list-none p-0 space-y-2">
          {tasksForActiveTab.map((task) => (
            <ListRow
              key={task.id}
              as="li"
              leading={
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                  <ClipboardList className="h-5 w-5" />
                </span>
              }
              title={task.title}
              subtitle={`${task.category} · Due ${formatDueDate(task.dueDate)}`}
              trailing={<TaskStatusPill status={task.status} />}
              onClick={() => openTaskDetail(task.id)}
            />
          ))}
        </ul>
      )}
    </div>
  </PageShell>
);
```

> **Substitute the variable names** (e.g. `assignedToMeCount`, `tasksForActiveTab`, `handleAssignTask`, `TaskStatusPill`, `formatDueDate`) with whatever the existing file uses. The primitives are placeholders for the structure; the data and handlers come from the existing hooks. NEVER invent new hooks or rename existing ones.

> **Why `data-sticky-bottom` on the list container?** So the FAB auto-hides when the empty-state CTA is in viewport, preventing the "+ Assign Task" double-CTA collision visible in Image 16 (and the equivalent on this page).

- [ ] **Step 14.4: Remove old markup**

Delete the original full-bleed colored stat-card stack, the broken tab strip, and any inline "+" button row in the header — they're all replaced by the primitives above. Keep all other JSX (modals, drawers, toasts) untouched.

- [ ] **Step 14.5: Validate**

```bash
npx tsc --noEmit
npx eslint src/pages/TasksPage.tsx
npx vite build
```

All exit 0. Real-iPhone-Safari check:
- Page width fits viewport, NO horizontal scroll (Image 6 root cause fixed)
- Stat tiles render in 2-col grid mobile, 3-col tablet, 6-col wide desktop — neutral cards, brand-tinted icon discs, no full-bleed colors
- Tab strip is single row, scrolls horizontally with snap, active "Overview" pill in solid teal
- Pressing each tab updates the list below; the active pill auto-scrolls to center
- "+ Assign Task" FAB pinned bottom-right, auto-hides when scrolled to the empty-state CTA
- Header has the title + subtitle + kebab containing "Workforce Overview"
- Primary "+ Assign Task" CTA never clips (Image 17 root cause fixed)

- [ ] **Step 14.6: Commit**

```bash
git add src/pages/TasksPage.tsx
git commit -m "feat(ui): redesign Tasks page with shared mobile primitives

Apply PageShell, PageHeader, StatTileGrid, MobileTabs, ListRow,
EmptyState, MobileFab. Resolves the worst-offender screen issues:
- Horizontal page overflow that clipped stat values on the left
- 6-tab strip wrapping to 3 rows
- '+ Assign Task' primary CTA clipping in the header
- Loud full-bleed colored stat-card stack consuming the whole fold

No business logic changes — hooks, queries, mutations, props all
preserved byte-identical.

Refs: Images 6, 7, 17, 18 from the redesign brief."
```

---

## Task 15: Schedule & Publish sheet redesign

**Files:**
- Modify: `src/components/exam-creation/screens/ReviewPublishScreen.tsx`

**Source image covered:** 4

- [ ] **Step 15.1: Read the file end-to-end**

Identify:
- The current sheet/dialog wrapper (likely shadcn Dialog, vaul Drawer, or custom)
- All form-state hooks, validation logic, mutation calls (preserved untouched)
- The Date / Start time / Duration / Late entry / Result visibility fields
- Where the publish/cancel buttons live

- [ ] **Step 15.2: Add imports**

```tsx
import { CalendarClock } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
```

- [ ] **Step 15.3: Replace the sheet wrapper with MobileSheet**

Replace the existing wrapper (Dialog/Drawer/etc.) with `MobileSheet`, keeping every form field, label, validation message, and onChange handler in place. Pseudo-shape:

```tsx
return (
  <MobileSheet
    open={open}
    onOpenChange={onOpenChange}
    icon={<CalendarClock className="h-4 w-4" />}
    title="Schedule & publish"
    primaryAction={{
      label: "Publish exam",
      onClick: handlePublish,
      loading: isPublishing,
      disabled: !canPublish,
    }}
    secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
  >
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Exam date</label>
        {/* existing date picker control unchanged */}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">Start time</label>
          {/* existing <Input type="time"> control unchanged — the iOS color
              fix lives in src/index.css and applies automatically */}
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">Duration (min)</label>
          {/* existing duration <Input type="number" inputMode="numeric"> unchanged */}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Late entry</label>
        {/* existing late-entry control unchanged */}
        <p className="mt-1 text-xs text-ink-500">
          How many minutes after the start time can students still join? Each student gets the full duration from when they enter.
        </p>
      </div>

      <div>
        <p className="text-sm font-medium text-ink-700 mb-2">Result visibility</p>
        {/* existing radio-group / fieldset controls unchanged */}
      </div>
    </div>
  </MobileSheet>
);
```

- [ ] **Step 15.4: Validate**

```bash
npx tsc --noEmit
npx eslint src/components/exam-creation/screens/ReviewPublishScreen.tsx
npx vite build
```

All exit 0. Real-iPhone-Safari check:
- Open the sheet → slides up from the bottom with grab handle, sticky header (calendar icon + "Schedule & publish" + close `×`)
- Tap Start time field, type a value → the value is VISIBLE in dark text (Image 4 root cause fixed)
- Sticky footer never scrolls out of reach when the keyboard is up
- Publish exam button shows loading state when pressed
- Cancel closes the sheet
- All existing validation messages still render where they did before

- [ ] **Step 15.5: Commit**

```bash
git add src/components/exam-creation/screens/ReviewPublishScreen.tsx
git commit -m "feat(ui): rebuild Schedule & Publish on MobileSheet

Replace the prior sheet/dialog wrapper with MobileSheet (sticky
header + scrollable body + sticky footer with safe-area insets).
The Start time field bug from Image 4 — invisible value on iOS
Safari — is fixed by the form-field color overrides in
src/index.css added in Phase 3, which apply automatically here.

No publish-flow logic, validation, or mutations changed."
```

---

## Task 16: Task detail redesign

**Files:**
- Modify: the file containing the Task detail view (typically a dialog, modal, or sub-route inside `src/pages/TasksPage.tsx`, or a child component under `src/components/tasks/`)

**Source images covered:** 8, 9

- [ ] **Step 16.1: Locate the task-detail surface**

Search for the existing markup. Likely candidates:

```bash
# In Bash:
# Look for the labels visible in the screenshots:
grep -rn "Assigned By" src/pages/TasksPage.tsx src/components/tasks/ 2>/dev/null
grep -rn "Mark as Done" src/pages/TasksPage.tsx src/components/tasks/ 2>/dev/null
grep -rn "Add Evidence" src/pages/TasksPage.tsx src/components/tasks/ 2>/dev/null
```

Use the Grep tool (in this codebase) to locate the file. Read it end-to-end before editing.

- [ ] **Step 16.2: Wrap the detail view with MobileSheet on mobile, full-route on desktop**

Two cases:

**Case A — currently rendered as a dialog/sheet:** swap the wrapper for `MobileSheet`. Keep the body content identical structurally, just restyle the section headers using `text-base font-semibold text-ink-900`.

**Case B — currently rendered as an inline panel:** introduce conditional rendering — on `<lg`, use `MobileSheet`; on `≥ lg`, keep the existing inline panel (since desktop has room).

Either way, the body should look like:

```tsx
<div className="space-y-5">
  {/* Title pill row */}
  <div className="flex items-start justify-between gap-3">
    <div className="space-y-1 min-w-0">
      <h3 className="text-xl font-semibold text-ink-900 truncate">{task.title}</h3>
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">
        {task.category}
      </span>
    </div>
    <TaskStatusPill status={task.status} />
  </div>

  {/* Overdue alert (existing) */}
  {task.overdue && (
    <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-rose-700">
      <AlertCircle className="h-5 w-5 shrink-0" />
      <p className="text-sm font-medium">This task is overdue</p>
    </div>
  )}

  {/* Meta — 2-col at >= 380px, 1-col below */}
  <div className="grid grid-cols-1 [@media(min-width:380px)]:grid-cols-2 gap-4">
    <MetaPair label="Assigned By" icon={<User className="h-4 w-4" />} value={task.assignedBy} />
    <MetaPair label="Assigned To" icon={<User className="h-4 w-4" />} value={task.assignedTo} />
    <MetaPair label="Due Date" icon={<Calendar className="h-4 w-4" />} value={formatDate(task.dueDate)} highlight={task.overdue ? "rose" : "default"} />
    <MetaPair label="Created" icon={<Clock className="h-4 w-4" />} value={formatDate(task.createdAt)} />
  </div>

  {/* Evidence */}
  <div className="space-y-2">
    <h4 className="text-sm font-semibold text-ink-700">Evidence</h4>
    {/* existing evidence list rendered as ListRow items */}
    <button onClick={onAddEvidence} className="…ghost button styling…">+ Add Evidence</button>
  </div>

  {/* Comments */}
  <div className="space-y-2">
    <h4 className="text-sm font-semibold text-ink-700">Comments ({comments.length})</h4>
    {comments.length === 0 ? (
      <EmptyState icon={<MessageCircle className="h-7 w-7" />} tone="violet" title="No comments yet" />
    ) : (
      <ul className="space-y-2 list-none p-0">
        {comments.map((c) => (<CommentItem key={c.id} comment={c} />))}
      </ul>
    )}
  </div>
</div>
```

Define a small local `MetaPair` component near the top of the file (do not create a new shared primitive — this shape only exists for task detail):

```tsx
function MetaPair({
  label,
  icon,
  value,
  highlight = "default",
}: {
  label: string;
  icon?: React.ReactNode;
  value: React.ReactNode;
  highlight?: "default" | "rose";
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">{label}</p>
      <p className={cn(
        "inline-flex items-center gap-2 text-sm",
        highlight === "rose" ? "text-rose-600" : "text-ink-700",
      )}>
        {icon}
        <span>{value}</span>
      </p>
    </div>
  );
}
```

The primary action ("Mark as Done") moves into MobileSheet's sticky footer:

```tsx
primaryAction={{
  label: "Mark as Done",
  icon: <Send className="h-4 w-4" />,
  onClick: handleMarkAsDone,
  disabled: task.status === "completed",
}}
```

The "Done" badge floating awkwardly at the top (Image 9) is REMOVED — the sticky-footer button is the single source of truth for completion state.

- [ ] **Step 16.3: Validate**

```bash
npx tsc --noEmit
npx eslint <touched-paths>
npx vite build
```

All exit 0. Real-iPhone-Safari check:
- Open a task → MobileSheet slides up
- All labels are FULLY visible (Image 8 root cause fixed — labels no longer cut off on the left)
- "Mark as Done" lives in the sticky footer at the bottom, not floating at the top
- The overdue alert renders cleanly in rose-50 with rose-200 border
- Comments empty state renders illustratively
- Pressing Mark as Done calls the existing handler; sheet closes after success

- [ ] **Step 16.4: Commit**

```bash
git add <touched-paths>
git commit -m "feat(ui): rebuild Task Detail on MobileSheet

Resolves Image 8 (horizontal overflow / cut-off 'Assigned By', 'Due Date',
'Evidence' labels) and Image 9 (floating 'Done' badge near status bar).
Single column under 380px, 2-col grid above. Mark-as-Done moves into
the sticky-footer primary action so it can never scroll out of reach.

No state, mutation, or query changes."
```

---

## Task 17: Teachers list redesign — `SchoolTeachersPage`

**Files:**
- Modify: `src/pages/school/SchoolTeachersPage.tsx`

**Source images covered:** 1, 21

- [ ] **Step 17.1: Read end-to-end, locate hook calls + handlers**

- [ ] **Step 17.2: Replace wrapper + header + stats + list + FAB**

Add imports:

```tsx
import { Plus, Upload, FileDown, ListChecks, GraduationCap, Users, BookOpen, Layers } from "lucide-react";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
```

Replace the top-level return with:

```tsx
return (
  <PageShell
    fab={
      <MobileFab
        label="Add Teacher"
        icon={<Plus className="h-6 w-6" />}
        onClick={handleAddTeacher}
      />
    }
  >
    <PageHeader
      icon={<GraduationCap className="h-5 w-5" />}
      title="Teachers"
      subtitle="Manage your school's teaching staff"
      primaryAction={{
        label: "Add Teacher",
        icon: <Plus className="h-4 w-4" />,
        onClick: handleAddTeacher,
      }}
      secondaryActions={[
        { label: "Assign Task to All", icon: <ListChecks className="h-4 w-4" />, onClick: handleAssignTaskAll },
        { label: "Generate Report", icon: <FileDown className="h-4 w-4" />, onClick: handleGenerateReport },
        { label: "Bulk Upload", icon: <Upload className="h-4 w-4" />, onClick: handleBulkUpload },
      ]}
    />

    <StatTileGrid mdCols={3}>
      <StatTile label="Total Teachers" value={totalTeachers} icon={<Users className="h-5 w-5" />} tone="teal" />
      <StatTile label="Total Classes" value={totalClasses} icon={<Layers className="h-5 w-5" />} tone="violet" />
      <StatTile label="Subjects Covered" value={subjectsCovered} icon={<BookOpen className="h-5 w-5" />} tone="mint" />
    </StatTileGrid>

    {/* Search + filter row */}
    <div className="mt-6 space-y-3">
      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search teachers..." />
      <FilterRow activeCount={selectedClass ? 1 : 0} onClear={() => setSelectedClass(null)}>
        <FilterChip
          label={selectedClass ?? "All Classes"}
          active={Boolean(selectedClass)}
          onClick={openClassFilter}
        />
      </FilterRow>
    </div>

    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
      <h2 className="text-base font-semibold text-ink-900">Teachers List</h2>
      {teachers.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-7 w-7" />}
          title="No teachers yet"
          description="Add teachers to start assigning classes and subjects."
          action={{
            label: "Add Teacher",
            icon: <Plus className="h-4 w-4" />,
            onClick: handleAddTeacher,
          }}
        />
      ) : (
        <ul className="list-none p-0 space-y-2">
          {teachers.map((t) => (
            <ListRow
              key={t.id}
              as="li"
              leading={
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary text-sm font-semibold">
                  {getInitials(t.full_name)}
                </span>
              }
              title={t.full_name}
              subtitle={`${t.email} · ${t.subjects?.length ?? 0} subjects`}
              onClick={() => navigateToTeacherDetail(t.id)}
            />
          ))}
        </ul>
      )}
    </div>
  </PageShell>
);
```

> Substitute names (`teachers`, `totalTeachers`, `selectedClass`, `getInitials`, etc.) with whatever the existing code uses. Search input — if there's an existing `<Input>` with a search icon, keep its component but ensure it has `className="h-11 rounded-xl"` for consistency. If you can't easily reuse, inline `<Input className="h-11 rounded-xl" placeholder="Search teachers..." value={searchQuery} onChange={...} />`.

- [ ] **Step 17.3: Validate + real-device check**

Standard `tsc / eslint / vite build` triple zero. iPhone Safari:
- Header layout clean with kebab on mobile (Image 1 fixed)
- FAB at bottom-right, NOT mid-page (Image 21 fixed)
- 3 neutral stat tiles in a row, not the loud blue/purple/green stack
- Empty state illustrative when zero teachers

- [ ] **Step 17.4: Commit**

```bash
git add src/pages/school/SchoolTeachersPage.tsx
git commit -m "feat(ui): redesign Teachers list with shared primitives

Apply PageShell, PageHeader+ActionMenu (kebab), StatTileGrid, ListRow,
EmptyState, FilterRow, MobileFab. Resolves header-action overload
('+ Add Teacher' clipping), mid-viewport FAB bug (Image 21), and
the loud full-bleed stat-card stack.

No business logic changes."
```

---

## Task 18: Reports & Analytics redesign

**Files:**
- Modify: `src/pages/EvaluationsPage.tsx` OR the reports page (locate by title text "Reports & Analytics" via Grep)

**Source images covered:** 19, 20

- [ ] **Step 18.1: Locate the file via Grep**

```bash
# In tooling: Grep for "Reports & Analytics" or "Teacher Overview"
```

- [ ] **Step 18.2: Add imports + apply primitives**

```tsx
import { BarChart3, FileText, Target, Award, Clock, Zap, AlertTriangle, TrendingUp, Star, Download } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
```

Structure:

```tsx
return (
  <PageShell>
    <PageHeader
      icon={<BarChart3 className="h-5 w-5" />}
      title="Reports & Analytics"
      subtitle="Comprehensive reports with charts, insights, and export options"
    />

    {/* Top-level tabs (replaces the broken 2x2 grid) */}
    <div className="mt-2 sticky top-[var(--app-bar-height,64px)] z-20 -mx-4 px-4 py-2 surface-gradient">
      <MobileTabs
        value={topTab}
        onValueChange={setTopTab}
        options={[
          { value: "teacher", label: "Teacher Overview" },
          { value: "exam", label: "Exam Reports" },
          { value: "class", label: "Class Reports" },
          { value: "student", label: "Student Reports" },
        ]}
      />
    </div>

    {/* Teaching Insights Dashboard summary card (existing, restyled) */}
    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-5 space-y-3">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-ink-900">Teaching Insights Dashboard</h2>
        <p className="text-sm text-ink-500">{coordinatorMeta}</p>
      </div>
      <button
        onClick={onDownloadReport}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
      >
        <Download className="h-4 w-4" />
        Download Report
      </button>
    </div>

    {/* Primary metrics grid */}
    <StatTileGrid mdCols={4} className="mt-6">
      <StatTile label="Subject Class Average" value={`${avgPct.toFixed(1)}%`} icon={<Target className="h-5 w-5" />} tone="sky" delta={avgDelta} />
      <StatTile label="Top Performer" value={`${topPct.toFixed(1)}%`} icon={<Award className="h-5 w-5" />} tone="peach" />
      <StatTile label="Avg Time/Question" value={`${avgTime.toFixed(1)}s`} icon={<Clock className="h-5 w-5" />} tone="mint" />
      <StatTile label="Class Efficiency" value={efficiency.toFixed(2)} icon={<Zap className="h-5 w-5" />} tone="violet" />
    </StatTileGrid>

    {/* Performance buckets */}
    <StatTileGrid mdCols={3} className="mt-3">
      <StatTile label="Needs Attention" value={needsAttention} icon={<AlertTriangle className="h-5 w-5" />} tone="rose" />
      <StatTile label="Developing" value={developing} icon={<TrendingUp className="h-5 w-5" />} tone="peach" />
      <StatTile label="Stable" value={stable} icon={<Star className="h-5 w-5" />} tone="mint" />
    </StatTileGrid>

    {/* Nested sub-tabs */}
    <div className="mt-6 surface-card frosted-shadow rounded-2xl p-4 space-y-4">
      <MobileTabs
        density="compact"
        value={subTab}
        onValueChange={setSubTab}
        options={[
          { value: "overview", label: "Class Overview" },
          { value: "students", label: "Students" },
          { value: "recommendations", label: "Recommendations" },
        ]}
      />
      <div>{/* existing chart / table content for the active sub-tab — unchanged */}</div>
    </div>
  </PageShell>
);
```

- [ ] **Step 18.3: Validate + real-device**

iPhone Safari:
- Top tabs in single-row scroll-snap (Image 19 fix — no more 2x2 grid)
- Sub-tabs render with compact density
- Stat tiles use neutral cards
- Download Report is now a small inline button, not a giant CTA

- [ ] **Step 18.4: Commit**

```bash
git add <touched-paths>
git commit -m "feat(ui): redesign Reports & Analytics

Replace broken 2x2 top-tab grid with MobileTabs scroll-snap row.
Compact-density nested tabs for the inner Class Overview / Students /
Recommendations strip. StatTileGrid for primary metrics + performance
buckets. No data fetching or chart logic changes."
```

---

## Task 19: Question Bank redesign — `QuestionBankPage`

**Files:**
- Modify: `src/pages/admin/QuestionBankPage.tsx`

**Source images covered:** 2, 15

- [ ] **Step 19.1: Add imports + apply primitives**

```tsx
import { Plus, BookOpen, Layers, BarChart3 } from "lucide-react";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip, FilterSheet } from "@/components/shared/nav";
```

- [ ] **Step 19.2: Replace top-level return**

```tsx
return (
  <PageShell
    fab={
      <MobileFab
        label="Add Question"
        icon={<Plus className="h-6 w-6" />}
        onClick={handleAddQuestion}
      />
    }
  >
    <PageHeader
      icon={<BookOpen className="h-5 w-5" />}
      title="Question Bank"
      subtitle="Browse and manage the question pool"
      primaryAction={{
        label: "Add Question",
        icon: <Plus className="h-4 w-4" />,
        onClick: handleAddQuestion,
      }}
    />

    <StatTileGrid mdCols={3}>
      <StatTile label="Total Questions" value={totalQuestions} icon={<BookOpen className="h-5 w-5" />} tone="mint" />
      <StatTile label="Question Types" value={questionTypes} icon={<Layers className="h-5 w-5" />} tone="sky" />
      <StatTile label="Average Marks" value={avgMarks.toFixed(1)} icon={<BarChart3 className="h-5 w-5" />} tone="peach" />
    </StatTileGrid>

    <div className="mt-6 space-y-3">
      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search questions..." />
      <FilterRow activeCount={activeFilterCount} onClear={resetFilters}>
        <FilterChip
          label={selectedClass ?? "All Classes"}
          active={Boolean(selectedClass)}
          onClick={openClassFilter}
        />
        <FilterSheet
          activeCount={Math.max(0, activeFilterCount - (selectedClass ? 1 : 0))}
          onApply={applyPendingFilters}
          onReset={resetPendingFilters}
        >
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Subject</label>
            {/* existing subject Select control */}
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Question Type</label>
            {/* existing type Select control */}
          </div>
        </FilterSheet>
      </FilterRow>
    </div>

    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
      <h2 className="text-base font-semibold text-ink-900">Custom Questions</h2>
      <p className="text-sm text-ink-500">Institution-specific questions</p>
      {questions.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-7 w-7" />}
          variant="noResults"
          title="No questions found"
          description="Try adjusting your filters or add new questions."
        />
      ) : (
        <ul className="list-none p-0 space-y-2">
          {questions.map((q) => (
            <ListRow
              key={q.id}
              as="li"
              leading={
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                  <BookOpen className="h-5 w-5" />
                </span>
              }
              title={truncate(q.text, 80)}
              subtitle={`${q.type} · ${q.subject_name}`}
              onClick={() => openQuestionDetail(q.id)}
            />
          ))}
        </ul>
      )}
    </div>
  </PageShell>
);
```

- [ ] **Step 19.3: Validate + real-device**

iPhone Safari:
- Triple-stacked dropdowns gone (Image 2, 15 fixed)
- One inline "All Classes" chip + Filters sheet trigger with count badge
- Stat tiles compact and neutral

- [ ] **Step 19.4: Commit**

```bash
git add src/pages/admin/QuestionBankPage.tsx
git commit -m "feat(ui): redesign Question Bank with FilterRow + FilterSheet

Replace the triple-stacked dropdown disaster with one inline chip
('All Classes') + a Filters sheet trigger that opens a MobileSheet
for the remaining Subject + Question Type filters. Apply
StatTileGrid, ListRow, EmptyState, MobileFab. No mutation or
query changes."
```

---

## Task 20: Exams list redesign

**Files:**
- Modify: the Exams page (locate via Grep on "No drafts yet" — likely `src/pages/ExamsPage.tsx`)

**Source image covered:** 16

- [ ] **Step 20.1: Locate file**

```bash
# Grep on "No drafts yet" — the file with this text is the target.
```

- [ ] **Step 20.2: Apply primitives**

```tsx
import { Plus, FileText, LayoutGrid, List as ListIcon } from "lucide-react";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip, FilterSheet } from "@/components/shared/nav";
```

```tsx
return (
  <PageShell
    fab={
      <MobileFab
        label="Create Exam"
        icon={<Plus className="h-6 w-6" />}
        onClick={handleCreateExam}
        hideWhen={isEmptyState}
      />
    }
  >
    <PageHeader
      icon={<FileText className="h-5 w-5" />}
      title="Exams"
      subtitle="Create, schedule, and review exams"
      primaryAction={{
        label: "Create Exam",
        icon: <Plus className="h-4 w-4" />,
        onClick: handleCreateExam,
      }}
    />

    {/* Compact draft strip — replaces the giant 'No drafts yet' empty card */}
    {hasDrafts && (
      <div className="surface-card frosted-shadow rounded-2xl p-4 flex items-center justify-between gap-3 mt-2">
        <div className="space-y-0.5 min-w-0">
          <p className="text-sm font-medium text-ink-900">{draftCount} draft{draftCount === 1 ? "" : "s"}</p>
          <p className="text-xs text-ink-500">Pick up where you left off.</p>
        </div>
        <button onClick={openDrafts} className="text-sm font-medium text-brand-primary">View →</button>
      </div>
    )}

    <div className="mt-4 space-y-3">
      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search exams..." />
      <FilterRow activeCount={activeFilterCount} onClear={resetFilters}>
        <FilterChip
          label={selectedExamType ?? "All Exams"}
          active={Boolean(selectedExamType)}
          onClick={openTypeFilter}
        />
        <FilterSheet
          activeCount={Math.max(0, activeFilterCount - (selectedExamType ? 1 : 0))}
          onApply={applyPendingFilters}
          onReset={resetPendingFilters}
        >
          {/* existing All / sort filter controls */}
        </FilterSheet>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-surface-stroke bg-white/85 backdrop-blur-sm p-0.5">
          <button
            onClick={() => setView("grid")}
            aria-pressed={view === "grid"}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full",
              view === "grid" ? "bg-brand-primary text-white" : "text-ink-500",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full",
              view === "list" ? "bg-brand-primary text-white" : "text-ink-500",
            )}
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </FilterRow>
    </div>

    {/* Body */}
    {exams.length === 0 ? (
      <div className="mt-4 surface-card frosted-shadow rounded-2xl" data-sticky-bottom>
        <EmptyState
          icon={<FileText className="h-7 w-7" />}
          title="No exams found"
          description="Create your first exam to get started."
          action={{
            label: "Create Exam",
            icon: <Plus className="h-4 w-4" />,
            onClick: handleCreateExam,
          }}
        />
      </div>
    ) : view === "grid" ? (
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {exams.map((e) => (<ExamGridCard key={e.id} exam={e} onClick={() => openExam(e.id)} />))}
      </div>
    ) : (
      <ul className="mt-4 list-none p-0 space-y-2">
        {exams.map((e) => (
          <ListRow
            key={e.id}
            as="li"
            leading={<span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary"><FileText className="h-5 w-5" /></span>}
            title={e.name}
            subtitle={`${e.subject_name} · ${formatDate(e.scheduled_at)}`}
            onClick={() => openExam(e.id)}
          />
        ))}
      </ul>
    )}
  </PageShell>
);
```

- [ ] **Step 20.3: Validate + real-device**

iPhone Safari:
- Filter row no longer 3-stacked dropdowns (Image 16 fixed)
- View toggle visible and functional
- Empty state with single inline CTA; FAB hides because `hideWhen={isEmptyState}` AND `data-sticky-bottom`
- No double-CTA collision

- [ ] **Step 20.4: Commit**

```bash
git add <touched-paths>
git commit -m "feat(ui): redesign Exams list

Replace stacked filter dropdowns with FilterRow + FilterSheet, fix
the FAB / empty-state CTA collision via hideWhen + data-sticky-bottom,
compact draft strip replaces the fold-hogging 'No drafts yet' card."
```

---

## Task 21: Syllabus & Materials redesign — `SchoolSyllabusPage`

**Files:**
- Modify: `src/pages/school/SchoolSyllabusPage.tsx`

**Source images covered:** 3, 10, 13, 14

- [ ] **Step 21.1: Add imports + apply primitives**

```tsx
import { Plus, BookOpen, GraduationCap, Layers, FileText, Maximize2, Network, LayoutGrid } from "lucide-react";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
```

- [ ] **Step 21.2: Replace top-level return**

```tsx
return (
  <PageShell
    fab={
      <MobileFab
        label="Add New"
        icon={<Plus className="h-6 w-6" />}
        onClick={handleAddNew}
      />
    }
  >
    <PageHeader
      icon={<BookOpen className="h-5 w-5" />}
      title="Syllabus & Study Materials"
      subtitle="View and manage syllabus for your assigned classes"
      primaryAction={{
        label: "Add New",
        icon: <Plus className="h-4 w-4" />,
        onClick: handleAddNew,
      }}
    />

    {/* Tree/Panel toggle as a Segmented control — NOT a stat tile */}
    <div className="flex items-center justify-between gap-3 mt-2">
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(v) => v && setView(v as "tree" | "panel")}
        className="rounded-full border border-surface-stroke bg-white/85 backdrop-blur-sm p-0.5"
      >
        <ToggleGroupItem value="tree" className="rounded-full px-4 h-9 data-[state=on]:bg-brand-primary data-[state=on]:text-white">
          <Network className="h-4 w-4 mr-1" /> Tree
        </ToggleGroupItem>
        <ToggleGroupItem value="panel" className="rounded-full px-4 h-9 data-[state=on]:bg-brand-primary data-[state=on]:text-white">
          <LayoutGrid className="h-4 w-4 mr-1" /> Panel
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <StatTileGrid mdCols={4} className="mt-4">
      <StatTile label="Grades" value={gradesCount} icon={<GraduationCap className="h-5 w-5" />} tone="teal" />
      <StatTile label="Subjects" value={subjectsCount} icon={<BookOpen className="h-5 w-5" />} tone="violet" />
      <StatTile label="Chapters" value={chaptersCount} icon={<Layers className="h-5 w-5" />} tone="peach" />
      <StatTile label="Topics" value={topicsCount} icon={<FileText className="h-5 w-5" />} tone="mint" />
    </StatTileGrid>

    <div className="mt-6 space-y-3">
      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search..." />
      <FilterRow activeCount={selectedChapters.length} onClear={() => setSelectedChapters([])}>
        <FilterChip
          label={selectedChapters.length > 0 ? `${selectedChapters.length} Chapters` : "Select Chapters"}
          active={selectedChapters.length > 0}
          onClick={openChapterSelector}
        />
        <button
          onClick={toggleExpandAll}
          aria-label={expanded ? "Collapse all" : "Expand all"}
          className="ml-auto inline-flex shrink-0 h-10 w-10 items-center justify-center rounded-full border border-surface-stroke bg-white/85 backdrop-blur-sm hover:bg-ink-400/5"
        >
          <Maximize2 className="h-4 w-4 text-ink-600" />
        </button>
      </FilterRow>
    </div>

    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-2">
      {/* existing class-list rendering as ListRow per class */}
      <ul className="list-none p-0 space-y-2">
        {classGroups.map((cg) => (
          <ListRow
            key={cg.id}
            as="li"
            leading={
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                <GraduationCap className="h-5 w-5" />
              </span>
            }
            title={cg.name}
            subtitle={`${cg.subjects} subjects · ${cg.topics} topics`}
            onClick={() => openClassGroup(cg.id)}
          />
        ))}
      </ul>
    </div>
  </PageShell>
);
```

- [ ] **Step 21.3: Validate + real-device**

iPhone Safari:
- Tree/Panel toggle is now a segmented control inline below the header — no longer a stat tile (Image 13 UX bug fixed)
- Add New button no longer overlaps the toggle (Image 3 fixed)
- Expand-all is a compact icon button, no longer clipped (Image 14 fixed)
- 4 stat tiles in compact grid

- [ ] **Step 21.4: Commit**

```bash
git add src/pages/school/SchoolSyllabusPage.tsx
git commit -m "feat(ui): redesign Syllabus & Materials

Tree/Panel toggle becomes a Segmented control (not a fake stat tile).
Add New CTA stays in PageHeader so it can never overlap the toggle.
Expand-all moves to a compact icon button. StatTileGrid replaces the
'Current View' UX-bug tile with a real Topics tile."
```

---

## Task 22: Students list redesign — `TeacherStudentsPage`

**Files:**
- Modify: `src/pages/teacher/TeacherStudentsPage.tsx`

**Source images covered:** 11, 12

- [ ] **Step 22.1: Apply primitives** (analogous to Task 17 — Teachers list)

```tsx
import { Users, Layers, ListChecks } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
```

```tsx
return (
  <PageShell>
    <PageHeader
      icon={<Users className="h-5 w-5" />}
      title="Students"
      subtitle="Manage students in your assigned classes"
      secondaryActions={[
        { label: "Assign Task to All", icon: <ListChecks className="h-4 w-4" />, onClick: handleAssignTaskAll },
      ]}
    />

    <StatTileGrid mdCols={2}>
      <StatTile label="Total Students" value={totalStudents} icon={<Users className="h-5 w-5" />} tone="teal" />
      <StatTile label="Classes" value={classesCount} icon={<Layers className="h-5 w-5" />} tone="violet" />
    </StatTileGrid>

    <div className="mt-6 space-y-3">
      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search students..." />
      <FilterRow activeCount={selectedClass ? 1 : 0} onClear={() => setSelectedClass(null)}>
        <FilterChip
          label={selectedClass ?? "All Classes"}
          active={Boolean(selectedClass)}
          onClick={openClassFilter}
        />
      </FilterRow>
    </div>

    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
      <h2 className="text-base font-semibold text-ink-900">Students List</h2>
      {students.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students yet"
          description="Add students to see them here."
        />
      ) : (
        <ul className="list-none p-0 space-y-2">
          {students.map((s) => (
            <ListRow
              key={s.id}
              as="li"
              leading={
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary text-sm font-semibold">
                  {getInitials(s.full_name)}
                </span>
              }
              title={s.full_name}
              subtitle={`${s.class_name} · ${s.email}`}
              onClick={() => openStudentDetail(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  </PageShell>
);
```

- [ ] **Step 22.2: Validate + real-device**

iPhone Safari: stat tiles in 2-col compact grid (Images 11/12 loud cards fixed); empty state illustrative.

- [ ] **Step 22.3: Commit**

```bash
git add src/pages/teacher/TeacherStudentsPage.tsx
git commit -m "feat(ui): redesign Students list (teacher view)

Apply PageShell, PageHeader, StatTileGrid, FilterRow, ListRow,
EmptyState. Replaces loud blue/purple full-bleed stat cards with
neutral 2-col tiles and bland 'No students found' with the
illustrative EmptyState pattern."
```

---

## Task 23: Exam evaluation Student list redesign

**Files:**
- Modify: `src/pages/EvaluationsPage.tsx` OR child component containing the per-exam student list (locate via Grep "No drafts" / "Yet to Attempt")

**Source image covered:** 5

- [ ] **Step 23.1: Locate file via Grep**

- [ ] **Step 23.2: Apply primitives — focus on the broken tab strip and table-on-mobile**

```tsx
import { Clock, UserX, CheckCircle2, AlertCircle, Inbox } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
```

Replace the broken tab strip + on-mobile table with `MobileTabs` + `ListRow` per student. Pseudo-shape:

```tsx
return (
  <PageShell>
    <PageHeader title={examName} subtitle={`${className} · ${subjectName}`} />

    <StatTileGrid mdCols={4}>
      <StatTile label="Pending Review" value={pendingReview} icon={<Clock className="h-5 w-5" />} tone="peach" />
      <StatTile label="Not Attempted" value={notAttempted} icon={<UserX className="h-5 w-5" />} tone="rose" />
      <StatTile label="Checked" value={checked} icon={<CheckCircle2 className="h-5 w-5" />} tone="mint" />
      <StatTile label="Not Checked" value={notChecked} icon={<AlertCircle className="h-5 w-5" />} tone="violet" />
    </StatTileGrid>

    <div className="mt-6 surface-card frosted-shadow rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold text-ink-900">Student List</h2>
      </div>
      <MobileTabs
        value={statusTab}
        onValueChange={setStatusTab}
        options={[
          { value: "all", label: "All", count: allCount },
          { value: "not-checked", label: "Not Checked", count: notCheckedCount },
          { value: "checked", label: "Checked", count: checkedCount },
          { value: "not-started", label: "Not Started", count: notStartedCount },
        ]}
      />

      <div className="mt-3 lg:hidden">
        {/* Mobile: ListRow per student */}
        {studentsForTab.length === 0 ? (
          <EmptyState icon={<Inbox className="h-7 w-7" />} title="No students in this status" />
        ) : (
          <ul className="list-none p-0 space-y-2">
            {studentsForTab.map((s) => (
              <ListRow
                key={s.id}
                as="li"
                leading={<Avatar initials={getInitials(s.full_name)} />}
                title={s.full_name}
                subtitle={s.statusLabel}
                trailing={s.score !== null ? <span className="text-sm font-medium tabular-nums text-ink-900">{s.score}</span> : <span className="text-xs text-ink-400">—</span>}
                onClick={() => openStudentEvaluation(s.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 hidden lg:block">
        {/* Desktop: keep existing table layout — render the existing <Table> here */}
      </div>
    </div>
  </PageShell>
);
```

- [ ] **Step 23.3: Validate + real-device**

iPhone Safari: tab strip clean (Image 5 "No..." clip fixed); rows readable; no horizontal scroll.

- [ ] **Step 23.4: Commit**

```bash
git add <touched-paths>
git commit -m "feat(ui): redesign Exam evaluation student list

Replace clipping tab strip with MobileTabs scroll-snap; on mobile
render the student list as ListRows (table-on-mobile retired).
Desktop keeps the existing table layout. No grading or evaluation
mutation logic changed."
```

---

## Task 24: Teacher Dashboard redesign

**Files:**
- Locate via Grep on "WORK" + "GROWTH" eyebrow text — likely a teacher dashboard component (e.g., `src/pages/teacher/TeacherDashboard.tsx` or rendered through `src/components/RoleBasedDashboard.tsx`)

**Source image covered:** 22

- [ ] **Step 24.1: Locate file**

- [ ] **Step 24.2: Apply HeroSummaryCard + FeatureTile pattern**

```tsx
import { Users, BookOpen, Layers, ClipboardList, BarChart3, Trophy, Award } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { HeroSummaryCard, FeatureTile } from "@/components/shared/surfaces";
```

```tsx
return (
  <PageShell>
    <PageHeader
      title={`Hello, ${user.first_name} 👋`}
      subtitle={`${institutionName} · Teacher`}
    />

    <HeroSummaryCard
      eyebrow="This week"
      value={openTasksCount}
      metric="Open Tasks"
      delta={openTasksDelta}
      link={{ label: "View all", to: "/tasks" }}
    />

    <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">WORK</p>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <FeatureTile to="/students" icon={<Users className="h-5 w-5" />} title="My Students" description="Students in your classes" tone="teal" />
      <FeatureTile to="/syllabus" icon={<BookOpen className="h-5 w-5" />} title="Syllabus" description="Curriculum & syllabus mapping" tone="teal" />
      <FeatureTile to="/question-bank" icon={<Layers className="h-5 w-5" />} title="Question Bank" description="Browse & manage question pool" tone="teal" />
      <FeatureTile to="/tasks" icon={<ClipboardList className="h-5 w-5" />} title="Tasks" description="Track assigned work items" tone="teal" />
      <FeatureTile to="/reports" icon={<BarChart3 className="h-5 w-5" />} title="Reports" description="Generate & view reports" tone="teal" />
    </div>

    <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">GROWTH</p>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <FeatureTile to="/achievements" icon={<Trophy className="h-5 w-5" />} title="Achievements" description="Badges & milestones earned" tone="peach" />
      <FeatureTile to="/leaderboard" icon={<Award className="h-5 w-5" />} title="Leaderboard" description="Rankings & standings" tone="peach" />
    </div>
  </PageShell>
);
```

> Substitute `user.first_name`, `institutionName`, `openTasksCount`, route paths with whatever the existing dashboard uses. Use the EXACT route paths the rest of the app uses for these pages — verify by grepping for the existing nav links.

- [ ] **Step 24.3: Validate + real-device**

iPhone Safari: gradient hero card + WORK / GROWTH grids render cleanly; no FAB (correct — dashboard has no per-page primary action).

- [ ] **Step 24.4: Commit**

```bash
git add <touched-paths>
git commit -m "feat(ui): redesign Teacher Dashboard with HeroSummaryCard + FeatureTile

Replace existing dashboard markup with the new shared primitives.
Hero card surfaces the user's open task count with a deep link;
WORK / GROWTH grids use FeatureTile uniformly. No data fetch or
nav-route changes."
```

---

## Task 25: Coordinator Dashboard redesign

**Files:**
- Locate via Grep on the existing coordinator-dashboard markup (e.g. greeting strings or coordinator-specific tile labels). The file may be a sibling of the Teacher Dashboard or a coordinator branch inside `src/components/RoleBasedDashboard.tsx`.

- [ ] **Step 25.1: Locate the file**

Use Grep to find the existing coordinator dashboard. Search for distinctive strings like the greeting, "Workforce Overview" tile label, or coordinator-specific routes. Read it end-to-end before editing.

- [ ] **Step 25.2: Add imports**

Place these imports near the top of the coordinator-dashboard file (alongside existing imports):

```tsx
import { Users, Layers, BookOpen, ClipboardList, BarChart3, Trophy, Award, Eye } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { HeroSummaryCard, FeatureTile } from "@/components/shared/surfaces";
```

> Drop any icon imports you don't use, and don't duplicate names already imported in the file.

- [ ] **Step 25.3: Replace the top-level return**

Replace the existing dashboard JSX with the structure below. Bind the data values (`user`, `institutionName`, `wingTasksCount`, etc.) to whatever variables the existing coordinator-dashboard component already exposes — do NOT invent new data dependencies or rename existing ones. The shape:

```tsx
return (
  <PageShell>
    <PageHeader
      title={`Hello, ${user.first_name} 👋`}
      subtitle={`${institutionName} · Coordinator`}
    />

    <HeroSummaryCard
      eyebrow="This week"
      value={wingTasksOpenCount}
      metric="Open Wing Tasks"
      delta={wingTasksDelta}
      link={{ label: "View all", to: "/tasks" }}
    />

    <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">WORK</p>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <FeatureTile
        to="/workforce-overview"
        icon={<Eye className="h-5 w-5" />}
        title="Workforce Overview"
        description="Track teachers and wings"
        tone="teal"
      />
      <FeatureTile
        to="/students"
        icon={<Users className="h-5 w-5" />}
        title="Students"
        description="Students across your wings"
        tone="teal"
      />
      <FeatureTile
        to="/syllabus"
        icon={<BookOpen className="h-5 w-5" />}
        title="Syllabus"
        description="Curriculum & syllabus mapping"
        tone="teal"
      />
      <FeatureTile
        to="/question-bank"
        icon={<Layers className="h-5 w-5" />}
        title="Question Bank"
        description="Browse & manage question pool"
        tone="teal"
      />
      <FeatureTile
        to="/tasks"
        icon={<ClipboardList className="h-5 w-5" />}
        title="Tasks"
        description="Track assigned work items"
        tone="teal"
      />
      <FeatureTile
        to="/reports"
        icon={<BarChart3 className="h-5 w-5" />}
        title="Reports"
        description="Generate & view reports"
        tone="teal"
      />
    </div>

    <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">GROWTH</p>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <FeatureTile
        to="/achievements"
        icon={<Trophy className="h-5 w-5" />}
        title="Achievements"
        description="Badges & milestones earned"
        tone="peach"
      />
      <FeatureTile
        to="/leaderboard"
        icon={<Award className="h-5 w-5" />}
        title="Leaderboard"
        description="Rankings & standings"
        tone="peach"
      />
    </div>
  </PageShell>
);
```

> **Important — preserve existing tile composition.** The list of tiles above (Workforce Overview, Students, Syllabus, Question Bank, Tasks, Reports under WORK; Achievements, Leaderboard under GROWTH) follows what the existing coordinator dashboard already exposes. If the existing dashboard exposes a different set (e.g. has fewer tiles, has additional wing-specific links), MIRROR the existing set — don't add or remove tiles to fit the example above. The primitives stay the same; the contents follow what the existing page already shows.

> **Routes — do not invent.** Verify each `to=` value against the existing app routing (`src/App.tsx`) before committing. If a route in this snippet doesn't exist in the app, swap it for the actual route the existing dashboard already links to. The most common slip: the Workforce Overview path may be `/workforce-overview` OR `/workforce` OR a nested coordinator path — check before assuming.

- [ ] **Step 25.4: Validate**

```bash
npx tsc --noEmit
npx eslint <touched-paths>
npx vite build
```

All exit 0. Real-iPhone-Safari check:
- Sign in as a coordinator and land on the dashboard
- Hero card surfaces the wing-tasks metric in teal→violet gradient
- WORK grid shows 6 (or whatever count the existing dashboard had) tiles in 2-col
- GROWTH grid shows Achievements + Leaderboard with peach-toned discs
- Every FeatureTile click navigates to the correct existing route

- [ ] **Step 25.5: Commit**

```bash
git add <touched-paths>
git commit -m "feat(ui): redesign Coordinator Dashboard

Apply HeroSummaryCard + FeatureTile to the coordinator surface.
Hero card surfaces the wing-tasks open count; WORK + GROWTH grids
preserve the coordinator-specific tile composition from the prior
markup (Workforce Overview, etc). No data fetch or routing changes."
```

---

# Phase 6 — Verification + cleanup

## Task 26: Remove dev gallery + update CLAUDE.md

**Files:**
- Modify: `src/App.tsx` (remove the `/dev/primitives` route block)
- Delete: `src/pages/dev/PrimitivesGallery.tsx`
- Modify: `.claude/CLAUDE.md` (add a "Mobile Design System" section)

- [ ] **Step 26.1: Remove the dev gallery route**

In `src/App.tsx`, remove the `import.meta.env.DEV && (<Route path="/dev/primitives"…/>)` block AND the `const PrimitivesGallery = lazy(() => import("./pages/dev/PrimitivesGallery"))` line added in Task 2.

> Decision: we DELETE rather than keep the gallery indefinitely because (a) keeping it adds a permanent maintenance surface on every primitive change, and (b) primitives are now visible across the actual application — the gallery has served its purpose. If you want a permanent harness later, build it on Storybook.

- [ ] **Step 26.2: Delete the gallery file**

```bash
rm src/pages/dev/PrimitivesGallery.tsx
# Then remove src/pages/dev/ if it's now empty:
rmdir src/pages/dev 2>/dev/null || true
```

- [ ] **Step 26.3: Update `.claude/CLAUDE.md`**

Append a new section just before the existing `## 21. User Deletion` section in `.claude/CLAUDE.md`:

```markdown
## 22a. Mobile Design System (2026-04-27)

Shared primitives live in `src/components/shared/{page,surfaces,nav,sheets}/`. Use these instead of hand-rolling page chrome on teacher / coordinator surfaces:

- **Page** — `PageShell` (universal gradient backdrop + safe-area), `PageHeader` (title + subtitle + responsive ActionMenu kebab), `MobileFab` (auto-hides near `[data-sticky-bottom]`).
- **Surfaces** — `StatTile` + `StatTileGrid` (neutral frosted card + tone-tinted icon disc — never the loud full-bleed colored cards), `HeroSummaryCard` (role dashboards only), `FeatureTile` (WORK/GROWTH grid tiles), `ListRow` (avatar + title + subtitle + trailing slot, replaces table-on-mobile), `EmptyState` (illustrative).
- **Nav** — `MobileTabs` (scroll-snap pills, single source of truth for tab strips), `FilterRow` + `FilterChip` (≤ 2 filters), `FilterSheet` (≥ 3 filters — bottom sheet).
- **Sheets** — `MobileSheet` (built on shadcn `Sheet`, NOT `Dialog` — avoids the project's DialogContent-ScrollArea fork).

**Brand tokens** (in `src/index.css`): `--brand-primary` (#249ca2 teal), `--brand-secondary` (#6f5ba2 muted violet), `--brand-accent` (#fa920e warm orange — accents/badges only). The universal page backdrop is `.surface-gradient`; cards use `.surface-card` + `.frosted-shadow`.

**Form fields**: shadcn `<Input>` / `<Select>` only. The iOS time/date input invisible-text bug is fixed globally via `input[type="time"]::-webkit-datetime-edit` rules in `src/index.css` — don't reintroduce raw HTML inputs that bypass the fix.

Spec: `docs/superpowers/specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md`. Implementation plan: `docs/superpowers/plans/2026-04-27-teacher-coordinator-mobile-ui-redesign.md`.
```

- [ ] **Step 26.4: Final validation across the whole codebase**

```bash
npx tsc --noEmit
npx eslint .
npx vite build
```

All exit 0. Bundle-size warnings (>500 kB) acceptable per CLAUDE.md §5a.

End-to-end real-iPhone-Safari pass: open every redesigned page (Tasks, Teachers, Students, Question Bank, Syllabus, Exams, Reports, Teacher Dashboard, Coordinator Dashboard, Schedule & Publish sheet, Task detail sheet, Exam evaluation Student list). Verify:
- No horizontal overflow on any page
- All FABs in the right position, never colliding
- All tab strips scroll-snap, never wrap
- All forms work; sticky footer keeps primary action above keyboard
- Existing functionality (data loading, mutations, navigation) unchanged

- [ ] **Step 26.5: Commit**

```bash
git add src/App.tsx .claude/CLAUDE.md
git rm src/pages/dev/PrimitivesGallery.tsx
git commit -m "chore(ui): remove dev primitives gallery + document design system

The /dev/primitives gallery served as a visual harness during
Phases 1-4 of the mobile UI redesign. Now that all primitives
are applied across teacher / coordinator surfaces, the gallery
is removed to avoid a permanent maintenance surface.

Adds a 'Mobile Design System' section to CLAUDE.md so future
agents and contributors discover the shared primitives instead
of hand-rolling page chrome.

Closes the teacher + coordinator mobile UI redesign work tracked
in docs/superpowers/specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md
and docs/superpowers/plans/2026-04-27-teacher-coordinator-mobile-ui-redesign.md."
```

---

# Done

All 22 source-image issues should now be resolved. The teacher and coordinator surfaces share a single design language (CoachPro + mobile-finance reference aesthetic) backed by 12 reusable primitives. Future page additions inherit the look automatically by composing the primitives.
