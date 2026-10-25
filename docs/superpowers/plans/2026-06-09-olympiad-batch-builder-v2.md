# Olympiad Batches v2 — Two-Panel Batch Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-generate Kanban batch flow at `/school/olympiad/batches` with a manual two-panel builder (interactive batch cards + live per-class remaining counts) that seats whole classes by PC capacity, supports mixed/overflow batches, and gates Lock on every student being seated.

**Architecture:** Pure seating logic in `src/lib/olympiad/batchSeating.ts` (no React, verified by an ephemeral `npx tsx` script). A paginated roster hook feeds `BatchClass[]`. `BatchBuilder` orchestrates local builder state across `BatchBuilderCard` (left) and `RemainingPanel` (right); lock reuses `oly-lock-batch-schedule` (grade widened to nullable). One DB column added: `oly_schools.pc_count`.

**Tech Stack:** React 18 + TS, TanStack Query v5, shadcn/ui, Tailwind, Supabase (PostgREST + Deno edge fn). No new runtime deps. No test framework added (repo has none; §5a gate = typecheck/eslint/build).

**Design spec:** `docs/superpowers/specs/2026-06-09-olympiad-batch-builder-v2-design.md`

---

## Conventions
- After **every** task, run the §5a gate on touched files: `npm run typecheck`, `npx eslint <paths>`, `npx vite build` — all exit 0. No `any`, no `eslint-disable`, no `as any` (CLAUDE.md §5a).
- IST scheduled_at: `new Date(`${date}T${time}:00+05:30`).toISOString()`.
- Commit after each task (the user will decide when to push; do not push without being asked).

---

## Task 1: Add `oly_schools.pc_count` column + types

**Files:**
- Create: `supabase/migrations/20260609120000_oly_school_pc_count.sql`
- Modify: `src/integrations/supabase/types.ts` (oly_schools Row/Insert/Update)

- [ ] **Step 1: Write the migration**

```sql
-- 20260609120000_oly_school_pc_count.sql
-- Lab capacity (students per batch) for the Olympiad batch builder.
-- Remembered per school so the admin doesn't re-enter it each scheduling session.
alter table public.oly_schools
  add column if not exists pc_count integer
  check (pc_count is null or pc_count > 0);

comment on column public.oly_schools.pc_count is
  'Computer-lab capacity (students per batch) for Olympiad batch scheduling; set once by the school admin.';
```

- [ ] **Step 2: Apply to prod** via the Management API SQL endpoint (established workflow — PAT from Windows Credential Manager target `Supabase CLI:supabase`, `POST https://api.supabase.com/v1/projects/gyymkgohcijeksmrzuyw/database/query` with `{query}`). Confirm the column exists:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='oly_schools' and column_name='pc_count';
```
Expected: one row, `integer`, `YES`.

- [ ] **Step 3: Patch generated types.** In `src/integrations/supabase/types.ts`, find the `oly_schools` table block. Add to its `Row`: `pc_count: number | null`. Add to `Insert` and `Update`: `pc_count?: number | null`.

- [ ] **Step 4: Gate.** `npm run typecheck` → exit 0. Commit.

```bash
git add supabase/migrations/20260609120000_oly_school_pc_count.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): add oly_schools.pc_count for batch builder"
```

---

## Task 2: Pure seating logic + ephemeral verification

**Files:**
- Create: `src/lib/olympiad/batchSeating.ts`
- Temp (delete in Step 4): `scripts/check-batch-seating.ts`

- [ ] **Step 1: Write `batchSeating.ts`** (no React; the single source of the seating rule):

```ts
// src/lib/olympiad/batchSeating.ts
// Pure "whole-class fill" seating logic for the Olympiad batch builder.
// See docs/superpowers/specs/2026-06-09-olympiad-batch-builder-v2-design.md.

export type BatchClass = {
  gradeLevelId: string;
  classLabel: string;
  studentIds: string[]; // ordered by roll_number
};

export type Allocation = {
  gradeLevelId: string;
  classLabel: string;
  studentIds: string[];
};

export type BuilderBatch = {
  id: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  allocations: Allocation[];
};

export type AddCheck = { ok: true } | { ok: false; reason: string };

export function batchSize(b: BuilderBatch): number {
  return b.allocations.reduce((n, a) => n + a.studentIds.length, 0);
}

export function batchFree(b: BuilderBatch, pcCount: number): number {
  return Math.max(0, pcCount - batchSize(b));
}

/** Student IDs of a class not yet seated in any batch, in roll order. */
export function unassignedIds(cls: BatchClass, batches: BuilderBatch[]): string[] {
  const seated = new Set<string>();
  for (const b of batches) {
    for (const a of b.allocations) {
      if (a.gradeLevelId === cls.gradeLevelId) {
        for (const id of a.studentIds) seated.add(id);
      }
    }
  }
  return cls.studentIds.filter((id) => !seated.has(id));
}

