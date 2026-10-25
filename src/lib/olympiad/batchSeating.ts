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
    reason: `${cls.classLabel} (${remaining} left) won't fit in ${free} free PC${free === 1 ? "" : "s"}. Start a new batch.`,
  };
}

/**
 * Returns a NEW batches array with as many of the class's students as fit added
 * to the batch. No-op if the rule forbids it.
 */
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

/**
 * Greedy auto-fill, largest-remaining-first, same rule. Dates/times left blank
 * for the admin to set.
 */
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
  return labels.length > 0 ? `Batch ${index + 1}: ${labels.join(", ")}` : `Batch ${index + 1}`;
}
