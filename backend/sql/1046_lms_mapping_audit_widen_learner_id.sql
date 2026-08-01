-- 1046_lms_mapping_audit_widen_learner_id.sql
--
-- lms_mapping_audit.lms_employee_id is varchar(20) but receives an LMS learner id, which is
-- varchar(128) at its source (lms_employee_mapping.lms_learner_id).
--
-- SYMPTOM (production workers log): "Data too long for column 'lms_employee_id' at row 1",
-- 9 occurrences. Surfaced by the DB-layer error logging added in c0cca121 — before that it
-- was swallowed and the audit row was simply lost.
--
-- HONEST NOTE ON CAUSE
-- This became reachable because of migration 1037. Until then the mapper threw
-- ER_BAD_FIELD_ERROR on lms_employee_mapping before it ever wrote an audit row, so this
-- narrower column was never exercised. Fixing 1037 let the mapper run further and hit the
-- next defect. That is progress, not regression, but it is worth recording that the second
-- error was created by fixing the first.
--
-- WHY 128 AND NOT SOMETHING SMALLER
-- It matches the source column exactly. The longest learner id currently stored is 17
-- characters, so 20 was adequate for the ids that happened to map — the failures are ids
-- that did NOT map, which is precisely what an audit table exists to record. Sizing to the
-- observed maximum would reintroduce the bug for the next unusual id.
--
-- tried_employee_code is left at varchar(20) deliberately: it holds an HRMS employee_code,
-- which is genuinely short, not an LMS identifier.
--
-- SAFETY: widening a varchar is an in-place metadata change in MySQL 8 for this size class;
-- no row is rewritten and no value can be truncated. 17,264 existing rows are unaffected.

SET NAMES utf8mb4;

ALTER TABLE lms_mapping_audit
  MODIFY COLUMN lms_employee_id VARCHAR(128) NULL
  COMMENT 'LMS learner id as supplied by the LMS; matches lms_employee_mapping.lms_learner_id width';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Column is wide enough for any LMS id:
--   SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='lms_mapping_audit'
--      AND COLUMN_NAME='lms_employee_id';        -- expect varchar(128)
--
-- Nothing lost:
--   SELECT COUNT(*) FROM lms_mapping_audit;      -- expect 17,264 or more
--
-- The real proof is the workers log going quiet on the next lms-sync cycle:
--   pm2 logs hrms2-workers --err --lines 200 --nostream | grep "lms_employee_id"
--
-- ---------------------------------------------------------------------------
-- ROLLBACK  (would re-introduce the truncation)
-- ---------------------------------------------------------------------------
-- ALTER TABLE lms_mapping_audit MODIFY COLUMN lms_employee_id VARCHAR(20) NULL;
