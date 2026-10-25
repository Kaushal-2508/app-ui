-- =====================================================================
-- Salci National School — TEST DATA seed (Phase 2: users)
-- =====================================================================
-- Creates auth.users + profiles + user_roles + class_assignments +
-- wing_assignments for:
--   - 2 coordinators (Junior Wing, Senior Wing)
--   - 32 teachers with varied class loads (1 → 16 classes each)
--   - 240 students (8 per class × 30 classes)
--
-- Default password for every test user: Salci@2026
-- Email domain: @salci-test.in (so cleanup is one query)
--
-- Cleanup query when you're done testing:
--   DELETE FROM auth.users WHERE email LIKE '%@salci-test.in';
-- (cascades through profiles + every FK pointing at profiles(id))
--
-- Idempotent: each user creation checks auth.users.email first;
-- assignments use ON CONFLICT DO NOTHING.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Helper: create-or-fetch a user. Returns the user_id either way.
-- Wraps auth.users + auth.identities + public.profiles + public.user_roles.
-- Lives in pg_temp so it auto-evaporates at session end.
-- ---------------------------------------------------------------------
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
    -- Make sure the profile / role state is in sync (idempotent re-runs).
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
    created_at, updated_at, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    now(), now(),
    false
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    created_at, updated_at, last_sign_in_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', p_email),
    'email',
    v_user_id::text,
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

