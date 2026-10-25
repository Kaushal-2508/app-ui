# Student Report PDF + Institution Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate Report" button on the student-dashboard page that downloads a true vector PDF of the student's full performance + learning passport. Also build a first-class institution-logo system (super-admin upload, schema, storage, sidebar/topbar consumers) that the PDF and the rest of the app can reuse.

**Architecture:** Two phases in one branch.
**Phase 1** — `institutions.logo_url` column + `institution-logos` storage bucket (super_admin write, public read) + a `useInstitutionLogo` reader hook + an upload/remove pair of mutation hooks + an `InstitutionLogoUploader` UI tile in `InstitutionsPage`.
**Phase 2** — wire the logo into the topbar (`AppLayout`) and the sidebar's managed-institution banner (`AppSidebar`); add `src/lib/pdf/` (pure module, no React/Supabase) consisting of `pdfTheme.ts`, `pdfPrimitives.ts`, `studentReport.ts`; add a "Generate Report" button to `StudentPerformancePage` that pre-loads logos, calls the generator, and saves the PDF.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Supabase (PostgreSQL + Storage), `jspdf` (already a dep — true vector PDF). No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-04-27-student-report-pdf-and-institution-logo-design.md](../specs/2026-04-27-student-report-pdf-and-institution-logo-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20260427120001_institution_logo.sql` | Create | Adds `logo_url` to `institutions`, creates/upserts `institution-logos` bucket, sets RLS policies. |
| `src/hooks/useInstitutionLogo.ts` | Create | Reader hook: `(institutionId) → { logoUrl, isLoading }`. Never throws. |
| `src/hooks/useUploadInstitutionLogo.ts` | Create | Mutation hook + sibling `useRemoveInstitutionLogo`. Validates → uploads → updates column → invalidates. |
| `src/components/admin/InstitutionLogoUploader.tsx` | Create | UI tile: thumbnail + Upload/Replace/Remove. Used inside each institution card. |
| `src/pages/admin/InstitutionsPage.tsx` | Modify | Render `<InstitutionLogoUploader />` in each card; extend the institutions query to select `logo_url`. |
| `src/components/layout/AppLayout.tsx` | Modify | Extend the `header-institution` query to select `logo_url`; render thumbnail + name in the topbar. |
| `src/components/layout/AppSidebar.tsx` | Modify | In the super-admin "Managing as Admin" banner, replace the `Building2` placeholder with the institution logo when available. |
| `src/lib/pdf/pdfTheme.ts` | Create | Palette, fonts, page geometry constants. |
| `src/lib/pdf/pdfPrimitives.ts` | Create | `drawHeader`, `drawFooter`, `drawSectionTitle`, `drawKVRow`, `drawTable`, `drawProgressBar`, `ensureRoom`. |
| `src/lib/pdf/studentReport.ts` | Create | `generateStudentReport(input): Promise<void>` — builds and saves the PDF. |
| `src/pages/school/StudentPerformancePage.tsx` | Modify | Add "Generate Report" button; pre-load logos; call `generateStudentReport`. |

No file deletions. All new files keep one clear responsibility.

---

## Task 1: Migration — `institutions.logo_url` + bucket + RLS + types update

**Why:** Schema is the foundation; everything else reads/writes through these. The auto-generated `src/integrations/supabase/types.ts` is hand-updated in the same task because the live `db:push` is deferred to Task 11 (the user's call), and without updating types, every later task type-checks fails.

**Files:**
- Create: `supabase/migrations/20260427120001_institution_logo.sql`
- Modify: `src/integrations/supabase/types.ts` (add `logo_url` to the `institutions` Row/Insert/Update shapes)

**Verification commands (used by later tasks too):**
- `npm run build` — runs `vite build` which type-checks the whole frontend; this is the project's de-facto typecheck.
- `npm run db:push` — applies pending migrations. **Do NOT run from the subagent** — this hits a live database. The user runs it manually as part of Task 11.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260427120001_institution_logo.sql`:

```sql
-- Phase 1: Institution logo management.
-- Adds a nullable logo_url column on institutions and provisions a storage
-- bucket for the uploaded files. Public read so any frontend surface can
-- render the logo without auth headers; super_admin only on writes.

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('institution-logos', 'institution-logos', true, 2097152) -- 2 MB
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "view_institution_logos" ON storage.objects;
CREATE POLICY "view_institution_logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'institution-logos');

DROP POLICY IF EXISTS "upload_institution_logos" ON storage.objects;
CREATE POLICY "upload_institution_logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'institution-logos'
    AND public.has_role(auth.uid(), 'super_admin'::app_role)
  );

DROP POLICY IF EXISTS "update_institution_logos" ON storage.objects;
CREATE POLICY "update_institution_logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'institution-logos'
    AND public.has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'institution-logos'
    AND public.has_role(auth.uid(), 'super_admin'::app_role)
  );

DROP POLICY IF EXISTS "delete_institution_logos" ON storage.objects;
CREATE POLICY "delete_institution_logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'institution-logos'
    AND public.has_role(auth.uid(), 'super_admin'::app_role)
  );
```

- [ ] **Step 2: Update generated supabase types**

Open `src/integrations/supabase/types.ts`. Find the `institutions` block (around line 3520). It looks like:

```ts
      institutions: {
        Row: {
          address: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean | null
          max_admins: number | null
          name: string
          updated_at: string
        }
        Insert: { /* same shape, optionals */ }
        Update: { /* same shape, all optionals */ }
        Relationships: []
      }
