# Personal Drag-to-Reorder for Syllabus Chapters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any school-side user drag-reorder the chapters within a subject on the syllabus page, with the order saved per-user to their account and gated behind a deliberate 3-second press-and-hold.

**Architecture:** A per-user override table (`user_topic_orders`, mirroring `institution_hidden_topics`) stores each user's chapter order without ever touching the shared `syllabus_topics` rows. The read query merges the user's overrides into an effective order; a mutation upserts the full sequence on drop. The UI uses the already-installed `@dnd-kit` with a `PointerSensor` `delay: 3000` activation constraint plus a synchronized countdown ring, a `DragOverlay` lift, and a Reset action.

**Tech Stack:** React 18 + TS, TanStack Query v5, Supabase (Postgres + RLS), `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (all already installed), Tailwind + design-system tokens.

Design spec: `docs/superpowers/specs/2026-06-25-syllabus-chapter-personal-reorder-design.md`.

## Global Constraints

- **No test runner exists.** Verification loop per task = `npm run typecheck` (exit 0) + `npx eslint <touched paths>` (0 errors) + (where the build surface changes) `npx vite build` (exit 0), plus the manual/SQL checks named in the task. (CLAUDE.md §5a)
- **Lint is strict:** `@typescript-eslint/no-explicit-any` and `prefer-const` are hard errors. Never `as any` — use a real/inline type or `unknown` + narrow cast. (§5a)
- **Errors:** every `onError`/catch toast goes through `toastError(err, { fallback, context })` from `src/lib/toast.ts`. Never `toast.error(err.message)`. (§19)
- **Auth:** never call `supabase.auth.getUser()` without a JWT — read the user id from the page's auth context / local session. (§23)
- **DB:** every new FK gets an index in the same migration; declare `ON DELETE` on every FK to `profiles(id)`. (§21, §23)
- **Migrations are applied out-of-band:** the migration ledger is stale. Apply prod SQL via `scripts/run-sql.ps1` (Management API) and verify via `information_schema`/`pg_policies` — do NOT rely on `supabase db push`. After the table exists, regen types from prod.
- **Design:** colours/shadows via tokens only (`brand-primary`, `surface-card`, `shadow-card-lg`, `text-ink-*`); dark-mode + 375px safe; honour `prefers-reduced-motion`. (§20, design-system skill)
- **Cache:** the chapter query key is prefixed `["institution-topics-v3", …]`; `invalidateSyllabusCache(queryClient)` from `src/lib/queryKeys.ts` invalidates it by prefix — reuse it. (syllabus cache `-v3` invariant)
- **Branch:** all work on `feat/syllabus-chapter-reorder` (already created). Commit after each task. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **NEW** `supabase/migrations/20260625120000_user_topic_orders.sql` — table + indexes + RLS.
- **MOD** `src/integrations/supabase/types.ts` — `user_topic_orders` table type (regen or hand-add).
- **NEW** `src/hooks/useReorderTopics.ts` — `useReorderTopics` + `useResetTopicOrder`.
- **MOD** `src/pages/school/SchoolSyllabusPage.tsx` — merge overrides into `useInstitutionTopics`; wrap the panel chapter list in DnD; `SortableTopicRow`; Reset action.
- **NEW** `src/components/syllabus/ChapterReorderHandle.tsx` — drag handle + 3s countdown ring.
- **MOD** `src/components/syllabus/TopicAccordion.tsx` — optional `leadingSlot` prop replacing the `Layers` disc.

---

## Task 1: Database — `user_topic_orders` table + RLS

**Files:**
- Create: `supabase/migrations/20260625120000_user_topic_orders.sql`

**Interfaces:**
- Produces: table `public.user_topic_orders (user_id uuid, topic_id uuid, display_order int, updated_at timestamptz)` with PK `(user_id, topic_id)` and per-user RLS.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260625120000_user_topic_orders.sql
-- Per-USER personal ordering of syllabus chapters. Mirrors the
-- institution_hidden_topics override pattern, but keyed by user so a person's
-- arrangement never touches the shared (global) syllabus_topics rows and never
-- affects anyone else. Works identically for global and institution chapters.

CREATE TABLE IF NOT EXISTS public.user_topic_orders (
  user_id       UUID NOT NULL REFERENCES public.profiles(id)        ON DELETE CASCADE,
  topic_id      UUID NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

-- FK index (PK already covers user_id-first lookups; topic_id needs its own).
CREATE INDEX IF NOT EXISTS user_topic_orders_topic_idx
  ON public.user_topic_orders (topic_id);

ALTER TABLE public.user_topic_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own topic order"   ON public.user_topic_orders;
DROP POLICY IF EXISTS "Users insert own topic order" ON public.user_topic_orders;
DROP POLICY IF EXISTS "Users update own topic order" ON public.user_topic_orders;
DROP POLICY IF EXISTS "Users delete own topic order" ON public.user_topic_orders;

CREATE POLICY "Users read own topic order"   ON public.user_topic_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own topic order" ON public.user_topic_orders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own topic order" ON public.user_topic_orders
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own topic order" ON public.user_topic_orders
  FOR DELETE TO authenticated USING (user_id = auth.uid());
```

