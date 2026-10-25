
-- =============================================
-- TIMETABLE & LESSON PLANNING MODULE - PHASE 1
-- =============================================

-- 3.1 day_templates
CREATE TABLE public.day_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  academic_year TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(institution_id, academic_year, name)
);

-- 3.2 day_template_slots
CREATE TABLE public.day_template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES day_templates(id) ON DELETE CASCADE NOT NULL,
  slot_order INTEGER NOT NULL,
  slot_type TEXT NOT NULL,
  label TEXT,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL
);

-- 3.3 day_of_week_template_map
CREATE TABLE public.day_of_week_template_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  academic_year TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  template_id UUID REFERENCES day_templates(id) NOT NULL,
  UNIQUE(institution_id, academic_year, day_of_week)
);

-- 3.4 calendar_exceptions
CREATE TABLE public.calendar_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  academic_year TEXT NOT NULL,
  date DATE NOT NULL,
  exception_type TEXT NOT NULL,
  day_template_id UUID REFERENCES day_templates(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3.5 timetable_versions
CREATE TABLE public.timetable_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  wing_id UUID REFERENCES wings(id) NOT NULL,
  academic_year TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  published_by UUID REFERENCES profiles(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3.6 timetable_slots (CREATE fresh — no existing table)
CREATE TABLE public.timetable_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID REFERENCES timetable_versions(id) NOT NULL,
  template_slot_id UUID REFERENCES day_template_slots(id) NOT NULL,
  class_id UUID REFERENCES classes(id) NOT NULL,
  subject_id UUID REFERENCES universal_subjects(id) NOT NULL,
  teacher_id UUID REFERENCES profiles(id),
  room_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3.7 teacher_workload_settings
CREATE TABLE public.teacher_workload_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  teacher_id UUID REFERENCES profiles(id) NOT NULL,
  academic_year TEXT NOT NULL,
  max_periods_per_week INTEGER NOT NULL DEFAULT 30,
  UNIQUE(institution_id, teacher_id, academic_year)
);

-- 3.8 timetable_acknowledgements
CREATE TABLE public.timetable_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES profiles(id) NOT NULL,
  version_id UUID REFERENCES timetable_versions(id) NOT NULL,
  acknowledged_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, version_id)
);

-- 3.9 ALTER school_custom_topics — add missing columns
ALTER TABLE public.school_custom_topics
  ADD COLUMN IF NOT EXISTS topic_name_local TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'teacher_created',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES school_custom_topics(id),
  ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

-- 3.10 lesson_plan_entries
CREATE TABLE public.lesson_plan_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID REFERENCES timetable_slots(id) NOT NULL,
  scheduled_date DATE NOT NULL,
  topic_id UUID REFERENCES school_custom_topics(id),
  topic_name_free TEXT,
  notes TEXT,
  status TEXT DEFAULT 'draft',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, scheduled_date)
);

-- 3.11 topic_pacing_targets
CREATE TABLE public.topic_pacing_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  topic_id UUID REFERENCES school_custom_topics(id) NOT NULL,
  academic_year TEXT NOT NULL,
  grade_level_id UUID REFERENCES grade_levels(id) NOT NULL,
  target_periods INTEGER NOT NULL,
  UNIQUE(institution_id, topic_id, academic_year, grade_level_id)
);

-- 3.12 admin_conflict_flags
CREATE TABLE public.admin_conflict_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) NOT NULL,
  teacher_id UUID REFERENCES profiles(id) NOT NULL,
  wing_a_id UUID REFERENCES wings(id),
  wing_b_id UUID REFERENCES wings(id),
  template_slot_id UUID REFERENCES day_template_slots(id),
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_day_templates_institution ON public.day_templates(institution_id, academic_year);
CREATE INDEX idx_day_template_slots_template ON public.day_template_slots(template_id);
CREATE INDEX idx_day_of_week_map_institution ON public.day_of_week_template_map(institution_id, academic_year);
CREATE INDEX idx_calendar_exceptions_date ON public.calendar_exceptions(institution_id, date);
CREATE INDEX idx_timetable_versions_wing ON public.timetable_versions(wing_id, academic_year);
CREATE INDEX idx_timetable_slots_version ON public.timetable_slots(version_id, is_active);
CREATE INDEX idx_timetable_slots_teacher ON public.timetable_slots(teacher_id, is_active);
CREATE INDEX idx_timetable_slots_template_slot ON public.timetable_slots(template_slot_id, is_active);
CREATE INDEX idx_lesson_plan_entries_slot_date ON public.lesson_plan_entries(slot_id, scheduled_date);
CREATE INDEX idx_lesson_plan_entries_topic ON public.lesson_plan_entries(topic_id);
CREATE INDEX idx_admin_conflict_flags_institution ON public.admin_conflict_flags(institution_id, status);

