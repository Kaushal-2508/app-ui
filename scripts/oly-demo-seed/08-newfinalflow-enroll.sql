-- ============================================================================
-- OLY DEMO SEED — 08 NEW FINAL FLOW (enrolled-only, enrollment stays OPEN)
-- School "New Final Flow" (NEW0QS, id 2d433471-...). Adds, WITHOUT closing
-- enrollment or running any exam:
--   * Class 8 onto the school's participating grades (Class 9/10 already on).
--   * 1 teacher per class for Class 8/9/10 (3 teachers, auth logins).
--   * 35 students per class (105 total) for Class 8/9/10, each with a real
--     auth user (login = roll number / DDMMYY-of-DOB) and a PAID enrollment
--     money row (Rs 500 + Rs 90 GST). NO batches / attempts / results / PDFs.
-- The pre-existing 1 teacher + 1 student are left untouched. School status
-- is NOT changed (stays enrollment_open).
-- Re-runnable: deletes its own prior additions first (students with
--   admission_number like 'NFF-%' + the 3 teacher logins).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Constants
-- ---------------------------------------------------------------------------
create temp table _c (k text primary key, v uuid) on commit drop;
insert into _c values
 ('school',  '2d433471-2d2c-4dd3-99a7-d3ac942be24c'),
 ('inst',    'e7706655-eaf3-43bb-95e2-c956893edc29'),
 ('campaign','d1c8db0f-a956-4e62-88b1-fd753c9e9714'),
 ('admin',   'e49bfd3c-f9a1-4896-b3f0-dc103f14f419'),
 ('c8',      'cf2d9caa-5ae4-46df-9954-b637993032da'),
 ('c9',      'd9ec752e-e972-447c-b099-ccf502d554ab'),
 ('c10',     '17bf8c34-4bb6-404b-820c-ae58ea359c16'),
 ('sci',     'bb031046-f4a4-4cf1-a733-6403b23643cd'),
 ('gk',      '60f55974-5713-4bb7-9483-54ba462c4908'),
 ('eng',     'bde40945-a493-40ef-a999-9549e0feb911'),
 ('math',    '943791db-a7e8-409a-a725-07ccc6cde3ee'),
 ('cs',      '23ae1b4e-e585-4c68-880b-a12b2103ae23');

create or replace function pg_temp.c(text) returns uuid language sql as
  $$ select v from _c where k = $1 $$;

-- ---------------------------------------------------------------------------
-- 1. CLEANUP prior additions of THIS script (FK-safe). Mine = students with
--    admission_number like 'NFF-%' + the 3 teacher logins. Existing 1+1 kept.
-- ---------------------------------------------------------------------------
create temp table _ext_auth (aid uuid) on commit drop;
insert into _ext_auth (aid)
select auth_user_id from oly_students
 where oly_school_id = pg_temp.c('school') and admission_number like 'NFF-%' and auth_user_id is not null;
insert into _ext_auth (aid)
select id from auth.users
 where email in ('c8.teacher@newfinalflow.salci.in','c9.teacher@newfinalflow.salci.in','c10.teacher@newfinalflow.salci.in');

create temp table _ext_students on commit drop as
select id from oly_students where oly_school_id = pg_temp.c('school') and admission_number like 'NFF-%';

delete from oly_enrollment_pending where promoted_student_id in (select id from _ext_students);
delete from oly_students where id in (select id from _ext_students);
delete from oly_teacher_class_assignments
 where oly_school_id = pg_temp.c('school')
   and teacher_profile_id in (select aid from _ext_auth);
delete from auth.users where id in (select aid from _ext_auth);

-- ---------------------------------------------------------------------------
-- 2. Class 8 onto the school's participating grades (idempotent; keeps 9/10)
-- ---------------------------------------------------------------------------
update oly_schools
   set participating_grade_level_ids =
       (select array(select distinct e from unnest(participating_grade_level_ids || pg_temp.c('c8')) e)),
       updated_at = now()
 where id = pg_temp.c('school');