```

Add `logo_url: string | null` to the `Row` shape and `logo_url?: string | null` to both the `Insert` and `Update` shapes (alphabetized — between `is_active` and `max_admins`):

```ts
      institutions: {
        Row: {
          address: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean | null
          logo_url: string | null
          max_admins: number | null
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          max_admins?: number | null
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          max_admins?: number | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 3: Verify the build still type-checks**

Run: `npm run build`
Expected: build completes; no TS errors. (The migration SQL itself is not type-checked — the types.ts edit is what matters here.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260427120001_institution_logo.sql src/integrations/supabase/types.ts
git commit -m "feat(db): add institutions.logo_url + institution-logos bucket"
```

(Live database push via `npm run db:push` is deferred to Task 11 manual verification — the user applies it.)

---

## Task 2: Reader hook — `useInstitutionLogo`

**Why:** A single source of truth for "does this institution have a logo, and where is it." Every consumer (topbar, sidebar, PDF) goes through this.

**Files:**
- Create: `src/hooks/useInstitutionLogo.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useInstitutionLogo.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reads institutions.logo_url for the given id.
 * Returns { logoUrl: null } when the column is null OR the row is unreadable.
 * Never throws — consumers fall back silently to text-only branding.
 */
export function useInstitutionLogo(institutionId: string | null | undefined): {
  logoUrl: string | null;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ["institution-logo", institutionId],
    queryFn: async (): Promise<string | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("institutions")
        .select("logo_url")
        .eq("id", institutionId)
        .maybeSingle();
      if (error) return null;
      return data?.logo_url ?? null;
    },
    enabled: !!institutionId,
    staleTime: 5 * 60 * 1000, // 5 min — logos change rarely
  });

  return {
    logoUrl: query.data ?? null,
    isLoading: query.isLoading,
  };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: build completes; no TS errors mentioning `useInstitutionLogo.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useInstitutionLogo.ts
git commit -m "feat(hooks): add useInstitutionLogo reader hook"
```

---

## Task 3: Mutation hooks — upload + remove

**Why:** Uploads must be validated, the storage object and DB column kept in sync, and errors routed through `toastError` per CLAUDE.md §19.

**Files:**
- Create: `src/hooks/useUploadInstitutionLogo.ts`

- [ ] **Step 1: Write the hooks**

Create `src/hooks/useUploadInstitutionLogo.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError, toastSuccess } from "@/lib/toast";

const BUCKET = "institution-logos";
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

function extFor(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  return "png";
}

export class LogoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogoValidationError";
  }
}

export function useUploadInstitutionLogo() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ institutionId, file }: { institutionId: string; file: File }) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new LogoValidationError("Logo must be a PNG, JPG, or WebP image.");
      }
      if (file.size > MAX_BYTES) {
        throw new LogoValidationError("Logo must be 2 MB or smaller.");
      }

      const path = `${institutionId}/logo.${extFor(file)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      // Cache-bust so the new logo replaces a previously cached one.
      const url = `${pub.publicUrl}?v=${Date.now()}`;

      const { error: dbError } = await supabase
        .from("institutions")
        .update({ logo_url: url })
        .eq("id", institutionId);

      if (dbError) {
        // Best-effort cleanup of the orphaned storage object.
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw dbError;
      }

      return url;
    },
    onSuccess: (_url, { institutionId }) => {
      toastSuccess("Logo updated");
      qc.invalidateQueries({ queryKey: ["institution-logo", institutionId] });
      qc.invalidateQueries({ queryKey: ["admin-institutions"] });
      qc.invalidateQueries({ queryKey: ["header-institution"] });
    },
    onError: (e: Error) => {
      if (e instanceof LogoValidationError) {
        // Surface validation errors as inline form messages — no toast.
        return;
      }
      toastError(e, { fallback: "Couldn't upload logo.", context: "uploadInstitutionLogo" });
    },
  });
}

