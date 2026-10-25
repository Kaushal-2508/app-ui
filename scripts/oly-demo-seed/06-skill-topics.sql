-- ============================================================================
-- OLY DEMO SEED — 06 SKILL-BASED TOPIC TAXONOMY
-- Replaces the chapter-style topics (Number Systems, Cyber Safety, …) with
-- the skill-based taxonomy per subject (Computational Skill, Logical
-- Reasoning, …). Existing topic rows are renamed in place (keeps FKs),
-- extra skills are inserted, every question is re-tagged to its best-fit
-- skill, and the frozen attempt snapshots are re-pointed so the Weakest
-- chapters analytics regroup under the new names.
-- Subjects without a catalog entry (Hindi, Social Studies, Commerce) are
-- intentionally absent — apply when those subjects exist.
-- ============================================================================

begin;

-- subjects: MATH 943791db / SCI bb031046 / GK 60f55974 / CS 23ae1b4e / ENG bde40945
-- grades:   C9 d9ec752e / C10 17bf8c34

create temp table _skills (subject_id uuid, grade_level_id uuid, ord int, name text) on commit drop;
insert into _skills values
-- Mathematics (Class 9)
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',1,'Computational Skill'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Problem Solving'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',3,'Logical Reasoning'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',4,'Pattern Recognition'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',5,'Spatial Reasoning'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',6,'Data Interpretation'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',7,'Estimation & Approximation'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',8,'Real-Life Application'),
-- Science (Class 9)
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',1,'Knowledge Recall'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Conceptual Understanding'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',3,'Scientific Reasoning'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',4,'Observation & Inference'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',5,'Classification & Categorization'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',6,'Application'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',7,'Real-Life Application'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',8,'Analytical Thinking'),
-- General Knowledge (Class 9)
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',1,'Current Affairs'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Static GK'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',3,'Indian Heritage & Culture'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',4,'Science & Technology Awareness'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',5,'Famous Personalities'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',6,'Books, Authors, Awards'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',7,'Geography & Landmarks'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',8,'Sports & Achievements'),
-- General Knowledge (Class 10) — same taxonomy, separate per-grade rows
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'Current Affairs'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'Static GK'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'Indian Heritage & Culture'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'Science & Technology Awareness'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'Famous Personalities'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,'Books, Authors, Awards'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,'Geography & Landmarks'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,'Sports & Achievements'),
-- Computer Science (Class 10)
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'Computer Fundamentals'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'Logical Reasoning'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'Algorithmic Thinking'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'Coding Basics'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'Application Software Knowledge'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,'Internet & Networking Basics'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,'Digital Literacy'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,'Cyber Safety & Ethics'),
-- English Language (Class 10) — 7 skills
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'Vocabulary'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'Grammar & Usage'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'Verbal Comprehension'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'Reading Inference'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'Sentence Construction'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,'Contextual Usage'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,'Critical Reading');

-- 1. Rename existing topics in place (keeps ids/FKs); ranked by display_order.
-- 1a. Park every targeted topic on a unique temp name first — direct renames
--     collide with the unique(subject, grade, name) constraint when an old
--     name (e.g. "Vocabulary") is also a new name at a different rank.
update oly_topics ot
   set name = '~tmp~' || ot.id
 where (ot.subject_id, ot.grade_level_id) in (select distinct subject_id, grade_level_id from _skills);

with ranked as (
  select t.id, t.subject_id, t.grade_level_id,
         row_number() over (partition by t.subject_id, t.grade_level_id order by t.display_order, t.created_at) as rn
  from oly_topics t
  where (t.subject_id, t.grade_level_id) in (select distinct subject_id, grade_level_id from _skills)
)
update oly_topics ot
   set name = sk.name, display_order = sk.ord, status = 'active', updated_at = now()
  from ranked r
  join _skills sk on sk.subject_id = r.subject_id and sk.grade_level_id = r.grade_level_id and sk.ord = r.rn
 where ot.id = r.id and ot.name <> sk.name;

-- 2. Insert the skills that don't exist yet.
insert into oly_topics (subject_id, grade_level_id, name, status, display_order)
select sk.subject_id, sk.grade_level_id, sk.name, 'active', sk.ord
  from _skills sk
 where not exists (
   select 1 from oly_topics t
    where t.subject_id = sk.subject_id and t.grade_level_id = sk.grade_level_id and t.name = sk.name
 );

