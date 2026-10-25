-- Hybrid exams have a "Require face check at start" switch that promises to
-- "Match the student's webcam against their enrolled photo before they can
-- begin". No such matching exists anywhere in the codebase: HybridCameraGate is
-- a plain camera-permission prompt, and require_face_check is written and
-- selected but read by NOTHING. Five exams currently have it ON, so five
-- teachers believe they have identity verification they have never had.
--
-- Meanwhile the camera gate is unconditional, so the setting a teacher DOES
-- want (should this exam be camera-proctored at all?) does not exist, and a
-- student whose camera is blocked cannot sit a hybrid exam by any route.
--
-- This adds the honest setting. It is NOT a rename of require_face_check:
-- that column defaults to false and 24 of 29 exams have it false, so reusing it
-- would silently switch proctoring OFF for every one of them -- while 298
-- proctoring snapshots show the camera is genuinely in use.

ALTER TABLE public.hybrid_exam_settings
  ADD COLUMN IF NOT EXISTS require_camera BOOLEAN NOT NULL DEFAULT true;

-- ADD COLUMN ... NOT NULL DEFAULT true already backfills every existing row to
-- true, which is the point: behaviour for all existing hybrid exams is
-- unchanged by this migration. The setting only starts to bite when a teacher
-- deliberately turns it off on a new exam.

COMMENT ON COLUMN public.hybrid_exam_settings.require_camera IS
  'Camera-proctor this hybrid exam: gates the attempt-page camera prompt and the snapshot monitor. Default true, and all rows existing at 2026-09-04 were backfilled true, so enabling this changed no exam''s behaviour.';

-- require_face_check is now dead weight, but it is NOT dropped here.
-- CLAUDE.md 2: a migration that drops a column must not land before the
-- frontend that stops reading it. This SQL is applied to prod immediately while
-- the deployed frontend still selects require_face_check in the hybrid attempt
-- payload -- dropping it now would 400 that query and take the whole hybrid
-- attempt page down, exactly like the reported_issues.admin_notes drop on
-- 2026-08-31. Drop it in a later migration, once the release below is live.
COMMENT ON COLUMN public.hybrid_exam_settings.require_face_check IS
  'DEPRECATED 2026-09-04, inert. Never implemented: no webcam/photo matching exists. Superseded by require_camera. Safe to drop only after the release that stops selecting it is deployed.';
