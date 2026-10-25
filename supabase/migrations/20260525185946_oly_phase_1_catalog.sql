-- Phase 1 — Olympiad super-admin catalog
-- Adds 7 oly_* tables, lock trigger, RLS via existing is_super_admin() helper,
-- and the olympiad-study-material storage bucket with policies.

-- =========================================================================
-- 1. Campaigns (one row per campaign year)
-- =========================================================================
create table public.oly_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_year smallint not null unique check (campaign_year between 2024 and 2100),
  default_price_paise integer not null check (default_price_paise > 0),
  gst_percent numeric(5,2) not null default 18.00 check (gst_percent >= 0 and gst_percent <= 100),
  exam_duration_minutes integer not null default 90 check (exam_duration_minutes > 0),
  questions_per_subject integer not null default 30 check (questions_per_subject > 0),
  pin_expiry_minutes integer not null default 120 check (pin_expiry_minutes > 0),
  gold_threshold_percent numeric(5,2) not null default 85.00,
  silver_threshold_percent numeric(5,2) not null default 70.00,
  bronze_threshold_percent numeric(5,2) not null default 50.00,
  gstin text,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oly_campaigns_status on public.oly_campaigns(status);
create index idx_oly_campaigns_created_by on public.oly_campaigns(created_by);

-- =========================================================================
-- 2. Subjects + class applicability
-- =========================================================================
create table public.oly_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name)
);

create table public.oly_subject_classes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(subject_id, grade_level_id)
);
create index idx_osc_subject on public.oly_subject_classes(subject_id);
create index idx_osc_grade_level on public.oly_subject_classes(grade_level_id);

-- =========================================================================
-- 3. Topics per (subject, grade_level)
-- =========================================================================
create table public.oly_topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subject_id, grade_level_id, name)
);
create index idx_oly_topics_subject_grade on public.oly_topics(subject_id, grade_level_id);
create index idx_oly_topics_status on public.oly_topics(status);

-- =========================================================================
-- 4. Question bank
-- =========================================================================
create table public.oly_questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  topic_id uuid references public.oly_topics(id) on delete set null,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer char(1) not null check (correct_answer in ('A','B','C','D')),
  internal_notes text,
  status text not null default 'active' check (status in ('active','inactive')),
  image_url text,
  times_used integer not null default 0,
  total_correct integer not null default 0,
  total_attempts integer not null default 0,
  total_time_seconds bigint not null default 0,
  last_used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oly_questions_subject_grade on public.oly_questions(subject_id, grade_level_id);
create index idx_oly_questions_topic on public.oly_questions(topic_id);
create index idx_oly_questions_status on public.oly_questions(status);
create index idx_oly_questions_created_by on public.oly_questions(created_by);

-- =========================================================================
-- 5. Study materials
-- =========================================================================
create table public.oly_study_materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.oly_subjects(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  title text not null,
  description text,
  storage_path text not null,
  file_size_bytes integer not null check (file_size_bytes > 0),
  display_order integer not null default 0,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_osm_subject_grade on public.oly_study_materials(subject_id, grade_level_id);
create index idx_osm_display_order on public.oly_study_materials(display_order);

-- =========================================================================
-- 6. Schools roster (rows arrive in Phase 2)
-- =========================================================================
create table public.oly_schools (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  school_short_code text not null unique check (school_short_code ~ '^[A-Z0-9]{6}$'),
  city text,
  state text,
  primary_contact_name text not null,
  primary_contact_email text not null,
  primary_contact_phone text not null,
  participating_grade_level_ids uuid[] not null default '{}',
  price_override_paise integer check (price_override_paise > 0),
  is_existing_salci_school boolean not null default false,
  status text not null default 'enrollment_open'
    check (status in ('enrollment_open','enrollment_closed','batches_scheduled',
                      'exam_in_progress','results_published','archived')),
  internal_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, institution_id)
);
create index idx_oly_schools_campaign on public.oly_schools(campaign_id);
create index idx_oly_schools_institution on public.oly_schools(institution_id);
create index idx_oly_schools_status on public.oly_schools(status);

