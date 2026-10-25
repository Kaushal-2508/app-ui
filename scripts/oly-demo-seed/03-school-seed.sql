-- ============================================================================
-- OLY DEMO SEED — 03 SCHOOL ENVIRONMENT (New Flow Demo / NEW00A)
-- Creates a complete "exam conducted, results published" demo state:
--   2 teachers, 24 students (13×Class 9, 11×Class 10) with real auth users
--   (login = roll number + DDMMYY-of-DOB password), paid enrollment money
--   rows (₹500+₹90 GST each), 3 completed batches with plaintext PINs,
--   21 submitted attempts w/ full question snapshots + answers, ranked
--   results with gold/silver/bronze/participation/absent tiers, a completed
--   publish job, audit trail, and school status = results_published.
-- Re-runnable: wipes all prior demo rows for this school first.
-- Rollback: re-run cleanup block alone (auth users tracked in
--   salci_backups.oly_demo_seed_nfd).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Constants
-- ---------------------------------------------------------------------------
create temp table _c (k text primary key, v uuid) on commit drop;
insert into _c values
 ('school',  'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'),
 ('inst',    '508807f9-9905-4885-9a42-be20d80d1db0'),
 ('campaign','d1c8db0f-a956-4e62-88b1-fd753c9e9714'),
 ('admin',   'f575aec2-8ca6-4598-aee4-551fa9db8a59'),
 ('c9',      'd9ec752e-e972-447c-b099-ccf502d554ab'),
 ('c10',     '17bf8c34-4bb6-404b-820c-ae58ea359c16'),
 ('math',    '943791db-a7e8-409a-a725-07ccc6cde3ee'),
 ('sci',     'bb031046-f4a4-4cf1-a733-6403b23643cd'),
 ('gk',      '60f55974-5713-4bb7-9483-54ba462c4908'),
 ('cs',      '23ae1b4e-e585-4c68-880b-a12b2103ae23'),
 ('eng',     'bde40945-a493-40ef-a999-9549e0feb911');

create or replace function pg_temp.c(text) returns uuid language sql as
  $$ select v from _c where k = $1 $$;

-- ---------------------------------------------------------------------------
-- 1. CLEANUP previous demo rows for this school (FK-safe order)
-- ---------------------------------------------------------------------------
create table if not exists salci_backups.oly_demo_seed_nfd (
  kind text not null, ref_id uuid not null, note text, created_at timestamptz default now()
);

delete from auth.users u where u.id in
  (select ref_id from salci_backups.oly_demo_seed_nfd where kind in ('student_auth','teacher_auth'));

delete from oly_results where oly_school_id = pg_temp.c('school');
delete from oly_publish_jobs where oly_school_id = pg_temp.c('school');
delete from oly_answers a using oly_attempts t join oly_students s on s.id = t.oly_student_id
  where a.oly_attempt_id = t.id and s.oly_school_id = pg_temp.c('school');
delete from oly_questions_snapshot q using oly_attempts t join oly_students s on s.id = t.oly_student_id
  where q.oly_attempt_id = t.id and s.oly_school_id = pg_temp.c('school');
delete from oly_attempt_events e using oly_attempts t join oly_students s on s.id = t.oly_student_id
  where e.oly_attempt_id = t.id and s.oly_school_id = pg_temp.c('school');
delete from oly_attempts t using oly_students s
  where t.oly_student_id = s.id and s.oly_school_id = pg_temp.c('school');
delete from oly_batch_assignments b using oly_students s
  where b.oly_student_id = s.id and s.oly_school_id = pg_temp.c('school');
delete from oly_pin_attempt_log where oly_school_id = pg_temp.c('school');
delete from oly_reminder_log r using oly_students s
  where r.oly_student_id = s.id and s.oly_school_id = pg_temp.c('school');
delete from oly_batches where oly_school_id = pg_temp.c('school');
delete from oly_receipts r using oly_students s
  where r.oly_student_id = s.id and s.oly_school_id = pg_temp.c('school');
delete from oly_refunds r using oly_students s
  where r.oly_student_id = s.id and s.oly_school_id = pg_temp.c('school');
delete from oly_enrollment_pending where oly_school_id = pg_temp.c('school');
delete from oly_students where oly_school_id = pg_temp.c('school');
delete from oly_teacher_class_assignments where oly_school_id = pg_temp.c('school');
delete from oly_audit_log where oly_school_id = pg_temp.c('school');
delete from salci_backups.oly_demo_seed_nfd;