-- ---------------------------------------------------------------------------
-- 3. TEACHERS — 1 per class (Class 8/9/10)
-- ---------------------------------------------------------------------------
create temp table _t (aid uuid default gen_random_uuid(), name text, email text, phone text, grade uuid) on commit drop;
insert into _t (name, email, phone, grade) values
 ('Meena Joshi',  'c8.teacher@newfinalflow.salci.in',  '9876522001', pg_temp.c('c8')),
 ('Arun Nair',    'c9.teacher@newfinalflow.salci.in',  '9876522002', pg_temp.c('c9')),
 ('Sunita Rao',   'c10.teacher@newfinalflow.salci.in', '9876522003', pg_temp.c('c10'));

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select aid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, extensions.crypt('Demo@2026', extensions.gen_salt('bf', 10)),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', name), now(), now(), '', '', '', '', '', '', '', ''
from _t;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), aid, aid::text, 'email',
  jsonb_build_object('sub', aid::text, 'email', email, 'email_verified', true), now(), now()
from _t;

update profiles p set full_name = t.name, email = t.email, phone = t.phone,
       institution_id = pg_temp.c('inst'), is_active = true
  from _t t where p.id = t.aid;

insert into user_roles (user_id, role, institution_id, granted_by)
select aid, 'teacher', pg_temp.c('inst'), pg_temp.c('admin') from _t on conflict do nothing;

insert into oly_teacher_class_assignments (campaign_id, oly_school_id, teacher_profile_id, grade_level_id, assigned_by)
select pg_temp.c('campaign'), pg_temp.c('school'), aid, grade, pg_temp.c('admin') from _t;

-- ---------------------------------------------------------------------------
-- 4. STUDENTS — 35 per class. Class 8/9 cseq 1..35; Class 10 cseq 2..36
--    (Class 10 already has the pre-existing student at cseq 1).
-- ---------------------------------------------------------------------------
create temp table _roster (
  gseq int primary key, cls int, cseq int, name text, section text, dob date,
  channel text, parent text,
  sid uuid default gen_random_uuid(), aid uuid default gen_random_uuid(),
  roll text, email text, grade uuid
) on commit drop;

with fn(arr) as (values (array[
   'Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Krishna','Ishaan','Shaurya',
   'Atharv','Aryan','Kabir','Ayaan','Dhruv','Rudra','Ved','Yuvan','Darsh','Aarush',
   'Anaya','Aadhya','Diya','Ira','Pihu','Prisha','Anvi','Riya','Myra','Sara',
   'Aarohi','Anika','Navya','Kiara','Saanvi','Siya','Aanya','Pari','Avni','Kavya',
   'Mira','Tara','Nisha','Rhea','Zara','Veer','Ojas','Parth','Laksh','Hardik'])),
     ln(arr) as (values (array[
   'Sharma','Verma','Gupta','Singh','Patel','Reddy','Nair','Kapoor','Joshi','Iyer',
   'Mehta','Rao','Das','Bansal','Pillai'])),
     base as (
   select 8 as cls, g as cseq from generate_series(1,35) g
   union all select 9 as cls, g as cseq from generate_series(1,35) g
   union all select 10 as cls, g as cseq from generate_series(2,36) g
   ),
     idx as (select row_number() over (order by cls, cseq) as gseq, cls, cseq from base)
insert into _roster (gseq, cls, cseq, name, section, dob, channel, parent, grade)
select i.gseq, i.cls, i.cseq,
  (select arr from fn)[1 + (i.gseq % 50)] || ' ' || (select arr from ln)[1 + ((i.gseq / 50 + i.cls) % 15)],
  case when i.gseq % 2 = 0 then 'A' else 'B' end,
  make_date(case i.cls when 8 then 2012 when 9 then 2011 else 2010 end, 1, 1) + ((i.gseq * 11) % 330) * interval '1 day',
  case when i.gseq % 3 = 0 then 'teacher_cash' else 'parent_online' end,
  (select arr from fn)[1 + ((i.gseq + 7) % 50)] || ' ' || (select arr from ln)[1 + ((i.gseq / 50 + i.cls + 2) % 15)],
  case i.cls when 8 then pg_temp.c('c8') when 9 then pg_temp.c('c9') else pg_temp.c('c10') end
from idx i;

update _roster set
  roll  = 'SO26-NEW0QS-' || lpad(cls::text, 2, '0') || '-' || lpad(cseq::text, 4, '0'),
  email = lower('SO26-NEW0QS-' || lpad(cls::text, 2, '0') || '-' || lpad(cseq::text, 4, '0')) || '@olympiad.salci.org';