- [ ] **Step 2: Apply to prod via the Management API helper**

Run: `pwsh scripts/run-sql.ps1 -File supabase/migrations/20260625120000_user_topic_orders.sql`
(If the helper takes inline SQL instead of a file, read `scripts/run-sql.ps1`'s parameter block first and adapt; the goal is to execute this file's SQL against project `gyymkgohcijeksmrzuyw`.)
Expected: success, no error body.

- [ ] **Step 3: Verify table + policies exist in prod**

Run this SQL via the same helper:
```sql
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_topic_orders' ORDER BY ordinal_position;
SELECT polname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='user_topic_orders';
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='user_topic_orders';
```
Expected: 4 columns; 4 policies (SELECT/INSERT/UPDATE/DELETE); 2 indexes (PK + `user_topic_orders_topic_idx`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260625120000_user_topic_orders.sql
git commit -m "feat(syllabus): user_topic_orders table for personal chapter ordering"
```

---

## Task 2: Supabase types for `user_topic_orders`

**Files:**
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces: `Database["public"]["Tables"]["user_topic_orders"]` so `supabase.from("user_topic_orders")` is typed (Row/Insert/Update).

- [ ] **Step 1: Regenerate types from prod (preferred)**

Run: `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts`
Then `git diff src/integrations/supabase/types.ts` and confirm ONLY a `user_topic_orders` block was added (if the diff is large/unexpected, discard and use Step 2 instead — a bad regen has dropped schema before).

- [ ] **Step 2 (fallback if regen is unavailable/noisy): hand-add the table block**

Inside `Database.public.Tables`, add:
```ts
user_topic_orders: {
  Row: { user_id: string; topic_id: string; display_order: number; updated_at: string };
  Insert: { user_id: string; topic_id: string; display_order: number; updated_at?: string };
  Update: { user_id?: string; topic_id?: string; display_order?: number; updated_at?: string };
  Relationships: [];
};
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): add user_topic_orders to supabase types"
```

---

## Task 3: Reorder + reset hooks

**Files:**
- Create: `src/hooks/useReorderTopics.ts`

**Interfaces:**
- Consumes: `supabase.from("user_topic_orders")` (Task 2), `invalidateSyllabusCache` (`src/lib/queryKeys.ts`), `toastError` (`src/lib/toast.ts`).
- Produces:
  - `useReorderTopics()` → mutation; `mutate({ userId: string; subjectId: string; orderedTopicIds: string[] })`.
  - `useResetTopicOrder()` → mutation; `mutate({ userId: string; topicIds: string[] })`.

- [ ] **Step 1: Write the hooks file**

```ts
// src/hooks/useReorderTopics.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { toastError } from "@/lib/toast";

interface ReorderInput {
  userId: string;
  subjectId: string;
  orderedTopicIds: string[];
}

/**
 * Persist a user's personal chapter order for one subject. Writes the full
 * 1..N sequence into user_topic_orders (per-user override). Optimistic: the
 * caller reorders its local list immediately; this only persists + reconciles.
 */
export function useReorderTopics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, orderedTopicIds }: ReorderInput) => {
      const rows = orderedTopicIds.map((topic_id, i) => ({
        user_id: userId,
        topic_id,
        display_order: i + 1,
      }));
      const { error } = await supabase
        .from("user_topic_orders")
        .upsert(rows, { onConflict: "user_id,topic_id" });
      if (error) throw error;
    },
    onError: (err: unknown) =>
      toastError(err, { fallback: "Couldn't save the new order.", context: "reorderChapters" }),
    onSettled: () => invalidateSyllabusCache(queryClient),
  });
}