-- ---------------------------------------------------------------------------
-- 2. TEACHERS (auth user -> trigger pre-creates profile -> upsert-style update)
-- ---------------------------------------------------------------------------
create temp table _teachers (
  aid uuid default gen_random_uuid(), name text, email text, phone text, cls int
) on commit drop;
insert into _teachers (name, email, phone, cls) values
 ('Anjali Mehra', 'anjali.mehra@newflowdemo.salci.in', '9876511001', 9),
 ('Rohan Verma',  'rohan.verma@newflowdemo.salci.in',  '9876511002', 10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select aid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, extensions.crypt('Demo@2026', extensions.gen_salt('bf', 10)),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', name), now(), now(), '', '', '', '', '', '', '', ''
from _teachers;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), aid, aid::text, 'email',
  jsonb_build_object('sub', aid::text, 'email', email, 'email_verified', true),
  now(), now()
from _teachers;

-- handle_new_user pre-created bare profiles rows; fill them (upsert-on-id rule)
update profiles p
   set full_name = t.name, email = t.email, phone = t.phone,
       institution_id = pg_temp.c('inst'), is_active = true
  from _teachers t where p.id = t.aid;

insert into user_roles (user_id, role, institution_id, granted_by)
select t.aid, 'teacher', pg_temp.c('inst'), pg_temp.c('admin') from _teachers t
on conflict do nothing;

insert into oly_teacher_class_assignments (campaign_id, oly_school_id, teacher_profile_id, grade_level_id, assigned_by)
select pg_temp.c('campaign'), pg_temp.c('school'), t.aid,
       case when t.cls = 9 then pg_temp.c('c9') else pg_temp.c('c10') end,
       pg_temp.c('admin')
from _teachers t;

insert into salci_backups.oly_demo_seed_nfd (kind, ref_id, note)
select 'teacher_auth', aid, email from _teachers;

-- ---------------------------------------------------------------------------
-- 3. STUDENTS roster
--    batch_no: 1 = C9 Batch 1, 2 = C9 Batch 2, 3 = C10 Batch 1, 0 = unassigned
--    c1/c2/c3 = correct answers per subject (10 questions each); attempted=false
--    rows sat out the exam.
-- ---------------------------------------------------------------------------
create temp table _roster (
  seq int primary key, cls int, cseq int, name text, section text, dob date,
  channel text, batch_no int, attempted boolean, c1 int, c2 int, c3 int,
  parent text,
  sid uuid default gen_random_uuid(), aid uuid default gen_random_uuid(),
  roll text, email text
) on commit drop;

