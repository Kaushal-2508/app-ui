# Olympiad Super-Admin Restructure — Phase 2: Schools 3-Sub-Tab Scaffold + Onboarding Auto-Gen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat Schools tab into three internal sub-tabs (Onboard default / Olympiad in progress / Olympiad done), render onboarding inline, and make new-school onboarding auto-generate the institute code + school short code and surface the auto-created admin login.

**Architecture:** `OlympiadSchoolsTab` gains an internal `MobileTabs` strip; the campaign-year `Select` continues to scope all three. The Onboard sub-tab renders an extracted `OnboardSchoolForm` inline (no sheet) + a post-success `NewSchoolCredentialsPanel`. In/Done sub-tabs reuse `useOlympiadSchools` with a New-vs-Onboarded `FilterChip` and a **simple status split** (Phase 3 swaps this for the derived-stage RPC). The `oly-onboard-school` edge function auto-generates both codes server-side and returns the admin email + reset link.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, Supabase (PostgreSQL + Edge Functions/Deno), shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-superadmin-restructure-design.md](../specs/2026-05-27-olympiad-superadmin-restructure-design.md) (§4.1–§4.3, §6).

**Depends on:** Phase 1 (the `schools` route + two-tab shell). Compiles standalone if Phase 1 hasn't landed.

**No test infrastructure** — verify each task via §5a: `npx tsc --noEmit`, `npx eslint <touched>`, `npx vite build`. Edge-function change is verified by deploy + a manual onboard.

---

## Verified facts (read before starting)

- `MobileTabs` props: `value`, `onValueChange`, `options` (array of `{ value, label }`), `className`. (NOT `tabs`.)
- `FilterChip`/`FilterRow` (`src/components/shared/nav/FilterRow.tsx`): `<FilterChip label active onClick trailing? />` — active prop is **`active`**; it renders a trailing `ChevronDown` by default, so pass `trailing={null}` for plain toggle pills. `<FilterRow>{children}</FilterRow>`.
- `useOlympiadSchools(campaignId: string | undefined)` → `OlympiadSchoolRow[]`, where `OlympiadSchoolRow = { id, campaign_id, institution_id, institution_name, school_short_code, city: string|null, state: string|null, status: "enrollment_open"|"enrollment_closed"|"batches_scheduled"|"exam_in_progress"|"results_published"|"archived", is_existing_salci_school: boolean, enrolled_count: number, created_at }`. `staleTime: 30_000`.
- `SchoolListRow` (`<SchoolListRow school={OlympiadSchoolRow} />`) already routes to `/admin/olympiad/schools/${school.id}`. No change.
- `PublicPaymentLink` (`<PublicPaymentLink schoolShortCode={string} />`). No change.
- `useOlympiadCampaignsList()` exists (returns `[{ id, campaign_year, status }]`) and the current `OlympiadSchoolsTab` already uses it for the year `Select`. Reuse it.
- `useOnboardSchool` (`src/hooks/olympiad/useOnboardSchool.ts`): `OnboardSchoolInput` currently includes `institution_code?: string` + `school_short_code: string` (both REMOVED below); `OnboardSchoolResult` currently `{ oly_school_id, school_short_code, institution_id }` (WIDENED below). Calls `invokeEdgeFunction<OnboardSchoolResult>("oly-onboard-school", input)`; `onError` already routes through `toastError`; `onSuccess` invalidates `["olympiad","schools"]`.
- Edge fn `supabase/functions/oly-onboard-school/index.ts`: service-role client named `supabase`, CORS const `CORS`, `json(body,status)` helper, super-admin gate via `is_super_admin`. New-school branch already: creates `institutions` (with `code: body.institution_code.toUpperCase()`), enables `institution_features` olympiad flag, creates auth user + `profiles` + `user_roles` school_admin, generates a `type:"recovery"` link (`linkData.properties?.action_link`), sends a Resend welcome email. Existing-school branch upserts the olympiad feature flag. Both then insert `oly_schools` (with `body.school_short_code`) and return `{ oly_school_id, school_short_code, institution_id }`.
- Institute-code pattern (`src/components/admin/institution-wizard/InstitutionDetailsStep.tsx`): initials of up to 4 significant words + a 3-char base36 random suffix, uppercased.

