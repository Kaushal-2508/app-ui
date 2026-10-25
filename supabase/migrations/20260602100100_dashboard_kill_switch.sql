-- Dashboard rebuild Phase 1 — Task 2
-- Backend-only kill switch for adoption (AD*) flags. Default ON. Additive.

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS dashboard_adoption_flags_enabled boolean NOT NULL DEFAULT true;
