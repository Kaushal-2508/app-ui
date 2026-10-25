# School-Admin Mobile UI Redesign — Implementation Plan (Phase 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 5 mobile design language to every school-admin-only surface — `ManageUsersPage` (parent tab strip), `ManageAdminsPage`, `SchoolStudentsPage`, `SchoolCoordinatorsPage`, `HRDashboardPage`, `AnalyticsPage` (admin path), and the embedded `PrincipalDashboard` overview — by composing the existing 12 shared primitives. Pure UI work, zero data-flow changes.

**Architecture:** One phase, seven page-redesign tasks plus a final docs/cleanup task. Each task is a self-contained primitive swap on one or two files: imports → JSX rewrite → validation triple → commit. Hooks (`useQuery`, `useMutation`), routes, callbacks, and dialog state machines are byte-identical before/after. The pattern is already proven in Phase 5 Task 17 (`SchoolTeachersPage`); these tasks repeat that pattern across the admin surface.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix primitives), TanStack Query v5 (untouched), `lucide-react` icons, `react-router-dom` v6. Shared primitives at `src/components/shared/{page,surfaces,nav,sheets}/` — see `.claude/CLAUDE.md` §20a.

**Validation regime (this codebase has no test runner):** every task validates via (1) `npx tsc --noEmit` exit 0, (2) `npx eslint <touched-paths>` zero errors on the touched file set (pre-existing repo errors elsewhere are out of scope), (3) `npx vite build` exit 0. Bundle-size warnings are not failures. Dynamic affordances (MobileTabs scroll-into-view on URL param change, kebab vs. inline-button responsive switch) additionally need a real-device check on iPhone Safari at 375px.

**Reference:** Phase 5 spec at [docs/superpowers/specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md](../specs/2026-04-27-teacher-coordinator-mobile-ui-redesign-design.md). The screenshots from chat-handoff-2026-04-28 (cropped tab strips, full-bleed action button rows, table columns clipping at 375 px) are the symptoms each task fixes.