export function remainingByClass(
  classes: BatchClass[],
  batches: BuilderBatch[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of classes) out[c.gradeLevelId] = unassignedIds(c, batches).length;
  return out;
}

/** Whole-class-fill rule. */
export function canAddClass(
  cls: BatchClass,
  batch: BuilderBatch,
  batches: BuilderBatch[],
  pcCount: number,
): AddCheck {
  const remaining = unassignedIds(cls, batches).length;
  if (remaining <= 0) return { ok: false, reason: `${cls.classLabel} is fully seated.` };
  const free = batchFree(batch, pcCount);
  if (free <= 0) return { ok: false, reason: "This batch is full." };
  if (remaining <= free) return { ok: true };
  // remaining > free: only allowed when the batch is empty (pour + overflow).
  if (batchSize(batch) === 0) return { ok: true };
  return {
    ok: false,
    reason: `${cls.classLabel} (${remaining} left) won't fit in ${free} free PC${free === 1 ? "" : "s"} — start a new batch.`,
  };
}

/** Returns a NEW batches array with as many of the class's students as fit added to the batch. No-op if the rule forbids it. */
export function addClassToBatch(
  cls: BatchClass,
  batchId: string,
  batches: BuilderBatch[],
  pcCount: number,
): BuilderBatch[] {
  const target = batches.find((b) => b.id === batchId);
  if (!target) return batches;
  if (!canAddClass(cls, target, batches, pcCount).ok) return batches;
  const free = batchFree(target, pcCount);
  const chunk = unassignedIds(cls, batches).slice(0, free);
  if (chunk.length === 0) return batches;
  return batches.map((b) => {
    if (b.id !== batchId) return b;
    const existing = b.allocations.find((a) => a.gradeLevelId === cls.gradeLevelId);
    if (existing) {
      return {
        ...b,
        allocations: b.allocations.map((a) =>
          a.gradeLevelId === cls.gradeLevelId
            ? { ...a, studentIds: [...a.studentIds, ...chunk] }
            : a,
        ),
      };
    }
    return {
      ...b,
      allocations: [
        ...b.allocations,
        { gradeLevelId: cls.gradeLevelId, classLabel: cls.classLabel, studentIds: chunk },
      ],
    };
  });
}

export function removeAllocation(
  batchId: string,
  gradeLevelId: string,
  batches: BuilderBatch[],
): BuilderBatch[] {
  return batches.map((b) =>
    b.id === batchId
      ? { ...b, allocations: b.allocations.filter((a) => a.gradeLevelId !== gradeLevelId) }
      : b,
  );
}

/** Greedy auto-fill, largest-remaining-first, same rule. Dates/times left blank for the admin. */
export function autoFill(
  classes: BatchClass[],
  pcCount: number,
  makeId: (i: number) => string,
): BuilderBatch[] {
  const pools = classes.map((c) => ({ cls: c, ids: [...c.studentIds] }));
  const batches: BuilderBatch[] = [];
  let idx = 0;
  let guard = 0;
  while (pools.some((p) => p.ids.length > 0)) {
    if (guard++ > 100000) break;
    const batch: BuilderBatch = { id: makeId(idx++), date: "", startTime: "", allocations: [] };
    let free = pcCount;
    for (;;) {
      if (free <= 0) break;
      const withLeft = pools.filter((p) => p.ids.length > 0);
      if (withLeft.length === 0) break;
      const fitting = withLeft
        .filter((p) => p.ids.length <= free)
        .sort((a, b) => b.ids.length - a.ids.length);
      let pick = fitting[0];
      if (!pick) {
        if (batch.allocations.length === 0) {
          pick = [...withLeft].sort((a, b) => b.ids.length - a.ids.length)[0];
        } else {
          break;
        }
      }
      const take = Math.min(pick.ids.length, free);
      const chunk = pick.ids.splice(0, take);
      const existing = batch.allocations.find((a) => a.gradeLevelId === pick.cls.gradeLevelId);
      if (existing) existing.studentIds.push(...chunk);
      else
        batch.allocations.push({
          gradeLevelId: pick.cls.gradeLevelId,
          classLabel: pick.cls.classLabel,
          studentIds: chunk,
        });
      free -= take;
    }
    batches.push(batch);
  }
  return batches;
}

export function allSeated(classes: BatchClass[], batches: BuilderBatch[]): boolean {
  return Object.values(remainingByClass(classes, batches)).every((n) => n === 0);
}

export function batchStudentIds(b: BuilderBatch): string[] {
  return b.allocations.flatMap((a) => a.studentIds);
}

