-- ============================================================================
-- OLY DEMO SEED — 07 EXTEND (New Flow Demo / NEW00A)
-- Additive on top of 03-school-seed.sql. Adds:
--   * Class 8 catalog: 3 subjects (Science, GK, English Language), 15 topics,
--     30 questions (10 per subject); Class 8 added to participating grades.
--   * 1 Class 8 teacher (auth login).
--   * 35 Class 8 students + 30 NEW Class 9 students (cseq 14..43), all with
--     real auth users (login = roll number / DDMMYY-of-DOB), paid enrollment
--     money rows, batch assignments, submitted attempts (a few absent),
--     full question snapshots + answers, and published, ranked results.
--   * Ranks recomputed school-wide (now 89 enrolled across Class 8/9/10).
-- Result/Certificate PDFs are NOT generated here (deferred).
-- Re-runnable: deletes its own prior additions first (Class 8 rows + Class 9
--   cseq>=14 + the 4 new batches + the Class 8 teacher), keyed deterministically.
-- Rollback to the 24-student state: re-run 03-school-seed.sql (full reset).
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
 ('c8',      'cf2d9caa-5ae4-46df-9954-b637993032da'),
 ('c9',      'd9ec752e-e972-447c-b099-ccf502d554ab'),
 ('c10',     '17bf8c34-4bb6-404b-820c-ae58ea359c16'),
 ('sci',     'bb031046-f4a4-4cf1-a733-6403b23643cd'),
 ('gk',      '60f55974-5713-4bb7-9483-54ba462c4908'),
 ('eng',     'bde40945-a493-40ef-a999-9549e0feb911'),
 ('math',    '943791db-a7e8-409a-a725-07ccc6cde3ee');

create or replace function pg_temp.c(text) returns uuid language sql as
  $$ select v from _c where k = $1 $$;

-- ---------------------------------------------------------------------------
-- 1. CLEANUP of a prior run of THIS script (FK-safe). Ext = Class 8 students,
--    Class 9 students with cseq>=14, the 4 new batches, the Class 8 teacher,
--    and all Class 8 catalog rows. Capture auth ids before deleting students.
-- ---------------------------------------------------------------------------
create temp table _ext_auth (aid uuid) on commit drop;

insert into _ext_auth (aid)
select auth_user_id from oly_students
 where oly_school_id = pg_temp.c('school') and auth_user_id is not null
   and ( grade_level_id = pg_temp.c('c8')
      or (grade_level_id = pg_temp.c('c9') and split_part(roll_number,'-',4)::int >= 14) );

-- the Class 8 teacher (deterministic email)
insert into _ext_auth (aid)
select id from auth.users where email = 'class8.teacher@newflowdemo.salci.in';

create temp table _ext_students on commit drop as
select id from oly_students
 where oly_school_id = pg_temp.c('school')
   and ( grade_level_id = pg_temp.c('c8')
      or (grade_level_id = pg_temp.c('c9') and split_part(roll_number,'-',4)::int >= 14) );

delete from oly_results        where oly_student_id in (select id from _ext_students);
delete from oly_answers a using oly_attempts t
  where a.oly_attempt_id = t.id and t.oly_student_id in (select id from _ext_students);
delete from oly_questions_snapshot q using oly_attempts t
  where q.oly_attempt_id = t.id and t.oly_student_id in (select id from _ext_students);
delete from oly_attempt_events e using oly_attempts t
  where e.oly_attempt_id = t.id and t.oly_student_id in (select id from _ext_students);
delete from oly_attempts       where oly_student_id in (select id from _ext_students);
delete from oly_batch_assignments where oly_student_id in (select id from _ext_students);
delete from oly_receipts       where oly_student_id in (select id from _ext_students);
delete from oly_enrollment_pending where promoted_student_id in (select id from _ext_students);
delete from oly_students       where id in (select id from _ext_students);

delete from oly_batches
 where oly_school_id = pg_temp.c('school')
   and ( grade_level_id = pg_temp.c('c8')
      or batch_label in ('Class 9 - Batch 3','Class 9 - Batch 4') );