insert into _roster (seq, cls, cseq, name, section, dob, channel, batch_no, attempted, c1, c2, c3, parent) values
 ( 1,  9,  1, 'Aarav Sharma',    'A', '2011-03-14', 'parent_online', 1, true, 10, 9, 9, 'Rajesh Sharma'),
 ( 2,  9,  2, 'Diya Patel',      'A', '2011-07-02', 'teacher_cash',  1, true,  9, 8, 8, 'Sunita Patel'),
 ( 3,  9,  3, 'Kabir Singh',     'A', '2011-01-23', 'parent_online', 1, true,  8, 7, 7, 'Amit Singh'),
 ( 4,  9,  4, 'Ananya Gupta',    'A', '2011-09-11', 'parent_online', 1, true,  7, 7, 6, 'Pooja Gupta'),
 ( 5,  9,  5, 'Vihaan Reddy',    'B', '2011-05-30', 'teacher_cash',  1, true,  7, 6, 6, 'Suresh Reddy'),
 ( 6,  9,  6, 'Ishita Verma',    'B', '2011-11-18', 'parent_online', 1, true,  6, 6, 6, 'Kavita Verma'),
 ( 7,  9,  7, 'Arjun Nair',      'B', '2011-04-09', 'teacher_cash',  2, true,  6, 5, 5, 'Manoj Nair'),
 ( 8,  9,  8, 'Myra Kapoor',     'A', '2011-08-25', 'parent_online', 2, true,  5, 5, 5, 'Neha Kapoor'),
 ( 9,  9,  9, 'Reyansh Joshi',   'B', '2011-02-17', 'teacher_cash',  2, true,  5, 5, 4, 'Vikram Joshi'),
 (10,  9, 10, 'Saanvi Iyer',     'A', '2011-12-05', 'parent_online', 2, true,  9, 9, 8, 'Anita Iyer'),
 (11,  9, 11, 'Advait Kulkarni', 'B', '2011-06-21', 'parent_online', 2, true,  4, 4, 4, 'Sanjay Kulkarni'),
 (12,  9, 12, 'Navya Choudhary', 'A', '2011-10-08', 'teacher_cash',  2, true,  3, 3, 3, 'Ritu Choudhary'),
 (13,  9, 13, 'Dhruv Malhotra',  'B', '2011-03-29', 'parent_online', 0, false, 0, 0, 0, 'Deepak Malhotra'),
 (14, 10,  1, 'Aditya Rao',      'A', '2010-04-12', 'parent_online', 3, true,  9, 9, 9, 'Meena Rao'),
 (15, 10,  2, 'Kiara Mehta',     'A', '2010-08-03', 'teacher_cash',  3, true,  8, 8, 8, 'Arvind Mehta'),
 (16, 10,  3, 'Rohan Das',       'B', '2010-01-26', 'parent_online', 3, true,  8, 8, 7, 'Shalini Das'),
 (17, 10,  4, 'Anika Bansal',    'A', '2010-10-15', 'parent_online', 3, true,  7, 7, 7, 'Ramesh Bansal'),
 (18, 10,  5, 'Shaurya Mishra',  'B', '2010-06-07', 'teacher_cash',  3, true,  7, 7, 6, 'Geeta Mishra'),
 (19, 10,  6, 'Tara Pillai',     'A', '2010-12-19', 'parent_online', 3, true,  6, 6, 5, 'Ashok Pillai'),
 (20, 10,  7, 'Yash Agarwal',    'B', '2010-02-28', 'teacher_cash',  3, true,  5, 5, 5, 'Priya Agarwal'),
 (21, 10,  8, 'Prisha Sethi',    'A', '2010-07-22', 'parent_online', 3, true,  5, 4, 4, 'Vinod Sethi'),
 (22, 10,  9, 'Riya Saxena',     'B', '2010-09-04', 'teacher_cash',  3, true,  4, 4, 3, 'Seema Saxena'),
 (23, 10, 10, 'Kunal Bhatt',     'B', '2010-05-16', 'parent_online', 3, false, 0, 0, 0, 'Harish Bhatt'),
 (24, 10, 11, 'Arnav Chawla',    'A', '2010-11-30', 'teacher_cash',  0, false, 0, 0, 0, 'Lakshmi Chawla');

update _roster set
  roll  = 'SO26-NEW00A-' || lpad(cls::text, 2, '0') || '-' || lpad(cseq::text, 4, '0'),
  email = lower('SO26-NEW00A-' || lpad(cls::text, 2, '0') || '-' || lpad(cseq::text, 4, '0')) || '@olympiad.salci.org';

-- 3a. Student auth users (password = DDMMYY of DOB, the real convention)
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
  jsonb_build_object('sub', aid::text, 'email', email, 'email_verified', true),
  now(), now()
from _roster;

update profiles p
   set full_name = r.name, email = r.email, institution_id = pg_temp.c('inst'), is_active = true
  from _roster r where p.id = r.aid;

insert into user_roles (user_id, role, institution_id)
select r.aid, 'student', pg_temp.c('inst') from _roster r
on conflict do nothing;

insert into salci_backups.oly_demo_seed_nfd (kind, ref_id, note)
select 'student_auth', aid, roll from _roster;

-- 3b. oly_students
insert into oly_students (id, oly_school_id, campaign_id, profile_id, full_name,
  date_of_birth, class_label, section_label, grade_level_id, admission_number,
  roll_number, subject_ids, parent_name, parent_phone, parent_email, status,
  enrolled_at, enrollment_channel, created_by, auth_user_id)
select r.sid, pg_temp.c('school'), pg_temp.c('campaign'), null, r.name,
  r.dob, 'Class ' || r.cls, r.section,
  case when r.cls = 9 then pg_temp.c('c9') else pg_temp.c('c10') end,
  'NFD-' || (1000 + r.seq),
  r.roll,
  case when r.cls = 9
    then array[pg_temp.c('math'), pg_temp.c('sci'), pg_temp.c('gk')]
    else array[pg_temp.c('cs'),   pg_temp.c('eng'), pg_temp.c('gk')] end,
  r.parent,
  '98' || lpad((10000000 + r.seq * 137)::text, 8, '0'),
  replace(lower(r.name), ' ', '.') || '.parent@example.com',
  'active',
  timestamptz '2026-05-20 10:00:00+05:30' + (r.seq % 14) * interval '1 day' + r.seq * interval '17 minute',
  r.channel,
  case when r.channel = 'teacher_cash' then pg_temp.c('admin') else null end,
  r.aid
