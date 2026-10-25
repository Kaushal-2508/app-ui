---
name: salci-module-notes
description: SALCI module implementation notes — Mobile Exam Creation Flow, Exam Templates blueprint storage, question bank, question and per-option diagrams, exam delete, the explicit Absent state, auto-grading and the two exam_questions.options shapes, Teacher Subject Assignment dual-table invariant, Service Worker, Chapter–Topic hierarchy, onboarding journey, and voice dictation. Use whenever touching exams, exam_questions, question_bank, templates, get_exam_paper, useDeleteExam, DiagramField/QuestionImageUpload/OptionImage, offline marks and is_absent, syllabus/chapters, teacher class+subject assignment, service worker caching, or PostgREST joins involving exams/classes/subjects/profiles.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# SALCI Module Implementation Notes

Consult this skill before writing code that touches any of the modules below. These are hard-won invariants and PostgREST gotchas that are not obvious from the codebase alone.

## 1. Command Center module (REBUILT 2026-06-02 — invoke `command-center-dashboards` skill)

**The old gradient/tab Command Center UI was deleted** (commit c90a11a removed `AlertsStrip`, `KpiRow`, `AcademicsPanel`, `QuickActions`). `CommandCenterPage.tsx` is now a read-only composition over the `dash_*` SECURITY DEFINER RPC family, with a parallel `dash_scoped_*` family powering the coordinator/teacher snapshot at `/school/snapshot`. Full invariants (scope context, 20-flag catalog, both-RPC-variants rule, tile gating) live in the **`command-center-dashboards`** skill — do not build dashboard panels from this section.

Still-true facts that survive the rebuild:
* **`src/hooks/useCommandCenter.ts` survives but is mounted ONLY inside the lazy `CbseReportsModal`** (kebab action on CommandCenterPage). Never import it into a page body — it fans out a dozen fee/HR/leave/exam queries (§23 load problem the rebuild removed).
* **Reports:** `src/utils/generateCBSEReports.ts` (three CBSE PDF reports, auto-excludes feature-gated sections) + `src/utils/generateOnboardingReport.ts` ("onboarding" type, `.xlsx` via `xlsx@0.18.5`, RPC `get_institution_onboarding_progress(_institution_id)`, Summary + Staff Progress sheets). Both behind `ReportModal` inside `CbseReportsModal`. The primary "Download Report" on the page is the new scope-aware `DashboardSnapshotReport` (print-based).
* **Settings doc:** `src/components/settings/CommandCenterDocument.tsx` — super-admin Settings tab.

### PostgREST gotchas
* Multiple FKs to same target (e.g. `student_exam_attempts` → `profiles` has `student_id_fkey` + `finalized_by_fkey`): `profiles:student_id(...)` is ambiguous and 400s. Use explicit FK hint `profiles!fk_name(...)` or query a view with a single FK.
* `exams` and `classes` are linked **only** through the `exam_classes` junction — no direct join works.
* Prefer `student_performance_snapshots` over composing `final_results` + `student_exam_attempts` for student-level performance reads.
* Subjects live in `universal_subjects`, not `subjects`. No `is_global` column — globals have `institution_id IS NULL`. Query with `.or('institution_id.eq.{id},institution_id.is.null')`. For class-scoped subjects, join via `subject_class_mappings` (see `useExamSubjectsForClass`).

## 2. Mobile-First Exam Creation Flow (replaces ExamWizard)

### Migration
`supabase/migrations/20260407120000_exam_creation_flow.sql` — adds availability window, `proctoring_config` JSONB, `result_visibility`, `visible_to_students`, `is_locked_for_edits`/`locked_at`/`current_version`, `template_id` to `exams`; `randomize_order`/`partial_marks_allowed`/`negative_marking_enabled` to `exam_sections`; new tables `exam_templates` and `offline_section_marks`; enum values `comprehension`/`numerical`/`match_column`; trigger `lock_exam_on_first_attempt`; helper RPC `bump_exam_version(_exam_id)`. `prevent_exam_structure_change` gates on `is_locked_for_edits` rather than draft status.

### Frontend
* **Pages:** `src/pages/CreateExam.tsx`, `src/pages/EditExam.tsx`, `src/pages/OfflineMarksEntryPage.tsx` — thin wrappers.
* **Orchestrator + screens:** `src/components/exam-creation/` — `ExamCreationFlow`, screens (`ExamDetailsScreen`, `SectionConfigSheet`, `QuestionsScreen`, `ReviewScreen`, `OfflineMarksEntryScreen`, `RecheckFlow`, `DraftsTab`), shared primitives (`StickyBottomCTA`, `TypeGroupPill`).
* **Reused from old wizard:** `AIGenerateQuestions.tsx`, `ManualQuestionForm.tsx`, `QuestionBankSelector.tsx` under `src/components/exam/questions/`. Everything else under `src/components/exam/` was deleted.
* **Hooks:** `useExamForm`, `useSaveExam` (extended); new `useExamTemplates`, `useExamDrafts`, `useExamLockStatus`, `useOfflineMarksEntry`.
* **Types:** `src/types/exam.ts` extended with availability window, proctoring, result visibility, version/lock fields.
* **Mobile constraints:** min 44px tap targets, stacked layouts, bottom sheets, react-hook-form + zod.

### Class dropdown — canonical group labels + display sections (fixed 2026-07-20)
`useExamClassHierarchy` groups sections under the **embedded `class_groups.name`** (`class_groups:class_group_id (name)` in all three role queries — admin/coordinator/teacher). NEVER derive the group label by regex-stripping trailing letters off `classes.name`: the old blind `/[a-z]$/` strip invented phantom classes for letter-only names ("UKG" → "UK", "Nursery" → "Nurser") — an Alliance UKG-C class teacher was shown a nonexistent "UK: C". The `legacyBaseName` fallback (embed missing) strips a trailing marker only when it equals that row's own `section`. `ClassSection.displaySection` (from `getDisplaySection` — AISB renders LKG/UKG letters as colors A→Red/B→Green/C→Blue) MUST be used for all user-facing section text in the picker (trigger label + popover rows in `ExamDetailsScreen`); raw `section` letters show labels that don't exist elsewhere in the portal.

### Access control
* `/scan-sheets` and `/ocr-review` are **admin-only** (school_admin / super_admin / super_school_admin). Teacher/coordinator nav links removed from `RoleBasedDashboard.tsx`, `AppSidebar.tsx`, `tourSteps.ts`. Scan Sheets button in `EvaluationsPage.tsx` gated via `useUserRole().isSchoolAdmin || isSuperAdmin`.

### Versioning / lock semantics
On first `student_exam_attempts` insert, trigger sets `exams.is_locked_for_edits = true`. Editing a locked exam requires the `bump_exam_version(exam_id)` RPC, which bumps `current_version` and unlocks the exam.

### Proctoring & visibility (`src/types/exam.ts` + `useSaveExam.ts`)
* `DEFAULT_PROCTORING_CONFIG` has all four toggles set to `true` (webcam, tabSwitchLock, fullscreenLock, copyPasteDisable).
* "Visible to students" UI toggle removed. `visible_to_students` is derived from the `publish` boolean in `useSaveExam` — ON when publishing, OFF for drafts/templates.

### Review & Publish header (`src/components/exam-creation/screens/ReviewPublishScreen.tsx`)
* Online exam → **Preview** button (Eye icon) opens Dialog rendering full exam as students see it.
* Offline exam → **Print** button (Printer icon) opens a new window with a fully-formatted HTML exam paper and auto-triggers `window.print()`. Does NOT call `window.print()` on the current tab.

### Schedule & publish — late entry semantics
* No availability-window datetime pickers. Uses a single "Late entry" minutes field (`ExamMetadataFormData.lateEntryMinutes`, default 15).
* `useSaveExam.ts` → `computeAvailabilityWindow(formData)` maps `startTime + lateEntryMinutes` → DB columns `availability_start` (= exam start) and `availability_end` (= start + late entry minutes). DB schema unchanged; `availabilityStart/availabilityEnd` remain on the type as legacy read fields.
* Validation requires scheduledDate, startTime, `durationMinutes > 0` only.

### SectionCard count input (`src/components/exam-creation/components/SectionCard.tsx`)
Whole-number-only: `step={1}` + `Math.round(count)` in `handleCountChange`. Marks still accept fractional values (`step={0.25}`).