export function useRemoveInstitutionLogo() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ institutionId }: { institutionId: string }) => {
      // Fetch current url so we can derive the storage path.
      const { data: row } = await supabase
        .from("institutions")
        .select("logo_url")
        .eq("id", institutionId)
        .maybeSingle();

      const { error: dbError } = await supabase
        .from("institutions")
        .update({ logo_url: null })
        .eq("id", institutionId);
      if (dbError) throw dbError;

      // Try to derive object path from the URL: .../institution-logos/{id}/logo.{ext}?v=...
      if (row?.logo_url) {
        const match = row.logo_url.match(/institution-logos\/([^?]+)/);
        if (match?.[1]) {
          await supabase.storage.from(BUCKET).remove([match[1]]).catch(() => {});
        }
      }
    },
    onSuccess: (_v, { institutionId }) => {
      toastSuccess("Logo removed");
      qc.invalidateQueries({ queryKey: ["institution-logo", institutionId] });
      qc.invalidateQueries({ queryKey: ["admin-institutions"] });
      qc.invalidateQueries({ queryKey: ["header-institution"] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't remove logo.", context: "removeInstitutionLogo" }),
  });
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: build completes; no TS errors mentioning `useUploadInstitutionLogo.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUploadInstitutionLogo.ts
git commit -m "feat(hooks): add useUploadInstitutionLogo + useRemoveInstitutionLogo"
```

---

## Task 4: `InstitutionLogoUploader` component + wire into `InstitutionsPage`

**Why:** The super admin needs a visible affordance per institution to upload/replace/remove a logo.

**Files:**
- Create: `src/components/admin/InstitutionLogoUploader.tsx`
- Modify: `src/pages/admin/InstitutionsPage.tsx`

- [ ] **Step 1: Build the uploader component**

Create `src/components/admin/InstitutionLogoUploader.tsx`:

```tsx
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Building2, Upload, X } from "lucide-react";
import {
  useUploadInstitutionLogo,
  useRemoveInstitutionLogo,
  LogoValidationError,
} from "@/hooks/useUploadInstitutionLogo";

interface Props {
  institutionId: string;
  logoUrl: string | null;
  institutionName: string;
}

export function InstitutionLogoUploader({ institutionId, logoUrl, institutionName }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const upload = useUploadInstitutionLogo();
  const remove = useRemoveInstitutionLogo();

  const initials = institutionName
    .split(" ")
    .map(n => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setValidationError(null);
    upload.mutate(
      { institutionId, file },
      {
        onError: (err) => {
          if (err instanceof LogoValidationError) {
            setValidationError(err.message);
          }
        },
      },
    );
  };

  const isPending = upload.isPending || remove.isPending;

  return (
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 rounded-xl border bg-muted/50 overflow-hidden flex items-center justify-center flex-shrink-0">
        {logoUrl ? (
          <img src={logoUrl} alt={`${institutionName} logo`} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground">
            {initials || <Building2 className="h-5 w-5" />}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isPending}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {logoUrl ? "Replace" : "Upload"}
          </Button>
          {logoUrl && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => remove.mutate({ institutionId })}
              disabled={isPending}
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Remove
            </Button>
          )}
        </div>
        {validationError ? (
          <p className="text-xs text-destructive">{validationError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">PNG/JPG/WebP, ≤ 2 MB, square ≥ 256×256.</p>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire into `InstitutionsPage`**

Open [src/pages/admin/InstitutionsPage.tsx](../../../src/pages/admin/InstitutionsPage.tsx).

Add the import near the other `@/components/admin/...` imports (around line 47):

```tsx
import { InstitutionLogoUploader } from "@/components/admin/InstitutionLogoUploader";
```

Extend the institutions query select (line 83) to include `logo_url`:

```tsx
.select(`
  id, name, code, is_active, contact_email, contact_phone, address, created_at, logo_url,
  institution_subscriptions (plan_name, status, monthly_amount)
`)
```

In the card body, render the uploader. Replace the existing `<CardContent>` block (currently lines ~285–304) with one that adds the uploader **above** the address line:

```tsx
<CardContent>
  <div className="mb-4">
    <InstitutionLogoUploader
      institutionId={institution.id}
      logoUrl={institution.logo_url ?? null}
      institutionName={institution.name}
    />
  </div>
  <p className="text-sm text-muted-foreground mb-4 line-clamp-1">{institution.address || "No address"}</p>
  <div className="grid grid-cols-3 gap-2 text-center">
    <div className="p-2 bg-muted/50 rounded-xl">
      <GraduationCap className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
      <p className="text-lg font-semibold">{institution.stats.teachers}</p>
      <p className="text-xs text-muted-foreground">Teachers</p>
    </div>
    <div className="p-2 bg-muted/50 rounded-xl">
      <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
      <p className="text-lg font-semibold">{institution.stats.students}</p>
      <p className="text-xs text-muted-foreground">Students</p>
    </div>
    <div className="p-2 bg-muted/50 rounded-xl">
      <FileText className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
      <p className="text-lg font-semibold">{institution.stats.exams}</p>
      <p className="text-xs text-muted-foreground">Exams</p>
    </div>
  </div>
</CardContent>
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Manual smoke test**

1. `npm run dev`.
2. Sign in as `bhan@salci.in` (super_admin).
3. Navigate to `/admin/institutions`.
4. On any institution card, click **Upload**, select a small PNG. Confirm the thumbnail updates and a green "Logo updated" toast appears.
5. Click **Replace**, pick a different image. Thumbnail swaps.
6. Click **Remove**. Thumbnail reverts to initials.
7. Try a 5 MB file — confirm inline error "Logo must be 2 MB or smaller." (no toast).
8. Try a `.gif` — confirm inline error "Logo must be a PNG, JPG, or WebP image."

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/InstitutionLogoUploader.tsx src/pages/admin/InstitutionsPage.tsx
git commit -m "feat(admin): institution logo uploader on InstitutionsPage"
```

---

## Task 5: Wire logo into the topbar (`AppLayout`)

**Why:** This is the most visible chrome surface — every authenticated user sees the topbar's school name. Adding the logo here gives the institution-logo system its first real consumer.

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Extend the header query**

Open [src/components/layout/AppLayout.tsx](../../../src/components/layout/AppLayout.tsx). Replace lines 47–71 (the `["header-institution", user?.id]` query) with:

```tsx
  // Fetch institution name + logo for the topbar
  const { data: institution } = useQuery({
    queryKey: ["header-institution", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .single();

      if (!profile?.institution_id) return null;

      const { data: institutionData } = await supabase
        .from("institutions")
        .select("name, logo_url")
        .eq("id", profile.institution_id)
        .single();

      return institutionData;
    },
    enabled: !!user?.id,
  });
```

- [ ] **Step 2: Render thumbnail + name**

Replace the existing topbar title block (currently lines 143–148) with:

```tsx
              <div className="hidden sm:flex items-center gap-2">
                {institution?.logo_url && (
                  <img
                    src={institution.logo_url}
                    alt=""
                    className="h-7 w-7 rounded-md object-cover border"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <h1 className="text-lg font-semibold">{headerTitle}</h1>
              </div>
```

`headerTitle` (line 74) is unchanged: `institution?.name || "SALCI"`.

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Manual smoke test**

1. Sign in as a school_admin of an institution with a logo set in Task 4. Confirm the logo + name appear in the topbar.
2. Sign in as a school_admin of an institution with NO logo set. Confirm name still appears, no broken-image artifact.
3. Sign in as super_admin (no institution). Confirm topbar shows "SALCI" with no logo.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat(layout): institution logo in the topbar"
```

---

## Task 6: Wire logo into the sidebar's "Managing as Admin" banner

**Why:** When a super admin is managing an institution, the sidebar banner shows the institution name with a generic Building2 icon. Swapping that for the actual logo makes the management context unmistakable.

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Read the current managed-institution banner**

Open [src/components/layout/AppSidebar.tsx](../../../src/components/layout/AppSidebar.tsx) and locate the block that starts at line 642 (`managedInstitution ? (`) and ends at line 681 (just before the `: (`).

- [ ] **Step 2: Add the hook + render the logo**

Add the import at the top of the file (next to the other `@/hooks/...` imports, around line 6):

```tsx
import { useInstitutionLogo } from "@/hooks/useInstitutionLogo";
```

Inside `AppSidebar()` (after the existing context hook calls — near line 117), call:

```tsx
  const { logoUrl: managedLogoUrl } = useInstitutionLogo(
    isManagingInstitution ? managedInstitution?.id : null,
  );
```

Replace the icon `div` inside the banner (currently lines 645–647 — the `<div className="h-8 w-8 rounded-lg bg-orange-500 flex items-center justify-center"><Building2 ... /></div>`) with:

```tsx
              <div className="h-8 w-8 rounded-lg bg-orange-500 flex items-center justify-center overflow-hidden">
                {managedLogoUrl ? (
                  <img
                    src={managedLogoUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <Building2 className="h-4 w-4 text-white" />
                )}
              </div>
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Manual smoke test**

1. Sign in as super_admin. Go to `/admin/institutions`. Click "Access as Admin" on an institution that has a logo set. Confirm the sidebar banner now shows the institution's logo (not Building2).
2. Click "Access as Admin" on an institution with NO logo. Confirm banner falls back to Building2.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppSidebar.tsx
git commit -m "feat(sidebar): show institution logo in Managing as Admin banner"
```

---

## Task 7: PDF theme + drawing primitives

**Why:** Centralizes layout constants and pure drawing helpers so `studentReport.ts` reads as a sequence of "draw section X" calls instead of inline geometry math.

**Files:**
- Create: `src/lib/pdf/pdfTheme.ts`
- Create: `src/lib/pdf/pdfPrimitives.ts`

- [ ] **Step 1: Write `pdfTheme.ts`**

Create `src/lib/pdf/pdfTheme.ts`:

```ts
// All units in millimetres. A4 portrait is 210 × 297.
export const PDF_THEME = {
  page: {
    width: 210,
    height: 297,
    marginX: 18,
    marginTop: 22,
    marginBottom: 18,
  },
  colors: {
    primary: "#249ca2",
    accent: "#fa920e",
    text: "#1f2937",
    muted: "#6b7280",
    border: "#e5e7eb",
    bandFill: "#f3f7f7",
    bucket: {
      mastered: "#10b981",   // > 80
      proficient: "#3b82f6", // 60–80
      developing: "#f59e0b", // 40–60
      needsWork: "#ef4444",  // < 40
    },
  },
  font: {
    family: "helvetica",
    sizes: {
      title: 22,
      h1: 16,
      h2: 12,
      body: 10,
      small: 8,
    },
    lineHeight: 1.4,
  },
  header: {
    logoMaxHeight: 14,
  },
} as const;

export type PdfTheme = typeof PDF_THEME;
```

- [ ] **Step 2: Write `pdfPrimitives.ts`**

Create `src/lib/pdf/pdfPrimitives.ts`:

```ts
import type jsPDF from "jspdf";
import { PDF_THEME } from "./pdfTheme";

const T = PDF_THEME;

export interface PdfContext {
  doc: jsPDF;
  cursorY: number;          // current draw y (mm)
  pageNumber: number;
  schoolName: string;
  salciLogoDataUrl: string;
  schoolLogoDataUrl: string | null;
  generatedDate: string;    // pre-formatted "Apr 27, 2026"
}

export function drawHeader(ctx: PdfContext): void {
  const { doc, salciLogoDataUrl, schoolLogoDataUrl, schoolName } = ctx;

  const logoY = 8;
  // SALCI logo top-left
  if (salciLogoDataUrl) {
    try {
      doc.addImage(salciLogoDataUrl, "PNG", T.page.marginX, logoY, 0, T.header.logoMaxHeight);
    } catch { /* ignore: bad image */ }
  }

  // School logo top-right + name to its left, OR name alone if no logo
  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.body);
  doc.setTextColor(T.colors.text);

  const rightEdge = T.page.width - T.page.marginX;

  if (schoolLogoDataUrl) {
    try {
      const logoW = T.header.logoMaxHeight; // assume square
      const logoX = rightEdge - logoW;
      doc.addImage(schoolLogoDataUrl, "PNG", logoX, logoY, logoW, T.header.logoMaxHeight);
      doc.text(schoolName, logoX - 2, logoY + T.header.logoMaxHeight / 2 + 2, { align: "right" });
    } catch {
      doc.text(schoolName, rightEdge, logoY + T.header.logoMaxHeight / 2 + 2, { align: "right" });
    }
  } else {
    doc.text(schoolName, rightEdge, logoY + T.header.logoMaxHeight / 2 + 2, { align: "right" });
  }

  // Accent rule
  const ruleY = logoY + T.header.logoMaxHeight + 2;
  doc.setDrawColor(T.colors.primary);
  doc.setLineWidth(0.6);
  doc.line(T.page.marginX, ruleY, rightEdge, ruleY);
  doc.setDrawColor(T.colors.border);
  doc.setLineWidth(0.2);

  ctx.cursorY = ruleY + 6;
}

export function drawFooter(ctx: PdfContext, totalPages: number): void {
  const { doc, generatedDate, pageNumber } = ctx;
  const y = T.page.height - 8;

  doc.setFont(T.font.family, "normal");
  doc.setFontSize(T.font.sizes.small);
  doc.setTextColor(T.colors.muted);

  doc.text("Confidential — for internal use", T.page.marginX, y);
  doc.text(
    `Generated ${generatedDate} • Page ${pageNumber} of ${totalPages}`,
    T.page.width - T.page.marginX,
    y,
    { align: "right" },
  );
}

export function ensureRoom(ctx: PdfContext, neededHeight: number): void {
  const limit = T.page.height - T.page.marginBottom - 4;
  if (ctx.cursorY + neededHeight > limit) {
    ctx.doc.addPage();
    ctx.pageNumber += 1;
    drawHeader(ctx);
  }
}

export function drawSectionTitle(ctx: PdfContext, label: string): void {
  ensureRoom(ctx, 14);
  const { doc, cursorY } = ctx;

  // Teal accent bar
  doc.setFillColor(T.colors.primary);
  doc.rect(T.page.marginX, cursorY - 4, 2, 7, "F");

  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.h1);
  doc.setTextColor(T.colors.text);
  doc.text(label, T.page.marginX + 5, cursorY + 1);

  ctx.cursorY = cursorY + 8;
}

export function drawKVRow(
  ctx: PdfContext,
  pairs: { label: string; value: string }[],
  cols = 2,
): void {
  const { doc } = ctx;
  const totalWidth = T.page.width - T.page.marginX * 2;
  const colWidth = totalWidth / cols;
  const rowHeight = 8;
  const rows = Math.ceil(pairs.length / cols);
  ensureRoom(ctx, rows * rowHeight + 2);

  pairs.forEach((p, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = T.page.marginX + c * colWidth;
    const y = ctx.cursorY + r * rowHeight;

    doc.setFont(T.font.family, "normal");
    doc.setFontSize(T.font.sizes.small);
    doc.setTextColor(T.colors.muted);
    doc.text(p.label, x, y);

    doc.setFont(T.font.family, "bold");
    doc.setFontSize(T.font.sizes.body);
    doc.setTextColor(T.colors.text);
    doc.text(p.value, x, y + 4);
  });

  ctx.cursorY += rows * rowHeight + 2;
}

export interface TableColumn<Row> {
  header: string;
  width: number;                                          // proportion (sum to 1.0)
  align?: "left" | "right" | "center";
  render: (row: Row) => string;
}

export function drawTable<Row>(
  ctx: PdfContext,
  columns: TableColumn<Row>[],
  rows: Row[],
  emptyText = "No data.",
): void {
  const { doc } = ctx;
  const totalWidth = T.page.width - T.page.marginX * 2;
  const headerHeight = 7;
  const rowHeight = 6;

  if (rows.length === 0) {
    ensureRoom(ctx, 8);
    doc.setFont(T.font.family, "italic");
    doc.setFontSize(T.font.sizes.body);
    doc.setTextColor(T.colors.muted);
    doc.text(emptyText, T.page.marginX, ctx.cursorY);
    ctx.cursorY += 6;
    return;
  }

  // Header band
  ensureRoom(ctx, headerHeight + rowHeight);
  doc.setFillColor(T.colors.bandFill);
  doc.rect(T.page.marginX, ctx.cursorY - 4, totalWidth, headerHeight, "F");
  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.small);
  doc.setTextColor(T.colors.text);

  let x = T.page.marginX;
  columns.forEach(col => {
    const w = totalWidth * col.width;
    const tx = col.align === "right" ? x + w - 2 : col.align === "center" ? x + w / 2 : x + 2;
    doc.text(col.header, tx, ctx.cursorY + 1, { align: col.align ?? "left" });
    x += w;
  });
  ctx.cursorY += headerHeight;

  // Rows
  doc.setFont(T.font.family, "normal");
  doc.setFontSize(T.font.sizes.body);
  rows.forEach((row, idx) => {
    ensureRoom(ctx, rowHeight);
    if (idx % 2 === 1) {
      doc.setFillColor("#fafafa");
      doc.rect(T.page.marginX, ctx.cursorY - 4, totalWidth, rowHeight, "F");
    }
    let cx = T.page.marginX;
    columns.forEach(col => {
      const w = totalWidth * col.width;
      const tx = col.align === "right" ? cx + w - 2 : col.align === "center" ? cx + w / 2 : cx + 2;
      const value = col.render(row);
      // Truncate to fit cell width (rough: 1mm ~ 1.8 chars at 10pt helvetica)
      const maxChars = Math.floor(w / 1.8);
      const display = value.length > maxChars ? value.slice(0, maxChars - 1) + "…" : value;
      doc.setTextColor(T.colors.text);
      doc.text(display, tx, ctx.cursorY + 1, { align: col.align ?? "left" });
      cx += w;
    });
    ctx.cursorY += rowHeight;
  });
  ctx.cursorY += 2;
}

export function drawProgressBar(
  ctx: PdfContext,
  label: string,
  value: number,           // 0–100
  trend: "improving" | "declining" | null,
): void {
  const rowHeight = 7;
  ensureRoom(ctx, rowHeight + 1);
  const { doc } = ctx;
  const totalWidth = T.page.width - T.page.marginX * 2;
  const barX = T.page.marginX + 110;
  const barWidth = T.page.width - T.page.marginX - barX - 20;

  // Label
  doc.setFont(T.font.family, "normal");
  doc.setFontSize(T.font.sizes.body);
  doc.setTextColor(T.colors.text);
  const maxLabelChars = 60;
  const labelText = label.length > maxLabelChars ? label.slice(0, maxLabelChars - 1) + "…" : label;
  doc.text(labelText, T.page.marginX, ctx.cursorY);

  // Bar background
  doc.setFillColor(T.colors.border);
  doc.rect(barX, ctx.cursorY - 3, barWidth, 3, "F");

  // Bar fill colored by bucket
  const fillColor =
    value > 80 ? T.colors.bucket.mastered :
    value >= 60 ? T.colors.bucket.proficient :
    value >= 40 ? T.colors.bucket.developing :
    T.colors.bucket.needsWork;
  doc.setFillColor(fillColor);
  doc.rect(barX, ctx.cursorY - 3, (barWidth * Math.min(Math.max(value, 0), 100)) / 100, 3, "F");

  // Percentage + trend
  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.small);
  doc.setTextColor(T.colors.muted);
  const trendMark = trend === "improving" ? "  ↑" : trend === "declining" ? "  ↓" : "";
  doc.text(`${value.toFixed(0)}%${trendMark}`, T.page.width - T.page.marginX, ctx.cursorY, {
    align: "right",
  });

  ctx.cursorY += rowHeight;

  // suppress unused-var warning in environments where this file is consumed without all helpers
  void totalWidth;
}
```

- [ ] **Step 3: Verify type-checks**

Run: `npm run build`
Expected: build completes; no TS errors mentioning `pdfTheme` or `pdfPrimitives`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pdf/pdfTheme.ts src/lib/pdf/pdfPrimitives.ts
git commit -m "feat(pdf): theme + drawing primitives for student report"
```

---

## Task 8: `studentReport.ts` orchestrator (cover, KPIs, performance tables)

**Why:** First half of the report — the data dense parts that come from `useStudentPerformanceDetail`.

**Files:**
- Create: `src/lib/pdf/studentReport.ts`

- [ ] **Step 1: Write the orchestrator (cover + performance sections)**

Create `src/lib/pdf/studentReport.ts`:

```ts
import jsPDF from "jspdf";
import { format } from "date-fns";
import type { StudentPerformanceDetail } from "@/hooks/useStudentPerformanceDetail";
import type { PassportData } from "@/hooks/useStudentPassport";
import type { UserBadge } from "@/hooks/useBadges";
import { PDF_THEME } from "./pdfTheme";
import {
  drawHeader,
  drawFooter,
  drawSectionTitle,
  drawKVRow,
  drawTable,
  drawProgressBar,
  ensureRoom,
  type PdfContext,
  type TableColumn,
} from "./pdfPrimitives";

const T = PDF_THEME;

export interface GenerateStudentReportInput {
  performance: StudentPerformanceDetail;
  passport: PassportData | null;
  badges: UserBadge[];
  generatedBy: { name: string; role: string };
  schoolName: string;
  salciLogoDataUrl: string;
  schoolLogoDataUrl: string | null;
  studentId: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "student";
}

function fmtDate(iso: string): string {
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

export async function generateStudentReport(input: GenerateStudentReportInput): Promise<void> {
  const { performance, passport, badges, generatedBy, schoolName } = input;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const ctx: PdfContext = {
    doc,
    cursorY: 0,
    pageNumber: 1,
    schoolName,
    salciLogoDataUrl: input.salciLogoDataUrl,
    schoolLogoDataUrl: input.schoolLogoDataUrl,
    generatedDate: format(new Date(), "MMM d, yyyy"),
  };

  drawHeader(ctx);
  drawCoverBlock(ctx, input);
  drawPerformanceSummary(ctx, performance);
  drawSubjectPerformance(ctx, performance);
  drawTopicMastery(ctx, performance);
  drawRecentExams(ctx, performance);
  drawPerformanceTrend(ctx, performance);
  drawPassportSection(ctx, passport);
  drawAcademicHistory(ctx, passport);
  drawSubjectCapabilities(ctx, passport);
  drawBadges(ctx, badges);

  // Back-fill footers (page count known only now)
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter({ ...ctx, pageNumber: i }, totalPages);
  }

  const filename = `salci-${slugify(performance.studentName)}-report-${format(new Date(), "yyyy-MM-dd")}.pdf`;
  doc.save(filename);
}

function drawCoverBlock(ctx: PdfContext, input: GenerateStudentReportInput): void {
  const { doc } = ctx;
  const { performance, generatedBy } = input;

  ensureRoom(ctx, 50);

  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.title);
  doc.setTextColor(T.colors.text);
  doc.text("Student Performance Report", T.page.marginX, ctx.cursorY + 6);
  ctx.cursorY += 14;

  // Student card
  doc.setDrawColor(T.colors.border);
  doc.setLineWidth(0.3);
  const cardX = T.page.marginX;
  const cardY = ctx.cursorY;
  const cardW = T.page.width - T.page.marginX * 2;
  const cardH = 26;
  doc.setFillColor(T.colors.bandFill);
  doc.roundedRect(cardX, cardY, cardW, cardH, 2, 2, "F");

  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.h1);
  doc.setTextColor(T.colors.text);
  doc.text(performance.studentName, cardX + 4, cardY + 7);

  doc.setFont(T.font.family, "normal");
  doc.setFontSize(T.font.sizes.body);
  doc.setTextColor(T.colors.muted);
  const classLine =
    performance.className + (performance.classSection ? ` — ${performance.classSection}` : "");
  doc.text(classLine, cardX + 4, cardY + 13);
  doc.text(performance.email, cardX + 4, cardY + 19);
  doc.text(`ID: ${input.studentId}`, cardX + cardW - 4, cardY + 19, { align: "right" });

  ctx.cursorY = cardY + cardH + 4;

  doc.setFont(T.font.family, "italic");
  doc.setFontSize(T.font.sizes.small);
  doc.setTextColor(T.colors.muted);
  doc.text(
    `Generated by ${generatedBy.name} (${generatedBy.role}) on ${ctx.generatedDate}`,
    T.page.marginX,
    ctx.cursorY,
  );
  ctx.cursorY += 6;
}

function drawPerformanceSummary(ctx: PdfContext, p: StudentPerformanceDetail): void {
  drawSectionTitle(ctx, "Performance Summary");

  if (p.totalExams === 0) {
    ctx.doc.setFont(T.font.family, "italic");
    ctx.doc.setFontSize(T.font.sizes.body);
    ctx.doc.setTextColor(T.colors.muted);
    ensureRoom(ctx, 8);
    ctx.doc.text("No exams taken yet.", T.page.marginX, ctx.cursorY);
    ctx.cursorY += 8;
    return;
  }

  drawKVRow(ctx, [
    { label: "Overall Accuracy", value: `${p.overallAccuracy.toFixed(1)}%` },
    { label: "Exams Taken", value: `${p.totalExams}` },
    { label: "Correct Answers", value: `${p.totalCorrect} / ${p.totalQuestionsAttempted}` },
    { label: "Avg Time / Question", value: `${p.avgTimePerQuestion.toFixed(0)}s` },
    { label: "Avg Efficiency", value: p.avgEfficiency.toFixed(2) },
    { label: "Best Score", value: `${p.bestAccuracy.toFixed(1)}%` },
    { label: "Lowest Score", value: `${p.worstAccuracy.toFixed(1)}%` },
    {
      label: "Last Change",
      value:
        p.trend.length >= 2
          ? `${(p.trend[p.trend.length - 1].accuracy - p.trend[p.trend.length - 2].accuracy).toFixed(1)}%`
          : "—",
    },
  ], 4);
}

function drawSubjectPerformance(ctx: PdfContext, p: StudentPerformanceDetail): void {
  drawSectionTitle(ctx, "Subject-wise Performance");

  const cols: TableColumn<typeof p.subjectPerformance[number]>[] = [
    { header: "Subject", width: 0.50, render: r => r.subject },
    { header: "Accuracy", width: 0.20, align: "right", render: r => `${r.accuracy.toFixed(1)}%` },
    { header: "Attempted", width: 0.30, align: "right", render: r => `${r.questionsAttempted}` },
  ];
  drawTable(ctx, cols, p.subjectPerformance, "No subject data yet.");
}

function drawTopicMastery(ctx: PdfContext, p: StudentPerformanceDetail): void {
  drawSectionTitle(ctx, "Topic Mastery");

  const list = p.conceptMastery.slice(0, 50);
  if (list.length === 0) {
    ctx.doc.setFont(T.font.family, "italic");
    ctx.doc.setFontSize(T.font.sizes.body);
    ctx.doc.setTextColor(T.colors.muted);
    ensureRoom(ctx, 8);
    ctx.doc.text("No topic mastery data yet.", T.page.marginX, ctx.cursorY);
    ctx.cursorY += 8;
    return;
  }

  list.forEach(t => {
    const trend =
      t.trend === "improving" ? "improving" :
      t.trend === "declining" ? "declining" :
      null;
    drawProgressBar(ctx, t.topic, t.mastery, trend);
  });

  if (p.conceptMastery.length > 50) {
    ensureRoom(ctx, 6);
    ctx.doc.setFont(T.font.family, "italic");
    ctx.doc.setFontSize(T.font.sizes.small);
    ctx.doc.setTextColor(T.colors.muted);
    ctx.doc.text(
      `…and ${p.conceptMastery.length - 50} more topics not shown.`,
      T.page.marginX,
      ctx.cursorY,
    );
    ctx.cursorY += 6;
  }
}

function drawRecentExams(ctx: PdfContext, p: StudentPerformanceDetail): void {
  drawSectionTitle(ctx, "Recent Exam Results");

  const cols: TableColumn<typeof p.recentExams[number]>[] = [
    { header: "Exam", width: 0.45, render: r => r.examTitle },
    { header: "Date", width: 0.20, render: r => fmtDate(r.date) },
    { header: "Accuracy", width: 0.15, align: "right", render: r => `${r.accuracy.toFixed(1)}%` },
    { header: "Score", width: 0.10, align: "right", render: r => r.score },
    { header: "Rank", width: 0.10, align: "right", render: r => r.rank ? `#${r.rank}` : "—" },
  ];
  drawTable(ctx, cols, p.recentExams, "No exams taken yet.");
}

function drawPerformanceTrend(ctx: PdfContext, p: StudentPerformanceDetail): void {
  drawSectionTitle(ctx, "Performance Trend");

  const cols: TableColumn<typeof p.trend[number]>[] = [
    { header: "#", width: 0.06, align: "right", render: r => `${r.examNumber}` },
    { header: "Exam", width: 0.49, render: r => r.examTitle },
    { header: "Student", width: 0.15, align: "right", render: r => `${r.accuracy.toFixed(1)}%` },
    { header: "Class Avg", width: 0.15, align: "right", render: r => `${(r.classAvg ?? 0).toFixed(1)}%` },
    { header: "Topper", width: 0.15, align: "right", render: r => `${(r.topperAccuracy ?? 0).toFixed(1)}%` },
  ];
  drawTable(ctx, cols, p.trend, "No trend data yet.");
}

// Stubs filled in Task 9 — keep file compiling.
function drawPassportSection(_ctx: PdfContext, _passport: PassportData | null): void {}
function drawAcademicHistory(_ctx: PdfContext, _passport: PassportData | null): void {}
function drawSubjectCapabilities(_ctx: PdfContext, _passport: PassportData | null): void {}
function drawBadges(_ctx: PdfContext, _badges: UserBadge[]): void {}
```

- [ ] **Step 2: Verify type-checks**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdf/studentReport.ts
git commit -m "feat(pdf): student report — cover + performance sections"
```

---

## Task 9: `studentReport.ts` — passport, capabilities, badges

**Why:** Wire in the Learning Passport half of the document. Replaces the stubs from Task 8.

**Files:**
- Modify: `src/lib/pdf/studentReport.ts`

- [ ] **Step 1: Replace the four stubs at the bottom of the file**

Open `src/lib/pdf/studentReport.ts`. Replace the four stub functions at the bottom (`drawPassportSection`, `drawAcademicHistory`, `drawSubjectCapabilities`, `drawBadges`) with:

```ts
function drawPassportSection(ctx: PdfContext, passport: PassportData | null): void {
  drawSectionTitle(ctx, "Learning Passport");

  if (!passport?.passport) {
    ctx.doc.setFont(T.font.family, "italic");
    ctx.doc.setFontSize(T.font.sizes.body);
    ctx.doc.setTextColor(T.colors.muted);
    ensureRoom(ctx, 8);
    ctx.doc.text("Learning passport not available.", T.page.marginX, ctx.cursorY);
    ctx.cursorY += 8;
    return;
  }

  const pp = passport.passport;
  const passRate = pp.total_exams_taken > 0
    ? (pp.total_exams_passed / pp.total_exams_taken) * 100
    : 0;

  drawKVRow(ctx, [
    { label: "Level", value: pp.passport_level.replace(/^\w/, c => c.toUpperCase()) },
    { label: "Total Points", value: `${pp.total_points}` },
    { label: "Exams Taken", value: `${pp.total_exams_taken}` },
    { label: "Exams Passed", value: `${pp.total_exams_passed}` },
    { label: "Pass Rate", value: `${passRate.toFixed(1)}%` },
    { label: "Avg Percentage", value: `${pp.average_percentage.toFixed(1)}%` },
    { label: "Highest Percentage", value: `${pp.highest_percentage.toFixed(1)}%` },
    { label: "Total Badges", value: `${pp.total_badges_earned}` },
    { label: "Current Streak", value: `${pp.login_streak_current} days` },
    { label: "Longest Streak", value: `${pp.login_streak_max} days` },
    { label: "Total Study Hours", value: `${pp.total_study_hours.toFixed(1)}h` },
    {
      label: "Improvement Rate",
      value: `${pp.improvement_rate >= 0 ? "+" : ""}${pp.improvement_rate.toFixed(1)}%`,
    },
  ], 4);
}

function drawAcademicHistory(ctx: PdfContext, passport: PassportData | null): void {
  drawSectionTitle(ctx, "Academic History");

  const records = passport?.academicRecords ?? [];
  const cols: TableColumn<typeof records[number]>[] = [
    { header: "Year", width: 0.14, render: r => r.academic_year },
    { header: "Class", width: 0.20, render: r => r.class_name + (r.section_name ? ` — ${r.section_name}` : "") },
    { header: "Exams", width: 0.10, align: "right", render: r => `${r.total_exams}` },
    { header: "Passed", width: 0.10, align: "right", render: r => `${r.exams_passed}` },
    { header: "Avg %", width: 0.13, align: "right", render: r => `${r.average_percentage.toFixed(1)}%` },
    { header: "Highest %", width: 0.13, align: "right", render: r => `${r.highest_percentage.toFixed(1)}%` },
    { header: "Points", width: 0.10, align: "right", render: r => `${r.total_points_earned}` },
    { header: "Rank", width: 0.10, align: "right", render: r => r.rank_in_class ? `#${r.rank_in_class}` : "—" },
  ];
  drawTable(ctx, cols, records, "No academic history recorded.");
}