-- =============================================
-- RLS POLICIES
-- =============================================

-- Enable RLS on all new tables
ALTER TABLE public.day_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day_template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day_of_week_template_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_workload_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_plan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_pacing_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_conflict_flags ENABLE ROW LEVEL SECURITY;

-- day_templates: institution members can read, admins can write
CREATE POLICY "Institution members can view day_templates" ON public.day_templates
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can manage day_templates" ON public.day_templates
  FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()));

-- day_template_slots: read via template's institution, write by admin
CREATE POLICY "Institution members can view day_template_slots" ON public.day_template_slots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.day_templates dt
    WHERE dt.id = template_id
    AND (dt.institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()))
  ));

CREATE POLICY "Admins can manage day_template_slots" ON public.day_template_slots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.day_templates dt
    WHERE dt.id = template_id
    AND (public.is_institution_admin(auth.uid(), dt.institution_id) OR public.is_super_admin(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.day_templates dt
    WHERE dt.id = template_id
    AND (public.is_institution_admin(auth.uid(), dt.institution_id) OR public.is_super_admin(auth.uid()))
  ));

-- day_of_week_template_map
CREATE POLICY "Institution members can view day_of_week_template_map" ON public.day_of_week_template_map
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can manage day_of_week_template_map" ON public.day_of_week_template_map
  FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()));

-- calendar_exceptions
CREATE POLICY "Institution members can view calendar_exceptions" ON public.calendar_exceptions
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can manage calendar_exceptions" ON public.calendar_exceptions
  FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()));

-- timetable_versions
CREATE POLICY "Institution members can view timetable_versions" ON public.timetable_versions
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins and coordinators can manage timetable_versions" ON public.timetable_versions
  FOR ALL TO authenticated
  USING (
    public.is_institution_admin(auth.uid(), institution_id)
    OR public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'coordinator')
  )
  WITH CHECK (
    public.is_institution_admin(auth.uid(), institution_id)
    OR public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'coordinator')
  );

-- timetable_slots
CREATE POLICY "Institution members can view timetable_slots" ON public.timetable_slots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.timetable_versions tv
    WHERE tv.id = version_id
    AND (tv.institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()))
  ));

CREATE POLICY "Coordinators and admins can manage timetable_slots" ON public.timetable_slots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.timetable_versions tv
    WHERE tv.id = version_id
    AND (
      public.is_institution_admin(auth.uid(), tv.institution_id)
      OR public.is_super_admin(auth.uid())
      OR public.has_role(auth.uid(), 'coordinator')
    )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.timetable_versions tv
    WHERE tv.id = version_id
    AND (
      public.is_institution_admin(auth.uid(), tv.institution_id)
      OR public.is_super_admin(auth.uid())
      OR public.has_role(auth.uid(), 'coordinator')
    )
  ));

-- teacher_workload_settings
CREATE POLICY "Institution members can view teacher_workload_settings" ON public.teacher_workload_settings
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can manage teacher_workload_settings" ON public.teacher_workload_settings
  FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()));

-- timetable_acknowledgements
CREATE POLICY "Teachers can view own acknowledgements" ON public.timetable_acknowledgements
  FOR SELECT TO authenticated
  USING (teacher_id = auth.uid() OR public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'school_admin') OR public.has_role(auth.uid(), 'coordinator'));

CREATE POLICY "Teachers can insert own acknowledgements" ON public.timetable_acknowledgements
  FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid());

-- lesson_plan_entries
CREATE POLICY "Teachers can view own lesson plans" ON public.lesson_plan_entries
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'school_admin')
    OR public.has_role(auth.uid(), 'coordinator')
  );

CREATE POLICY "Teachers can manage own lesson plans" ON public.lesson_plan_entries
  FOR ALL TO authenticated
  USING (created_by = auth.uid() OR public.is_super_admin(auth.uid()))
  WITH CHECK (created_by = auth.uid() OR public.is_super_admin(auth.uid()));

