-- Public payment context must respect the scheduled enrollment deadline.
-- Before this, oly_get_public_school_payment_context gated only on
-- status = 'enrollment_open'. In the window between enrollment_closes_at passing
-- and the daily ~4 AM IST cron (oly_advance_scheduled_closures) flipping status,
-- the school is still enrollment_open, so the public page rendered the form and
-- the parent was only blocked (409) at payment time. We add the closes_at
-- dimension to the same WHERE clause (mirroring oly_enrollment_is_open) so the
-- function returns its existing { found: false } shape for an expired school and
-- the public page shows "Enrollment unavailable" automatically — no page change.
--
-- create or replace only — idempotent. Signature, return columns, GRANTs and all
-- other logic preserved exactly from 20260526050916_oly_phase_2_enrollment.sql.

create or replace function public.oly_get_public_school_payment_context(p_school_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_school_id uuid;
  v_school_short_code text;
  v_is_existing boolean;
  v_school_name text;
  v_price_override integer;
  v_grade_level_ids uuid[];
  v_campaign_default_price integer;
  v_campaign_gst numeric;
  v_classes jsonb;
  v_subjects_per_class jsonb;
begin
  select sc.id, sc.school_short_code, sc.is_existing_salci_school, i.name,
         sc.price_override_paise, sc.participating_grade_level_ids,
         c.default_price_paise, c.gst_percent
    into v_school_id, v_school_short_code, v_is_existing, v_school_name,
         v_price_override, v_grade_level_ids,
         v_campaign_default_price, v_campaign_gst
    from public.oly_schools sc
    join public.oly_campaigns c on c.id = sc.campaign_id
    join public.institutions i on i.id = sc.institution_id
   where sc.school_short_code = upper(p_school_code)
     and sc.status = 'enrollment_open'
     and (sc.enrollment_closes_at is null or now() < sc.enrollment_closes_at)
     and c.status = 'active';

  if v_school_id is null then
    return jsonb_build_object('found', false);
  end if;

  select jsonb_agg(
    jsonb_build_object('id', g.id, 'name', g.grade_name, 'number', g.grade_number)
    order by g.display_order
  )
    from public.grade_levels g
   where g.id = any(v_grade_level_ids)
   into v_classes;

  select jsonb_object_agg(g.id::text,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
        from public.oly_subjects s
        join public.oly_subject_classes osc on osc.subject_id = s.id
       where osc.grade_level_id = g.id and s.status = 'active'
    ), '[]'::jsonb))
    from public.grade_levels g
   where g.id = any(v_grade_level_ids)
   into v_subjects_per_class;

  return jsonb_build_object(
    'found', true,
    'school_name', v_school_name,
    'school_short_code', v_school_short_code,
    'is_existing_salci_school', v_is_existing,
    'price_paise', coalesce(v_price_override, v_campaign_default_price),
    'gst_percent', v_campaign_gst,
    'classes', v_classes,
    'subjects_per_class', v_subjects_per_class
  );
end;
$$;

grant execute on function public.oly_get_public_school_payment_context(text) to anon, authenticated;