**Layout invariant (critical for HRDashboardPage):** `ProtectedRoute` in [src/components/layout/ProtectedRoute.tsx:74](../../src/components/layout/ProtectedRoute.tsx#L74) already wraps children in `<AppLayout>`. **Pages must NOT import or render `<AppLayout>` themselves** — that produces a double-wrap (two app bars, two scroll containers, broken sticky positioning). Phase 5 pages all return `<PageShell>...</PageShell>` directly. `HRDashboardPage` currently imports and renders `AppLayout` itself; Task 31 removes that wrapper.

**Parallelization:** Tasks 28, 29, 30 (the three sub-tab pages) are independent files and can run in parallel implementer batches. Task 27 must land first because the parent tab strip's MobileTabs swap is a contract change that the children should be visually consistent with on revisit. Tasks 31, 32, 33 should run sequentially because Tasks 32 and 33 both touch the school-analytics surface.

---

## File Structure

**Modified files:**

```
src/
  pages/
    school/
      ManageUsersPage.tsx               # Task 27 — tab strip → MobileTabs, scope-icon header
      ManageAdminsPage.tsx              # Task 28 — full primitive swap, kebab actions
      SchoolStudentsPage.tsx            # Task 29 — full primitive swap, action overflow → kebab
      SchoolCoordinatorsPage.tsx        # Task 30 — full primitive swap
      HRDashboardPage.tsx               # Task 31 — drop AppLayout wrapper, MobileTabs
    AnalyticsPage.tsx                   # Task 32 — admin and super-admin tab strips → MobileTabs
  components/
    dashboards/
      PrincipalDashboard.tsx            # Task 33 — header strip + sub-tabs → MobileTabs + StatTileGrid
.claude/
  CLAUDE.md                             # Task 34 — append Phase 7 note to §20a
```

**New files:** none. Phase 7 is composition-only.

---

# Phase 7 — School-admin surfaces

## Task 27: ManageUsersPage tab strip → MobileTabs

**Files:**
- Modify: `src/pages/school/ManageUsersPage.tsx`

**Symptom (screenshot):** the four-pill tab row "Admins / Coordinators / Teachers / Students" overflows past the right edge at 375 px, clipping "Students". The header h1 + icon block also wraps awkwardly.

**Why MobileTabs:** introduced in Task 11 of Phase 5, scroll-snap pills with `.scrollbar-hide` and active-pill scroll-into-view on URL change — exactly the affordance this strip needs.

- [ ] **Step 27.1: Read the file end-to-end and confirm the contract**

The file is 57 lines. Confirm:
- Tabs derive `activeTab` from `searchParams.get("tab")` and write back via `setSearchParams({ tab }, { replace: true })`.
- Four sub-page components (`ManageAdminsPage`, `SchoolCoordinatorsPage`, `SchoolTeachersPage`, `SchoolStudentsPage`) render inside `TabsContent`.

These are the contracts the redesign must preserve.

- [ ] **Step 27.2: Replace imports**

Replace the existing imports block at the top:

```tsx
import { useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import ManageAdminsPage from "./ManageAdminsPage";
import SchoolCoordinatorsPage from "./SchoolCoordinatorsPage";
import SchoolTeachersPage from "./SchoolTeachersPage";
import SchoolStudentsPage from "./SchoolStudentsPage";

import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";
```

- [ ] **Step 27.3: Replace the entire component body**

Replace lines 12–56 (the `export default function ManageUsersPage` body) with:

```tsx
const VALID_TABS = ["admins", "coordinators", "teachers", "students"] as const;
type TabValue = (typeof VALID_TABS)[number];

const TAB_OPTIONS: { value: TabValue; label: string }[] = [
  { value: "admins", label: "Admins" },
  { value: "coordinators", label: "Coordinators" },
  { value: "teachers", label: "Teachers" },
  { value: "students", label: "Students" },
];

export default function ManageUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TabValue | null;
  const activeTab: TabValue =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "admins";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <PageShell>
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title="Manage Users"
        subtitle="Manage all users in your institution"
      />

      <div className="mt-2">
        <MobileTabs
          value={activeTab}
          onValueChange={handleTabChange}
          options={TAB_OPTIONS}
        />
      </div>

      <div className="mt-4">
        {activeTab === "admins" && <ManageAdminsPage />}
        {activeTab === "coordinators" && <SchoolCoordinatorsPage />}
        {activeTab === "teachers" && <SchoolTeachersPage />}
        {activeTab === "students" && <SchoolStudentsPage />}
      </div>
    </PageShell>
  );
}
```

> **Why conditional render instead of `<TabsContent>` siblings:** the original code rendered all four panels via `TabsContent` and shadcn `<Tabs>` only hides the inactive ones via CSS. With MobileTabs (a custom pill row) we need explicit conditional rendering to avoid mounting four heavy data-fetching pages at once. This matches MobileTabs' contract from Task 11 — `value` + `onValueChange` only, no children.

- [ ] **Step 27.4: Verify MobileTabs API matches**

Open `src/components/shared/nav/MobileTabs.tsx` and confirm the props are `{ value, onValueChange, options: { value, label }[] }`. If the actual API uses a different shape (e.g. `tabs` instead of `options`, or `onChange` instead of `onValueChange`), adjust the call to match the actual primitive — do NOT modify the primitive.

- [ ] **Step 27.5: Run the validation triple**

```bash
npx tsc --noEmit
npx eslint src/pages/school/ManageUsersPage.tsx
npx vite build
```

All three must exit 0. ESLint should be clean on this small file.

- [ ] **Step 27.6: Real-device smoke**

Open `/manage-users` on iPhone Safari (or DevTools 375 px). Confirm:
- Header doesn't wrap awkwardly; "Manage Users" title and subtitle fit one line each within the safe area.
- Tab pills are scroll-snap, no clipping. "Students" reachable by horizontal scroll.
- Switching tabs updates `?tab=...` URL and persists across reload.
- Each sub-page renders inside the new layout (Admins / Teachers / Coordinators / Students).

- [ ] **Step 27.7: Commit**

DO NOT run git commands from a parallel-implementer subagent. The controller will commit serially. Report a summary of changes back to the controller. The controller commits with:

```bash
git add src/pages/school/ManageUsersPage.tsx
git commit -m "feat(ui): redesign Manage Users tab strip with MobileTabs

Apply PageShell + PageHeader + MobileTabs. Resolves the four-tab
strip clipping at 375px and switches from shadcn Tabs (which
mounts all panels) to conditional rendering (one panel mounted
at a time).

URL param contract preserved: ?tab=admins|coordinators|teachers|students.
No data-flow changes."
```

---

## Task 28: ManageAdminsPage redesign

**Files:**
- Modify: `src/pages/school/ManageAdminsPage.tsx` (~656 lines)

**Symptom (screenshot):** the "Manage Administrators" header + "+ Add Administrator" button stack collides on mobile; the GradientKPICard "Total Admins / Active Admins" tiles are loud full-bleed gradients (Phase 5 spec deprecates these for `StatTile`); the admin table is six columns wide and doesn't fit a 375 px viewport.

**Source images covered:** "Manage Administrators" panel.

- [ ] **Step 28.1: Read the file end-to-end and inventory the affordances**

Capture the list of behaviors that must survive byte-identical:
- `useQuery` for `["institution-admins", institutionId]`.
- Three `useMutation` blocks: `createAdminMutation`, `updateDesignationMutation`, `deleteAdminMutation`, `promoteAdminMutation`.
- Three dialog state machines: Add Admin (`addDialogOpen`), Delete confirm (`deleteDialogOpen`), Edit Designation (`editDesignationOpen`).
- The `canPromote` boolean derived from `currentUser?.isSuperAdmin || currentUser?.isSuperSchoolAdmin`.
- Per-row actions: promote, demote, edit designation, delete (with `disabled={admins.length === 1}` guard on delete).

Per-row "Owner" / "Admin" badge logic, designation badge, status badge, "Added" date — these were table cells; they become subtitle metadata and a compact trailing chip cluster on `ListRow`.

- [ ] **Step 28.2: Add the AddUserDialog hidden-trigger pattern**

The existing `<Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>` block already supports controlled `open`/`onOpenChange`. So we don't need the hidden-button-ref hack from Task 17 — we can call `setAddDialogOpen(true)` directly from `PageHeader.primaryAction.onClick`. Confirm this by re-reading the Dialog's props.

- [ ] **Step 28.3: Replace imports**

Add to the existing import block:

```tsx
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
```

Remove the now-unused imports — `Card, CardContent, CardDescription, CardHeader, CardTitle`, `GradientKPICard`, `DashboardSection`, and `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` — once the new JSX has fully replaced them.

- [ ] **Step 28.4: Replace the outer return with PageShell + PageHeader + StatTileGrid**

Replace the outermost `<div className="container mx-auto py-6 space-y-6">…</div>` with:

```tsx
return (
  <PageShell
    fab={
      <MobileFab
        label="Add Administrator"
        icon={<Plus className="h-6 w-6" />}
        onClick={() => setAddDialogOpen(true)}
      />
    }
  >
    <PageHeader
      icon={<Shield className="h-5 w-5" />}
      title="Manage Administrators"
      subtitle="Add or remove peer administrators for your institution. All admins have equal powers."
      primaryAction={{
        label: "Add Administrator",
        icon: <Plus className="h-4 w-4" />,
        onClick: () => setAddDialogOpen(true),
      }}
    />

    <StatTileGrid mdCols={2}>
      <StatTile
        label="Total Admins"
        value={formatNumber(admins?.length || 0)}
        icon={<Users className="h-5 w-5" />}
        tone="teal"
      />
      <StatTile
        label="Active Admins"
        value={formatNumber(admins?.filter(a => a.is_active).length || 0)}
        icon={<Shield className="h-5 w-5" />}
        tone="mint"
      />
    </StatTileGrid>

    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ink-900">Administrators</h2>
        <p className="text-sm text-ink-600">
          All administrators can create, edit, and remove other admins.
        </p>
      </div>
      {/* admins list — Step 28.5 fills this in */}
    </div>

    {/* keep all three dialogs (<Dialog>, <AlertDialog>, <Dialog open={editDesignationOpen}>) below — Step 28.6 */}
  </PageShell>
);
```

> The dialog instances stay byte-identical inside `PageShell` (or alongside it — they portal-render anyway).

- [ ] **Step 28.5: Replace the `<Table>` with `ListRow` rows**

Inside the `surface-card` block from Step 28.4, replace the loading/empty/table branches with:

```tsx
{isLoading ? (
  <div className="space-y-3">
    {[1, 2, 3].map((i) => (
      <Skeleton key={i} className="h-14 w-full rounded-xl" />
    ))}
  </div>
) : !admins?.length ? (
  <EmptyState
    icon={<UserCog className="h-7 w-7" />}
    title="No administrators yet"
    description="Add your first peer administrator to share institution-management duties."
    action={{
      label: "Add Administrator",
      icon: <Plus className="h-4 w-4" />,
      onClick: () => setAddDialogOpen(true),
    }}
  />
) : (
  <ul className="list-none p-0 space-y-2">
    {admins.map((admin) => {
      const isOwner = admin.role === "super_school_admin";
      const isLastAdmin = admins.length === 1;
      return (
        <ListRow
          key={admin.id}
          as="li"
          leading={
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary text-sm font-semibold">
              {admin.full_name.substring(0, 2).toUpperCase()}
            </span>
          }
          title={
            <span className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{admin.full_name}</span>
              {isOwner ? (
                <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 text-xs">
                  <Crown className="h-3 w-3 mr-1" />
                  Owner
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Admin</Badge>
              )}
              {admin.admin_title && (
                <Badge variant="secondary" className="text-xs">{admin.admin_title}</Badge>
              )}
              {!admin.is_active && (
                <Badge variant="outline" className="text-xs">Inactive</Badge>
              )}
            </span>
          }
          subtitle={
            <span className="flex items-center gap-3 text-xs text-ink-600">
              <span className="truncate">{admin.email}</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(admin.created_at), "MMM d, yyyy")}
              </span>
            </span>
          }
          trailing={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canPromote && admin.role === "school_admin" && (
                  <DropdownMenuItem
                    onClick={() => promoteAdminMutation.mutate({ userId: admin.id, roleId: admin.role_id, newRole: "super_school_admin" })}
                  >
                    <ArrowUpCircle className="h-4 w-4 mr-2 text-amber-500" />
                    Promote to Owner
                  </DropdownMenuItem>
                )}
                {canPromote && admin.role === "super_school_admin" && (
                  <DropdownMenuItem
                    onClick={() => promoteAdminMutation.mutate({ userId: admin.id, roleId: admin.role_id, newRole: "school_admin" })}
                  >
                    <ArrowDownCircle className="h-4 w-4 mr-2" />
                    Demote to Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handleEditDesignation(admin)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit designation
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={isLastAdmin}
                  onClick={() => handleDeleteClick(admin)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {isLastAdmin ? "Cannot remove last admin" : "Remove admin"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      );
    })}
  </ul>
)}
```

> Imports needed: `MoreHorizontal` from `lucide-react`, `DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger` from `@/components/ui/dropdown-menu`. Add them to the lucide and ui imports at the top.

- [ ] **Step 28.6: Keep dialogs intact**

The three dialogs at the bottom (`<Dialog open={addDialogOpen} ...>`, `<AlertDialog open={deleteDialogOpen} ...>`, `<Dialog open={editDesignationOpen} ...>`) stay byte-identical. Their content (form fields, credentials reveal, confirm copy) does not change. Move them outside `<PageShell>` — they portal-render so position doesn't matter, but keep them adjacent for readability.

- [ ] **Step 28.7: Run the validation triple**

```bash
npx tsc --noEmit
npx eslint src/pages/school/ManageAdminsPage.tsx
npx vite build
```

All three must exit 0. The file currently has one `as any` cast at line 124 (`{ admin_title: data.designation } as any`) and similar elsewhere — these pre-date the redesign. Leave them alone unless the redesign already touched the surrounding lines.

- [ ] **Step 28.8: Real-device smoke**

iPhone Safari at 375 px:
- Header + "+ Add Administrator" button no longer collide; on small viewports the kebab in `PageHeader` collapses primary action when there are secondaries (none in this task — the header keeps the full button visible at the right).
- Two neutral StatTile cards instead of the loud blue/green GradientKPICard stack.
- Each admin row is one ListRow with name + role badge + designation chip on the title line, email + added date on subtitle, kebab on the trailing slot.
- Empty state shows the illustrative `UserCog` + CTA when zero admins.
- "Add Administrator" dialog still opens, fills, submits, shows credentials reveal, copies. "Edit Designation" dialog still opens, picks preset / custom, saves. Delete still confirms and removes.

- [ ] **Step 28.9: Commit**

Subagent: report changes; controller commits.

```bash
git add src/pages/school/ManageAdminsPage.tsx
git commit -m "feat(ui): redesign Manage Administrators with shared primitives

Apply PageShell, PageHeader, StatTileGrid, ListRow, EmptyState,
MobileFab. Six-column admin table collapsed to ListRow with name +
role badges on title, email + added-date on subtitle, all per-row
actions (promote/demote, edit designation, remove) consolidated
behind a kebab. Replaces loud GradientKPICard tiles with neutral
StatTile.

All four mutations and three dialogs untouched.
No data-flow changes."
```

---

## Task 29: SchoolStudentsPage redesign

**Files:**
- Modify: `src/pages/school/SchoolStudentsPage.tsx` (~732 lines)

**Symptom (screenshot):** the action row "Assign Task to All / Bulk Upload / Update Details / Promote Students / Bulk Promote (CSV) / Add Student" wraps to 3+ rows on mobile, dominating the viewport. The student table has five columns + a checkbox; columns wrap. The `useTableSort` column-header sorts don't survive the table → ListRow swap.

**Source images covered:** "Manage Users → Students" panel.

- [ ] **Step 29.1: Read the file end-to-end and inventory the affordances**

Lock down what must survive:
- `useQuery` for `["school-students", roleInfo?.institutionId, isEffectiveCoordinator, coordinatorClassIds]`.
- `useQuery` for `["school-classes", ...]` for the class filter.
- `useMutation`: `deleteUserMutation`, `bulkDeleteMutation`.
- Bulk-selection state machine: `selectedStudentIds`, `toggleStudentSelection`, `toggleSelectAll`, `clearSelection`, the bulk-action bar.
- Coordinator-vs-admin gating: `isEffectiveCoordinator`, `isEffectiveAdmin`, `canBulkTask`, `hasNoAccess`, `showCheckboxes`.
- Five external dialogs/sheets: `BulkUploadStudentsDialog`, `BulkUpdateStudentsDialog`, `AddUserDialog`, `ViewUserSheet`, `AssignStudentClassDialog`, `EditStudentPasswordDialog`, `BulkAssignTaskDialog`, `PromoteStudentsDialog`, `BulkPromoteUploadDialog`. Most use `trigger={...}` props (uncontrolled) — same pattern as Task 17 SchoolTeachersPage.
- `useTableSort` removal is documented as an acceptable behavior loss (chat-handoff §"Lessons learned"); we don't restore column sorts in this task.

- [ ] **Step 29.2: Add the hidden-trigger refs for trigger-only dialogs**

`AddUserDialog`, `BulkUploadStudentsDialog`, `BulkUpdateStudentsDialog` only accept a `trigger=` prop (no controlled `open`/`onOpenChange` from the outside). To wire them to `PageHeader.primaryAction` / `secondaryActions[]`, use the hidden-trigger ref pattern from Phase 5 Task 17:

```tsx
import { useRef, useState } from "react";

// inside the component, near the existing state:
const addStudentTriggerRef = useRef<HTMLButtonElement>(null);
const bulkUploadTriggerRef = useRef<HTMLButtonElement>(null);
const bulkUpdateTriggerRef = useRef<HTMLButtonElement>(null);

const handleAddStudent = () => addStudentTriggerRef.current?.click();
const handleBulkUpload = () => bulkUploadTriggerRef.current?.click();
const handleBulkUpdate = () => bulkUpdateTriggerRef.current?.click();
const handleAssignTaskAll = () => {
  if (selectedStudentIds.size !== sortedStudents?.length) {
    toggleSelectAll();
  }
  setBulkTaskOpen(true);
};
const handlePromoteStudents = () => setPromoteOpen(true);
const handleBulkPromote = () => setBulkPromoteOpen(true);
```

`PromoteStudentsDialog` and `BulkPromoteUploadDialog` already have controlled `open`/`onOpenChange`, so a direct setter call works.

- [ ] **Step 29.3: Replace imports**

Add:

```tsx
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
```

Remove (after the JSX rewrite eliminates them): `Card, CardContent` (still used only inside the bulk-selection bar — move that to plain `surface-card` divs), `GradientKPICard`, `DashboardSection`, `Table, TableBody, TableCell, TableHeader, TableRow`, `SortableTableHeader`, `useTableSort`. Keep `Avatar, AvatarFallback`, `Badge`, `Checkbox`, `DropdownMenu*`, `Input`, `Select*`, `AlertDialog*`, `Skeleton`.

- [ ] **Step 29.4: Replace the outer return**

Replace the outermost `<div className="space-y-6">…</div>` (after the `if (isLoading) return <PageSkeleton />` early-return) with:

```tsx
return (
  <PageShell
    fab={
      !hasNoAccess && (
        <MobileFab
          label="Add Student"
          icon={<Plus className="h-6 w-6" />}
          onClick={handleAddStudent}
        />
      )
    }
  >
    <PageHeader
      icon={<Users className="h-5 w-5" />}
      title="Students"
      subtitle={
        isEffectiveCoordinator
          ? "Manage students in your assigned classes"
          : "Manage your school's students"
      }
      primaryAction={
        !hasNoAccess
          ? {
              label: "Add Student",
              icon: <Plus className="h-4 w-4" />,
              onClick: handleAddStudent,
            }
          : undefined
      }
      secondaryActions={
        !hasNoAccess
          ? [
              ...(canBulkTask && roleInfo?.institutionId
                ? [{ label: "Assign Task to All", icon: <ClipboardList className="h-4 w-4" />, onClick: handleAssignTaskAll }]
                : []),
              { label: "Bulk Upload", icon: <Upload className="h-4 w-4" />, onClick: handleBulkUpload },
              ...(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin
                ? [
                    { label: "Update Details", icon: <RefreshCw className="h-4 w-4" />, onClick: handleBulkUpdate },
                    { label: "Promote Students", icon: <GraduationCap className="h-4 w-4" />, onClick: handlePromoteStudents },
                    { label: "Bulk Promote (CSV)", icon: <FileSpreadsheet className="h-4 w-4" />, onClick: handleBulkPromote },
                  ]
                : []),
            ]
          : []
      }
    />

    <StatTileGrid mdCols={2}>
      <StatTile
        label="Total Students"
        value={formatNumber(students?.length || 0)}
        icon={<Users className="h-5 w-5" />}
        tone="teal"
      />
      <StatTile
        label="Classes"
        value={formatNumber(classes?.length || 0)}
        icon={<Layers className="h-5 w-5" />}
        tone="violet"
      />
    </StatTileGrid>

    {/* Coordinator banner — keep as is */}
    {isEffectiveCoordinator && !hasNoAccess && (
      <AccessRestrictedBanner
        message={`Showing students from ${coordinatorClassIds.length} assigned class${coordinatorClassIds.length > 1 ? 'es' : ''}`}
      />
    )}

    {/* Bulk selection bar — convert to surface-card */}
    {selectedStudentIds.size > 0 && (
      <div className="surface-card frosted-shadow rounded-2xl p-3 mt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-sm">{selectedStudentIds.size} selected</Badge>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {canBulkTask && roleInfo?.institutionId && (
              <Button variant="outline" size="sm" onClick={() => setBulkTaskOpen(true)}>
                <ClipboardList className="h-4 w-4 mr-2" />
                Bulk Assign Task
              </Button>
            )}
            {isEffectiveAdmin && (
              <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Search + filter row */}
    <div className="mt-4 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search students..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 rounded-xl pl-9"
        />
      </div>
      <FilterRow activeCount={classFilter !== "all" ? 1 : 0} onClear={() => setClassFilter("all")}>
        <FilterChip
          label={
            classFilter === "all"
              ? "All Classes"
              : (() => {
                  const c = classes?.find((x) => x.id === classFilter);
                  return c ? formatClassName(c.name, c.section) : "All Classes";
                })()
          }
          active={classFilter !== "all"}
          onClick={() => {
            // Cycle through classes for now; replace with FilterSheet later if class count > 4
            const ids = ["all", ...(classes?.map((c) => c.id) ?? [])];
            const idx = ids.indexOf(classFilter);
            setClassFilter(ids[(idx + 1) % ids.length]);
          }}
        />
      </FilterRow>
    </div>

    {/* List */}
    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
      <h2 className="text-base font-semibold text-ink-900">Students</h2>
      {filteredStudents?.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students yet"
          description={
            isEffectiveCoordinator
              ? "Students assigned to your classes will appear here."
              : "Add students to start tracking attendance and performance."
          }
          action={
            !hasNoAccess
              ? {
                  label: "Add Student",
                  icon: <Plus className="h-4 w-4" />,
                  onClick: handleAddStudent,
                }
              : undefined
          }
        />
      ) : (
        <ul className="list-none p-0 space-y-2">
          {filteredStudents?.map((student) => {
            const studentClass = student.class_assignments?.[0]?.classes;
            const isSelected = selectedStudentIds.has(student.id);
            return (
              <ListRow
                key={student.id}
                as="li"
                className={isSelected ? "ring-2 ring-brand-primary/40" : undefined}
                leading={
                  showCheckboxes ? (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleStudentSelection(student.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>{student.full_name.substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )
                }
                title={
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{student.full_name}</span>
                    {studentClass ? (
                      <Badge variant="outline" className="text-xs">
                        {formatClassName(studentClass.name, studentClass.section)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Not assigned</Badge>
                    )}
                    {!student.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                  </span>
                }
                subtitle={<span className="truncate">{student.email}</span>}
                onClick={() => handleViewProfile(student.id)}
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleViewProfile(student.id)}>View Profile</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAssignToClass(student)}>Assign to Class</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleResetPassword(student)}>
                        <Key className="h-4 w-4 mr-2" />
                        Reset Password
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleViewResults(student.id)}>View Results</DropdownMenuItem>
                      {isEffectiveAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteUser({ id: student.id, full_name: student.full_name })}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Student
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            );
          })}
        </ul>
      )}
    </div>

    {/* Hidden triggers for trigger-only dialogs */}
    <div className="sr-only" aria-hidden>
      {!hasNoAccess && (
        <>
          <BulkUploadStudentsDialog
            institutionId={roleInfo?.institutionId || ""}
            coordinatorClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
            trigger={<button ref={bulkUploadTriggerRef} tabIndex={-1} aria-hidden />}
          />
          {(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) && (
            <BulkUpdateStudentsDialog
              institutionId={roleInfo?.institutionId || ""}
              trigger={<button ref={bulkUpdateTriggerRef} tabIndex={-1} aria-hidden />}
            />
          )}
          <AddUserDialog
            defaultInstitutionId={roleInfo?.institutionId}
            defaultRole="student"
            allowedRoles={["student"]}
            coordinatorClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
            trigger={<button ref={addStudentTriggerRef} tabIndex={-1} aria-hidden />}
          />
        </>
      )}
    </div>

    {/* Existing dialogs and sheets — UNCHANGED */}
    <ViewUserSheet open={viewUserOpen} onOpenChange={setViewUserOpen} userId={selectedUserId} />
    {/* … keep AssignStudentClassDialog, EditStudentPasswordDialog, AlertDialog (single + bulk delete),
        BulkAssignTaskDialog, PromoteStudentsDialog, BulkPromoteUploadDialog exactly as they are */}
  </PageShell>
);
```

> The hidden-trigger pattern: `<button ref={x} tabIndex={-1} aria-hidden />` inside an `sr-only` wrapper. Identical to Phase 5 Task 17 SchoolTeachersPage (read that file lines 87–88 + the hidden button block for the live reference).

> The class-filter chip cycles through values for now. If the institution has many classes, that's awkward — but converting to FilterSheet expands scope. Document as a follow-up; do not implement here.

- [ ] **Step 29.5: Drop the `useTableSort` import + state**

Remove `import { useTableSort }` and the `const { sortedData: sortedStudents, sortConfig, handleSort } = useTableSort(...)` line. Replace `sortedStudents` references with `filteredStudents`. Sort affordance loss is documented in `chat-handoff` "Remaining backlog" — restore later via a Sort FilterChip if requested.

- [ ] **Step 29.6: Run the validation triple**

```bash
npx tsc --noEmit
npx eslint src/pages/school/SchoolStudentsPage.tsx
npx vite build
```

The file currently has at least three `as any` casts (lines 204, 520-ish) accessing `student.class_assignments` joined-row fields. Pre-existing — leave alone unless the new diff lands on those lines. If the diff DOES land on them, replace with the `pickOne<T>` helper pattern from CLAUDE.md §5a (see SchoolCoordinatorsPage for an example).

- [ ] **Step 29.7: Real-device smoke**

iPhone Safari at 375 px:
- Header bar shows "Students" + a single primary CTA + kebab. The five secondary actions live in the kebab.
- Two neutral StatTile cards.
- Bulk-selection bar still appears when checkboxes ticked.
- Class filter chip cycles correctly.
- ListRow shows checkbox in leading slot when checkboxes enabled, avatar otherwise.
- All dropdown actions still work: View Profile, Assign to Class, Reset Password, View Results, Delete.
- Delete confirm + bulk-delete confirm still trigger the AlertDialog.
- "Add Student" still opens via primary action AND the FAB; both invoke the hidden trigger.

- [ ] **Step 29.8: Commit**

Subagent reports back. Controller commits:

```bash
git add src/pages/school/SchoolStudentsPage.tsx
git commit -m "feat(ui): redesign Students list with shared primitives

Apply PageShell, PageHeader+ActionMenu (kebab for 5 secondary
actions), StatTileGrid, ListRow, EmptyState, FilterRow,
MobileFab. Replaces the action-button wall, the loud
GradientKPICard pair, and the five-column student table.

Hidden-trigger ref pattern wires the three trigger-only dialogs
(AddUserDialog, BulkUploadStudentsDialog, BulkUpdateStudentsDialog)
to PageHeader actions. useTableSort column sorts removed (acceptable
behavior loss; documented in branch chat handoff).

All mutations, dialogs, and bulk-selection state machine untouched.
No data-flow changes."
```

---

## Task 30: SchoolCoordinatorsPage redesign

**Files:**
- Modify: `src/pages/school/SchoolCoordinatorsPage.tsx` (~531 lines)

**Symptom:** same shape as SchoolTeachersPage Task 17 (single primary CTA, GradientKPICard pair, table-on-mobile). Smaller surface than Students because no bulk-selection or trigger-only dialog overflow.

- [ ] **Step 30.1: Read end-to-end**

Lock down:
- `useQuery` for `["school-coordinators", roleInfo?.institutionId]` — joins through `wing_assignments` and `wing_class_mappings` with `pickOne<T>` helper (already correct, no `any` casts on the joined-row reads).
- Three controlled dialogs: `viewUserOpen` (`ViewUserSheet`), `assignClassesOpen` (`AssignClassesDialog`), `assignWingOpen` (`AssignWingDialog`).
- `AddUserDialog` uses `trigger=` prop only — same hidden-button-ref pattern as Task 17.
- `useTableSort` again: drop it, accept the sort behavior loss.

- [ ] **Step 30.2: Add hidden-trigger ref**

```tsx
import { useRef, useState } from "react";

const addCoordinatorTriggerRef = useRef<HTMLButtonElement>(null);
const handleAddCoordinator = () => addCoordinatorTriggerRef.current?.click();
```

- [ ] **Step 30.3: Replace imports**

Add:

```tsx
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
```

Remove `Card`, `CardContent`, `GradientKPICard`, `DashboardSection`, `Table*`, `SortableTableHeader`, `useTableSort` after the rewrite.

- [ ] **Step 30.4: Replace the outer return**

```tsx
return (
  <PageShell
    fab={
      <MobileFab
        label="Add Coordinator"
        icon={<Plus className="h-6 w-6" />}
        onClick={handleAddCoordinator}
      />
    }
  >
    <PageHeader
      icon={<UserCog className="h-5 w-5" />}
      title="Coordinators"
      subtitle="Manage your school's coordinators"
      primaryAction={{
        label: "Add Coordinator",
        icon: <Plus className="h-4 w-4" />,
        onClick: handleAddCoordinator,
      }}
    />

    <StatTileGrid mdCols={2}>
      <StatTile
        label="Total Coordinators"
        value={formatNumber(coordinators?.length || 0)}
        icon={<UserCog className="h-5 w-5" />}
        tone="teal"
      />
      <StatTile
        label="Unique Classes Assigned"
        value={formatNumber(totalClassesAssigned)}
        icon={<Layers className="h-5 w-5" />}
        tone="violet"
      />
    </StatTileGrid>

    {/* Search */}
    <div className="mt-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search coordinators..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 rounded-xl pl-9"
        />
      </div>
    </div>

    {/* List */}
    <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
      <h2 className="text-base font-semibold text-ink-900">Coordinators</h2>
      {filteredCoordinators?.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-7 w-7" />}
          title="No coordinators yet"
          description="Coordinators help admins manage classes and oversight. Add one to get started."
          action={{
            label: "Add Coordinator",
            icon: <Plus className="h-4 w-4" />,
            onClick: handleAddCoordinator,
          }}
        />
      ) : (
        <ul className="list-none p-0 space-y-2">
          {filteredCoordinators?.map((coordinator) => {
            const wings = coordinator.wing_assignments || [];
            const wingClasses = coordinator.wingClasses || [];
            return (
              <ListRow
                key={coordinator.id}
                as="li"
                leading={
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>
                      {coordinator.full_name?.substring(0, 2)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                }
                title={
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{coordinator.full_name || "Unnamed"}</span>
                    {coordinator.isAlsoTeacher && (
                      <Badge variant="outline" className="text-xs border-green-200 text-green-700">
                        <GraduationCap className="h-3 w-3 mr-1" />
                        Teacher
                      </Badge>
                    )}
                    {!coordinator.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                  </span>
                }
                subtitle={
                  <span className="flex flex-col gap-1 text-xs text-ink-600">
                    <span className="truncate">{coordinator.email}</span>
                    <span className="flex items-center gap-1 flex-wrap">
                      <Building2 className="h-3 w-3" />
                      {wings.length === 0
                        ? "No wing assigned"
                        : wings.length === 1
                          ? wings[0].name
                          : `${wings[0].name} +${wings.length - 1}`}
                      {" · "}
                      <Layers className="h-3 w-3" />
                      {wingClasses.length === 0
                        ? "No classes"
                        : `${wingClasses.length} classes`}
                    </span>
                  </span>
                }
                onClick={() => handleViewProfile(coordinator.id)}
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleViewProfile(coordinator.id)}>
                        View Profile
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleAssignWing({ id: coordinator.id, full_name: coordinator.full_name })}>
                        <Building2 className="h-4 w-4 mr-2" />
                        Assign to Wing
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAssignClasses({ id: coordinator.id, full_name: coordinator.full_name })}>
                        <Layers className="h-4 w-4 mr-2" />
                        Assign Classes
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleViewTasks(coordinator.id)}>
                        View Tasks
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            );
          })}
        </ul>
      )}
    </div>

    {/* Hidden trigger for AddUserDialog */}
    <div className="sr-only" aria-hidden>
      <AddUserDialog
        defaultInstitutionId={roleInfo?.institutionId}
        defaultRole="coordinator"
        allowedRoles={["coordinator"]}
        trigger={<button ref={addCoordinatorTriggerRef} tabIndex={-1} aria-hidden />}
      />
    </div>

    {/* Existing dialogs/sheets — UNCHANGED */}
    <ViewUserSheet open={viewUserOpen} onOpenChange={setViewUserOpen} userId={selectedUserId} />
    {roleInfo?.institutionId && (
      <>
        <AssignClassesDialog
          open={assignClassesOpen}
          onOpenChange={setAssignClassesOpen}
          user={selectedUser}
          institutionId={roleInfo.institutionId}
          role="coordinator"
        />
        <AssignWingDialog
          open={assignWingOpen}
          onOpenChange={setAssignWingOpen}
          user={selectedUser}
          institutionId={roleInfo.institutionId}
        />
      </>
    )}
  </PageShell>
);
```

> Wing/class details collapse to a compact metadata row in the subtitle. The original Popover "+N more" hover affordance is acceptable to drop on mobile — tapping the row opens the full ViewUserSheet which has the complete list.

- [ ] **Step 30.5: Drop the `useTableSort` import + state**

Same pattern as Task 29 — replace `sortedCoordinators` references with `filteredCoordinators`.

- [ ] **Step 30.6: Run the validation triple**

```bash
npx tsc --noEmit
npx eslint src/pages/school/SchoolCoordinatorsPage.tsx
npx vite build
```

This file already uses `pickOne<T>` correctly — should be ESLint-clean on the touched ranges.

- [ ] **Step 30.7: Real-device smoke**

iPhone Safari at 375 px:
- Single-row header with "+ Add Coordinator" button + FAB at bottom.
- Two neutral StatTile cards.
- Each ListRow shows name + Teacher badge + email + wing/class summary.
- Kebab menu surfaces View Profile, Assign to Wing, Assign Classes, View Tasks.
- Adding a coordinator still works (hidden-trigger fires AddUserDialog).
- Empty state CTA when no coordinators.

- [ ] **Step 30.8: Commit**

```bash
git add src/pages/school/SchoolCoordinatorsPage.tsx
git commit -m "feat(ui): redesign Coordinators list with shared primitives

Apply PageShell, PageHeader, StatTileGrid, ListRow, EmptyState,
MobileFab. Wing+class chips collapse to a compact subtitle line;
detail Popover dropped (full list still visible via ViewUserSheet).
Hidden-trigger ref wires AddUserDialog (trigger-only) to
PageHeader.primaryAction.

useTableSort column sorts removed (acceptable loss, documented
in branch chat handoff).

No data-flow changes."
```

---

## Task 31: HRDashboardPage redesign

**Files:**
- Modify: `src/pages/school/HRDashboardPage.tsx` (~52 lines)

**Symptom (screenshot):** the seven-tab strip "Staff Directory / Documents / Salary Structures / Salary Assignments / Leave Management / Payroll / Holiday Calendar" wraps to multiple rows on mobile (the existing `flex-wrap` is the wrap source). Also: the file imports `<AppLayout>` and wraps the page in it — that's a double-wrap because `ProtectedRoute` already provides `<AppLayout>` (see [src/components/layout/ProtectedRoute.tsx:74](../../src/components/layout/ProtectedRoute.tsx#L74)).

- [ ] **Step 31.1: Confirm the double-wrap and the route wrapping**

Read [src/components/layout/ProtectedRoute.tsx:74](../../src/components/layout/ProtectedRoute.tsx#L74) and confirm the final return is `<AppLayout>{children}</AppLayout>`. Read [src/App.tsx](../../src/App.tsx) and confirm `<HRDashboardPage />` is wrapped in `<ProtectedRoute>`. Yes → the local `<AppLayout>` wrapper is redundant and must be removed in this task.

- [ ] **Step 31.2: Replace the entire file**

```tsx
import { useState } from "react";
import { StaffDirectoryTab } from "@/components/hr/StaffDirectoryTab";
import { SalaryStructuresTab } from "@/components/hr/SalaryStructuresTab";
import { SalaryAssignmentsTab } from "@/components/hr/SalaryAssignmentsTab";
import { StaffDocumentsTab } from "@/components/hr/StaffDocumentsTab";
import { StaffLeavePanel } from "@/components/hr/StaffLeavePanel";
import { PayrollRunPanel } from "@/components/hr/PayrollRunPanel";
import { HolidayCalendarPanel } from "@/components/hr/HolidayCalendarPanel";
import { Briefcase } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";

const TAB_OPTIONS = [
  { value: "directory", label: "Staff Directory" },
  { value: "documents", label: "Documents" },
  { value: "structures", label: "Salary Structures" },
  { value: "assignments", label: "Salary Assignments" },
  { value: "leave", label: "Leave Management" },
  { value: "payroll", label: "Payroll" },
  { value: "holidays", label: "Holiday Calendar" },
] as const;

type TabValue = (typeof TAB_OPTIONS)[number]["value"];

export default function HRDashboardPage() {
  const [activeTab, setActiveTab] = useState<TabValue>("directory");

  return (
    <PageShell>
      <PageHeader
        icon={<Briefcase className="h-5 w-5" />}
        title="HR & Payroll"
        subtitle="Manage staff, salaries, leave, and payroll"
      />

      <div className="mt-2">
        <MobileTabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabValue)}
          options={TAB_OPTIONS as unknown as { value: string; label: string }[]}
        />
      </div>

      <div className="mt-4">
        {activeTab === "directory" && <StaffDirectoryTab />}
        {activeTab === "documents" && <StaffDocumentsTab />}
        {activeTab === "structures" && <SalaryStructuresTab />}
        {activeTab === "assignments" && <SalaryAssignmentsTab />}
        {activeTab === "leave" && <StaffLeavePanel />}
        {activeTab === "payroll" && <PayrollRunPanel />}
        {activeTab === "holidays" && <HolidayCalendarPanel />}
      </div>
    </PageShell>
  );
}
```

> The `as unknown as` cast on `TAB_OPTIONS` is to widen the readonly literal-tuple type for MobileTabs' generic `options` prop — necessary because MobileTabs' contract is `{ value: string; label: string }[]`. If MobileTabs' types are already generic over `value`, drop the cast.

- [ ] **Step 31.3: Run the validation triple**

```bash
npx tsc --noEmit
npx eslint src/pages/school/HRDashboardPage.tsx
npx vite build
```

If ESLint flags the `as unknown as` cast, replace with a hand-typed `options` array (drop `as const`).

- [ ] **Step 31.4: Real-device smoke**

iPhone Safari at 375 px:
- Single app bar (verify the AppLayout wasn't double-wrapping by checking the DOM tree — only one `<header>` + one main scroll container).
- "HR & Payroll" header card with icon + title + subtitle.
- Seven tab pills scroll horizontally with snap; active pill scrolls into view when changed.
- Each panel renders below cleanly.

- [ ] **Step 31.5: Commit**

```bash
git add src/pages/school/HRDashboardPage.tsx
git commit -m "feat(ui): redesign HR & Payroll with MobileTabs

Apply PageShell + PageHeader + MobileTabs scroll-snap pills,
replacing the seven-trigger flex-wrap TabsList that was
multi-rowing at 375px. Drop the redundant <AppLayout> wrapper
(ProtectedRoute already provides one) which was producing a
double app bar / double scroll container.

Tab values and child panels untouched. No data-flow changes."
```

---

## Task 32: AnalyticsPage admin path redesign

**Files:**
- Modify: `src/pages/AnalyticsPage.tsx` (~210 lines, multiple role branches)

**Symptom (screenshot):** the school-admin Tabs strip "Principal View / Detailed Analytics / Proctoring" clips at 375 px (especially with longer labels like "Detailed Analytics"). Same shape on the super_admin branch ("System / Proctoring / School View"). Teacher / coordinator / student / fallback branches don't have a tab strip and need only the header polish.

**Why two branches:** keep the role-routing intact; only swap the `<Tabs>` strip in the two branches that have one. Don't introduce PageShell to all branches because the child analytics dashboards already render their own internal cards — leave those untouched and apply only header + tab swap.

- [ ] **Step 32.1: Read the file end-to-end**

The `AnalyticsPage` component branches on `role`:
- `super_admin` → Tabs (System / Proctoring / School View)
- `school_admin` / `super_school_admin` → Tabs (Principal View / Detailed Analytics / Proctoring)
- `teacher` / `coordinator` → no tabs, just `<TeacherAnalyticsDashboard />`
- `student` → no tabs, just `<StudentAnalyticsDashboard />`
- fallback → empty state Card

- [ ] **Step 32.2: Add imports**

```tsx
import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";
```

- [ ] **Step 32.3: Rewrite the school_admin / super_school_admin branch**

Replace the entire `if (role === "school_admin" || role === "super_school_admin") { … }` block:

```tsx
if (role === "school_admin" || role === "super_school_admin") {
  return <SchoolAnalyticsView institutionId={institutionId} />;
}
```

Then add at the bottom of the file (before the default fallback):

```tsx
function SchoolAnalyticsView({ institutionId }: { institutionId: string | null | undefined }) {
  const [activeTab, setActiveTab] = useState<"overview" | "detailed" | "proctoring">("detailed");
  return (
    <PageShell>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="School Analytics"
        subtitle="Performance insights for your institution"
      />
      <div className="mt-2">
        <MobileTabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "overview" | "detailed" | "proctoring")}
          options={[
            { value: "overview", label: "Principal View" },
            { value: "detailed", label: "Detailed Analytics" },
            { value: "proctoring", label: "Proctoring" },
          ]}
        />
      </div>
      <div className="mt-4">
        {activeTab === "overview" && <PrincipalDashboard institutionId={institutionId ?? null} />}
        {activeTab === "detailed" && <SchoolAnalyticsDashboard institutionId={institutionId ?? null} />}
        {activeTab === "proctoring" && <ProctoringAnalyticsDashboard institutionId={institutionId || undefined} />}
      </div>
    </PageShell>
  );
}
```

> Note: `useState` import already at the top — confirm. The default-tab choice "detailed" matches the original `defaultValue="detailed"`.

- [ ] **Step 32.4: Rewrite the super_admin branch (same pattern)**

Replace the `if (role === "super_admin") { … }` block:

```tsx
if (role === "super_admin") {
  return <SuperAdminAnalyticsView />;
}
```

Add the helper:

```tsx
function SuperAdminAnalyticsView() {
  const [activeTab, setActiveTab] = useState<"system" | "proctoring" | "school-view">("system");
  return (
    <PageShell>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="System Analytics"
        subtitle="Comprehensive analytics across all institutions"
      />
      <div className="mt-2">
        <MobileTabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "system" | "proctoring" | "school-view")}
          options={[
            { value: "system", label: "System" },
            { value: "proctoring", label: "Proctoring" },
            { value: "school-view", label: "School View" },
          ]}
        />
      </div>
      <div className="mt-4">
        {activeTab === "system" && <SuperAdminAnalyticsDashboard />}
        {activeTab === "proctoring" && <ProctoringAnalyticsDashboard />}
        {activeTab === "school-view" && <SchoolViewWithSelector />}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 32.5: Polish the simple branches**

Wrap each remaining branch (`teacher`/`coordinator`, `student`, fallback) in `<PageShell><PageHeader … /> … </PageShell>` to apply the unified gradient and header chrome. Example for teacher/coordinator:

```tsx
if (role === "teacher" || role === "coordinator") {
  return (
    <PageShell>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="Teaching Analytics"
        subtitle="Class performance and question insights"
      />
      <div className="mt-4">
        <TeacherAnalyticsDashboard />
      </div>
    </PageShell>
  );
}
```

Mirror for `student` and the fallback.

- [ ] **Step 32.6: Drop the now-unused imports**

Remove `Tabs, TabsContent, TabsList, TabsTrigger` once the JSX no longer references them. Keep `Card, CardContent` only if the fallback branch still uses them.

- [ ] **Step 32.7: Run the validation triple**

```bash
npx tsc --noEmit
npx eslint src/pages/AnalyticsPage.tsx
npx vite build
```

- [ ] **Step 32.8: Real-device smoke**

iPhone Safari at 375 px, three sessions (one as `school_admin`, one as `super_admin`, one as teacher/student):
- Each branch shows the unified gradient backdrop + header card.
- Admin tab strip scrolls; "Detailed Analytics" no longer clips.
- Switching tabs re-mounts only the active panel (verify by watching network panel — no duplicate fetches).

- [ ] **Step 32.9: Commit**

```bash
git add src/pages/AnalyticsPage.tsx
git commit -m "feat(ui): redesign Analytics with PageShell + MobileTabs

Apply PageShell + PageHeader to all role branches and convert
the school-admin and super-admin Tabs strips to MobileTabs
scroll-snap pills (resolves the 'Detailed Analytics' clip at 375px).
Switch from shadcn TabsContent (mounts all panels) to conditional
rendering (one panel mounted at a time).

Role routing untouched. No data-flow changes."
```

---

## Task 33: PrincipalDashboard overview redesign

**Files:**
- Modify: `src/components/dashboards/PrincipalDashboard.tsx` (~260 lines)

**Symptoms (screenshots):**
- The header strip "12 Classes / 6 Teachers / School Avg: 0.0%" uses three Badges in a flex row that's tight at 375 px and wraps awkwardly.
- The sub-tabs "Overview / Teachers / Subjects" are shadcn `<TabsList>` and clip on small viewports.
- The Teacher Performance Summary table has columns clipping ("ect(s)", "Class Avg", "Remark").
- The drilldown summary cards row of four `<Card>` blocks shows only ~1.5 cards visible at 375 px.

**Out of scope:** the chart components (`PerformanceDistributionChart`, `BarChart` for subject overview) and the helper tables (`PrincipalHeatMap`, `UnderperformingTable`, `TeacherComparisonTable`) are separate components. Don't redesign those — only the wrapper layout.

- [ ] **Step 33.1: Add imports**

```tsx
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
```

- [ ] **Step 33.2: Replace the Overview-view header strip**

Current code (lines ~172–193):

```tsx
<div className="flex items-center justify-between">
  <div>…h2 + institutionName…</div>
  <div className="flex items-center gap-2">
    <Badge>…{totalClasses} Classes…</Badge>
    <Badge>…{totalTeachers} Teachers…</Badge>
    <Badge>School Avg: {schoolAvg}…</Badge>
  </div>
</div>
```

Replace with:

```tsx
<div className="space-y-3">
  <div>
    <h2 className="text-xl font-bold flex items-center gap-2">
      <Building2 className="h-5 w-5" />
      Principal Dashboard
    </h2>
    {institutionName && <p className="text-sm text-ink-600">{institutionName}</p>}
  </div>
  <StatTileGrid mdCols={3}>
    <StatTile
      label="Classes"
      value={formatNumber(overview.totalClasses)}
      icon={<GraduationCap className="h-5 w-5" />}
      tone="teal"
    />
    <StatTile
      label="Teachers"
      value={formatNumber(overview.totalTeachers)}
      icon={<Users className="h-5 w-5" />}
      tone="violet"
    />
    <StatTile
      label="School Avg"
      value={`${overview.schoolAvg.toFixed(1)}%`}
      icon={<BarChart3 className="h-5 w-5" />}
      tone={overview.schoolAvg >= 70 ? "mint" : overview.schoolAvg >= 50 ? "amber" : "rose"}
    />
  </StatTileGrid>
</div>
```

> Confirm the StatTile `tone` prop accepts `"mint"`, `"amber"`, `"rose"` — read [src/components/shared/surfaces/StatTile.tsx](../../src/components/shared/surfaces/StatTile.tsx) to verify the tone vocabulary. If those tones are not in the union, fall back to `tone="teal"` and convey the threshold via a small badge below or via the existing color-conditional logic on the value text.

- [ ] **Step 33.3: Replace the Tabs strip**

Replace `<Tabs defaultValue="overview" …><TabsList>…</TabsList>…</Tabs>` with:

```tsx
const [activeSubTab, setActiveSubTab] = useState<"overview" | "teachers" | "subjects">("overview");

// in JSX:
<div className="mt-2">
  <MobileTabs
    value={activeSubTab}
    onValueChange={(v) => setActiveSubTab(v as "overview" | "teachers" | "subjects")}
    options={[
      { value: "overview", label: "Overview" },
      { value: "teachers", label: "Teachers" },
      { value: "subjects", label: "Subjects" },
    ]}
  />
</div>
<div className="mt-4 space-y-6">
  {activeSubTab === "overview" && (
    <>
      <PrincipalHeatMap data={overview.heatmapData} onCellClick={setSelectedClassId} />
      <UnderperformingTable data={overview.underperformingClasses} onClassClick={setSelectedClassId} />
    </>
  )}
  {activeSubTab === "teachers" && <TeacherComparisonTable data={overview.teacherPerformance} />}
  {activeSubTab === "subjects" && (
    /* existing subjects Card + BarChart block — leave inner JSX intact */
    /* ... */
  )}
</div>
```

> Add `useState` import if not already present. The original used `defaultValue="overview"` so initial state is `"overview"`.

- [ ] **Step 33.4: Replace the drilldown summary-cards strip**

Inside the drilldown view (lines ~64–100), replace the four `<Card>` summary blocks with a `StatTileGrid mdCols={4}`:

```tsx
<StatTileGrid mdCols={4}>
  <StatTile
    label="Class Average"
    value={`${drilldown.classAvg.toFixed(1)}%`}
    icon={<BarChart3 className="h-5 w-5" />}
    tone={drilldown.classAvg >= 70 ? "mint" : drilldown.classAvg >= 50 ? "amber" : "rose"}
  />
  <StatTile
    label="School Average"
    value={`${drilldown.schoolAvg.toFixed(1)}%`}
    icon={<Building2 className="h-5 w-5" />}
    tone="teal"
  />
  <StatTile
    label="Top Class"
    value={`${drilldown.topClassPercent.toFixed(1)}%`}
    icon={<GraduationCap className="h-5 w-5" />}
    tone="mint"
  />
  <StatTile
    label="Students"
    value={formatNumber(drilldown.students.length)}
    icon={<Users className="h-5 w-5" />}
    tone="violet"
  />
</StatTileGrid>
```

- [ ] **Step 33.5: Drop the now-unused imports**

Remove `Tabs, TabsContent, TabsList, TabsTrigger` and any `Card*` blocks that no longer have callers (the subjects branch may still use Card — leave it). Confirm by Grep within the file.

- [ ] **Step 33.6: Run the validation triple**

```bash
npx tsc --noEmit
npx eslint src/components/dashboards/PrincipalDashboard.tsx
npx vite build
```

- [ ] **Step 33.7: Real-device smoke**

iPhone Safari at 375 px with a `school_admin` session navigated to `/analytics?tab=overview`:
- Three StatTile cards instead of three squeezed Badge pills.
- Three sub-tabs scroll-snap; "Subjects" no longer clips.
- Drilldown view (click a heatmap cell) shows four StatTiles in a 2×2 grid on mobile, 1×4 on desktop.
- Charts and tables (heatmap, underperforming, teacher comparison) render exactly as before.

- [ ] **Step 33.8: Commit**

```bash
git add src/components/dashboards/PrincipalDashboard.tsx
git commit -m "feat(ui): redesign Principal Dashboard wrapper with shared primitives

Replace the three-Badge header strip with StatTileGrid (Classes,
Teachers, School Avg with threshold-driven tone), swap shadcn
Tabs for MobileTabs scroll-snap pills, and convert the drilldown
four-Card summary row to StatTileGrid (mdCols={4}). Internal
charts and helper tables (PrincipalHeatMap, UnderperformingTable,
TeacherComparisonTable, PerformanceDistributionChart) untouched.

No data-flow changes."
```

---

## Task 34: Update CLAUDE.md §20a + remove handoff scaffolding

**Files:**
- Modify: `.claude/CLAUDE.md` (append a Phase 7 note to §20a)

- [ ] **Step 34.1: Append the Phase 7 surface coverage note**

Open `.claude/CLAUDE.md`. Find `## 20a. Mobile Design System (2026-04-27)`. After the existing paragraph that ends "Implementation plan: …teacher-coordinator-mobile-ui-redesign.md.", append:

```markdown
**Phase 7 (2026-04-28) — School-admin coverage.** The same primitives now back the school-admin surfaces: `ManageUsersPage` (parent tab strip on `MobileTabs`), `ManageAdminsPage`, `SchoolStudentsPage`, `SchoolCoordinatorsPage`, `HRDashboardPage`, `AnalyticsPage` (admin + super-admin paths), and the embedded `PrincipalDashboard` overview + drilldown. Five-plus action buttons per page collapse into `PageHeader.secondaryActions` kebab. `useTableSort` column sorts were dropped during table → ListRow swaps; restore via a Sort `FilterChip` if the affordance becomes load-bearing. `HRDashboardPage` previously rendered its own `<AppLayout>` wrapper — `ProtectedRoute` already provides one, so any new admin page must not re-wrap. Plan: `docs/superpowers/plans/2026-04-28-school-admin-mobile-ui-redesign.md`.
```

- [ ] **Step 34.2: Run validation**

```bash
npx tsc --noEmit
npx vite build
```

(No ESLint check — markdown only.)

- [ ] **Step 34.3: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(claude): note Phase 7 school-admin coverage in §20a"
```

---

## Self-Review Checklist (post-write)

Before handing this plan to an executor:

1. **Spec coverage:** every screenshot symptom from the chat handoff maps to a task.
   - 4-tab strip clipping → Task 27.
   - Manage Administrators header collision + table → Task 28.
   - SchoolStudentsPage action wall → Task 29.
   - SchoolCoordinatorsPage table → Task 30.
   - HR & Payroll seven-tab wrap → Task 31.
   - Principal Dashboard sub-tabs + Teacher Performance Summary clipping → Task 33.
   - Analytics tabs strip clipping → Task 32.

2. **Placeholder scan:** no "TBD", no "fill in similar to Task N" without code, no "add error handling" stubs. The dialog state machines are quoted as-is to preserve.

3. **Type consistency:** `MobileTabs` API is referenced as `{ value, onValueChange, options: { value, label }[] }` throughout. Each task verifies the actual signature in Step N.4 / N.2 before committing — if it differs, the implementer adjusts the call site (not the primitive). Same for `StatTile.tone` — Step 33.2 mandates verifying the tone vocabulary.

4. **Layout invariant:** Task 31 is the only place that drops `<AppLayout>`. The other pages already don't render it. The plan calls this out explicitly in the top-of-document layout-invariant block.

5. **Parallelization:** Tasks 28, 29, 30 can run in parallel implementer batches because each touches one file with no shared imports or types. Tasks 32 and 33 should run sequentially because the school-admin path of AnalyticsPage embeds `PrincipalDashboard`. Task 27 must land first because the parent tab strip change is a contract the children should be tested against.

6. **No git from subagents:** every Step N.last says "Subagent reports back; controller commits." Repeated to emphasize.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-school-admin-mobile-ui-redesign.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Tasks 28, 29, 30 batch in parallel after Task 27 lands.

**2. Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`, batch with checkpoints for review.