### Subjective question forms (`src/components/exam-creation/forms/`)
* `SubjectiveForm.tsx` handles `short_answer` and `long_answer`. Collects question text, marks, difficulty, optional explanation. **No answer field, no `____` blanks, no evaluation keywords.**
* `FillInBlankForm` is only used for `fill_blank` (still requires `____`).
* `formForType()` in `forms/index.ts` routes: `mcq/checkbox/true_false → MCQForm`, `fill_blank → FillInBlankForm`, `short_answer/long_answer → SubjectiveForm`, `matching/match_column → MatchColumnForm`, `numerical → NumericalForm`, `comprehension/case_study → ComprehensionForm`. Default fallback: `SubjectiveForm`.

### Question editing (`QuestionsScreen.tsx` + `ManualEntrySheet.tsx`)
Pencil buttons set `editingQuestion`, `pickerCtx`, `activeMethod="manual"` directly — skipping `MethodPickerSheet` and going straight to `ManualEntrySheet` with the existing question's data. `ManualEntrySheet` accepts `editingQuestion?` and `onUpdateQuestion?`; form component receives `initial={editingQuestion}` and `key={editingQuestion?.tempId ?? "new"}`.

## 3. Teacher Subject Assignment — dual-table invariant

### Staff assignment writes go through RPCs ONLY (2026-08-07 incident — do not regress)

Two Alliance teachers lost every `class_assignments` row and with them their whole portal (subjects, classes, exam views) during a routine reassignment. Cause: every assign surface did **DELETE-all-then-INSERT as separate client requests** — an empty save, a stale selection or a failed insert left zero rows, with **no audit trail**, so the action could never be attributed. Never write `class_assignments` directly from the client again. Use:

| Surface | Write path |
|---|---|
| `AssignTeacherClassSubjectDialog` (teacher × subject) | `setStaffClassAssignments({ kind: "subject" })` → `set_staff_class_assignments` |
| `AssignClassesDialog` (coordinator/teacher class links) | `setStaffClassAssignments({ kind: "bare" })` |
| `AssignTeachersDialog` (class roster) | `setClassTeachers` → `set_class_teachers` |
| Subject delete / unassign | `deleteInstitutionSubject` / `unassignSubjectFromClass` (`src/lib/subjectAdmin.ts`) |

Guarantees these RPCs provide, all of which were missing before: one transaction; **diff, not delete-all** (unchanged rows keep `assigned_at`/`assigned_by`); a `_kind` discipline so a subject-level save can never destroy bare class links and vice versa; `set_class_teachers` preserves the subject rows of teachers who stay; blockers named *before* any write; `log_audit_event` delta rows; `pg_advisory_xact_lock` per target; anon revoked by name.

**Every DELETE on `class_assignments` is captured in `class_assignment_deletions`** (AFTER DELETE trigger, SECURITY DEFINER, exception-swallowing so it can never block a delete). It has **no FKs on purpose**, so rows survive the class/profile cascade that removed them. Restore is one statement:

```sql
INSERT INTO class_assignments (user_id, class_id, subject_id, role)
SELECT user_id, class_id, subject_id, role FROM class_assignment_deletions
WHERE user_id = '<uuid>' AND deleted_at > now() - interval '30 days'
ON CONFLICT (user_id, class_id, subject_id) DO NOTHING;
```

UI rule: any save that would REMOVE existing assignments must show an AlertDialog naming the count and the classes/teachers first. A destructive bulk action must never look like an ordinary save.

Teacher class+subject assignments must be written to **two** tables:
1. **`class_assignments`** — drives "what is this teacher allowed to teach" (used by `useTeacherAssignedSubjects`, RLS, attendance).
2. **`subject_class_mappings`** — canonical `(institution_id, class_id, subject_id)` map that powers `useClassSubjects`, syllabus, study materials, admin exam creation.

`AssignTeacherClassSubjectDialog` now upserts both; migration `20260408120000_backfill_subject_class_mappings_from_class_assignments.sql` patches history. **Any new code path that creates a teacher↔(class, subject) link must upsert into both tables and invalidate `["class-subjects"]`, `["subject-class-mappings"]`, and `["teacher-assigned-subjects"]`.**

### Subject dropdown in new exam-creation flow
`src/components/exam-creation/screens/ExamDetailsScreen.tsx`:
* **Teacher:** source = `useTeacherAssignedSubjects().flat`, filtered to `selectedClassIds`. Do NOT route teachers through `useClassSubjects` — returns empty if `subject_class_mappings` rows are missing, re-introducing the original bug.
* **Admin/coordinator:** source = `useClassSubjects(primaryClassId, institutionId).all`.
* Stale-selection guard: `useEffect` clears `formData.context.subjectIds` when previously chosen subject is no longer in the visible list.

## 4. Service Worker Update System & Caching

### Architecture
`public/sw.js`: push notifications + cache-first static asset loading. Vite content-hashes filenames (`assets/[name].[hash].js`) so stale entries expire by reference.

### Lifecycle
* Install: `self.skipWaiting()`.
* Activate: `clients.claim()`.
* Fetch: cache-first for `script`/`style`; network-first everywhere else (Supabase RPCs, APIs).

### Build-id stamping (CRITICAL — don't revert)
`public/sw.js` holds the placeholder `const CACHE = 'salci-__BUILD_ID__';`. The `swBuildIdPlugin` in [vite.config.ts](vite.config.ts) replaces `__BUILD_ID__` in `dist/sw.js` at `closeBundle` time with `${Date.now().toString(36)}-${random}`. Without this, `sw.js` is byte-identical across deploys, so browsers never detect an update, `controllerchange` never fires, and users are stuck on the old build until they hard-refresh. This was the root cause of the 10-day-stale-client bug fixed 2026-04-19. The `__BUILD_ID__` placeholder MUST appear literally in `public/sw.js` and the plugin MUST run on every production build — do not precompute it into the source file.

### PROD gate + dev self-heal (2026-06-06, commit 91c992b — don't remove either branch)
Registration is wrapped in `if (import.meta.env.PROD && "serviceWorker" in navigator)`. In dev, `swBuildIdPlugin` never runs (`apply: "build"`), so `public/sw.js` serves with the literal `salci-__BUILD_ID__` cache name and its cache-first handler pins dev tabs to stale Vite ESM chunks across server restarts ("my code changes don't apply"). The `else if (import.meta.env.DEV)` branch actively unregisters any leftover SW and deletes all CacheStorage keys starting with `"salci-"` — needed because a previously-registered SW otherwise persists forever. PROD behavior below is unchanged.

### Update flow (src/main.tsx)
1. On registration, hook `visibilitychange` + hourly `setInterval` → call `registration.update()` so installed PWAs (suspended, not closed) detect new deploys the moment the user foregrounds them.
2. `hadController = !!navigator.serviceWorker.controller` captured BEFORE registration, used to skip the first-ever install reload (no point reloading a page the user just opened).
3. On `controllerchange` (fires only on actual SW swap thanks to skipWaiting+claim):
   1. If no `form[data-dirty="true"]` exists → auto-reload.
   2. If a dirty form is present → dispatch `salci-update-ready` custom event.

### Soft toast (src/App.tsx)
Listens for `salci-update-ready`, shows a persistent Sonner toast with manual "Reload" button.

### Dirty form contract
```tsx
formRef.current?.setAttribute('data-dirty', 'true');   // on first edit
formRef.current?.setAttribute('data-dirty', 'false');  // after save
```
Current candidates: `CreateExam.tsx`, `FeeCollectionPanel.tsx`, `EvaluationWorkspace.tsx`.

### View Transitions
`src/index.css` has `::view-transition-group/old/new` rules (0.25s, ease-out).

## 5. Exam Templates — Blueprint-Only Storage

Templates store only the **structural blueprint**, never questions or context:
* `examMode` (online/offline)
* Per section: `title`, `sectionType`, `allowedQuestionTypes`, `questionTypeCounts`, `questionTypeMarks`, `defaultMarks`, `negativeMarking`, `instructions`

### Types (`src/types/exam.ts`)
```ts
interface TemplateBlueprintSection { /* structural fields only */ }
interface TemplateBlueprint { examMode: ExamMode; sections: TemplateBlueprintSection[]; }
interface ExamTemplate { /* ... */ templateData: TemplateBlueprint | ExamFormData; }
```

### Save (`useSaveExamTemplate` in `src/hooks/useExamTemplates.ts`)
Extracts only the blueprint before insert. `subject_id` forced to `null`. `subjectId` param removed.

