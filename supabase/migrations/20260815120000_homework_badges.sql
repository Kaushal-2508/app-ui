-- Homework badges: four rungs in Quest Log.
--
-- Homework was already one of the three activities that keep a streak alive
-- (trg_log_homework_submitted writes user_activity_log), but nothing in the
-- catalog rewarded it. 636 submissions across 106 students had earned nothing.
--
-- NO "submitted on time" BADGE, deliberately. homework_submissions.is_late
-- exists, but every one of the 636 live rows has is_late = false, so an on-time
-- badge would award identically to the plain count badge and tell a student
-- nothing. Revisit if lateness ever starts being recorded.
--
-- WHY A SEPARATE FUNCTION rather than extending evaluate_student_badges():
-- that function is 800 lines and has been through three review passes. Adding a
-- scope to it means reproducing the whole body in a CREATE OR REPLACE, which is
-- exactly how a subtle regression gets introduced into verified SQL. This is
-- additive: a new function, and a new trigger whose name sorts AFTER the
-- existing trg_log_homework_submitted so activity is still logged first.

-- ── 1. The badges ───────────────────────────────────────────────────────────
-- Rungs paced against real data (2026-08-15): 106 students have >= 1 submission,
-- 18 have >= 10, 4 have >= 25, none yet at 50. So the ladder starts inclusive
-- and still has a top nobody has reached.
INSERT INTO badge_definitions
  (name, description, icon_name, badge_type, category, tier,
   criteria_type, criteria_metric, criteria_value, points, is_active, display_order)
SELECT c.name, c.description, c.icon_name, 'student', 'quest_log', c.tier,
       'count', 'homework_submitted', c.criteria_value, c.points, true, c.display_order
FROM (VALUES
  ('Net Session',    'Hand in your first homework',        'notebook-pen',    'bronze',    1,  10, 116),
  ('Practice Squad', 'Hand in 10 pieces of homework',      'clipboard-check', 'silver',   10,  25, 117),
  ('Training Ground','Hand in 25 pieces of homework',      'dumbbell',        'gold',     25,  60, 118),
  ('Full Season',    'Hand in 50 pieces of homework',      'files',           'platinum', 50, 120, 119)
) AS c(name, description, icon_name, tier, criteria_value, points, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM badge_definitions bd
  WHERE bd.badge_type = 'student' AND bd.name = c.name
);

-- Re-assert configuration on re-run so a dashboard hand-edit cannot desync the
-- criteria from the evaluator that reads it. is_active is excluded: retiring a
-- badge is an admin decision and must survive a re-run.
UPDATE badge_definitions bd
SET description = c.description, icon_name = c.icon_name, category = 'quest_log',
    tier = c.tier, criteria_type = 'count', criteria_metric = 'homework_submitted',
    criteria_value = c.criteria_value, points = c.points, display_order = c.display_order,
    updated_at = now()
FROM (VALUES
  ('Net Session',    'Hand in your first homework',        'notebook-pen',    'bronze',    1,  10, 116),
  ('Practice Squad', 'Hand in 10 pieces of homework',      'clipboard-check', 'silver',   10,  25, 117),
  ('Training Ground','Hand in 25 pieces of homework',      'dumbbell',        'gold',     25,  60, 118),
  ('Full Season',    'Hand in 50 pieces of homework',      'files',           'platinum', 50, 120, 119)
) AS c(name, description, icon_name, tier, criteria_value, points, display_order)
WHERE bd.badge_type = 'student' AND bd.name = c.name
  AND (bd.description, bd.icon_name, bd.category, bd.tier, bd.criteria_type,
       bd.criteria_metric, bd.criteria_value, bd.points, bd.display_order)
      IS DISTINCT FROM
      (c.description, c.icon_name, 'quest_log', c.tier, 'count',
       'homework_submitted', c.criteria_value, c.points, c.display_order);