delete from oly_teacher_class_assignments
 where oly_school_id = pg_temp.c('school') and grade_level_id = pg_temp.c('c8');

-- Class 8 catalog (Class 8 had none before this script)
delete from oly_questions where grade_level_id = pg_temp.c('c8');
delete from oly_topics    where grade_level_id = pg_temp.c('c8');
delete from oly_subject_classes where grade_level_id = pg_temp.c('c8');

-- auth users last (cascades profiles/user_roles)
delete from auth.users where id in (select aid from _ext_auth);

-- ---------------------------------------------------------------------------
-- 2. CLASS 8 CATALOG — subject_classes, topics, questions
-- ---------------------------------------------------------------------------
insert into oly_subject_classes (grade_level_id, subject_id)
values (pg_temp.c('c8'), pg_temp.c('sci')),
       (pg_temp.c('c8'), pg_temp.c('gk')),
       (pg_temp.c('c8'), pg_temp.c('eng'));

-- Topics (5 per subject). Deterministic ids via a temp keyed by (subject, name).
create temp table _t8 (tkey text primary key, tid uuid default gen_random_uuid(), sub uuid, name text, ord int) on commit drop;
insert into _t8 (tkey, sub, name, ord) values
 ('sci_kr',  pg_temp.c('sci'), 'Knowledge Recall',              1),
 ('sci_cu',  pg_temp.c('sci'), 'Conceptual Understanding',      2),
 ('sci_sr',  pg_temp.c('sci'), 'Scientific Reasoning',          3),
 ('sci_cc',  pg_temp.c('sci'), 'Classification & Categorization',4),
 ('sci_ra',  pg_temp.c('sci'), 'Real-Life Application',         5),
 ('gk_sg',   pg_temp.c('gk'),  'Static GK',                     1),
 ('gk_gl',   pg_temp.c('gk'),  'Geography & Landmarks',         2),
 ('gk_fp',   pg_temp.c('gk'),  'Famous Personalities',          3),
 ('gk_sa',   pg_temp.c('gk'),  'Sports & Achievements',         4),
 ('gk_ca',   pg_temp.c('gk'),  'Current Affairs',               5),
 ('eng_vo',  pg_temp.c('eng'), 'Vocabulary',                    1),
 ('eng_gu',  pg_temp.c('eng'), 'Grammar & Usage',               2),
 ('eng_sc',  pg_temp.c('eng'), 'Sentence Construction',         3),
 ('eng_cx',  pg_temp.c('eng'), 'Contextual Usage',              4),
 ('eng_ri',  pg_temp.c('eng'), 'Reading Inference',             5);

insert into oly_topics (id, subject_id, grade_level_id, name, status, display_order)
select tid, sub, pg_temp.c('c8'), name, 'active', ord from _t8;

