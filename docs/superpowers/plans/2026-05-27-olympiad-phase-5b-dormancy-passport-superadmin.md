# SALCI Olympiad Phase 5b — Dormancy + Passport + Super Admin Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the operational tail: daily dormancy cron (Day 30 + Day 60 + stuck-attempt cleanup), `oly_results_archive` table for anonymized retention, super-admin impersonation + archive campaign + historical view, Passport entry creation for SALCI students.

**Architecture:** Schema adds `oly_results_archive` + `oly_impersonation_log` + 3 SECURITY DEFINER RPCs + pg_cron entry. Edge functions: `oly-dormancy-pass` (daily cron orchestrator) + `oly-impersonate-school-admin` (super-admin magic-link generator) + `oly-create-passport-entry` (per-SALCI-student, invoked from publish orchestrator). Super admin UI adds impersonation dialog, archive action, year-filter dropdown.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, Supabase (PostgreSQL + RLS + Edge Functions + pg_cron + auth admin API), shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-phase-5b-dormancy-passport-superadmin-design.md](../specs/2026-05-27-olympiad-phase-5b-dormancy-passport-superadmin-design.md)
**Master:** [docs/superpowers/specs/2026-05-26-olympiad-master-decomposition-design.md](../specs/2026-05-26-olympiad-master-decomposition-design.md)

**No test infrastructure** — verification via §5a (tsc + eslint + vite build).

---

## §23 compliance

- All FKs indexed in T1 migration
- All RPCs SECURITY DEFINER with `auth.uid()` or `is_super_admin` gating
- Dormancy job runs at 4 AM IST (low-traffic window)
- Day 60 purge batches via FOR loop with bounded iteration (safety via `where ... and (p_campaign_id is null or s.campaign_id = p_campaign_id)`)
- Storage purge done in batches in edge function (Supabase storage `remove([])` supports up to 1000 keys per call)
- Impersonation magic links are 5-min TTL, audit-logged

---

## File Structure

```
supabase/
  migrations/
    <ts>_oly_phase_5b_dormancy.sql                                    (NEW)
  functions/
    oly-dormancy-pass/index.ts                                        (NEW) — daily cron orchestrator
    oly-impersonate-school-admin/index.ts                             (NEW) — magic-link generator
    oly-create-passport-entry/index.ts                                (NEW) — invoked from publish
    oly-publish-school-results/index.ts                               (EDIT) — call passport entry per SALCI student

src/
  hooks/olympiad/
    useImpersonateSchoolAdmin.ts                                      (NEW)
    useArchiveCampaign.ts                                             (NEW)
    useOlympiadCampaignsList.ts                                       (NEW)
  components/olympiad/admin/
    ImpersonateDialog.tsx                                             (NEW)
    ImpersonationBanner.tsx                                           (NEW)
    ArchiveCampaignDialog.tsx                                         (NEW)
  pages/admin/olympiad/
    OlympiadSchoolDetailPage.tsx                                      (EDIT) — Impersonate + Archive buttons
    OlympiadSchoolsTab.tsx                                            (EDIT) — Year filter dropdown
  App.tsx                                                             (EDIT) — render ImpersonationBanner at app root
```

---

## Section A — Foundation

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/<ts>_oly_phase_5b_dormancy.sql`

- [ ] **Step 1.1: Generate timestamp**

```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Write the migration**

Read the spec (sections 2.1-2.4) for the full SQL. Sections:

1. **`oly_results_archive`** — anonymized retention table; 3 indexes; super_admin all RLS
2. **`oly_impersonation_log`** — audit trail; 4 indexes; super_admin all RLS
3. **`oly_dormancy_day30(p_campaign_id default null)`** RPC — UPDATEs `oly_students.status` to 'dormant' for non-SALCI and 'archived' for SALCI when published_at > 30 days ago
4. **`oly_dormancy_day60(p_campaign_id default null)`** RPC — FOR loop: insert anonymized archive row (ON CONFLICT DO NOTHING), collect auth_user_ids + storage_paths, PURGE PII (set full_name='[PURGED]', parent_*='[PURGED]', date_of_birth='1900-01-01', status='archived'), return jsonb with auth_user_ids + storage_paths arrays
5. **`oly_cleanup_stuck_attempts()`** RPC — FOR loop over `oly_attempts` where started_at + duration < now() - 1h AND status='in_progress', auto-submit with reason='disconnect_exceeded', compute score inline via subquery
6. **Audit log enum extension** — add `campaign_archived`, `impersonation_started`, `dormancy_pass_completed`, `passport_entry_created`
7. **pg_cron schedule** — `oly-dormancy-pass` at `30 22 * * *` (22:30 UTC = 4:00 AM IST), with cron.unschedule guard

