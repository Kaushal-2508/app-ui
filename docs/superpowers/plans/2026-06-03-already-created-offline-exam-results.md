# Already-Created Offline Exam (Results Upload) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Already Created" sub-option under Offline exam mode that lets a teacher record marks for an already-conducted paper exam — optional paper upload, a total-marks prompt, then inline per-student marks entry — reusing the existing offline results pipeline.

**Architecture:** A results-only exam is persisted as a normal **offline** exam carrying one synthetic section titled "Total" (the entered total marks) and **zero questions**. Downstream (`student_exam_attempts`, `offline_section_marks`, `final_results`, All-Exams card, student `ResultDetailsSheet`) already handle offline exams and run unchanged. A new `exams.is_results_only` flag drives the creation-UI fork and a list badge; `exams.source_paper_files` (JSONB) stores uploaded paper references in the public `exam-sheets` bucket.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, Supabase (Postgres + Storage), shadcn/ui, Tailwind. **No unit-test runner exists** — verification is `npx tsc --noEmit` (exit 0), `npx eslint <changed files>` (no new errors), `npx vite build` (exit 0), plus the manual steps in the final task (CLAUDE.md §5a).

**Spec:** `docs/superpowers/specs/2026-06-03-already-created-offline-exam-results-design.md`
**Branch:** `feat/already-created-offline-exam` (already created).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/2026XXXXXXXXXX_already_created_offline_exam.sql` | Create | Add `exams.is_results_only` + `exams.source_paper_files`; make `exam-sheets` bucket public |
| `src/types/exam.ts` | Modify | `SourcePaperFile` type; `isResultsOnly`/`sourcePaperFiles`/`totalMarksOverride` on metadata; `totalMarks` on `ExamSection` |
| `src/lib/examPaperStorage.ts` | Create | Upload a paper file to `exam-sheets`; resolve public URL |
| `src/components/exam-creation/components/ExamModeSubToggle.tsx` | Create | "Create Exam" / "Already Created" two-button toggle |
| `src/components/exam-creation/components/UploadPaperPanel.tsx` | Create | Optional multi-file paper uploader |
| `src/components/exam-creation/screens/ResultSetupSheet.tsx` | Create | Total marks + date + pass % + visibility prompt |
| `src/components/exam-creation/screens/ExamDetailsScreen.tsx` | Modify | Render sub-toggle (offline only); swap sections builder ↔ upload panel; relax `canContinue`; CTA label |
| `src/hooks/useSaveExam.ts` | Modify | Relax publish validation for results-only; persist `exam_sections.total_marks`; total override; write new columns |
| `src/components/exam-creation/ExamCreationFlow.tsx` | Modify | Route results-only: Details → ResultSetupSheet → save+publish → inline `OfflineMarksEntryScreen`; edit-mode routing; loader maps new fields |
| `src/pages/ExamsPage.tsx` | Modify | `ExamRow.is_results_only`; "Results upload" badge on the card |
| `src/hooks/useDashboardData.ts` | Modify | Add `is_results_only` to the three exam `select` lists |
| `src/hooks/useCoordinatorClasses.ts` | Modify | Add `is_results_only` to the coordinator exam `select` |
| `src/components/student/ResultDetailsSheet.tsx` | Modify | Fetch `source_paper_files`; render a "Question paper" card |

**Types note (no type regen required):** New columns won't appear in the generated `src/integrations/supabase/types.ts` until it's regenerated. Per CLAUDE.md §5a, write sites cast the payload narrowly (`as unknown as TablesInsert<"exams">`), and read sites extend the hand-written row types — **never `as any`**. Regenerating types is an optional later cleanup, not a blocker.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/2026XXXXXXXXXX_already_created_offline_exam.sql` (replace `2026XXXXXXXXXX` with the current UTC timestamp, format `YYYYMMDDHHMMSS`)

- [ ] **Step 1: Write the migration**

```sql
-- Already-Created offline exam (results upload)
-- Adds a marker flag + uploaded-paper references to exams, and makes the
-- (currently unused) exam-sheets bucket public so staff and students can
-- view uploaded papers via public URL.

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS is_results_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS source_paper_files JSONB;

COMMENT ON COLUMN public.exams.is_results_only IS
  'True for an already-conducted offline exam created via the results-upload flow (no questions; marks entered directly).';
COMMENT ON COLUMN public.exams.source_paper_files IS
  'Array of uploaded paper files: [{path,name,mime,size}] stored in the exam-sheets bucket. NULL when none.';

-- exam-sheets already accepts image/* + application/pdf at 52 MB; flip it public.
UPDATE storage.buckets SET public = true WHERE id = 'exam-sheets';
```

