# Update Roll Number — Class → Section → Students Picker

**Date:** 2026-06-26
**Status:** Design approved, ready for plan
**Surface:** School-admin `/school/users` Students tab → "Update Details" dialog → new sub-flow
**Touches:** Frontend only. No DB migration, no edge function, no new dependency.

## Goal

Let a school admin pick a class, then a section, then see only that section's students (name + roll number), batch-edit roll numbers inline, and save them in one go — with client-side duplicate prevention and the existing per-class server-side uniqueness guard intact.

Today, the only way to edit a single student's roll number is through `StudentDetailsCard` (one student at a time), or to roundtrip through a CSV via `BulkUpdateStudentsDialog`. Neither matches the "fix the rolls for Section 8-B in two minutes" flow that the admin actually wants.

## Non-goals

- Not editing admission number, phone, name, or any other field — strictly `roll_number`.
- No CSV export of the edited rolls (the existing bulk-update CSV path already covers that pattern).
- No undo. Once saved, re-editing is the only path back.
- No new DB migration, RPC, or edge function — strictly a frontend feature reusing the existing `update_student_details` RPC.
- No coordinator access in this iteration (matches the parent dialog's existing admin-only gating).

## User flow

1. Admin is on `/school/users` Students tab.
2. Clicks the kebab → "Update Details". The existing `BulkUpdateStudentsDialog` opens.
3. **NEW:** A button labeled **"Update Roll Number"** sits above the existing "Download Template" button.
4. Admin clicks it. The bulk dialog closes. A new `MobileSheet` opens (the SALCI primitive — bottom-anchored, `max-h-[90dvh]`, three regions: sticky header, scrollable body, sticky footer). Title = "Update Roll Number". Subtitle reflects the current step's breadcrumb.
5. **Step 1 — Pick a class.** Card grid of all class_groups for the institution (e.g. Nursery, LKG, Class 1, …, Class 12), sorted canonically. Each card shows the class name + section count + total student count.
6. **Step 2 — Pick a section.** Card grid of sections under the chosen class_group. Each card shows the section label ("A", "B", or the class name if `section` is null) + student count.
7. **Step 3 — Edit roll numbers.** A two-column table (Student name | Roll number `<Input>`), sorted by current roll number ascending (nulls last), then by name. `MobileSheet`'s built-in `primaryAction` is wired to **Save Changes** and `secondaryAction` to **Cancel** — both render in the sticky footer.
8. Admin edits any rolls. If two rows end up with the same non-empty value, both inputs get a red ring and a banner at the top reads "*N students share roll number X*". Save Changes is disabled until duplicates are resolved (or there are no changes).
9. Admin clicks Save Changes. Changed rows are saved one at a time. Each row turns green on success, or shows an inline red error message on failure (e.g. the server-side per-class duplicate guard rejected one row). The sticky footer summarises "Saved N of M". The admin can fix any failing rows and click Save Changes again — successful rows are no longer "changed" so they aren't re-sent.
10. Closing the sheet returns to the Students page (refreshed).

### Breadcrumb / back behaviour

`MobileSheet` accepts a single `title` + `subtitle` in its header. We render the static title `Update Roll Number` and put the clickable breadcrumb into the top of the **body** (just below the sheet header), so we can make individual crumbs clickable:

- Step 1: no breadcrumb (title is enough)
- Step 2: `Class 8`
- Step 3: `Class 8  ›  Section A`

Each crumb is clickable and pops back to that step. The sheet's built-in close affordance (the `X` rendered by `MobileSheet`) exits the sheet entirely. If Step 3 has unsaved edits, navigating back (crumb click or sheet close) triggers a confirm prompt.

## Architecture

### New files

- **`src/components/school/UpdateRollNumberSheet.tsx`** — the wizard sheet. Single component, three internal sub-views (`<ClassStep>`, `<SectionStep>`, `<StudentsStep>`) driven by local state `{ classGroupId, classId } | null`. Estimated ~250 lines.
- **`src/hooks/useSectionStudentsForRoll.ts`** — TanStack Query hook fetching `{ id, full_name, roll_number }` for one section, modelled on the proven pattern from `PromoteStudentsDialog`. Query key `["section-students-for-roll", classId]`, `staleTime: 60_000`.

### Edited files

- **`src/components/school/BulkUpdateStudentsDialog.tsx`** — adds a new `<Button>` above the existing Download Template row, and a new prop `onOpenRollNumberPicker?: () => void`. When the button is clicked it calls the prop and immediately calls `onOpenChange(false)` (closes the bulk dialog before the sheet opens, so we never stack two heavy surfaces). If the prop is not provided the button is hidden — keeps the dialog reusable.
- **`src/pages/school/SchoolStudentsPage.tsx`** — adds `const [rollSheetOpen, setRollSheetOpen] = useState(false);`, renders `<UpdateRollNumberSheet open={rollSheetOpen} onOpenChange={setRollSheetOpen} />`, and passes `onOpenRollNumberPicker={() => setRollSheetOpen(true)}` to `<BulkUpdateStudentsDialog>`.

### Reused infrastructure

- `useInstitutionClassGroups(institutionId)` for Step 1.
- `useClassGroupSections(classGroupId)` for Step 2.
- `useUpdateStudentDetails()` (calls `update_student_details` RPC) for the per-row save in Step 3 — the RPC enforces per-class roll-number uniqueness and the `can_manage_student_subjects` permission check server-side.
- `MobileSheet`, `surface-card frosted-shadow rounded-card`, `text-ink-*`, `<EmptyState>`, `<StatTile>`, `toastError` — all from the SALCI design system.

## Data flow

### Step 3 fetch

```ts
// useSectionStudentsForRoll.ts
const { data } = await supabase
  .from("class_assignments")
  .select("user_id, profiles!class_assignments_user_id_fkey(id, full_name, roll_number)")
  .eq("class_id", classId)
  .eq("role", "student");
// Map down to { id, full_name, roll_number }, drop nulls, sort by roll_number then name.
```

### Save

Local state tracks `Map<studentId, { original: string|null, draft: string|null }>` plus a `Map<studentId, "idle"|"saving"|"saved"|"error">` and `Map<studentId, string>` for error messages.

Save handler:

1. Compute `changed = students.filter(s => trim(draft) !== trim(original))`.
2. For each in `changed`, sequentially (`await` in a loop, not `Promise.all`):
   - Set status to `"saving"`.
   - Fetch the student's other fields (name, admission_number, phone, dob, guardian_*) once at the start of the save batch via a single `select` against `profiles` + `student_personal_details` — to pass through unchanged.
   - Call `useUpdateStudentDetails().mutateAsync(...)` with the new roll_number and the original other fields.
   - On success → status `"saved"`, clear `original` to the new value (so subsequent re-saves don't re-fire).
   - On error → status `"error"`, error message from `translateError` via `toastError`. Continue with the next row.
3. After the loop, surface a footer banner: "Saved X of Y. Z failed — fix and retry."

Sequential (not parallel) is deliberate: parallel calls would conflict-trample each other on the server-side per-class uniqueness check (two students racing for roll 5 in a sister section both think they're winning), and would also make it harder to attribute error toasts to specific rows. With ~30 students per section × ~150 ms per RPC call, batches complete in well under 5 s.

### Cache invalidation

After the batch (success or partial):

- `queryClient.invalidateQueries({ queryKey: ["school-students"] })` — refresh the table behind the sheet.
- `queryClient.invalidateQueries({ queryKey: ["section-students-for-roll", classId] })` — refresh the picker's own list.
- For each saved student, `queryClient.invalidateQueries({ queryKey: ["user-details", studentId] })` — invalidate any open `ViewUserSheet`.

`useUpdateStudentDetails` already does the per-student invalidations, but we still call them explicitly because the batch may re-enter the save loop and we want to be sure intermediate state is correct.

## Validation & errors

### Client-side duplicate gate

A `useMemo` over the current `draft` values builds `Map<rollValue, studentId[]>` for non-empty trimmed values. Any entry with `length >= 2` flags those student ids as `duplicate`. The Save Changes button is disabled whenever any duplicates exist OR no row has been changed. A banner at the top of Step 3 lists the conflicting roll values.

### Server-side conflicts

The `update_student_details` RPC raises `23505` with a message like `Roll number 5 is already assigned to Priya in this class. Use a different roll number.` — this is already a user-friendly message and `isLikelyUserFriendly()` lets it through `translateError`. We display it inline on the failing row and Save Changes re-enables so the admin can fix that row and retry without re-editing others.

The cross-section edge case (a student assigned to two sections of the same class_group whose sister-section student already has the new roll) is rare. The RPC catches it; the row gets an inline error; the admin sees the conflict student's name. No additional client-side prevention is built for this — the marginal cost (pre-fetching every sister section's rolls) outweighs the benefit.

### Permission errors

If the RPC rejects with `42501` (admin lost permission mid-flow — e.g. their role was revoked), the row shows the translated error and the rest of the batch continues. The Save Changes button re-enables.

### Empty / loading states

- Step 1 empty → "No classes set up yet. Use **Manage Classes** to add one." with a button linking to the classes page.
- Step 2 empty → "This class has no sections yet." (rare — every class_group should have at least one section, but if onboarding is incomplete, don't crash).
- Step 3 empty → `<EmptyState>` "No students assigned to this section yet."
- Loading each step → SALCI's standard skeleton card pattern.

## UI compliance (SALCI design-system checklist)

- ✅ Sheet built with `MobileSheet` (NOT shadcn `Dialog`).
- ✅ All cards use `surface-card frosted-shadow rounded-card`.
- ✅ Headings `text-ink-900`, subtitles `text-ink-600`, eyebrow captions `.eyebrow`.
- ✅ Stat tiles for "X classes / Y sections / Z students" summary on each step use `<StatTile>` (`Tone="teal"`).
- ✅ Errors routed through `toastError(err, { fallback, context: "updateRollNumber" })`.
- ✅ 375 px mobile: Steps 1 + 2 cards stack to one column; Step 3 table collapses to `ListRow` (name on top, roll input below).
- ✅ Dark mode flips correctly because every colour goes through existing tokens.
- ✅ Form set `data-dirty="true"` while any draft differs from original, so the service worker doesn't auto-reload during edits.

## Concurrency rules (SALCI §23)

- ✅ Explicit column lists (no `select("*")`).
- ✅ Bounded queries (a section has bounded student count; no pagination needed but the underlying hook still applies `.eq("class_id", ...)`).
- ✅ `staleTime: 60_000` on every new `useQuery`.
- ✅ No `refetchInterval`.
- ✅ No `supabase.auth.getUser()` without a JWT argument.
- ✅ No new FK, no RLS change.

## Testing

Manual smoke (no automated tests in this iteration — frontend-only feature, no test infra precedent in this slice):

1. Open `/school/users` as `school_admin`. Open Update Details → click Update Roll Number → sheet opens.
2. Pick Class 8 → Section A.
3. Edit a few rolls. Introduce a duplicate. Save Changes disabled + banner shows.
4. Fix the duplicate. Save Changes enabled. Click. Watch each row turn green.
5. Introduce a sister-section conflict (manually set a Section A student's roll to a Section B student's roll for a multi-section class_group) — confirm row turns red with the translated message + Save Changes re-enables.
6. Close the sheet. Verify the Students table reflects the new rolls.
7. Toggle dark mode at each step — confirm everything flips.
8. At 375 px, walk through all three steps — confirm no horizontal scroll, table collapses to list rows.
9. Production build: `npm run typecheck && npx eslint src/components/school/UpdateRollNumberSheet.tsx src/hooks/useSectionStudentsForRoll.ts src/components/school/BulkUpdateStudentsDialog.tsx src/pages/school/SchoolStudentsPage.tsx && npx vite build`.

## Rollout

- No flag. The feature is purely additive to an existing admin-only dialog.
- No DB / edge changes, so deploy is a single frontend ship.

## Open questions

None — design is closed.
