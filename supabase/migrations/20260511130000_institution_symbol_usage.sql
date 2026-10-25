-- =============================================================
-- institution_symbol_usage — per-institution counter for the
-- math/special-symbol picker, used to surface a "Frequently used"
-- page-0 in the picker.
--
-- Writes happen only for teachers (they are the question authors
-- the recommendation is meant to learn from). Reads are open to
-- any authenticated user inside the institution so admins /
-- coordinators creating questions also see the same suggestions.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.institution_symbol_usage (
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  symbol         TEXT NOT NULL,
  usage_count    BIGINT NOT NULL DEFAULT 0,
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, symbol)
);

CREATE INDEX IF NOT EXISTS institution_symbol_usage_top_idx
  ON public.institution_symbol_usage (institution_id, usage_count DESC, last_used_at DESC);

ALTER TABLE public.institution_symbol_usage ENABLE ROW LEVEL SECURITY;

-- Read counts for your own institution. Writes always go through
-- record_symbol_usage() below (SECURITY DEFINER), so no INSERT/
-- UPDATE/DELETE policies are needed.
DROP POLICY IF EXISTS "Users read their institution symbol usage"
  ON public.institution_symbol_usage;

CREATE POLICY "Users read their institution symbol usage"
ON public.institution_symbol_usage
FOR SELECT
TO authenticated
USING (
  institution_id IN (
    SELECT p.institution_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);

-- =============================================================
-- record_symbol_usage — teacher-only counter increment.
--
-- Resolves the caller's institution from profiles, no-ops for
-- anyone who isn't a teacher (admins, coordinators, students),
-- and on conflict bumps the counter atomically. Returns void so
-- the client can fire-and-forget without awaiting.
-- =============================================================

CREATE OR REPLACE FUNCTION public.record_symbol_usage(p_symbol TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_institution UUID;
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;
  IF p_symbol IS NULL OR length(p_symbol) = 0 OR length(p_symbol) > 32 THEN
    RETURN;
  END IF;

  IF NOT public.has_role(v_user, 'teacher'::public.app_role) THEN
    RETURN;
  END IF;

  SELECT institution_id INTO v_institution
  FROM public.profiles
  WHERE id = v_user;

  IF v_institution IS NULL THEN RETURN; END IF;

  INSERT INTO public.institution_symbol_usage AS u
    (institution_id, symbol, usage_count, last_used_at)
  VALUES (v_institution, p_symbol, 1, now())
  ON CONFLICT (institution_id, symbol)
  DO UPDATE SET
    usage_count  = u.usage_count + 1,
    last_used_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_symbol_usage(TEXT) TO authenticated;

-- =============================================================
-- get_top_institution_symbols — read top N symbols for caller's
-- institution. Returns empty set on cold start (no rows yet) so
-- the picker can hide the Frequently-used page in that case.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_top_institution_symbols(p_limit INT DEFAULT 8)
RETURNS TABLE (
  symbol       TEXT,
  usage_count  BIGINT,
  last_used_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_institution UUID;
  v_limit       INT  := GREATEST(1, LEAST(COALESCE(p_limit, 8), 32));
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;

  SELECT institution_id INTO v_institution
  FROM public.profiles
  WHERE id = v_user;

  IF v_institution IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT u.symbol, u.usage_count, u.last_used_at
  FROM public.institution_symbol_usage u
  WHERE u.institution_id = v_institution
  ORDER BY u.usage_count DESC, u.last_used_at DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_institution_symbols(INT) TO authenticated;
