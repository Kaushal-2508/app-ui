-- Olympiad lab capacity could not be saved by school admins.
--
-- School admins (including onboarded / non-SALCI school admins) set their lab
-- capacity (oly_schools.pc_count + lab_pc_counts) from the Labs & PCs page and
-- the Batch Builder. But oly_schools has NO school_admin UPDATE policy — only
-- `super_admin all` (ALL) plus SELECT policies. The frontend's direct table
-- UPDATE was therefore silently blocked by RLS: 0 rows changed, no error, the
-- "Lab setup saved" toast still fired, pc_count stayed NULL, and the Batch
-- Builder fell back to its `?? 20` seating default.
--
-- A blanket school_admin UPDATE policy on oly_schools is unsafe — it would let
-- them change status / is_existing_salci_school / campaign_id on their own row.
-- Instead, this SECURITY DEFINER RPC scopes the write to exactly the two
-- capacity columns, with its own admin check. The frontend calls this RPC
-- instead of updating the table directly.

create or replace function public.oly_set_lab_capacity(
  p_oly_school_id uuid,
  p_lab_pc_counts integer[]
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
begin
  if not (
    public.is_super_admin(auth.uid())
    or public.oly_is_school_admin_for(auth.uid(), p_oly_school_id)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_lab_pc_counts is null or array_length(p_lab_pc_counts, 1) is null then
    raise exception 'At least one lab is required' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_lab_pc_counts) c where c is null or c <= 0) then
    raise exception 'Each lab must have at least 1 PC' using errcode = '22023';
  end if;

  select sum(c)::integer into v_total from unnest(p_lab_pc_counts) c;

  update public.oly_schools
     set lab_pc_counts = to_jsonb(p_lab_pc_counts),
         pc_count = v_total
   where id = p_oly_school_id;

  return v_total;
end;
$$;

grant execute on function public.oly_set_lab_capacity(uuid, integer[]) to authenticated;
