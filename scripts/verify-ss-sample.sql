SELECT display_order,
       encode(convert_to(topic_name,'UTF8'),'hex') AS name_hex
FROM syllabus_topics
WHERE subject_id = '2852f766-52d1-47db-bd3e-66ed8b22e3d5'  -- C8 Social Science
  AND is_active
ORDER BY display_order, topic_name;