-- 30 questions (10 per subject). created_at staggered so snapshot ordering is stable.
create temp table _q8 (qord int primary key, tkey text, qt text, a text, b text, c text, d text, ans text) on commit drop;
insert into _q8 (qord, tkey, qt, a, b, c, d, ans) values
 -- Science
 ( 1,'sci_kr','The basic structural unit of all living things is the:','Atom','Cell','Tissue','Organ','B'),
 ( 2,'sci_kr','Which gas do plants take in from the air for photosynthesis?','Oxygen','Nitrogen','Carbon dioxide','Hydrogen','C'),
 ( 3,'sci_cu','The process by which green plants make their own food is called:','Respiration','Photosynthesis','Digestion','Transpiration','B'),
 ( 4,'sci_cu','Which of the following is the best conductor of electricity?','Rubber','Wood','Copper','Plastic','C'),
 ( 5,'sci_cc','Which of these animals is a mammal?','Shark','Frog','Whale','Crocodile','C'),
 ( 6,'sci_cc','Which of the following is a renewable source of energy?','Coal','Petrol','Solar','Natural gas','C'),
 ( 7,'sci_sr','A ball rolls a shorter distance on grass than on a smooth floor mainly because of:','Gravity','Friction','Magnetism','Sound','B'),
 ( 8,'sci_sr','Ice floats on water because ice is:','Heavier than water','Less dense than water','Warmer than water','Made of salt','B'),
 ( 9,'sci_ra','Which household device converts electrical energy mainly into light?','Fan','Electric bulb','Heater','Mixer','B'),
 (10,'sci_ra','We boil drinking water before use mainly to:','Cool it down','Kill harmful germs','Add minerals','Change its colour','B'),
 -- General Knowledge
 (11,'gk_sg','The capital city of India is:','Mumbai','Kolkata','New Delhi','Chennai','C'),
 (12,'gk_sg','How many colours are there in a rainbow?','Five','Six','Seven','Eight','C'),
 (13,'gk_gl','The Taj Mahal is located in the city of:','Delhi','Agra','Jaipur','Lucknow','B'),
 (14,'gk_gl','Which is the longest river in India?','Yamuna','Ganga','Godavari','Narmada','B'),
 (15,'gk_fp','Who is honoured as the Father of the Nation in India?','Jawaharlal Nehru','Mahatma Gandhi','Sardar Patel','Bhagat Singh','B'),
 (16,'gk_fp','Who wrote the Indian national anthem?','Bankim Chandra Chatterjee','Rabindranath Tagore','Sarojini Naidu','Munshi Premchand','B'),
 (17,'gk_sa','A cricket team has how many players on the field?','Nine','Ten','Eleven','Twelve','C'),
 (18,'gk_sa','The modern Olympic Games are held once every how many years?','Two','Three','Four','Five','C'),
 (19,'gk_ca','The national animal of India is the:','Lion','Elephant','Tiger','Peacock','C'),
 (20,'gk_ca','Which festival is widely known as the Festival of Lights?','Holi','Diwali','Eid','Onam','B'),
 -- English Language
 (21,'eng_vo','Choose the word that means the same as HAPPY:','Sad','Glad','Angry','Tired','B'),
 (22,'eng_vo','Choose the word that means the opposite of BEGIN:','Start','Open','End','Continue','C'),
 (23,'eng_gu','Choose the correct word: I saw ___ elephant at the zoo.','a','an','the','some','B'),
 (24,'eng_gu','Identify the verb in: The children play in the park.','children','play','park','the','B'),
 (25,'eng_sc','Choose the correct plural of CHILD:','childs','childes','children','childrens','C'),
 (26,'eng_sc','Choose the correctly written sentence:','where are you going','Where are you going?','where are you going.','Where are you going','B'),
 (27,'eng_gu','Choose the correct past tense: Yesterday she ___ to school.','go','goes','went','gone','C'),
 (28,'eng_cx','Fill in the blank: He is afraid ___ dogs.','of','to','at','for','A'),
 (29,'eng_ri','The sky turned grey and people opened umbrellas. This suggests it was about to:','Snow','Rain','Shine','Freeze','B'),
 (30,'eng_vo','Choose the word that means VERY BIG:','Tiny','Huge','Narrow','Short','B');

insert into oly_questions (id, subject_id, grade_level_id, topic_id, question_text,
  option_a, option_b, option_c, option_d, correct_answer, internal_notes, status, created_at)
select gen_random_uuid(), t.sub, pg_temp.c('c8'), t.tid, q.qt,
  q.a, q.b, q.c, q.d, q.ans, '[demo-seed-ext 2026-06-13]', 'active',
  timestamptz '2026-06-13 10:00:00+05:30' + q.qord * interval '1 minute'
from _q8 q join _t8 t on t.tkey = q.tkey;

-- Class 8 onto the school's participating grades (idempotent)
update oly_schools
   set participating_grade_level_ids =
       (select array(select distinct e from unnest(participating_grade_level_ids || pg_temp.c('c8')) e)),
       updated_at = now()
 where id = pg_temp.c('school');

