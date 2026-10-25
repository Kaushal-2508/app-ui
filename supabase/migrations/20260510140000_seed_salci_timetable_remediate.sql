-- =====================================================================
-- Salci National School — Timetable remediation
-- =====================================================================
-- The first timetable seed ran with 5 over-subscribed teachers (Tarun
-- Mehta on EVS for all 16 N–5 sections, Pooja Rao on Hindi 10 sections,
-- Vikas Patel on Computer 10 sections), leaving 125 'free' slots.
--
-- This migration:
--   1) creates 5 new test teachers (3 EVS, 1 Hindi, 1 Computer)
--   2) splits the over-subscribed teachers' class_assignments —
--      Tarun keeps Class 4–5, the new EVS teachers cover N–Class 3
--   3) deletes the 'free' marker slots
--   4) re-runs the per-class round-robin fill against the new teacher
--      pool (every still-empty cell tries the new candidates)
--
-- Idempotent. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The same user-creation helper as the previous seed.
CREATE OR REPLACE FUNCTION pg_temp.salci_seed_user(
  p_email          TEXT,
  p_full_name      TEXT,
  p_password       TEXT,
  p_institution_id UUID,
  p_role           TEXT,
  p_roll_number    TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $func$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, institution_id, full_name, email, roll_number, is_active)
    VALUES (v_user_id, p_institution_id, p_full_name, p_email, p_roll_number, true)
    ON CONFLICT (id) DO UPDATE SET
      institution_id = EXCLUDED.institution_id,
      full_name      = EXCLUDED.full_name,
      email          = EXCLUDED.email,
      roll_number    = COALESCE(EXCLUDED.roll_number, public.profiles.roll_number),
      is_active      = true;
    INSERT INTO public.user_roles (user_id, role, institution_id)
    VALUES (v_user_id, p_role::public.app_role, p_institution_id)
    ON CONFLICT (user_id, role, institution_id) DO NOTHING;
    RETURN v_user_id;
  END IF;

  v_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, is_anonymous,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    reauthentication_token, phone_change, phone_change_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    now(), now(), false,
    '', '', '', '', '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    created_at, updated_at, last_sign_in_at
  ) VALUES (
    gen_random_uuid(), v_user_id,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', p_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email', v_user_id::text,
    now(), now(), now()
  );

  INSERT INTO public.profiles (id, institution_id, full_name, email, roll_number, is_active)
  VALUES (v_user_id, p_institution_id, p_full_name, p_email, p_roll_number, true)
  ON CONFLICT (id) DO UPDATE SET
    institution_id = EXCLUDED.institution_id,
    full_name      = EXCLUDED.full_name,
    email          = EXCLUDED.email,
    roll_number    = COALESCE(EXCLUDED.roll_number, public.profiles.roll_number),
    is_active      = true;

  INSERT INTO public.user_roles (user_id, role, institution_id)
  VALUES (v_user_id, p_role::public.app_role, p_institution_id)
  ON CONFLICT (user_id, role, institution_id) DO NOTHING;

  RETURN v_user_id;
END;
$func$;

