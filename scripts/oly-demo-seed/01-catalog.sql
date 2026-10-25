-- ============================================================================
-- OLY DEMO SEED — 01 CATALOG (subjects, topics/syllabus, questions)
-- Campaign 2026 is a TEST campaign (status draft, all schools are test
-- schools), so upgrading the shared catalog in place is safe.
-- Idempotent: subject renames are no-ops on re-run; topics are upserted by
-- (subject, grade, name); questions are rewritten by stable ordering.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Rename placeholder subjects to realistic ones
-- ---------------------------------------------------------------------------
update oly_subjects set name = 'Mathematics',       updated_at = now() where id = '943791db-a7e8-409a-a725-07ccc6cde3ee' and name <> 'Mathematics';
update oly_subjects set name = 'Science',           updated_at = now() where id = 'bb031046-f4a4-4cf1-a733-6403b23643cd' and name <> 'Science';
update oly_subjects set name = 'General Knowledge', updated_at = now() where id = '60f55974-5713-4bb7-9483-54ba462c4908' and name <> 'General Knowledge';
-- 'English' already exists globally (Class 3 subject) and names are unique
update oly_subjects set name = 'English Language',  updated_at = now() where id = 'bde40945-a493-40ef-a999-9549e0feb911' and name <> 'English Language';
-- 23ae1b4e-e585-4c68-880b-a12b2103ae23 already 'Computer Science'

-- ---------------------------------------------------------------------------
-- 2. Topics (syllabus): rename the 2 placeholders per pair, add 3 more each
--    Pair key: (subject_id, grade_level_id). Class 9 = d9ec752e-..., Class 10 = 17bf8c34-...
-- ---------------------------------------------------------------------------
create temp table _seed_topics (
  subject_id uuid, grade_level_id uuid, display_order int, name text
) on commit drop;

insert into _seed_topics values
-- Class 9 Mathematics
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',1,'Number Systems'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Polynomials'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',3,'Coordinate Geometry'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',4,'Linear Equations'),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',5,'Triangles and Mensuration'),
-- Class 9 Science
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',1,'Matter in Our Surroundings'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Atoms and Molecules'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',3,'Motion, Force and Laws'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',4,'Work and Energy'),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',5,'The Fundamental Unit of Life'),
-- Class 9 General Knowledge
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',1,'India and the World'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Science and Technology'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',3,'Sports'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',4,'History and Civics'),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',5,'General Awareness'),
-- Class 10 Computer Science
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'Computer Fundamentals'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'Internet and the Web'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'Programming Basics'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'Office Productivity Tools'),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'Cyber Safety'),
-- Class 10 English
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'Reading Comprehension'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'Grammar'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'Vocabulary'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'Writing Skills'),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'Literature'),
-- Class 10 General Knowledge
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'India and the World'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'Science and Discoveries'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'Sports and Games'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'World Geography'),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'General Awareness');

-- Rename the existing 2 placeholder topics per pair to the first 2 seed names
with ranked as (
  select t.id, t.subject_id, t.grade_level_id,
         row_number() over (partition by t.subject_id, t.grade_level_id order by t.display_order, t.created_at) as rn
  from oly_topics t
  where (t.subject_id, t.grade_level_id) in (select distinct subject_id, grade_level_id from _seed_topics)
)
update oly_topics ot
   set name = st.name, display_order = st.display_order, status = 'active', updated_at = now()
  from ranked r
  join _seed_topics st on st.subject_id = r.subject_id and st.grade_level_id = r.grade_level_id and st.display_order = r.rn
 where ot.id = r.id
   and ot.name <> st.name;

-- Insert the remaining seed topics that don't exist yet (by name)
insert into oly_topics (subject_id, grade_level_id, name, status, display_order)
select st.subject_id, st.grade_level_id, st.name, 'active', st.display_order
  from _seed_topics st
 where not exists (
   select 1 from oly_topics t
    where t.subject_id = st.subject_id and t.grade_level_id = st.grade_level_id and t.name = st.name
 );

-- ---------------------------------------------------------------------------
-- 3. Questions: rewrite the 10 placeholder questions per pair with real MCQs.
--    Pairing is by stable order (created_at, id) <-> rn 1..10.
--    Topic assignment: q1-2 topic#1, q3-4 #2, q5-6 #3, q7-8 #4, q9-10 #5.
-- ---------------------------------------------------------------------------
create temp table _seed_questions (
  subject_id uuid, grade_level_id uuid, rn int,
  question_text text, option_a text, option_b text, option_c text, option_d text,
  correct_answer char(1), topic_order int
) on commit drop;

