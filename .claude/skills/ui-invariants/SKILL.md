---
name: ui-invariants
description: UI invariants — DialogContent auto-wraps children in ScrollArea (project-specific fork), feature gating must stay in sync across sidebar + dashboard tiles + routes, Predictions tab is hidden. Use when touching any shadcn Dialog, AppSidebar, NavigationHub, RoleBasedDashboard, School/Teacher dashboards, or FEATURE_URL_MAP.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# SALCI UI Invariants

Platform-wide UI rules that are NOT obvious from reading component files alone. Ignoring any of these will either break scrolling in every dialog or open ghost entry points into disabled modules.

## 1. DialogContent auto-wraps children in ScrollArea (NON-STANDARD)

[src/components/ui/dialog.tsx](../../src/components/ui/dialog.tsx) is a project-specific fork of shadcn's `Dialog`. Unlike upstream, `DialogContent` auto-wraps every child in a Radix `ScrollArea` + `p-6` div:

```tsx
<DialogPrimitive.Content className="... grid ... max-h-[90vh] overflow-hidden">
  <ScrollArea className="max-h-[90vh]">
    <div className="p-6">{children}</div>
  </ScrollArea>
  <DialogPrimitive.Close ... />
</DialogPrimitive.Content>
```

**Consequence — consumers must NOT add their own scroll/flex scaffolding.** Adding `flex flex-col h-full overflow-hidden` to a child form (or `max-h-[85vh] flex flex-col overflow-hidden` to `DialogContent`) nests scroll containers and breaks scrolling:
* `h-full` resolves against the `p-6` wrapper div, which has no defined height → collapses to zero.
* `overflow-hidden` on the inner form clips content before the outer ScrollArea can scroll it.
* Result: dialog content visually truncated (footer buttons unreachable), neither mouse wheel nor scrollbar works. This is exactly how Add Student dialog broke (fixed 2026-04-18 in [AddUserDialog.tsx](../../src/components/admin/AddUserDialog.tsx)).

**Rule for any dialog body:** Pass plain children. Let the built-in ScrollArea handle scroll. Only set `sm:max-w-[...]` on `DialogContent` for width. Do NOT add `max-h-*`, `flex`, `overflow-*`, or `h-full` to `DialogContent`, inner `<form>`, `DialogHeader`, or `DialogFooter`.

**Sticky headers/footers exception.** If a dialog genuinely needs a custom sticky header/footer layout, the correct fix is changing [dialog.tsx](../../src/components/ui/dialog.tsx) itself (e.g. make the ScrollArea opt-in via a prop) — NOT fighting it per-consumer. That's a system-wide change requiring sign-off. Alternate pattern: use negative margins + `sticky bottom-0` inside children to compensate for the inner `p-6` wrapper (see timetable-module skill §5 for the lesson-plan panel example).

## 2. Feature gating — sidebar AND dashboard tiles must stay in sync

Feature visibility is enforced in THREE places, and all three must agree or users see ghost entry points into disabled modules:

1. **Route-level**: `ProtectedRoute` + `FEATURE_URL_MAP` in [featuresData.ts](../../src/components/admin/institution-wizard/featuresData.ts) — URL-blocks disabled features.
2. **Sidebar**: [AppSidebar.tsx](../../src/components/layout/AppSidebar.tsx) — `filterItemsByFeature` runs against every nav group using `FEATURE_URL_MAP` + `useInstitutionFeatures`, gated by `shouldFilterByFeatures` (institution-bound roles + super-admin-while-managing).
3. **Dashboard tile grid**: [NavigationHub.tsx](../../src/components/dashboards/NavigationHub.tsx) — applies the SAME `shouldFilterByFeatures` rule and the SAME `FEATURE_URL_MAP` lookup before rendering `navGroups`. This is what Teacher and (super-admin-while-managing) dashboards use.

**Rule when adding a new feature-gated module:**
* Add URL → feature-id mapping to `FEATURE_URL_MAP` in [featuresData.ts](../../src/components/admin/institution-wizard/featuresData.ts). That single map feeds all three layers.
* Do NOT re-add unconditional rendering of nav items in `NavigationHub` or pass a "pre-filtered" list from `RoleBasedDashboard`. `NavigationHub` does the filtering itself — keeping the logic colocated with the rendering prevents sidebar/tile-grid divergence (fixed 2026-04-18: Attendance tile kept appearing for Alliance International School teachers after super-admin disabled the `attendance` feature, because `NavigationHub` rendered `teacherNavGroups` unfiltered).
* `SchoolAdminCommandCenter` has its own gating path via `useInstitutionFeatures`; if adding features to the school-admin command center, gate them there too.
* The gating rule intentionally does NOT apply to platform-level super-admin views (institutions list, users, AI quotas) — those are not institution-bound. Only turn on filtering for super-admin when `isManagingInstitution` is true.

