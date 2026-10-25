# Merge Timetable & Period Structures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the separate `/school/timetable` and `/school/period-structures` pages into a single `/school/timetable` page with three top-level tabs (*Build*, *Period Structures*, *Class Assignments*), preserving deep links via a `?tab=` query param and a redirect from the old route.

**Architecture:** UI-only refactor. Extract the two content areas of `PeriodStructurePage` into standalone components (`PeriodStructuresTab`, `ClassAssignmentsTab`) under `src/components/timetable/`. Wrap `TimetablePage` body in a shadcn `<Tabs>` whose active value is bound to `useSearchParams`'s `tab` key. Replace the `/school/period-structures` route with `<Navigate>` for backward-compat. Remove the "Period Structures" sidebar entry from all three role branches. Delete the old page file. Update the timetable-module skill note.

**Tech Stack:** React 18 + TypeScript, Vite, React Router v6 (`useSearchParams`, `Navigate`), shadcn/ui (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Card`, `Alert`, `Skeleton`, `Badge`, `Button`), lucide-react icons, existing hooks `usePeriodStructures` / `useClassStructureAssignments` / `useTimetableBuilder`.

**Verification story:** This codebase has no unit-test framework wired for UI components. Each task ends with a typecheck-via-`npm run build` (catches TS + unresolved imports) plus explicit manual browser-smoke steps on the affected surface. The final task runs the full manual QA pass from the spec's testing plan.

---

### Task 1: Extract `PeriodStructuresTab` component

**Files:**
- Create: `src/components/timetable/PeriodStructuresTab.tsx`

- [ ] **Step 1: Create the new component file**

Write the file at `src/components/timetable/PeriodStructuresTab.tsx`:

```tsx
import { useState } from "react";
import { Plus, CalendarRange, Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  usePeriodStructures,
  WEEKDAYS,
  type PeriodStructure,
  type StructureInput,
  type Weekday,
} from "@/hooks/usePeriodStructures";
import { PeriodStructureDialog } from "@/components/school/PeriodStructureDialog";

const WEEKDAY_SHORT: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

function fmtTime(t: string): string {
  return t.slice(0, 5);
}

interface PeriodStructuresTabProps {
  canEdit: boolean;
}

export function PeriodStructuresTab({ canEdit }: PeriodStructuresTabProps) {
  const {
    structures,
    isLoading,
    isError,
    error,
    createStructure,
    updateStructure,
    deleteStructure,
  } = usePeriodStructures();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PeriodStructure | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (s: PeriodStructure) => {
    setEditing(s);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: StructureInput) => {
    if (editing) {
      await updateStructure.mutateAsync({ id: editing.id, ...payload });
    } else {
      await createStructure.mutateAsync(payload);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteStructure.mutateAsync(id);
  };

  const isSubmitting =
    createStructure.isPending ||
    updateStructure.isPending ||
    deleteStructure.isPending;

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New structure
          </Button>
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load structures</AlertTitle>
          <AlertDescription>
            {error?.message ?? "Please refresh and try again."}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : structures.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <CalendarRange className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <div className="font-medium">No period structures yet</div>
              <div className="text-sm text-muted-foreground max-w-md mx-auto">
                Create your first structure — e.g. &quot;Primary Schedule&quot;
                with 6 periods of 40 mins — to start building the timetable.
              </div>
            </div>
            {canEdit && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Create structure
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {structures.map((s) => (
            <StructureCard
              key={s.id}
              structure={s}
              canEdit={canEdit}
              onEdit={() => openEdit(s)}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <PeriodStructureDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          existing={editing}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}

function StructureCard({
  structure,
  canEdit,
  onEdit,
}: {
  structure: PeriodStructure;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const periods = structure.slots.filter((s) => !s.is_break);
  const breaks = structure.slots.filter((s) => s.is_break);
  const sortedSlots = [...structure.slots].sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  );

  const firstStart = sortedSlots[0]?.start_time;
  const lastEnd = sortedSlots[sortedSlots.length - 1]?.end_time;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="font-semibold">{structure.name}</div>
            <div className="text-xs text-muted-foreground">
              {firstStart && lastEnd
                ? `${fmtTime(firstStart)} – ${fmtTime(lastEnd)}`
                : "No slots"}
            </div>
          </div>
          {structure.assigned_class_count > 0 ? (
            <Badge variant="secondary">
              {structure.assigned_class_count} class
              {structure.assigned_class_count === 1 ? "" : "es"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Unassigned
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const active = structure.working_days.includes(d);
            return (
              <span
                key={d}
                className={`text-[11px] px-2 py-0.5 rounded-md border ${
                  active
                    ? "bg-primary/10 border-primary/20 text-primary"
                    : "bg-muted text-muted-foreground border-transparent opacity-60"
                }`}
              >
                {WEEKDAY_SHORT[d]}
              </span>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-primary/5 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Periods
            </div>
            <div className="text-lg font-semibold">{periods.length}</div>
          </div>
          <div className="rounded-md bg-amber-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-amber-700">
              Breaks
            </div>
            <div className="text-lg font-semibold text-amber-800 flex items-center gap-1">
              <Coffee className="h-4 w-4" />
              {breaks.length}
            </div>
          </div>
        </div>

        {sortedSlots.length > 0 && (
          <div className="rounded-md border p-2 space-y-1 max-h-40 overflow-y-auto">
            {sortedSlots.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 text-xs rounded-sm px-2 py-1 ${
                  s.is_break ? "bg-amber-100 text-amber-800" : ""
                }`}
              >
                <span className="tabular-nums text-muted-foreground w-[90px]">
                  {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                </span>
                <span className="flex-1 truncate">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit structure
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck by running a production build**

Run: `npm run build`
Expected: exit 0, no TS errors, no missing-import errors. The new file compiles even though it's not yet imported anywhere.

- [ ] **Step 3: Commit**

```bash
git add src/components/timetable/PeriodStructuresTab.tsx
git commit -m "feat(timetable): extract PeriodStructuresTab component"
```

---

### Task 2: Extract `ClassAssignmentsTab` component

**Files:**
- Create: `src/components/timetable/ClassAssignmentsTab.tsx`

- [ ] **Step 1: Create the new component file**

Write the file at `src/components/timetable/ClassAssignmentsTab.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  usePeriodStructures,
  useClassStructureAssignments,
} from "@/hooks/usePeriodStructures";
import { ClassAssignmentMatrix } from "@/components/school/ClassAssignmentMatrix";

interface ClassAssignmentsTabProps {
  canEdit: boolean;
}

export function ClassAssignmentsTab({ canEdit }: ClassAssignmentsTabProps) {
  const { structures, isLoading: isStructuresLoading } = usePeriodStructures();
  const {
    rows: classRows,
    isLoading: isAssignmentsLoading,
    assignStructure,
  } = useClassStructureAssignments();

  const [pendingClassId, setPendingClassId] = useState<string | null>(null);

  const handleAssign = (class_id: string, structure_id: string | null) => {
    setPendingClassId(class_id);
    assignStructure.mutate(
      { class_id, structure_id },
      {
        onSettled: () => setPendingClassId(null),
      },
    );
  };

  const unassignedCount = useMemo(
    () => classRows.filter((r) => !r.structure_id).length,
    [classRows],
  );

  return (
    <div className="space-y-4">
      {unassignedCount > 0 && structures.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <Users className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-800">
            {unassignedCount} class{unassignedCount === 1 ? "" : "es"} still
            unassigned
          </AlertTitle>
          <AlertDescription className="text-amber-700">
            Classes without an assigned structure can&apos;t have timetables
            built. Assign a structure below.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-4 md:p-6">
          <ClassAssignmentMatrix
            rows={classRows}
            structures={structures}
            isLoading={isAssignmentsLoading || isStructuresLoading}
            onAssign={handleAssign}
            pendingClassId={pendingClassId}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck by running a production build**

Run: `npm run build`
Expected: exit 0, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timetable/ClassAssignmentsTab.tsx
git commit -m "feat(timetable): extract ClassAssignmentsTab component"
```

---

### Task 3: Wire the three tabs into `TimetablePage` + URL state

**Files:**
- Modify: `src/pages/school/TimetablePage.tsx`

- [ ] **Step 1: Add imports**

Replace the current import block (lines 1–37) with this expanded version:

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarRange,
  ChevronLeft,
  Clock,
  Info,
  LayoutGrid,
  Printer,
  Settings,
  UserCog,
  Users,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useUserRole } from "@/hooks/useUserRole";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  useWings,
  useCoordinatorWings,
  useClassesInScope,
  useTimetableBuilder,
  useTimetableScopeDiagnostic,
} from "@/hooks/useTimetableBuilder";
import type { ResolvedSlot } from "@/hooks/useTimetableBuilder";
import type { Weekday } from "@/hooks/usePeriodStructures";
import { AcademicYearSelector } from "@/components/timetable/AcademicYearSelector";
import { WingSelector } from "@/components/timetable/WingSelector";
import { ClassSelector } from "@/components/timetable/ClassSelector";
import { TimetableGrid } from "@/components/timetable/TimetableGrid";
import { SlotAssignmentSheet } from "@/components/timetable/SlotAssignmentSheet";
import { TeacherLoadPanel } from "@/components/timetable/TeacherLoadPanel";
import { MasterGridOverview } from "@/components/timetable/MasterGridOverview";
import { ClassWeekDigest } from "@/components/timetable/ClassWeekDigest";
import { openTimetablePrintWindow } from "@/components/timetable/TimetablePrintView";
import { PeriodStructuresTab } from "@/components/timetable/PeriodStructuresTab";
import { ClassAssignmentsTab } from "@/components/timetable/ClassAssignmentsTab";
```

Use Edit with `old_string` starting at `import { useEffect, useMemo, useState }` and running through the existing `openTimetablePrintWindow` import — replace with the block above.

- [ ] **Step 2: Add tab type + helpers above the component**

Insert this block immediately before `export default function TimetablePage()` (i.e., after the `SheetTarget` interface):

```tsx
type TabValue = "build" | "structures" | "assignments";

const VALID_TABS: TabValue[] = ["build", "structures", "assignments"];

function parseTab(raw: string | null): TabValue {
  return VALID_TABS.includes(raw as TabValue) ? (raw as TabValue) : "build";
}
```

- [ ] **Step 3: Add `useSearchParams` state + derived edit flags inside the component**

Inside `TimetablePage`, immediately after `const { institutionName } = useEffectiveInstitution();` (around line 58), add:

```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));
  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "build") {
      next.delete("tab");
    } else {
      next.set("tab", value);
    }
    setSearchParams(next, { replace: false });
  };
```

- [ ] **Step 4: Add a structures-only canEdit derivation**

Immediately after the existing `canEdit` `useMemo` block in `TimetablePage`, add:

```tsx
  // Period Structures + Class Assignments tabs: admin-only write.
  // Mirrors the original PeriodStructurePage rule — coordinator read-only.
  const canEditStructures = isAdmin;
```

- [ ] **Step 5: Rewrite the page return statement**

Replace the current `return (...)` body (the outermost `<div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">` down through its closing `</div>`) with this version. The Build tab wraps the existing Controls card + body + SlotAssignmentSheet. The other two tabs render the extracted components.

```tsx
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 text-white shadow-sm">
              <CalendarClock className="h-4 w-4" />
            </div>
            Timetable
          </h1>
          <p className="text-muted-foreground">
            Build weekly class schedules, manage period structures, and assign
            structures to classes.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="build">
            <CalendarClock className="h-4 w-4 mr-1.5" />
            Build
          </TabsTrigger>
          <TabsTrigger value="structures">
            <Clock className="h-4 w-4 mr-1.5" />
            Period Structures
          </TabsTrigger>
          <TabsTrigger value="assignments">
            <Users className="h-4 w-4 mr-1.5" />
            Class Assignments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="space-y-6">
          {/* Controls */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <AcademicYearSelector
                value={academicYear}
                onChange={setAcademicYear}
                canRollover={isAdmin}
              />

              {isAdmin && (
                <WingSelector
                  wings={wings}
                  value={wingId}
                  onChange={setWingId}
                  allowAll
                  disabled={wingsLoading}
                  placeholder="All wings"
                />
              )}

              {isCoordinator && !isAdmin && (
                <WingSelector
                  wings={wings}
                  value={wingId}
                  onChange={setWingId}
                  disabled={wingsLoading || wings.length <= 1}
                  placeholder="Your wing"
                />
              )}

              {(classes.length > 0 || classesQuery.isLoading) && (
                <ClassSelector
                  classes={classes}
                  value={classId}
                  onChange={setClassId}
                  disabled={classesQuery.isLoading}
                />
              )}

              {classId && (
                <div className="ml-auto flex items-center gap-1">
                  {selectedClass &&
                    builder.periodStructure &&
                    builder.slots.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openTimetablePrintWindow({
                            className: selectedClass.name,
                            classSection: selectedClass.section,
                            academicYear,
                            institutionName: institutionName ?? undefined,
                            structure: builder.periodStructure!,
                            slots: builder.slots,
                          })
                        }
                      >
                        <Printer className="h-4 w-4 mr-1" />
                        Print
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setClassId(null)}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back to overview
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Body: overview vs class grid */}
          {!classId ? (
            <AdminOverviewSection
              academicYear={academicYear}
              wingId={wingId}
              wings={wings}
              classes={classes}
              classesLoading={classesQuery.isLoading}
              highlightedTeacherId={highlightedTeacherId}
              onHighlightTeacher={setHighlightedTeacherId}
              onSelectClass={setClassId}
              weeklyCapacity={undefined}
              isAdmin={isAdmin}
              isCoordinator={isCoordinator}
              coordWingsLoading={coordWings.isLoading}
            />
          ) : (
            <>
              <ClassGridSection
                academicYear={academicYear}
                classId={classId}
                className={selectedClass?.name ?? ""}
                classSection={selectedClass?.section ?? null}
                wingId={wingId}
                canEdit={canEdit}
                weeklyCapacity={weeklyCapacity}
                highlightedTeacherId={highlightedTeacherId}
                onHighlightTeacher={setHighlightedTeacherId}
                onCellClick={openSheet}
                onGoToStructures={() => handleTabChange("structures")}
                builder={builder}
              />
              {selectedClass && (
                <ClassWeekDigest
                  classId={selectedClass.id}
                  className={selectedClass.name}
                  classSection={selectedClass.section}
                  canEdit={canEdit}
                />
              )}
            </>
          )}

          {/* Slot assignment sheet */}
          {sheetTarget && periodSlot && selectedClass && (
            <SlotAssignmentSheet
              open={!!sheetTarget}
              onClose={() => setSheetTarget(null)}
              classId={selectedClass.id}
              className={selectedClass.name}
              classSection={selectedClass.section}
              academicYear={academicYear}
              day={sheetTarget.day}
              periodSlot={periodSlot}
              subjects={builder.subjects}
              resources={builder.resources}
              existingSlot={sheetTarget.existingSlot}
              onSave={async (input) => {
                await builder.saveSlot.mutateAsync(input);
                setSheetTarget(null);
              }}
              onDelete={async (slotId) => {
                await builder.deleteSlot.mutateAsync(slotId);
                setSheetTarget(null);
              }}
              canEdit={canEdit}
            />
          )}
        </TabsContent>

        <TabsContent value="structures">
          <PeriodStructuresTab canEdit={canEditStructures} />
        </TabsContent>

        <TabsContent value="assignments">
          <ClassAssignmentsTab canEdit={canEditStructures} />
        </TabsContent>
      </Tabs>
    </div>
  );
```

Note the new prop `onGoToStructures` passed to `ClassGridSection`. Step 6 wires it.

- [ ] **Step 6: Update `ClassGridSection` to use the tab switcher**

Replace the `ClassGridSectionProps` interface block with one that accepts the new callback:

```tsx
interface ClassGridSectionProps {
  academicYear: string;
  classId: string;
  className: string;
  classSection: string | null;
  wingId: string | null;
  canEdit: boolean;
  weeklyCapacity: number | undefined;
  highlightedTeacherId: string | null;
  onHighlightTeacher: (id: string | null) => void;
  onCellClick: (args: SheetTarget) => void;
  onGoToStructures: () => void;
  builder: ReturnType<typeof useTimetableBuilder>;
}
```

Update the destructuring in `function ClassGridSection(...)` to include `onGoToStructures`:

```tsx
function ClassGridSection({
  academicYear,
  classId: _classId,
  className,
  classSection,
  wingId,
  canEdit,
  weeklyCapacity,
  highlightedTeacherId,
  onHighlightTeacher,
  onCellClick,
  onGoToStructures,
  builder,
}: ClassGridSectionProps) {
```

Replace the "Go to Period Structures" link. Find this block inside `ClassGridSection`:

```tsx
          {canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/school/period-structures">
                <Settings className="h-4 w-4 mr-1" />
                Go to Period Structures
              </Link>
            </Button>
          ) : (
```

Replace with:

```tsx
          {canEdit ? (
            <Button variant="outline" size="sm" onClick={onGoToStructures}>
              <Settings className="h-4 w-4 mr-1" />
              Go to Period Structures
            </Button>
          ) : (
```

Also remove the now-unused `Link` import if it's no longer referenced in the file. Check for other `<Link` usages in `TimetablePage.tsx` — the `TimetableScopeEmptyState` and `CalendarEmptyHint` sections still use `<Link>` for `/school/classes`, `/school/calendar`, `/school/wings`, so the `Link` import must stay.

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: exit 0, no TS errors, no unused-import warnings.

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`
In a browser (school admin login):
1. Navigate to `/school/timetable` — Build tab is active, selectors render.
2. Click "Period Structures" tab — structure cards or empty state render, "New structure" button visible. URL updates to `?tab=structures`.
3. Click "Class Assignments" tab — matrix renders, "N classes unassigned" alert shows if applicable. URL updates to `?tab=assignments`.
4. Click "Build" tab — URL drops `?tab=` back to bare `/school/timetable`.
5. Browser back button walks through the tab history.
6. Create a new structure via the dialog — cards update; delete/edit paths still work.
7. Assign a structure to a class in the matrix — row reflects the change.
8. In Build tab, select a class that has no structure — click the "Go to Period Structures" button in the empty-state alert → tab switches to Period Structures (no full page reload).

- [ ] **Step 9: Commit**

```bash
git add src/pages/school/TimetablePage.tsx
git commit -m "feat(timetable): fold Period Structures + Class Assignments into TimetablePage tabs"
```

---

### Task 4: Redirect the old route + drop the import

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `Navigate` to the react-router-dom import**

Find the existing react-router-dom import in `src/App.tsx` (search for `from "react-router-dom"`). It will look like one of these forms — confirm the exact shape and add `Navigate`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
```

(If `Navigate` is already imported, skip this step.)

- [ ] **Step 2: Remove the `PeriodStructurePage` import**

Edit `src/App.tsx`. Remove line 89:

```tsx
import PeriodStructurePage from "./pages/school/PeriodStructurePage";
```

- [ ] **Step 3: Replace the route element with a redirect**

Find this block in `src/App.tsx` (around lines 427–431):

```tsx
          <Route path="/school/period-structures" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]}>
              <PeriodStructurePage />
            </ProtectedRoute>
          } />
```

Replace with:

```tsx
          <Route
            path="/school/period-structures"
            element={<Navigate to="/school/timetable?tab=structures" replace />}
          />
```

No `ProtectedRoute` wrapper needed here — the target `/school/timetable` is already role-guarded.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Manual smoke test**

Run (or keep running): `npm run dev`
In a browser:
1. Visit `http://localhost:<port>/school/period-structures` directly.
2. Expected: URL replaces to `/school/timetable?tab=structures` and the Period Structures tab is active.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(timetable): redirect /school/period-structures to merged tab"
```

---

### Task 5: Remove sidebar entries + unused Clock icon

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Remove the three "Period Structures" sidebar items**

The identical three-line block appears once in each of the three role branches (admin, super_school_admin, coordinator). Use a single `Edit` call with `replace_all: true`:

- `old_string`:
```
          { title: "Academic Calendar", url: "/school/calendar", icon: CalendarDays },
          { title: "Period Structures", url: "/school/period-structures", icon: Clock },
          { title: "Shared Resources", url: "/school/shared-resources", icon: Building2 },
```
- `new_string`:
```
          { title: "Academic Calendar", url: "/school/calendar", icon: CalendarDays },
          { title: "Shared Resources", url: "/school/shared-resources", icon: Building2 },
```
- `replace_all`: `true`

This removes the "Period Structures" line from all three branches in one pass. Verify afterward with `grep -n "period-structures" src/components/layout/AppSidebar.tsx` — expected: no matches.

- [ ] **Step 2: Remove the unused `Clock` icon import**

Find the lucide-react import block near the top of `AppSidebar.tsx` (around line 53). Remove the `Clock,` entry from it. Before committing, grep to confirm `Clock` has no other references:

Run: `grep -n "Clock" src/components/layout/AppSidebar.tsx`
Expected: no matches after the edit.

Concrete edit:
- `old_string`: `  Clock,\n`
- `new_string`: (empty — removes the entire line)

If the exact indentation doesn't match (e.g. tabs vs 2-space), adjust to the surrounding import style the file already uses.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: exit 0, no unused-import warnings.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
For each of the three roles (school_admin, super_school_admin, coordinator):
1. Log in (or use account-switcher).
2. Open the sidebar → *Operations* section.
3. Confirm "Period Structures" is gone, "Timetable" is present.
4. Click "Timetable" — lands on the Build tab of the merged page.

(If you only have one role account available, spot-check one and defer the others to the final QA task; note any blockers.)

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppSidebar.tsx
git commit -m "feat(timetable): drop Period Structures sidebar entry (merged into Timetable)"
```

---

### Task 6: Delete the old `PeriodStructurePage.tsx`

**Files:**
- Delete: `src/pages/school/PeriodStructurePage.tsx`

- [ ] **Step 1: Confirm no other imports**

Run:

```bash
grep -rn "PeriodStructurePage" src/
```

Expected: zero matches (App.tsx no longer imports it after Task 4).

- [ ] **Step 2: Delete the file**

Run:

```bash
git rm src/pages/school/PeriodStructurePage.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(timetable): delete PeriodStructurePage (content moved to Timetable tabs)"
```

---

### Task 7: Update `timetable-module` skill note

**Files:**
- Modify: `.claude/skills/timetable-module/SKILL.md`

- [ ] **Step 1: Update the Route & feature gating sentence**

Find this line in `.claude/skills/timetable-module/SKILL.md` (currently line 25):

```
**Route & feature gating.** `/school/period-structures` maps to the `timetable` feature (shared with the timetable module). Coordinator read-only (`!canEdit`).
```

Replace with:

```
**Route & feature gating.** Period Structures is now a tab inside the merged Timetable page at `/school/timetable?tab=structures` (coordinator read-only). The legacy route `/school/period-structures` is a `<Navigate>` redirect to that tab — deep links still resolve. Both map to the `timetable` feature.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/timetable-module/SKILL.md
git commit -m "docs(timetable-module): note merged route + tab redirect"
```

---

### Task 8: Final QA + spec sign-off

**Files:** none

- [ ] **Step 1: Full typecheck + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0 with no errors. Lint warnings that existed before this plan started do not count as regressions — inspect the diff only for warnings on files touched by this plan.

- [ ] **Step 2: Run through the spec's manual testing plan**

From the spec (`docs/superpowers/specs/2026-04-22-merge-timetable-and-period-structures-design.md`), execute each numbered check:

1. **Navigation** — sidebar shows only "Timetable" under Operations (no "Period Structures"). Clicking it lands on the Build tab.
2. **Tab switching** — all three tabs render their intended content. URL updates to `?tab=structures` / `?tab=assignments`. Back/forward browser buttons move between tab states.
3. **Redirect** — visiting `/school/period-structures` directly redirects to `/school/timetable?tab=structures`.
4. **Build empty-state link** — select a class with no assigned structure; click "Go to Period Structures" inside the alert — tab switches to Structures without a full navigation.
5. **Period Structures CRUD** — create, edit, delete structures and assign to classes — all work inside the tabs just as they did on the separate page. "N classes unassigned" alert still surfaces on the Class Assignments tab.
6. **Role checks** — coordinator sees Period Structures and Class Assignments tabs but cannot edit; admin can edit. Teacher cannot reach the page at all (route guarded).
7. **Mobile 375px** — no horizontal scroll on the tab bar; each tab's content is scrollable within the page.
8. **Deep link** — `/school/timetable?tab=assignments` lands directly on the Class Assignments tab.

Record any failures inline in the PR description and fix them before merging.

- [ ] **Step 3: Verify dirty-form contract unchanged**

Spot-check: open `PeriodStructureDialog` from the Structures tab, edit a name field, and verify the service worker update toast path still fires when an update is pushed (developer trick: manually dispatch `window.dispatchEvent(new Event('salci-update-ready'))` — expect the toast rather than a hard reload because the dialog's form has unsaved input). This verifies no `data-dirty` wiring was accidentally broken by the refactor. (If a quick dispatch check isn't feasible, note it as a pre-production test.)

- [ ] **Step 4: Inspect the branch diff**

Run: `git log --oneline main..HEAD` and `git diff main --stat`
Expected: a clean sequence of 7 commits (Tasks 1–7), file counts match the spec's file-changes table.

- [ ] **Step 5: No final commit needed**

Task 8 is verification only. If Step 2 surfaces any defects, fix them on the current branch, add a remediation commit, and re-run the checklist.

---

## Verification commands summary

| When | Command | Purpose |
|---|---|---|
| After each task | `npm run build` | TypeScript + import resolution typecheck |
| Final task | `npm run build && npm run lint` | Full build + ESLint |
| Manual | `npm run dev` | Local server for browser smoke tests |
| Git hygiene | `git log --oneline main..HEAD` | Confirm one commit per task |