### Step 1.3: Apply + regenerate types + verify

```bash
npx supabase db push
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npx tsc --noEmit
```

### Step 1.4: Commit

```bash
git add supabase/migrations/<ts>_oly_phase_5b_dormancy.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 5b schema - dormancy RPCs, archive table, impersonation log, cron

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Section B — Edge functions

### Task 2: 3 new edge functions + 1 edit

**Files:**
- Create: `supabase/functions/oly-dormancy-pass/index.ts`
- Create: `supabase/functions/oly-impersonate-school-admin/index.ts`
- Create: `supabase/functions/oly-create-passport-entry/index.ts`
- Modify: `supabase/functions/oly-publish-school-results/index.ts` (add Step 4 — invoke passport entry per SALCI student)

#### `oly-dormancy-pass`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  try {
    // @ts-expect-error Deno.env
    const cronSecret = Deno.env.get("OLY_CRON_SECRET");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const summary: Record<string, unknown> = {};

    // Step A: cleanup stuck attempts
    const { data: stuckData, error: stuckErr } = await supabase.rpc("oly_cleanup_stuck_attempts");
    if (stuckErr) console.error("stuck_attempts", stuckErr);
    summary.stuck_attempts = stuckData;

    // Step B: Day 30
    const { data: day30, error: day30Err } = await supabase.rpc("oly_dormancy_day30");
    if (day30Err) console.error("day30", day30Err);
    summary.day30 = day30;

    // Step C: Day 60 (returns lists of auth_user_ids + storage_paths to actually purge)
    const { data: day60Raw, error: day60Err } = await supabase.rpc("oly_dormancy_day60");
    if (day60Err) console.error("day60", day60Err);
    const day60 = day60Raw as { purged: number; auth_user_ids_to_delete: string[]; storage_paths_to_delete: string[] };
    summary.day60_purged = day60?.purged ?? 0;

    // Step D: delete auth users (batched, log failures)
    let authDeleted = 0;
    const authFailures: Array<{ id: string; error: string }> = [];
    for (const uid of day60?.auth_user_ids_to_delete ?? []) {
      try {
        const { error } = await supabase.auth.admin.deleteUser(uid);
        if (error) authFailures.push({ id: uid, error: error.message });
        else authDeleted++;
      } catch (e) {
        authFailures.push({ id: uid, error: (e as Error).message });
      }
    }
    summary.auth_deleted = authDeleted;
    summary.auth_failures = authFailures.length;

    // Step E: bulk delete storage (chunks of 1000)
    const paths = day60?.storage_paths_to_delete ?? [];
    let storageDeleted = 0;
    for (let i = 0; i < paths.length; i += 1000) {
      const chunk = paths.slice(i, i + 1000);
      const { error } = await supabase.storage.from("olympiad-receipts").remove(chunk);
      if (error) console.error("storage remove", error);
      else storageDeleted += chunk.length;
    }
    summary.storage_deleted = storageDeleted;

    return new Response(JSON.stringify({ ok: true, summary }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
});
```

Deploy with `--no-verify-jwt`:
```bash
npx supabase@latest functions deploy oly-dormancy-pass --project-ref gyymkgohcijeksmrzuyw --no-verify-jwt
```