insert into _seed_questions values
-- ===================== Class 9 Mathematics =====================
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',1,'Which of the following is an irrational number?','3/4','√2','0.5','22/7','B',1),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Every rational number can be written in the form p/q where q is:','Zero','Any integer','A non-zero integer','A prime number','C',1),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',3,'What is the degree of the polynomial 4x³ + 2x² − 7x + 1?','1','2','3','7','C',2),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',4,'If x = 2 is a zero of p(x) = x² − kx + 6, the value of k is:','2','3','5','6','C',2),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',5,'The point (0, −5) lies on:','The x-axis','The y-axis','The origin','Quadrant III','B',3),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',6,'The distance of the point (3, 4) from the origin is:','5 units','7 units','12 units','25 units','A',3),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',7,'If x + y = 10 and x − y = 2, then x equals:','4','5','6','8','C',4),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',8,'The graph of a linear equation in two variables is always a:','Circle','Parabola','Straight line','Point','C',4),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',9,'The sum of the interior angles of a triangle is:','90°','180°','270°','360°','B',5),
('943791db-a7e8-409a-a725-07ccc6cde3ee','d9ec752e-e972-447c-b099-ccf502d554ab',10,'The area of a triangle with base 10 cm and height 6 cm is:','30 cm²','60 cm²','16 cm²','26 cm²','A',5),
-- ===================== Class 9 Science =====================
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',1,'Which state of matter has a definite volume but no definite shape?','Solid','Liquid','Gas','Plasma','B',1),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',2,'Evaporation of a liquid causes:','Heating','Cooling','No temperature change','Freezing','B',1),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',3,'The chemical formula of water is:','H₂O','HO₂','H₂O₂','OH','A',2),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',4,'The atomic number of an element equals the number of:','Neutrons','Protons','Electrons plus neutrons','Nucleons','B',2),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',5,'The SI unit of force is the:','Joule','Newton','Pascal','Watt','B',3),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',6,'Speed is defined as:','Distance × time','Distance ÷ time','Time ÷ distance','Mass × velocity','B',3),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',7,'The SI unit of work is the:','Newton','Joule','Watt','Ampere','B',4),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',8,'A body at rest has which form of mechanical energy?','Kinetic energy','Potential energy','Sound energy','No energy at all','B',4),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',9,'Which organelle is known as the powerhouse of the cell?','Nucleus','Ribosome','Mitochondria','Golgi apparatus','C',5),
('bb031046-f4a4-4cf1-a733-6403b23643cd','d9ec752e-e972-447c-b099-ccf502d554ab',10,'The plant cell wall is mainly made of:','Chitin','Cellulose','Protein','Starch','B',5),
-- ===================== Class 9 General Knowledge =====================
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',1,'The capital city of Australia is:','Sydney','Melbourne','Canberra','Perth','C',1),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',2,'The currency of Japan is the:','Yuan','Won','Yen','Ringgit','C',1),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',3,'Which planet is the largest in our solar system?','Earth','Jupiter','Saturn','Neptune','B',2),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',4,'Which planet is called the Red Planet?','Venus','Mars','Mercury','Jupiter','B',2),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',5,'How many players are there in a cricket team?','10','11','12','9','B',3),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',6,'In which sport is the term "checkmate" used?','Carrom','Chess','Ludo','Bridge','B',3),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',7,'Who wrote the Indian national anthem?','Rabindranath Tagore','Bankim Chandra Chatterjee','Mahatma Gandhi','Jawaharlal Nehru','A',4),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',8,'Who was the first Prime Minister of India?','Sardar Patel','Jawaharlal Nehru','Rajendra Prasad','B. R. Ambedkar','B',4),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',9,'The national animal of India is the:','Lion','Tiger','Elephant','Peacock','B',5),
('60f55974-5713-4bb7-9483-54ba462c4908','d9ec752e-e972-447c-b099-ccf502d554ab',10,'Which is the longest river in India?','Yamuna','Brahmaputra','Ganga','Godavari','C',5),
-- ===================== Class 10 Computer Science =====================
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'CPU stands for:','Central Program Unit','Central Processing Unit','Computer Processing Unit','Control Processing Unit','B',1),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'1 byte is equal to how many bits?','4','8','16','32','B',1),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'WWW stands for:','World Wide Web','World Web Window','Wide World Web','Web World Wide','A',2),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'Which protocol is used to load web pages in a browser?','FTP','SMTP','HTTP','SSH','C',2),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'Python is a:','Hardware component','Programming language','Computer virus','Web browser','B',3),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,'HTML is mainly used for:','Styling pages','Structuring web pages','Managing databases','Networking','B',3),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,'Which of the following is an operating system?','MS Word','Windows','Chrome','Excel','B',4),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,'Which of these is an input device?','Printer','Monitor','Keyboard','Speaker','C',4),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',9,'A strong password should contain:','Only your name','Only numbers','Only lowercase letters','A mix of letters, numbers and symbols','D',5),
('23ae1b4e-e585-4c68-880b-a12b2103ae23','17bf8c34-4bb6-404b-820c-ae58ea359c16',10,'Phishing is:','A type of computer game','An attempt to steal personal information','A programming technique','A hardware failure','B',5),
-- ===================== Class 10 English =====================
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'Read: "The sun set behind the hills, painting the sky orange." The passage describes:','Sunrise','Sunset','Midnight','Noon','B',1),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'A passage whose purpose is to convince the reader is called:','Narrative','Descriptive','Persuasive','Expository','C',1),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'Choose the correct sentence: "She ___ to school every day."','go','goes','going','gone','B',2),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'The past tense of "write" is:','wrote','written','writes','writing','A',2),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'A synonym of "happy" is:','Sad','Joyful','Angry','Tired','B',3),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,'The antonym of "ancient" is:','Old','Modern','Antique','Aged','B',3),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,'The correct spelling is:','recieve','receive','receeve','riceive','B',4),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,'A formal letter should begin with:','Hey there!','Dear Sir/Madam','What''s up?','Hi friend','B',4),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',9,'"The wind whispered through the trees" is an example of:','Simile','Metaphor','Personification','Hyperbole','C',5),
('bde40945-a493-40ef-a999-9549e0feb911','17bf8c34-4bb6-404b-820c-ae58ea359c16',10,'A person who writes poems is called a:','Novelist','Poet','Author','Editor','B',5),
-- ===================== Class 10 General Knowledge =====================
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',1,'Who is known as the Father of the Nation in India?','Jawaharlal Nehru','Mahatma Gandhi','Sardar Patel','Subhas Chandra Bose','B',1),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',2,'The national flower of India is the:','Rose','Lotus','Lily','Sunflower','B',1),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',3,'The chemical symbol for gold is:','Ag','Au','Gd','Go','B',2),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',4,'Who invented the telephone?','Thomas Edison','Alexander Graham Bell','Guglielmo Marconi','Nikola Tesla','B',2),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',5,'Which city hosted the 2024 Summer Olympics?','Tokyo','Paris','Los Angeles','London','B',3),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',6,'India''s national sport is commonly regarded as:','Cricket','Hockey','Kabaddi','Football','B',3),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',7,'The largest ocean on Earth is the:','Atlantic Ocean','Indian Ocean','Pacific Ocean','Arctic Ocean','C',4),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',8,'Mount Everest lies in which country?','India','Nepal','Bhutan','Myanmar','B',4),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',9,'The headquarters of the United Nations is in:','Geneva','New York','Paris','Vienna','B',5),
('60f55974-5713-4bb7-9483-54ba462c4908','17bf8c34-4bb6-404b-820c-ae58ea359c16',10,'Light travels fastest in:','Water','Glass','Vacuum','Air','C',5);