---

## File Structure

- **Create** `src/components/olympiad/admin/OnboardSchoolForm.tsx` — onboarding form body lifted out of `OnboardSchoolSheet`, no MobileSheet wrapper, no institute-code/short-code fields, reports the full result via `onSuccess`.
- **Create** `src/components/olympiad/admin/NewSchoolCredentialsPanel.tsx` — surface card showing the new admin email + copy-able reset link + generated codes.
- **Modify** `src/hooks/olympiad/useOnboardSchool.ts` — drop `institution_code`/`school_short_code` from input; widen result.
- **Modify** `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx` — internal 3-sub-tab `MobileTabs`; Onboard renders the form inline; In/Done render filtered lists with New/Onboarded `FilterChip`.
- **Modify** `supabase/functions/oly-onboard-school/index.ts` — auto-generate both codes; return admin email + reset link + institute code.
- **Delete** `src/components/olympiad/admin/OnboardSchoolSheet.tsx` — after `OlympiadSchoolsTab` stops importing it.

---

## Task 1: Widen `useOnboardSchool`

**Files:** Modify `src/hooks/olympiad/useOnboardSchool.ts`

- [ ] **Step 1:** Replace the `OnboardSchoolInput` + `OnboardSchoolResult` types. Drop `institution_code` and `school_short_code` from input; widen result. Keep the mutationFn/onSuccess/onError bodies unchanged.

```ts
export type OnboardSchoolInput = {
  campaign_id: string;
  is_existing_salci_school: boolean;
  institution_id?: string;        // required when is_existing_salci_school
  school_name?: string;           // required when !is_existing_salci_school
  city?: string;
  state?: string;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  participating_grade_level_ids: string[];
  price_override_paise?: number | null;
  internal_notes?: string | null;
};

export type OnboardSchoolResult = {
  oly_school_id: string;
  institution_id: string;
  school_short_code: string;   // server-generated
  institute_code: string;      // server-generated (empty for existing schools)
  admin_email: string;         // empty for existing schools
  reset_link: string;          // empty for existing schools
};
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` will FLAG the old callers (`OnboardSchoolSheet`) that still pass `school_short_code`/`institution_code` — that's expected; they're replaced/removed in Tasks 3–4. Lint the hook file: `npx eslint src/hooks/olympiad/useOnboardSchool.ts`.
- [ ] **Step 3: Commit** — `git add src/hooks/olympiad/useOnboardSchool.ts && git commit -m "feat(olympiad): useOnboardSchool drops manual codes, widens result with admin creds"`

## Task 2: `NewSchoolCredentialsPanel`

**Files:** Create `src/components/olympiad/admin/NewSchoolCredentialsPanel.tsx`

- [ ] **Step 1: Create the panel.** Renders only when `reset_link` is non-empty (new schools). Copy buttons use `navigator.clipboard`.

```tsx
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardSchoolResult } from "@/hooks/olympiad/useOnboardSchool";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md bg-surface-card px-2.5 py-1.5 text-xs text-ink-800">{value}</code>
        <Button size="icon" variant="ghost" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4 text-brand-primary" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function NewSchoolCredentialsPanel({ result }: { result: OnboardSchoolResult }) {
  if (!result.reset_link) return null; // existing-school onboarding: nothing to surface
  return (
    <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
      <header>
        <p className="eyebrow">School admin login</p>
        <h3 className="text-base font-semibold text-ink-900">Share these with the school</h3>
        <p className="text-sm text-ink-600 mt-1">The admin sets their password via the reset link, then signs in at salci.org.</p>
      </header>
      <div className="space-y-3">
        <CopyField label="Admin email" value={result.admin_email} />
        <CopyField label="Password reset link" value={result.reset_link} />
        <CopyField label="Institute code" value={result.institute_code} />
        <CopyField label="School short code" value={result.school_short_code} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/components/olympiad/admin/NewSchoolCredentialsPanel.tsx`.
- [ ] **Step 3: Commit** — `git add src/components/olympiad/admin/NewSchoolCredentialsPanel.tsx && git commit -m "feat(olympiad): NewSchoolCredentialsPanel for post-onboard admin login"`

## Task 3: Extract `OnboardSchoolForm`