### Load (`handleUseTemplate` in `ExamCreationFlow.tsx`)
* Detect blueprint via `"examMode" in data && !("context" in data)`.
* Blueprint path: build empty `ExamSection[]` (fresh tempIds, `questions: []`) from blueprint, merge into current `form.formData` preserving creator's context/metadata.
* Legacy path: strip questions, copy section structure only, preserve creator's context.
* **Never** copy context, metadata, or questions from the template.

### Migration
`supabase/migrations/20260410120000_fix_exam_templates_subject_fk.sql` repoints `exam_templates.subject_id` FK from `subjects` → `universal_subjects`.

## 6. Chapter–Topic Hierarchy

### Terminology
* **Chapter** = row in `syllabus_topics` (DB name unchanged; UI says "chapter").
* **Topic** = row in `chapter_topics`. Fine-grained subtopic within a chapter, scoped per institution.

### Database
* `chapter_topics` (`20260413120000_create_chapter_topics.sql`): `id`, `institution_id`, `class_id`, `subject_id` (→ universal_subjects), `chapter_id` (→ syllabus_topics), `name`, `created_at`. Unique: `(institution_id, class_id, subject_id, chapter_id, name)`. RLS: super_admin full; members read; teacher/coordinator/school_admin/super_school_admin insert+update; school_admin/super_school_admin delete.
* `question_bank` new columns (`20260413120001_question_bank_chapter_topic_and_parent.sql`):
  - `chapter_topic_id UUID` → `chapter_topics(id) ON DELETE SET NULL`
  - `parent_question_id UUID` → `question_bank(id) ON DELETE CASCADE` (comprehension/case-study parent-child)
  - `sub_question_count INTEGER` (parent row)
  - `sequence_order INTEGER` (sub-question ordering)

### `topic_id` vs `chapter_topic_id` on `question_bank`
* `topic_id` → `syllabus_topics` = **chapter**.
* `chapter_topic_id` → `chapter_topics` = **topic within chapter**.

### Hooks
`src/hooks/useChapterTopics.ts`:
* `useChapterTopics({ institutionId, classId, subjectId, chapterId })` — topics for one chapter.
* `useChapterTopicsByChapters({ ..., chapterIds })` — across multiple chapters.
* `useUpsertChapterTopic()` — select-first upsert. Invalidates `["chapter-topics", ...]` and `["chapter-topics-multi"]`.

### Exam-level chapter selection
* Types: `ExamContextFormData.chapterIds: string[]`; `ExamSection.chapterIds?: string[]`.
* Hook `useChaptersForExam({ classId, subjectId })` — queries `topic_class_mappings` joined to `syllabus_topics`; falls back to all active `syllabus_topics` for the subject. Query key: `["chapters-for-exam", classId, subjectId]`.
* `ExamDetailsScreen`: chapter multi-select after subject, gated on class+subject. "Select all" header, scrollable, count footer. Clears `chapterIds` on class/subject change. `canContinue` requires `chapterIds.length > 0`.
* `SectionConfigSheet`: accepts `availableChapters?: ChapterInfo[]`. Single → read-only; multiple → checkbox multi-select.
* `useSaveExam`: update deletes `exam_topics` alongside `exam_classes`/`exam_subjects`; insert writes `formData.context.chapterIds` as `exam_topics` rows (`topic_id` column).
* Edit-mode loader populates `context.chapterIds` from `exam_topics.topic_id`.
* `useExamForm` validation: requires `chapterIds.length > 0`.

### AI Generation (Phase 3) — `AIGenerateQuestions.tsx`
Pre-scoped to single section + question type via props:
```ts
interface AIGenerateQuestionsProps {
  section: ExamSection;
  questionType: QuestionType;
  remainingSlots: number;
  classId: string; subjectId: string; subjectName?: string; institutionId: string;
  onAddQuestion: (sectionTempId: string, question: Omit<ExamQuestion, "tempId">) => void;
  onComplete?: () => void;
}
```
* One row per chapter in `section.chapterIds` (via `useChaptersForExam`). "Chapter-level" count + expandable topic rows. `TopicInput` with suggestions from `useChapterTopicsByChapters`, grouped by `chapter_id`; allows typing a new topic name (upserted on acceptance). Init: `Math.floor(remainingSlots / n)` per chapter, remainder to first. Adding a topic row decreases the chapter's "no-topic" count by the same delta.
* Running total: green "Ready" badge when `total === remainingSlots`; Generate disabled on mismatch.
* Case study / comprehension: passage-based mode. Inputs: number of passages, per-passage sub-question count. Single API call with combined chapter context, `caseStudyCount`, `subQuestionsPerCaseStudy[]`.
* Generation: standard types run sequentially, one per chapter+topic combo with count > 0. Case study: single request.
* **Dual-write on accept:** add to section via `onAddQuestion` AND direct supabase insert into `question_bank` with `topic_id = chapterId`, `chapter_topic_id = upserted topic ID` (via inline `upsertTopicInline` helper — avoids `useUpsertChapterTopic` mutation to prevent toast spam). Case study: parent row first (with `sub_question_count`), then sub-questions with `parent_question_id` + `sequence_order`.
* `AIGenerateSheet` passes `classId`, `subjectId`, `subjectName`, `institutionId` through. `ContextStrip` removed.

### Edge function (`supabase/functions/generate-questions/index.ts`)
New request fields: `chapterName`, `topicName`, `questionType` (single), `questionCount` (exact), `caseStudyCount`, `subQuestionsPerCaseStudy[]`. `chapterName` maps to `customTopic` internally; with `topicName`: `"chapterName — topicName"`. Single `questionType` overrides `questionTypes[]`; `questionCount` overrides `count`. System prompt: "CRITICAL: Generate EXACTLY the number of questions requested." User prompt adds `**Chapter:**` and `**Specific Topic within Chapter:**` lines. Subject name fallback: resolves from `universal_subjects` when `subjectName === 'General'`. Fully backward compatible.

### Question bank storage (direct inserts, not `useBulkAddQuestionsToBank`)
Bulk hook doesn't support `chapter_topic_id`, `parent_question_id`, `sub_question_count`, `sequence_order`. Standard: single insert with `topic_id` + `chapter_topic_id`. Case study: parent with `sub_question_count`, then subs with `parent_question_id` + `sequence_order`.

### Phase 4 — `useQuestionBank` filters
* `chapterTopicId?: string` → `.eq("chapter_topic_id", ...)`.
* `excludeSubQuestions?: boolean` → `.is("parent_question_id", null)` — hides case-study children from pickers.
* Existing `topicId` maps to `question_bank.topic_id` (chapter).

### Phase 4 — `QuestionBankSelector.tsx`
Pre-scoped to single section + type, reads `question_bank` (not `exam_questions`).
```ts
interface QuestionBankSelectorProps {
  institutionId: string; classId: string; className?: string;
  subjectId: string; subjectName?: string;
  sectionChapterIds: string[];
  questionType: QuestionType;
  remainingSlots: number;
  section: ExamSection;
  onAddQuestion: (sectionTempId: string, question: Omit<ExamQuestion, "tempId">) => void;
  onComplete?: () => void;
}
```
* Banner with `slotsUsed / remainingSlots` badge. Read-only Class + Subject.
* Chapter: read-only if `sectionChapterIds.length === 1`, Select dropdown otherwise (names from `useChaptersForExam`).
* Topic: Select with "All topics"; **hidden when `topics.length === 0`**. Resets to "all" on chapter change.
* Type pre-filtered via `toDbQuestionType(questionType)`. `excludeSubQuestions: true`.
* Checkbox disable: `disabled = !checked && (slotsUsed >= remainingSlots)`. Toggle guards `next.size < remainingSlots`.
* `QuestionBankSheet` passes full exam context; `sectionChapterIds={section.chapterIds ?? []}`. Old `subjectIds/topicIds/customTopicIds` props removed. `ContextStrip` removed.

