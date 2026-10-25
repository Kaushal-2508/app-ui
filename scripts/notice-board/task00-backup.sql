-- Notice Board Task 0: snapshot every legacy row before anything destructive.
-- Task 2 drops circular_acknowledgements and three columns; Task 6 rewrites the
-- feature flag. These tables are the only rollback path.
BEGIN;

DROP TABLE IF EXISTS salci_backups.nb_circulars_20260822;
DROP TABLE IF EXISTS salci_backups.nb_circ_acks_20260822;
DROP TABLE IF EXISTS salci_backups.nb_inst_features_20260822;

CREATE TABLE salci_backups.nb_circulars_20260822      AS SELECT * FROM public.circulars;
CREATE TABLE salci_backups.nb_circ_acks_20260822      AS SELECT * FROM public.circular_acknowledgements;
CREATE TABLE salci_backups.nb_inst_features_20260822  AS
  SELECT * FROM public.institution_features WHERE feature_id = 'circulars';

COMMIT;

SELECT
  (SELECT count(*) FROM salci_backups.nb_circulars_20260822)     AS circulars_backed_up,
  (SELECT count(*) FROM salci_backups.nb_circ_acks_20260822)     AS acks_backed_up,
  (SELECT count(*) FROM salci_backups.nb_inst_features_20260822) AS flags_backed_up;
