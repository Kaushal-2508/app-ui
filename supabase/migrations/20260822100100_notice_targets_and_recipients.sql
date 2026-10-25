-- Notice Board phase 2: multi-target junctions + materialised recipients.
--
-- Recipients are expanded at publish time rather than evaluated at read time.
-- The notice list is loaded by every user on every visit, so its RLS predicate
-- runs per row per user: a materialised row costs one index lookup, whereas
-- rule evaluation costs several EXISTS per row. Publishing is the cold path and
-- fans out in a single INSERT ... SELECT.
--
-- "Who was addressed" and "who has read it" share one row, so reach is
-- count(*) FILTER (WHERE read_at IS NOT NULL) over count(*) -- one server-side
-- aggregate -- and first-open is an UPDATE of a row that already exists rather
-- than an insert-vs-upsert race.
BEGIN;

CREATE TABLE public.notice_target_classes (
  notice_id uuid NOT NULL REFERENCES public.notices(id)  ON DELETE CASCADE,
  class_id  uuid NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  PRIMARY KEY (notice_id, class_id)
);
CREATE INDEX notice_target_classes_class_id_idx ON public.notice_target_classes (class_id);

CREATE TABLE public.notice_target_wings (
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  wing_id   uuid NOT NULL REFERENCES public.wings(id)   ON DELETE CASCADE,
  PRIMARY KEY (notice_id, wing_id)
);
CREATE INDEX notice_target_wings_wing_id_idx ON public.notice_target_wings (wing_id);

CREATE TABLE public.notice_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id       uuid NOT NULL REFERENCES public.notices(id)  ON DELETE CASCADE,
  -- ownership column: cascades with the profile (CLAUDE.md section 21)
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_role  text NOT NULL CHECK (recipient_role IN ('coordinator','teacher','student')),
  added_reason    text NOT NULL CHECK (added_reason IN
                    ('audience_role','class_student','class_teacher',
                     'wing_coordinator_auto','wing_member')),
  read_at         timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, user_id)
);

CREATE INDEX notice_recipients_user_id_idx ON public.notice_recipients (user_id);
CREATE INDEX notice_recipients_unread_idx  ON public.notice_recipients (notice_id)
  WHERE read_at IS NULL;

COMMENT ON COLUMN public.notice_recipients.added_reason IS
  'Why this person is on the notice. Renders the locked coordinator chip and makes an unexpected recipient debuggable.';

ALTER TABLE public.notice_target_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_target_wings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_recipients     ENABLE ROW LEVEL SECURITY;

-- Copy the single-target columns into the junctions. Both are NULL on every
-- prod row today, so these are no-ops here; written anyway so the migration is
-- correct in any environment that does carry targets.
INSERT INTO public.notice_target_classes (notice_id, class_id)
SELECT id, target_class_id FROM public.notices WHERE target_class_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.notice_target_wings (notice_id, wing_id)
SELECT id, target_wing_id FROM public.notices WHERE target_wing_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Expand each legacy notice's original scope into recipients. Role priority
-- coordinator > teacher > student makes recipient_role deterministic for
-- someone who qualifies twice.
INSERT INTO public.notice_recipients (notice_id, user_id, recipient_role, added_reason)
SELECT DISTINCT ON (c.notice_id, c.user_id)
       c.notice_id, c.user_id, c.recipient_role, c.added_reason
