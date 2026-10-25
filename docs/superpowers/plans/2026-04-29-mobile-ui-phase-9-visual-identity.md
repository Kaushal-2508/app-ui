# Mobile UI Phase 9 — Visual Identity Skin

> Pure visual / token work over the Phase 5/7/8 structural foundation. The primitives stay; their tokens, shadows, radii, and one new primitive (`HeroCard`) get rewritten to match the CoachPro and Michael-Samuel reference inspirations. Zero data-flow changes.

**The gap.** Phase 5/7/8 fixed *structure* — primitive consistency, no clipping at 375px, MobileSheet for dialogs, ListRow for tables, MobileTabs for scroll-snap, iOS fullscreen safety. The result is functionally clean but visually it reads as a generic shadcn admin tool: cold whites, near-zero shadows, 6px radius, faint brand gradient that disappears against the white app bar. The references want warmth, depth, and float.

**Reference DNA (from CoachPro + Michael-Samuel banking app):**

1. Soft pastel gradient backdrop (cream / peach → lavender — clearly visible, not a flat grey)
2. Pure white cards with **soft, generous shadows** (15-25px blur, 6-8% alpha) — they *float*
3. **20-24px border radius everywhere** — cards, inputs, buttons (not pills, just rounded)
4. Tone-tinted small icon discs (~40px, soft pastel chips) on stat cards
5. Hero feature card — dark teal / gradient surface with optional illustration slot
6. Top app bar — frosted, blends into the backdrop (no hard white seam)
7. Typography hierarchy: tiny caption → large bold value → compact subtitle

---

## Token deltas

### `src/index.css` — `:root`

| Token | Before | After |
|---|---|---|
| `--surface-base` | `220 25% 98%` (cool near-white) | `30 30% 98%` (warm cream-white) |
| `--brand-primary` | `183 64% 39%` ✓ keep | `183 64% 39%` |
| `--brand-secondary` | `257 28% 50%` muted violet | `257 35% 62%` (lighter, warmer lilac) |
| **NEW `--brand-warm`** | — | `18 90% 70%` (soft peach for backdrop) |
| `--radius` | `0.375rem` (6px) | `0.75rem` (12px) — buttons/inputs |
| **NEW `--radius-card`** | — | `1.25rem` (20px) — cards & sheets |
| `--surface-card` | `0 0% 100%` ✓ keep | `0 0% 100%` |
| `--surface-stroke` | `220 15% 92%` | `220 15% 94%` (lighter; near-invisible) |

### Shadows — `:root`

Replace the cold grey shadows (`hsl(220 13% 46% / 0.04)`) with deeper-blue, more saturated drops so cards lift visibly:

```css
--shadow-card-sm: 0 1px 2px hsl(220 25% 30% / 0.04), 0 4px 12px hsl(220 25% 30% / 0.05);
--shadow-card:    0 1px 2px hsl(220 25% 30% / 0.04), 0 8px 24px hsl(220 25% 30% / 0.08);
--shadow-card-lg: 0 1px 2px hsl(220 25% 30% / 0.04), 0 16px 40px hsl(220 25% 30% / 0.10);
--shadow-hero:    0 1px 2px hsl(220 25% 30% / 0.04), 0 24px 48px hsl(183 60% 30% / 0.18);
```

### `@layer components` — utility classes

```css
.surface-gradient {
  background-color: hsl(var(--surface-base));
  background-image:
    radial-gradient(1200px 800px at 0% 0%, hsl(var(--brand-warm) / 0.18), transparent 55%),
    radial-gradient(1000px 700px at 100% 0%, hsl(var(--brand-secondary) / 0.16), transparent 60%),
    radial-gradient(800px 600px at 50% 100%, hsl(var(--brand-primary) / 0.10), transparent 65%);
  background-attachment: fixed;
}

.surface-card {
  background-color: hsl(var(--surface-card));
  border: 1px solid hsl(var(--surface-stroke));
  border-radius: var(--radius-card);
}

.frosted-shadow { box-shadow: var(--shadow-card); }
.frosted-shadow-lg { box-shadow: var(--shadow-card-lg); }

.app-bar-frost {
  background-color: hsl(var(--surface-card) / 0.65);
  backdrop-filter: saturate(160%) blur(16px);
  -webkit-backdrop-filter: saturate(160%) blur(16px);
}
```