### Phase 4 — `ManualQuestionForm.tsx`
Controlled Dialog (not accordion):
```ts
interface ManualQuestionFormProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  institutionId: string; classId: string; className?: string; classSection?: string;
  subjectId: string; subjectName?: string;
  sectionChapterIds: string[];
  questionType: QuestionType; allowTypeChange?: boolean;
  section: ExamSection;
  onAddQuestion: (sectionTempId: string, question: Omit<ExamQuestion, "tempId">) => void;
  onUpdateQuestion?: (sectionTempId: string, tempId: string, patch: Partial<ExamQuestion>) => void;
  editingQuestion?: ExamQuestion | null;
}
```
* 3-column read-only context row (Class, Section, Subject).
* Chapter locked/Select by count; optional Topic Select with `"__none__"` sentinel; suggestions from `useChapterTopics`.
* Type picker pre-filled from prop; editable only when `allowTypeChange` (mixed-type sections).
* Full editing UI: MCQ options, true/false, matching pairs, comprehension/case-study sub-questions, fill-in-blank, math toolbar, image upload.
* Reset `useEffect` keyed on `[open, editingQuestion, questionType, section, sectionChapterIds]`.
* **Dual-write on new (not edits):** `saveToBank` does direct `question_bank` insert with `topic_id = chapterId`, `chapter_topic_id = upserted topic ID`, `source: "manual"`, `is_approved: true`.
* **Schema caveat:** `question_bank` has no `exam_id` column. Per-exam provenance requires a migration.

### Phase 5 — Question count enforcement in `QuestionsScreen.tsx`
Per-section, per-type quotas enforced across every add surface (AI, Bank, Manual). Review step blocked until every quota is hit exactly.

* **Derived slot tracking (no schema drift):** `computeSectionCompletion(section)` reads `section.questionTypeCounts` and `section.questions` each render. Returns `{ totalTarget, totalActual, percent, byType: [{ type, target, actual, percent, isFull }] }`. Deliberately NOT stored as `totalSlots` on `ExamSection`.
* **SectionSummaryCard:** `ProgressBadge` tri-state (emerald `actual>=target`, `#fa920e/15` partial, `red-100` empty). `CompletionBar` matches badge state. Expand/collapse for type list.
* **TypeGroupCard:** one per entry in `section.allowedQuestionTypes`. `labelForType`: `case_study → "Case studies"`, `comprehension → "Passages"`, else `LABEL_MAP`. Add button disabled at `actual >= target`, shows "Full" with check icon. Pencil skips `MethodPickerSheet` and opens `ManualEntrySheet` with `editingQuestion`.
* **`pickerRemaining` recomputed each render:** `useMemo` computes `remaining = target - actual`, passed to `MethodPickerSheet`, `AIGenerateSheet`, `QuestionBankSheet`, `ManualEntrySheet`.
* **tempId strip-before-add:** `ManualEntrySheet` returns full `ExamQuestion` with tempId; `useExamForm.addQuestion` expects `Omit<..., "tempId">` and generates its own. Wrapper:
  ```tsx
  onAddQuestion={(sectionTempId, q) => {
    const { tempId: _drop, ...rest } = q;
    addQuestion(sectionTempId, rest);
  }}
  ```
* **Sticky bottom CTA:** disabled when `!isComplete`. `helperText="All sections must be complete before proceeding."` Empty-state card when no sections.
* **`ManualEntrySheet` defensive guard:** `isFull = !isEditing && remaining <= 0` → red-bordered banner "This section is full. Remove a question to add a different one." Editing always allowed.
* **Already-compliant surfaces:** AIGenerateQuestions (Phase 3) gates Generate on running total; QuestionBankSelector (Phase 4) disables checkboxes at full.

## 7. Teacher/Coordinator Onboarding Journey

### Milestones (derived, not stored)
Five booleans computed live from existing tables — no dedicated onboarding table, so prior activity counts automatically and updates without any new write paths:

1. `first_task_assigned` → `task_assignments.assignee_id = user OR assigner_id = user` (broadened on 2026-05-09 — pre-fix this checked only `assignee_id`; three Alliance teachers who created tasks for students but never received one were stuck at 0/5 even after engaging with the Tasks module. UI label is "First task created or received." Migration: `20260509120000_broaden_first_task_assigned_milestone.sql`. Column name is unchanged for backwards compatibility — do NOT re-narrow to `assignee_id` only without renaming the column AND updating `useOnboardingJourney.ts` + `generateOnboardingReport.ts` together.)
2. `first_task_completed` → `tasks.status='completed'` joined via `task_assignments.assignee_id` (intentionally NOT broadened — completing a task means executing one assigned to you; assigning a task to a student is engagement, not completion)
3. `first_study_material_uploaded` → `study_materials.created_by = user` (replaced the earlier `first_student_added` milestone on 2026-04-18 — the passive student-roster check was swapped for an action the teacher directly controls; the renamed column is returned by both RPCs as of migration `20260418120000_onboarding_study_material_milestone.sql`)
4. `first_exam_published` → `exams.created_by = user AND status IN ('published','completed')`
5. `first_result_validated` → `final_results.finalized_by = user OR published_by = user`

### Migration
`supabase/migrations/20260416120000_teacher_onboarding_journey.sql` creates two `SECURITY DEFINER` plpgsql functions:
* `get_user_onboarding_progress(_user_id)` — used by the teacher's own Achievement page and by the badge gate. Permission: self, `super_admin`, or school_admin/super_school_admin/coordinator of the target institution.
* `get_institution_onboarding_progress(_institution_id)` — used by Command Center's Onboarding Excel report. Permission: `super_admin` or school_admin/super_school_admin of the institution.

Both return `completed_count INT`, `completion_percent NUMERIC`, `is_journey_completed BOOLEAN` alongside the five flags, so the UI never recomputes percentages.

### Frontend contract
* **Hook:** `src/hooks/useOnboardingJourney.ts` — `useMyOnboardingProgress(enabled)` and `useInstitutionOnboardingProgress(institutionId)`. `ONBOARDING_MILESTONE_META` holds the user-facing labels.
* **Panel:** `src/components/achievements/OnboardingJourneyPanel.tsx` — renders on `AchievementsPage` (above badges) whenever the page's resolved badge type is `teacher`, which covers coordinators too since they share the teacher ladder. There is no page-level role switcher any more (the app-bar `RoleSwitcher` is the only one, CLAUDE.md §25), so the panel does not read `activeViewRole`; the data source is the same either way (user_id). Corrected 2026-10-05 (work-queue Task 7).
* **Badge gate:** `src/hooks/useAutoBadgeAward.ts::isOnboardingIncomplete()` is called at the top of `checkAndAwardBadges`. If the user has a teacher/coordinator role AND their journey is incomplete, the function returns silently without inserting into `user_badges`. Students and admins bypass this gate (no `teacher`/`coordinator` role row). Errors in the gate check default to "not blocked" so unrelated failures don't freeze the award flow.

### Invariants to preserve
* **Milestone semantics are bi-directional where it makes product sense.** When asked to add or change an onboarding milestone, ask "does this fire only when the action is done TO the user, or also when the user does it themselves?" `first_task_assigned` is bi-directional (assigner OR assignee) because either direction proves engagement with Tasks. `first_task_completed` is uni-directional (assignee only) because "completing" a task you assigned to a student is semantically wrong — the student completed it, not you. Apply the same test to any new milestone: would a teacher who only ever performs the active half of the action expect the milestone to fire? If yes, broaden the OR.
* **No persisted onboarding table.** Keep using the RPCs so pre-existing activity is always reflected — re-introducing a materialized state would break retroactive completion.
* **Gate order in `useAutoBadgeAward`:** the onboarding check runs *before* the badge definition fetch. Do not move it after the DB writes, and do not surface a toast when the gate triggers — the panel on AchievementsPage is the only place this is communicated to users.
* **Report type formats:** `ReportModal.REPORT_TYPES` entries carry a `format` tag (`"PDF"` or `"Excel"`) rendered as a pill. The academic-year / term selectors are hidden when `reportType === "onboarding"` because the onboarding snapshot is always live.
* **Role filter:** both RPCs return rows only for users with `role IN ('teacher','coordinator')`. `super_school_admin`/`school_admin` are excluded from the roster even if they create exams — if the product wants them included later, widen the filter in `staff` CTE of `get_institution_onboarding_progress` AND the role-resolution subselect, then update the `useOnboardingJourney` types accordingly.


## 8. AI Question Generation — core invariants (mirrored from CLAUDE.md, full detail here)