/** Single grade for a single-class batch; null for a mixed batch. */
export function batchGradeLevelId(b: BuilderBatch): string | null {
  const grades = new Set(b.allocations.map((a) => a.gradeLevelId));
  return grades.size === 1 ? [...grades][0] : null;
}

export function batchLabel(b: BuilderBatch, index: number): string {
  const labels = [...new Set(b.allocations.map((a) => a.classLabel))];
  return labels.length > 0 ? `Batch ${index + 1} — ${labels.join(", ")}` : `Batch ${index + 1}`;
}
```

- [ ] **Step 2: Write the verification script** encoding the spec's worked example + edge cases:

```ts
// scripts/check-batch-seating.ts  (TEMPORARY — delete after Step 4)
import assert from "node:assert/strict";
import {
  addClassToBatch, canAddClass, autoFill, remainingByClass, allSeated,
  batchGradeLevelId, batchLabel, batchSize, type BatchClass, type BuilderBatch,
} from "../src/lib/olympiad/batchSeating.ts";

const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}-${i + 1}`);
const c10: BatchClass = { gradeLevelId: "g10", classLabel: "Class 10", studentIds: ids("s10", 25) };
const c9: BatchClass = { gradeLevelId: "g9", classLabel: "Class 9", studentIds: ids("s9", 10) };
const classes = [c10, c9];
const PC = 20;

// --- Worked example ---
let b: BuilderBatch[] = [{ id: "b1", date: "", startTime: "", allocations: [] }];
b = addClassToBatch(c10, "b1", b, PC);          // pour 20, overflow 5
assert.equal(batchSize(b[0]), 20, "Batch 1 fills to 20");
assert.equal(remainingByClass(classes, b).g10, 5, "5 Class-10 overflow");
assert.equal(batchGradeLevelId(b[0]), "g10", "single-class batch keeps grade");

b = [...b, { id: "b2", date: "", startTime: "", allocations: [] }];
b = addClassToBatch(c9, "b2", b, PC);           // whole Class 9 → 10
assert.equal(batchSize(b[1]), 10, "Batch 2 has Class 9 (10)");

// A fresh oversized class into the now-non-empty b2 would be blocked (simulate a 30-strong class)
const big: BatchClass = { gradeLevelId: "g8", classLabel: "Class 8", studentIds: ids("s8", 30) };
assert.equal(canAddClass(big, b[1], [...b, ], PC).ok, false, "fresh oversized class blocked in half-full batch");

b = addClassToBatch(c10, "b2", b, PC);          // 5 leftovers top up (5 <= 10 free)
assert.equal(batchSize(b[1]), 15, "Batch 2 tops up to 15");
assert.equal(remainingByClass(classes, b).g10, 0, "Class 10 fully seated");
assert.equal(batchGradeLevelId(b[1]), null, "mixed batch grade is null");
assert.equal(batchLabel(b[1], 1), "Batch 2 — Class 9, Class 10", "mixed label");
assert.equal(allSeated(classes, b), true, "all seated");

// --- Auto-fill seats everyone deterministically ---
const af = autoFill(classes, PC, (i) => `af-${i}`);
assert.equal(allSeated(classes, af), true, "auto-fill seats everyone");
const seated = af.flatMap((x) => x.allocations.flatMap((a) => a.studentIds));
assert.equal(new Set(seated).size, 35, "no duplicates, all 35 placed");

// --- Class exactly == capacity fits; class < capacity fits whole ---
const exact: BatchClass = { gradeLevelId: "gx", classLabel: "CX", studentIds: ids("sx", 20) };
let e: BuilderBatch[] = [{ id: "e1", date: "", startTime: "", allocations: [] }];
e = addClassToBatch(exact, "e1", e, PC);
assert.equal(batchSize(e[0]), 20, "exact-fit class fills the batch");

console.log("ALL SEATING ASSERTIONS PASSED");
```

- [ ] **Step 3: Run it.** `npx --yes tsx scripts/check-batch-seating.ts`
Expected: `ALL SEATING ASSERTIONS PASSED` and exit 0. If any assert throws, fix `batchSeating.ts` and re-run.

- [ ] **Step 4: Delete the temp script**, gate, commit.
```bash
rm scripts/check-batch-seating.ts
npx eslint src/lib/olympiad/batchSeating.ts   # 0 errors
git add src/lib/olympiad/batchSeating.ts
git commit -m "feat(olympiad): pure whole-class-fill seating logic"
```

---

## Task 3: Paginated batching-roster hook

**Files:**
- Create: `src/hooks/olympiad/useOlympiadBatchingRoster.ts`

- [ ] **Step 1: Write the hook** (reuses `BatchClass` from the seating lib):

