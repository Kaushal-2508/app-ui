# Class Attendance: Date Navigation + 2-Day Edit Window

**Date:** 2026-08-11
**Status:** Approved

## Problem

The teacher "Today's Attendance" tab ([ClassAttendanceMarker.tsx](../../../src/components/attendance/ClassAttendanceMarker.tsx)) hardcodes `today` — past attendance can neither be viewed nor corrected. The requested behavior: a calendar in the class header to switch dates; the roster shows exactly what was marked on that date; the teacher who took attendance can change only the past 2 days.

## Decisions (confirmed with user)

1. **Window = today + 2 days back.** On 11 Aug, the teacher can edit 9, 10, 11 Aug. Older dates are view-only.
2. **The 2-day rule replaces the 12-hour edit window** for this flow. `student_attendance_edit_window_hours` is retired from the marker (column stays in DB, unused).
3. **Backfill allowed.** An unmarked past date within the window can be submitted fresh; first marker becomes the owner.
4. **DB-trigger enforced**, not just UI.

## UI

- The static "Tuesday, 11 Aug" eyebrow becomes a date control in the header row: prev/next day chevrons + a calendar button (shadcn Popover + Calendar). Future dates disabled in the calendar; any past date is viewable.
- Selected date feeds `useAttendanceByClassDate(classId, selectedDate)` — the roster reflects that day's records.
- Locked dates (older than window, for teachers): read-only status pills rendered from actual records (`Present` / `Absent` / `Not marked` — never the default-present draft), with a "View only" banner.
- "Marked by another teacher" lock unchanged.
- Admins (who share this tab) bypass the date lock — matches their full-access RLS.
- Save writes the selected date; the button label follows existing records ("Submit" vs "Update").

## Lock logic

`computeAttendanceLock` in [useClassAttendance.ts](../../../src/hooks/useClassAttendance.ts) becomes date-based:

- Inputs: records, currentUserId, selected date, windowDays (settings, default 2), isAdmin.
- `isAdmin` → always editable.
- date older than `today − windowDays` (browser-local today, consistent with existing `isPastCutoff` India-only stance) → locked `past-window`.
- Any record marked by someone else → locked `different-marker`.
- Otherwise editable.

## Settings

- New column `attendance_settings.student_attendance_edit_window_days INTEGER NOT NULL DEFAULT 2`.
- `DEFAULT_ATTENDANCE_SETTINGS` + `AttendanceSettingsRow` gain the field; the admin settings form field switches from hours to days.

## DB enforcement

Migration `20260811*_attendance_edit_window_days_and_guard.sql`:

1. Add the settings column.
2. `enforce_student_attendance_edit_window()` BEFORE INSERT OR UPDATE trigger on `attendance_records`:
   - `auth.uid() IS NULL` (service role / cron) → allow.
   - Super admin or institution admin → allow.
   - Compute `today` as `(now() AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date` (§24 — never bare CURRENT_DATE).
   - Reject `NEW.date > today` and `NEW.date < today − window_days` (window from settings, COALESCE 2).
   - On UPDATE: reject when `OLD.marked_by IS NOT NULL AND OLD.marked_by <> auth.uid()` — hardens the different-marker lock server-side.
   - Error messages short + non-technical so `toastError`'s `isLikelyUserFriendly` passes them through.
3. Applied to prod via Mgmt API SQL (migration ledger is stale — never `db push` blind); file committed to `supabase/migrations/`.

## Error handling

- Trigger rejections surface via the existing `useUpsertAttendance` → `toastError` path.
- Locked-date UI renders records-or-not-marked; the error state of the records query renders before any empty state (§6).

## Out of scope

- The read-only "Class Attendance" flow (`TeacherClassAttendanceFlow`) keeps its today-only summary.
- Parent absent-notification trigger fires on backfilled absents — accepted, arguably correct.
- Class tiles' "Marked today" state remains today-based.