from _roster r;

-- 3c. Money: one paid oly_enrollment_pending row per student (₹500 + 18% GST)
insert into oly_enrollment_pending (oly_school_id, campaign_id, full_name,
  date_of_birth, class_label, section_label, grade_level_id, admission_number,
  subject_ids, parent_name, parent_phone, parent_email, status,
  gateway_order_id, gateway_payment_id, amount_rupees, gst_rupees, total_rupees,
  promoted_student_id)
select pg_temp.c('school'), pg_temp.c('campaign'), r.name,
  r.dob, 'Class ' || r.cls, r.section,
  case when r.cls = 9 then pg_temp.c('c9') else pg_temp.c('c10') end,
  'NFD-' || (1000 + r.seq),
  case when r.cls = 9
    then array[pg_temp.c('math'), pg_temp.c('sci'), pg_temp.c('gk')]
    else array[pg_temp.c('cs'),   pg_temp.c('eng'), pg_temp.c('gk')] end,
  r.parent,
  '98' || lpad((10000000 + r.seq * 137)::text, 8, '0'),
  replace(lower(r.name), ' ', '.') || '.parent@example.com',
  'paid',
  case when r.channel = 'teacher_cash' then 'cash_' || r.sid
       else 'order_DEMO' || lpad(r.seq::text, 6, '0') end,
  case when r.channel = 'teacher_cash' then null
       else 'pay_DEMO' || lpad(r.seq::text, 6, '0') end,
  500.00, 90.00, 590.00,
  r.sid
from _roster r;

-- ---------------------------------------------------------------------------
-- 4. BATCHES (completed exam day 2026-06-08) + assignments
-- ---------------------------------------------------------------------------
create temp table _batches (
  bno int primary key, bid uuid default gen_random_uuid(), label text,
  grade uuid, sched timestamptz, pc int, pin text
) on commit drop;
insert into _batches (bno, label, grade, sched, pc, pin) values
 (1, 'Class 9 - Batch 1',  null, timestamptz '2026-06-08 09:00:00+05:30', 12, 'XK7P2M'),
 (2, 'Class 9 - Batch 2',  null, timestamptz '2026-06-08 11:30:00+05:30', 12, 'T9WQ4R'),
 (3, 'Class 10 - Batch 1', null, timestamptz '2026-06-08 09:00:00+05:30', 15, 'B3NHL8');
update _batches set grade = pg_temp.c('c9')  where bno in (1, 2);
update _batches set grade = pg_temp.c('c10') where bno = 3;

insert into oly_batches (id, campaign_id, oly_school_id, grade_level_id, batch_label,
  scheduled_at, pc_count, pin, pin_expiry_minutes, pin_first_used_at, is_absentees,
  status, created_by, locked_at)
select b.bid, pg_temp.c('campaign'), pg_temp.c('school'), b.grade, b.label,
  b.sched, b.pc, b.pin, 120, b.sched + interval '6 minute', false,
  'completed', pg_temp.c('admin'), timestamptz '2026-06-05 14:00:00+05:30'
from _batches b;

insert into oly_batch_assignments (oly_batch_id, oly_student_id)
select b.bid, r.sid from _roster r join _batches b on b.bno = r.batch_no
where r.batch_no > 0;

-- ---------------------------------------------------------------------------
-- 5. ATTEMPTS + QUESTION SNAPSHOTS + ANSWERS (21 students appeared)
-- ---------------------------------------------------------------------------
create temp table _grade_subjects (cls int, ord int, sub uuid, sub_name text) on commit drop;
insert into _grade_subjects values
 (9, 1, pg_temp.c('math'), 'Mathematics'),
 (9, 2, pg_temp.c('sci'),  'Science'),
 (9, 3, pg_temp.c('gk'),   'General Knowledge'),
 (10, 1, pg_temp.c('cs'),  'Computer Science'),
 (10, 2, pg_temp.c('eng'), 'English Language'),
 (10, 3, pg_temp.c('gk'),  'General Knowledge');