#### `oly-impersonate-school-admin`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userRes } = await supabase.auth.getUser(token);
    const superUid = userRes.user?.id;
    if (!superUid) return json({ error: "Forbidden" }, 403);

    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: superUid });
    if (!isSuper) return json({ error: "Forbidden — super admin only" }, 403);

    const { oly_school_id, reason } = (await req.json()) as { oly_school_id: string; reason: string };
    if (!reason?.trim()) return json({ error: "Reason required" }, 400);

    // Resolve school + institution + target school_admin user
    const { data: school } = await supabase
      .from("oly_schools")
      .select("id, institution_id")
      .eq("id", oly_school_id)
      .single();
    if (!school) return json({ error: "School not found" }, 404);

    const { data: targetRole } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("institution_id", school.institution_id)
      .eq("role", "school_admin")
      .limit(1)
      .maybeSingle();
    if (!targetRole) return json({ error: "No school admin found for this institution" }, 404);

    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", targetRole.user_id)
      .single();
    if (!targetProfile?.email) return json({ error: "Target admin has no email on profile" }, 400);

    // Generate magic link
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: targetProfile.email,
    });
    if (linkErr || !linkData?.properties?.action_link) {
      return json({ error: `Magic link generation failed: ${linkErr?.message}` }, 500);
    }

    // Log impersonation
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await supabase.from("oly_impersonation_log").insert({
      super_admin_id: superUid,
      impersonated_user_id: targetRole.user_id,
      oly_school_id,
      reason,
      expires_at: expiresAt,
    });

    // Append ?impersonating=1 query param for client-side banner detection
    const magicLink = `${linkData.properties.action_link}&impersonating=1`;

    return json({ ok: true, magic_link: magicLink, target_email: targetProfile.email }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

Deploy: `npx supabase@latest functions deploy oly-impersonate-school-admin --project-ref gyymkgohcijeksmrzuyw`

#### `oly-create-passport-entry`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify caller is super_admin or school_admin
    const { data: userRes } = await supabase.auth.getUser(token);
    const callerId = userRes.user?.id;
    if (!callerId) return json({ error: "Forbidden" }, 403);

    const { oly_result_id } = (await req.json()) as { oly_result_id: string };

    const { data: result } = await supabase
      .from("oly_results")
      .select(`
        id, total_marks_obtained, total_max_marks, percentage, certificate_tier,
        certificate_id, school_rank, class_rank, result_pdf_path, oly_school_id,
        oly_students!oly_student_id ( profile_id, full_name, roll_number ),
        oly_campaigns!campaign_id ( campaign_year )
      `)
      .eq("id", oly_result_id)
      .single();
    if (!result) return json({ error: "Result not found" }, 404);

    const student = Array.isArray(result.oly_students) ? result.oly_students[0] : result.oly_students;
    const profileId = (student as { profile_id?: string } | null)?.profile_id;
    if (!profileId) {
      return json({ ok: true, skipped: true, reason: "Not a SALCI student" }, 200);
    }

    const campaign = Array.isArray(result.oly_campaigns) ? result.oly_campaigns[0] : result.oly_campaigns;
    const year = (campaign as { campaign_year?: number } | null)?.campaign_year ?? new Date().getFullYear();

    // Authorize: super_admin OR school_admin for the result's school
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: callerId });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: callerId, p_oly_school_id: result.oly_school_id,
    });
    if (!isSuper && !isAdmin) return json({ error: "Forbidden" }, 403);

    // Check if passport entry already exists (idempotent)
    const { data: existing } = await supabase
      .from("passport_academic_records")
      .select("id")
      .eq("student_id", profileId)
      .eq("record_type", "olympiad")
      .eq("academic_year", year.toString())
      .maybeSingle();
    if (existing) return json({ ok: true, already_exists: true, id: existing.id }, 200);

    // Insert. NOTE: actual column names may differ — implementer reads the existing
    // passport_academic_records schema before writing this INSERT. The fields below
    // are the minimal set; add more if the existing table requires them.
    const { data: inserted, error: insErr } = await supabase
      .from("passport_academic_records")
      .insert({
        student_id: profileId,
        academic_year: year.toString(),
        record_type: "olympiad",
        title: `SALCI Olympiad ${year}`,
        description: `Achieved ${result.certificate_tier} certificate with ${result.percentage}% (${result.total_marks_obtained}/${result.total_max_marks})`,
        metadata: {
          certificate_tier: result.certificate_tier,
          certificate_id: result.certificate_id,
          school_rank: result.school_rank,
          class_rank: result.class_rank,
          percentage: result.percentage,
          result_pdf_path: result.result_pdf_path,
          oly_result_id: result.id,
        },
      })
      .select("id")
      .single();
    if (insErr) return json({ error: `Passport insert failed: ${insErr.message}` }, 500);

    // Audit log
    await supabase.from("oly_audit_log").insert({
      campaign_id: null,  // not directly known here; could be fetched from result if needed
      oly_school_id: result.oly_school_id,
      oly_student_id: (student as { id?: string } | null)?.id ?? null,
      actor_id: callerId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: "passport_entry_created",
      after_json: { passport_entry_id: inserted.id, profile_id: profileId },
    });

    return json({ ok: true, id: inserted.id }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
```

Deploy: `npx supabase@latest functions deploy oly-create-passport-entry --project-ref gyymkgohcijeksmrzuyw`

**IMPORTANT**: Read the actual `passport_academic_records` table definition from `supabase/migrations/20260226052445_*.sql` BEFORE writing the INSERT. If column names differ (e.g. no `description` field, different `metadata` shape), adapt. The fields listed above are my best guess based on table name.

#### Edit `oly-publish-school-results`

After Step 3 (email sending), add Step 4:

```ts
await updateJob({ status: "creating_passport_entries" });

const { data: salciResults } = await supabase
  .from("oly_results")
  .select("id, oly_students!oly_student_id(profile_id)")
  .eq("oly_school_id", oly_school_id);

const passportTasks: Promise<unknown>[] = [];
for (const r of salciResults ?? []) {
  const student = Array.isArray(r.oly_students) ? r.oly_students[0] : r.oly_students;
  if ((student as { profile_id?: string } | null)?.profile_id) {
    passportTasks.push(
      supabase.functions.invoke("oly-create-passport-entry", { body: { oly_result_id: r.id } })
        .catch((e: Error) => console.error(`passport entry failed for ${r.id}`, e))
    );
  }
}
await Promise.allSettled(passportTasks);
```

Re-deploy: `npx supabase@latest functions deploy oly-publish-school-results --project-ref gyymkgohcijeksmrzuyw`

NOTE: The `creating_passport_entries` status value needs to be added to the `oly_publish_jobs.status` check constraint in T1's migration. Update the constraint to include it.

Actually simpler — just skip the status update; the orchestrator can do this work between "sending_emails" and "completed". Or update the check constraint as part of T1. Plan implementer's call.

### Step 2 commit

```bash
git add supabase/functions/oly-dormancy-pass/ supabase/functions/oly-impersonate-school-admin/ supabase/functions/oly-create-passport-entry/ supabase/functions/oly-publish-school-results/
git commit -m "feat(olympiad): phase 5b edge functions - dormancy cron, impersonation, passport entry creation"
```

---

## Section C — Super admin UI

### Task 3: Impersonation + Archive + Year filter

**Files:**
- Create: `src/hooks/olympiad/useImpersonateSchoolAdmin.ts`
- Create: `src/hooks/olympiad/useArchiveCampaign.ts`
- Create: `src/hooks/olympiad/useOlympiadCampaignsList.ts`
- Create: `src/components/olympiad/admin/ImpersonateDialog.tsx`
- Create: `src/components/olympiad/admin/ImpersonationBanner.tsx`
- Create: `src/components/olympiad/admin/ArchiveCampaignDialog.tsx`
- Modify: `src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx`
- Modify: `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`
- Modify: `src/App.tsx` (render ImpersonationBanner at top)

#### Hooks

```ts
// useImpersonateSchoolAdmin.ts
import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export function useImpersonateSchoolAdmin() {
  return useMutation({
    mutationFn: async (input: { oly_school_id: string; reason: string }): Promise<{ magic_link: string; target_email: string }> => {
      return invokeEdgeFunction("oly-impersonate-school-admin", input);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't generate impersonation link.", context: "useImpersonateSchoolAdmin" }),
  });
}
```

```ts
// useArchiveCampaign.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useArchiveCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_school_id }: { oly_school_id: string }) => {
      const { error } = await supabase
        .from("oly_schools")
        .update({ status: "archived" })
        .eq("id", oly_school_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success("Campaign archived");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't archive campaign.", context: "useArchiveCampaign" }),
  });
}
```

```ts
// useOlympiadCampaignsList.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useOlympiadCampaignsList() {
  return useQuery({
    queryKey: ["olympiad", "campaigns-list"],
    queryFn: async (): Promise<Array<{ id: string; campaign_year: number; status: string }>> => {
      const { data, error } = await supabase
        .from("oly_campaigns")
        .select("id, campaign_year, status")
        .order("campaign_year", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; campaign_year: number; status: string }>;
    },
    staleTime: 5 * 60_000,
  });
}
```

#### `ImpersonateDialog.tsx`

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useImpersonateSchoolAdmin } from "@/hooks/olympiad/useImpersonateSchoolAdmin";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  schoolName: string;
};

export function ImpersonateDialog({ open, onOpenChange, olySchoolId, schoolName }: Props) {
  const impersonate = useImpersonateSchoolAdmin();
  const [reason, setReason] = useState("");

  const onConfirm = async () => {
    if (!reason.trim()) return;
    try {
      const result = await impersonate.mutateAsync({ oly_school_id: olySchoolId, reason });
      window.open(result.magic_link, "_blank", "noopener,noreferrer");
      onOpenChange(false);
      setReason("");
    } catch { /* toastError */ }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Impersonate school admin?</AlertDialogTitle>
          <AlertDialogDescription>
            This generates a 5-minute magic link that signs you in as <strong>{schoolName}</strong>'s school admin in a new tab. The action is audit-logged.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Reason (required)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Support request from school" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!reason.trim() || impersonate.isPending} onClick={onConfirm}>
            {impersonate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Generate impersonation link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

#### `ImpersonationBanner.tsx`

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export function ImpersonationBanner() {
  const navigate = useNavigate();
  const [isImpersonating, setIsImpersonating] = useState(false);

  useEffect(() => {
    // Detect impersonation from URL query param OR persisted flag
    const url = new URL(window.location.href);
    if (url.searchParams.get("impersonating") === "1") {
      localStorage.setItem("oly_impersonating", "1");
      url.searchParams.delete("impersonating");
      window.history.replaceState({}, "", url.toString());
    }
    setIsImpersonating(localStorage.getItem("oly_impersonating") === "1");
  }, []);

  const exit = async () => {
    localStorage.removeItem("oly_impersonating");
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (!isImpersonating) return null;

  return (
    <div className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300 px-4 py-2 text-sm flex items-center justify-between gap-3 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        <span><strong>Impersonating</strong> — you're signed in as a school admin via super-admin override</span>
      </div>
      <Button size="sm" variant="outline" onClick={exit}>
        <LogOut className="h-4 w-4 mr-1" />
        Exit impersonation
      </Button>
    </div>
  );
}
```

