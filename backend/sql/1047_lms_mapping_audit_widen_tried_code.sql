-- 1047_lms_mapping_audit_widen_tried_code.sql
--
-- Corrects a judgement I got wrong in 1046, and the data is what corrected it.
--
-- 1046 widened lms_mapping_audit.lms_employee_id to varchar(128) and stated explicitly:
--     "tried_employee_code is left at varchar(20) deliberately: it holds an HRMS
--      employee_code, which is genuinely short, not an LMS identifier."
--
-- That reasoning was wrong. Within a minute of the fix deploying, production logged three
-- more truncations — this time "Data too long for column 'tried_employee_code'".
--
-- The mistake was assuming the column holds what it is NAMED after. It does not. This is an
-- audit table: it records what the mapper TRIED, and what it tries is the identifier the LMS
-- supplied, before any match has been established. An LMS-side value has no obligation to
-- look like an HRMS employee_code.
--
-- The measurements agree: the longest employees.employee_code is 11 characters, and the
-- longest value already stored here is 8 — capped by varchar(20), which is exactly why the
-- long ones were being lost rather than recorded. The failures are the interesting rows.
--
-- Widened to varchar(128) to match lms_employee_id and the LMS learner id at source. Sizing
-- an audit column to what has successfully fitted so far guarantees it keeps silently
-- dropping the cases worth auditing.
--
-- SAFETY: widening a varchar is an in-place metadata change for this size class; no row is
-- rewritten and no value can be truncated. Existing rows are unaffected.

SET NAMES utf8mb4;

ALTER TABLE lms_mapping_audit
  MODIFY COLUMN tried_employee_code VARCHAR(128) NULL
  COMMENT 'Identifier the mapper attempted, as supplied by the LMS — not necessarily an HRMS employee_code';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
--   SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='lms_mapping_audit'
--      AND COLUMN_NAME IN ('lms_employee_id','tried_employee_code');
--   -- expect varchar(128) for both
--
-- The proof is the workers log going quiet on the next lms-sync cycle:
--   pm2 logs hrms2-workers --err --lines 200 --nostream | grep "Data too long"
--
-- ---------------------------------------------------------------------------
-- ROLLBACK  (would resume truncating the rows most worth auditing)
-- ---------------------------------------------------------------------------
-- ALTER TABLE lms_mapping_audit MODIFY COLUMN tried_employee_code VARCHAR(20) NULL;
