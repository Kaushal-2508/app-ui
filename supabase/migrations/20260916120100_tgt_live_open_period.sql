-- Teacher Targets: the OPEN period is computed live, not read from the ledger.
--
-- THE BUG. teacher_target_periods rows are written by the nightly evaluator, so
-- a target created today had NO period row until 00:35 UTC the next morning. The
-- teacher's card therefore said "No open period right now" for up to 24 hours,
-- and publishing an exam did not move the number until the following night.
-- Verified on Salci National: five live targets, zero period rows.
--
-- THE RULE NOW. The OPEN period is always computed live from tgt_periods() plus
-- the counters. CLOSED periods keep coming from the ledger, frozen, because both
-- source tables hard-delete with no tombstone and a closed number must never
-- move. tgt_open_period() encodes exactly that split: if the current period has
-- already been closed in the ledger it returns the frozen row, otherwise it
-- counts live.
--
-- The evaluator is still what CLOSES a period and sends the shortfall
-- notification. This only changes what "in progress" reads as.

-- Teacher Targets, part 5 of 7: the read API.
--
-- NAMING: `tgt_`, never `tt_` -- `tt_` is the Timetable module's namespace
-- (CLAUDE.md 7). This brief originally spelled these tt_targets_overview /
-- tt_my_targets; renamed before either shipped, matching Tasks 2-4.
--
-- Aggregation is server-side (Scale Gate item 2). The client never fetches
-- period rows to count or sum them. A wing's allocated total is a SUM over its
-- children computed here, never a stored second copy.
--
-- OWNERSHIP: tgt_targets_overview reuses tgt_owns_target(_user, tt.id) rather
-- than reimplementing the owner/pool-owner/assigner union inline. That helper
-- is already the single source of truth for "who may act on this row"
-- (Tasks 2 and 4); duplicating its logic here as a bespoke subquery would give
-- this read path its own, slightly different, definition of ownership (the
-- brief's original draft omitted the assigned_by branch) and the two would
-- silently drift the next time either changed.

CREATE OR REPLACE FUNCTION public.tgt_open_period(_target uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  t       public.teacher_targets%ROWTYPE;
  v_tz    text;
  v_today date;
  v_p     record;
BEGIN
  SELECT * INTO t FROM public.teacher_targets WHERE id = _target;
  -- Only scope='teacher' rows carry periods. A wing pool aggregates its children.
  IF t.id IS NULL OR t.scope <> 'teacher' THEN RETURN NULL; END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz
  FROM public.institutions i WHERE i.id = t.institution_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT p.period_index, p.period_start, p.period_end INTO v_p
  FROM public.tgt_periods(t.starts_on, t.ends_on, t.cadence_unit, t.cadence_n, t.ends_on) p
  WHERE v_today BETWEEN p.period_start AND p.period_end
  LIMIT 1;

  IF v_p.period_index IS NULL THEN RETURN NULL; END IF;

  RETURN COALESCE(
    (SELECT to_jsonb(x) FROM (
       SELECT pr.period_index, pr.period_start, pr.period_end,
              pr.target_value, pr.achieved_value, pr.status
       FROM public.teacher_target_periods pr
       WHERE pr.target_id = t.id AND pr.period_index = v_p.period_index
         AND pr.status <> 'open'
     ) x),
    (SELECT to_jsonb(y) FROM (
       SELECT v_p.period_index  AS period_index,
              v_p.period_start  AS period_start,
              v_p.period_end    AS period_end,
              t.target_value    AS target_value,
              CASE t.metric
                WHEN 'exams_published' THEN
                  public.tgt_count_exams_published(t.owner_id, t.institution_id, v_p.period_start, v_p.period_end)
                WHEN 'homework_published' THEN
                  public.tgt_count_homework_published(t.owner_id, t.institution_id, v_p.period_start, v_p.period_end, v_tz)
              END               AS achieved_value,
              'open'::text      AS status
     ) y)
  );
END $fn$;

REVOKE ALL ON FUNCTION public.tgt_open_period(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tgt_targets_overview(_metric text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_inst  uuid;
  v_admin boolean;
  v_out   jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_actor);
  IF v_inst IS NULL THEN RAISE EXCEPTION 'targets: no school context'; END IF;

  v_admin := EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = v_actor
                        AND ur.role IN ('school_admin','super_school_admin','super_admin'));

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT tt.id, tt.metric, tt.scope, tt.wing_id, tt.owner_id, tt.parent_target_id,
           tt.target_value, tt.starts_on, tt.ends_on, tt.cadence_unit, tt.cadence_n,
           tt.status, tt.note, tt.created_at,
           w.name                                    AS wing_name,
           p.full_name                               AS owner_name,
           -- allocated is NULL for a teacher target; for a pool it is the SUM
           -- of its children, which is how the "34 of 40" gap is computed.
           CASE WHEN tt.scope = 'wing' THEN (
             SELECT COALESCE(sum(c.target_value), 0)
             FROM public.teacher_targets c
             WHERE c.parent_target_id = tt.id AND c.status <> 'stopped'
           ) END                                     AS allocated,
           CASE WHEN tt.scope = 'wing' THEN (
             SELECT count(*) FROM public.teacher_targets c
             WHERE c.parent_target_id = tt.id AND c.status <> 'stopped'
           ) END                                     AS teacher_count,
           public.tgt_open_period(tt.id)                                    AS open_period
    FROM public.teacher_targets tt
    LEFT JOIN public.wings    w ON w.id = tt.wing_id
    LEFT JOIN public.profiles p ON p.id = tt.owner_id
    WHERE tt.institution_id = v_inst
      AND (_metric IS NULL OR tt.metric = _metric)
      AND (v_admin OR public.tgt_owns_target(v_actor, tt.id))
    ORDER BY tt.created_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object('ok', true, 'is_admin', v_admin, 'targets', v_out);
END $fn$;

-- The teacher's own view. ZERO arguments that could widen it: it returns only
-- the caller's rows and nobody else's name, number or rank.
CREATE OR REPLACE FUNCTION public.tgt_my_targets()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.starts_on DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT tt.id, tt.metric, tt.target_value, tt.starts_on, tt.ends_on,
           tt.cadence_unit, tt.cadence_n, tt.status, tt.note,
           public.tgt_open_period(tt.id)                                     AS open_period,
           (SELECT COALESCE(jsonb_agg(hp ORDER BY hp.period_index DESC), '[]'::jsonb)
              FROM (
                SELECT pr.period_index, pr.period_start, pr.period_end,
                       pr.target_value, pr.achieved_value, pr.status
                FROM public.teacher_target_periods pr
                WHERE pr.target_id = tt.id AND pr.status <> 'open'
                ORDER BY pr.period_index DESC LIMIT 24
              ) hp)                                   AS history
    FROM public.teacher_targets tt
    WHERE tt.owner_id = v_actor AND tt.scope = 'teacher'
    ORDER BY tt.starts_on DESC
    LIMIT 200
  ) t;

  RETURN jsonb_build_object('ok', true, 'targets', v_out);
END $fn$;

REVOKE ALL ON FUNCTION public.tgt_targets_overview(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tgt_my_targets()           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tgt_targets_overview(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tgt_my_targets()           TO authenticated;