function drawSubjectCapabilities(ctx: PdfContext, passport: PassportData | null): void {
  drawSectionTitle(ctx, "Subject Capabilities");

  const caps = passport?.subjectCapabilities ?? [];
  const cols: TableColumn<typeof caps[number]>[] = [
    { header: "Subject", width: 0.36, render: r => r.subject_name },
    {
      header: "Tier",
      width: 0.14,
      render: r => r.capability_tier.replace(/^\w/, c => c.toUpperCase()),
    },
    { header: "Mastery", width: 0.14, align: "right", render: r => `${r.mastery_level}%` },
    { header: "Accuracy", width: 0.14, align: "right", render: r => `${r.accuracy_percent.toFixed(1)}%` },
    { header: "Attempted", width: 0.12, align: "right", render: r => `${r.total_questions}` },
    {
      header: "Last Active",
      width: 0.10,
      align: "right",
      render: r => r.last_exam_date ? fmtDate(r.last_exam_date) : "—",
    },
  ];
  drawTable(ctx, cols, caps, "No subject capability data yet.");
}

function drawBadges(ctx: PdfContext, badges: UserBadge[]): void {
  drawSectionTitle(ctx, "Badges Earned");

  const cols: TableColumn<UserBadge>[] = [
    { header: "Badge", width: 0.50, render: b => b.badge?.name ?? "Unknown" },
    {
      header: "Tier",
      width: 0.20,
      render: b => (b.badge?.tier ?? "—").replace(/^\w/, c => c.toUpperCase()),
    },
    { header: "Points", width: 0.15, align: "right", render: b => `${b.badge?.points ?? 0}` },
    { header: "Earned", width: 0.15, align: "right", render: b => fmtDate(b.earned_at) },
  ];
  drawTable(ctx, cols, badges, "No badges earned yet.");
}
```

- [ ] **Step 2: Verify type-checks**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdf/studentReport.ts
git commit -m "feat(pdf): student report — passport, capabilities, badges"
```