-- ---------------------------------------------------------------------------
-- 3. TEACHER for Class 8
-- ---------------------------------------------------------------------------
create temp table _t (aid uuid default gen_random_uuid(), name text, email text, phone text) on commit drop;
insert into _t (name, email, phone) values
 ('Pooja Sharma', 'class8.teacher@newflowdemo.salci.in', '9876511003');

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
select pg_temp.c('campaign'), pg_temp.c('school'), aid, pg_temp.c('c8'), pg_temp.c('admin') from _t;

-- ---------------------------------------------------------------------------
-- 4. STUDENTS — 35 Class 8 (cseq 1..35) + 30 new Class 9 (cseq 14..43)
--    Generated from name pools. attempted=false rows sat out the exam.
-- ---------------------------------------------------------------------------
create temp table _roster (
  gseq int primary key, cls int, cseq int, name text, section text, dob date,
  channel text, attempted boolean, c1 int, c2 int, c3 int, parent text,
  sid uuid default gen_random_uuid(), aid uuid default gen_random_uuid(),
  roll text, email text
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
   -- Class 8: cseq 1..35 ; Class 9 new: cseq 14..43
   select 8 as cls, g as cseq from generate_series(1,35) g
   union all
   select 9 as cls, g as cseq from generate_series(14,43) g
   ),
     idx as (
   select row_number() over (order by cls, cseq) as gseq, cls, cseq from base
   )
insert into _roster (gseq, cls, cseq, name, section, dob, channel, attempted, c1, c2, c3, parent)
select i.gseq, i.cls, i.cseq,
  (select arr from fn)[1 + (i.gseq % 50)] || ' ' || (select arr from ln)[1 + ((i.gseq / 50 + i.cls) % 15)],
  case when i.gseq % 2 = 0 then 'A' else 'B' end,
  make_date(case when i.cls = 8 then 2012 else 2011 end, 1, 1) + ((i.gseq * 11) % 330) * interval '1 day',
  case when i.gseq % 3 = 0 then 'teacher_cash' else 'parent_online' end,
  (i.gseq % 13 <> 0),
  least(10, 3 + (i.gseq * 7 + 2) % 8),
  least(10, 3 + (i.gseq * 5 + 1) % 8),
  least(10, 3 + (i.gseq * 3 + 4) % 8),
  (select arr from fn)[1 + ((i.gseq + 7) % 50)] || ' ' || (select arr from ln)[1 + ((i.gseq / 50 + i.cls + 2) % 15)]
from idx i;

update _roster set
  roll  = 'SO26-NEW00A-' || lpad(cls::text, 2, '0') || '-' || lpad(cseq::text, 4, '0'),
  email = lower('SO26-NEW00A-' || lpad(cls::text, 2, '0') || '-' || lpad(cseq::text, 4, '0')) || '@olympiad.salci.org';

-- 4a. Student auth users (password = DDMMYY of DOB)
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

-- 4b. oly_students
insert into oly_students (id, oly_school_id, campaign_id, profile_id, full_name,
  date_of_birth, class_label, section_label, grade_level_id, admission_number,
  roll_number, subject_ids, parent_name, parent_phone, parent_email, status,
  enrolled_at, enrollment_channel, created_by, auth_user_id)
select r.sid, pg_temp.c('school'), pg_temp.c('campaign'), null, r.name,
  r.dob, 'Class ' || r.cls, r.section,
  case when r.cls = 8 then pg_temp.c('c8') else pg_temp.c('c9') end,
  'NFD-' || (2000 + r.gseq),
  r.roll,
  case when r.cls = 8
    then array[pg_temp.c('sci'), pg_temp.c('gk'), pg_temp.c('eng')]
    else array[pg_temp.c('math'), pg_temp.c('sci'), pg_temp.c('gk')] end,
  r.parent,
  '97' || lpad((10000000 + r.gseq * 131)::text, 8, '0'),
  lower(r.roll) || '.parent@example.com',
  'active',
  timestamptz '2026-05-21 10:00:00+05:30' + (r.gseq % 14) * interval '1 day' + r.gseq * interval '13 minute',
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
  r.dob, 'Class ' || r.cls, r.section,
  case when r.cls = 8 then pg_temp.c('c8') else pg_temp.c('c9') end,
  'NFD-' || (2000 + r.gseq),
  case when r.cls = 8
    then array[pg_temp.c('sci'), pg_temp.c('gk'), pg_temp.c('eng')]
    else array[pg_temp.c('math'), pg_temp.c('sci'), pg_temp.c('gk')] end,
  r.parent,
  '97' || lpad((10000000 + r.gseq * 131)::text, 8, '0'),
  lower(r.roll) || '.parent@example.com',
  'paid',
  case when r.channel = 'teacher_cash' then 'cash_' || r.sid else 'order_EXT' || lpad(r.gseq::text, 6, '0') end,
  case when r.channel = 'teacher_cash' then null else 'pay_EXT' || lpad(r.gseq::text, 6, '0') end,
  500.00, 90.00, 590.00, r.sid
