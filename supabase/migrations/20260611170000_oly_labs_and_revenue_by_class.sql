-- Resource Planning (Labs & PCs) + Revenue tab class-wise distribution.
--
-- 1. oly_schools.lab_pc_counts — per-lab PC breakdown entered on the school
--    Labs & PCs page (jsonb array of integers, one entry per lab, e.g. [20,15]).
--    oly_schools.pc_count stays the authoritative TOTAL capacity used by the
--    Batch Builder; the frontend writes both atomically (pc_count = sum).
alter table public.oly_schools
  add column if not exists lab_pc_counts jsonb;

comment on column public.oly_schools.lab_pc_counts is
  'Per-lab PC counts (jsonb int array). pc_count = sum(lab_pc_counts); pc_count remains the batch-capacity source of truth.';

-- 2. Class-wise revenue distribution for the school-admin Revenue tab.
--    Server-side aggregate (CLAUDE.md §23) — never pull raw paid rows to the
--    client; PostgREST silently caps at 1000 rows. Channel filter matches the
--    authoritative oly_students.enrollment_channel, same as the dashboard KPIs.
create or replace function public.oly_school_revenue_by_class(
  p_oly_school_id uuid, p_channel text default 'all'
) returns table (
  grade_level_id uuid, grade_name text, students bigint, revenue_rupees numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.oly_is_school_admin_for(auth.uid(), p_oly_school_id)
          or public.is_super_admin(auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.grade_level_id,
           gl.grade_name::text,
           count(distinct s.id)::bigint,
           coalesce(sum(ep.total_rupees), 0)::numeric
      from public.oly_enrollment_pending ep
      join public.oly_students s on s.id = ep.promoted_student_id
      join public.grade_levels gl on gl.id = s.grade_level_id
     where ep.oly_school_id = p_oly_school_id
       and ep.status = 'paid'
       and (p_channel = 'all'
            or s.enrollment_channel = (case when p_channel = 'cash' then 'teacher_cash' else 'parent_online' end))
     group by s.grade_level_id, gl.grade_name, gl.display_order
     order by gl.display_order;
end;
$$;

grant execute on function public.oly_school_revenue_by_class(uuid, text) to authenticated;