(The old `surface-card` had a 0.85 alpha + blur — both unnecessary on a now-pastel backdrop, and the alpha made cards look grey. Pure white surfaces over a saturated gradient is what gives the reference its punch.)

### `tailwind.config.ts`

Add `brand.warm`, `radius-card`:

```ts
colors: {
  brand: {
    primary: 'hsl(var(--brand-primary))',
    secondary: 'hsl(var(--brand-secondary))',
    accent: 'hsl(var(--brand-accent))',
    warm: 'hsl(var(--brand-warm))',
  },
},
borderRadius: {
  card: 'var(--radius-card)',
  // existing entries stay
},
boxShadow: {
  'card-sm': 'var(--shadow-card-sm)',
  card: 'var(--shadow-card)',
  'card-lg': 'var(--shadow-card-lg)',
  hero: 'var(--shadow-hero)',
  // existing entries stay
},
```

---

## Tasks

### Task 44: Token sweep

**Files:** `src/index.css`, `tailwind.config.ts`.

Apply the deltas above. Single commit. Validate via `npx tsc --noEmit` + `npx vite build`. ESLint not relevant for CSS/config.

Smoke check before moving on: load `/dashboard` (any role). The page should now visibly carry a warm cream → lilac gradient. Cards should appear to float with measurable shadow. Border radius on cards should look generous (20px), buttons/inputs more like 12px. If the visual jump isn't obvious, the gradient stops or shadow alpha need a bump — iterate before locking in.

### Task 45: AppLayout app bar — frosted blend

**Files:** `src/components/layout/AppLayout.tsx`.

Current header: `<header className="h-[61px] border-b border-border/40 bg-card/80 backdrop-blur-sm ...">`.

Replace the chrome:
- Drop `border-b border-border/40`
- Replace `bg-card/80 backdrop-blur-sm` with `app-bar-frost` (so it actually shows the gradient bleeding through, with stronger saturation)
- Keep the sticky positioning, height, flex layout, and contents (search, bell, avatar) byte-identical

The hard white seam should disappear; the brand gradient should now read continuously from top to bottom of the page.

### Task 46: PageShell — pad for the new app bar

**Files:** `src/components/shared/page/PageShell.tsx`.

The shell already sets `surface-gradient` so it picks up the new tokens automatically. But verify the inner container's max-width and side padding still feel right with the more saturated gradient — may want to increase top padding so the first card isn't pinned to the now-frosted app bar bottom edge.

### Task 47: StatTile polish

**Files:** `src/components/shared/surfaces/StatTile.tsx`.

Per the reference (CoachPro Possession/Overall Price tiles), the layout should be:

```
[icon disc 40×40]
                    [tiny grey caption — 11px]
[big bold value — 28-32px tabular-num]
[optional delta chip below]
```

Currently the tile has icon → value → label. Reference flips it: tiny **caption above**, large value, optional delta. Adjust:

- Icon disc: keep ~40×40 rounded-2xl, soft pastel bg (already correct via tones)
- Caption: add `text-[11px] uppercase tracking-wider text-ink-500` *above* the value
- Value: bump to `text-[30px] leading-[36px] font-semibold tabular-nums text-ink-900`
- Drop the bottom label entirely (caption above replaces it)
- Apply the new `shadow-card` instead of the existing `frosted-shadow` (now a pure box-shadow, not the old 0.04-alpha non-shadow)

Keep prop API identical — `label` becomes the caption above, `value` and `icon` and `tone` and `delta` unchanged.

### Task 48: New `HeroCard` primitive

**Files (new):** `src/components/shared/surfaces/HeroCard.tsx`, export from `src/components/shared/surfaces/index.ts`.

