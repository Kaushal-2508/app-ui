SELECT
  (to_regclass('public.notices') IS NOT NULL)                                     AS ok_table_renamed,
  (to_regclass('public.circulars') IS NULL)                                       AS ok_old_gone,
  (SELECT count(*) FROM public.notices) = 9                                       AS ok_rows_preserved,
  (SELECT count(*) FROM public.notices
     WHERE scope NOT IN ('institution','wing','class')) = 0                       AS ok_scope_normalised,
  (SELECT count(*) FROM public.notices
     WHERE priority NOT IN ('normal','important','urgent')) = 0                   AS ok_priority_normalised,
  (SELECT count(*) FROM public.notices WHERE priority = 'important') = 1          AS ok_high_became_important,
  (SELECT count(*) FROM public.notices
     WHERE type NOT IN ('general','academic','event','ptm')) = 0                  AS ok_type_normalised,
  (SELECT count(*) FROM public.notices WHERE scope = 'institution') = 9           AS ok_all_became_institution,
  (SELECT count(*) FROM public.notices WHERE scope = 'class') = 0                 AS ok_no_targetless_class,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notices'
       AND column_name IN ('audience_roles','requires_acknowledgement',
                           'recipient_count','attachments')) = 4                  AS ok_new_columns,
  EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'notices_published_by_fkey')                          AS ok_fk_renamed,
  EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'notices_scope_check')                                AS ok_scope_check,
  EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgname = 'update_notices_ts')                                   AS ok_trigger_renamed;