from _roster r;

-- ---------------------------------------------------------------------------
-- 5. BATCHES (completed exam day 2026-06-08) + assignments
--    C8 B1 (cseq 1..18) / C8 B2 (19..35) ; C9 B3 (14..28) / C9 B4 (29..43)
-- ---------------------------------------------------------------------------
create temp table _batches (
  bno int primary key, bid uuid default gen_random_uuid(), label text,
  grade uuid, sched timestamptz, pc int, pin text
) on commit drop;
insert into _batches (bno, label, grade, sched, pc, pin) values
 (1, 'Class 8 - Batch 1', null, timestamptz '2026-06-08 09:00:00+05:30', 18, 'K7M3P9'),
 (2, 'Class 8 - Batch 2', null, timestamptz '2026-06-08 11:30:00+05:30', 17, 'R4T8W2'),
 (3, 'Class 9 - Batch 3', null, timestamptz '2026-06-08 14:00:00+05:30', 15, 'N5H6L3'),
 (4, 'Class 9 - Batch 4', null, timestamptz '2026-06-08 16:00:00+05:30', 15, 'B8X4Q7');
update _batches set grade = pg_temp.c('c8') where bno in (1, 2);
update _batches set grade = pg_temp.c('c9') where bno in (3, 4);

insert into oly_batches (id, campaign_id, oly_school_id, grade_level_id, batch_label,
  scheduled_at, pc_count, pin, pin_expiry_minutes, pin_first_used_at, is_absentees,
  status, created_by, locked_at)
select bid, pg_temp.c('campaign'), pg_temp.c('school'), grade, label,
  sched, pc, pin, 120, sched + interval '6 minute', false,
  'completed', pg_temp.c('admin'), timestamptz '2026-06-05 14:00:00+05:30'
from _batches;

-- map each student to a batch
create temp table _sb on commit drop as
select r.sid, r.cls, r.cseq, r.attempted, r.c1, r.c2, r.c3,
  case
    when r.cls = 8 and r.cseq <= 18 then 1
    when r.cls = 8                  then 2
    when r.cls = 9 and r.cseq <= 28 then 3
    else 4
  end as bno
from _roster r;

insert into oly_batch_assignments (oly_batch_id, oly_student_id)
select b.bid, sb.sid from _sb sb join _batches b on b.bno = sb.bno;

-- ---------------------------------------------------------------------------
-- 6. ATTEMPTS + SNAPSHOTS + ANSWERS (appeared students only)
-- ---------------------------------------------------------------------------
create temp table _grade_subjects (cls int, ord int, sub uuid, sub_name text) on commit drop;
insert into _grade_subjects values
 (8, 1, pg_temp.c('sci'),  'Science'),
 (8, 2, pg_temp.c('gk'),   'General Knowledge'),
 (8, 3, pg_temp.c('eng'),  'English Language'),
 (9, 1, pg_temp.c('math'), 'Mathematics'),
 (9, 2, pg_temp.c('sci'),  'Science'),
 (9, 3, pg_temp.c('gk'),   'General Knowledge');