Modeled on the CoachPro "Setup training" card and the Michael-Samuel credit card hero. Renders a dark teal gradient surface with optional title / subtitle / primary CTA / illustration slot.

```tsx
export interface HeroCardProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: ReactNode };
  illustration?: ReactNode;
  tone?: "teal" | "violet" | "warm";
  className?: string;
}
```

Layout:
- 3-column flex on md+ (text | spacer | illustration)
- Stacked on mobile (text on top, illustration below)
- Background: gradient from `--brand-primary` (or selected tone) to a darker stop, using `shadow-hero`
- Border-radius: `var(--radius-card)` × 1.5 for extra softness
- Text on the gradient is white with subtle drop-shadow

The illustration slot accepts any ReactNode — for now we'll pass simple lucide icons like `<GraduationCap className="h-24 w-24 opacity-30" />` until we wire a real illustration set.

### Task 49: Typography pass

**Files:** `src/index.css` (base layer), `src/components/shared/page/PageHeader.tsx`.

Tighten hierarchy to match the references:

- `h1` in PageHeader: `text-[26px] leading-[32px] font-bold` on mobile, `text-[32px] leading-[40px]` on `sm+`
- Subtitle below the h1: `text-sm text-ink-600`, max one line, truncate
- Add a global utility `.eyebrow` for the tiny caption above values — `text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500`

### Task 50: Apply on flagship pages — student `/dashboard` + school-admin command center

**Files:** `src/components/dashboards/ComprehensiveStudentDashboard.tsx`, `src/components/dashboards/SchoolAdminCommandCenter.tsx` (or whatever the school-admin home is).

Two surgical edits per page:

1. Replace the current "Hey student2!" / "Hello, Salci!" greeting block with `<HeroCard>`. For the student dashboard, the eyebrow becomes `"Welcome back"`, title becomes the student name + greeting, description carries the class line, and action becomes "View report" (links to `/student/reports`).
2. Verify all existing `StatTile`s render with the polished spec from Task 47 (caption above value).

These two pages are the smoke test. Open `/dashboard` as student and as school-admin at 375px. The gradient should be visibly warm; the hero card should pop; stat tiles should show the new caption-above-value hierarchy.

If the visual delta still doesn't match the references after applying these changes, *stop and iterate on tokens* (Task 44) before rolling out to other surfaces.

### Task 51: Roll out HeroCard to other surfaces (only after Task 50 is approved)

Candidate surfaces:
- Teacher dashboard (`Welcome back, Teacher2!` block)
- Coordinator dashboard
- Principal dashboard ("School Performance at a Glance")
- Super-admin command center

Each is a 1-block replacement: existing greeting/header block → `<HeroCard>`. Single commit per surface, can run in parallel.

### Task 52: CLAUDE.md §20a Phase 9 note

**Files:** `.claude/CLAUDE.md`.

Append a Phase 9 paragraph documenting:
- The new tokens (`--brand-warm`, `--radius-card`, `--shadow-card-*`, `--shadow-hero`)
- The `app-bar-frost` utility (and the rule: AppLayout's header MUST use it, not raw bg-card)
- The new `HeroCard` primitive
- The reason cards now use `shadow-card` instead of the old `frosted-shadow` (which was effectively no-op)

---

## Validation

Each task validates with:
- `npx tsc --noEmit` exit 0
- `npx eslint <touched paths>` zero new errors over baseline
- `npx vite build` exit 0
- Manual smoke at 375px after Task 44 (token jump must be visible) and after Task 50 (hero card must read like the reference)

## Out of scope

- Real illustration assets (claymorphism / 3D). Phase 9 ships with lucide-icon stand-ins; a follow-up phase can wire actual SVG illustrations.
- Dark mode token sweep — Phase 9 only retunes the light theme. Dark mode tokens stay untouched (will be its own polish pass).
- Recharts color palette — chart colors aren't in the references' DNA; current palette is fine until a user calls it out.