DO $seed$
DECLARE
  v_inst       UUID;
  v_year       TEXT := '2026-2027';
  v_old_year   TEXT := '2025-2026';
  v_pwd        TEXT := 'Salci@2026';
  v_struct_id  UUID;
  v_subj_evs   UUID;
  v_subj_hindi UUID;
  v_subj_cs    UUID;
  v_user       UUID;
  v_class      UUID;
  v_old_user   UUID;
  v_cls        RECORD;
  v_pair       RECORD;
  v_day        TEXT;
  v_assigned   BOOLEAN;
  v_teaching_period_ids UUID[];
  v_pair_count   INTEGER;
  v_pair_index   INTEGER;
  v_loop_offset  INTEGER;
  v_inserted     INTEGER := 0;
  v_still_free   INTEGER := 0;
  v_classes_done INTEGER := 0;
  WORKING_DAYS CONSTANT TEXT[] := ARRAY['monday','tuesday','wednesday','thursday','friday'];

  -- (email_local, full_name, subject, [class_name, section]+)
  reassignments CONSTANT TEXT[][] := ARRAY[
    ARRAY['pranita.desai',  'Pranita Desai',  'Environmental Studies', 'Nursery', 'A'],
    ARRAY['pranita.desai',  'Pranita Desai',  'Environmental Studies', 'LKG',     'A'],
    ARRAY['pranita.desai',  'Pranita Desai',  'Environmental Studies', 'UKG',     'A'],
    ARRAY['pranita.desai',  'Pranita Desai',  'Environmental Studies', 'Class 1', 'A'],

    ARRAY['quita.bose',     'Quita Bose',     'Environmental Studies', 'Nursery', 'B'],
    ARRAY['quita.bose',     'Quita Bose',     'Environmental Studies', 'LKG',     'B'],
    ARRAY['quita.bose',     'Quita Bose',     'Environmental Studies', 'UKG',     'B'],
    ARRAY['quita.bose',     'Quita Bose',     'Environmental Studies', 'Class 1', 'B'],

    ARRAY['reema.chand',    'Reema Chand',    'Environmental Studies', 'Class 2', 'A'],
    ARRAY['reema.chand',    'Reema Chand',    'Environmental Studies', 'Class 2', 'B'],
    ARRAY['reema.chand',    'Reema Chand',    'Environmental Studies', 'Class 3', 'A'],
    ARRAY['reema.chand',    'Reema Chand',    'Environmental Studies', 'Class 3', 'B'],
    -- Tarun keeps Class 4 A/B and Class 5 A/B (4 sections × 7 periods = 28; fits fine).

    ARRAY['sangita.roy',    'Sangita Roy',    'Hindi',                 'UKG',     'A'],
    ARRAY['sangita.roy',    'Sangita Roy',    'Hindi',                 'UKG',     'B'],
    ARRAY['sangita.roy',    'Sangita Roy',    'Hindi',                 'Class 1', 'A'],
    ARRAY['sangita.roy',    'Sangita Roy',    'Hindi',                 'Class 1', 'B'],
    ARRAY['sangita.roy',    'Sangita Roy',    'Hindi',                 'Class 2', 'A'],
    ARRAY['sangita.roy',    'Sangita Roy',    'Hindi',                 'Class 2', 'B'],
    -- Pooja keeps Nursery A/B + LKG A/B (4 sections).

    ARRAY['tanvi.joshi',    'Tanvi Joshi',    'Computer Science',      'Class 9', 'A'],
    ARRAY['tanvi.joshi',    'Tanvi Joshi',    'Computer Science',      'Class 9', 'B'],
    ARRAY['tanvi.joshi',    'Tanvi Joshi',    'Computer Science',      'Class 10','A'],
    ARRAY['tanvi.joshi',    'Tanvi Joshi',    'Computer Science',      'Class 10','B']
    -- Vikas keeps Class 6/7/8 (6 sections) + Class 4/5 already on Uma.
  ];
