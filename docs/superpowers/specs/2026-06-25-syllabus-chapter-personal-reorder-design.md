# Personal Drag-to-Reorder for Syllabus Chapters — Design

- **Date:** 2026-06-25
- **Status:** Approved in brainstorming — pending spec review
- **Surface:** `SchoolSyllabusPage` → subject → chapter list (panel/accordion view)

## 1. Summary

Let any school-side user reorder the chapters within a subject by drag-and-drop. The
order is **personal to each user**, stored server-side so it follows their login across
devices, and it **never affects other users or the shared chapter rows**. Dragging is
gated behind a deliberate **3-second press-and-hold** on a new drag-handle button (with a
premium countdown → lift interaction). A **Reset order** action returns to the default.

## 2. Goals

- Per-user personal chapter ordering within a subject, persisted to the user's account.
- Tenant-safe: identical behaviour for global (`institution_id IS NULL`) and
  institution-owned chapters; never mutates the shared `syllabus_topics` rows.
- Deliberate, premium interaction: 3s hold on a handle, countdown `3 → 2 → 1`, row lift,
  smooth within-list reorder.
- Reset to default order.
- Accessible (keyboard reorder), mobile + desktop, dark-mode, works at 375px.

## 3. Non-goals

- Reorder in the syllabus **tree** view (only the panel/list view in the screenshot).
- Reordering fine-grained `chapter_topics` (chapters = `syllabus_topics` only).
- Shared/school-wide ordering (explicitly chose **personal**).
- Cross-subject moves (impossible by construction — the panel shows one subject at a time).

## 4. Roles & scope

- The drag handle is available to **every role that can open the syllabus page and view
  chapters** (school_admin, super_school_admin, super_admin, coordinator, teacher).
  Because the order is personal, there is no special permission gate.
- Order is scoped per **(user, subject)**. The visible list for a subject is the current
  filter: `subject_id` + `is_active` + `(institution_id = X OR institution_id IS NULL)`.
  Reorder writes a clean sequence for exactly that visible set.

## 5. Data model (Layer 1 — DB)

New table `public.user_topic_orders`, mirroring the existing `institution_hidden_topics`
override pattern but keyed by **user** instead of institution:

```sql
CREATE TABLE public.user_topic_orders (
  user_id       UUID NOT NULL REFERENCES public.profiles(id)        ON DELETE CASCADE,
  topic_id      UUID NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);
CREATE INDEX user_topic_orders_topic_idx ON public.user_topic_orders (topic_id); -- FK index (§23)
ALTER TABLE public.user_topic_orders ENABLE ROW LEVEL SECURITY;
```

RLS — four policies, `TO authenticated`, all gated on `user_id = auth.uid()` (no
cross-table EXISTS → no recursion risk, no SECURITY DEFINER helper needed):

- SELECT `USING (user_id = auth.uid())`
- INSERT `WITH CHECK (user_id = auth.uid())`
- UPDATE `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`
- DELETE `USING (user_id = auth.uid())`

`ON DELETE` rationale (§21): `user_id` is ownership → CASCADE; `topic_id` → CASCADE (an
override is meaningless once the chapter is gone).

**Apply:** the migration ledger is stale — apply to prod via the Management API SQL helper
and verify via `information_schema`/`pg_policies`; do not rely on `supabase db push`.
After applying, **regen types from prod**
(`npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw`) or add a narrow
table type until typegen catches up — never `as any`.

## 6. Read path (Layer 3 — query)

Extend `useInstitutionTopics` in `SchoolSyllabusPage.tsx`:

1. Load topics for the subject as today.
2. Read the user's overrides: `SELECT topic_id, display_order FROM user_topic_orders
   WHERE user_id = <uid> AND topic_id IN (visibleIds)`. Get `uid` from the auth context /
   local session — **never** `supabase.auth.getUser()` without a JWT (§23).
3. Compute **effective order**: overridden topics sort by their override `display_order`;
   non-overridden topics follow, ordered by global `display_order` then `topic_name`. No
   overrides ⇒ identical to today.
4. Query key gains `userId`: `["institution-topics-v3", classId, subjectId, institutionId,
   userId]`. `invalidateSyllabusCache` matches by the `["institution-topics-v3"]` prefix, so
   it still invalidates correctly.

## 7. Write path (Layer 2/3 — mutations)

New `src/hooks/useReorderTopics.ts`:

- **`useReorderTopics`** — input `{ subjectId, orderedTopicIds }`. Upserts
  `[{ user_id, topic_id, display_order: i + 1 }]` for every visible topic
  (`onConflict: "user_id,topic_id"`). **Optimistic**: reorder the cached list immediately
  for an instant feel; on error roll back + `toastError(err, { fallback, context:
  "reorderChapters" })`; invalidate on settle.
- **`useResetTopicOrder`** — input `{ topicIds }`. `DELETE FROM user_topic_orders WHERE
  user_id = <uid> AND topic_id IN (topicIds)`, then invalidate → list returns to default.

## 8. UI / UX (Layer 3 — the premium interaction)

Built on the **already-installed** `@dnd-kit/core` + `@dnd-kit/sortable`.

**Drag handle.** Replace the `Layers` disc in `TopicAccordion` with a drag-handle button:
same 10×10 `rounded-lg bg-muted` disc, `GripVertical` icon, `aria-label="Hold 3s to
reorder {chapter}"`, grab cursor. New `isReorderable` prop on `TopicAccordion`
(default `false`, so no behaviour change anywhere else); the panel view passes `true`.

**Sortable list.** Wrap the panel chapter list in `DndContext` + `SortableContext`
(`verticalListSortingStrategy`), items = topic ids. Each row uses `useSortable({ id })`;
`{...attributes} {...listeners}` go on the handle only — the row body keeps tap-to-expand.
- Sensors: `PointerSensor` with `activationConstraint: { delay: 3000, tolerance: 8 }`
  (a quick press or any move > 8px before 3s does nothing — exactly as specified), plus
  `KeyboardSensor` for accessibility (Space/Enter to pick up, arrows to move).
- Modifiers: `restrictToVerticalAxis` + `restrictToParentElement`.

**3-second countdown → lift.**
- On handle `pointerdown`: show a circular progress ring (brand-teal arc) over the handle
  with the number `3 → 2 → 1` and a subtle pulse. Cancel on `pointerup`/cancel/move>8px.
- At 3s dnd-kit fires `onDragStart` → hide countdown; the row **arms**: scale ~1.02,
  `shadow-card-lg`, ring highlight; `navigator.vibrate?.(15)` on touch.
- During drag: a `DragOverlay` clone follows the cursor; the original leaves a faded
  placeholder; sibling rows animate aside; spring settle on drop, then persist (optimistic).
- Honour `prefers-reduced-motion` (skip scale/lift animation; keep the countdown number).

**Reset order.** A small "Reset order" action by the chapter-list header, shown only when
the user has ≥1 override for the current subject; calls `useResetTopicOrder`.

**Design system.** All colours via tokens (brand-primary teal ring, `surface-card`,
`shadow-card-lg`, `text-ink-*`); dark-mode + 375px verified; no raw hex/greys.

## 9. Edge cases

- New chapter added after a personal order is set → appears at the end (global order) until
  the next reorder.
- Chapter deleted → its override row is CASCADE-removed.
- Mixed global/owned chapters → handled uniformly via the personal override.
- Concurrency → per-user, so no cross-user conflict.
- 0–1 chapters → handle still renders but there is nothing to reorder.

## 10. Files

- **NEW** `supabase/migrations/<ts>_user_topic_orders.sql`
- **NEW** `src/hooks/useReorderTopics.ts` (`useReorderTopics`, `useResetTopicOrder`)
- **NEW** `src/components/syllabus/ChapterReorderHandle.tsx` (handle + countdown ring)
- **MOD** `src/integrations/supabase/types.ts` (regen / add `user_topic_orders` type)
- **MOD** `src/pages/school/SchoolSyllabusPage.tsx` (merge overrides into
  `useInstitutionTopics`; wrap panel list in DnD; pass `isReorderable`; Reset action)
- **MOD** `src/components/syllabus/TopicAccordion.tsx` (handle, sortable wiring, lift)

## 11. Verification (§5a + manual)

- `npm run typecheck` = 0, `npx eslint <touched>` = 0, `npx vite build` = 0.
- Migration applied to prod and verified (`information_schema` / `pg_policies`); types regen.
- Manual: 3s hold arms; quick tap / early release / pre-move does nothing; reorder persists
  across reload; reset returns to default; dark mode + 375px; keyboard reorder works; other
  subjects unaffected; **global chapters reorder with no RLS error**.

## 12. Future (out of scope)

- Tree-view reorder; school-wide shared order; reordering `chapter_topics`.