create temp table _attempts on commit drop as
select sb.sid, sb.cls, sb.cseq, sb.c1, sb.c2, sb.c3,
  gen_random_uuid() as atid, b.bid,
  b.sched + interval '7 minute' + sb.cseq * interval '19 second' as started_at,
  b.sched + interval '7 minute' + sb.cseq * interval '19 second'
    + (47 + (sb.cseq * 11) % 30) * interval '1 minute' as submitted_at,
  (sb.c1 + sb.c2 + sb.c3) as obtained
from _sb sb join _batches b on b.bno = sb.bno
where sb.attempted;

insert into oly_attempts (id, oly_student_id, oly_batch_id, campaign_id, started_at,
  exam_duration_seconds, status, submitted_at, submit_reason, total_marks_obtained,
  total_max_marks, percentage, subject_scores, proctoring_violations, section_switches)
select a.atid, a.sid, a.bid, pg_temp.c('campaign'), a.started_at,
  5400, 'submitted', a.submitted_at, 'manual',
  a.obtained, 30, round(a.obtained / 30.0 * 100, 2),
  (select jsonb_object_agg(gs.sub::text, jsonb_build_object(
      'correct', case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end,
      'total', 10,
      'marks_obtained', case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end,
      'marks_max', 10))
     from _grade_subjects gs where gs.cls = a.cls),
  case when a.cseq % 9 = 0 then 1 else 0 end,
  2 + a.cseq % 4
from _attempts a;

create temp table _snapshots on commit drop as
select gen_random_uuid() as snid, a.atid, a.cseq, a.started_at,
  q.subject_id, q.id as question_id, q.topic_id,
  row_number() over (partition by a.atid, q.subject_id order by q.created_at, q.id) as pos,
  q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
  case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end as subj_correct
from _attempts a
join _grade_subjects gs on gs.cls = a.cls
join oly_questions q on q.subject_id = gs.sub
  and q.grade_level_id = case when a.cls = 8 then pg_temp.c('c8') else pg_temp.c('c9') end
  and q.status = 'active';

insert into oly_questions_snapshot (id, oly_attempt_id, subject_id, question_id,
  topic_id, position_in_subject, question_text, option_a, option_b, option_c,
  option_d, correct_answer, marks)
select snid, atid, subject_id, question_id, topic_id, pos, question_text,
  option_a, option_b, option_c, option_d, correct_answer, 1
from _snapshots;

insert into oly_answers (oly_attempt_id, oly_question_snapshot_id, selected_answer,
  marked_for_review, time_spent_seconds, answered_at)
select s.atid, s.snid,
  case when s.pos <= s.subj_correct then s.correct_answer
       else case s.correct_answer when 'A' then 'B' when 'B' then 'C' when 'C' then 'D' else 'A' end end,
  false,
  40 + ((s.pos * 31 + s.cseq * 17) % 120),
  s.started_at + s.pos * interval '95 second'
from _snapshots s;

-- ---------------------------------------------------------------------------
-- 7. RESULTS for the new students (ranks recomputed school-wide in step 8)
-- ---------------------------------------------------------------------------
insert into oly_results (oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
  total_marks_obtained, total_max_marks, percentage, subject_scores, total_time_seconds,
  class_rank, class_total, school_rank, school_total, certificate_tier, certificate_id,
  emailed_to, emailed_at, published_at)
select a.sid, a.atid, pg_temp.c('campaign'), pg_temp.c('school'),
  a.obtained, 30, round(a.obtained / 30.0 * 100, 2),
  (select jsonb_agg(jsonb_build_object(
      'subject_id', gs.sub, 'subject_name', gs.sub_name,
      'correct', case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end,
      'total', 10,
      'marks_obtained', case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end,
      'marks_max', 10,
      'percentage', (case gs.ord when 1 then a.c1 when 2 then a.c2 else a.c3 end) * 10.0
    ) order by gs.ord)
   from _grade_subjects gs where gs.cls = a.cls),
  extract(epoch from (a.submitted_at - a.started_at))::int,
  0, 0, 0, 0,
  case when round(a.obtained / 30.0 * 100, 2) >= 85 then 'gold'
       when round(a.obtained / 30.0 * 100, 2) >= 70 then 'silver'
       when round(a.obtained / 30.0 * 100, 2) >= 50 then 'bronze'
       else 'participation' end,
  'CERT-2026-' || lpad(nextval('oly_certificate_seq')::text, 7, '0'),
  (select lower(roll) from _roster r where r.sid = a.sid) || '.parent@example.com',
  timestamptz '2026-06-10 18:08:00+05:30',
  timestamptz '2026-06-10 18:05:00+05:30'
