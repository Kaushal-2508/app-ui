-- Seed subjects for the existing institution (if not already added)
INSERT INTO subjects (name, code, institution_id) 
SELECT 
  subj.name, 
  subj.code, 
  '527d9edb-2ba9-4fc1-8edc-6c7024dd9148'
FROM (VALUES 
  ('Mathematics', 'MATH'),
  ('English', 'ENG'),
  ('Science', 'SCI'),
  ('Social Studies', 'SS'),
  ('Hindi', 'HIN')
) AS subj(name, code)
WHERE NOT EXISTS (
  SELECT 1 FROM subjects 
  WHERE institution_id = '527d9edb-2ba9-4fc1-8edc-6c7024dd9148' 
  AND code = subj.code
);

-- Seed question bank with sample questions using universal_subjects
-- Mathematics: 51d25503-69c8-456c-8896-52e5799ec610
-- Science: c3c651ee-0f16-49fe-9bd3-3f0cd47010c5
-- English – Grammar: 8683821e-dc24-4510-ae9c-6b55094c01bb

INSERT INTO question_bank (
  institution_id,
  question_text, 
  question_type, 
  difficulty_level, 
  marks, 
  options, 
  correct_answer, 
  explanation, 
  grade_level_id,
  subject_id,
  is_approved,
  created_by
)
SELECT 
  '527d9edb-2ba9-4fc1-8edc-6c7024dd9148',
  q.question_text,
  q.question_type::question_type,
  q.difficulty_level,
  q.marks,
  q.options::jsonb,
  q.correct_answer,
  q.explanation,
  'aaf2daa7-3023-460c-ae09-d01ce845042f',
  q.subject_id::uuid,
  true,
  (SELECT id FROM profiles LIMIT 1)
FROM (VALUES 
  ('What is 5 + 3?', 'mcq', 1, 1, '[{"id":"a","text":"6"},{"id":"b","text":"7"},{"id":"c","text":"8"},{"id":"d","text":"9"}]', 'c', 'Adding 5 and 3 gives 8.', '51d25503-69c8-456c-8896-52e5799ec610'),
  ('What is 12 × 4?', 'mcq', 2, 2, '[{"id":"a","text":"44"},{"id":"b","text":"48"},{"id":"c","text":"52"},{"id":"d","text":"46"}]', 'b', 'Multiplying 12 by 4 gives 48.', '51d25503-69c8-456c-8896-52e5799ec610'),
  ('Solve: 100 ÷ 5 = ?', 'mcq', 1, 1, '[{"id":"a","text":"15"},{"id":"b","text":"25"},{"id":"c","text":"20"},{"id":"d","text":"30"}]', 'c', 'Dividing 100 by 5 gives 20.', '51d25503-69c8-456c-8896-52e5799ec610'),
  ('The Earth revolves around the Sun.', 'true_false', 1, 1, '[{"id":"true","text":"True"},{"id":"false","text":"False"}]', 'true', 'The Earth takes approximately 365.25 days to complete one revolution around the Sun.', 'c3c651ee-0f16-49fe-9bd3-3f0cd47010c5'),
  ('Water boils at 50°C.', 'true_false', 1, 1, '[{"id":"true","text":"True"},{"id":"false","text":"False"}]', 'false', 'Water boils at 100°C at sea level.', 'c3c651ee-0f16-49fe-9bd3-3f0cd47010c5'),
  ('Plants make their own food through photosynthesis.', 'true_false', 1, 1, '[{"id":"true","text":"True"},{"id":"false","text":"False"}]', 'true', 'Plants use sunlight, water, and carbon dioxide to make glucose through photosynthesis.', 'c3c651ee-0f16-49fe-9bd3-3f0cd47010c5'),
  ('What is the opposite of "happy"?', 'mcq', 1, 1, '[{"id":"a","text":"Joyful"},{"id":"b","text":"Sad"},{"id":"c","text":"Excited"},{"id":"d","text":"Cheerful"}]', 'b', 'Sad is the antonym (opposite) of happy.', '8683821e-dc24-4510-ae9c-6b55094c01bb'),
  ('Choose the correct spelling:', 'mcq', 1, 1, '[{"id":"a","text":"Beautifull"},{"id":"b","text":"Beutiful"},{"id":"c","text":"Beautiful"},{"id":"d","text":"Beautyful"}]', 'c', 'The correct spelling is Beautiful.', '8683821e-dc24-4510-ae9c-6b55094c01bb'),
  ('Describe the water cycle in your own words.', 'short_answer', 2, 3, NULL, NULL, 'The water cycle includes evaporation, condensation, precipitation, and collection.', 'c3c651ee-0f16-49fe-9bd3-3f0cd47010c5'),
  ('Explain why we have seasons on Earth.', 'short_answer', 3, 4, NULL, NULL, 'Seasons occur due to the Earth tilt on its axis as it orbits the Sun.', 'c3c651ee-0f16-49fe-9bd3-3f0cd47010c5')
) AS q(question_text, question_type, difficulty_level, marks, options, correct_answer, explanation, subject_id)
WHERE NOT EXISTS (
  SELECT 1 FROM question_bank WHERE question_text = q.question_text
);