-- =========================================================================
-- 7. Updated_at triggers
-- =========================================================================
create or replace function public.oly_set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger oly_campaigns_set_updated_at before update on public.oly_campaigns
  for each row execute function public.oly_set_updated_at();
create trigger oly_subjects_set_updated_at before update on public.oly_subjects
  for each row execute function public.oly_set_updated_at();
create trigger oly_topics_set_updated_at before update on public.oly_topics
  for each row execute function public.oly_set_updated_at();
create trigger oly_questions_set_updated_at before update on public.oly_questions
  for each row execute function public.oly_set_updated_at();
create trigger oly_schools_set_updated_at before update on public.oly_schools
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 8. Lock trigger — once campaign is active AND any school has enrolled
-- =========================================================================
create or replace function public.oly_campaign_lock_check()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  has_enrolled_school boolean;
begin
  if (old.status = 'active' and new.status = 'active') then
    select exists(
      select 1 from public.oly_schools
       where campaign_id = new.id
         and status != 'enrollment_open'
    ) into has_enrolled_school;

    if has_enrolled_school then
      if (new.exam_duration_minutes != old.exam_duration_minutes
       or new.questions_per_subject != old.questions_per_subject
       or new.gst_percent != old.gst_percent
       or new.gold_threshold_percent != old.gold_threshold_percent
       or new.silver_threshold_percent != old.silver_threshold_percent
       or new.bronze_threshold_percent != old.bronze_threshold_percent) then
        raise exception 'Cannot edit locked campaign fields once schools have enrolled. Default price and per-school overrides remain editable.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger oly_campaign_lock_before_update
  before update on public.oly_campaigns
  for each row execute function public.oly_campaign_lock_check();

-- =========================================================================
-- 9. RLS — super admin full access on all oly_* tables
-- =========================================================================
alter table public.oly_campaigns enable row level security;
create policy "super_admin all" on public.oly_campaigns for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_subjects enable row level security;
create policy "super_admin all" on public.oly_subjects for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_subject_classes enable row level security;
create policy "super_admin all" on public.oly_subject_classes for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_topics enable row level security;
create policy "super_admin all" on public.oly_topics for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_questions enable row level security;
create policy "super_admin all" on public.oly_questions for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_study_materials enable row level security;
create policy "super_admin all" on public.oly_study_materials for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_schools enable row level security;
create policy "super_admin all" on public.oly_schools for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- =========================================================================
-- 10. RPC — paginated question-bank view
-- =========================================================================
create or replace function public.oly_question_bank_view(
  p_subject_id uuid,
  p_grade_level_id uuid,
  p_topic_id uuid default null,
  p_status text default null,
  p_sort text default 'last_used_desc',
  p_page integer default 1,
  p_page_size integer default 25
)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := greatest(0, (p_page - 1) * p_page_size);
  v_rows jsonb;
  v_total integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.oly_questions q
   where q.subject_id = p_subject_id
     and q.grade_level_id = p_grade_level_id
     and (p_topic_id is null or q.topic_id = p_topic_id)
     and (p_status is null or q.status = p_status);

  select coalesce(jsonb_agg(row_to_jsonb(x)), '[]'::jsonb) into v_rows
    from (
      select
        q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
        q.correct_answer, q.topic_id, q.status, q.times_used, q.total_correct,
        q.total_attempts, q.total_time_seconds, q.last_used_at, q.updated_at,
        t.name as topic_name,
        case when q.total_attempts > 0
          then round((q.total_correct::numeric / q.total_attempts) * 100, 2)
          else null end as avg_correct_rate_percent,
        case when q.total_attempts > 0
          then round((q.total_time_seconds::numeric / q.total_attempts), 2)
          else null end as avg_time_seconds
      from public.oly_questions q
      left join public.oly_topics t on t.id = q.topic_id
      where q.subject_id = p_subject_id
        and q.grade_level_id = p_grade_level_id
        and (p_topic_id is null or q.topic_id = p_topic_id)
        and (p_status is null or q.status = p_status)
      order by
        case when p_sort = 'avg_correct_rate_asc' then
          coalesce((q.total_correct::numeric / nullif(q.total_attempts, 0)), 999) end asc nulls last,
        case when p_sort = 'times_used_desc' then q.times_used end desc nulls last,
        case when p_sort = 'last_used_desc' then q.last_used_at end desc nulls last,
        q.created_at desc
      limit p_page_size offset v_offset
    ) x;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', p_page, 'page_size', p_page_size);
