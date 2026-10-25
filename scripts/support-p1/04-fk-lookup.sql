SELECT
  c.conname                                   AS constraint_name,
  pg_get_constraintdef(c.oid)                 AS definition,
  c.confdeltype                               AS on_delete_code,
  (SELECT a.attnotnull FROM pg_attribute a
    WHERE a.attrelid = c.conrelid AND a.attname = 'reporter_id') AS reporter_id_not_null
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.conrelid = 'public.reported_issues'::regclass
  AND c.contype = 'f'
  AND a.attname = 'reporter_id';