with ranked_q as (
  select q.id, q.subject_id, q.grade_level_id,
         row_number() over (partition by q.subject_id, q.grade_level_id order by q.created_at, q.id) as rn
  from oly_questions q
  where (q.subject_id, q.grade_level_id) in (select distinct subject_id, grade_level_id from _seed_questions)
),
topic_lookup as (
  select t.id as topic_id, t.subject_id, t.grade_level_id, t.display_order
  from oly_topics t
  where (t.subject_id, t.grade_level_id) in (select distinct subject_id, grade_level_id from _seed_questions)
)
update oly_questions oq
   set question_text = sq.question_text,
       option_a = sq.option_a, option_b = sq.option_b,
       option_c = sq.option_c, option_d = sq.option_d,
       correct_answer = sq.correct_answer,
       topic_id = tl.topic_id,
       status = 'active',
       internal_notes = '[demo-seed 2026-06-11]',
       updated_at = now()
  from ranked_q r
  join _seed_questions sq on sq.subject_id = r.subject_id and sq.grade_level_id = r.grade_level_id and sq.rn = r.rn
  left join topic_lookup tl on tl.subject_id = sq.subject_id and tl.grade_level_id = sq.grade_level_id and tl.display_order = sq.topic_order
 where oq.id = r.id;

commit;

select 'catalog seeded' as status,
  (select count(*) from oly_topics where (subject_id, grade_level_id) in (select distinct subject_id, grade_level_id from oly_questions where internal_notes = '[demo-seed 2026-06-11]')) as topics,
  (select count(*) from oly_questions where internal_notes = '[demo-seed 2026-06-11]') as questions_rewritten;