## 2a. AppSidebar groups are FLAT sections (since 2026-10-14)

The collapsible dropdown groups (2026-08-12 to 2026-10-13) were replaced by always-open sections: a `SidebarGroupLabel` heading over each group's links, every item with its own icon. Consequences:

* Every nav item is always in the DOM, so the guided tour's `[data-tour=...]` targets need no force-expand, and the `salci.sidebar.open-groups` localStorage key is no longer read or written (old values are harmless).
* `ProtectedRoute` still remounts `AppSidebar` on every route change, so the active item is brought into view with a `scrollIntoView({ block: "nearest" })` callback ref on its `SidebarMenuItem`. Keep it, the flat list is long enough that the current page can sit below the fold.
* Groups with exactly one item (Dashboard, the Olympiad-only lockdown tab) render without a heading.
* On the icon rail the headings fade out (shadcn's own collapsed style) and every item icon shows in one column.
* The phone bottom tab bar (`MobileBottomNav.tsx`) repeats four core links per role; its urls must stay in the matching sidebar list and go through the same `FEATURE_URL_MAP` gate (§2).
* Feature gating is unchanged: `filterItemsByFeature` still runs per group before render.

## 3. Predictions tab — hidden from School Dashboard

Predictions tab has been removed from School Dashboard ([ComprehensivePrincipalDashboard.tsx](../../src/components/dashboards/ComprehensivePrincipalDashboard.tsx)) for ALL users (every role, every school). Do NOT re-add a `<TabsTrigger value="predictions">` or `<TabsContent value="predictions">`, and do NOT import `PredictionsTab` there.

* Underlying component [PredictionsTab.tsx](../../src/components/dashboards/PredictionsTab.tsx), hook [usePredictionAnalytics.ts](../../src/hooks/usePredictionAnalytics.ts), and edge function `supabase/functions/generate-predictions/` are intentionally left in place (product may reintroduce). Treat as dormant — don't delete during unused-import sweeps.
* If product asks to re-expose, gate behind a feature flag (via `useInstitutionFeatures`) rather than unconditionally re-rendering the tab.

## 4. Shared AddSubjectPopover — admin-level subject creation

[AddSubjectPopover.tsx](../../src/components/school/AddSubjectPopover.tsx) is the shared inline "+" subject-creation popover used by both [AssignTeacherClassSubjectDialog](../../src/components/school/AssignTeacherClassSubjectDialog.tsx) and [AddUserDialog](../../src/components/admin/AddUserDialog.tsx).

Props: `classId`, `institutionId`, `onCreated(subjectId)`, optional `triggerClassName`, `align`, `side`.

* **Writes at group level** via `useAddInstituteSubject` → `subject_class_group_mappings` (trigger fans out to `subject_class_mappings` per section). See main CLAUDE.md §22 — never write directly to `subject_class_mappings` from admin surfaces.
* **Invalidates both query keys** on success: `["class-subjects", classId, institutionId]` (via `invalidateClassSubjects`) and `["class-subject-mappings", institutionId]` (the institution-wide subject map AddUserDialog reads). Either dialog will pick up the new subject immediately.
* **When adding a new dialog that creates teacher↔subject links**, reuse this popover. Don't inline a duplicate — the invalidation set and the group-level write path are the important invariants.

## 5. formatClassName must be explicitly imported

`formatClassName` is exported from [src/lib/utils.ts](../../src/lib/utils.ts). Any component that calls it MUST import it — typecheck won't catch missing imports when the argument types are `any` (common with Supabase query data). [ViewUserSheet.tsx](../../src/components/admin/ViewUserSheet.tsx) hit a runtime `formatClassName is not defined` ReferenceError (fixed 2026-04-21) because the usage site was added without the import; typecheck passed because `ca.classes?.name` was `any`.

When touching components that display class names, grep for `formatClassName(` and verify `import { formatClassName } from "@/lib/utils"` exists at the top of the file.