FROM (
  SELECT n.id AS notice_id, ca.user_id,
         ca.role::text AS recipient_role,
         CASE ca.role::text WHEN 'student' THEN 'class_student' ELSE 'class_teacher' END AS added_reason
    FROM public.notices n
    JOIN public.notice_target_classes tc ON tc.notice_id = n.id
    JOIN public.class_assignments ca     ON ca.class_id  = tc.class_id
    JOIN public.profiles p               ON p.id = ca.user_id
   WHERE n.scope = 'class'
     AND ca.role::text IN ('student','teacher')
     AND p.institution_id = n.institution_id
     AND p.is_active IS NOT FALSE

  UNION ALL

  SELECT n.id, wa.user_id, 'coordinator', 'wing_coordinator_auto'
    FROM public.notices n
    JOIN public.notice_target_classes tc  ON tc.notice_id = n.id
    JOIN public.wing_class_mappings wcm   ON wcm.class_id = tc.class_id
    JOIN public.wing_assignments wa       ON wa.wing_id   = wcm.wing_id
    JOIN public.profiles p                ON p.id = wa.user_id
   WHERE n.scope = 'class'
     AND p.institution_id = n.institution_id
     AND p.is_active IS NOT FALSE

  UNION ALL

  SELECT n.id, wa.user_id,
         COALESCE((SELECT ur.role::text FROM public.user_roles ur
                    WHERE ur.user_id = wa.user_id
                      AND ur.role::text IN ('coordinator','teacher','student')
                    ORDER BY CASE ur.role::text
                               WHEN 'coordinator' THEN 1
                               WHEN 'teacher'     THEN 2
                               ELSE 3 END
                    LIMIT 1), 'student'),
         'wing_member'
    FROM public.notices n
    JOIN public.notice_target_wings tw ON tw.notice_id = n.id
    JOIN public.wing_assignments wa    ON wa.wing_id   = tw.wing_id
    JOIN public.profiles p             ON p.id = wa.user_id
   WHERE n.scope = 'wing'
     AND p.institution_id = n.institution_id
     AND p.is_active IS NOT FALSE

  UNION ALL

  SELECT n.id, p.id,
         COALESCE((SELECT ur.role::text FROM public.user_roles ur
                    WHERE ur.user_id = p.id
                      AND ur.role::text IN ('coordinator','teacher','student')
                    ORDER BY CASE ur.role::text
                               WHEN 'coordinator' THEN 1
                               WHEN 'teacher'     THEN 2
                               ELSE 3 END
                    LIMIT 1), 'student'),
         'audience_role'
    FROM public.notices n
    JOIN public.profiles p ON p.institution_id = n.institution_id
   WHERE n.scope = 'institution'
     AND p.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = p.id
                    AND ur.role::text IN ('coordinator','teacher','student'))
) c
JOIN public.notices n2 ON n2.id = c.notice_id
WHERE c.user_id <> n2.published_by
ORDER BY c.notice_id, c.user_id,
         CASE c.recipient_role
           WHEN 'coordinator' THEN 1
           WHEN 'teacher'     THEN 2
           ELSE 3 END
ON CONFLICT (notice_id, user_id) DO NOTHING;

-- Merge the legacy acknowledgements. An acknowledgement implies a read.
--
-- 2 of the 3 were made by the notice's own author. An author is never their own
-- recipient -- notice_expand_audience guarantees that for every new notice --
-- so reintroducing them here would leave the table permanently inconsistent
-- with the rule the rest of the system relies on. Those 2 self-acks are dropped
-- and 1 real acknowledgement survives.
--
-- A legacy acker who is not otherwise in the expanded audience (roster drift
-- since they acked) is still inserted, because their signal is real data.
INSERT INTO public.notice_recipients (notice_id, user_id, recipient_role, added_reason, read_at, acknowledged_at)
SELECT ca.circular_id, ca.user_id, 'student', 'audience_role', ca.acknowledged_at, ca.acknowledged_at
  FROM public.circular_acknowledgements ca
  JOIN public.notices n ON n.id = ca.circular_id
 WHERE ca.user_id <> n.published_by
ON CONFLICT (notice_id, user_id) DO UPDATE
  SET read_at         = COALESCE(public.notice_recipients.read_at, EXCLUDED.read_at),
      acknowledged_at = COALESCE(public.notice_recipients.acknowledged_at, EXCLUDED.acknowledged_at);

UPDATE public.notices n
   SET recipient_count = (SELECT count(*) FROM public.notice_recipients r WHERE r.notice_id = n.id);

DROP TABLE public.circular_acknowledgements;

ALTER TABLE public.notices
  DROP COLUMN target_class_id,
  DROP COLUMN target_wing_id;

COMMIT;
