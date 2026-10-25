-- Phase 2 — Olympiad school onboarding + parent enrollment + payment
-- Adds oly_students, oly_enrollment_pending, oly_receipts, oly_refunds tables,
-- olympiad-receipts storage bucket, promotion trigger, roll-number generator,
-- and 2 public RPCs (school payment context + SALCI student lookup).

-- =========================================================================
-- 1. oly_students — fully-enrolled students (post-payment)
-- =========================================================================
create table public.oly_students (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,

  full_name text not null,
  date_of_birth date not null,
  class_label text not null,
  section_label text,
  grade_level_id uuid references public.grade_levels(id) on delete restrict,
  admission_number text,

  roll_number text not null unique,

  subject_ids uuid[] not null check (cardinality(subject_ids) = 3),

  parent_name text not null,
  parent_phone text not null,
  parent_email text,

  status text not null default 'active'
    check (status in ('active', 'dormant', 'archived', 'refunded', 'removed')),
  enrolled_at timestamptz not null default now(),
  enrollment_channel text not null
    check (enrollment_channel in ('parent_online', 'teacher_cash')),

  created_by uuid references public.profiles(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_reason text,
  updated_at timestamptz not null default now()
);
create index idx_oly_students_school on public.oly_students(oly_school_id);
create index idx_oly_students_campaign on public.oly_students(campaign_id);
create index idx_oly_students_profile on public.oly_students(profile_id);
create index idx_oly_students_status on public.oly_students(status);
create index idx_oly_students_grade_level on public.oly_students(grade_level_id);
create index idx_oly_students_created_by on public.oly_students(created_by);
create index idx_oly_students_removed_by on public.oly_students(removed_by);

create trigger oly_students_set_updated_at before update on public.oly_students
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 2. oly_enrollment_pending — in-flight payment rows (auto-purged after 1h)
-- =========================================================================
create table public.oly_enrollment_pending (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,

  full_name text not null,
  date_of_birth date not null,
  class_label text not null,
  section_label text,
  grade_level_id uuid references public.grade_levels(id) on delete restrict,
  admission_number text,
  subject_ids uuid[] not null check (cardinality(subject_ids) = 3),
  parent_name text not null,
  parent_phone text not null,
  parent_email text,

  status text not null default 'payment_pending'
    check (status in ('payment_pending', 'paid', 'failed', 'abandoned')),
  gateway_order_id text,
  gateway_payment_id text,
  gateway_signature text,
  failure_reason text,
  amount_paise integer not null check (amount_paise > 0),
  gst_paise integer not null check (gst_paise >= 0),
  total_paise integer not null check (total_paise > 0),

  promoted_student_id uuid references public.oly_students(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oep_school on public.oly_enrollment_pending(oly_school_id);
create index idx_oep_campaign on public.oly_enrollment_pending(campaign_id);
create index idx_oep_status on public.oly_enrollment_pending(status);
create index idx_oep_gateway_order on public.oly_enrollment_pending(gateway_order_id);
create index idx_oep_grade_level on public.oly_enrollment_pending(grade_level_id);
create index idx_oep_promoted on public.oly_enrollment_pending(promoted_student_id);

create trigger oly_enrollment_pending_set_updated_at before update on public.oly_enrollment_pending
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 3. oly_receipts — generated receipt PDF metadata
-- =========================================================================
create table public.oly_receipts (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  receipt_number text not null unique,
  storage_path text not null,
  amount_paise integer not null,
  gst_paise integer not null,
  total_paise integer not null,
  payment_method text not null check (payment_method in ('online', 'cash')),
  gateway_payment_id text,
  gateway_reference text,
  issued_at timestamptz not null default now(),
  emailed_at timestamptz,
  emailed_to text
);
create index idx_oly_receipts_student on public.oly_receipts(oly_student_id);
create index idx_oly_receipts_issued_at on public.oly_receipts(issued_at);

-- =========================================================================
-- 4. oly_refunds — refund audit + state
-- =========================================================================
create table public.oly_refunds (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  initiated_by uuid references public.profiles(id) on delete set null,
  reason text not null,
  scope text not null check (scope in ('per_student', 'school_wide')),
  amount_paise integer not null,
  gateway_refund_id text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'offline')),
  failure_reason text,
  initiated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_oly_refunds_student on public.oly_refunds(oly_student_id);
create index idx_oly_refunds_status on public.oly_refunds(status);
create index idx_oly_refunds_initiated_by on public.oly_refunds(initiated_by);

-- =========================================================================
-- 5. Roll-number generator RPC
-- =========================================================================
create or replace function public.oly_generate_roll_number(
  p_school_short_code text,
  p_class_label text,
  p_campaign_year integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_class_int integer;
  v_seq integer;
begin
  v_class_int := nullif(regexp_replace(p_class_label, '\D', '', 'g'), '')::integer;
  if v_class_int is null then
    raise exception 'Could not extract numeric class from %', p_class_label;
  end if;

  select coalesce(max(
    nullif(regexp_replace(split_part(roll_number, '-', 4), '\D', '', 'g'), '')::integer
  ), 0) + 1
    into v_seq
    from public.oly_students s
    join public.oly_schools sc on sc.id = s.oly_school_id
   where sc.school_short_code = upper(p_school_short_code)
     and substring(s.class_label from '\d+') = v_class_int::text;

  return 'SO' || right(p_campaign_year::text, 2)
         || '-' || upper(p_school_short_code)
         || '-' || lpad(v_class_int::text, 2, '0')
         || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- =========================================================================
-- 6. Receipt-number generator (per-year sequence)
-- =========================================================================
create or replace function public.oly_next_receipt_number(p_year integer)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_seq_name text := format('oly_receipt_seq_%s', p_year);
  v_seq integer;
begin
  if not exists (select 1 from pg_class where relname = v_seq_name and relkind = 'S') then
    execute format('create sequence %I start 1', v_seq_name);
  end if;
  execute format('select nextval(%L)', v_seq_name) into v_seq;
  return 'RCPT-' || p_year::text || '-' || lpad(v_seq::text, 7, '0');
end;
$$;

-- =========================================================================
-- 7. Promotion trigger — fires when oly_enrollment_pending.status -> 'paid'
-- =========================================================================
create or replace function public.oly_promote_pending_to_student()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_school_short_code text;
  v_campaign_year integer;
  v_new_student_id uuid;
  v_roll_number text;
begin
  if old.status = 'paid' or new.status != 'paid' then
    return new;
  end if;
  if new.promoted_student_id is not null then
    return new;
  end if;

  select sc.school_short_code, c.campaign_year
    into v_school_short_code, v_campaign_year
    from public.oly_schools sc
    join public.oly_campaigns c on c.id = sc.campaign_id
   where sc.id = new.oly_school_id;

  v_roll_number := public.oly_generate_roll_number(
    v_school_short_code, new.class_label, v_campaign_year
  );

  insert into public.oly_students (
    oly_school_id, campaign_id,
    full_name, date_of_birth, class_label, section_label, grade_level_id, admission_number,
    roll_number, subject_ids,
    parent_name, parent_phone, parent_email,
    status, enrollment_channel
  ) values (
    new.oly_school_id, new.campaign_id,
    new.full_name, new.date_of_birth, new.class_label, new.section_label, new.grade_level_id, new.admission_number,
    v_roll_number, new.subject_ids,
    new.parent_name, new.parent_phone, new.parent_email,
    'active', 'parent_online'
  )
  returning id into v_new_student_id;

  new.promoted_student_id := v_new_student_id;

  return new;
end;
$$;

create trigger oly_promote_pending_to_student_trg
  before update on public.oly_enrollment_pending
  for each row execute function public.oly_promote_pending_to_student();

-- =========================================================================
-- 8. RLS — super_admin full access on all new tables
-- =========================================================================
alter table public.oly_students enable row level security;
create policy "super_admin all" on public.oly_students for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_enrollment_pending enable row level security;
create policy "super_admin all" on public.oly_enrollment_pending for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_receipts enable row level security;
create policy "super_admin all" on public.oly_receipts for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_refunds enable row level security;
create policy "super_admin all" on public.oly_refunds for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- =========================================================================
-- 9. Storage bucket for receipts
-- =========================================================================
insert into storage.buckets (id, name, public)
  values ('olympiad-receipts', 'olympiad-receipts', false)
  on conflict (id) do nothing;

create policy "super_admin can manage olympiad-receipts"
  on storage.objects for all
  using (bucket_id = 'olympiad-receipts' and public.is_super_admin(auth.uid()))
  with check (bucket_id = 'olympiad-receipts' and public.is_super_admin(auth.uid()));

-- =========================================================================
-- 10. Public RPC — payment context
-- =========================================================================
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

-- =========================================================================
-- 11. Public RPC — SALCI student admission lookup
-- NOTE: class_assignments uses user_id (not student_id) and assigned_at (not created_at)
-- =========================================================================
create or replace function public.oly_lookup_salci_student(
  p_school_short_code text, p_admission_number text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_school_inst_id uuid;
  v_profile_id uuid;
  v_full_name text;
  v_dob date;
  v_class_name text;
begin
  select i.id into v_school_inst_id
    from public.institutions i
    join public.oly_schools sc on sc.institution_id = i.id
   where sc.school_short_code = upper(p_school_short_code)
     and sc.is_existing_salci_school = true;

  if v_school_inst_id is null then
    return jsonb_build_object('found', false);
  end if;

  select p.id, p.full_name, p.date_of_birth
    into v_profile_id, v_full_name, v_dob
    from public.profiles p
   where p.institution_id = v_school_inst_id
     and p.admission_number = p_admission_number
     and exists (
       select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'student'
     );

  if v_profile_id is null then
    return jsonb_build_object('found', false);
  end if;

  select c.name into v_class_name
    from public.class_assignments ca
    join public.classes c on c.id = ca.class_id
   where ca.user_id = v_profile_id
     and ca.role = 'student'
   order by ca.assigned_at desc
   limit 1;

  return jsonb_build_object(
    'found', true,
    'profile_id', v_profile_id,
    'full_name', v_full_name,
    'date_of_birth', v_dob,
    'class_name', v_class_name
  );
end;
$$;

grant execute on function public.oly_lookup_salci_student(text, text) to anon, authenticated;