end;
$$;

-- =========================================================================
-- 11. RPC — single-question upsert
-- =========================================================================
create or replace function public.oly_questions_upsert(p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_row record;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_id := nullif(p_payload->>'id', '')::uuid;

  if v_id is null then
    insert into public.oly_questions (
      subject_id, grade_level_id, topic_id, question_text,
      option_a, option_b, option_c, option_d, correct_answer,
      internal_notes, status, created_by
    ) values (
      (p_payload->>'subject_id')::uuid,
      (p_payload->>'grade_level_id')::uuid,
      nullif(p_payload->>'topic_id','')::uuid,
      p_payload->>'question_text',
      p_payload->>'option_a',
      p_payload->>'option_b',
      p_payload->>'option_c',
      p_payload->>'option_d',
      p_payload->>'correct_answer',
      p_payload->>'internal_notes',
      coalesce(p_payload->>'status','active'),
      auth.uid()
    ) returning * into v_row;
  else
    update public.oly_questions set
      topic_id = nullif(p_payload->>'topic_id','')::uuid,
      question_text = p_payload->>'question_text',
      option_a = p_payload->>'option_a',
      option_b = p_payload->>'option_b',
      option_c = p_payload->>'option_c',
      option_d = p_payload->>'option_d',
      correct_answer = p_payload->>'correct_answer',
      internal_notes = p_payload->>'internal_notes',
      status = coalesce(p_payload->>'status', status)
    where id = v_id
    returning * into v_row;
  end if;

  return row_to_jsonb(v_row);
end;
$$;

-- =========================================================================
-- 12. RPC — campaign overview stats
-- =========================================================================
create or replace function public.oly_campaign_stats(p_campaign_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total_subjects integer;
  v_total_topics integer;
  v_total_questions integer;
  v_total_materials integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_total_subjects from public.oly_subjects where status = 'active';
  select count(*) into v_total_topics from public.oly_topics where status = 'active';
  select count(*) into v_total_questions from public.oly_questions where status = 'active';
  select count(*) into v_total_materials from public.oly_study_materials;

  return jsonb_build_object(
    'total_subjects', v_total_subjects,
    'total_topics', v_total_topics,
    'total_questions', v_total_questions,
    'total_materials', v_total_materials
  );
end;
$$;

-- =========================================================================
-- 13. Storage bucket for study materials
-- =========================================================================
insert into storage.buckets (id, name, public) values ('olympiad-study-material', 'olympiad-study-material', false)
  on conflict (id) do nothing;

create policy "super_admin can manage olympiad-study-material"
  on storage.objects for all
  using (bucket_id = 'olympiad-study-material' and public.is_super_admin(auth.uid()))
  with check (bucket_id = 'olympiad-study-material' and public.is_super_admin(auth.uid()));

-- =========================================================================
-- 14. Grants for the RPCs (authenticated users only — RPC bodies check role)
-- =========================================================================
grant execute on function public.oly_question_bank_view(uuid, uuid, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.oly_questions_upsert(jsonb) to authenticated;
grant execute on function public.oly_campaign_stats(uuid) to authenticated;