- [ ] **Step 2: Apply to the linked Supabase project**

Two options — pick one deliberately (this writes to the production project `gyymkgohcijeksmrzuyw`):
- Targeted (recommended, avoids pushing unrelated pending migrations): run the SQL above via the Management API SQL endpoint (see the `reference-supabase-management-api-access` memory), then insert the version row into `supabase_migrations.schema_migrations`.
- Or, if the migration history is clean: `npm run db:push`.

Expected: both columns exist on `exams`; `select public from storage.buckets where id='exam-sheets'` returns `true`.

- [ ] **Step 3: Verify columns exist**

Run (Management API SQL or psql):
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='exams'
  AND column_name IN ('is_results_only','source_paper_files');
```
Expected: two rows — `is_results_only boolean NO false`, `source_paper_files jsonb YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026XXXXXXXXXX_already_created_offline_exam.sql
git commit -m "feat(exam): migration for is_results_only + source_paper_files; exam-sheets public"
```

---

## Task 2: Types

**Files:**
- Modify: `src/types/exam.ts:117-144` (`ExamMetadataFormData`), `:180-206` (`ExamSection`), and add `SourcePaperFile`

- [ ] **Step 1: Add the `SourcePaperFile` interface**

Add directly above `export interface ExamMetadataFormData {` (line 117):

```ts
// Uploaded source-paper file reference for the Already-Created offline path.
export interface SourcePaperFile {
  path: string;   // storage path inside the exam-sheets bucket
  name: string;   // original filename
  mime: string;   // content type
  size: number;   // bytes
}
```

- [ ] **Step 2: Add fields to `ExamMetadataFormData`**

Inside `ExamMetadataFormData`, after the `templateId?: string | null;` line (before the closing `}` at line 144):

```ts
  // ── Already-Created (results-only) offline path ──
  // When true, the exam is an already-conducted paper exam: no questions,
  // one synthetic "Total" section, marks entered inline.
  isResultsOnly?: boolean;
  // Uploaded paper files (optional). Maps to exams.source_paper_files.
  sourcePaperFiles?: SourcePaperFile[];
  // The exam total entered in the result-setup prompt. Overrides the
  // question-derived total when isResultsOnly. Maps to exams.total_marks.
  totalMarksOverride?: number | null;
```

- [ ] **Step 3: Add `totalMarks` to `ExamSection`**

Inside `ExamSection`, after `negativeMarking: number;` (line 189):

```ts
  // Explicit section total. Used by the results-only path and persisted to
  // exam_sections.total_marks. When undefined, the save path computes it from
  // the section's question marks.
  totalMarks?: number;
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: exit 0 (no new errors).

- [ ] **Step 5: Commit**

```bash
git add src/types/exam.ts
git commit -m "feat(exam): types for results-only path (SourcePaperFile, section total)"
```

---

## Task 3: Storage helper

**Files:**
- Create: `src/lib/examPaperStorage.ts`

- [ ] **Step 1: Write the helper**

```ts
import { supabase } from "@/integrations/supabase/client";
import type { SourcePaperFile } from "@/types/exam";

const BUCKET = "exam-sheets";

/** Upload one paper file to the public exam-sheets bucket and return its reference. */
export async function uploadExamPaperFile(
  file: File,
  institutionId: string,
): Promise<SourcePaperFile> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${institutionId}/${crypto.randomUUID()}_${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) throw error;
  return { path, name: file.name, mime: contentType, size: file.size };
}

/** Public URL for a stored paper file. */
export function getExamPaperUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/lib/examPaperStorage.ts`
Expected: exit 0; no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/examPaperStorage.ts
git commit -m "feat(exam): exam-paper storage helper (upload + public url)"
```

---

## Task 4: `ExamModeSubToggle` component

**Files:**
- Create: `src/components/exam-creation/components/ExamModeSubToggle.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { cn } from "@/lib/utils";

interface ExamModeSubToggleProps {
  value: boolean; // true = "Already Created" (results-only)
  onChange: (isResultsOnly: boolean) => void;
}

const OPTIONS: { key: boolean; label: string; hint: string }[] = [
  { key: false, label: "Create Exam", hint: "Build sections & questions" },
  { key: true, label: "Already Created", hint: "Upload results of a past paper" },
];