```ts
// src/hooks/olympiad/useOlympiadBatchingRoster.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BatchClass } from "@/lib/olympiad/batchSeating";

/**
 * All ACTIVE students for the school, grouped into classes for the batch builder.
 * Cursor-paginated (pages of 1000) so big schools don't hit the PostgREST 1000-row
 * cap (CLAUDE.md §23.1). Admin-only, low-concurrency screen.
 */
export function useOlympiadBatchingRoster(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "batching-roster", olySchoolId],
    queryFn: async (): Promise<BatchClass[]> => {
      if (!olySchoolId) return [];
      const PAGE = 1000;
      const rows: { id: string; grade_level_id: string | null; class_label: string; roll_number: string }[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("oly_students")
          .select("id, grade_level_id, class_label, roll_number")
          .eq("oly_school_id", olySchoolId)
          .eq("status", "active")
          .order("class_label")
          .order("roll_number")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = data ?? [];
        rows.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      const byGrade = new Map<string, BatchClass>();
      for (const r of rows) {
        if (!r.grade_level_id) continue;
        const g =
          byGrade.get(r.grade_level_id) ??
          { gradeLevelId: r.grade_level_id, classLabel: r.class_label, studentIds: [] };
        g.studentIds.push(r.id);
        byGrade.set(r.grade_level_id, g);
      }
      return [...byGrade.values()].sort((a, b) =>
        a.classLabel.localeCompare(b.classLabel, undefined, { numeric: true }),
      );
    },
    enabled: !!olySchoolId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Gate** (`npm run typecheck`, `npx eslint <file>`), commit.

---

## Task 4: `pc_count` read + write

**Files:**
- Modify: `src/hooks/olympiad/useOlympiadMySchool.ts` (select + type)
- Create: `src/hooks/olympiad/useUpdateOlympiadPcCount.ts`

- [ ] **Step 1: Extend `useOlympiadMySchool`.** Add `pc_count: number | null;` to the `MyOlympiadSchool` type. Add `pc_count` to the select string (line 24). In the returned object add `pc_count: data.pc_count ?? null,`.

- [ ] **Step 2: Write the mutation:**

```ts
// src/hooks/olympiad/useUpdateOlympiadPcCount.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export function useUpdateOlympiadPcCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ olySchoolId, pcCount }: { olySchoolId: string; pcCount: number }) => {
      const { error } = await supabase
        .from("oly_schools")
        .update({ pc_count: pcCount })
        .eq("id", olySchoolId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["olympiad", "my-school"] }),
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save lab capacity.", context: "useUpdateOlympiadPcCount" }),
  });
}
```

- [ ] **Step 3: Gate**, commit.

---

## Task 5: `AddClassMenu` component

**Files:**
- Create: `src/components/olympiad/school/AddClassMenu.tsx`

- [ ] **Step 1: Write it.** A Popover listing classes with `remaining > 0`; rule-blocked classes are disabled and show the reason.

```tsx
// src/components/olympiad/school/AddClassMenu.tsx
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { canAddClass, type BatchClass, type BuilderBatch } from "@/lib/olympiad/batchSeating";

type Props = {
  classes: BatchClass[];
  batch: BuilderBatch;
  batches: BuilderBatch[];
  pcCount: number;
  remaining: Record<string, number>;
  onAdd: (gradeLevelId: string) => void;
  disabled?: boolean;
};