-- 4a. Auth users (password = DDMMYY of DOB)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select aid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, extensions.crypt(to_char(dob, 'DDMMYY'), extensions.gen_salt('bf', 10)),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', name), now(), now(), '', '', '', '', '', '', '', ''
from _roster;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), aid, aid::text, 'email',
  jsonb_build_object('sub', aid::text, 'email', email, 'email_verified', true), now(), now()
from _roster;

update profiles p set full_name = r.name, email = r.email,
       institution_id = pg_temp.c('inst'), is_active = true
  from _roster r where p.id = r.aid;

insert into user_roles (user_id, role, institution_id)
select aid, 'student', pg_temp.c('inst') from _roster on conflict do nothing;

-- 4b. oly_students (subject_ids per grade)
insert into oly_students (id, oly_school_id, campaign_id, profile_id, full_name,
  date_of_birth, class_label, section_label, grade_level_id, admission_number,
  roll_number, subject_ids, parent_name, parent_phone, parent_email, status,
  enrolled_at, enrollment_channel, created_by, auth_user_id)
select r.sid, pg_temp.c('school'), pg_temp.c('campaign'), null, r.name,
  r.dob, 'Class ' || r.cls, r.section, r.grade,
  'NFF-' || (1000 + r.gseq),
  r.roll,
  case r.cls
    when 8  then array[pg_temp.c('sci'),  pg_temp.c('gk'),  pg_temp.c('eng')]
    when 9  then array[pg_temp.c('math'), pg_temp.c('sci'), pg_temp.c('gk')]
    else         array[pg_temp.c('cs'),   pg_temp.c('eng'), pg_temp.c('gk')] end,
  r.parent,
  '96' || lpad((10000000 + r.gseq * 127)::text, 8, '0'),
  lower(r.roll) || '.parent@example.com',
  'active',
  timestamptz '2026-06-09 10:00:00+05:30' + (r.gseq % 5) * interval '1 day' + r.gseq * interval '11 minute',
  r.channel,
  case when r.channel = 'teacher_cash' then pg_temp.c('admin') else null end,
  r.aid
from _roster r;

-- 4c. Money: paid oly_enrollment_pending per student (Rs 500 + 18% GST)
insert into oly_enrollment_pending (oly_school_id, campaign_id, full_name,
  date_of_birth, class_label, section_label, grade_level_id, admission_number,
  subject_ids, parent_name, parent_phone, parent_email, status,
  gateway_order_id, gateway_payment_id, amount_rupees, gst_rupees, total_rupees,
  promoted_student_id)
select pg_temp.c('school'), pg_temp.c('campaign'), r.name,
  r.dob, 'Class ' || r.cls, r.section, r.grade,
  'NFF-' || (1000 + r.gseq),
  case r.cls
    when 8  then array[pg_temp.c('sci'),  pg_temp.c('gk'),  pg_temp.c('eng')]
    when 9  then array[pg_temp.c('math'), pg_temp.c('sci'), pg_temp.c('gk')]
    else         array[pg_temp.c('cs'),   pg_temp.c('eng'), pg_temp.c('gk')] end,
  r.parent,
  '96' || lpad((10000000 + r.gseq * 127)::text, 8, '0'),
  lower(r.roll) || '.parent@example.com',
  'paid',
  case when r.channel = 'teacher_cash' then 'cash_' || r.sid else 'order_NFF' || lpad(r.gseq::text, 6, '0') end,
  case when r.channel = 'teacher_cash' then null else 'pay_NFF' || lpad(r.gseq::text, 6, '0') end,
  500.00, 90.00, 590.00, r.sid
from _roster r;

commit;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
select json_build_object(
  'status', (select status from oly_schools where id='2d433471-2d2c-4dd3-99a7-d3ac942be24c'),
  'participating', (select array_length(participating_grade_level_ids,1) from oly_schools where id='2d433471-2d2c-4dd3-99a7-d3ac942be24c'),
  'students_by_class', (select json_agg(json_build_object('class', class_label, 'n', n) order by class_label)
     from (select class_label, count(*) n from oly_students where oly_school_id='2d433471-2d2c-4dd3-99a7-d3ac942be24c' and status='active' group by class_label) q),
  'teacher_assignments', (select count(*) from oly_teacher_class_assignments where oly_school_id='2d433471-2d2c-4dd3-99a7-d3ac942be24c'),
  'revenue', (select sum(total_rupees) from oly_enrollment_pending where oly_school_id='2d433471-2d2c-4dd3-99a7-d3ac942be24c' and status='paid')
) as result;