/** Sub-toggle shown under the mode buttons when Offline is selected. */
export function ExamModeSubToggle({ value, onChange }: ExamModeSubToggleProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {OPTIONS.map((opt) => (
        <button
          key={String(opt.key)}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={cn(
            "min-h-[48px] rounded-lg border px-3 py-2 text-left transition-all duration-200",
            value === opt.key
              ? "border-primary bg-primary/10 text-foreground shadow-sm"
              : "border-border bg-background text-foreground hover:bg-muted hover:border-primary/30",
          )}
        >
          <div className="text-sm font-medium">{opt.label}</div>
          <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/exam-creation/components/ExamModeSubToggle.tsx`
Expected: exit 0; no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/exam-creation/components/ExamModeSubToggle.tsx
git commit -m "feat(exam): ExamModeSubToggle (Create Exam / Already Created)"
```

---

## Task 5: `UploadPaperPanel` component

**Files:**
- Create: `src/components/exam-creation/components/UploadPaperPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useRef, useState } from "react";
import { Upload, FileText, Image as ImageIcon, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { uploadExamPaperFile } from "@/lib/examPaperStorage";
import type { SourcePaperFile } from "@/types/exam";

interface UploadPaperPanelProps {
  institutionId: string;
  files: SourcePaperFile[];
  onChange: (files: SourcePaperFile[]) => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 52 * 1024 * 1024;

/** Optional multi-file paper uploader shown in place of the sections builder. */
export function UploadPaperPanel({ institutionId, files, onChange }: UploadPaperPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    if (!institutionId) {
      toast.error("Institution not resolved yet — try again in a moment.");
      return;
    }
    setUploading(true);
    try {
      const accepted: SourcePaperFile[] = [];
      for (const f of Array.from(list)) {
        if (f.size > MAX_BYTES) {
          toast.error(`${f.name} is larger than 52 MB`);
          continue;
        }
        accepted.push(await uploadExamPaperFile(f, institutionId));
      }
      if (accepted.length) onChange([...files, ...accepted]);
    } catch (err) {
      toastError(err, { fallback: "Couldn't upload the file.", context: "uploadExamPaper" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAt = (idx: number) => onChange(files.filter((_, i) => i !== idx));

  return (
    <section className="space-y-3 flex-1 md:rounded-xl md:border md:border-border md:bg-card md:p-6 md:shadow-sm">
      <div className="text-sm font-semibold text-foreground md:text-base">
        Upload exam paper <span className="text-muted-foreground font-normal">(optional)</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Attach photos or a PDF of the question paper. You can skip this and still continue.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group/add w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.07] hover:border-primary/50 transition-all duration-200 p-6 flex flex-col items-center justify-center gap-2 min-h-[120px] disabled:opacity-60"
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : (
          <Upload className="h-6 w-6 text-primary" />
        )}
        <div className="text-sm font-semibold text-primary">
          {uploading ? "Uploading…" : "Tap to upload"}
        </div>
        <div className="text-[11px] text-muted-foreground">Images or PDF · up to 52 MB each</div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li
              key={f.path}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
            >
              {f.mime === "application/pdf" ? (
                <FileText className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="flex-1 truncate text-sm">{f.name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/exam-creation/components/UploadPaperPanel.tsx`
Expected: exit 0; no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/exam-creation/components/UploadPaperPanel.tsx
git commit -m "feat(exam): UploadPaperPanel (optional multi-file paper upload)"
```

---

## Task 6: `ResultSetupSheet` component

**Files:**
- Create: `src/components/exam-creation/screens/ResultSetupSheet.tsx`

**Note:** `metadata.passMarks` is consumed by `useSaveExam` as a **percentage** (it computes `round(passMarks/100 * total)`), so this sheet returns `passPercent` and the caller stores it as `metadata.passMarks`.

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MobileSheet } from "@/components/shared/sheets";
import { toast } from "sonner";
import type { ResultVisibility } from "@/types/exam";

export interface ResultSetupValues {
  totalMarks: number;
  scheduledDate: Date;
  passPercent: number | null;
  resultVisibility: ResultVisibility;
}

interface ResultSetupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onConfirm: (values: ResultSetupValues) => void;
}

const VIS_OPTIONS: { v: ResultVisibility; t: string }[] = [
  { v: "immediate", t: "Immediately" },
  { v: "after_teacher_releases", t: "After teacher releases" },
  { v: "hidden", t: "Hidden from students" },
];

/** Collects total marks + date + pass% + visibility before inline marks entry. */
export function ResultSetupSheet({ open, onOpenChange, isSaving, onConfirm }: ResultSetupSheetProps) {
  const [totalMarks, setTotalMarks] = useState("");
  const [dateStr, setDateStr] = useState(new Date().toISOString().slice(0, 10));
  const [passPercent, setPassPercent] = useState("33");
  const [visibility, setVisibility] = useState<ResultVisibility>("after_teacher_releases");

  const handleConfirm = () => {
    const total = Number(totalMarks);
    if (!Number.isFinite(total) || total <= 0) {
      toast.error("Enter the total marks (greater than 0)");
      return;
    }
    if (!dateStr) {
      toast.error("Pick the date the exam was conducted");
      return;
    }
    const pctRaw = passPercent.trim();
    const pct = pctRaw === "" ? null : Number(pctRaw);
    onConfirm({
      totalMarks: total,
      scheduledDate: new Date(dateStr),
      passPercent: pct != null && Number.isFinite(pct) ? pct : null,
      resultVisibility: visibility,
    });
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      icon={<CalendarClock className="h-4 w-4" />}
      title="Set up results"
      primaryAction={{
        label: "Continue to marks",
        onClick: handleConfirm,
        loading: isSaving,
        disabled: isSaving,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: isSaving }}
    >
      <div className="space-y-4">
        <div>
          <Label className="mb-1 block">Total marks</Label>
          <Input
            type="number"
            min={1}
            className="min-h-[44px]"
            value={totalMarks}
            onChange={(e) => setTotalMarks(e.target.value)}
            placeholder="e.g. 100"
          />
        </div>
        <div>
          <Label className="mb-1 block">Date conducted</Label>
          <Input
            type="date"
            className="min-h-[44px]"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </div>
        <div>
          <Label className="mb-1 block">Pass %</Label>
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={100}
              className="min-h-[44px] pr-10"
              value={passPercent}
              onChange={(e) => setPassPercent(e.target.value)}
              placeholder="optional"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div>
          <Label className="mb-2 block">Who sees results</Label>
          <RadioGroup
            value={visibility}
            onValueChange={(v) => setVisibility(v as ResultVisibility)}
            className="space-y-2"
          >
            {VIS_OPTIONS.map((o) => (
              <label
                key={o.v}
                htmlFor={`rsv-${o.v}`}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 hover:border-primary/40"
              >
                <RadioGroupItem id={`rsv-${o.v}`} value={o.v} />
                <span className="text-sm font-medium">{o.t}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
      </div>
    </MobileSheet>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/exam-creation/screens/ResultSetupSheet.tsx`
Expected: exit 0; no errors. (If `MobileSheet`'s `primaryAction`/`secondaryAction` prop shape differs, match it to the usage in `ReviewPublishScreen.tsx` — same `{ label, onClick, loading?, disabled? }` shape.)

- [ ] **Step 3: Commit**

```bash
git add src/components/exam-creation/screens/ResultSetupSheet.tsx
git commit -m "feat(exam): ResultSetupSheet (total marks + date + pass% + visibility)"
```

---

## Task 7: Wire the Details screen

**Files:**
- Modify: `src/components/exam-creation/screens/ExamDetailsScreen.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports (near the `SectionCard` import at line 29):

```tsx
import { ExamModeSubToggle } from "../components/ExamModeSubToggle";
import { UploadPaperPanel } from "../components/UploadPaperPanel";
```

- [ ] **Step 2: Reset results-only when leaving offline**

Replace `onModeChange` (lines 316-325) with:

```tsx
  const onModeChange = (mode: ExamMode) => {
    const patch: Partial<ExamFormData["metadata"]> = { examMode: mode };
    if (mode === "hybrid" && !formData.metadata.hybridSettings) {
      patch.hybridSettings = { ...DEFAULT_HYBRID_SETTINGS };
    }
    // Results-only only applies to offline; clear it for online/hybrid.
    if (mode !== "offline") patch.isResultsOnly = false;
    updateMetadata(patch);
  };
```

- [ ] **Step 3: Derive `isResultsOnly` and relax `canContinue`**

Replace the `canContinue` block (lines 393-398) with:

```tsx
  const isResultsOnly =
    formData.metadata.examMode === "offline" &&
    formData.metadata.isResultsOnly === true;

  const canContinue =
    formData.metadata.title.trim().length > 0 &&
    formData.context.subjectIds.length > 0 &&
    formData.context.classIds.length > 0 &&
    formData.context.chapterIds.length > 0 &&
    (isResultsOnly || formData.sections.length > 0);
```

- [ ] **Step 4: Render the sub-toggle under the mode buttons**

Inside the mode `<section>`, immediately after the closing of the hybrid `HybridSettingsPanel` block and before `</section>` (after line 639), add:

```tsx
          {formData.metadata.examMode === "offline" && (
            <ExamModeSubToggle
              value={formData.metadata.isResultsOnly === true}
              onChange={(v) => updateMetadata({ isResultsOnly: v })}
            />
          )}
```

- [ ] **Step 5: Swap the sections builder for the upload panel when results-only**

Wrap the existing Sections `<section className="space-y-4 flex-1">` block (lines 643-721) so it only renders when **not** results-only, and add the upload panel for results-only. Change the opening from:

```tsx
        {/* ─── Sections builder ─── */}
        <section className="space-y-4 flex-1">
```
to:
```tsx
        {/* ─── Sections builder (Create Exam) OR paper upload (Already Created) ─── */}
        {isResultsOnly ? (
          <UploadPaperPanel
            institutionId={institutionId}
            files={formData.metadata.sourcePaperFiles ?? []}
            onChange={(f) => updateMetadata({ sourcePaperFiles: f })}
          />
        ) : (
        <section className="space-y-4 flex-1">
```
and change the matching closing `</section>` of that block (line 721) to:
```tsx
        </section>
        )}
```

- [ ] **Step 6: Update the CTA label**

Replace the `StickyBottomCTA` usage (lines 725-729) with:

```tsx
      <StickyBottomCTA
        label={isResultsOnly ? "Continue to results" : "Continue to questions"}
        disabled={!canContinue}
        onClick={onContinue}
      />
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/exam-creation/screens/ExamDetailsScreen.tsx`
Expected: exit 0; no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/exam-creation/screens/ExamDetailsScreen.tsx
git commit -m "feat(exam): Details screen sub-toggle + upload panel for results-only"
```

---

## Task 8: Save path (`useSaveExam`)

**Files:**
- Modify: `src/hooks/useSaveExam.ts`

- [ ] **Step 1: Relax publish validation for results-only**

In `validateExamRequirements` (lines 28-64), replace the `if (publish) { ... }` block (lines 52-61) with:

```ts
  // For publishing, require sections and questions — EXCEPT the results-only
  // path (already-conducted offline exam: no questions, one synthetic section).
  if (publish && formData.metadata.isResultsOnly !== true) {
    if (formData.sections.length === 0) {
      return "At least one section is required to publish";
    }
    const totalQuestions = formData.sections.reduce((sum, s) => sum + s.questions.length, 0);
    if (totalQuestions === 0) {
      return "At least one question is required to publish";
    }
  }
  if (publish && formData.metadata.isResultsOnly === true) {
    if (!formData.metadata.totalMarksOverride || formData.metadata.totalMarksOverride <= 0) {
      return "Total marks are required for an already-created exam";
    }
  }
```

- [ ] **Step 2: Use the total-marks override when results-only**

Replace the total-marks calc (lines 94-98) with:

```ts
      // 1. Total marks: results-only uses the entered override; otherwise sum of question marks.
      const totalMarks =
        formData.metadata.isResultsOnly && formData.metadata.totalMarksOverride != null
          ? formData.metadata.totalMarksOverride
          : formData.sections.reduce(
              (sum, section) =>
                sum + section.questions.reduce((qSum, q) => qSum + q.marks, 0),
              0,
            );
```

- [ ] **Step 3: Write the new columns on UPDATE**

In the UPDATE payload (lines 127-152), add these two keys (e.g. right after `template_id: ...`). The object is already cast `as unknown as Record<string, unknown>`, so no extra cast is needed:

```ts
            is_results_only: formData.metadata.isResultsOnly ?? false,
            source_paper_files: formData.metadata.sourcePaperFiles ?? null,
```

- [ ] **Step 4: Write the new columns on INSERT**

In the INSERT payload (lines 170-198), add the same two keys after `template_id: ...`, and change the cast on the object from `as TablesInsert<"exams">` to `as unknown as TablesInsert<"exams">` (the new columns aren't in the generated types yet):

```ts
            is_results_only: formData.metadata.isResultsOnly ?? false,
            source_paper_files: formData.metadata.sourcePaperFiles ?? null,
          } as unknown as TablesInsert<"exams">)
```

- [ ] **Step 5: Persist `exam_sections.total_marks`**

In the section INSERT (lines 249-262), add a `total_marks` field. `total_marks` is an existing column in the generated types, so no cast change is needed. Replace the insert object with:

```ts
          .from("exam_sections")
          .insert({
            exam_id: examId,
            title: normalizeText(section.title),
            description: normalizeText(section.description || "") || null,
            instructions: normalizeText(section.instructions || "") || null,
            section_order: section.sectionOrder,
            total_marks:
              section.totalMarks ??
              section.questions.reduce((a, q) => a + q.marks, 0),
            randomize_order: section.randomizeOrder ?? false,
            partial_marks_allowed: section.partialMarksAllowed ?? false,
            negative_marking_enabled: section.negativeMarkingEnabled ?? false,
          } as TablesInsert<"exam_sections">)
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/hooks/useSaveExam.ts`
Expected: exit 0; no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSaveExam.ts
git commit -m "feat(exam): save path for results-only (relaxed publish, total override, section total_marks)"
```

---

## Task 9: Orchestrate the results-only flow (`ExamCreationFlow`)

**Files:**
- Modify: `src/components/exam-creation/ExamCreationFlow.tsx`

- [ ] **Step 1: Add imports + screen state**

Add these three imports near the existing screen imports (line 32):

```tsx
import { ResultSetupSheet, type ResultSetupValues } from "./screens/ResultSetupSheet";
import { OfflineMarksEntryScreen } from "./screens/OfflineMarksEntryScreen";
import type { SourcePaperFile } from "@/types/exam";
```

Change the `Screen` type (line 246) to:

```tsx
type Screen = "details" | "questions" | "review" | "resultsMarks";
```

Add state alongside the other `useState`s (after line 275):

```tsx
  const [resultSetupOpen, setResultSetupOpen] = useState(false);
```

- [ ] **Step 2: Map new fields in the edit loader**

In `useExamFormLoader`'s returned `metadata` object (after `templateId: ... ,` near line 232), add:

```ts
          isResultsOnly: (row.is_results_only as boolean) ?? false,
          sourcePaperFiles:
            (row.source_paper_files as SourcePaperFile[] | null) ?? [],
          totalMarksOverride: (row.total_marks as number) ?? null,
```

- [ ] **Step 3: Route edit-mode results-only exams straight to marks**

In the hydrate effect (lines 288-299), after `form.loadForm(loadedExam); setHydrated(true); setTemplateOpen(false);` add:

```tsx
      if (loadedExam.metadata.isResultsOnly) setScreen("resultsMarks");
```

- [ ] **Step 4: Fork Continue-from-Details**

Replace `handleContinueFromDetails` (lines 412-414) with:

```tsx
  const handleContinueFromDetails = () => {
    if (form.formData.metadata.isResultsOnly) {
      setResultSetupOpen(true);
    } else {
      setScreen("questions");
    }
  };
```

- [ ] **Step 5: Add the result-setup confirm handler**

Add after `handleContinueFromQuestions` (after line 427):

```tsx
  const handleConfirmResultSetup = (values: ResultSetupValues) => {
    const total = values.totalMarks;
    const syntheticSection: ExamSection = {
      tempId: `temp_${Date.now()}_total`,
      title: "Total",
      sectionType: "subjective",
      description: "",
      instructions: "",
      sectionOrder: 1,
      defaultMarks: total,
      negativeMarking: 0,
      questions: [],
      totalMarks: total,
      chapterIds: [...form.formData.context.chapterIds],
    };
    const nextForm: ExamFormData = {
      ...form.formData,
      sections: [syntheticSection],
      metadata: {
        ...form.formData.metadata,
        isResultsOnly: true,
        scheduledDate: values.scheduledDate,
        totalMarksOverride: total,
        // useSaveExam treats passMarks as a percentage.
        passMarks: values.passPercent,
        resultVisibility: values.resultVisibility,
      },
    };
    form.loadForm(nextForm);
    saveExam.mutate(
      { formData: nextForm, publish: true },
      {
        onSuccess: (result) => {
          form.setExamId(result.examId);
          setResultSetupOpen(false);
          setScreen("resultsMarks");
        },
        onError: (err: Error) =>
          toastError(err, {
            fallback: "Couldn't save the exam.",
            context: "saveResultsOnlyExam",
          }),
      },
    );
  };
```

- [ ] **Step 6: Render the sheet + inline marks screen**

In the returned JSX, add the marks screen alongside the others (after the `review` screen block at line 471):

```tsx
      {screen === "resultsMarks" && form.formData.examId && (
        <OfflineMarksEntryScreen examId={form.formData.examId} />
      )}
```

And add the sheet next to `TemplatePickerSheet` (after line 478):

```tsx
      <ResultSetupSheet
        open={resultSetupOpen}
        onOpenChange={setResultSetupOpen}
        isSaving={saveExam.isPending}
        onConfirm={handleConfirmResultSetup}
      />
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/exam-creation/ExamCreationFlow.tsx`
Expected: exit 0; no errors. (Confirm the placeholder import line from Step 1 was NOT added — only the three real imports.)

- [ ] **Step 8: Build (first full buildable increment)**

Run: `npx vite build`
Expected: exit 0 (bundle-size warnings are OK).

- [ ] **Step 9: Commit**

```bash
git add src/components/exam-creation/ExamCreationFlow.tsx
git commit -m "feat(exam): orchestrate results-only flow (setup sheet -> save -> inline marks)"
```

---

## Task 10: All-Exams badge + query columns

**Files:**
- Modify: `src/pages/ExamsPage.tsx`, `src/hooks/useDashboardData.ts`, `src/hooks/useCoordinatorClasses.ts`

- [ ] **Step 1: Extend `ExamRow`**

In `src/pages/ExamsPage.tsx`, in the `ExamRow` type (lines 83-103), add after `is_offline?: boolean;` (line 89):

```tsx
  is_results_only?: boolean;
```

- [ ] **Step 2: Render the "Results upload" badge (grid card)**

In `src/pages/ExamsPage.tsx`, immediately after the exam-mode `Badge` closing tag (after line 593, inside the `flex items-center gap-1.5` row), add:

```tsx
                      {exam.is_results_only && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-medium px-1.5 py-0 h-5 bg-white/70 backdrop-blur-sm border-[#fa920e]/40 text-[#fa920e]"
                        >
                          Results upload
                        </Badge>
                      )}
```

- [ ] **Step 3: Add `is_results_only` to the dashboard exam selects**

In `src/hooks/useDashboardData.ts`, add `is_results_only` to each of the three `select` strings (lines 133, 315, 350). For example change line 133 from:
```ts
          id, title, status, exam_mode, is_offline, scheduled_date, total_marks,
```
to:
```ts
          id, title, status, exam_mode, is_offline, is_results_only, scheduled_date, total_marks,
```
And likewise add `is_results_only` to the two teacher selects (lines 315 and 350), e.g.:
```ts
          id, title, status, exam_mode, is_offline, is_results_only, scheduled_date, total_marks, created_at, created_by,
```

- [ ] **Step 4: Add `is_results_only` to the coordinator exam select**

In `src/hooks/useCoordinatorClasses.ts`, find the `from("exams").select(` used by `useCoordinatorExams` and add `is_results_only` to the column list (mirror the dashboard selects). If the select uses `exam_mode, is_offline`, insert `is_results_only` right after `is_offline`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/pages/ExamsPage.tsx src/hooks/useDashboardData.ts src/hooks/useCoordinatorClasses.ts`
Expected: exit 0; no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ExamsPage.tsx src/hooks/useDashboardData.ts src/hooks/useCoordinatorClasses.ts
git commit -m "feat(exam): All-Exams 'Results upload' badge + select is_results_only"
```

---

## Task 11: Student-facing question-paper viewer

**Files:**
- Modify: `src/components/student/ResultDetailsSheet.tsx`

- [ ] **Step 1: Add imports**

Add `FileText` to the existing `lucide-react` import in the file, and add:

```tsx
import { getExamPaperUrl } from "@/lib/examPaperStorage";
import type { SourcePaperFile } from "@/types/exam";
```

- [ ] **Step 2: Fetch `source_paper_files` in the result query**

In the result `useQuery` (lines 85-100), change the joined `exams (...)` select to include `source_paper_files`:

```ts
            exams (title, total_marks, pass_marks, duration_minutes, source_paper_files)
```

Then in the returned object (lines 107-117), add (after `sectionScores,`):

```ts
        sourcePaperFiles:
          (((data.student_exam_attempts?.exams as {
            source_paper_files?: SourcePaperFile[] | null;
          } | undefined)?.source_paper_files) ?? []) as SourcePaperFile[],
```

- [ ] **Step 3: Render the "Question paper" card**

Immediately after the Section-Breakdown `Card` block (around line 561, the block guarded by `result.sectionScores && Object.keys(result.sectionScores).length > 0`), add:

```tsx
      {result.sourcePaperFiles && result.sourcePaperFiles.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Question paper</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.sourcePaperFiles.map((f) => (
              <a
                key={f.path}
                href={getExamPaperUrl(f.path)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:border-primary/40"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">View</span>
              </a>
            ))}
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/student/ResultDetailsSheet.tsx`
Expected: exit 0; no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/student/ResultDetailsSheet.tsx
git commit -m "feat(exam): student question-paper viewer on offline results"
```

---

## Task 12: Full verification (build + manual E2E)

**Files:** none (verification only)

- [ ] **Step 1: Zero-error contract (CLAUDE.md §5a)**

Run, in order:
```bash
npx tsc --noEmit
npx eslint src/types/exam.ts src/lib/examPaperStorage.ts src/components/exam-creation/components/ExamModeSubToggle.tsx src/components/exam-creation/components/UploadPaperPanel.tsx src/components/exam-creation/screens/ResultSetupSheet.tsx src/components/exam-creation/screens/ExamDetailsScreen.tsx src/hooks/useSaveExam.ts src/components/exam-creation/ExamCreationFlow.tsx src/pages/ExamsPage.tsx src/hooks/useDashboardData.ts src/hooks/useCoordinatorClasses.ts src/components/student/ResultDetailsSheet.tsx
npx vite build
```
Expected: all exit 0 (bundle-size warnings OK).

- [ ] **Step 2: Manual E2E — create with paper**

`npm run dev`, log in as a teacher. New exam → **Offline** → **Already Created** appears → pick class/subject/chapters → upload an image + a PDF → "Continue to results" → enter Total 100, date today, pass 33%, "After teacher releases" → Continue to marks → the student list shows one mark column → enter marks for ≥2 students, mark one **Absent** → Save.
Expected: success toast; lands on /exams.

- [ ] **Step 3: Manual E2E — create without paper**

Repeat Step 2 but **skip** the upload (Continue with no file).
Expected: flow completes identically; no errors.

- [ ] **Step 4: Manual E2E — All-Exams badge + edit**

On /exams the new exam shows offline (amber) styling + a **"Results upload"** chip. Click it → the offline marks sheet opens with previously-entered marks hydrated → change a mark → Save.
Expected: badge visible; marks persist on reopen.

- [ ] **Step 5: Manual E2E — student view**

Log in as one of the graded students → My Results → open the exam.
Expected: offline-format result (score · % · pass/fail · a "Total" section row). If a paper was uploaded, a **"Question paper"** card lists the files and each link opens the file.

- [ ] **Step 6: Regression — normal offline exam**

Create a normal offline exam (Create Exam) with sections + questions, publish, open its marks sheet.
Expected: each section's max marks is correct (validates the `exam_sections.total_marks` persistence change).

- [ ] **Step 7: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(exam): results-only flow verification fixups"
```

---

## Self-review notes

- **Spec coverage:** sub-toggle (T7) · optional multi-file upload (T3/T5/T7) · skip Questions, inline marks (T9) · total-marks prompt (T6/T9) · single synthetic "Total" section + reused offline pipeline (T8/T9) · publish with zero questions (T8) · All-Exams badge (T10) · student offline-format results + paper viewer (T11) · DB columns + public bucket (T1). All spec sections map to a task.
- **Type consistency:** `SourcePaperFile` (T2) is the single shape used by the storage helper (T3), `UploadPaperPanel` (T5), `ExamCreationFlow` loader (T9), and `ResultDetailsSheet` (T11). `ResultSetupValues` (T6) is consumed only by `handleConfirmResultSetup` (T9). `metadata.totalMarksOverride` (T2) is written in T9 and read in T8. `ExamSection.totalMarks` (T2) is set in T9 and read in T8.
- **Known pre-existing quirk (out of scope):** `metadata.passMarks` is interpreted as a percentage by `useSaveExam` but as absolute marks by `ReviewPublishScreen`. This plan feeds `passMarks` as a percentage (correct for `useSaveExam`); it does not attempt to fix the unrelated Review screen.