create temp table _attempts as
select r.seq, r.sid, r.cls, r.c1, r.c2, r.c3,
  gen_random_uuid() as atid, b.bid,
  b.sched + interval '7 minute' + r.cseq * interval '23 second' as started_at,
  b.sched + interval '7 minute' + r.cseq * interval '23 second'
    + (48 + (r.seq * 7) % 27) * interval '1 minute' as submitted_at,
  (r.c1 + r.c2 + r.c3) as obtained
from _roster r join _batches b on b.bno = r.batch_no
where r.attempted;

insert into oly_attempts (id, oly_student_id, oly_batch_id, campaign_id, started_at,
  exam_duration_seconds, status, submitted_at, submit_reason, total_marks_obtained,
  total_max_marks, percentage, subject_scores, proctoring_violations, section_switches)
select a.atid, a.sid, a.bid, pg_temp.c('campaign'), a.started_at,
  5400,
  case when a.seq = 12 then 'auto_submitted_timer' else 'submitted' end,
  a.submitted_at,
  case when a.seq = 12 then 'timer' else 'manual' end,
  a.obtained, 30, round(a.obtained / 30.0 * 100, 2),
  (select jsonb_object_agg(gs.sub::text, jsonb_build_object(
      'correct', case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end,
      'total', 10,
      'marks_obtained', case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end,
      'marks_max', 10))
     from _grade_subjects gs where gs.cls = a.cls),
  case when a.seq % 7 = 0 then 1 else 0 end,
  2 + a.seq % 4
from _attempts a;

-- Snapshots: freeze the 10 questions per subject in canonical order
create temp table _snapshots as
select gen_random_uuid() as snid, a.atid, a.seq, a.started_at,
  q.subject_id, q.id as question_id, q.topic_id,
  row_number() over (partition by a.atid, q.subject_id order by q.created_at, q.id) as pos,
  q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
  case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end as subj_correct
from _attempts a
join _grade_subjects gs on gs.cls = a.cls
join oly_questions q on q.subject_id = gs.sub
  and q.grade_level_id = case when a.cls = 9 then pg_temp.c('c9') else pg_temp.c('c10') end
  and q.status = 'active';

insert into oly_questions_snapshot (id, oly_attempt_id, subject_id, question_id,
  topic_id, position_in_subject, question_text, option_a, option_b, option_c,
  option_d, correct_answer, marks)
select snid, atid, subject_id, question_id, topic_id, pos, question_text,
  option_a, option_b, option_c, option_d, correct_answer, 1
from _snapshots;

-- Answers: first N positions correct, rest deliberately wrong
insert into oly_answers (oly_attempt_id, oly_question_snapshot_id, selected_answer,
  marked_for_review, time_spent_seconds, answered_at)
select s.atid, s.snid,
  case when s.pos <= s.subj_correct then s.correct_answer
       else case s.correct_answer when 'A' then 'B' when 'B' then 'C' when 'C' then 'D' else 'A' end
  end,
  false,
  40 + ((s.pos * 37 + s.seq * 13) % 120),
  s.started_at + s.pos * interval '100 second'
from _snapshots s;

-- ---------------------------------------------------------------------------
-- 6. RESULTS (ranked, tiered per campaign thresholds 85/70/50) + absent rows
-- ---------------------------------------------------------------------------
create temp table _ranked as
select a.*, round(a.obtained / 30.0 * 100, 2) as pct,
  extract(epoch from (a.submitted_at - a.started_at))::int as ttime,
  rank() over (partition by a.cls order by a.obtained desc, (a.submitted_at - a.started_at) asc)::int as class_rank,
  count(*) over (partition by a.cls)::int as class_total,
  rank() over (order by a.obtained desc, (a.submitted_at - a.started_at) asc)::int as school_rank,
  count(*) over ()::int as school_total
from _attempts a;

insert into oly_results (oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
  total_marks_obtained, total_max_marks, percentage, subject_scores, total_time_seconds,
  class_rank, class_total, school_rank, school_total, certificate_tier, certificate_id,
  emailed_to, emailed_at, published_at)