**Files:** Create `src/components/olympiad/admin/OnboardSchoolForm.tsx`

- [ ] **Step 1: Read `src/components/olympiad/admin/OnboardSchoolSheet.tsx` in full.** Lift its form body into a new `OnboardSchoolForm` component with this exact public API:

```tsx
type OnboardSchoolFormProps = {
  campaignId: string;
  onSuccess: (result: OnboardSchoolResult) => void;
};
```

Apply these changes during extraction:
1. **Remove** the `MobileSheet` wrapper — render the form fields directly in a `<form>` / `<div className="space-y-4">`.
2. **Remove** the school-short-code input + the "Suggest" button + any `shortCode` state and the `suggestShortCode()` helper.
3. **Remove** the institute-code input + any `institutionCode` state.
4. Keep: the new-vs-existing toggle, the existing-institution picker (`useOlympiadInstitutions` or whatever the sheet uses), school name (new), city/state, primary contact fields, the participating-grade multi-select, price override, internal notes.
5. The submit handler builds `OnboardSchoolInput` WITHOUT `school_short_code`/`institution_code`, calls `useOnboardSchool().mutateAsync(input)`, and on success calls `props.onSuccess(result)` and resets local form state. Errors are already handled by the hook's `onError` (`toastError`) — do not add a second toast.
6. If the original sheet had an `eslint-disable` on the autofill effect (it existed only because of the `shortCode` dependency), drop both the disable comment and the now-removed dependency so the effect deps are exhaustive-clean.
7. Use `campaignId` from props for `campaign_id` (do not re-derive the current campaign inside the form).

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/components/olympiad/admin/OnboardSchoolForm.tsx`.
- [ ] **Step 3: Commit** — `git add src/components/olympiad/admin/OnboardSchoolForm.tsx && git commit -m "feat(olympiad): OnboardSchoolForm (inline, no manual codes)"`

## Task 4: Rebuild `OlympiadSchoolsTab` with 3 sub-tabs

**Files:** Modify `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`; then delete `src/components/olympiad/admin/OnboardSchoolSheet.tsx`

- [ ] **Step 1: Read the current `OlympiadSchoolsTab.tsx`** (it has the campaign-year `Select` + the onboard sheet + a flat list). Rewrite it to:

```tsx
import { useState } from "react";
import { Loader2, Medal } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { FilterRow, FilterChip } from "@/components/shared/nav/FilterRow";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadCampaignsList } from "@/hooks/olympiad/useOlympiadCampaignsList";
import { useOlympiadSchools, type OlympiadSchoolRow } from "@/hooks/olympiad/useOlympiadSchools";
import { SchoolListRow } from "@/components/olympiad/admin/SchoolListRow";
import { OnboardSchoolForm } from "@/components/olympiad/admin/OnboardSchoolForm";
import { NewSchoolCredentialsPanel } from "@/components/olympiad/admin/NewSchoolCredentialsPanel";
import { PublicPaymentLink } from "@/components/olympiad/admin/PublicPaymentLink";
import type { OnboardSchoolResult } from "@/hooks/olympiad/useOnboardSchool";

const SUB_TABS = [
  { value: "onboard",     label: "Onboard school" },
  { value: "in_progress", label: "Olympiad in progress" },
  { value: "done",        label: "Olympiad done" },
] as const;

// Phase 2 simple split. Phase 3 replaces this with oly_schools_by_stage (derived stage).
const DONE_STATUSES = new Set(["results_published", "archived"]);

type SchoolType = "all" | "new" | "existing";

function filterByType(rows: OlympiadSchoolRow[], type: SchoolType) {
  if (type === "all") return rows;
  const wantExisting = type === "existing";
  return rows.filter((r) => r.is_existing_salci_school === wantExisting);
}

