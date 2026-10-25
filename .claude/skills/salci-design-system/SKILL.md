---
name: salci-design-system
description: SALCI visual identity + mobile design system — shared page/surface/nav/sheet primitives, Phase 9 token system (light/dark), dashboard greeting pattern, and the strict 27-point checklist for new pages. Use when building or modifying ANY page, component, dialog, sheet, dashboard module, or styling on the SALCI portal — before writing the first line of JSX.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# SALCI Design System (Mobile-First, Phases 5/7/8/9)

Consult this before building anything visual. Every rule here prevents a regression that was already fixed once.

## 1. Shared primitives (`src/components/shared/{page,surfaces,nav,sheets}/`)

Use these instead of hand-rolling page chrome on any role surface:

- **Page** — `PageShell` (universal gradient backdrop + safe-area), `PageHeader` (title + subtitle + responsive ActionMenu kebab), `MobileFab` (auto-hides near `[data-sticky-bottom]`).
- **Surfaces** — `StatTile` + `StatTileGrid` (neutral frosted card + tone-tinted icon disc — never the loud full-bleed colored cards), `HeroSummaryCard` (role dashboards only), `FeatureTile` (every dashboard hub tile: Teacher, Coordinator, School Admin, Super Admin, Olympiad launchers; since 2026-09-29 a **clay tile** matching the 3D banner: `.clay-tile` / `.clay-pebble` / `.clay-go` + one `.clay-tone-*` class per `Tone` in `src/index.css`, colours from `--clay-*` tokens in both themes, pure CSS, no images; keep the tone class names written out in full in `FeatureTile.tsx` or Tailwind purges them; hover motion only under `(hover: hover) and (pointer: fine)`), `ListRow` (avatar + title + subtitle + trailing slot, replaces table-on-mobile), `EmptyState` (illustrative).
- **Nav** — `MobileTabs` (scroll-snap pills, single source of truth for tab strips), `FilterRow` + `FilterChip` (≤ 2 filters), `FilterSheet` (≥ 3 filters — bottom sheet).
- **Sheets** — `MobileSheet` (built on shadcn `Sheet`, NOT `Dialog` — avoids the project's DialogContent-ScrollArea fork; bypasses `SheetContent`'s auto-injected close button by using Radix Dialog primitives directly).

