-- =====================================================================
-- Salci National School — TIMETABLE seed
-- =====================================================================
-- End-to-end timetable for every seeded class:
--   1) one period structure ("Salci Standard 2025-26"), Mon-Fri,
--      7 teaching periods + 1 mid-morning break
--   2) tt_class_structure rows linking all 30 classes to the structure,
--      publish_status = 'published' so coordinators / teachers /
--      students see the schedule on day one
--   3) tt_slots filled with (teacher, subject) for every (class, day,
--      period). Uses a greedy round-robin per class with a teacher
--      busy-table — if a teacher is already taking a class at that
--      (day, period_slot), the next subject in the rotation is tried.
--      If every subject's teacher is double-booked, the slot is left
--      as a 'free' period so the grid renders cleanly.
--
-- Idempotent. Safe to re-run — every INSERT uses a uniqueness guard.
-- Cleanup query when you're done testing the timetable specifically:
--   DELETE FROM public.tt_period_structures
--    WHERE institution_id = (SELECT id FROM public.institutions WHERE name='Salci National School')
--      AND name = 'Salci Standard 2025-26';
-- (cascades through tt_period_slots, tt_class_structure, tt_slots)

DO $seed$
DECLARE
  v_inst         UUID;
  v_year         TEXT := '2025-2026';
  v_struct_id    UUID;
  v_p1 UUID; v_p2 UUID; v_p3 UUID; v_brk UUID;
  v_p4 UUID; v_p5 UUID; v_p6 UUID; v_p7 UUID;
  v_cls          RECORD;
  v_day          TEXT;
  v_period       RECORD;
  v_pair         RECORD;
  v_assigned     BOOLEAN;
  v_teaching_period_ids UUID[];
  v_pair_count   INTEGER;
  v_pair_index   INTEGER;
  v_loop_offset  INTEGER;
  v_inserted     INTEGER := 0;
  v_skipped      INTEGER := 0;
  v_classes_done INTEGER := 0;
  WORKING_DAYS CONSTANT TEXT[] := ARRAY['monday','tuesday','wednesday','thursday','friday'];
