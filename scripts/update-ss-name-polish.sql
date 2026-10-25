-- The U+FFFD in this source name was actually curly quotes around "Native",
-- not a dash, so the generic clean produced "-Native-". Tidy that one row.
UPDATE syllabus_topics
SET topic_name = replace(topic_name, '-Native-', 'Native')
WHERE subject_id IN ('38147008-dfd1-4a3a-9790-b470bb96e3e0',
                     '115136e0-a58c-4a00-8120-2317a5d5b7ea',
                     '2852f766-52d1-47db-bd3e-66ed8b22e3d5')
  AND topic_name LIKE '%Civilising the -Native-%';