-- 3. Re-tag every question to its best-fit skill (question rn = canonical order).
create temp table _qmap (subject_id uuid, grade_level_id uuid, rn int, skill_ord int) on commit drop;
insert into _qmap values
-- Mathematics C9: irrational? / rational p-q / degree / find k / point on axis /
-- distance origin / solve pair / graph is line / angle sum / triangle area
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',1,1),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',2,3),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',3,1),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',4,2),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',5,5),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',6,5),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',7,2),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',8,3),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',9,5),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',10,1),
-- Science C9: liquid state / evaporation cools / H2O / atomic number / SI force /
-- speed / unit work / energy at rest / mitochondria / cell wall
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',1,2),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',2,7),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',3,1),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',4,2),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',5,1),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',6,2),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',7,1),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',8,3),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',9,1),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',10,5),
-- GK C9: capital Australia / currency Japan / largest planet / red planet /
-- cricket XI / checkmate / anthem author / first PM / national animal / longest river
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',1,2),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',2,2),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',3,4),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',4,4),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',5,8),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',6,8),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',7,5),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',8,5),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',9,3),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',10,7),
-- GK C10: father of nation / national flower / Au / telephone / Olympics 2024 /
-- national sport / largest ocean / Everest / UN HQ / light in vacuum
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,5),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,3),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,4),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,4),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,1),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,8),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,7),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,7),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',9,2),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',10,4),
-- CS C10: CPU / byte / WWW / HTTP / Python / HTML / Windows / input device /
-- strong password / phishing
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,1),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,1),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,6),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,6),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,4),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,4),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,1),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,7),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',9,8),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',10,8),
-- English C10: sunset passage / persuasive / she goes / wrote / synonym /
-- antonym / spelling / formal letter / personification / poet
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,3),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,7),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,2),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,2),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,1),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,1),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,1),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,6),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',9,7),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',10,1);

with ranked_q as (
  select q.id, q.subject_id, q.grade_level_id,
         row_number() over (partition by q.subject_id, q.grade_level_id order by q.created_at, q.id) as rn
  from oly_questions q
  where (q.subject_id, q.grade_level_id) in (select distinct subject_id, grade_level_id from _qmap)
)
update oly_questions oq
   set topic_id = t.id, updated_at = now()
  from ranked_q r
  join _qmap qm on qm.subject_id = r.subject_id and qm.grade_level_id = r.grade_level_id and qm.rn = r.rn
  join oly_topics t on t.subject_id = qm.subject_id and t.grade_level_id = qm.grade_level_id and t.display_order = qm.skill_ord
 where oq.id = r.id;

-- 4. Re-point the frozen attempt snapshots so analytics regroup immediately.
update oly_questions_snapshot qs
   set topic_id = q.topic_id
  from oly_questions q
 where qs.question_id = q.id
   and (q.subject_id, q.grade_level_id) in (select distinct subject_id, grade_level_id from _qmap)
   and qs.topic_id is distinct from q.topic_id;

commit;

select 'skill topics applied' as status,
  (select count(*) from oly_topics where (subject_id, grade_level_id) in
    (('943791db-a7e8-409a-a725-07ccc6cde3ee'::uuid,'d9ec752e-e972-447c-b099-ccf502d554ab'::uuid),
     ('bb031046-f4a4-4cf1-a733-6403b23643cd'::uuid,'d9ec752e-e972-447c-b099-ccf502d554ab'::uuid),
     ('60f55974-5713-4bb7-9483-54ba462c4908'::uuid,'d9ec752e-e972-447c-b099-ccf502d554ab'::uuid),
     ('60f55974-5713-4bb7-9483-54ba462c4908'::uuid,'17bf8c34-4bb6-404b-820c-ae58ea359c16'::uuid),
     ('23ae1b4e-e585-4c68-880b-a12b2103ae23'::uuid,'17bf8c34-4bb6-404b-820c-ae58ea359c16'::uuid),
     ('bde40945-a493-40ef-a999-9549e0feb911'::uuid,'17bf8c34-4bb6-404b-820c-ae58ea359c16'::uuid))) as topics_total,
  (select count(*) from oly_questions q join oly_topics t on t.id = q.topic_id
    where q.internal_notes = '[demo-seed 2026-06-11]' and t.display_order is not null) as questions_tagged,
  (select count(distinct qs.topic_id) from oly_questions_snapshot qs
    join oly_attempts a on a.id = qs.oly_attempt_id
    join oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1') as distinct_snapshot_topics;