export default function OlympiadSchoolsTab() {
  const { data: campaigns } = useOlympiadCampaignsList();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const campaignId = selectedCampaignId ?? campaigns?.[0]?.id;

  const [sub, setSub] = useState<string>("onboard");
  const [type, setType] = useState<SchoolType>("all");
  const [onboardResult, setOnboardResult] = useState<OnboardSchoolResult | null>(null);

  const { data: schools, isLoading } = useOlympiadSchools(campaignId);
  const inProgress = filterByType((schools ?? []).filter((s) => !DONE_STATUSES.has(s.status)), type);
  const done = filterByType((schools ?? []).filter((s) => DONE_STATUSES.has(s.status)), type);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Schools</p>
        <Select value={campaignId ?? ""} onValueChange={setSelectedCampaignId}>
          <SelectTrigger className="h-9 w-auto min-w-[9rem]"><SelectValue placeholder="Campaign" /></SelectTrigger>
          <SelectContent>
            {(campaigns ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.campaign_year}{c.status === "archived" ? " (archived)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <MobileTabs
        value={sub}
        onValueChange={setSub}
        options={SUB_TABS.map((t) => ({ value: t.value, label: t.label }))}
      />

      {sub === "onboard" && (
        <div className="space-y-4">
          {campaignId ? (
            <OnboardSchoolForm campaignId={campaignId} onSuccess={setOnboardResult} />
          ) : (
            <EmptyState icon={<Medal className="h-7 w-7" />} title="No campaign" description="Create a campaign first." />
          )}
          {onboardResult && (
            <>
              <PublicPaymentLink schoolShortCode={onboardResult.school_short_code} />
              <NewSchoolCredentialsPanel result={onboardResult} />
            </>
          )}
        </div>
      )}

      {(sub === "in_progress" || sub === "done") && (
        <div className="space-y-3">
          <FilterRow>
            <FilterChip label="All" active={type === "all"} onClick={() => setType("all")} trailing={null} />
            <FilterChip label="New schools" active={type === "new"} onClick={() => setType("new")} trailing={null} />
            <FilterChip label="Onboarded" active={type === "existing"} onClick={() => setType("existing")} trailing={null} />
          </FilterRow>

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
          ) : (() => {
            const rows = sub === "in_progress" ? inProgress : done;
            if (rows.length === 0) {
              return (
                <EmptyState
                  icon={<Medal className="h-7 w-7" />}
                  title={sub === "in_progress" ? "No schools in progress" : "No completed schools yet"}
                  description={sub === "in_progress" ? "Onboard a school to get started." : "Schools appear here once their Olympiad finishes."}
                />
              );
            }
            return <div className="space-y-2">{rows.map((s) => <SchoolListRow key={s.id} school={s} />)}</div>;
          })()}
        </div>
      )}
    </div>
  );
}
```

> If `FilterChip` rejects `trailing={null}` typewise, read `FilterRow.tsx` and pass whatever suppresses the chevron (the verified prop is `trailing`). If `useOlympiadCampaignsList` is not the hook the current file imports for the year select, use the one it already imports.

- [ ] **Step 2:** Once the tab no longer imports `OnboardSchoolSheet`, delete it: `git rm src/components/olympiad/admin/OnboardSchoolSheet.tsx`. Grep for stragglers: `grep -rn "OnboardSchoolSheet" src`.
- [ ] **Step 3: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`, `npx vite build`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(olympiad): schools 3 sub-tabs (onboard inline / in-progress / done) + New/Onboarded filter"`

## Task 5: Onboarding auto-generation (edge function)

**Files:** Modify `supabase/functions/oly-onboard-school/index.ts`

- [ ] **Step 1: Add two generator helpers** near the top (after the `CORS` const):

```ts
function generateInstituteCode(name: string): string {
  const stop = new Set(["the", "of", "and", "school", "academy", "public", "international"]);
  const words = name.toLowerCase().split(/\s+/).filter((w) => w && !stop.has(w));
  const initials = (words.length ? words.slice(0, 4).map((w) => w[0]) : name.slice(0, 3).split(""))
    .join("").toUpperCase();
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  return (initials + suffix).slice(0, 12);
}

function generateShortCode(name: string): string {
  const alnum = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const head = (alnum.slice(0, 3) || "SCH").padEnd(3, "X");
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "0");
  return (head + rand).slice(0, 6);
}

// Retry an insert-bound code until it is unique (bounded attempts).
async function uniqueCode(
  // deno-lint-ignore no-explicit-any
  client: any, table: string, column: string, gen: () => string, attempts = 12,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const code = gen();
    const { data } = await client.from(table).select(column).eq(column, code).maybeSingle();
    if (!data) return code;
  }
  throw new Error(`Could not generate a unique ${column} after ${attempts} attempts`);
}
```