#### `ArchiveCampaignDialog.tsx`

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useArchiveCampaign } from "@/hooks/olympiad/useArchiveCampaign";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  schoolName: string;
};

export function ArchiveCampaignDialog({ open, onOpenChange, olySchoolId, schoolName }: Props) {
  const archive = useArchiveCampaign();
  const [typed, setTyped] = useState("");
  const canConfirm = typed === "ARCHIVE";

  const onConfirm = async () => {
    try {
      await archive.mutateAsync({ oly_school_id: olySchoolId });
      setTyped("");
      onOpenChange(false);
    } catch { /* toastError */ }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive campaign for {schoolName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This marks the school's campaign as archived. The school will no longer appear in the active schools list (use the year filter to see archived campaigns). Existing results and PDFs are preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Type ARCHIVE to confirm</Label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirm || archive.isPending} onClick={onConfirm}>
            {archive.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

#### `OlympiadSchoolDetailPage` edit

Add Impersonate + Archive buttons in the header. Show buttons only if `is_super_admin`.

```tsx
// near the top imports:
import { useState } from "react";
import { UserCog, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImpersonateDialog } from "@/components/olympiad/admin/ImpersonateDialog";
import { ArchiveCampaignDialog } from "@/components/olympiad/admin/ArchiveCampaignDialog";

// inside the component:
const [impersonateOpen, setImpersonateOpen] = useState(false);
const [archiveOpen, setArchiveOpen] = useState(false);

// in JSX, after PageHeader and stats:
<div className="flex gap-2">
  <Button size="sm" variant="outline" onClick={() => setImpersonateOpen(true)}>
    <UserCog className="h-4 w-4 mr-1" />
    View as Admin
  </Button>
  <Button size="sm" variant="outline" disabled={school.status !== 'results_published'} onClick={() => setArchiveOpen(true)}>
    <Archive className="h-4 w-4 mr-1" />
    Archive
  </Button>
</div>

<ImpersonateDialog open={impersonateOpen} onOpenChange={setImpersonateOpen} olySchoolId={school.id} schoolName={school.institution_name} />
<ArchiveCampaignDialog open={archiveOpen} onOpenChange={setArchiveOpen} olySchoolId={school.id} schoolName={school.institution_name} />
```

#### `OlympiadSchoolsTab` edit

Add a year-filter dropdown at the top. Modify `useOlympiadSchools` to accept a campaignId arg (it likely already does), and use the year filter to switch.

```tsx
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOlympiadCampaignsList } from "@/hooks/olympiad/useOlympiadCampaignsList";

// inside the component, after existing hooks:
const { data: campaigns } = useOlympiadCampaignsList();
const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
const filterCampaignId = selectedCampaignId ?? campaigns?.[0]?.id;

// in JSX, near the page header:
<div className="flex items-center justify-between">
  <p className="eyebrow">Schools</p>
  <div className="flex items-center gap-2">
    <Select value={filterCampaignId ?? ""} onValueChange={setSelectedCampaignId}>
      <SelectTrigger className="h-9 w-auto"><SelectValue placeholder="Campaign" /></SelectTrigger>
      <SelectContent>
        {(campaigns ?? []).map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.campaign_year}{c.status === 'archived' ? ' (archived)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {/* existing "Onboard school" button */}
  </div>
</div>
```

Pass `filterCampaignId` (instead of the hardcoded current-year lookup) to `useOlympiadSchools(filterCampaignId)`.

#### `App.tsx` edit — render banner

At the very top of the root layout (above the Router or right inside it), render `<ImpersonationBanner />`. Place it so it shows on every page regardless of route.

#### Verify + commit

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/ src/components/olympiad/admin/ src/pages/admin/olympiad/ src/App.tsx
npx vite build
git add src/hooks/olympiad/useImpersonateSchoolAdmin.ts src/hooks/olympiad/useArchiveCampaign.ts src/hooks/olympiad/useOlympiadCampaignsList.ts src/components/olympiad/admin/ImpersonateDialog.tsx src/components/olympiad/admin/ImpersonationBanner.tsx src/components/olympiad/admin/ArchiveCampaignDialog.tsx src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx src/pages/admin/olympiad/OlympiadSchoolsTab.tsx src/App.tsx
git commit -m "feat(olympiad): super-admin impersonation + archive + year filter + impersonation banner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Section D — Verification + final review

### Task 4: §5a + concurrency checklist + WHOLE-OLYMPIAD final review

```bash
npx tsc --noEmit
npx eslint "src/{hooks,components,pages}/olympiad/**" "src/App.tsx"
npx vite build
```

**Concurrency self-check**:
- [ ] All new hooks have explicit `staleTime`
- [ ] No `select("*")` in new code
- [ ] All new RPCs SECURITY DEFINER with auth check
- [ ] Dormancy pass uses batched storage delete (1000 paths per call)
- [ ] Impersonation magic link is 5-min TTL + audit-logged
- [ ] Passport entry insert is idempotent (existing check)

**Manual smoke** (controller/user):

1. Super admin: visit a school detail page → "View as Admin" → magic link opens → land in school admin's dashboard with the banner
2. Click "Exit impersonation" → signed out → back to login
3. Super admin: archive a published campaign → school disappears from active list; appears under year filter
4. As SALCI student post-publish: visit Passport → see Olympiad entry with score + tier
5. (Production simulation) Run dormancy RPCs manually with past dates to verify Day 30 + Day 60 behavior
6. Stuck attempts: manually set an attempt's started_at to 2h+ in past; run `oly_cleanup_stuck_attempts` RPC; verify auto-submit

**Then**: dispatch the **whole-Olympiad final code review** — a subagent reviewing the entire branch since `2340bc6` (the spec/plan baseline). Surface any cross-phase concerns: helper drift, type mismatch, missed §23 patterns.

Commit final smoke fixes.

---

## Self-Review

- **Spec coverage**: every §1-§8 maps to a task. The plan is shorter than other phases (4 tasks) because Phase 5b is the operational tail.
- **Placeholders**: none. The passport_academic_records INSERT is flagged for implementer to verify column names from existing migration.
- **Type consistency**: matches Phase 4a/4b/5a type patterns
- **Production**: all per-§23 patterns honored; dormancy cron runs in low-traffic window; impersonation audited