---

## Task 10: "Generate Report" button on `StudentPerformancePage`

**Why:** The user-facing trigger. Loads logos as data URLs, calls `generateStudentReport`, manages the loading/error UI.

**Files:**
- Modify: `src/pages/school/StudentPerformancePage.tsx`

- [ ] **Step 1: Add helper to load image URLs as data URLs**

At the top of `src/lib/pdf/studentReport.ts`, export an additional helper used by the page:

```ts
// Loads a URL into a data: URL via fetch+FileReader. Returns null on any failure.
export async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Wire the button into the page**

Open [src/pages/school/StudentPerformancePage.tsx](../../../src/pages/school/StudentPerformancePage.tsx).

Add imports near the existing ones:

```tsx
import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStudentPassport } from "@/hooks/useStudentPassport";
import { useUserBadges } from "@/hooks/useBadges";
import { useInstitutionLogo } from "@/hooks/useInstitutionLogo";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useProfileData } from "@/hooks/useProfileData";
import { generateStudentReport, loadImageAsDataUrl } from "@/lib/pdf/studentReport";
import { toastError } from "@/lib/toast";
```

In the `StudentPerformancePage` component, after the existing `useStudentPerformanceDetail(studentId)` line, add:

```tsx
  const { data: passport, isLoading: passportLoading } = useStudentPassport(studentId);
  const { data: badges, isLoading: badgesLoading } = useUserBadges(studentId);
  const { institutionId } = useEffectiveInstitution();
  const { logoUrl: schoolLogoUrl, isLoading: logoLoading } = useInstitutionLogo(institutionId);
  const { data: viewer } = useProfileData();

  // useEffectiveInstitution.institutionName is only set when super-admin is "managing as admin",
  // so resolve the institution's display name from the table for everyone else too.
  const { data: institutionRow, isLoading: institutionRowLoading } = useQuery({
    queryKey: ["institution-name", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;
      const { data: row } = await supabase
        .from("institutions")
        .select("name")
        .eq("id", institutionId)
        .maybeSingle();
      return row;
    },
    enabled: !!institutionId,
    staleTime: 5 * 60 * 1000,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const reportReady =
    !!data &&
    !passportLoading &&
    !badgesLoading &&
    !logoLoading &&
    !institutionRowLoading &&
    !!studentId;

  const handleGenerateReport = async () => {
    if (!data || !studentId) return;
    setIsGenerating(true);
    try {
      const [salciLogoDataUrl, schoolLogoDataUrl] = await Promise.all([
        loadImageAsDataUrl("/Logo.png"),
        schoolLogoUrl ? loadImageAsDataUrl(schoolLogoUrl) : Promise.resolve(null),
      ]);

      await generateStudentReport({
        performance: data,
        passport: passport ?? null,
        badges: badges ?? [],
        generatedBy: {
          name: viewer?.full_name ?? "Unknown",
          role: viewer?.roles?.[0]?.role ?? "user",
        },
        schoolName: institutionRow?.name ?? "SALCI",
        salciLogoDataUrl: salciLogoDataUrl ?? "",
        schoolLogoDataUrl,
        studentId,
      });
    } catch (e) {
      toastError(e, {
        fallback: "Couldn't generate the report.",
        context: "generateStudentReport",
      });
    } finally {
      setIsGenerating(false);
    }
  };
```

Replace the header block (currently lines 76–92, the `{/* Header */}` section) with one that has the button on the right:

```tsx
      {/* Header */}
      <div className="space-y-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard?tab=students")} className="rounded-xl">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
        </Button>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shadow-lg">
              {data.studentName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{data.studentName}</h1>
              <p className="text-muted-foreground text-sm">
                {data.className}{data.classSection ? ` - ${data.classSection}` : ""} • {data.email}
              </p>
            </div>
          </div>
          <Button
            onClick={handleGenerateReport}
            disabled={!reportReady || isGenerating}
            className="rounded-xl bg-primary hover:bg-primary/90"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Preparing report…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Generate Report
              </>
            )}
          </Button>
        </div>
      </div>