BEGIN
  SELECT id INTO v_inst FROM public.institutions WHERE name = 'Salci National School' LIMIT 1;
  IF v_inst IS NULL THEN
    RAISE NOTICE 'Salci National School not found — skipping timetable seed.';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------
  -- 1) Period structure
  -- ---------------------------------------------------------------
  SELECT id INTO v_struct_id
  FROM public.tt_period_structures
  WHERE institution_id = v_inst AND name = 'Salci Standard 2025-26'
  LIMIT 1;

  IF v_struct_id IS NULL THEN
    INSERT INTO public.tt_period_structures (institution_id, name, working_days)
    VALUES (v_inst, 'Salci Standard 2025-26', WORKING_DAYS)
    RETURNING id INTO v_struct_id;
  END IF;

  -- 8 slots (7 periods + 1 break). The legacy UNIQUE(structure_id,
  -- period_number) was dropped in 20260507100000 to allow per-day
  -- overrides — so we can't ON CONFLICT on it. Existence-check instead;
  -- either zero slots exist (first run) or all 8 do (re-run).
  IF NOT EXISTS (
    SELECT 1 FROM public.tt_period_slots WHERE structure_id = v_struct_id
  ) THEN
    INSERT INTO public.tt_period_slots (structure_id, period_number, label, start_time, end_time, kind)
    VALUES
      (v_struct_id, 1, 'Period 1', '08:00', '08:45', 'period'),
      (v_struct_id, 2, 'Period 2', '08:45', '09:30', 'period'),
      (v_struct_id, 3, 'Period 3', '09:30', '10:15', 'period'),
      (v_struct_id, 4, 'Break',    '10:15', '10:35', 'break'),
      (v_struct_id, 5, 'Period 4', '10:35', '11:20', 'period'),
      (v_struct_id, 6, 'Period 5', '11:20', '12:05', 'period'),
      (v_struct_id, 7, 'Period 6', '12:05', '12:50', 'period'),
      (v_struct_id, 8, 'Period 7', '12:50', '13:35', 'period');
  END IF;

  SELECT id INTO v_p1 FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 1;
  SELECT id INTO v_p2 FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 2;
  SELECT id INTO v_p3 FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 3;
  SELECT id INTO v_brk FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 4;
  SELECT id INTO v_p4 FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 5;
  SELECT id INTO v_p5 FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 6;
  SELECT id INTO v_p6 FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 7;
  SELECT id INTO v_p7 FROM public.tt_period_slots WHERE structure_id = v_struct_id AND period_number = 8;

  v_teaching_period_ids := ARRAY[v_p1, v_p2, v_p3, v_p4, v_p5, v_p6, v_p7];

  -- ---------------------------------------------------------------
  -- 2) Link every active class to the structure (published).
  -- ---------------------------------------------------------------
  INSERT INTO public.tt_class_structure
    (institution_id, class_id, structure_id, academic_year, publish_status, published_at)
  SELECT v_inst, c.id, v_struct_id, v_year, 'published', now()
  FROM public.classes c
  WHERE c.institution_id = v_inst
    AND c.academic_year  = v_year
    AND c.is_active      = true
  ON CONFLICT (class_id, academic_year) DO UPDATE
  SET structure_id   = EXCLUDED.structure_id,
      publish_status = 'published',
      published_at   = COALESCE(public.tt_class_structure.published_at, now());

  -- ---------------------------------------------------------------
  -- 3) Build a teacher busy-table (teacher, day, period_slot_id) so
  --    we don't double-book anyone within this seed pass. Pre-seed
  --    with any pre-existing tt_slots so the run is safe to re-apply.
  -- ---------------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.tt_busy;
  CREATE TEMP TABLE pg_temp.tt_busy (
    teacher_id     UUID NOT NULL,
    day            TEXT NOT NULL,
    period_slot_id UUID NOT NULL,
    PRIMARY KEY (teacher_id, day, period_slot_id)
  );
  INSERT INTO pg_temp.tt_busy (teacher_id, day, period_slot_id)
  SELECT s.teacher_id, s.day, s.period_slot_id
  FROM public.tt_slots s
  WHERE s.institution_id = v_inst
    AND s.academic_year  = v_year
    AND s.teacher_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------
  -- 4) Per-class round-robin slot generation.
  -- ---------------------------------------------------------------
  FOR v_cls IN
    SELECT c.id, c.name, c.section
    FROM public.classes c
    WHERE c.institution_id = v_inst
      AND c.academic_year  = v_year
      AND c.is_active      = true
    ORDER BY c.name, c.section
  LOOP
    -- Materialize the (subject_id, teacher_id) pairs available for this
    -- class. ORDER BY subject name → predictable rotation so the same
    -- subject doesn't get all early periods.
    DROP TABLE IF EXISTS pg_temp.tt_pairs;
    CREATE TEMP TABLE pg_temp.tt_pairs (
      ord         INTEGER PRIMARY KEY,
      subject_id  UUID NOT NULL,
      teacher_id  UUID NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO pg_temp.tt_pairs (ord, subject_id, teacher_id)
    SELECT
      ROW_NUMBER() OVER (ORDER BY us.name) AS ord,
      ca.subject_id,
      ca.user_id
    FROM public.class_assignments ca
    JOIN public.universal_subjects us ON us.id = ca.subject_id
    WHERE ca.class_id = v_cls.id
      AND ca.role     = 'teacher'
      AND ca.subject_id IS NOT NULL;

    SELECT COUNT(*) INTO v_pair_count FROM pg_temp.tt_pairs;

    IF v_pair_count = 0 THEN
      -- No teachers wired up for this class — skip.
      v_classes_done := v_classes_done + 1;
      CONTINUE;
    END IF;

    v_pair_index := 0;

    FOREACH v_day IN ARRAY WORKING_DAYS LOOP
      FOR i IN 1..array_length(v_teaching_period_ids, 1) LOOP
        v_assigned := false;

        -- Try every pair starting at the rotation cursor; first one whose
        -- teacher is free at (day, period_slot) wins.
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
            EXIT; -- inner offset loop
          END IF;
        END LOOP;

        -- All teachers double-booked at this cell → leave a 'free' marker
        -- (no teacher / no subject) so the grid renders something instead
        -- of an empty cell.
        IF NOT v_assigned THEN
          INSERT INTO public.tt_slots
            (institution_id, class_id, period_slot_id, day, academic_year,
             slot_type, subject_id, teacher_id)
          VALUES
            (v_inst, v_cls.id, v_teaching_period_ids[i], v_day, v_year,
             'free', NULL, NULL)
          ON CONFLICT (class_id, period_slot_id, day, academic_year) DO NOTHING;
          v_skipped := v_skipped + 1;
        END IF;

        v_pair_index := v_pair_index + 1;
      END LOOP;
    END LOOP;

    v_classes_done := v_classes_done + 1;
  END LOOP;

  RAISE NOTICE 'Timetable seed: % classes processed, % teaching slots filled, % free slots',
    v_classes_done, v_inserted, v_skipped;
END;
$seed$;