**Brand tokens** (in `src/index.css`): `--brand-primary` (#249ca2 teal), `--brand-secondary` (#fa920e warm orange — accents/badges only), `--app-bar-height: 61px` for sticky-tab strips that pin below `AppLayout`'s header. The universal page backdrop is `.surface-gradient`; cards use `.surface-card` + `.frosted-shadow`.

**Form fields**: shadcn `<Input>` / `<Select>` only. The iOS time/date input invisible-text bug is fixed globally via `input[type="time"]::-webkit-datetime-edit` rules in `src/index.css` — don't reintroduce raw HTML inputs that bypass the fix. The `.scrollbar-hide` utility (also in `src/index.css`) is used by `MobileTabs` and `FilterRow` for clean horizontal scroll.

Spec: `docs/superpowers/specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md`. Plan: `docs/superpowers/plans/2026-04-27-teacher-coordinator-mobile-ui-redesign.md`.

## 2. Coverage phases (which surfaces already comply)

**Phase 7 (2026-04-28) — School-admin coverage.** The primitives back: `ManageUsersPage` (parent tab strip on `MobileTabs`), `ManageAdminsPage`, `SchoolStudentsPage`, `SchoolCoordinatorsPage`, `HRDashboardPage`, `AnalyticsPage` (admin + super-admin paths), and the embedded `PrincipalDashboard` overview + drilldown. Five-plus action buttons per page collapse into `PageHeader.secondaryActions` kebab. `useTableSort` column sorts were dropped during table → ListRow swaps; restore via a Sort `FilterChip` if the affordance becomes load-bearing. `HRDashboardPage` previously rendered its own `<AppLayout>` wrapper — `ProtectedRoute` already provides one, so any new admin page must not re-wrap. Plan: `docs/superpowers/plans/2026-04-28-school-admin-mobile-ui-redesign.md`.

**Phase 8 (2026-04-28) — Student coverage.** Student surfaces on the same primitives: `StudentResultsPage`, `StudentReportsPage`, `StudentExamsPage`, `ComprehensiveStudentDashboard` (the `/dashboard` student branch — wraps itself in `PageShell` since `RoleBasedDashboard` doesn't), `StudentWeekPageV2`, `StudentRechecksPage`, `StudentStudyMaterialsPage`, `StudentFeesView` (also dropped a `SidebarProvider`+`AppSidebar` double-wrap — `ProtectedRoute` already provides `AppLayout`), `StudentPassportPage`, `StudentAnalyticsDashboard`, plus the shared `AppointmentsPage` and `BookAppointmentDialog` (now a `MobileSheet` with controlled `open`/`onOpenChange` — callers pass it through `PageHeader.primaryAction`). The four-tile `GradientKPICard` quartet on the comprehensive student dashboard collapsed to neutral `StatTile`. The exam-taking interface inside `ExamAttemptPage` is unchanged — only the pre-attempt landing card and the proctoring consent dialog were redesigned. Plan: `docs/superpowers/plans/2026-04-28-student-mobile-ui-redesign.md`.

**Recharts gotcha:** `ResponsiveContainer` reliably computes height inside flex/grid parents only when its wrapper carries explicit inline styles (`<div style={{ width: "100%", height: 256 }}>`); a Tailwind `h-64` flex/grid child can collapse to zero and stop rendering bars on mobile — this happened on the Subject-wise Scores card before the fix.

**iOS Safari fullscreen.** iPhone Safari does not implement `requestFullscreen` on arbitrary elements (only on `<video>`), and `el.requestFullscreen` is `undefined` on those builds — calling it throws `TypeError: requestFullscreen is not a function` *synchronously*, before any `.catch()` can intercept, kicking the React error boundary on the entire online exam flow. All exam-flow fullscreen calls go through `src/lib/fullscreen.ts` helpers (`requestFullscreen(el)`, `exitFullscreen()`, `getFullscreenElement()`, `onFullscreenChange()`, `isFullscreenSupported()`) which feature-detect the API and resolve to a no-op when unavailable. The fullscreen-exit auto-submit handler in `ExamAttemptPage` early-returns when `isFullscreenSupported()` is false so iPhone students still get camera + tab-switch proctoring without the auto-submit-on-exit guarantee. Don't bypass these helpers; calling `el.requestFullscreen()` directly will reintroduce the crash.

## 3. Phase 9 token system (`src/index.css`)

Phase 9 (2026-04-29) retuned all token values and added complete dark-mode wiring + a theme-aware dashboard scene banner. Every new color / shadow / radius MUST go through a CSS variable defined in **both** `:root` (light) **and** `.dark` (night):

| Token | Light | Dark |
|---|---|---|
| `--surface-base` | `30 30% 98%` warm cream | `232 28% 10%` deep navy |
| `--surface-card` | `0 0% 100%` pure white | `230 22% 16%` dark slate |
| `--surface-stroke` | `220 15% 94%` invisible hairline | `230 18% 24%` subtle line |
| `--ink-900..--ink-400` | dark slate text scale | inverted to light scale |
| `--shadow-card-{sm,,lg}` | deeper-blue 5–10% alpha | black-cast 30–50% alpha |
| `--shadow-hero` | brand-teal soft drop | blue-cast heavier drop |
| `--radius` | `0.75rem` (12px buttons/inputs) | same |
| `--radius-card` | `1.25rem` (20px cards/sheets) | same |
| `--brand-primary` / `--brand-secondary` / `--brand-accent` / `--brand-warm` | brand stops | same hue, palette inherits via overlays |

**Never hand-roll a hex / hsl color in a primitive — go through a token.** New token? Add both light and dark.

### Utility classes

- **`.surface-gradient`** — page backdrop. Layered radial overlays over `--surface-base`. Has a `.dark .surface-gradient` override that swaps the radial stops to cool aurora colors over the navy floor.
- **`.surface-card`** — pure-white (light) / dark-slate (dark) card body with `--radius-card` (20px). No alpha + blur (that combo killed the float effect pre-Phase-9 — don't reintroduce).
- **`.frosted-shadow`** / **`.frosted-shadow-lg`** — wired to `--shadow-card` and `--shadow-card-lg`. Cards float visibly in both modes.
- **`.app-bar-frost`** — replaces `border-b + bg-card/80` on AppLayout's `<header>`. Saturate-blur over 65%-alpha `--surface-card`, no border. **AppLayout's header MUST use this class** — reverting to `bg-card/80 + border-b` reintroduces the white seam.
- **`.eyebrow`** — `text-[11px] uppercase tracking-[0.06em] text-ink-500` for tiny captions above values (StatTile, HeroCard, dashboard greetings).
- **`.scene-banner`** — theme-aware sky gradient used by the dashboard scene illustration.

### Phase 9 primitives

- **`HeroCard`** (`@/components/shared/surfaces`) — saturated dark teal/violet/warm gradient surface for *small* CTA tiles (e.g. "Mock test tomorrow [Start prep]") sitting alongside other dashboard content. Complements `HeroSummaryCard` (number-driven hero with delta + link). **Do NOT use `HeroCard` as a page-spanning top banner.** The reference pattern (CoachPro) starts pages with a small `eyebrow` + bold `h1` and dives straight into content; the dark gradient card belongs as a small tile in the grid, never as a hero that pushes content below the fold.
- **Dashboard action deck** (`src/components/dashboards/actions/`, 2026-10-06) is the one sanctioned bold gradient at the top of a page: it lives in the banner's own box (`SLOT_BOX`, never taller) and only while something is due, ONE card at a time at every width (owner's rule: never side by side). Tushar chose this look ("B, bold gradient") over a white card, story segments and refined clay. Colours come from the `--clay-*-deep` tokens (both themes) and the `.action-*` block in `src/index.css`; its buttons are ghost shadcn Buttons restyled by classes scoped under `.action-slide`, which is what lets them beat the variant's own hover. Do not "fix" it back to a neutral card under the HeroCard rule above.
- **`SchoolSceneIllustration`** (`@/components/shared/illustrations`) — the dashboard banner. Since 2026-09-28 it is the **"Clay School" real-time 3D scene** (three.js, `banner3d/`), with no drawn fallback: the old SVG scene was deleted on 2026-09-29 to keep the dashboard light. Until the canvas is up (and on devices without 3D) the banner shows its `.scene-banner` sky gradient (`--ssi-sky-top/mid/bottom`, the only `--ssi-*` tokens left), or the cached poster of the scene on a return visit. Never re-add an SVG or image fallback that every dashboard visit downloads. Design + decisions: `docs/superpowers/specs/2026-09-28-clay-school-banner-3d-design.md` (section 0 wins). Rules that are easy to break:
  - **three and the engine are ONE lazy chunk** (`bannerEngine.<hash>.js`, about 658 kB min / 179 kB gz, a documented §23 exception) with zero static imports. Only `Banner3DLayer.tsx` imports it, through `importDecorative(() => import("./engine/bannerEngine"))`; everything else uses `import type` from `engine/types.ts`. Engine files import only `three`, the two `three/addons` files and siblings, never React or `@/`. Never add three to `manualChunks`. `npm run check:banner-chunk` (after `vite build`) enforces all of this.
  - It never loads on `/login`, never before the dashboard's own queries settle, and never on tier `none` (no WebGL2, software GPU, Save-Data, two context losses). Weak devices get tier `still` (one rendered frame as an image).
  - A failed engine download must not reload the page: main.tsx's `vite:preloadError` handler returns early for `isDecorativeLoadError()` (`src/lib/decorativeImports.ts`).
  - Time of day: dark theme is always night; light theme follows the school's clock (`useInstitutionTimezone`): morning before 11, midday 11 to 15, golden 15 to 19, dusk from 19.
  - Posters live in IndexedDB (`salci-banner`), never localStorage (that holds the persisted query cache).
  - Checks: `npm run test:banner-tod`, `npm run test:banner` (engine in Chrome: flag colours, framing, budget, live loop, context loss, dispose). Dev-only `?banner3d=force|still|off` pins the tier (headless Chrome only has SwiftShader).
  - The 3D flag holds the national flag's exact colours in both themes (unlit, no tone mapping); never re-tint it for night. The old `lottieSrc` prop was removed on 2026-09-25.

### Dashboard greeting pattern

Every role's `/dashboard` (student / teacher / coordinator / school-admin / super-admin) follows the same content-dense top-of-page header. **Do NOT use `<HeroCard>` or any banner-style block for the greeting** — that pattern was tried and rejected. The canonical layout:

```tsx
<PageShell>
  <SchoolSceneIllustration />            {/* short animated banner */}
  <header className="pt-3 pb-2 sm:pt-4 sm:pb-3 lg:pt-6 lg:pb-6">
    <p className="eyebrow">Welcome back</p>
    <h1 className="text-[28px] sm:text-[34px] lg:text-[42px] xl:text-[46px] font-bold text-ink-900">
      {greeting}, {firstName}!
    </h1>
    <p className="mt-2 text-sm sm:text-[15px] text-ink-600">
      {role}{institutionName && <span> · {institutionName}</span>}
    </p>
  </header>
  {/* content starts immediately */}
</PageShell>
```

`{greeting}` comes from **`useRotatingGreeting()`** (`@/hooks/useRotatingGreeting`) which cycles 15 multilingual greetings every 5 seconds (Hello / नमस्ते / Hola / Hallo / Bonjour / こんにちは / ਸਤ ਸ੍ਰੀ ਅਕਾਲ / नमस्कार / Ciao / Olá / 안녕하세요 / Merhaba / Привет / 你好 / Sawadee). Single source — one hook, all dashboards. Don't hand-roll a per-page greeting array.

**No 👋 emoji on dashboard h1s.** The illustrated scene banner above carries the welcoming tone.

### Scene assets

`public/illustrations/back-to-school.svg` / `online-learning.svg` / `teacher-student.svg` are bundled Storyset SVGs available for ad-hoc use. Attribution lives in `CREDITS.md` at the repo root (Freepik License compliance) — **do not put Storyset attribution back in the visible UI.**

The flagship surface for the visual identity is `/dashboard` as a student. If a future change makes that page look flat or lose its identity, the regression is in tokens — start with `src/index.css` `:root` / `.dark` and the `.surface-gradient` / `.surface-card` / `.frosted-shadow` block before touching primitives. Plan: `docs/superpowers/plans/2026-04-29-mobile-ui-phase-9-visual-identity.md`.

## 4. Building new pages / components — strict checklist

Anything new on the SALCI portal — page, component, dialog, section, dashboard module — **must follow this checklist**.

### Layout chrome (every authenticated page)

1. ✅ Wrap the page in `<PageShell>` from `@/components/shared/page`. Never render `<AppLayout>` yourself — `ProtectedRoute` already does. Never wrap in `SidebarProvider + AppSidebar` either (that's a triple-wrap; see `StudentFeesView` cleanup in Phase 8).
2. ✅ Use `<PageHeader>` for the title row when the page has a stable title + optional primary/secondary actions. For role dashboards specifically, follow the "dashboard greeting pattern" above (eyebrow + h1 + subtitle, no PageHeader, scene illustration above).
3. ✅ Heading text uses `text-ink-900`. Subtitles use `text-ink-600`. Captions use `.eyebrow`. Never use raw greys (`text-gray-700`, `text-slate-500`) — those don't flip with dark mode.
4. ✅ Tab strips are `<MobileTabs>` from `@/components/shared/nav`. Never `<Tabs>` from shadcn for top-level role tab strips — those clip at 375 px and mount all panels.
5. ✅ Filters: `<FilterRow>` for ≤ 2 filters, `<FilterSheet>` for ≥ 3.

### Surfaces (cards, panels, blocks)

6. ✅ Cards = `surface-card frosted-shadow` (or `frosted-shadow-lg` for hero-tier lift). Never raw `bg-white shadow-md rounded-lg` — theme-blind, misses the shadow tokens.
7. ✅ Border radius on cards = `rounded-card` (Tailwind utility for `--radius-card`). Buttons / inputs use Tailwind's default `rounded-md` / `rounded-lg` (which resolve to 12 px via `--radius`).
8. ✅ Stat tiles = `<StatTile>` + `<StatTileGrid>`. Eyebrow caption above, big bold value below. Tone-tinted icon disc — pick from the `Tone` union (`teal | violet | peach | mint | sky | rose`). Never the loud full-bleed `GradientKPICard` that Phase 5 deprecated.
9. ✅ Lists / tables that don't fit at 375 px → convert to `<ListRow>` (avatar + title + subtitle + trailing slot). Keep tables only for genuinely tabular, dense, scrollable data.
10. ✅ Empty states → `<EmptyState>` with an icon, title, description, optional CTA action. Never a bare `<Card><CardContent>...</CardContent></Card>` with centered text.
11. ✅ Dialogs / sheets → `<MobileSheet>` from `@/components/shared/sheets` (built on shadcn Sheet, not Dialog — bypasses the project's DialogContent-ScrollArea fork). Pass controlled `open` / `onOpenChange` so the trigger can live elsewhere (e.g. `PageHeader.primaryAction`).

### Hero blocks

12. ✅ Number-driven hero (e.g. "12 open tasks · View all") → `<HeroSummaryCard>`.
13. ✅ Action-driven small CTA tile (e.g. "Mock test tomorrow [Start prep]") → `<HeroCard>` *as a small tile* alongside other content.
14. ❌ **Never use `<HeroCard>` as a page-spanning top banner.** Use the dashboard-greeting pattern instead.

### Color & theme

15. ✅ Every color flows through a CSS variable. New token? Add it to **both** `:root` and `.dark` in `src/index.css`. No exceptions.
16. ✅ Brand colors: `--brand-primary` (teal), `--brand-secondary` (orange / lilac), `--brand-warm` (peach), `--brand-accent`. Use Tailwind utilities `bg-brand-primary` / `text-brand-primary` etc.
17. ✅ Status / severity: lean on the existing `--status-*` and `--priority-*` tokens or `Tone` chips. Avoid raw `text-red-600 / bg-amber-50` — those don't dark-mode-flip.
18. ✅ Shadows: `shadow-card` / `shadow-card-lg` / `shadow-hero` (Tailwind utilities resolved from `--shadow-card-*`). Never raw `shadow-lg` for cards — that's the legacy 0.12-alpha drop and reads grey in dark mode.

### Mobile-first invariants (Phase 5 carryovers)

19. ✅ Every page must work at 375 px width. Test in DevTools or on real iPhone Safari.
20. ✅ iPhone Safari fullscreen API is unsupported on arbitrary elements (section 2 above) — exam / proctoring fullscreen calls go through `src/lib/fullscreen.ts` helpers. Don't bypass.
21. ✅ Service worker dirty-form contract — forms with unsaved input set `data-dirty="true"` so the SW update reload is suppressed (CLAUDE.md service-worker section + salci-module-notes skill).
22. ✅ Recharts `ResponsiveContainer` height inside flex/grid parents needs explicit inline `style={{ width: "100%", height: 256 }}` — Tailwind `h-64` collapses to zero on mobile.

### Error handling

23. ✅ All `onError` / `catch`-toasts go through `toastError(err, { fallback, context })` from `src/lib/toast.ts`. Never `toast.error(err.message)` — leaks raw Postgres.
24. ✅ Edge function `admin-operations` calls go through `invokeAdminOperation` from `src/lib/invokeEdgeFunction.ts`.

### Visual smoke before claiming a page complete

25. ✅ At 375 px: header doesn't wrap awkwardly, no horizontal scroll, tab strips scroll-snap, cards float visibly, no clipping at the right edge.
26. ✅ Toggle dark mode: page backdrop, cards, text scale, shadows ALL flip. If anything stays cream/white in dark mode, the regression is a missing `.dark` token override.
27. ✅ `npm run typecheck` exit 0, `npx eslint <touched paths>` no new errors over baseline, `npx vite build` exit 0.

If any rule above can't be followed, **call it out explicitly** ("I'm using a raw color here because X") rather than silently breaking the system. The rules exist because each one prevents a regression we've already fixed once (and don't want to fix twice).