select rk.sid, rk.atid, pg_temp.c('campaign'), pg_temp.c('school'),
  rk.obtained, 30, rk.pct,
  (select jsonb_agg(jsonb_build_object(
      'subject_id', gs.sub, 'subject_name', gs.sub_name,
      'correct', case gs.ord when 1 then rk.c1 when 2 then rk.c2 else rk.c3 end,
      'total', 10,
      'marks_obtained', case gs.ord when 1 then rk.c1 when 2 then rk.c2 else rk.c3 end,
      'marks_max', 10,
      'percentage', (case gs.ord when 1 then rk.c1 when 2 then rk.c2 else rk.c3 end) * 10.0
    ) order by gs.ord)
   from _grade_subjects gs where gs.cls = rk.cls),
  rk.ttime,
  rk.class_rank, rk.class_total, rk.school_rank, rk.school_total,
  case when rk.pct >= 85 then 'gold'
       when rk.pct >= 70 then 'silver'
       when rk.pct >= 50 then 'bronze'
       else 'participation' end,
  'CERT-2026-' || lpad(nextval('oly_certificate_seq')::text, 7, '0'),
  replace(lower((select name from _roster r where r.sid = rk.sid)), ' ', '.') || '.parent@example.com',
  timestamptz '2026-06-10 18:08:00+05:30',
  timestamptz '2026-06-10 18:05:00+05:30'
from _ranked rk;

-- Absent rows (no terminal attempt): Dhruv, Kunal, Arnav
insert into oly_results (oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
  total_marks_obtained, total_max_marks, percentage, subject_scores, total_time_seconds,
  class_rank, class_total, school_rank, school_total, certificate_tier, certificate_id,
  emailed_to, emailed_at, published_at)
select r.sid, null, pg_temp.c('campaign'), pg_temp.c('school'),
  0, 0, 0, '[]'::jsonb, null,
  null, null, null, null, 'absent',
  'CERT-2026-' || lpad(nextval('oly_certificate_seq')::text, 7, '0'),
  null, null,
  timestamptz '2026-06-10 18:05:00+05:30'
from _roster r where not r.attempted;

-- ---------------------------------------------------------------------------
-- 7. PUBLISH JOB (exactly one row per school) + audit trail + school flip
-- ---------------------------------------------------------------------------
insert into oly_publish_jobs (oly_school_id, campaign_id, initiated_by, status,
  total_students, processed_students, failed_students, started_at, completed_at)
values (pg_temp.c('school'), pg_temp.c('campaign'), pg_temp.c('admin'), 'completed',
  24, 24, 0, timestamptz '2026-06-10 17:50:00+05:30', timestamptz '2026-06-10 18:05:00+05:30');

insert into oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json, created_at)
values
 (pg_temp.c('campaign'), pg_temp.c('school'), pg_temp.c('admin'), 'school_admin', 'teacher_created',
  jsonb_build_object('note', 'demo seed: Anjali Mehra (Class 9)'), timestamptz '2026-05-19 11:00:00+05:30'),
 (pg_temp.c('campaign'), pg_temp.c('school'), pg_temp.c('admin'), 'school_admin', 'teacher_created',
  jsonb_build_object('note', 'demo seed: Rohan Verma (Class 10)'), timestamptz '2026-05-19 11:05:00+05:30'),
 (pg_temp.c('campaign'), pg_temp.c('school'), pg_temp.c('admin'), 'school_admin', 'enrollment_closed',
  jsonb_build_object('students', 24), timestamptz '2026-06-04 18:30:00+05:30'),
 (pg_temp.c('campaign'), pg_temp.c('school'), pg_temp.c('admin'), 'school_admin', 'batches_locked',
  jsonb_build_object('count', 3), timestamptz '2026-06-05 14:00:00+05:30'),
 (pg_temp.c('campaign'), pg_temp.c('school'), pg_temp.c('admin'), 'school_admin', 'results_published',
  jsonb_build_object('students', 24), timestamptz '2026-06-10 17:50:00+05:30');

update oly_schools
   set status = 'results_published',
       pc_count = 20,
       city = 'Ludhiana',
       state = 'Punjab',
       enrollment_closes_at = timestamptz '2026-06-04 18:30:00+05:30',
       updated_at = now()
 where id = pg_temp.c('school');

commit;

select 'school seeded' as status,
 (select count(*) from oly_students where oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1') as students,
 (select count(*) from oly_teacher_class_assignments where oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1') as teacher_assignments,
 (select count(*) from oly_batches where oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1') as batches,
 (select count(*) from oly_attempts a join oly_students s on s.id = a.oly_student_id
   where s.oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1') as attempts,
 (select count(*) from oly_answers an join oly_attempts a on a.id = an.oly_attempt_id
   join oly_students s on s.id = a.oly_student_id
   where s.oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1') as answers,
 (select count(*) from oly_results where oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1') as results,
 (select sum(total_rupees) from oly_enrollment_pending
   where oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1' and status = 'paid') as revenue_rupees;