* **Difficulty: default `5`, opt-in per-row and per-question override.** Changed 2026-09-11 on Tushar's instruction; before that it was hardcoded to `5` and this note said "no difficulty selector". The product line "always hardest, calibrated to grade level" is now the DEFAULT rather than the only option.
  * `src/components/exam-creation/components/DifficultyChip.tsx` owns the vocabulary: `DEFAULT_DIFFICULTY_LEVEL = 5`, bands Easy `2` / Medium `3` / Hard `5`, and `bandForLevel()` reads a stored level back (1-2 Easy, 3 Medium, 4-5 Hard). Storage stays on the existing 1..5 `difficulty_level` scale, so `question_bank` and the edge function are unchanged.
  * Every chapter/topic row in the AI Generate distribution carries a chip; rows of 2+ questions get a "Per question" expander, and a row with mixed picks reads "Mixed". Case study / comprehension keeps ONE chip for all passages because that path is a single request.
  * **Generation sends one request per distinct level in a row.** A row whose questions are individually set to N different bands issues N requests. Keep the single-flight add guard and the under-delivery top-up working across that fan-out.
  * An untouched row is byte-identical to the pre-2026-09-11 payload. Early years (Class 1 and below) still clamp server-side; the client never bypasses it.
* **Board-paper formatting (MANDATORY).** System prompt in `supabase/functions/generate-questions/index.ts` enforces competitive-exam rigor (JEE/NEET/Olympiad/CBSE board style) with **KaTeX delimiters** (`$...$` inline, `$$...$$` block). Plain-text math is a HARD FAIL — the frontend only renders dollar-delimited LaTeX. Preserve units `\text{}`, chem formulas, piecewise `\begin{cases}`, matrices, Bayes `P(A \mid B)`, and the case-study template (Markdown table + graduated sub-questions).
* **LaTeX rendering pipeline.** Student/teacher-facing: `src/components/ui/math-text.tsx` (MathText). Author-only preview: `src/components/ui/math-preview.tsx` (MathPreview — shows "PREVIEW" chrome, never student-facing).
* **JSON escape-repair before parse (MANDATORY).** `repairLatexEscapes()` in `generate-questions` doubles `\`+letter before `JSON.parse` to prevent `\f`→U+000C, `\t`→U+0009, etc. from destroying LaTeX. Don't bypass. Rows stored before this fix are unrecoverable.
* **LLM under-delivery is real — auto top-up (fixed 2026-05-01).** The model occasionally returns fewer questions than asked (requested 7, returned 5 — silently); a 50-question request commonly resolved at 47-48. The non-case-study branch in `AIGenerateQuestions.tsx` does **(a)** a per-batch top-up retry — if a chapter call returns `< req.count`, fire one more call for the deficit on the same chapter/topic — and **(b)** a final aggregate top-up against the largest request if the running total is still short. Case-study / comprehension is intentionally excluded (single-passage shape, different retry semantics). Don't remove either step or the bug returns.
* **AI add flow is single-flight — guard with a ref, close the sheet early (fixed 2026-05-01).** `handleAddSelected` runs a multi-second `question_bank` insert loop; re-tapping during the wait used to duplicate every question (observed: 50-cap section at 144/50 after three taps). Three reinforcing guards must stay: **(1)** a synchronous `isAddingRef` (state alone has a render-cycle gap a fast double-tap slips through); **(2)** clamp `selected = selectedAll.slice(0, remainingSlots)` so over-selection can never overshoot the per-type cap; **(3)** call `setGeneratedQuestions([])` + `onComplete?.()` *immediately* after the synchronous `onAddQuestion` loop (questions are already in parent state), letting the `question_bank` writes run in the background. The `finally` resetting `isAddingRef` matters for any future caller reusing the mounted instance.
* **AI provider plumbing:** `generate-questions` goes through `supabase/functions/_shared/aiProvider.ts` — `AI_PROVIDER` env selects `openai` (default, `OPENAI_MODEL` default gpt-4o-mini) or `gemini`. Everything else AI-related (auto-grade-submission, process-ocr-upload, generate-predictions, generate-exam-insights, generate-principal-ai-insights, mascot-chat) calls the **Lovable AI gateway** (`ai.gateway.lovable.dev`, secret `LOVABLE_API_KEY`) with Google Gemini models — two distinct AI plumbing paths.
* **Prod model is `gpt-5-mini` at `medium` reasoning effort (2026-07-20)** — secrets `OPENAI_MODEL=gpt-5-mini` + `OPENAI_REASONING_EFFORT=medium` (code default stays gpt-4o-mini, which shipped mathematically wrong MCQs). `low` effort was live-tested and produced a 4/4-defective batch — NEVER downgrade it. `callOpenAi` detects reasoning models via `/^(gpt-5|o\d)/` and switches to `max_completion_tokens` (+8000 reasoning headroom), omits `temperature` (rejected by those models), sends `reasoning_effort`, and bounds at 240s (thinking precedes output; warm medium batch ≈ 56s for 4 questions). **Cost routing (2026-07-25):** ONLY Maths + science-family subjects (narrowed same day: regex `math|science|physics|chem|biolog` with a `/social/i` exclusion so Social Science rides cheap; Economics/Accountancy/Statistics/CS moved to the cheap model; plus unresolved 'General') use the reasoning model; all other subjects route to `OPENAI_MODEL_BASIC` (default gpt-4o-mini, ~10x cheaper) via a per-call `model` override in `generateCompletion`. Response `metadata.model` reports which model served the batch. Verified live: English → gpt-4o-mini 12s 3/3 correct; Maths → gpt-5-mini 79s 3/3 correct; Social Science correctly rides cheap despite containing 'Science'. **Per-institution science downgrade:** ids in the `REASONING_SCIENCE_EXCLUDE_INSTITUTIONS` secret (comma-separated) get the cheap model for science-family subjects too, Maths only stays premium — set 2026-07-25 to Alliance (`8af718c6-ca11-482b-9d6b-832f2b767928`, revenue decision; wrong-science-answer risk accepted for them). Unset/empty secret = no downgrades; edit the secret to change, no redeploy needed. Anon/JWT-less calls have no institution → never downgraded. `repairLatexEscapes` control-letter branch is now allowlist-based (`LATEX_CONTROL_COMMANDS`): `\nhave` stays a paragraph break, `\neq`/`\nu`/`\times` double into LaTeX; backslash + non-letter (`\,` `\{` …) always doubles (otherwise an invalid JSON escape that throws). OpenAI account: ROTATED 2026-07-25 — the original `salci-innovations-llp` org (project `proj_ohsx2lUbxfQv9Hq5mVERlScQ`) exhausted its credits (429 `insufficient_quota`, took AI generation down platform-wide); current key belongs to a company-controlled account with billing alerts. If 429s reappear with app quotas clear, check OpenAI billing FIRST.
* **Grade resolution + early-years calibration (2026-07-25) — the "Nursery Letter B" bug.** The mobile flow only ever sends `chapterName`, and the `if (customTopic)` branch builds a synthetic topic with NO grade join, so `gradeName` stayed `'General'` for every single generation at every grade while difficulty is hardcoded 5 ("hardest, JEE/NEET/board-HOTS, absolutely no recall"). Nursery chapter "Letter B" (the alphabet letter) was read as *correspondence* and produced persuasive-letter/figurative-language/counterargument questions; Class 2 "Chapter 3: Addition" produced a without-replacement probability question. 1,658 such rows exist for Pre Nursery-Class 2 (1,657 at difficulty 5, only 5 manual) and they reached live/completed exams. Fix: resolve grade from `chapterId` -> `syllabus_topics.grade_levels(grade_name, grade_number)` (authoritative — zero rows have a NULL `grade_level_id`), fall back to `classId` -> `classes.class_groups.grade_levels` (nullable for some pre-primary class_groups, hence second); both call sites in AIGenerateQuestions now send `classId`. `isEarlyYears = grade_number <= 1` -> `effectiveDifficulty` 2 for pre-primary (grade_number <= 0) / 3 for Class 1, and a mandatory early-years rule block overrides the level-5 text. **Pre-primary grade_numbers are NEGATIVE** (Pre Nursery -4, Nursery -3, LKG -2, UKG -1 AND 0 — two UKG rows exist), so the test must be `<= 1`, never `> 0 && <= 1`. `metadata.gradeNumber`/`metadata.difficulty` expose the decision. Verified live: Nursery "Letter B" -> "Which word begins with the letter B? Apple/Ball/Cat/Dog" (diff 2); Nursery "Counting 1 to 5" -> numbers stay 1-5; Class 1 -> diff 3; Class 2 control -> diff 5 UNCHANGED and now emits proper missing-digit subtraction puzzles instead of probability, because the grade finally reaches the model. Fixing grade resolution improved EVERY grade, not just early years.
* **Early years bypasses the reasoning model + the self-contained rule (2026-07-25).** `needsReasoning` is gated behind `!isEarlyYears`, so Class 1 and below always use `OPENAI_MODEL_BASIC` regardless of subject — grade beats the Maths/science route ("count the apples" gains nothing from reasoning and costs ~10x; Nursery batches dropped 13s -> 8s). The cheap model's characteristic early-years failure is inventing a picture that does not exist ("How many apples are there?" with nothing to count), so the early-years block carries an explicit SELF-CONTAINED rule with WRONG/RIGHT examples; the model now emits symbol runs ("How many apples are there? 🍎 🍎 🍎"). If that rule is ever trimmed, unanswerable counting questions come straight back. **Legacy cleanup:** the 1,657 pre-fix `ai_generated` difficulty-5 rows for Nursery..Class 2 were deleted (backup: `salci_backups.qb_early_years_diff5`, restore with a plain INSERT back into `question_bank`); 5 teacher-written manual rows + 1 already-easy AI row were deliberately kept. `exam_questions` has NO FK to `question_bank` (only `parent_question_id` and `question_bank_section_scope` cascade), so bank deletions never touch live or completed exams — verified count unchanged at 8,592.
* **Deploy command (no global CLI):** `npx supabase@latest functions deploy generate-questions --project-ref gyymkgohcijeksmrzuyw`. Any prompt/logic edit requires redeploy.

## 9. Auto-grading & `exam_questions.options` — TWO shapes in prod (fixed 2026-07-17)

`exam_questions.options` JSONB has two coexisting shapes and any consumer must branch on `Array.isArray`:

1. **Legacy map:** `{ "a": "text", "b": "text", ... }` with `correct_answer` = lowercase letter. Student `answer_options.selected` = letter.
2. **Mobile exam-creation flow (current):** `[{ "id": "opt-<ts>-<n>", "text": "...", "isCorrect": bool }, ...]`. Student `answer_options.selected` = the option **id**; `correct_answer` holds an UPPERCASE letter that does NOT map to anything by itself — ground truth is the `isCorrect` flag.

The 2026-07-17 incident: `auto-grade-submission`'s `cleanMCQAnswer` did `Object.entries(options)` + `.toLowerCase()` on values — on array-shaped options every value is an object → `TypeError` → catch-all → HTTP 400 for the WHOLE attempt. "AI Evaluate All"/"Evaluate with AI" was 100% broken for every exam built in the new flow. Fix in `supabase/functions/auto-grade-submission/index.ts`:
* `resolveArrayOptionIndex` (id → text → bare-letter fallback) + `findCorrectOptionIndex` (isCorrect flag → correct_answer fallback) for the array shape; `cleanMCQAnswer` retained for the map shape only and hardened to skip non-string values.
* **Per-answer try/catch** — one malformed answer/question must mark that answer `requires_teacher_review`, never 400 the request.
* The function returns a deliberately generic 400 (`Internal server error`) on any throw — the REAL error is only visible in edge function logs (Management API `logs.all`, table `function_logs`, filter `metadata.function_id = '47b2999a-6a2b-425b-8f28-4e5e8415aaa8'`).
* After grading, the client must invalidate `exam-results-students` / `exam-analytics` (done in `useAutoGrading.ts`) or the report page looks unchanged until a manual reload.
* Deploy: `npx supabase@latest functions deploy auto-grade-submission --project-ref gyymkgohcijeksmrzuyw`.
* Open (tracked): H4 IDOR — role check has no institution scoping (`docs/security-audit-2026-07-07.md`); grading N attempts = N sequential edge invokes from the browser (perf-audit `useAutoGrading.ts:120`).

### Stale (never-submitted) attempts auto-close after each student's clock (fixed 2026-07-17)

A student who opens an online exam but never presses Submit leaves `student_exam_attempts.is_submitted = false` forever. `get_exam_window_status` counts every such row as an ACTIVE attempt (no window check), so "Validate Results" stays blocked with "N student(s) still have active attempts" while the report list renders those students as "Not Attempted" — an invisible blocker.

**CRITICAL timing:** `exams.end_time` (= `availability_end`) is ONLY the LATE-ENTRY cutoff, NOT the deadline. A student who enters late may legitimately keep writing until `started_at + duration_minutes`, which can be well past `end_time`. So an attempt is stale only when BOTH: `end_time <= now()` AND `started_at + duration_minutes + 5 min grace <= now()`. Never blind-close at window-close — that force-submits students mid-exam.

Resolution (migration `20260717120000`, applied to prod):
* `close_stale_exam_attempts_sweep()` — cron-only (`*/5 * * * *`, job `close-stale-exam-attempts`), scoped to `status IN ('published','active')` so validated/completed exams are never touched. This is the source of truth; it makes closing fully automatic with no user action.
* `close_stale_exam_attempts(p_exam_id)` — staff-authorized on-open kick (authz = exam creator, super_admin, institution school admins, `class_assignments.role='teacher'`, or `is_coordinator_for_class`) for instant feedback; `ExamResultsView` fires it **silently once per exam** via `useCloseStaleAttempts({ silent: true })` (ref-guarded useEffect). There is NO manual button — user feedback was "this should be automatic".
* Both set `is_submitted=true, auto_submitted=true, submitted_at = started_at + duration` (the student's personal deadline, not `end_time`). Zero-answer attempts then render Checked score 0; attempts WITH saved answers become gradeable (AI Evaluate). The banner now only says "N student(s) are still within their exam time" (informational, no action).

The RPC is missing from generated types — call site uses a narrow `as unknown as` cast; do NOT regen types wholesale (2026-07-17 regen attempt dropped ~1.7k lines of schema — verify before ever committing a regen).

Three non-obvious invariants found by review on 2026-07-17 — do not regress:
* **The submission trigger overwrites what you write.** `handle_attempt_submission` (BEFORE UPDATE, fires on `is_submitted` false->true) unconditionally sets `submitted_at := now()` AND `time_spent_seconds := now() - started_at`. Closing an abandoned attempt therefore always overshoots the allotted time (and for an old backlog inflates to hours/days, polluting `useTimeAnalysis`/`useExamAnalytics`, which previously excluded these as NULL). Both close functions run a **second, separate** UPDATE that bounds `submitted_at` to the personal deadline and caps `time_spent_seconds` at `duration_minutes*60`.
* **That correction MUST NOT be the outer UPDATE of a data-modifying CTE.** All sub-statements of one command share a snapshot and Postgres applies only ONE modification per row per command, so `WITH closed AS (UPDATE ...) UPDATE ... FROM closed` silently discards the correction *and* reports `ROW_COUNT = 0` — which also breaks the count the UI uses to decide whether to refresh. Capture ids (`SELECT array_agg(id) INTO v_ids FROM closed`), then correct in a separate statement. Verified empirically: new form -> count=1, secs capped; old form -> count=0, secs unbounded.
* **Grading is tenant-scoped via `user_can_grade_exam(_user_id, _exam_id)`** (migration `20260717130000`). `auto-grade-submission` previously authorized on "holds ANY staff role anywhere" and then ran service-role with no institution binding — any staff account could grade another school's attempt by id (security-audit H4). The edge fn now calls this helper after resolving the attempt's exam and 403s on false; it also derives `evaluated_by` from the JWT and **ignores any client-supplied `grader_id`** (previously forgeable). Verified: exam's own teacher 200, foreign-institution teacher 403.
* **`useExamResultsStudents` needs its `refetchInterval`.** The cron closes attempts server-side without touching the client cache, while `useExamWindowStatus` self-heals on a 30s poll. That fresh/stale split let `canValidate` open (stale `notChecked=0` + fresh `activeAttempts=0`) and publish an ungraded attempt at score 0. The 60s poll keeps the list in step — don't remove it.

## 10. Voice dictation on per-question feedback (2026-08-12)

`useSpeechDictation` (`src/hooks/`) + `FeedbackDictationField` (`src/components/hybrid/`) put a mic
button on the Feedback box of `HybridEvaluatePage`. Web Speech API only. Spec:
[docs/superpowers/specs/2026-08-12-voice-dictation-feedback-design.md](../../../docs/superpowers/specs/2026-08-12-voice-dictation-feedback-design.md).

**A web page cannot trigger the phone keyboard mic or Windows+H** — there is no API. We replicate
the behaviour with the browser's own engine (same backing service on Android/iOS, so accuracy
matches). Do not accept a bug report asking us to "just call the OS one".

Invariants — each one is a bug that was designed around, not a preference:
* **`onend` MUST clear the committed-index Set.** Every new recognition session numbers results
  from 0 again; keeping the old Set makes each new phrase look "already committed" and it is
  silently dropped (total text loss, the worst failure here). Covered by a test harness.
* **Never `+=` onto the field, and never `setValue(prev => prev + t)`.** With `interimResults` the
  same words are re-delivered as they refine ("the stud" → "the student"), so appending duplicates.
  Interim is a preview replaced wholesale; only `isFinal` segments commit, once per index.
* **Auto-restart is required, and must stay guarded.** Chrome ends a session after ~8s of silence
  and caps it near 60s even with `continuous = true`; Safari ignores `continuous`. Guards:
  intent flag, 20-restart cap, stop after 2 silent sessions, and NEVER restart on
  `not-allowed`/`service-not-allowed`/`aborted` (`onerror` fires before `onend`, so it clears the
  intent flag first — otherwise a denied permission re-prompts until the tab dies).
* **On the restart gap, null `recognitionRef` immediately.** Otherwise `stop()` during those 250 ms
  calls `.stop()` on a spent recognizer, which is a silent no-op, and the UI is stranded on
  "Listening" forever. A 1.5s watchdog escalates if an `onend` is ever swallowed.
* **Teardown order: flags → detach handlers → `abort()`.** Any other order lets `onend` restart a
  session that outlives the component and holds the mic open. Use `abort()` on unmount, `stop()`
  only for the user tapping stop (it flushes the phrase in flight).
* **Interim text lives in the field's LOCAL state.** It fires several times a second; putting it in
  page state re-renders the whole question list and paper viewer on every syllable.
* **The field is wrapped in `<form data-dirty="true">` while listening** — `src/main.tsx` suppresses
  the service-worker auto-reload only for that exact selector (§17).
* **TypeScript:** lib.dom.d.ts (TS 5.8) ships `SpeechRecognitionResultList`/`Result`/`Alternative`
  but NOT `SpeechRecognition`/`SpeechRecognitionEvent`/`SpeechRecognitionErrorEvent`. Declare only
  the missing three, module-local in the `.ts` (a `.d.ts` is silently unchecked under `skipLibCheck`).
* **Privacy, state it honestly:** Chrome streams audio to a Google service (Safari to Apple's). SALCI
  records/stores nothing, but this is teacher commentary about named minors, so the UI carries a
  disclosure line while listening. Do not remove it.

## 11. Question diagrams — question-level and per-option

Two independent image slots, at deliberately different sizes.

**Question-level `imageUrl`** (2026-08-22, `f9ee384`). `DiagramField`
(`src/components/exam-creation/forms/DiagramField.tsx`) is on **all seven** manual question forms.
Stored as `question_bank.image_url` / `exam_questions.image_url`, carried as `imageUrl` on
`ExamQuestion`. Threaded through paper, print, attempt, results, marking and bank import.

**Per-option `QuestionOption.imageUrl`** (2026-09-02, `7ac9442`). Every MCQ option row gets its own
image control: a dashed icon button when empty, a 44px thumbnail with a remove action when filled,
**at exactly the same footprint so the row never shifts**. Wired into `MCQForm` (mobile flow), the
legacy `ManualQuestionForm`, and the admin question-bank editor. `QuestionImageUpload` gained a
`thumb` variant rather than a second copy of the bucket/resize/session-delete logic.

Invariants:
* **Purely additive inside the `options` JSONB, so no migration was needed.** Save paths spread the
  option object (`{ ...o, text }`) and the legacy `{a,b,c,d}` map shape simply has no image. That
  spread is load-bearing: **two paths rebuilt options field-by-field and silently dropped every
  option image** before they were fixed. Never rebuild an option object property-by-property.
  (See §9 for the two `options` shapes.)
* **`get_exam_paper` whitelists options down to a fixed field list** so the answer key
  (`options[].isCorrect`) can never ship to a student's browser mid-exam. That whitelist is correct
  and must stay — but it means **any new option field is invisible to students until it is added to
  the whitelist.** Per-option images shipped broken for a day for exactly this reason; migration
  `20260903120000` added `imageUrl` and nothing else. If you add an option field, add it there too,
  and never add `isCorrect`.
* **Display: `OptionImage` renders a 40px avatar-style thumbnail that is a real button** and opens
  the full image on tap — small alone would make a graph unreadable. Threaded into all six read
  surfaces: student attempt, student result review, teacher marking, on-screen paper, review step,
  hybrid paper. **Printed paper and PDF get an inline 56px image instead of a modal.**
* Option images are deliberately much smaller than the question-level `imageUrl` so four of them
  don't push the answer controls off screen.
* Open gaps: some admin bank dialogs, and sub-questions never print from saved exams.

## 12. Exam delete must be ONE cascading statement

`useDeleteExam` in [src/hooks/useExamData.ts](../../../src/hooks/useExamData.ts) is a single
`.delete().eq("id", examId).select("id")` and must stay that way.

It used to delete six child tables in sequence and then the exam row. When the final DELETE was
blocked, the six child deletes had already committed: **174 of ~1,500 exams were left
destroyed-but-present** — the row still listed, its questions, sections and results gone. One
statement means it either all happens or none of it does.

Two guards in that hook, both required:
* **`23503` is translated, not leaked.** A dependent row (scanned uploads, saved analytics) blocks
  the delete; nothing was destroyed because the whole statement rolled back, so the message says
  that rather than implying partial loss.
* **`.select("id")` and an empty-result check.** A DELETE blocked by RLS returns success with an
  empty body, byte-identical to a real delete (CLAUDE.md §6). "Row gone" is the only trustworthy
  signal — empty result must `throw`.

`onSuccess` must invalidate `coordinator-exams` alongside `teacher-my-exams` / `school-exams` /
`exams`, now that `ExamsPage` feeds coordinators from it.

## 13. Explicit Absent state (2026-08-29)

A student who did not sit an exam used to be left blank, which is indistinguishable from "not
entered yet". Both offline pipelines now record absence explicitly:

* **`offline_student_marks.is_absent`, with a CHECK making absent and a mark mutually exclusive** so
  the ambiguous state is impossible at the DB level. Copy that CHECK if you add a third pipeline.
* **`final_results.is_absent`**, so absence reaches the published record. The section pipeline
  already had an Abs toggle but published it as a plain `0`, indistinguishable from a genuine zero.
* Absent students **do** publish. Footer counts are marked / absent / not entered.
* Student surfaces show **Absent instead of 0%**, and absent exams are excluded from averages and
  trends — check any new aggregate for that exclusion.

The same change standardised roll/admission identity and gave every roster one order; don't
reintroduce a surface-local sort.

## 14. Exam slot booking (2026-09-28, migration `20260928170000`)

No two live exams may overlap for one class section. Spec:
[docs/superpowers/specs/2026-09-28-exam-slot-booking-design.md](../../../docs/superpowers/specs/2026-09-28-exam-slot-booking-design.md).

* **Occupancy lives in two places that must stay identical:** SQL `exam_slot_occupied_until` and
  `examSlotOccupiedUntil` in `src/lib/examSlots.ts`. It is `end_time`, plus hybrid upload grace
  (default 5). With late entry NULL/0 students may join until `end_time`, and what follows depends
  on the exam:
  * Online attempts are capped there (`exam_attempt_remaining_seconds`), so there is no extra time.
  * Hybrid attempts are not capped, so add the duration.
  * With a NULL `end_time`, also add the duration.

  Half-open, so back-to-back is free.
* **Live = published/active + online/hybrid + start_time.** `is_results_only` is NOT an exemption
  (an online row is sittable). A live online/hybrid exam may not lose, or go live without, a start
  time (8 legacy rows are exempt because only transitions raise). `exam_classes_same_school`
  refuses another school's section, drafts included.
* **Cascades are recognised by the parent being gone** (subject row deleted, exam row not found),
  never by `pg_trigger_depth()`: an FK cascade's AFTER trigger fires at depth 1. The child-row
  re-check takes `FOR SHARE OF` the exam row so it cannot race a publish.
* **The guard is the final status flip.** `useSaveExam` writes every child row first and publishes
  last, so `exams_slot_guard` (BEFORE) sees the final section set. Keep that order. The sibling
  AFTER triggers on `exam_classes` (AFTER, because ON CONFLICT DO NOTHING fires BEFORE INSERT for
  skipped rows), `exam_subjects` (INSERT only: a DELETE arrives from cascades) and
  `hybrid_exam_settings` cover a live exam changing underneath.
* **Never re-check a window that is over, and never re-check published -> completed.** 56 legacy
  overlaps exist in prod. Validating their results must keep working.
* **Advisory locks per section, sorted, then a NEW statement.** That fresh READ COMMITTED snapshot
  is what makes it race-safe. Do not merge the lock and the check into one query.
* **Read path is `get_exam_slot_bookings` only** (`useExamSlotBookings`, `meta: { persist: false }`).
  RLS on `exams`/`exam_classes` is school-wide, students included, so a direct table read shows
  other classes' bookings. Visibility is `can_view_class_exam_slots`: class-level on purpose (any
  teacher row on the section, wing coordinator with the role, the school's admins).
* **The guard's message names the clash only for a caller who may see that section**, else a
  generic line. `exam_classes` INSERT RLS lets any teacher link any section to a draft, so a
  detailed message for everyone would be a timetable probe.
* **Optional-group alternatives are exempt** (`exam_slot_subjects_are_alternatives`): every subject
  of both exams in one `optional_groups` row of the class group, disjoint sets. Never infer it
  from subject names or `is_optional`.
* **Sheet contract (`ReviewPublishScreen` + `ExamSchedulePlanner` + `useExamSlotPlan`):** it stays
  open until publish succeeds, re-reads bookings before publishing, disables Publish on a clash
  (never on a failed read, since the server still decides), and shows a server-caught clash inline.
  `ExamCreationFlow` suppresses the toast for `isExamSlotConflictError`.
* **`useSaveExam` does not toast** while its caller is mounted. Callers own every toast (it used
  to double them, one raw). It falls back to its own toast only when `isCallerMounted()` is
  false. Pass `onDraftCreated` so a failed publish never orphans the new draft's id.
  Single-flight reads `queryClient.isMutating({ mutationKey: SAVE_EXAM_MUTATION_KEY })`, because a
  render-time `isPending` is stale in a closure that resumes after the pre-publish re-read.
* **The sheet never shows "free" without an answer:** offline (paused query), a failed read (the
  calendar draws no dots) and "every section hidden" are all neutral or unknown states. The date is
  picked from the shadcn Calendar in a Popover (the native date input cannot carry the booked-day
  dots); pass its nav icons again with any `components` override, since that prop replaces the
  wrapper's object. While
  checking or publishing, the planner sits in a disabled fieldset and the sheet cannot close.

## 15. PTM online (residential) mode (2026-10-05, migrations `20261005160000` to `20261005160300`, `20261006120000`, `20261006140000`, `20261006140100`, `20261006170000`)

For families who cannot come in (boarders): one Google Meet slot per family with that child's
teacher. Design: `docs/superpowers/specs/2026-10-03-ptm-online-residential-design.md` (naman-erp);
what is live and what changed from it: `docs/superpowers/specs/2026-10-05-ptm-online-server-status.md`.
Tests: `scripts/test-ptm-online.sql` (165) and `scripts/test-ptm.sql` (100, in-person) must both pass.

* **An online PTM has zero `ptm_schedule_classes` rows** (a trigger refuses them). Every reader
  that read "zero rows = whole school" branches on `ptm_schedules.mode`. For an online PTM
  `ptm_effective_class_ids` = its participants' classes, and a family's place is ONLY its
  `ptm_online_participants` row: every student-side check (`book_ptm_slot`, feedback, the
  feedback context, `ptm_includes_user_class` behind `ptm_select` and audio) goes through
  `_ptm_student_scope()`. A classmate who was not picked must see nothing.
* **One teacher per student per PTM** (`UNIQUE (ptm_id, student_id)`); the participant row's
  composite FK to `ptm_online_teachers (ptm_id, teacher_id)` with ON UPDATE CASCADE makes a swap one
  UPDATE. A booking's `teacher_id` always comes from the participant row (shape trigger
  `tg_ptm_bookings_online_shape`, which returns early on the user-delete cascade predicate).
  Removing a participant cancels their booking through `tg_ptm_online_participant_removed`, the one
  path for the RPC, a teacher removal, an account delete and a PTM delete.
* **Privacy, twice paid for in review:** `ptm_bookings` and `profiles` are readable school-wide, so
  Meet links live in `ptm_booking_meet` and Google emails in `user_google_accounts`, both RLS-on
  with no policy and no browser grant; RPCs hand the link to that family, the session teacher, the
  creator and admins only, and pickers return `has_google_email` only (`get_google_email` for the
  owner or an admin). `ptmb_select` is "own booking, or staff who may see that class".
* **Busy guard:** `_ptm_assert_teachers_free` takes `ptm_teacher:<id>` advisory locks in sorted
  order and re-reads `_ptm_teacher_bookings` (online sessions, plus every teacher of a class an
  in-person PTM covers). Two statement triggers on `ptm_online_teachers`, INSERT and UPDATE apart,
  because a transition table allows neither a column list nor two events; the UPDATE one asserts
  only rows whose `teacher_id` or hours changed (an `added_by` SET NULL from a user delete must not
  raise). Each teacher is held for their OWN hours plus the gap (`_ptm_teacher_window`).
* **Slots** come from `_ptm_slots()` (step = duration + gap); with gap 0 that is the old in-person
  grid. Mirror: `buildSlotGrid` in `src/lib/ptm.ts`. Online slots are PER TEACHER:
  `ptm_online_teachers.start_time/end_time` (NULL = the meeting's) and `_ptm_slots(ptm, teacher)` /
  `_ptm_slot_ok(ptm, slot, teacher)`, anchored at the teacher's own start. Trigger
  `ptm_online_teachers_hours` keeps them inside the meeting and refuses a change that strands a
  booking; `ptm_schedules_hours_guard` refuses a meeting edit that no longer fits them.
* **Notifications** go through `_ptm_fanout(..., _dedupe_suffix, _link, _metadata)`; the claim key is
  `type[:suffix]` while `notifications.type` stays bare (the bell's icons key on it). Families of an
  online PTM never get `ptm_scheduled`; they get `ptm_online_invited`.
* `ptm_online_pick_options` returns ONE jsonb array (PostgREST cuts set-returning RPCs at 1000
  rows). The grid and my-sessions RPCs also return `slot_starts_at` / `slot_ends_at` (timestamptz).
  Friendly errors are P0001 with a HINT so `toastError` shows them verbatim.
* **Meet rooms** (`20261006140100`): edge fn `ptm-meet-create`, a service account impersonating
  team@salci.in (domain-wide delegation, secrets `GOOGLE_MEET_SERVICE_ACCOUNT_JSON` +
  `GOOGLE_MEET_IMPERSONATE_USER`), one OPEN space per booking, guests only, no co-host (the members
  API is 404 on our edition; never send artifactConfig/presentRestriction/defaultJoinAsViewerType,
  they fail the create). Cron `ptm-meet-rooms-1min` -> `ptm_meet_create_kick()` posts only when
  `_ptm_meet_create_due` / `_ptm_meet_close_due` have rows. A room is made from slot-60 min until
  its lock time; locked (accessType RESTRICTED) at slot end + gap + 15 min or on cancel. Keep the
  create window from ever overlapping the lock window (a 5-minute slot once got a room and its lock
  in the same pass). Swap keeps the room. Cron `ptm-15m-reminders-5min` sends `ptm_reminder_15m`.
* **By class** (`20261006170000`): an admin's PTM may be class sessions
  (`ptm_online_class_sessions`, hours per class) with teachers SEATED per class in
  `ptm_online_session_teachers`; `ptm_online_teachers` stays one row per teacher per PTM (its
  UNIQUE feeds the participants FK, never relax it). A PTM with sessions is judged per seat:
  the ot busy triggers skip it and `tg_ptm_online_session_teachers_busy` asserts each seat plus
  `_ptm_assert_no_double_booking` (a teacher in two classes at once, gap included).
  `_ptm_teacher_hours` is THE source of a teacher's windows. `online_format = 'panel'` rows in
  participants and bookings have `teacher_id` NULL and act through the class's seats
  (`_ptm_is_session_teacher`): rights, notifications, rooms, reminders and feedback all branch.
