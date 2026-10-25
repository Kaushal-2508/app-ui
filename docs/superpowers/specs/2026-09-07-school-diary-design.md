# School Diary: design

**Date:** 2026-09-07
**Status:** SHIPPED. Frontend on `naman-erp` (merged 2026-09-08); database applied to prod 2026-09-08 as `supabase/migrations/20260908130000_school_diary.sql` (feed computes the caller's class scope once per call; roster source is `class_assignments` role='student'). Flag ON for Salci National School.
**Area:** Communication page (`/school/communication?tab=diary`), `src/components/diary/`, `src/hooks/diary/`

## What it is

The paper school diary, in the app. A teacher writes a short entry for a class or for one
student, and the student (and later their family) reads it the same day. Five kinds of entry:

| Kind | Meaning | Extra field |
|---|---|---|
| `homework` | work to finish at home | `due_date` |
| `remark` | a concern or complaint about behaviour or work | |
| `reminder` | something to bring, sign or remember | |
| `appreciation` | good work or conduct worth telling home about | |
| `note` | anything else | |

This is deliberately lighter than the Homework module. A diary homework entry is "exercise 4.2
by Monday": no submission, no marking. The composer points at `/homework/create` for graded
assignments when that feature is enabled.

## Why the frontend is flag-gated

The tab only renders when `institution_features` contains `school_diary`. The feature id is
registered in `featuresData.ts` with `isDefault: false`, so no school sees the tab until the
migration below is applied and the flag is turned on for them. The hooks call the RPCs through
the §5a narrow structural cast (generated types lag); regenerate types after applying.

## Data model (NEEDS DB)

```sql
CREATE TABLE public.diary_entries (
  id             uuid PRIMARY KEY,                                   -- client-generated (idempotent write)
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id       uuid NOT NULL REFERENCES public.classes(id)      ON DELETE CASCADE,
  student_id     uuid          REFERENCES public.profiles(id)     ON DELETE CASCADE,  -- NULL = whole class
  kind           text NOT NULL CHECK (kind IN ('homework','remark','reminder','appreciation','note')),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body           text NOT NULL CHECK (length(btrim(body)) > 0),
  due_date       date,                                              -- homework only
  entry_date     date NOT NULL,                                     -- institution-local day (§24)
  created_by     uuid          REFERENCES public.profiles(id)     ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diary_entries_class_created_idx   ON public.diary_entries (class_id, created_at DESC, id DESC);
CREATE INDEX diary_entries_student_created_idx ON public.diary_entries (student_id, created_at DESC) WHERE student_id IS NOT NULL;
CREATE INDEX diary_entries_institution_idx     ON public.diary_entries (institution_id, created_at DESC);
CREATE INDEX diary_entries_created_by_idx      ON public.diary_entries (created_by);
```

`student_id` is an ownership column (CASCADE), `created_by` authorship (SET NULL), per §21.
`entry_date` is `(now() AT TIME ZONE i.timezone)::date` from `institutions.timezone`, never
`CURRENT_DATE` (§24). One entry addresses one class or one student; "the same remark for three
students" is three rows, written by three calls, each idempotent on its own id.

No read receipts in v1. If "has the family seen it" is wanted later it is a `diary_entry_seen`
table on the same pattern as `notice_recipients`, not a column here.

The reader's "anything new?" signal is therefore the `diary_*` notification rows the write RPC
fans out (below). The Communication page badges its School Diary tab with a head count of the
reader's unread `diary_%` notifications (`useUnreadDiaryCount`) and stamps them read when the
tab is opened (`useMarkDiaryNotificationsRead`, one UPDATE on the reader's own rows). The
notification fan-out is what makes that badge work; without it the tab never lights up.

## Authority

| Role | Reads | Writes |
|---|---|---|
| student | entries where `student_id = me`, or `student_id IS NULL AND class_id = my class` | none |
| teacher | classes in `class_assignments` where role = 'teacher' | those classes; a student only if `teacher_controls_student(me, student)` (§25) |
| coordinator | classes reachable through `wing_assignments` (`is_coordinator_for_class`) | same set |
| admin | whole institution | whole institution |

Delete: the author, or `is_institution_admin`. No UPDATE in v1 (delete and rewrite; the row is
a few sentences).

Helpers, all `SECURITY DEFINER STABLE`, so policies never inline cross-table EXISTS:

- `diary_can_read(_entry_id, _user_id)`: the table above.
- `diary_can_write_for(_class_id, _student_id, _user_id)`: teacher/coordinator/admin scope.
- `diary_can_manage(_entry_id, _user_id)`: author or institution admin.

RLS on `diary_entries`: SELECT `public.diary_can_read(id, (SELECT auth.uid()))`; DELETE
`public.diary_can_manage(id, (SELECT auth.uid()))`; no INSERT/UPDATE policy, writes go through
the RPC only. Wrap `auth.uid()` as `(SELECT auth.uid())`.

## RPCs (this is the contract the hooks already implement)

```sql
diary_feed(
  _class_id          uuid        DEFAULT NULL,
  _student_id        uuid        DEFAULT NULL,
  _kind              text        DEFAULT NULL,
  _before_created_at timestamptz DEFAULT NULL,
  _before_id         uuid        DEFAULT NULL,
  _limit             int         DEFAULT 20
) RETURNS TABLE (
  id uuid, class_id uuid, class_label text,
  student_id uuid, student_name text,
  kind text, title text, body text, due_date date, entry_date date, created_at timestamptz,
  author_id uuid, author_name text,
  can_manage boolean
)
```

Filters narrow inside the caller's read scope; they never widen it. Order
`created_at DESC, id DESC`; keyset on `(_before_created_at, _before_id)`, never OFFSET. Cap
`_limit` at 50. `class_label` via the existing `formatClassName` convention used by
`notice_target_options` so the picker and the card agree.

```sql
diary_write_entry(
  _entry_id   uuid,
  _class_id   uuid,
  _student_id uuid DEFAULT NULL,
  _kind       text,
  _title      text,
  _body       text,
  _due_date   date DEFAULT NULL
) RETURNS uuid
```

- Returns early if `_entry_id` already exists (idempotent double-submit).
- Rejects `_due_date` unless `_kind = 'homework'`; rejects a `_student_id` not enrolled in
  `_class_id`; rejects a class outside the caller's write scope with a plain-language message
  (`isLikelyUserFriendly` passes it through to the toast).
- `entry_date` from the institution timezone.
- **Notification fan-out in the same transaction**, one row per addressed student, mirroring
  the notice spec (`docs/superpowers/specs/2026-09-07-notice-in-app-notifications.md`):

```sql
  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  SELECT s.student_id,
         'diary_' || _kind,                                  -- diary_homework, diary_remark, ...
         CASE _kind
           WHEN 'homework'     THEN 'Homework: '     || btrim(_title)
           WHEN 'remark'       THEN 'Remark: '       || btrim(_title)
           WHEN 'reminder'     THEN 'Reminder: '     || btrim(_title)
           WHEN 'appreciation' THEN 'Appreciation: ' || btrim(_title)
           ELSE 'Diary: ' || btrim(_title) END,
         left(regexp_replace(_body, '\s+', ' ', 'g'), 140),
         '/school/communication?tab=diary',
         jsonb_build_object('entry_id', _entry_id, 'kind', _kind, 'class_id', _class_id)
    FROM (SELECT CASE WHEN _student_id IS NOT NULL THEN _student_id ELSE sc.student_id END AS student_id
            FROM public.student_class_assignments sc      -- whichever table is the live roster
           WHERE _student_id IS NOT NULL OR sc.class_id = _class_id) s;
```

(The roster source should be the same one `notice_expand_audience` uses for class students.)

```sql
diary_delete_entry(_entry_id uuid) RETURNS void   -- diary_can_manage or raise
```

### Several students at once (2026-10-01, NEEDS DB, Tushar)

> **APPLIED 2026-10-01 (Tushar): `20261001120000_diary_write_entries.sql`**, built to the contract
> below. Every student is checked with `diary_can_write_for` BEFORE anything is written, so a
> refusal names who (up to three names, else a count, always under 160 characters so `toastError`
> shows it as written): "You can't write for 1 of these students: RASHMEET KAUR. Untick them and
> save again." The roster in the dropdown is the class's (`notice_class_students`), wider than a
> teacher's single-student authority only where optional choices are recorded. Then it loops
> `diary_write_entry`. `scripts/test-diary-multi.sql`: 21 assertions under real RLS, rolled back,
> 21 PASS in a dry run and again after applying; a full class of 27 in one call took about 0.1 s.
> The same migration removed a stray PUBLIC (anon) grant from `notice_class_students`. Frontend
> follow-ups in the merge: the composer loads the roster only while the sheet is open, and every
> target (each student, or the whole class of each class) keeps its own entry id for the draft.

The composer's "Addressed to" is one dropdown now: "The whole class" pinned on top, the class's
students below to tick one or several. The whole class and one student still go through
`diary_write_entry` unchanged. Two or more students call a new RPC. Naman chose (picker, 2026-10-01)
**one copy per student, saved together**: a separate `diary_entries` row per student, the model
multi-person Tasks already use (`create_task_group`), so authority, the feed, read rules and
notifications stay per row with no schema change. Proposed contract (the hook
`useWriteDiaryEntries` already calls it; rename both if you prefer another name):

```sql
diary_write_entries(
  _entry_ids   uuid[],   -- one per student, generated by the app, same order as _student_ids
  _class_id    uuid,
  _student_ids uuid[],
  _kind        text,
  _title       text,
  _body        text,
  _due_date    date DEFAULT NULL
) RETURNS uuid[]         -- the entry ids, in input order
```

- **One transaction, all or nothing.** The simplest body is a loop that calls
  `diary_write_entry(_entry_ids[i], _class_id, _student_ids[i], ...)` for each pair, which reuses
  every check and the per-student notification. If any student fails (not enrolled, outside the
  caller's `teacher_controls_student` scope), raise and write nothing, with a plain message that
  names how many students were refused, so the toast can say it.
- **Idempotent per copy:** an id that already exists is skipped, exactly as the single RPC does,
  so a retry after a dropped connection fills in only what is missing.
- Refuse: empty arrays, arrays of different length, duplicate student ids, more than 200 students.
- `REVOKE EXECUTE ... FROM anon` by name, `GRANT ... TO authenticated` (§26).
- Until it is live the app gets PostgREST's "no such function", writes nothing, and says so:
  "Writing for several students at once isn't on the server yet, so nothing was saved. Choose one
  student or the whole class for now." The whole class and single-student paths work throughout.
- The staff feed shows one card per student for such an entry (each card names its student). If
  that reads as clutter later, a shared group id column can collapse them; not needed for v1.

Every RPC: `REVOKE EXECUTE ... FROM anon` **by name**, `GRANT ... TO authenticated`, verified in
`information_schema.routine_privileges` (§26).

## Enabling

```sql
INSERT INTO public.institution_features (institution_id, feature_id)
SELECT id, 'school_diary' FROM public.institutions WHERE id = '<pilot school>'
ON CONFLICT DO NOTHING;
```

Then `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw` and drop the
structural casts in `src/hooks/diary/`.

## Frontend (shipped)

| File | Role |
|---|---|
| `src/hooks/diary/types.ts` | `DiaryEntry`, `DiaryKind`, `WriteDiaryEntryInput` matching the RPC shapes above |
| `src/hooks/diary/useDiaryFeed.ts` | `useInfiniteQuery`, keyset cursor, `staleTime: 60_000`, filters in the query key |
| `src/hooks/diary/useDiaryMutations.ts` | `useWriteDiaryEntry` (client-generated id, `toastError`), `useDeleteDiaryEntry` |
| `src/components/diary/diaryMeta.ts` | kind labels, icons, tones, hints and example placeholders; `dueLabel()` |
| `src/components/diary/SchoolDiary.tsx` | tab root: class and kind filter chips, "New entry", date-grouped list, error before empty |
| `src/components/diary/DiaryEntryCard.tsx` | full-body card with kind disc, for-whom meta line, due chip, author-only remove (AlertDialog) |
| `src/components/diary/DiaryComposer.tsx` | `MobileSheet` (md): kind cards, class + whole-class/one-student, title, details, due date; pointer to Homework module |
| `src/pages/school/CommunicationPage.tsx` | "School Diary" tab between Notice Board and PTM, only when `school_diary` is enabled |
| `featuresData.ts` | `school_diary` feature registered, default off |

Class picker: `notice_target_options` (already server-scoped per role). Student picker:
`notice_class_students`. Both exist; no new picker RPCs.

## Verification (after the migration)

| Check | Expected |
|---|---|
| Teacher writes homework for 9-A with a due date | every 9-A student sees it in the Diary tab and gets a `diary_homework` bell row; the teacher sees it under Today with "Due Mon 9 Sep" |
| Teacher writes a remark for one student | only that student sees it; a classmate does not, by id or in the feed |
| Teacher picks a class they do not teach (by hand-crafted call) | RPC refuses with a plain message |
| Student opens the tab | no "New entry" button, no class filter; feed is theirs only |
| Author removes an entry | gone for everyone; a non-author teacher gets no kebab and the RPC refuses |
| Double-tap "Add to diary" | one row (`SELECT count(*) WHERE id = …` is 1) |
| Flag off | no tab, no route param effect (`?tab=diary` falls back to the default tab) |
| 375px and dark mode | composer floats as a panel on desktop, flush on phone; cards and chips flip |