interface ResetInput {
  userId: string;
  topicIds: string[];
}

/** Clear a user's personal order for the given chapters -> back to default. */
export function useResetTopicOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, topicIds }: ResetInput) => {
      const { error } = await supabase
        .from("user_topic_orders")
        .delete()
        .eq("user_id", userId)
        .in("topic_id", topicIds);
      if (error) throw error;
    },
    onError: (err: unknown) =>
      toastError(err, { fallback: "Couldn't reset the order.", context: "resetChapterOrder" }),
    onSettled: () => invalidateSyllabusCache(queryClient),
  });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npx eslint src/hooks/useReorderTopics.ts`
Expected: typecheck exit 0; eslint no output.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useReorderTopics.ts
git commit -m "feat(syllabus): hooks to persist/reset personal chapter order"
```

---

## Task 4: Read path — merge personal overrides into the chapter order

**Files:**
- Modify: `src/pages/school/SchoolSyllabusPage.tsx` (`useInstitutionTopics`, ~lines 593-634, and its call site)

**Interfaces:**
- Consumes: `user_topic_orders` (Task 2). The current user id from the page's auth context.
- Produces: chapters returned already sorted by the user's effective order; query key now includes `userId`.

- [ ] **Step 1: Find how the page gets the current user id**

Run: `grep -n "useAuth\|user?.id\|roleInfo" src/pages/school/SchoolSyllabusPage.tsx | head`
Identify the existing auth source (e.g. `const { user } = useAuth();`). Use that `user?.id` — do NOT add `supabase.auth.getUser()`.

- [ ] **Step 2: Update `useInstitutionTopics` to accept `userId` and merge overrides**

Replace the body of `useInstitutionTopics` (the function near line 593) with:
```ts
function useInstitutionTopics(
  classId: string | null,
  subjectId: string | null,
  institutionId: string | null | undefined,
  userId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["institution-topics-v3", classId, subjectId, institutionId, userId],
    queryFn: async () => {
      if (!subjectId || !institutionId) return [];

      const { data: topics, error } = await supabase
        .from("syllabus_topics")
        .select("*")
        .eq("subject_id", subjectId)
        .eq("is_active", true)
        .or(`institution_id.eq.${institutionId},institution_id.is.null`)
        .order("display_order");
      if (error) throw error;

      const topicIds = (topics || []).map((t) => t.id);
      if (topicIds.length === 0) return [];

      // Personal per-user order overrides (RLS scopes to the caller).
      let overrideMap: Record<string, number> = {};
      if (userId) {
        const { data: overrides } = await supabase
          .from("user_topic_orders")
          .select("topic_id, display_order")
          .eq("user_id", userId)
          .in("topic_id", topicIds);
        overrideMap = (overrides || []).reduce((acc, o) => {
          acc[o.topic_id] = o.display_order;
          return acc;
        }, {} as Record<string, number>);
      }

      const { data: materials } = await supabase
        .from("study_materials")
        .select("topic_id")
        .in("topic_id", topicIds)
        .eq("is_active", true);
      const materialCountMap = (materials || []).reduce((acc, m) => {
        if (m.topic_id) acc[m.topic_id] = (acc[m.topic_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const enriched = (topics || []).map((t) => ({
        ...t,
        material_count: materialCountMap[t.id] || 0,
      }));

      // Effective order: overridden chapters first (by override), then the rest
      // by global display_order, then topic_name. Stable + deterministic.
      const BIG = Number.MAX_SAFE_INTEGER;
      enriched.sort((a, b) => {
        const ao = overrideMap[a.id] ?? BIG;
        const bo = overrideMap[b.id] ?? BIG;
        if (ao !== bo) return ao - bo;
        const ad = a.display_order ?? BIG;
        const bd = b.display_order ?? BIG;
        if (ad !== bd) return ad - bd;
        return (a.topic_name || "").localeCompare(b.topic_name || "");
      });

      return enriched as Topic[];
    },
    enabled: !!subjectId && !!institutionId,
  });
}
```

- [ ] **Step 3: Update the call site to pass `userId`**

