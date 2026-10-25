-- Extend tt_slots.slot_type to allow 'other' with a required free-text label.
--
-- Design: docs/superpowers/specs/2026-07-25-timetable-other-slot-type-design.md
--
-- The existing CHECK constraint tt_slots_type_chk was created in
-- 20260424100000_tt_cal_phase1_schema.sql:176. Postgres has no ALTER CHECK,
-- so we drop and recreate.

BEGIN;

ALTER TABLE public.tt_slots
  DROP CONSTRAINT IF EXISTS tt_slots_type_chk;

ALTER TABLE public.tt_slots
  ADD CONSTRAINT tt_slots_type_chk
  CHECK (slot_type IN (
    'theory','practical','library','sports',
    'arts','assembly','free','break','other'
  ));

ALTER TABLE public.tt_slots
  ADD COLUMN IF NOT EXISTS custom_label TEXT;

-- custom_label is only meaningful when slot_type='other'.
ALTER TABLE public.tt_slots
  DROP CONSTRAINT IF EXISTS tt_slots_custom_label_scope_chk;
ALTER TABLE public.tt_slots
  ADD CONSTRAINT tt_slots_custom_label_scope_chk
  CHECK (custom_label IS NULL OR slot_type = 'other');

-- When present, custom_label must be a non-blank string, 1–40 chars trimmed.
-- Prevents empty-string or whitespace-only labels bypassing the UI gate.
ALTER TABLE public.tt_slots
  DROP CONSTRAINT IF EXISTS tt_slots_custom_label_len_chk;
ALTER TABLE public.tt_slots
  ADD CONSTRAINT tt_slots_custom_label_len_chk
  CHECK (custom_label IS NULL
         OR char_length(btrim(custom_label)) BETWEEN 1 AND 40);

COMMENT ON COLUMN public.tt_slots.custom_label IS
  'Free-text label shown in the cell when slot_type=other (e.g. Lunch, Football). Required when slot_type=other; must be NULL otherwise.';

COMMIT;