-- ---------------------------------------------------------------------
-- Main seed
-- ---------------------------------------------------------------------
DO $seed$
DECLARE
  v_inst        UUID;
  v_year        TEXT := '2025-2026';
  v_pwd         TEXT := 'Salci@2026';
  v_user_id     UUID;
  v_class_id    UUID;
  v_subject_id  UUID;
  v_wing_id     UUID;
  cls           RECORD;
  i             INTEGER;
  v_teachers    INTEGER := 0;
  v_students    INTEGER := 0;
  v_coords      INTEGER := 0;

  -- Teachers: each row = (email_local, full_name, subject_name).
  -- Class assignments are pulled from a separate matrix below so the
  -- list stays human-readable.
  teacher_specs CONSTANT TEXT[][] := ARRAY[
    -- English
    ARRAY['anita.sharma',     'Anita Sharma',     'English'],
    ARRAY['bharat.verma',     'Bharat Verma',     'English'],
    ARRAY['chitra.kapoor',    'Chitra Kapoor',    'English'],
    ARRAY['deepa.iyer',       'Deepa Iyer',       'English'],
    ARRAY['esha.mehra',       'Esha Mehra',       'English'],
    ARRAY['farah.sheikh',     'Farah Sheikh',     'English'],
    ARRAY['gaurav.sinha',     'Gaurav Sinha',     'English'],
    -- Mathematics
    ARRAY['hari.om',          'Hari Om',          'Mathematics'],
    ARRAY['isha.khanna',      'Isha Khanna',      'Mathematics'],
    ARRAY['jay.bhatt',        'Jay Bhatt',        'Mathematics'],
    ARRAY['kavita.krishnan',  'Kavita Krishnan',  'Mathematics'],
    ARRAY['lakshmi.deshmukh', 'Lakshmi Deshmukh', 'Mathematics'],
    ARRAY['manoj.joshi',      'Manoj Joshi',      'Mathematics'],
    ARRAY['neha.pillai',      'Neha Pillai',      'Mathematics'],
    ARRAY['om.prakash',       'Om Prakash',       'Mathematics'],
    -- Hindi
    ARRAY['pooja.rao',        'Pooja Rao',        'Hindi'],
    ARRAY['quentin.dsouza',   'Quentin Dsouza',   'Hindi'],
    ARRAY['ravi.sharma',      'Ravi Sharma',      'Hindi'],
    ARRAY['smita.banerjee',   'Smita Banerjee',   'Hindi'],
    -- Environmental Studies
    ARRAY['tarun.mehta',      'Tarun Mehta',      'Environmental Studies'],
    -- Computer Science
    ARRAY['uma.bhardwaj',     'Uma Bhardwaj',     'Computer Science'],
    ARRAY['vikas.patel',      'Vikas Patel',      'Computer Science'],
    -- Science (middle)
    ARRAY['wahid.ali',        'Wahid Ali',        'Science'],
    -- Social Studies
    ARRAY['xeena.cherian',    'Xeena Cherian',    'Social Studies'],
    ARRAY['yash.tiwari',      'Yash Tiwari',      'Social Studies'],
    -- Physics
    ARRAY['zara.lal',         'Zara Lal',         'Physics'],
    ARRAY['anjali.roy',       'Anjali Roy',       'Physics'],
    ARRAY['bikash.das',       'Bikash Das',       'Physics'],
    -- Chemistry
    ARRAY['chaitra.reddy',    'Chaitra Reddy',    'Chemistry'],
    ARRAY['dinesh.singh',     'Dinesh Singh',     'Chemistry'],
    -- Biology
    ARRAY['esther.john',      'Esther John',      'Biology'],
    ARRAY['faisal.ahmed',     'Faisal Ahmed',     'Biology']
  ];

  -- Assignment matrix: one row per (teacher_email_local, class_name, section).
  -- Variety in counts: some teach 1 class, others up to 16.
  assignments CONSTANT TEXT[][] := ARRAY[
    -- ENGLISH
    ARRAY['anita.sharma',  'Nursery', 'A'], ARRAY['anita.sharma',  'Nursery', 'B'], ARRAY['anita.sharma',  'LKG', 'A'], ARRAY['anita.sharma',  'LKG', 'B'],
    ARRAY['bharat.verma',  'UKG', 'A'], ARRAY['bharat.verma',  'UKG', 'B'], ARRAY['bharat.verma',  'Class 1', 'A'], ARRAY['bharat.verma',  'Class 1', 'B'], ARRAY['bharat.verma',  'Class 2', 'A'], ARRAY['bharat.verma',  'Class 2', 'B'],
    ARRAY['chitra.kapoor', 'Class 3', 'A'], ARRAY['chitra.kapoor', 'Class 3', 'B'], ARRAY['chitra.kapoor', 'Class 4', 'A'],
    ARRAY['deepa.iyer',    'Class 4', 'B'], ARRAY['deepa.iyer',    'Class 5', 'A'], ARRAY['deepa.iyer',    'Class 5', 'B'],
    ARRAY['esha.mehra',    'Class 6', 'A'], ARRAY['esha.mehra',    'Class 6', 'B'], ARRAY['esha.mehra',    'Class 7', 'A'], ARRAY['esha.mehra',    'Class 7', 'B'], ARRAY['esha.mehra',    'Class 8', 'A'], ARRAY['esha.mehra',    'Class 8', 'B'],
    ARRAY['farah.sheikh',  'Class 9', 'A'], ARRAY['farah.sheikh',  'Class 9', 'B'], ARRAY['farah.sheikh',  'Class 10', 'A'], ARRAY['farah.sheikh',  'Class 10', 'B'],
    ARRAY['gaurav.sinha',  'Class 11', 'A'], ARRAY['gaurav.sinha',  'Class 11', 'B'], ARRAY['gaurav.sinha',  'Class 12', 'A'], ARRAY['gaurav.sinha',  'Class 12', 'B'],
    -- MATHEMATICS
    ARRAY['hari.om',       'Nursery', 'A'], ARRAY['hari.om',       'Nursery', 'B'], ARRAY['hari.om',       'LKG', 'A'], ARRAY['hari.om',       'LKG', 'B'], ARRAY['hari.om',       'UKG', 'A'], ARRAY['hari.om',       'UKG', 'B'],
    ARRAY['isha.khanna',   'Class 1', 'A'], ARRAY['isha.khanna',   'Class 2', 'A'], ARRAY['isha.khanna',   'Class 3', 'A'],
    ARRAY['jay.bhatt',     'Class 1', 'B'], ARRAY['jay.bhatt',     'Class 2', 'B'], ARRAY['jay.bhatt',     'Class 3', 'B'],
    ARRAY['kavita.krishnan',  'Class 4', 'A'],
    ARRAY['lakshmi.deshmukh', 'Class 4', 'B'], ARRAY['lakshmi.deshmukh', 'Class 5', 'A'], ARRAY['lakshmi.deshmukh', 'Class 5', 'B'],
    ARRAY['manoj.joshi',   'Class 6', 'A'], ARRAY['manoj.joshi',   'Class 6', 'B'], ARRAY['manoj.joshi',   'Class 7', 'A'], ARRAY['manoj.joshi',   'Class 7', 'B'], ARRAY['manoj.joshi',   'Class 8', 'A'], ARRAY['manoj.joshi',   'Class 8', 'B'],
    ARRAY['neha.pillai',   'Class 9', 'A'], ARRAY['neha.pillai',   'Class 9', 'B'], ARRAY['neha.pillai',   'Class 10', 'A'], ARRAY['neha.pillai',   'Class 10', 'B'],
    ARRAY['om.prakash',    'Class 11', 'A'], ARRAY['om.prakash',    'Class 11', 'B'], ARRAY['om.prakash',    'Class 12', 'A'], ARRAY['om.prakash',    'Class 12', 'B'],
    -- HINDI
    ARRAY['pooja.rao',     'Nursery', 'A'], ARRAY['pooja.rao',     'Nursery', 'B'], ARRAY['pooja.rao',     'LKG', 'A'], ARRAY['pooja.rao',     'LKG', 'B'], ARRAY['pooja.rao',     'UKG', 'A'], ARRAY['pooja.rao',     'UKG', 'B'],
    ARRAY['pooja.rao',     'Class 1', 'A'], ARRAY['pooja.rao',     'Class 1', 'B'], ARRAY['pooja.rao',     'Class 2', 'A'], ARRAY['pooja.rao',     'Class 2', 'B'],
    ARRAY['quentin.dsouza','Class 3', 'A'], ARRAY['quentin.dsouza','Class 3', 'B'], ARRAY['quentin.dsouza','Class 4', 'A'], ARRAY['quentin.dsouza','Class 4', 'B'], ARRAY['quentin.dsouza','Class 5', 'A'], ARRAY['quentin.dsouza','Class 5', 'B'],
    ARRAY['ravi.sharma',   'Class 6', 'A'], ARRAY['ravi.sharma',   'Class 7', 'A'],
    ARRAY['smita.banerjee','Class 6', 'B'], ARRAY['smita.banerjee','Class 7', 'B'], ARRAY['smita.banerjee','Class 8', 'A'], ARRAY['smita.banerjee','Class 8', 'B'], ARRAY['smita.banerjee','Class 9', 'A'], ARRAY['smita.banerjee','Class 9', 'B'], ARRAY['smita.banerjee','Class 10', 'A'], ARRAY['smita.banerjee','Class 10', 'B'],
    -- ENVIRONMENTAL STUDIES (single teacher across all 16 sections N–5)
    ARRAY['tarun.mehta','Nursery', 'A'], ARRAY['tarun.mehta','Nursery', 'B'], ARRAY['tarun.mehta','LKG', 'A'], ARRAY['tarun.mehta','LKG', 'B'], ARRAY['tarun.mehta','UKG', 'A'], ARRAY['tarun.mehta','UKG', 'B'],
    ARRAY['tarun.mehta','Class 1', 'A'], ARRAY['tarun.mehta','Class 1', 'B'], ARRAY['tarun.mehta','Class 2', 'A'], ARRAY['tarun.mehta','Class 2', 'B'], ARRAY['tarun.mehta','Class 3', 'A'], ARRAY['tarun.mehta','Class 3', 'B'], ARRAY['tarun.mehta','Class 4', 'A'], ARRAY['tarun.mehta','Class 4', 'B'], ARRAY['tarun.mehta','Class 5', 'A'], ARRAY['tarun.mehta','Class 5', 'B'],
    -- COMPUTER SCIENCE
    ARRAY['uma.bhardwaj',  'Class 4', 'A'], ARRAY['uma.bhardwaj',  'Class 4', 'B'], ARRAY['uma.bhardwaj',  'Class 5', 'A'], ARRAY['uma.bhardwaj',  'Class 5', 'B'],
    ARRAY['vikas.patel',   'Class 6', 'A'], ARRAY['vikas.patel',   'Class 6', 'B'], ARRAY['vikas.patel',   'Class 7', 'A'], ARRAY['vikas.patel',   'Class 7', 'B'], ARRAY['vikas.patel',   'Class 8', 'A'], ARRAY['vikas.patel',   'Class 8', 'B'], ARRAY['vikas.patel',   'Class 9', 'A'], ARRAY['vikas.patel',   'Class 9', 'B'], ARRAY['vikas.patel',   'Class 10', 'A'], ARRAY['vikas.patel',   'Class 10', 'B'],
    -- SCIENCE (middle)
    ARRAY['wahid.ali','Class 6', 'A'], ARRAY['wahid.ali','Class 6', 'B'], ARRAY['wahid.ali','Class 7', 'A'], ARRAY['wahid.ali','Class 7', 'B'], ARRAY['wahid.ali','Class 8', 'A'], ARRAY['wahid.ali','Class 8', 'B'],
    -- SOCIAL STUDIES
    ARRAY['xeena.cherian','Class 6', 'A'], ARRAY['xeena.cherian','Class 7', 'A'],
    ARRAY['yash.tiwari','Class 6', 'B'], ARRAY['yash.tiwari','Class 7', 'B'], ARRAY['yash.tiwari','Class 8', 'A'], ARRAY['yash.tiwari','Class 8', 'B'], ARRAY['yash.tiwari','Class 9', 'A'], ARRAY['yash.tiwari','Class 9', 'B'], ARRAY['yash.tiwari','Class 10', 'A'], ARRAY['yash.tiwari','Class 10', 'B'],
    -- PHYSICS
    ARRAY['zara.lal','Class 9', 'A'], ARRAY['zara.lal','Class 9', 'B'], ARRAY['zara.lal','Class 10', 'A'], ARRAY['zara.lal','Class 10', 'B'],
    ARRAY['anjali.roy','Class 11', 'A'],
    ARRAY['bikash.das','Class 11', 'B'], ARRAY['bikash.das','Class 12', 'A'], ARRAY['bikash.das','Class 12', 'B'],
    -- CHEMISTRY
    ARRAY['chaitra.reddy','Class 9', 'A'], ARRAY['chaitra.reddy','Class 9', 'B'], ARRAY['chaitra.reddy','Class 10', 'A'], ARRAY['chaitra.reddy','Class 10', 'B'],
    ARRAY['dinesh.singh','Class 11', 'A'], ARRAY['dinesh.singh','Class 11', 'B'], ARRAY['dinesh.singh','Class 12', 'A'], ARRAY['dinesh.singh','Class 12', 'B'],
    -- BIOLOGY
    ARRAY['esther.john','Class 9', 'A'], ARRAY['esther.john','Class 9', 'B'], ARRAY['esther.john','Class 10', 'A'], ARRAY['esther.john','Class 10', 'B'],
    ARRAY['faisal.ahmed','Class 11', 'A'], ARRAY['faisal.ahmed','Class 11', 'B'], ARRAY['faisal.ahmed','Class 12', 'A'], ARRAY['faisal.ahmed','Class 12', 'B']
  ];

  v_subject_lookup_by_email TEXT;
  v_email TEXT;
  v_classname TEXT;
  v_section TEXT;