-- ── 2. The evaluator ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluate_homework_badges(_user_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_inst uuid;
  v_new_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;

  -- Count SUBMISSIONS, not activity-log days. The materials metric deliberately
  -- counts days (ten opens of one PDF in an afternoon is one day of revision),
  -- but three assignments handed in on one day is three pieces of homework, and
  -- "hand in 25" has to mean 25 assignments.
  SELECT count(*)::int INTO v_count
  FROM homework_submissions hs
  WHERE hs.student_id = _user_id;

  IF COALESCE(v_count, 0) = 0 THEN RETURN 0; END IF;

  SELECT p.institution_id INTO v_inst FROM profiles p WHERE p.id = _user_id;

  WITH ins AS (
    INSERT INTO user_badges (user_id, badge_id, institution_id, source_entity_type, metadata)
    SELECT _user_id, bd.id, v_inst, 'homework_submitted',
           jsonb_build_object('count', v_count)
    FROM badge_definitions bd
    WHERE bd.is_active
      AND bd.badge_type = 'student'
      AND bd.criteria_metric = 'homework_submitted'
      AND v_count >= bd.criteria_value
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_new_ids FROM ins;

  -- Progress for the rungs not yet reached, so the tile shows "10 of 25"
  -- instead of a bar frozen at zero.
  INSERT INTO badge_progress
    (user_id, badge_id, institution_id, current_value, target_value, last_updated)
  SELECT _user_id, bd.id, v_inst, v_count, bd.criteria_value, now()
  FROM badge_definitions bd
  WHERE bd.is_active
    AND bd.badge_type = 'student'
    AND bd.criteria_metric = 'homework_submitted'
  ON CONFLICT (user_id, badge_id) DO UPDATE
    SET current_value = EXCLUDED.current_value,
        target_value = EXCLUDED.target_value,
        institution_id = EXCLUDED.institution_id,
        last_updated = now();

  -- Notifications in their OWN subtransaction, after the award has landed. When
  -- these shared a statement with the award, a notifications failure rolled the
  -- award back with it, so the notification path could revoke a badge.
  IF array_length(v_new_ids, 1) IS NOT NULL THEN
    BEGIN
      INSERT INTO notifications (user_id, type, title, message, link, metadata)
      SELECT ub.user_id, 'badge_earned',
             'Badge earned: ' || bd.name,
             'You earned the "' || bd.name || '" badge (+' || bd.points || ' points).',
             '/achievements',
             jsonb_build_object('badge_id', bd.id, 'badge_name', bd.name, 'points', bd.points)
      FROM user_badges ub
      JOIN badge_definitions bd ON bd.id = ub.badge_id
      WHERE ub.id = ANY (v_new_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'evaluate_homework_badges: awards committed, notifications failed: %', SQLERRM;
    END;
  END IF;

  RETURN COALESCE(array_length(v_new_ids, 1), 0);
END $$;

-- ── 3. Trigger ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_award_homework_badges()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Contained: a badge fault must never roll back a student's homework
  -- submission. The submission is the thing that matters.
  BEGIN
    PERFORM public.evaluate_homework_badges(NEW.student_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_award_homework_badges failed for %: %', NEW.student_id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_award_homework_badges ON homework_submissions;
-- Named trg_zz_* on purpose: Postgres fires same-timing triggers in alphabetical
-- order by NAME, so this runs after trg_log_homework_submitted and the day's
-- activity row already exists.
CREATE TRIGGER trg_zz_award_homework_badges
AFTER INSERT ON homework_submissions
FOR EACH ROW EXECUTE FUNCTION public.tg_award_homework_badges();

-- ── 4. Backfill ─────────────────────────────────────────────────────────────
-- Students earned these before the badges existed. Awarding retroactively is
-- the honest outcome; the alternative is telling someone with 30 submissions
-- that they have not handed in any homework.
DO $$
DECLARE r record; v_total int := 0;
BEGIN
  FOR r IN SELECT DISTINCT student_id FROM homework_submissions WHERE student_id IS NOT NULL LOOP
    v_total := v_total + public.evaluate_homework_badges(r.student_id);
  END LOOP;
  RAISE NOTICE 'homework badge backfill awarded % badges', v_total;
END $$;

-- Server-only. FROM PUBLIC first: Supabase grants EXECUTE to PUBLIC on every new
-- public function and anon inherits through it, so revoking the role by name
-- alone leaves the function callable (see 20260813145000).
REVOKE ALL ON FUNCTION public.evaluate_homework_badges(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_award_homework_badges() FROM PUBLIC, anon, authenticated;