from _attempts a;

-- Absent rows (no terminal attempt)
insert into oly_results (oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
  total_marks_obtained, total_max_marks, percentage, subject_scores, total_time_seconds,
  class_rank, class_total, school_rank, school_total, certificate_tier, certificate_id,
  emailed_to, emailed_at, published_at)
select r.sid, null, pg_temp.c('campaign'), pg_temp.c('school'),
  0, 0, 0, '[]'::jsonb, null, null, null, null, null, 'absent',
  'CERT-2026-' || lpad(nextval('oly_certificate_seq')::text, 7, '0'),
  null, null, timestamptz '2026-06-10 18:05:00+05:30'
from _roster r where not r.attempted;

-- ---------------------------------------------------------------------------
-- 8. RECOMPUTE RANKS school-wide (existing + new appeared students) and
--    refresh the publish job totals + audit.
-- ---------------------------------------------------------------------------
with appeared as (
  select r.id, s.grade_level_id, r.total_marks_obtained as obt,
         coalesce(extract(epoch from (a.submitted_at - a.started_at)), 999999) as dur
  from oly_results r
  join oly_students s on s.id = r.oly_student_id
  left join oly_attempts a on a.id = r.oly_attempt_id
  where r.oly_school_id = pg_temp.c('school') and r.certificate_tier <> 'absent'
),
ranked as (
  select id,
    rank() over (partition by grade_level_id order by obt desc, dur asc)::int as cr,
    count(*) over (partition by grade_level_id)::int as ct,
    rank() over (order by obt desc, dur asc)::int as sr,
    count(*) over ()::int as st
  from appeared
)
update oly_results r
   set class_rank = rk.cr, class_total = rk.ct, school_rank = rk.sr, school_total = rk.st
  from ranked rk where r.id = rk.id;

update oly_publish_jobs
   set total_students = (select count(*) from oly_students where oly_school_id = pg_temp.c('school') and status='active'),
       processed_students = (select count(*) from oly_students where oly_school_id = pg_temp.c('school') and status='active'),
       failed_students = 0,
       completed_at = timestamptz '2026-06-10 18:05:00+05:30'
 where oly_school_id = pg_temp.c('school');

insert into oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json, created_at)
values
 (pg_temp.c('campaign'), pg_temp.c('school'), pg_temp.c('admin'), 'school_admin', 'teacher_created',
  jsonb_build_object('note', 'demo seed ext: Pooja Sharma (Class 8); +35 Class 8, +30 Class 9 students'),
  timestamptz '2026-06-13 10:10:00+05:30');

commit;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
select json_build_object(
  'students_by_class', (select json_agg(json_build_object('class', class_label, 'n', n) order by class_label)
     from (select class_label, count(*) n from oly_students where oly_school_id='edec11b2-2604-4e58-bfdb-2dfa05f8d3a1' and status='active' group by class_label) q),
  'teacher_assignments', (select count(*) from oly_teacher_class_assignments where oly_school_id='edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'),
  'class8_questions', (select count(*) from oly_questions where grade_level_id='cf2d9caa-5ae4-46df-9954-b637993032da'),
  'batches', (select count(*) from oly_batches where oly_school_id='edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'),
  'attempts', (select count(*) from oly_attempts a join oly_students s on s.id=a.oly_student_id where s.oly_school_id='edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'),
  'results', (select count(*) from oly_results where oly_school_id='edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'),
  'revenue', (select sum(total_rupees) from oly_enrollment_pending where oly_school_id='edec11b2-2604-4e58-bfdb-2dfa05f8d3a1' and status='paid')
) as result;
