-- Verify Class 9 / Science chapter-2 import vs XLSX, plus the cumulative
-- per-chip totals admin will see.

WITH alliance AS (SELECT id FROM institutions WHERE name ILIKE '%Alliance%International%'),
class9 AS (
  SELECT cg.id FROM class_groups cg
  WHERE cg.institution_id IN (SELECT id FROM alliance) AND cg.name ILIKE 'Class 9%'
),
top_level AS (
  SELECT * FROM public.question_bank
   WHERE institution_id IN (SELECT id FROM alliance)
     AND class_group_id IN (SELECT id FROM class9)
     AND parent_question_id IS NULL
),
chapter2 AS (
  SELECT * FROM top_level WHERE topic_id = '0e2928a3-e957-46ca-acfb-d9214579baca'
)
SELECT 'CHAPTER 2 — MCQ' AS chip, COUNT(*) AS top_level
  FROM chapter2 WHERE question_type = 'mcq' UNION ALL
SELECT 'CHAPTER 2 — True / False',
  COUNT(*) FROM chapter2 WHERE question_type = 'true_false' UNION ALL
SELECT 'CHAPTER 2 — Fill in Blank',
  COUNT(*) FROM chapter2 WHERE question_type = 'fill_blank' UNION ALL
SELECT 'CHAPTER 2 — Match Column',
  COUNT(*) FROM chapter2 WHERE question_type IN ('matching','match_column') UNION ALL
SELECT 'CHAPTER 2 — Short Answer',
  COUNT(*) FROM chapter2 WHERE question_type = 'short_answer' UNION ALL
SELECT 'CHAPTER 2 — Long Answer',
  COUNT(*) FROM chapter2 WHERE question_type = 'long_answer' AND sub_question_count IS NULL UNION ALL
SELECT 'CHAPTER 2 — Comprehension',
  COUNT(*) FROM chapter2 WHERE question_type = 'comprehension' UNION ALL
SELECT 'CHAPTER 2 — Case Study',
  COUNT(*) FROM chapter2 WHERE question_type = 'long_answer' AND sub_question_count IS NOT NULL UNION ALL
SELECT 'CHAPTER 2 — TOTAL',
  COUNT(*) FROM chapter2 UNION ALL
SELECT '----', NULL UNION ALL
SELECT 'CLASS 9 — total top-level (all chapters)', COUNT(*) FROM top_level;