```

- [ ] **Step 3: Verify type-checks**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pdf/studentReport.ts src/pages/school/StudentPerformancePage.tsx
git commit -m "feat(student-report): Generate Report button on student dashboard"
```

---

## Task 11: End-to-end manual verification

**Why:** Without automated tests, this is the project's only safety net. Run all of the spec's golden-path checks and edge cases.

**Files:** None (verification only).

- [ ] **Step 1: Verify on an institution WITH a logo**

1. Sign in as `bhan@salci.in` (super_admin). Upload a square PNG logo to "Salci National School" if not already done.
2. Sign in as a school_admin of that institution.
3. Confirm the topbar now shows the logo + name.
4. Navigate Manage Users → click a student → click **Access Dashboard**.
5. Wait until the page is fully loaded (KPIs visible). Confirm "Generate Report" is enabled.
6. Click **Generate Report**. Confirm:
   - Button shows "Preparing report…" briefly.
   - PDF downloads as `salci-{slug}-report-2026-04-27.pdf`.
   - Open the PDF. Verify:
     - SALCI logo top-left of every page; school logo top-right of every page; school name to the left of the school logo.
     - Footer "Confidential — for internal use" left, "Generated Apr 27, 2026 • Page X of N" right.
     - All sections present in order: Performance Summary, Subject-wise Performance, Topic Mastery, Recent Exam Results, Performance Trend, Learning Passport, Academic History, Subject Capabilities, Badges Earned.
     - Press Ctrl+F, search for the student's name → it highlights (proves true vector text, not an image).
     - Press Ctrl+F, search a topic name from the topic mastery section → it highlights.
     - File size < 500 KB.