Run: `grep -n "useInstitutionTopics(" src/pages/school/SchoolSyllabusPage.tsx`
At the call site, add the user id as the 4th argument, e.g. `useInstitutionTopics(selectedGrade?.id ?? null, selectedSubject?.id ?? null, institutionId, user?.id ?? null)`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx eslint src/pages/school/SchoolSyllabusPage.tsx && npx vite build`
Expected: typecheck 0; eslint clean; build exit 0.
Manual: open a subject's chapters — list still renders in default order (no overrides yet).

- [ ] **Step 5: Commit**

```bash
git add src/pages/school/SchoolSyllabusPage.tsx
git commit -m "feat(syllabus): merge personal chapter-order overrides into read path"
```

---

## Task 5: `ChapterReorderHandle` — drag handle + 3s countdown ring

**Files:**
- Create: `src/components/syllabus/ChapterReorderHandle.tsx`

**Interfaces:**
- Consumes: dnd-kit `DraggableAttributes` + listeners + `setActivatorNodeRef` (from `useSortable`, provided by Task 6).
- Produces: `ChapterReorderHandle` component — a disc button (GripVertical) that shows a brand-teal `3 → 2 → 1` ring while held; cancels on release or move > 8px. dnd-kit's own `delay:3000` constraint (Task 6) is the real activation; this is the synchronized visual.

- [ ] **Step 1: Write the component**

```tsx
// src/components/syllabus/ChapterReorderHandle.tsx
import { useCallback, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { cn } from "@/lib/utils";

const HOLD_MS = 3000;
const MOVE_TOLERANCE = 8;

interface Props {
  chapterName: string;
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  setActivatorNodeRef: (el: HTMLElement | null) => void;
}

export function ChapterReorderHandle({ chapterName, attributes, listeners, setActivatorNodeRef }: Props) {
  const [count, setCount] = useState<number | null>(null); // 3,2,1 while holding
  const [progress, setProgress] = useState(0);              // 0..1
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setCount(null);
    setProgress(0);
  }, []);

  const tick = useCallback(
    (now: number) => {
      const s = startRef.current;
      if (!s) return;
      const elapsed = now - s.t;
      const p = Math.min(elapsed / HOLD_MS, 1);
      setProgress(p);
      setCount(Math.max(1, Math.ceil((HOLD_MS - elapsed) / 1000)));
      if (p >= 1) { stop(); return; } // dnd-kit activates the drag here
      rafRef.current = requestAnimationFrame(tick);
    },
    [stop],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      listeners?.onPointerDown?.(e);          // hand the event to dnd-kit too
      startRef.current = { t: performance.now(), x: e.clientX, y: e.clientY };
      setCount(3);
      setProgress(0);
      rafRef.current = requestAnimationFrame(tick);
    },
    [listeners, tick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const s = startRef.current;
      if (!s) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) stop();
    },
    [stop],
  );

  // SVG ring geometry
  const R = 16;
  const CIRC = 2 * Math.PI * R;

  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onClick={(e) => e.stopPropagation()} // don't toggle the accordion
      aria-label={`Hold 3 seconds, then drag to reorder ${chapterName}`}
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        "bg-muted text-muted-foreground cursor-grab touch-none select-none",
        "transition-colors hover:bg-brand-primary/10 hover:text-brand-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
      )}
    >
      <GripVertical className="h-5 w-5" />
      {count !== null && (
        <span className="absolute inset-0 flex items-center justify-center motion-reduce:hidden">
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r={R} fill="none" stroke="hsl(var(--brand-primary))"
              strokeOpacity={0.2} strokeWidth={3} />
            <circle cx="20" cy="20" r={R} fill="none" stroke="hsl(var(--brand-primary))"
              strokeWidth={3} strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)} />
          </svg>
        </span>
      )}
      {count !== null && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-brand-primary">
          {count}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npx eslint src/components/syllabus/ChapterReorderHandle.tsx`
Expected: typecheck 0; eslint clean. (If the `SyntheticListenerMap` import path errors under this dnd-kit version, change it to `import type { SyntheticListenerMap } from "@dnd-kit/core";` and re-run.)

- [ ] **Step 3: Commit**

```bash
git add src/components/syllabus/ChapterReorderHandle.tsx
git commit -m "feat(syllabus): drag handle with 3s press-and-hold countdown ring"
```

---

## Task 6: Wire DnD into the panel chapter list

**Files:**
- Modify: `src/components/syllabus/TopicAccordion.tsx` (add `leadingSlot` prop)
- Modify: `src/pages/school/SchoolSyllabusPage.tsx` (DndContext + SortableTopicRow + Reset action)

**Interfaces:**
- Consumes: `useReorderTopics`, `useResetTopicOrder` (Task 3), `ChapterReorderHandle` (Task 5), the chapters list from `useInstitutionTopics` (Task 4), the current `user?.id`.
- Produces: the panel chapter list is drag-reorderable per-user.

- [ ] **Step 1: Add `leadingSlot` to `TopicAccordion`**

In `src/components/syllabus/TopicAccordion.tsx`, add to the props interface:
```ts
  leadingSlot?: React.ReactNode;
```
Add `leadingSlot` to the destructured params, then replace the `Layers` disc (lines ~99-101) with:
```tsx
{leadingSlot ?? (
  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
    <Layers className="h-5 w-5" />
  </div>
)}
```
(Keep the `Layers` import — it's still the default.)

- [ ] **Step 2: Add a `SortableTopicRow` wrapper in `SchoolSyllabusPage.tsx`**

Add imports at the top of `SchoolSyllabusPage.tsx`:
```ts
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChapterReorderHandle } from "@/components/syllabus/ChapterReorderHandle";
import { useReorderTopics, useResetTopicOrder } from "@/hooks/useReorderTopics";
import { RotateCcw } from "lucide-react";
```

Define a wrapper component (above `SchoolSyllabusPage`, or inline in the file):
```tsx
function SortableTopicRow({ topic, renderRow }: {
  topic: Topic;
  renderRow: (leadingSlot: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: topic.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {renderRow(
        <ChapterReorderHandle
          chapterName={topic.topic_name ?? "chapter"}
          attributes={attributes}
          listeners={listeners}
          setActivatorNodeRef={setActivatorNodeRef}
        />,
      )}
    </div>
  );
}
```
(If `Topic` is not exported in this file, use the local type already used by `useInstitutionTopics`'s return.)

- [ ] **Step 3: Replace the chapter list render with the DnD-wrapped version**

Locate the panel chapter list map (~lines 1606-1644, `topics.map((topic) => <TopicAccordion ... />)`). Wrap it:
```tsx
const reorder = useReorderTopics();
const resetOrder = useResetTopicOrder();
const [activeId, setActiveId] = useState<string | null>(null);
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { delay: 3000, tolerance: 8 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);
const topicIds = (topics ?? []).map((t) => t.id);

const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
const handleDragEnd = (e: DragEndEvent) => {
  setActiveId(null);
  const { active, over } = e;
  if (!over || active.id === over.id || !user?.id || !selectedSubject?.id) return;
  const oldIndex = topicIds.indexOf(String(active.id));
  const newIndex = topicIds.indexOf(String(over.id));
  if (oldIndex < 0 || newIndex < 0) return;
  const ordered = arrayMove(topicIds, oldIndex, newIndex);
  // optimistic local reorder of the cached list
  queryClient.setQueryData(
    ["institution-topics-v3", selectedGrade?.id ?? null, selectedSubject.id, institutionId, user.id],
    (prev: Topic[] | undefined) =>
      prev ? ordered.map((id) => prev.find((t) => t.id === id)!).filter(Boolean) : prev,
  );
  reorder.mutate({ userId: user.id, subjectId: selectedSubject.id, orderedTopicIds: ordered });
};
```
Then the JSX:
```tsx
<DndContext
  sensors={sensors}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  onDragCancel={() => setActiveId(null)}
>
  <SortableContext items={topicIds} strategy={verticalListSortingStrategy}>
    <div className="space-y-3">
      {(topics ?? []).map((topic) => (
        <SortableTopicRow
          key={topic.id}
          topic={topic}
          renderRow={(leadingSlot) => (
            <TopicAccordion
              id={topic.id}
              topicName={topic.topic_name}
              topicNameHindi={topic.topic_name_hindi}
              difficultyLevel={topic.difficulty_level}
              learningOutcomes={topic.learning_outcomes}
              isGlobal={topic.institution_id == null}
              materials={expandedTopicId === topic.id ? expandedTopicMaterials : []}
              materialCount={topic.material_count}
              isLoadingMaterials={expandedTopicId === topic.id && materialsLoading}
              leadingSlot={leadingSlot}
              onToggle={(topicId, isOpen) => setExpandedTopicId(isOpen ? topicId : null)}
              onAddMaterial={/* keep existing handler */ undefined}
              onDeleteMaterial={/* keep existing handler */ undefined}
              onDelete={/* keep existing handler */ undefined}
            />
          )}
        />
      ))}
    </div>
  </SortableContext>
  <DragOverlay>
    {activeId ? (() => {
      const t = (topics ?? []).find((x) => x.id === activeId);
      return t ? (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card-lg">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
            <GripVertical className="h-5 w-5" />
          </div>
          <span className="font-medium text-ink-900">{t.topic_name}</span>
        </div>
      ) : null;
    })() : null}
  </DragOverlay>
</DndContext>
```
**Important:** copy the existing `onAddMaterial` / `onDeleteMaterial` / `onDelete` handler bodies from the current `TopicAccordion` usage (lines ~1606-1644) verbatim — do not drop them.
Add `import { GripVertical } from "lucide-react";` if not already imported.

- [ ] **Step 4: Add the Reset action**

Above the chapter list header, render (only when there is more than one chapter):
```tsx
{(topics?.length ?? 0) > 1 && user?.id && (
  <button
    type="button"
    onClick={() => resetOrder.mutate({ userId: user.id, topicIds: (topics ?? []).map((t) => t.id) })}
    className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-brand-primary transition-colors"
  >
    <RotateCcw className="h-3.5 w-3.5" />
    Reset order
  </button>
)}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx eslint src/pages/school/SchoolSyllabusPage.tsx src/components/syllabus/TopicAccordion.tsx && npx vite build`
Expected: typecheck 0; eslint clean; build exit 0.
Manual smoke (dev server):
- Quick tap on the handle → nothing happens (no drag, no expand).
- Press and hold the handle → ring counts 3→2→1; at 0 the row lifts; drag up/down; drop → order changes and **persists across reload**.
- Release before 3s, or move during the count → cancels, no reorder.
- "Reset order" → list returns to default.
- Open a **different subject** → its order is independent; you can't drag a chapter into another subject.
- Toggle dark mode + 375px width → handle, ring, overlay all look right.
- Tap elsewhere on the row → still expands materials.

- [ ] **Step 6: Commit**

```bash
git add src/components/syllabus/TopicAccordion.tsx src/pages/school/SchoolSyllabusPage.tsx
git commit -m "feat(syllabus): drag-to-reorder chapters (3s hold) in panel view"
```

---

## Task 7: Final verification, push, merge

- [ ] **Step 1: Full production gate**

Run: `npm run typecheck && npx eslint src/hooks/useReorderTopics.ts src/components/syllabus/ChapterReorderHandle.tsx src/components/syllabus/TopicAccordion.tsx src/pages/school/SchoolSyllabusPage.tsx && npx vite build`
Expected: all green (bundle-size warnings are OK).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/syllabus-chapter-reorder
```

- [ ] **Step 3: Merge to main (only after the user confirms the manual smoke looks right)**

```bash
git fetch origin
git checkout main
git merge --ff-only feat/syllabus-chapter-reorder   # or open a PR if preferred
git push origin main
```

---

## Self-Review

**Spec coverage:** §5 table+RLS → Task 1; §5 types → Task 2; §7 write/reset → Task 3; §6 read merge → Task 4; §8 handle+countdown → Task 5; §8 sortable list, DragOverlay, lift, reset button, keyboard, restrict-to-list → Task 6; §11 verification → each task + Task 7. Covered.

**Placeholder scan:** the only intentional "keep existing handler" notes are in Task 6 Step 3 with an explicit instruction to copy the current handler bodies verbatim (their code lives at the named line range); no TBD/TODO logic.

**Type consistency:** `useReorderTopics({ userId, subjectId, orderedTopicIds })` and `useResetTopicOrder({ userId, topicIds })` are used with matching shapes in Task 6; `user_topic_orders` Row columns (`user_id`, `topic_id`, `display_order`, `updated_at`) match across Tasks 1/2/3/4; `ChapterReorderHandle` props (`chapterName`, `attributes`, `listeners`, `setActivatorNodeRef`) match Tasks 5/6; query key `["institution-topics-v3", classId, subjectId, institutionId, userId]` matches between Task 4 (read) and Task 6 (optimistic write).

**Risk notes for the implementer:** (1) dnd-kit type import paths can vary by version — the fallback is noted in Task 5 Step 2. (2) Confirm the exact auth source for `user?.id` (Task 4 Step 1) and the exact local names `selectedGrade` / `selectedSubject` / `institutionId` / `queryClient` already in scope at the list render before pasting Task 6 Step 3.