> If the file's eslint/Deno config rejects `// deno-lint-ignore`, type `client` with the structural `AdminSupabase` shape used elsewhere in the Olympiad functions instead of `any`.

- [ ] **Step 2: Remove the manual-code validation + requirement.** Delete the `if (!/^[A-Z0-9]{6}$/.test(body.school_short_code))` block. In the new-school branch, change the requirement check from `!body.school_name || !body.institution_code` to just `!body.school_name`.

- [ ] **Step 3: Generate the institute code for new schools.** Replace `code: body.institution_code.toUpperCase()` in the `institutions` insert with:

```ts
code: await uniqueCode(supabase, "institutions", "code", () => generateInstituteCode(body.school_name!)),
```

Capture it in a variable so it can be returned: declare `let instituteCode = "";` before the branch; in the new branch set `instituteCode = <the generated value>` (generate once into a const, use it in the insert and the return). For the existing-school branch, fetch the linked institution's code: `const { data: instRow } = await supabase.from("institutions").select("code").eq("id", institutionId).single(); instituteCode = instRow?.code ?? "";`

- [ ] **Step 4: Generate the short code (both branches).** Resolve a display name first: for new schools use `body.school_name!`; for existing, use the fetched institution name (`select("code, name")`). Then:

```ts
const shortCode = await uniqueCode(supabase, "oly_schools", "school_short_code", () => generateShortCode(displayName));
```

Use `shortCode` in the `oly_schools` insert (`school_short_code: shortCode`) instead of `body.school_short_code.toUpperCase()`.

- [ ] **Step 5: Capture the reset link + admin email.** In the new-school branch, after `generateLink`, set `adminEmail = body.primary_contact_email` and `resetLink = linkData?.properties?.action_link ?? ""`. Declare `let adminEmail = ""; let resetLink = "";` before the branch.

- [ ] **Step 6: Return the widened body:**

```ts
return json({
  oly_school_id: olySchool.id,
  institution_id: institutionId,
  school_short_code: olySchool.school_short_code,
  institute_code: instituteCode,
  admin_email: adminEmail,
  reset_link: resetLink,
}, 200);
```

- [ ] **Step 7: Update the `Payload` type** — remove `institution_code` and `school_short_code`.
- [ ] **Step 8: Deploy** (verification for edge functions): `npx supabase@latest functions deploy oly-onboard-school --project-ref gyymkgohcijeksmrzuyw`. A clean deploy + a manual onboard of a test new school (admin email arrives, codes auto-fill, login works) is the acceptance check.
- [ ] **Step 9: Commit** — `git add supabase/functions/oly-onboard-school/ && git commit -m "feat(olympiad): auto-generate institute + short codes; return admin login on onboard"`

## Task 6: Manual smoke

- [ ] As super_admin → `/admin/olympiad/schools`: lands on **Onboard school** sub-tab with the inline form (no short-code/institute-code fields).
- [ ] Onboard a NEW school → success shows the public payment link + the credentials panel (admin email + reset link + both generated codes). The reset link signs the admin in at salci.org.
- [ ] Onboard an EXISTING SALCI school → no credentials panel (reset link empty); the school's existing admins get the Olympiad sidebar entry.
- [ ] In-progress / Done sub-tabs list correctly; New/Onboarded filter narrows; rows open the detail route.

---

## Self-review

- **Spec coverage:** §4.1 (Tasks 2,3,4), §4.2/§4.3 (Task 4 — simple status split; Phase 3 refines), §6 (Tasks 1,2,5). Covered.
- **Placeholders:** none — complete code for new units + hook/edge changes; Task 3 is a precise extraction (instructed to read the source sheet first because its full body wasn't inlined here).
- **Consistency:** `OnboardSchoolResult` shape + `OnboardSchoolForm` API match SHARED CONTRACTS and Phase 3's expectations. The `DONE_STATUSES` split is explicitly flagged for Phase 3 replacement by `oly_schools_by_stage`.
- **§23:** `useOlympiadSchools` keeps its `staleTime`; edge fn paginates nothing new; code generators are bounded-retry.
