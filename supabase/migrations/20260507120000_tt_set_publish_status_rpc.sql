-- =============================================================
-- tt_set_publish_status — coordinator-friendly publish toggle
--
-- The `tt_class_structure_admin_write` RLS policy lets only admins
-- write to `tt_class_structure`, which means coordinators can't
-- flip `publish_status` even though they ARE allowed to edit the
-- cells of their wing. This RPC is a narrow, SECURITY DEFINER
-- escape hatch: admins or coordinators-for-class can call it to
-- change `publish_status` (and the published_at / published_by
-- audit columns) but nothing else. Structure assignment and
-- delete still go through the existing admin-only RLS path.
-- =============================================================

CREATE OR REPLACE FUNCTION public.tt_set_publish_status(
  p_class_id      UUID,
  p_academic_year TEXT,
  p_status        TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_class_inst  UUID;
BEGIN
  IF p_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Invalid publish_status: %', p_status
      USING ERRCODE = '22023';
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT c.institution_id INTO v_class_inst
  FROM public.classes c
  WHERE c.id = p_class_id;
  IF v_class_inst IS NULL THEN
    RAISE EXCEPTION 'Class not found' USING ERRCODE = 'P0002';
  END IF;

  -- Admin (any flavour) OR a coordinator whose wing covers this class.
  -- The slot-edit helper already encapsulates the wing membership join
  -- so we don't have to re-derive it here.
  IF NOT (
    public.has_role(v_user, 'school_admin')
    OR public.has_role(v_user, 'super_school_admin')
    OR public.has_role(v_user, 'super_admin')
    OR public.tt_user_can_edit_class_slots(v_user, p_class_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to change publish status'
      USING ERRCODE = '42501';
  END IF;

  IF p_status = 'published' THEN
    UPDATE public.tt_class_structure
    SET publish_status = 'published',
        published_at   = now(),
        published_by   = v_user,
        updated_at     = now()
    WHERE class_id      = p_class_id
      AND academic_year = p_academic_year;
  ELSE
    UPDATE public.tt_class_structure
    SET publish_status = 'draft',
        published_at   = NULL,
        published_by   = NULL,
        updated_at     = now()
    WHERE class_id      = p_class_id
      AND academic_year = p_academic_year;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No structure assignment found for class % / year %', p_class_id, p_academic_year
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tt_set_publish_status(UUID, TEXT, TEXT) TO authenticated;
