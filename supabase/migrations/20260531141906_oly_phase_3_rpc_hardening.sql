-- Phase 3 hardening — post-review fixes.
-- Fix 1: REVOKE the cross-school stage helper from authenticated/public. It is
--        SECURITY DEFINER reading other schools' exam state with no internal
--        is_super_admin guard, so any authenticated user could probe arbitrary
--        school UUIDs. The 4 calling RPCs are themselves SECURITY DEFINER and
--        execute as the function OWNER, so they keep working after the revoke.
-- Fix 2: composite keyset cursors (updated_at/created_at + id tiebreaker) so
--        rows sharing a timestamp can't be skipped or duplicated across pages.
-- Fix 4: oly_schools_by_stage materializes oly_school_derived_stage once per row
--        in a CTE (was called twice — WHERE + SELECT).

-- Fix 1 ---------------------------------------------------------------------
revoke execute on function public.oly_school_derived_stage(uuid) from authenticated, public;

-- Fix 2 — payment list: composite keyset (updated_at, id) -------------------
drop function if exists public.oly_school_payment_list(uuid, text, int, timestamptz);

create or replace function public.oly_school_payment_list(
  p_oly_school_id uuid, p_channel text, p_limit int default 50,
  p_cursor timestamptz default null, p_cursor_id uuid default null
) returns table (
  oly_student_id uuid, full_name text, roll_number text,
  total_paise integer, gst_paise integer,
  gateway_order_id text, gateway_payment_id text, paid_at timestamptz,
  cursor_id uuid
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, s.full_name, s.roll_number,
           ep.total_paise, ep.gst_paise,
           ep.gateway_order_id, ep.gateway_payment_id, ep.updated_at,
           ep.id
    from public.oly_enrollment_pending ep
    join public.oly_students s on s.id = ep.promoted_student_id
    where ep.oly_school_id = p_oly_school_id
      and ep.status = 'paid'
      and s.enrollment_channel = (case when p_channel = 'cash' then 'teacher_cash' else 'parent_online' end)
      and (p_cursor is null or (ep.updated_at, ep.id) < (p_cursor, p_cursor_id))
    order by ep.updated_at desc, ep.id desc
    limit greatest(1, least(p_limit, 200));
end;
$$;
grant execute on function public.oly_school_payment_list(uuid, text, int, timestamptz, uuid) to authenticated;

-- Fix 2 + Fix 4 — schools by stage: composite keyset (created_at, id) + ------
-- materialize derived_stage once per row in a CTE.
drop function if exists public.oly_schools_by_stage(uuid, text, text, int, timestamptz);

create or replace function public.oly_schools_by_stage(
  p_campaign_id uuid, p_bucket text, p_school_type text default 'all',
  p_limit int default 50, p_cursor timestamptz default null, p_cursor_id uuid default null
) returns table (
  id uuid, institution_name text, school_short_code text,
  city text, state text, status text, is_existing boolean,
  enrolled_count bigint, derived_stage text, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    with base as (
      select sc.id, i.name as institution_name, sc.school_short_code, sc.city, sc.state, sc.status,
             sc.is_existing_salci_school as is_existing,
             (select count(*) from public.oly_students s where s.oly_school_id = sc.id and s.status = 'active') as enrolled_count,
             public.oly_school_derived_stage(sc.id) as derived_stage,
             sc.created_at
      from public.oly_schools sc
      join public.institutions i on i.id = sc.institution_id
      where sc.campaign_id = p_campaign_id
        and (p_school_type = 'all'
             or (p_school_type = 'new' and sc.is_existing_salci_school = false)
             or (p_school_type = 'existing' and sc.is_existing_salci_school = true))
    )
    select b.id, b.institution_name, b.school_short_code, b.city, b.state, b.status,
           b.is_existing, b.enrolled_count, b.derived_stage, b.created_at
    from base b
    where (
        (p_bucket = 'done' and b.derived_stage = 'exam_completed')
        or (p_bucket = 'in_progress' and b.derived_stage <> 'exam_completed')
      )
      and (p_cursor is null or (b.created_at, b.id) < (p_cursor, p_cursor_id))
    order by b.created_at desc, b.id desc
    limit greatest(1, least(p_limit, 200));
end;
$$;
grant execute on function public.oly_schools_by_stage(uuid, text, text, int, timestamptz, uuid) to authenticated;
