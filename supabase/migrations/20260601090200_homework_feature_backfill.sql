-- =====================================================================
-- Homework & Assignment — Phase 1: enable 'homework' feature (default-on)
-- for all existing institutions. New institutions follow the existing
-- per-institution enablement flow (EditInstitutionDialog).
-- =====================================================================
INSERT INTO public.institution_features (institution_id, feature_id, is_enabled)
SELECT id, 'homework', true
FROM public.institutions
ON CONFLICT (institution_id, feature_id) DO NOTHING;
