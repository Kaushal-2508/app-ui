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
           (SELECT to_jsonb(op) FROM (
              SELECT pr.period_index, pr.period_start, pr.period_end,
                     pr.target_value, pr.achieved_value, pr.status
              FROM public.teacher_target_periods pr
              WHERE pr.target_id = tt.id AND pr.status = 'open'
              ORDER BY pr.period_index DESC LIMIT 1
            ) op)                                    AS open_period
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
           (SELECT to_jsonb(op) FROM (
              SELECT pr.period_index, pr.period_start, pr.period_end,
                     pr.target_value, pr.achieved_value, pr.status
              FROM public.teacher_target_periods pr
              WHERE pr.target_id = tt.id AND pr.status = 'open'
              ORDER BY pr.period_index DESC LIMIT 1
            ) op)                                     AS open_period,
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