-- topic_pacing_targets
CREATE POLICY "Institution members can view topic_pacing_targets" ON public.topic_pacing_targets
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins and coordinators can manage topic_pacing_targets" ON public.topic_pacing_targets
  FOR ALL TO authenticated
  USING (
    public.is_institution_admin(auth.uid(), institution_id)
    OR public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'coordinator')
  )
  WITH CHECK (
    public.is_institution_admin(auth.uid(), institution_id)
    OR public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'coordinator')
  );

-- admin_conflict_flags
CREATE POLICY "Admins can view conflict flags" ON public.admin_conflict_flags
  FOR SELECT TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "System can manage conflict flags" ON public.admin_conflict_flags
  FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id) OR public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'coordinator'));

-- =============================================
-- RPC: get_session_state
-- =============================================
CREATE OR REPLACE FUNCTION public.get_session_state(p_user_id UUID, p_institution_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role app_role;
  v_academic_year TEXT;
  v_wing_id UUID;
  v_version_id UUID;
  v_version_status TEXT;
  v_template_count INTEGER;
  v_mapped_days INTEGER;
  v_pending_plans INTEGER;
  v_total_slots INTEGER;
BEGIN
  -- Determine current academic year (Apr-Mar cycle for Indian schools)
  IF EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
    v_academic_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT || '-' || (EXTRACT(YEAR FROM CURRENT_DATE) + 1)::TEXT;
  ELSE
    v_academic_year := (EXTRACT(YEAR FROM CURRENT_DATE) - 1)::TEXT || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  END IF;

  -- Get user's primary role
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;

  -- Get user's wing (for coordinator/teacher)
  SELECT wa.wing_id INTO v_wing_id
  FROM public.wing_assignments wa WHERE wa.user_id = p_user_id LIMIT 1;

  -- ADMIN STATES
  IF v_role IN ('school_admin', 'super_school_admin') THEN
    SELECT COUNT(*) INTO v_template_count
    FROM public.day_templates WHERE institution_id = p_institution_id AND academic_year = v_academic_year;

    IF v_template_count = 0 THEN
      RETURN 'calendar_pending';
    END IF;

    SELECT COUNT(*) INTO v_mapped_days
    FROM public.day_of_week_template_map
    WHERE institution_id = p_institution_id AND academic_year = v_academic_year
    AND day_of_week BETWEEN 1 AND 5;

    IF v_mapped_days < 5 THEN
      RETURN 'day_structure_pending';
    END IF;

    RETURN 'setup_complete';
  END IF;

  -- COORDINATOR STATES
  IF v_role = 'coordinator' THEN
    -- Check admin setup
    SELECT COUNT(*) INTO v_mapped_days
    FROM public.day_of_week_template_map
    WHERE institution_id = p_institution_id AND academic_year = v_academic_year
    AND day_of_week BETWEEN 1 AND 5;

    IF v_mapped_days < 5 THEN
      RETURN 'awaiting_setup';
    END IF;

    -- Check version status
    SELECT id, status INTO v_version_id, v_version_status
    FROM public.timetable_versions
    WHERE institution_id = p_institution_id AND wing_id = v_wing_id AND academic_year = v_academic_year
    AND status IN ('draft', 'published')
    ORDER BY CASE status WHEN 'published' THEN 1 WHEN 'draft' THEN 2 END
    LIMIT 1;

    IF v_version_id IS NULL THEN
      RETURN 'planning_open';
    END IF;

    IF v_version_status = 'published' THEN
      RETURN 'timetable_published';
    END IF;

    RETURN 'planning_open';
  END IF;

  -- TEACHER STATES
  IF v_role = 'teacher' THEN
    -- Check for published version in teacher's wing
    SELECT id INTO v_version_id
    FROM public.timetable_versions
    WHERE institution_id = p_institution_id AND wing_id = v_wing_id AND academic_year = v_academic_year
    AND status = 'published'
    LIMIT 1;

    IF v_version_id IS NULL THEN
      RETURN 'awaiting_timetable';
    END IF;

    -- Check acknowledgement
    IF NOT EXISTS (
      SELECT 1 FROM public.timetable_acknowledgements
      WHERE teacher_id = p_user_id AND version_id = v_version_id
    ) THEN
      RETURN 'timetable_pending_ack';
    END IF;

    -- Check lesson plan completeness (next 14 days)
    SELECT COUNT(*) INTO v_total_slots
    FROM public.timetable_slots ts
    JOIN public.day_template_slots dts ON dts.id = ts.template_slot_id
    WHERE ts.version_id = v_version_id AND ts.teacher_id = p_user_id AND ts.is_active = true
    AND dts.slot_type = 'class';

    SELECT COUNT(*) INTO v_pending_plans
    FROM public.timetable_slots ts
    JOIN public.day_template_slots dts ON dts.id = ts.template_slot_id
    WHERE ts.version_id = v_version_id AND ts.teacher_id = p_user_id AND ts.is_active = true
    AND dts.slot_type = 'class'
    AND NOT EXISTS (
      SELECT 1 FROM public.lesson_plan_entries lpe
      WHERE lpe.slot_id = ts.id
      AND lpe.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
    );

    IF v_pending_plans > 0 THEN
      RETURN 'lesson_plans_incomplete';
    END IF;

    RETURN 'all_current';
  END IF;

  RETURN 'unknown';
END;
$$;

-- =============================================
-- RPC: replace_timetable_slot
-- =============================================
CREATE OR REPLACE FUNCTION public.replace_timetable_slot(
  p_old_slot_id UUID,
  p_new_data JSONB,
  p_published_edit BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_slot RECORD;
  v_new_slot_id UUID;
  v_new_version_id UUID;
  v_version_id UUID;
  v_teacher_id UUID;
  v_template_slot_id UUID;
  v_class_id UUID;
  v_subject_id UUID;
  v_room_id TEXT;
  v_institution_id UUID;
  v_conflict_count INTEGER;
BEGIN
  v_teacher_id := (p_new_data->>'teacher_id')::UUID;
  v_template_slot_id := (p_new_data->>'template_slot_id')::UUID;
  v_class_id := (p_new_data->>'class_id')::UUID;
  v_subject_id := (p_new_data->>'subject_id')::UUID;
  v_room_id := p_new_data->>'room_id';

  -- If creating new slot (no old slot to replace)
  IF p_old_slot_id IS NULL THEN
    v_version_id := (p_new_data->>'version_id')::UUID;

    SELECT institution_id INTO v_institution_id FROM timetable_versions WHERE id = v_version_id;

    -- Same-wing teacher overlap check
    IF v_teacher_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM timetable_slots
      WHERE version_id = v_version_id AND template_slot_id = v_template_slot_id
      AND teacher_id = v_teacher_id AND is_active = true;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'teacher_overlap';
      END IF;

      -- Cross-wing teacher overlap check
      SELECT COUNT(*) INTO v_conflict_count
      FROM timetable_slots ts
      JOIN timetable_versions tv ON tv.id = ts.version_id
      WHERE ts.template_slot_id = v_template_slot_id
      AND ts.teacher_id = v_teacher_id AND ts.is_active = true
      AND tv.institution_id = v_institution_id
      AND tv.id != v_version_id AND tv.status = 'published';

      IF v_conflict_count > 0 THEN
        INSERT INTO admin_conflict_flags (institution_id, teacher_id, wing_a_id, wing_b_id, template_slot_id)
        SELECT v_institution_id, v_teacher_id,
          (SELECT wing_id FROM timetable_versions WHERE id = v_version_id),
          tv.wing_id, v_template_slot_id
        FROM timetable_slots ts
        JOIN timetable_versions tv ON tv.id = ts.version_id
        WHERE ts.template_slot_id = v_template_slot_id
        AND ts.teacher_id = v_teacher_id AND ts.is_active = true
        AND tv.institution_id = v_institution_id
        AND tv.id != v_version_id AND tv.status = 'published'
        LIMIT 1;

        RAISE EXCEPTION 'cross_wing_teacher_conflict';
      END IF;
    END IF;

    -- Room overlap check
    IF v_room_id IS NOT NULL AND v_room_id != '' THEN
      SELECT COUNT(*) INTO v_conflict_count
      FROM timetable_slots
      WHERE version_id = v_version_id AND template_slot_id = v_template_slot_id
      AND room_id = v_room_id AND is_active = true;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'room_overlap';
      END IF;
    END IF;

    INSERT INTO timetable_slots (version_id, template_slot_id, class_id, subject_id, teacher_id, room_id, is_active)
    VALUES (v_version_id, v_template_slot_id, v_class_id, v_subject_id, v_teacher_id, v_room_id, true)
    RETURNING id INTO v_new_slot_id;

    RETURN v_new_slot_id;
  END IF;

  -- Lock old slot
  SELECT * INTO v_old_slot FROM timetable_slots WHERE id = p_old_slot_id FOR UPDATE;

  IF v_old_slot IS NULL THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;

  v_version_id := v_old_slot.version_id;
  SELECT institution_id INTO v_institution_id FROM timetable_versions WHERE id = v_version_id;

  -- POST-PUBLISH AMENDMENT
  IF p_published_edit THEN
    -- Create new version
    INSERT INTO timetable_versions (institution_id, wing_id, academic_year, status, published_by, published_at)
    SELECT institution_id, wing_id, academic_year, 'published', auth.uid(), now()
    FROM timetable_versions WHERE id = v_version_id
    RETURNING id INTO v_new_version_id;

    -- Copy all active slots to new version
    INSERT INTO timetable_slots (version_id, template_slot_id, class_id, subject_id, teacher_id, room_id, is_active)
    SELECT v_new_version_id, template_slot_id, class_id, subject_id, teacher_id, room_id, true
    FROM timetable_slots
    WHERE version_id = v_version_id AND is_active = true AND id != p_old_slot_id;

    -- Archive old version
    UPDATE timetable_versions SET status = 'archived' WHERE id = v_version_id;

    v_version_id := v_new_version_id;
  ELSE
    -- Deactivate old slot
    UPDATE timetable_slots SET is_active = false WHERE id = p_old_slot_id;
  END IF;

  -- Overlap checks for new slot
  IF v_teacher_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM timetable_slots
    WHERE version_id = v_version_id AND template_slot_id = COALESCE(v_template_slot_id, v_old_slot.template_slot_id)
    AND teacher_id = v_teacher_id AND is_active = true;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'teacher_overlap';
    END IF;

    SELECT COUNT(*) INTO v_conflict_count
    FROM timetable_slots ts
    JOIN timetable_versions tv ON tv.id = ts.version_id
    WHERE ts.template_slot_id = COALESCE(v_template_slot_id, v_old_slot.template_slot_id)
    AND ts.teacher_id = v_teacher_id AND ts.is_active = true
    AND tv.institution_id = v_institution_id
    AND tv.id != v_version_id AND tv.status = 'published';

    IF v_conflict_count > 0 THEN
      INSERT INTO admin_conflict_flags (institution_id, teacher_id, wing_a_id, wing_b_id, template_slot_id)
      SELECT v_institution_id, v_teacher_id,
        (SELECT wing_id FROM timetable_versions WHERE id = v_version_id),
        tv.wing_id, COALESCE(v_template_slot_id, v_old_slot.template_slot_id)
      FROM timetable_slots ts
      JOIN timetable_versions tv ON tv.id = ts.version_id
      WHERE ts.template_slot_id = COALESCE(v_template_slot_id, v_old_slot.template_slot_id)
      AND ts.teacher_id = v_teacher_id AND ts.is_active = true
      AND tv.institution_id = v_institution_id
      AND tv.id != v_version_id AND tv.status = 'published'
      LIMIT 1;

      RAISE EXCEPTION 'cross_wing_teacher_conflict';
    END IF;
  END IF;

  IF v_room_id IS NOT NULL AND v_room_id != '' THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM timetable_slots
    WHERE version_id = v_version_id AND template_slot_id = COALESCE(v_template_slot_id, v_old_slot.template_slot_id)
    AND room_id = v_room_id AND is_active = true;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'room_overlap';
    END IF;
  END IF;

  -- Insert new slot
  INSERT INTO timetable_slots (version_id, template_slot_id, class_id, subject_id, teacher_id, room_id, is_active)
  VALUES (
    v_version_id,
    COALESCE(v_template_slot_id, v_old_slot.template_slot_id),
    COALESCE(v_class_id, v_old_slot.class_id),
    COALESCE(v_subject_id, v_old_slot.subject_id),
    v_teacher_id,
    v_room_id,
    true
  )
  RETURNING id INTO v_new_slot_id;

  -- Flag lesson plans needing review
  UPDATE lesson_plan_entries SET status = 'needs_review'
  WHERE slot_id = p_old_slot_id AND status NOT IN ('missed');

  RETURN v_new_slot_id;
END;
$$;

-- =============================================
-- RPC: get_pacing_summary
-- =============================================
CREATE OR REPLACE FUNCTION public.get_pacing_summary(
  p_institution_id UUID,
  p_class_id UUID,
  p_academic_year TEXT
)
RETURNS TABLE(
  topic_id UUID,
  topic_name TEXT,
  topic_name_local TEXT,
  periods_taught BIGINT,
  periods_missed BIGINT,
  target_periods INTEGER,
  pacing_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sct.id AS topic_id,
    sct.topic_name,
    sct.topic_name_local,
    COUNT(CASE WHEN lpe.status IN ('confirmed', 'draft') THEN 1 END) AS periods_taught,
    COUNT(CASE WHEN lpe.status = 'missed' THEN 1 END) AS periods_missed,
    tpt.target_periods,
    CASE
      WHEN tpt.target_periods IS NULL THEN 'no_target'
      WHEN COUNT(CASE WHEN lpe.status IN ('confirmed', 'draft') THEN 1 END) >= tpt.target_periods THEN 'ahead'
      WHEN COUNT(CASE WHEN lpe.status IN ('confirmed', 'draft') THEN 1 END)::FLOAT / GREATEST(tpt.target_periods, 1) >= 0.8 THEN 'on_track'
      ELSE 'behind'
    END AS pacing_status
  FROM public.lesson_plan_entries lpe
  JOIN public.timetable_slots ts ON ts.id = lpe.slot_id
  JOIN public.school_custom_topics sct ON sct.id = lpe.topic_id
  LEFT JOIN public.topic_pacing_targets tpt ON tpt.topic_id = sct.id
    AND tpt.institution_id = p_institution_id
    AND tpt.academic_year = p_academic_year
  WHERE ts.class_id = p_class_id AND ts.is_active = true
  AND lpe.topic_id IS NOT NULL
  GROUP BY sct.id, sct.topic_name, sct.topic_name_local, tpt.target_periods;
END;
$$;

-- =============================================
-- RPC: rollover_session
-- =============================================
CREATE OR REPLACE FUNCTION public.rollover_session(
  p_from_year TEXT,
  p_to_year TEXT,
  p_institution_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_template RECORD;
  v_new_template_id UUID;
  v_old_slot RECORD;
  v_wing RECORD;
  v_new_version_id UUID;
BEGIN
  -- Copy day_templates
  FOR v_old_template IN
    SELECT * FROM day_templates WHERE institution_id = p_institution_id AND academic_year = p_from_year
  LOOP
    INSERT INTO day_templates (institution_id, academic_year, name, is_default, created_by)
    VALUES (p_institution_id, p_to_year, v_old_template.name, v_old_template.is_default, auth.uid())
    RETURNING id INTO v_new_template_id;

    -- Copy day_template_slots
    INSERT INTO day_template_slots (template_id, slot_order, slot_type, label, start_time, end_time)
    SELECT v_new_template_id, slot_order, slot_type, label, start_time, end_time
    FROM day_template_slots WHERE template_id = v_old_template.id;

    -- Copy day_of_week_template_map
    INSERT INTO day_of_week_template_map (institution_id, academic_year, day_of_week, template_id)
    SELECT p_institution_id, p_to_year, day_of_week, v_new_template_id
    FROM day_of_week_template_map
    WHERE institution_id = p_institution_id AND academic_year = p_from_year AND template_id = v_old_template.id;
  END LOOP;

  -- Create draft versions per wing and copy slot skeletons
  FOR v_wing IN
    SELECT DISTINCT wing_id FROM timetable_versions
    WHERE institution_id = p_institution_id AND academic_year = p_from_year
  LOOP
    INSERT INTO timetable_versions (institution_id, wing_id, academic_year, status)
    VALUES (p_institution_id, v_wing.wing_id, p_to_year, 'draft')
    RETURNING id INTO v_new_version_id;

    -- Copy slots without teacher_id
    INSERT INTO timetable_slots (version_id, template_slot_id, class_id, subject_id, teacher_id, room_id, is_active)
    SELECT v_new_version_id, ts.template_slot_id, ts.class_id, ts.subject_id, NULL, ts.room_id, true
    FROM timetable_slots ts
    JOIN timetable_versions tv ON tv.id = ts.version_id
    WHERE tv.institution_id = p_institution_id AND tv.academic_year = p_from_year
    AND tv.wing_id = v_wing.wing_id AND ts.is_active = true;
  END LOOP;

  -- Copy teacher_workload_settings defaults
  INSERT INTO teacher_workload_settings (institution_id, teacher_id, academic_year, max_periods_per_week)
  SELECT institution_id, teacher_id, p_to_year, max_periods_per_week
  FROM teacher_workload_settings
  WHERE institution_id = p_institution_id AND academic_year = p_from_year
  ON CONFLICT (institution_id, teacher_id, academic_year) DO NOTHING;
END;
$$;
