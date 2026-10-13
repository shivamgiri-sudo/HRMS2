-- Migration 2161: covering index for the tracker's coverage scan.
--
-- Live EXPLAIN (2026-10-12): the committed-batch -> import-row join reads ~4.5k rows per batch through
-- idx_batch and fetches each row from the table just to test roster_date / employee_id_raw (12.7s).
-- (batch_id, roster_date, employee_id_raw) answers the whole scan from the index.
-- Additive and idempotent.

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_rir_batch_date_emp ON wfm_roster_import_row (batch_id, roster_date, employee_id_raw)', 'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'wfm_roster_import_row' AND index_name = 'idx_rir_batch_date_emp');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
