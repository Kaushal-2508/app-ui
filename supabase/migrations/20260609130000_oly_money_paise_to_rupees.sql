-- 20260609130000_oly_money_paise_to_rupees.sql
-- Store all Olympiad money in RUPEES (numeric) instead of paise (integer).
-- Razorpay still requires paise at its API boundary — that ×100 lives only in the
-- edge functions (oly-payment-create-order, oly-refund-issue) and razorpayAdapter,
-- never in the database or the portal UI.
--
-- Applied to prod 2026-06-09 via the Management API; this file mirrors that change
-- for fresh environments. Column renames are guarded so re-running is a no-op.

do $$
declare
  r record;
  cols text[][] := array[
    array['oly_campaigns','default_price_paise','default_price_rupees'],
    array['oly_schools','price_override_paise','price_override_rupees'],
    array['oly_enrollment_pending','amount_paise','amount_rupees'],
    array['oly_enrollment_pending','gst_paise','gst_rupees'],
    array['oly_enrollment_pending','total_paise','total_rupees'],
    array['oly_receipts','amount_paise','amount_rupees'],
    array['oly_receipts','gst_paise','gst_rupees'],
    array['oly_receipts','total_paise','total_rupees'],
    array['oly_refunds','amount_paise','amount_rupees']
  ];
begin
  foreach r slice 1 in array cols loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r[1] and column_name = r[2]
    ) then
      execute format(
        'alter table public.%I alter column %I type numeric(12,2) using (%I::numeric / 100)',
        r[1], r[2], r[2]
      );
      execute format('alter table public.%I rename column %I to %I', r[1], r[2], r[3]);
    end if;
  end loop;
end $$;

-- RPCs now read/return rupees (CREATE OR REPLACE is idempotent).
create or replace function public.oly_get_public_school_payment_context(p_school_code text)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_school_id uuid; v_school_short_code text; v_is_existing boolean; v_school_name text;
  v_price_override numeric; v_grade_level_ids uuid[]; v_campaign_default_price numeric;
  v_campaign_gst numeric; v_classes jsonb; v_subjects_per_class jsonb;
begin
  select sc.id, sc.school_short_code, sc.is_existing_salci_school, i.name,
         sc.price_override_rupees, sc.participating_grade_level_ids,
         c.default_price_rupees, c.gst_percent
    into v_school_id, v_school_short_code, v_is_existing, v_school_name,
         v_price_override, v_grade_level_ids, v_campaign_default_price, v_campaign_gst
    from public.oly_schools sc
    join public.oly_campaigns c on c.id = sc.campaign_id
    join public.institutions i on i.id = sc.institution_id
   where sc.school_short_code = upper(p_school_code) and sc.status = 'enrollment_open'
     and (sc.enrollment_closes_at is null or now() < sc.enrollment_closes_at) and c.status = 'active';
  if v_school_id is null then return jsonb_build_object('found', false); end if;
  select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.grade_name, 'number', g.grade_number) order by g.display_order)
    from public.grade_levels g where g.id = any(v_grade_level_ids) into v_classes;
  select jsonb_object_agg(g.id::text, coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
        from public.oly_subjects s join public.oly_subject_classes osc on osc.subject_id = s.id
       where osc.grade_level_id = g.id and s.status = 'active'), '[]'::jsonb))
    from public.grade_levels g where g.id = any(v_grade_level_ids) into v_subjects_per_class;
  return jsonb_build_object('found', true, 'school_name', v_school_name, 'school_short_code', v_school_short_code,
    'is_existing_salci_school', v_is_existing, 'price_rupees', coalesce(v_price_override, v_campaign_default_price),
    'gst_percent', v_campaign_gst, 'classes', v_classes, 'subjects_per_class', v_subjects_per_class);
end;
$function$;

create or replace function public.oly_school_overview(p_oly_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'derived_stage', public.oly_school_derived_stage(p_oly_school_id),
    'total_students', (select count(*) from public.oly_students s where s.oly_school_id = p_oly_school_id and s.status = 'active'),
    'attempted_count', (select count(*) from public.oly_attempts a join public.oly_students s on s.id = a.oly_student_id where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress'),
    'cash_count', (select count(*) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'teacher_cash'),
    'cash_rupees', coalesce((select sum(ep.total_rupees) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'teacher_cash'), 0),
    'online_count', (select count(*) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'parent_online'),
    'online_rupees', coalesce((select sum(ep.total_rupees) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'parent_online'), 0),
    'results_published', exists (select 1 from public.oly_results r where r.oly_school_id = p_oly_school_id)
  ) into v;
  return v;
end;
$function$;

drop function if exists public.oly_school_payment_list(uuid, text, integer, timestamptz, uuid);
create function public.oly_school_payment_list(p_oly_school_id uuid, p_channel text, p_limit integer default 50, p_cursor timestamptz default null, p_cursor_id uuid default null)
returns table(oly_student_id uuid, full_name text, roll_number text, total_rupees numeric, gst_rupees numeric, gateway_order_id text, gateway_payment_id text, paid_at timestamptz, cursor_id uuid)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, s.full_name, s.roll_number, ep.total_rupees, ep.gst_rupees,
           ep.gateway_order_id, ep.gateway_payment_id, ep.updated_at, ep.id
    from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id
    where ep.oly_school_id = p_oly_school_id and ep.status = 'paid'
      and s.enrollment_channel = (case when p_channel = 'cash' then 'teacher_cash' else 'parent_online' end)
      and (p_cursor is null or (ep.updated_at, ep.id) < (p_cursor, p_cursor_id))
    order by ep.updated_at desc, ep.id desc limit greatest(1, least(p_limit, 200));
end;
$function$;
grant execute on function public.oly_school_payment_list(uuid, text, integer, timestamptz, uuid) to authenticated;