- [ ] **Step 2: Verify on an institution WITHOUT a logo**

1. Sign in as super_admin. Pick a different institution that has no logo (or temporarily remove it via Task 4's UI).
2. Sign in as a school_admin of that institution.
3. Confirm topbar shows just the name (no broken-image artifact).
4. Generate a student report. Confirm:
   - PDF header shows SALCI logo top-left and school name top-right alone (no school logo).
   - No errors / no broken-image rectangles.

- [ ] **Step 3: Verify on a student with zero exams**

1. Pick a brand-new student account with no exam attempts.
2. Open their dashboard. Confirm the page renders with empty KPIs.
3. Click **Generate Report**. Confirm:
   - PDF generates successfully.
   - "Performance Summary" section reads "No exams taken yet."
   - Subject / Topic / Recent / Trend sections each show their italic empty-state text.
   - Learning Passport / Academic History / Capabilities / Badges sections render with their respective empty states.

- [ ] **Step 4: Verify error path**

1. Open DevTools → Network → enable offline mode.
2. Click Generate Report. Confirm a Sonner error toast appears with the fallback "Couldn't generate the report."
3. Re-enable network. Confirm a subsequent click succeeds.

- [ ] **Step 5: Final commit**

If any verification step required a small fix, commit it with a focused message. If everything passed, no further commit is needed — the feature is complete.

```bash
git status   # confirm clean tree
```

---

## Self-Review Checklist (already done)

- [x] **Spec coverage:** every section in the spec has a task.
  - Migration → Task 1; reader hook → Task 2; mutation hooks → Task 3; uploader UI → Task 4; sidebar/topbar consumers → Tasks 5–6; PDF module → Tasks 7–9; button → Task 10; manual tests → Task 11.
- [x] **Placeholders:** none. Every code block is concrete.
- [x] **Type consistency:** `PdfContext`, `TableColumn`, `PassportData`, `StudentPerformanceDetail`, `UserBadge` are imported from their declared sources; method names (`drawHeader`, `drawFooter`, `drawSectionTitle`, `drawKVRow`, `drawTable`, `drawProgressBar`, `ensureRoom`) match between primitives and orchestrator.
- [x] **`PassportData` (not `StudentPassportData`):** corrected from spec — actual exported name from `useStudentPassport.ts`.