export function AddClassMenu({ classes, batch, batches, pcCount, remaining, onAdd, disabled }: Props) {
  const candidates = classes.filter((c) => (remaining[c.gradeLevelId] ?? 0) > 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || candidates.length === 0}>
          <Plus className="h-4 w-4 mr-1" /> Add class
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {candidates.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-500">All students seated.</p>
        ) : (
          candidates.map((c) => {
            const check = canAddClass(c, batch, batches, pcCount);
            return (
              <button
                key={c.gradeLevelId}
                type="button"
                disabled={!check.ok}
                onClick={() => check.ok && onAdd(c.gradeLevelId)}
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                title={check.ok ? undefined : check.reason}
              >
                <span className="font-medium text-ink-900">{c.classLabel}</span>
                <span className="ml-2 text-ink-500">{remaining[c.gradeLevelId]} left</span>
                {!check.ok && <span className="block text-[11px] text-ink-400">{check.reason}</span>}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Gate** (`npx eslint <file>`), commit. (Full visual verification happens in Task 9.)

---

## Task 6: `BatchBuilderCard` component

**Files:**
- Create: `src/components/olympiad/school/BatchBuilderCard.tsx`

- [ ] **Step 1: Write it.** Date + start-time inputs, allocation rows with remove, capacity bar, AddClassMenu, remove-batch. `endLabel` derived from campaign duration (optional).

```tsx
// src/components/olympiad/school/BatchBuilderCard.tsx
import { CalendarDays, Clock, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { batchFree, batchSize, type BatchClass, type BuilderBatch } from "@/lib/olympiad/batchSeating";
import { AddClassMenu } from "./AddClassMenu";

type Props = {
  index: number;
  batch: BuilderBatch;
  batches: BuilderBatch[];
  classes: BatchClass[];
  pcCount: number;
  remaining: Record<string, number>;
  durationMinutes?: number;
  onPatch: (patch: Partial<Pick<BuilderBatch, "date" | "startTime">>) => void;
  onAddClass: (gradeLevelId: string) => void;
  onRemoveClass: (gradeLevelId: string) => void;
  onRemoveBatch: () => void;
};

function endLabel(start: string, mins?: number): string | null {
  if (!start || !mins) return null;
  const [h, m] = start.split(":").map(Number);
  const end = new Date(0);
  end.setUTCHours(h, m + mins, 0, 0);
  return `${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")}`;
}

export function BatchBuilderCard({
  index, batch, batches, classes, pcCount, remaining, durationMinutes,
  onPatch, onAddClass, onRemoveClass, onRemoveBatch,
}: Props) {
  const size = batchSize(batch);
  const free = batchFree(batch, pcCount);
  const pct = pcCount > 0 ? Math.min(100, Math.round((size / pcCount) * 100)) : 0;
  const end = endLabel(batch.startTime, durationMinutes);

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-900">Batch {index + 1}</p>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-ink-400 hover:text-red-500" onClick={onRemoveBatch} aria-label="Remove batch">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="eyebrow flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Date</span>
          <Input type="date" value={batch.date} onChange={(e) => onPatch({ date: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="eyebrow flex items-center gap-1"><Clock className="h-3 w-3" /> Start time</span>
          <Input type="time" value={batch.startTime} onChange={(e) => onPatch({ startTime: e.target.value })} />
          {end && <span className="text-[11px] text-ink-500">Ends ~{end}</span>}
        </label>
      </div>

      <div className="space-y-1.5">
        {batch.allocations.length === 0 ? (
          <p className="text-sm text-ink-500">No classes yet — add one below.</p>
        ) : (
          batch.allocations.map((a) => (
            <div key={a.gradeLevelId} className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
              <span className="text-ink-900">{a.classLabel} · {a.studentIds.length}</span>
              <button type="button" onClick={() => onRemoveClass(a.gradeLevelId)} className="text-ink-400 hover:text-red-500" aria-label={`Remove ${a.classLabel}`}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="space-y-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] tabular-nums text-ink-500">
            {size} / {pcCount} PCs{free === 0 ? " · full" : ` · ${free} free`}
          </span>
          <AddClassMenu
            classes={classes}
            batch={batch}
            batches={batches}
            pcCount={pcCount}
            remaining={remaining}
            onAdd={onAddClass}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate**, commit.

---

## Task 7: `RemainingPanel` component

**Files:**
- Create: `src/components/olympiad/school/RemainingPanel.tsx`

- [ ] **Step 1: Write it.** Per-class assigned/total + bar, total unassigned, Lock button (gated). The lock confirmation reuses the existing `LockScheduleDialog`.

```tsx
// src/components/olympiad/school/RemainingPanel.tsx
import { Lock, CheckCircle2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BatchClass, BuilderBatch } from "@/lib/olympiad/batchSeating";

type Props = {
  classes: BatchClass[];
  remaining: Record<string, number>;
  totalUnassigned: number;
  canLock: boolean;
  lockHint: string | null;
  lockPending: boolean;
  onLock: () => void;
};

export function RemainingPanel({
  classes, remaining, totalUnassigned, canLock, lockHint, lockPending, onLock,
}: Props) {
  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-4 lg:sticky lg:top-20">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-ink-500" />
        <p className="text-sm font-semibold text-ink-900">Students remaining</p>
      </div>

      <ul className="space-y-2.5">
        {classes.map((c) => {
          const left = remaining[c.gradeLevelId] ?? 0;
          const total = c.studentIds.length;
          const seated = total - left;
          const pct = total > 0 ? Math.round((seated / total) * 100) : 0;
          return (
            <li key={c.gradeLevelId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-900">{c.classLabel}</span>
                <span className="tabular-nums text-ink-500">{seated}/{total}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full transition-all ${left === 0 ? "bg-emerald-500" : "bg-brand-primary"}`} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-surface-stroke pt-3">
        {totalUnassigned === 0 ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> All students seated
          </p>
        ) : (
          <p className="text-sm text-ink-600">{totalUnassigned} student{totalUnassigned === 1 ? "" : "s"} unassigned</p>
        )}
        <Button className="mt-3 w-full" disabled={!canLock || lockPending} onClick={onLock}>
          <Lock className="h-4 w-4 mr-1" /> Lock schedule
        </Button>
        {!canLock && lockHint && <p className="mt-1.5 text-[11px] text-ink-500">{lockHint}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate**, commit.

---

## Task 8: `BatchBuilder` orchestrator + lock-hook decoupling

**Files:**
- Modify: `src/hooks/olympiad/useLockBatchSchedule.ts` (self-contained nullable type)
- Create: `src/components/olympiad/school/BatchBuilder.tsx`

- [ ] **Step 1: Decouple `useLockBatchSchedule`** from the (soon-deleted) generate hook. Replace its imported `DraftBatch` usage with a self-contained type:

```ts
// src/hooks/olympiad/useLockBatchSchedule.ts  (replace the type import + mutationFn signature)
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export type LockBatch = {
  scheduled_at: string;
  grade_level_id: string | null;
  student_ids: string[];
  pc_count: number;
  batch_label: string;
  pin_expiry_minutes?: number;
  is_absentees?: boolean;
};

export function useLockBatchSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_school_id, batches }: { oly_school_id: string; batches: LockBatch[] }) =>
      invokeEdgeFunction<{ batch_ids: string[] }>("oly-lock-batch-schedule", { oly_school_id, batches }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(`Locked ${data.batch_ids.length} batches with PINs generated`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't lock schedule.", context: "useLockBatchSchedule" }),
  });
}
```

> Verify the exact pre-existing import lines before replacing; keep `invokeEdgeFunction` import path identical to the current file.

- [ ] **Step 2: Write `BatchBuilder`** (owns pcCount + batches state, renders the two panels, auto-fill, add-batch, lock):

```tsx
// src/components/olympiad/school/BatchBuilder.tsx
import { useMemo, useState } from "react";
import { Loader2, Plus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadBatchingRoster } from "@/hooks/olympiad/useOlympiadBatchingRoster";
import { useUpdateOlympiadPcCount } from "@/hooks/olympiad/useUpdateOlympiadPcCount";
import { useLockBatchSchedule, type LockBatch } from "@/hooks/olympiad/useLockBatchSchedule";
import { useOlympiadCampaign } from "@/hooks/olympiad/useOlympiadCampaign";
import type { MyOlympiadSchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { LockScheduleDialog } from "./LockScheduleDialog";
import { BatchBuilderCard } from "./BatchBuilderCard";
import { RemainingPanel } from "./RemainingPanel";
import {
  addClassToBatch, allSeated, autoFill, batchGradeLevelId, batchLabel, batchStudentIds,
  remainingByClass, removeAllocation, type BuilderBatch,
} from "@/lib/olympiad/batchSeating";

let _seq = 0;
const newId = () => `b-${_seq++}`;

export function BatchBuilder({ school }: { school: MyOlympiadSchool }) {
  const { data: classes = [], isLoading } = useOlympiadBatchingRoster(school.id);
  const { data: campaign } = useOlympiadCampaign();
  const savePc = useUpdateOlympiadPcCount();
  const lock = useLockBatchSchedule();

  const [pcCount, setPcCount] = useState<number>(school.pc_count ?? 20);
  const [batches, setBatches] = useState<BuilderBatch[]>([]);
  const [lockOpen, setLockOpen] = useState(false);

  const remaining = useMemo(() => remainingByClass(classes, batches), [classes, batches]);
  const totalEnrolled = useMemo(() => classes.reduce((n, c) => n + c.studentIds.length, 0), [classes]);
  const totalUnassigned = Object.values(remaining).reduce((a, b) => a + b, 0);

  const everyoneSeated = classes.length > 0 && allSeated(classes, batches);
  const nonEmpty = batches.filter((b) => b.allocations.length > 0);
  const missingTimes = nonEmpty.some((b) => !b.date || !b.startTime);
  const canLock = everyoneSeated && nonEmpty.length > 0 && !missingTimes;
  const lockHint = !everyoneSeated
    ? `${totalUnassigned} student${totalUnassigned === 1 ? "" : "s"} still unassigned`
    : missingTimes
    ? "Set a date and time on every batch"
    : null;

  const commitPc = (v: number) => {
    const n = Math.max(1, Math.floor(v) || 1);
    setPcCount(n);
    if (n !== (school.pc_count ?? null)) savePc.mutate({ olySchoolId: school.id, pcCount: n });
  };

  const addBatch = () =>
    setBatches((b) => [...b, { id: newId(), date: "", startTime: "", allocations: [] }]);

  const handleLock = async () => {
    const payload: LockBatch[] = nonEmpty.map((b, i) => ({
      scheduled_at: new Date(`${b.date}T${b.startTime}:00+05:30`).toISOString(),
      grade_level_id: batchGradeLevelId(b),
      student_ids: batchStudentIds(b),
      pc_count: pcCount,
      batch_label: batchLabel(b, i),
    }));
    try {
      await lock.mutateAsync({ oly_school_id: school.id, batches: payload });
      setLockOpen(false);
      // page flips to State 3 on ["olympiad"] invalidation
    } catch {
      /* toastError fires in the hook */
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (classes.length === 0) {
    return <EmptyState icon={<Plus className="h-7 w-7" />} title="No enrolled students" description="There are no active enrolled students to schedule into batches." reason="noData" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pc-count">Lab capacity (PCs)</Label>
            <Input
              id="pc-count" type="number" min={1} max={1000} className="w-32"
              value={pcCount}
              onChange={(e) => setPcCount(Math.max(1, parseInt(e.target.value || "1", 10)))}
              onBlur={(e) => commitPc(parseInt(e.target.value || "1", 10))}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => setBatches(autoFill(classes, pcCount, newId))}>
            <Wand2 className="h-4 w-4 mr-1" /> Auto-fill
          </Button>
        </div>
        <p className="text-sm text-ink-500">{totalEnrolled} enrolled across {classes.length} classes</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-3">
          {batches.map((b, i) => (
            <BatchBuilderCard
              key={b.id}
              index={i}
              batch={b}
              batches={batches}
              classes={classes}
              pcCount={pcCount}
              remaining={remaining}
              durationMinutes={campaign?.exam_duration_minutes}
              onPatch={(patch) => setBatches((all) => all.map((x) => (x.id === b.id ? { ...x, ...patch } : x)))}
              onAddClass={(gid) => setBatches((all) => addClassToBatch(classes.find((c) => c.gradeLevelId === gid)!, b.id, all, pcCount))}
              onRemoveClass={(gid) => setBatches((all) => removeAllocation(b.id, gid, all))}
              onRemoveBatch={() => setBatches((all) => all.filter((x) => x.id !== b.id))}
            />
          ))}
          <Button type="button" variant="outline" className="w-full" onClick={addBatch}>
            <Plus className="h-4 w-4 mr-1" /> Add batch
          </Button>
        </div>

        <RemainingPanel
          classes={classes}
          remaining={remaining}
          totalUnassigned={totalUnassigned}
          canLock={canLock}
          lockHint={lockHint}
          lockPending={lock.isPending}
          onLock={() => setLockOpen(true)}
        />
      </div>

      <LockScheduleDialog
        open={lockOpen}
        onOpenChange={setLockOpen}
        batchCount={nonEmpty.length}
        onConfirm={handleLock}
      />
    </div>
  );
}
```

> Before writing, open `src/hooks/olympiad/useOlympiadCampaign.ts` to confirm the export name (`useOlympiadCampaign`) and that the returned object exposes `exam_duration_minutes`. If the hook needs an argument or returns a differently-named field, adjust the import/use accordingly. The `durationMinutes` display is non-critical — if the campaign hook is awkward to call here, pass `undefined` and drop the "Ends ~" line.

- [ ] **Step 3: Gate** (`npm run typecheck`, `npx eslint <touched>`, `npx vite build`), commit.

---

## Task 9: Wire `BatchBuilder` into the page

**Files:**
- Modify: `src/pages/school/olympiad/OlympiadSchoolBatchesPage.tsx`

- [ ] **Step 1: Replace States 2a + 2b** (the `BatchScheduleInputs` and `BatchKanban`/`LockScheduleDialog` blocks, lines ~88–157) with a single render of `<BatchBuilder school={school} />`. Remove now-unused imports: `useState`, `useQuery`/`supabase`/`useGradeNames`, `useGenerateBatchSchedule`, `BatchScheduleInputs`, `BatchKanban`, `LockScheduleDialog`, `DraftBatch`, `useLockBatchSchedule`, `Lock`. Keep `useOlympiadMySchool`, `useOlympiadBatches`, `useNavigate`, `Loader2`, `Button`. Add `import { BatchBuilder } from "@/components/olympiad/school/BatchBuilder";`.

The resulting body keeps **State 1** (enrollment_open message), the new builder block, and **State 3** (locked summary) unchanged:

```tsx
{/* enrollment closed, not yet locked — manual builder */}
{schoolStatus === "enrollment_closed" && !hasLocked && <BatchBuilder school={school} />}
```

- [ ] **Step 2: Gate** (`npm run typecheck`, `npx eslint`, `npx vite build` — all exit 0).

- [ ] **Step 3: Manual smoke** at `localhost` as a school admin of an `enrollment_closed` school: builder renders two panels; set lab capacity; Auto-fill seats everyone (right panel all green, "All students seated"); manually remove a class and re-add; add a batch; set dates/times; Lock disabled until everyone seated + times set; lock → State 3 summary; PIN custody shows descriptive labels. Commit.

---

## Task 10: Edge function — nullable batch grade

**Files:**
- Modify: `supabase/functions/oly-lock-batch-schedule/index.ts`

- [ ] **Step 1: Widen the input type.** In the `type Input` block, change `grade_level_id: string;` to `grade_level_id: string | null;`. No other change (the insert already passes the value through; column is nullable).

- [ ] **Step 2: Deploy.** `npx supabase@latest functions deploy oly-lock-batch-schedule --project-ref gyymkgohcijeksmrzuyw --use-api`

- [ ] **Step 3: Verify** by locking a mixed-batch schedule from the UI and confirming in DB:
```sql
select batch_label, grade_level_id, pc_count, scheduled_at
from public.oly_batches order by created_at desc limit 5;
```
Expected: a mixed batch row has `grade_level_id = null` and a descriptive `batch_label`. Commit.

---

## Task 11: Retire dead code

**Files:**
- Delete: `src/components/olympiad/school/BatchScheduleInputs.tsx`, `src/components/olympiad/school/BatchKanban.tsx`, `src/components/olympiad/school/BatchCard.tsx`, `src/hooks/olympiad/useGenerateBatchSchedule.ts`
- Keep: `LockScheduleDialog.tsx` (reused), `oly-generate-batch-schedule` edge fn (left dormant — note in commit message it's no longer called).

- [ ] **Step 1:** Confirm zero references before deleting:
```
npx eslint src   # or: grep for "useGenerateBatchSchedule", "BatchKanban", "BatchCard", "BatchScheduleInputs"
```
Use Grep to ensure no remaining imports. If `oly_batches.grade_level_id` is referenced anywhere new, re-verify it tolerates null (it does for the known consumers: `PinCustodyRow` uses `batch_label`; reminders/credentials key off `oly_students`).

- [ ] **Step 2: Delete** the four files. `npm run typecheck` + `npx vite build` → exit 0 (catches any missed import). Commit.

---

## Task 12: Final gate + smoke

- [ ] **Step 1:** Full §5a gate clean across all touched paths: `npm run typecheck` (0), `npx eslint src/lib/olympiad/batchSeating.ts src/hooks/olympiad/useOlympiadBatchingRoster.ts src/hooks/olympiad/useUpdateOlympiadPcCount.ts src/hooks/olympiad/useLockBatchSchedule.ts src/hooks/olympiad/useOlympiadMySchool.ts src/components/olympiad/school/AddClassMenu.tsx src/components/olympiad/school/BatchBuilderCard.tsx src/components/olympiad/school/RemainingPanel.tsx src/components/olympiad/school/BatchBuilder.tsx src/pages/school/olympiad/OlympiadSchoolBatchesPage.tsx` (0), `npx vite build` (exit 0).

- [ ] **Step 2: Cross-cutting smoke** (375px + desktop, light + dark):
  - School with one class > pcCount → overflow rolls correctly across batches.
  - School with several small classes → multiple classes pack into one batch; idle PCs allowed on save.
  - Empty/blocked add: a fresh oversized class is greyed in a half-full batch with the reason; an empty batch lets it pour.
  - Lock gate: cannot lock with any unassigned student or any batch missing date/time.
  - After lock: State 3 summary; PIN custody labels descriptive; student PIN entry still validates (school now `batches_scheduled`).
  - Dark mode: every surface/text/shadow flips (no cream/white leftovers).

- [ ] **Step 3:** Report results to the user. Do **not** push or merge without explicit user direction (large body of uncommitted session work already exists).

---

## Self-review notes
- **Spec coverage:** two-panel layout (T6–T8), whole-class-fill rule (T2), auto-fill (T2/T8), live remaining (T7), per-card date/time (T6), completion gate (T8), pc_count persistence (T1/T4), mixed batches via nullable grade (T10), all-schools scope (page swap T9). ✓
- **No new test framework** (repo has none; tuned tsconfig/gate is risk-sensitive) — pure logic verified by ephemeral `npx tsx` script instead. ✓
- **§23:** roster paginated (T3, range-based), explicit columns, staleTime set, no new realtime/subscriptions, admin-only low-concurrency screen. ✓
- **Type consistency:** `BatchClass`/`BuilderBatch`/`LockBatch` defined once and imported; `grade_level_id: string | null` consistent across seating lib, lock hook, edge fn, and `useOlympiadBatches`. ✓