BEGIN
  SELECT id INTO v_inst FROM public.institutions WHERE name = 'Salci National School' LIMIT 1;
  IF v_inst IS NULL THEN
    RAISE NOTICE 'Salci National School not found — skipping remediation.';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------
  -- 0) Promote the 2025-2026 seed to 2026-2027.
  --    The previous seed migrations created class_groups, classes,
  --    tt_class_structure, and tt_slots with academic_year='2025-2026'.
  --    For test purposes we want the active AY to read 2026-2027.
  --    All four uniqueness constraints include academic_year, so no
  --    conflicts unless someone has already created 2026-2027 rows by
  --    hand (in which case the UPDATE will fail loudly — investigate).
  -- ---------------------------------------------------------------
  UPDATE public.tt_slots
  SET academic_year = v_year
  WHERE institution_id = v_inst AND academic_year = v_old_year;

  UPDATE public.tt_class_structure
  SET academic_year = v_year
  WHERE institution_id = v_inst AND academic_year = v_old_year;

  UPDATE public.classes
  SET academic_year = v_year
  WHERE institution_id = v_inst AND academic_year = v_old_year;

  UPDATE public.class_groups
  SET academic_year = v_year
  WHERE institution_id = v_inst AND academic_year = v_old_year;

  -- Rename the period structure too (cosmetic — same UUID, same slots).
  UPDATE public.tt_period_structures
  SET name = 'Salci Standard 2026-27'
  WHERE institution_id = v_inst AND name = 'Salci Standard 2025-26';

  SELECT id INTO v_struct_id
  FROM public.tt_period_structures
  WHERE institution_id = v_inst AND name = 'Salci Standard 2026-27';
  IF v_struct_id IS NULL THEN
    RAISE NOTICE 'Timetable structure not found — skipping remediation.';
    RETURN;
  END IF;

  SELECT array_agg(id ORDER BY period_number)
  INTO v_teaching_period_ids
  FROM public.tt_period_slots
  WHERE structure_id = v_struct_id AND kind = 'period';

  SELECT id INTO v_subj_evs
  FROM public.universal_subjects
  WHERE institution_id IS NULL AND grade_level_id IS NULL
    AND LOWER(name) = 'environmental studies'
  ORDER BY created_at LIMIT 1;
  SELECT id INTO v_subj_hindi
  FROM public.universal_subjects
  WHERE institution_id IS NULL AND grade_level_id IS NULL AND LOWER(name) = 'hindi'
  ORDER BY created_at LIMIT 1;
  SELECT id INTO v_subj_cs
  FROM public.universal_subjects
  WHERE institution_id IS NULL AND grade_level_id IS NULL AND LOWER(name) = 'computer science'
  ORDER BY created_at LIMIT 1;

  -- ---------------------------------------------------------------
  -- 1) Create the 5 new teachers + 2) reassign their sections.
  --    For each row in `reassignments`:
  --      a) ensure the new teacher exists
  --      b) delete the *previous* teacher's class_assignments row for
  --         (class, subject) so the round-robin in step 4 picks the
  --         new teacher only
  --      c) insert the new (teacher, class, subject) row
  -- ---------------------------------------------------------------
  FOR i IN 1..array_length(reassignments, 1) LOOP
    v_user := pg_temp.salci_seed_user(
      reassignments[i][1] || '@salci-test.in',
      reassignments[i][2],
      v_pwd, v_inst, 'teacher'
    );

    SELECT id INTO v_class
    FROM public.classes
    WHERE institution_id = v_inst
      AND name = reassignments[i][4]
      AND section = reassignments[i][5]
      AND academic_year = v_year
    LIMIT 1;
    IF v_class IS NULL THEN CONTINUE; END IF;

    -- Remove previous (overloaded) teacher's row for this (class, subject)
    -- so only the new assignment is active. Keeps the per-class subject
    -- list clean.
    DELETE FROM public.class_assignments ca
    WHERE ca.class_id = v_class
      AND ca.role = 'teacher'
      AND ca.subject_id = (
        CASE reassignments[i][3]
          WHEN 'Environmental Studies' THEN v_subj_evs
          WHEN 'Hindi' THEN v_subj_hindi
          WHEN 'Computer Science' THEN v_subj_cs
        END
      )
      AND ca.user_id <> v_user;

    INSERT INTO public.class_assignments (user_id, class_id, subject_id, role)
    VALUES (
      v_user, v_class,
      CASE reassignments[i][3]
        WHEN 'Environmental Studies' THEN v_subj_evs
        WHEN 'Hindi' THEN v_subj_hindi
        WHEN 'Computer Science' THEN v_subj_cs
      END,
      'teacher'
    )
    ON CONFLICT (user_id, class_id, subject_id) DO NOTHING;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 3) Drop the existing 'free' marker slots so step 4 can replace
  --    them. Also drop the busy-table entries those slots populated
  --    (none — free slots have NULL teacher_id, but we rebuild from
  --    scratch anyway in step 4).
  -- ---------------------------------------------------------------
  DELETE FROM public.tt_slots
  WHERE institution_id = v_inst
    AND academic_year  = v_year
    AND slot_type      = 'free';

  -- ---------------------------------------------------------------
  -- 4) Re-run the per-class round-robin fill for cells that no
  --    longer have a row (the deleted 'free' ones plus any class
  --    that got a fresh teacher above whose slot is missing).
  -- ---------------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.tt_busy;
  CREATE TEMP TABLE pg_temp.tt_busy (
    teacher_id UUID NOT NULL, day TEXT NOT NULL, period_slot_id UUID NOT NULL,
    PRIMARY KEY (teacher_id, day, period_slot_id)
  );
  INSERT INTO pg_temp.tt_busy (teacher_id, day, period_slot_id)
  SELECT s.teacher_id, s.day, s.period_slot_id
  FROM public.tt_slots s
  WHERE s.institution_id = v_inst
    AND s.academic_year  = v_year
    AND s.teacher_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  FOR v_cls IN
    SELECT c.id, c.name, c.section
    FROM public.classes c
    WHERE c.institution_id = v_inst
      AND c.academic_year  = v_year
      AND c.is_active      = true
    ORDER BY c.name, c.section
  LOOP
    DROP TABLE IF EXISTS pg_temp.tt_pairs;
    CREATE TEMP TABLE pg_temp.tt_pairs (
      ord         INTEGER PRIMARY KEY,
      subject_id  UUID NOT NULL,
      teacher_id  UUID NOT NULL
    ) ON COMMIT DROP;
    INSERT INTO pg_temp.tt_pairs (ord, subject_id, teacher_id)
    SELECT ROW_NUMBER() OVER (ORDER BY us.name) AS ord, ca.subject_id, ca.user_id
    FROM public.class_assignments ca
    JOIN public.universal_subjects us ON us.id = ca.subject_id
    WHERE ca.class_id = v_cls.id
      AND ca.role     = 'teacher'
      AND ca.subject_id IS NOT NULL;
    SELECT COUNT(*) INTO v_pair_count FROM pg_temp.tt_pairs;
    IF v_pair_count = 0 THEN
      v_classes_done := v_classes_done + 1;
      CONTINUE;
    END IF;

    v_pair_index := 0;
    FOREACH v_day IN ARRAY WORKING_DAYS LOOP
      FOR i IN 1..array_length(v_teaching_period_ids, 1) LOOP
        -- Skip cells that already have a published row.
        IF EXISTS (
          SELECT 1 FROM public.tt_slots s
          WHERE s.class_id = v_cls.id
            AND s.period_slot_id = v_teaching_period_ids[i]
            AND s.day = v_day
            AND s.academic_year = v_year
        ) THEN
          v_pair_index := v_pair_index + 1;
          CONTINUE;
        END IF;

        v_assigned := false;
        FOR v_loop_offset IN 0..(v_pair_count - 1) LOOP
          SELECT * INTO v_pair
          FROM pg_temp.tt_pairs
          WHERE ord = ((v_pair_index + v_loop_offset) % v_pair_count) + 1;
          IF NOT EXISTS (
            SELECT 1 FROM pg_temp.tt_busy b
            WHERE b.teacher_id     = v_pair.teacher_id
              AND b.day            = v_day
              AND b.period_slot_id = v_teaching_period_ids[i]
          ) THEN
            INSERT INTO public.tt_slots
              (institution_id, class_id, period_slot_id, day, academic_year,
               slot_type, subject_id, teacher_id)
            VALUES
              (v_inst, v_cls.id, v_teaching_period_ids[i], v_day, v_year,
               'theory', v_pair.subject_id, v_pair.teacher_id)
            ON CONFLICT (class_id, period_slot_id, day, academic_year) DO NOTHING;
            INSERT INTO pg_temp.tt_busy (teacher_id, day, period_slot_id)
            VALUES (v_pair.teacher_id, v_day, v_teaching_period_ids[i])
            ON CONFLICT DO NOTHING;
            v_assigned := true;
            v_inserted := v_inserted + 1;
            EXIT;
          END IF;
        END LOOP;

        IF NOT v_assigned THEN
          INSERT INTO public.tt_slots
            (institution_id, class_id, period_slot_id, day, academic_year,
             slot_type, subject_id, teacher_id)
          VALUES
            (v_inst, v_cls.id, v_teaching_period_ids[i], v_day, v_year,
             'free', NULL, NULL)
          ON CONFLICT (class_id, period_slot_id, day, academic_year) DO NOTHING;
          v_still_free := v_still_free + 1;
        END IF;
        v_pair_index := v_pair_index + 1;
      END LOOP;
    END LOOP;

    v_classes_done := v_classes_done + 1;
  END LOOP;

  RAISE NOTICE 'Remediation: % classes processed, % new teaching slots filled, % still free',
    v_classes_done, v_inserted, v_still_free;
END;
$seed$;