BEGIN
  SELECT id INTO v_inst FROM public.institutions WHERE name = 'Salci National School' LIMIT 1;
  IF v_inst IS NULL THEN
    RAISE NOTICE 'Salci National School not found — skipping user seed.';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------
  -- Subject lookup table (mirrors the structural seed). Pulls the
  -- GLOBAL universal_subjects rows so teacher class_assignments
  -- below can resolve subject_id without re-querying for every row.
  --
  -- Uses LIMIT 1 per name because duplicate global rows are possible
  -- (the unique index on (grade_level_id, LOWER(name)) treats NULL
  -- grade_level_id as distinct, so multiple rows can exist for the
  -- same subject name).
  -- ---------------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.salci_subj_by_name;
  CREATE TEMP TABLE pg_temp.salci_subj_by_name (
    name TEXT PRIMARY KEY,
    id   UUID NOT NULL
  );

  DECLARE
    v_subj_name TEXT;
    v_subj_id_for_lookup UUID;
    subj_names CONSTANT TEXT[] := ARRAY[
      'English','Hindi','Mathematics','Environmental Studies','Science',
      'Social Studies','Computer Science','Physics','Chemistry','Biology'
    ];
  BEGIN
    FOREACH v_subj_name IN ARRAY subj_names LOOP
      SELECT id INTO v_subj_id_for_lookup
      FROM public.universal_subjects
      WHERE institution_id IS NULL
        AND grade_level_id IS NULL
        AND LOWER(name) = LOWER(v_subj_name)
      ORDER BY created_at ASC
      LIMIT 1;
      IF v_subj_id_for_lookup IS NOT NULL THEN
        INSERT INTO pg_temp.salci_subj_by_name (name, id)
        VALUES (v_subj_name, v_subj_id_for_lookup)
        ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
      END IF;
    END LOOP;
  END;

  -- ---------------------------------------------------------------
  -- 1) Coordinators
  -- ---------------------------------------------------------------
  v_user_id := pg_temp.salci_seed_user(
    'coordinator.junior@salci-test.in', 'Junior Wing Coordinator',
    v_pwd, v_inst, 'coordinator'
  );
  SELECT id INTO v_wing_id FROM public.wings WHERE institution_id = v_inst AND name = 'Junior Wing';
  INSERT INTO public.wing_assignments (wing_id, user_id)
  VALUES (v_wing_id, v_user_id) ON CONFLICT (wing_id, user_id) DO NOTHING;
  v_coords := v_coords + 1;

  v_user_id := pg_temp.salci_seed_user(
    'coordinator.senior@salci-test.in', 'Senior Wing Coordinator',
    v_pwd, v_inst, 'coordinator'
  );
  SELECT id INTO v_wing_id FROM public.wings WHERE institution_id = v_inst AND name = 'Senior Wing';
  INSERT INTO public.wing_assignments (wing_id, user_id)
  VALUES (v_wing_id, v_user_id) ON CONFLICT (wing_id, user_id) DO NOTHING;
  v_coords := v_coords + 1;

  -- ---------------------------------------------------------------
  -- 2) Teachers — create the auth user for each + a lookup table
  --    mapping email_local → subject_name for the assignments loop.
  -- ---------------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.salci_teacher_subj;
  CREATE TEMP TABLE pg_temp.salci_teacher_subj (
    email_local  TEXT PRIMARY KEY,
    subject_name TEXT NOT NULL
  );

  FOR i IN 1..array_length(teacher_specs, 1) LOOP
    PERFORM pg_temp.salci_seed_user(
      teacher_specs[i][1] || '@salci-test.in',
      teacher_specs[i][2],
      v_pwd, v_inst, 'teacher'
    );
    INSERT INTO pg_temp.salci_teacher_subj (email_local, subject_name)
    VALUES (teacher_specs[i][1], teacher_specs[i][3])
    ON CONFLICT (email_local) DO UPDATE SET subject_name = EXCLUDED.subject_name;
    v_teachers := v_teachers + 1;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 3) Teacher class assignments — walks the assignments matrix and
  --    looks up (teacher_email, class_id, subject_id) per row. Subject
  --    is determined from the teacher_specs table via email match.
  -- ---------------------------------------------------------------
  FOR i IN 1..array_length(assignments, 1) LOOP
    v_email     := assignments[i][1] || '@salci-test.in';
    v_classname := assignments[i][2];
    v_section   := assignments[i][3];

    -- Resolve teacher's user_id.
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;
    IF v_user_id IS NULL THEN CONTINUE; END IF;

    -- Resolve teacher's subject from the lookup table built above.
    SELECT subject_name INTO v_subject_lookup_by_email
    FROM pg_temp.salci_teacher_subj WHERE email_local = assignments[i][1];
    SELECT id INTO v_subject_id FROM pg_temp.salci_subj_by_name WHERE name = v_subject_lookup_by_email;

    -- Resolve class id.
    SELECT id INTO v_class_id FROM public.classes
    WHERE institution_id = v_inst
      AND name = v_classname
      AND section = v_section
      AND academic_year = v_year
    LIMIT 1;

    IF v_class_id IS NOT NULL AND v_subject_id IS NOT NULL THEN
      INSERT INTO public.class_assignments (user_id, class_id, subject_id, role)
      VALUES (v_user_id, v_class_id, v_subject_id, 'teacher')
      ON CONFLICT (user_id, class_id, subject_id) DO NOTHING;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 4) Students — 8 per class (rolls 1..8). Email pattern:
  --      student.<classname-lower-no-space>.<section-lower>.<roll>@salci-test.in
  --    e.g. student.class7.b.5@salci-test.in
  --    Roll number stored on profiles.roll_number for the
  --    Phase 4 roster sort.
  -- ---------------------------------------------------------------
  FOR cls IN
    SELECT id, name, section
    FROM public.classes
    WHERE institution_id = v_inst AND academic_year = v_year
  LOOP
    FOR i IN 1..8 LOOP
      DECLARE
        v_local TEXT;
        v_roll  TEXT;
        v_full  TEXT;
      BEGIN
        v_roll := lpad(i::TEXT, 2, '0');
        v_local := 'student.' ||
                   lower(replace(cls.name, ' ', '')) || '.' ||
                   lower(cls.section) || '.' || i::TEXT;
        v_full  := initcap(cls.name) || ' ' || cls.section || ' Student ' || i::TEXT;

        v_user_id := pg_temp.salci_seed_user(
          v_local || '@salci-test.in',
          v_full,
          v_pwd,
          v_inst,
          'student',
          v_roll
        );

        -- subject_id IS NULL on a student row, and the unique constraint
        -- treats NULLs as distinct — so ON CONFLICT can't help here.
        -- Guard with NOT EXISTS to keep the migration re-runnable.
        INSERT INTO public.class_assignments (user_id, class_id, role)
        SELECT v_user_id, cls.id, 'student'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.class_assignments
          WHERE user_id = v_user_id AND class_id = cls.id
            AND role = 'student' AND subject_id IS NULL
        );

        v_students := v_students + 1;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'User seed complete: % coordinators, % teachers, % students.',
    v_coords, v_teachers, v_students;
END;
$seed$;
