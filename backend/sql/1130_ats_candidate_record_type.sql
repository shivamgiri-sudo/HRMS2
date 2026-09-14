-- 1130_ats_candidate_record_type.sql
--
-- Gives ats_candidate the provenance column it never got.
--
-- WHY
--   ats_candidate holds 37,686 rows, of which 29,926 are legacy EMPLOYEE records whose
--   candidate_code exactly matches a real employees.employee_code. Only 7,760 are genuine
--   candidates. Measured against production 2026-08-11.
--
--   Nothing marks which is which. There is no source_type, no is_legacy, no imported_at, and
--   created_at gives no signal either — 33,577 rows landed in one bulk import in 2026-06. The
--   only reliable test is a correlated NOT EXISTS against employees, which
--   excludeEmployeeShapedCandidatesSql() emits and which roughly twenty query sites now repeat.
--
--   employees and candidate_onboarding_profile both received source_type/source in migrations
--   052 and 062. ats_candidate — the table that actually got polluted — never did.
--
--   status='Inactive' is NOT a usable proxy, which is worth recording because it looks like
--   one. Confusion matrix against the real join:
--       legacy   & Inactive  28,727      genuine & Inactive   2,626   <- would be wrongly dropped
--       legacy   & other      1,199      genuine & other      5,134   <- would be wrongly kept
--
-- BEHAVIOUR
--   Purely additive and inert. Every existing row takes the DEFAULT 'candidate', which is
--   deliberately WRONG for the 29,926 legacy rows until the backfill runs.
--
--   *** DO NOT point excludeEmployeeShapedCandidatesSql() at this column yet. ***
--   Doing so before scripts/ats-candidate-record-type-backfill.mjs has run on production would
--   mark every legacy row as a genuine candidate and silently undo every exclusion fixed this
--   week. The order is: this migration -> backfill (expect exactly 29,926) -> then switch the
--   helper, in a separate change.
--
--   The default is 'candidate' rather than NULL or 'unknown' so that new rows written by the
--   registration and bulk-import paths are correct without those paths changing: everything
--   inserted from now on genuinely is a candidate. Only the historical import is misdescribed,
--   and only until the backfill.
--
-- IDEMPOTENCY
--   MySQL 8.0 rejects `ADD COLUMN IF NOT EXISTS` (MariaDB syntax) with ER_PARSE_ERROR, so the
--   column and the index are each guarded through information_schema and PREPARE, one
--   statement at a time. 509_portal_client_master_fixes lost its tail because eleven columns
--   went in a single all-or-nothing ALTER that failed ER_DUP_FIELDNAME partway.

-- ats_candidate.record_type
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'ats_candidate'
              AND column_name = 'record_type');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ats_candidate ADD COLUMN record_type VARCHAR(20) NOT NULL DEFAULT ''candidate'' COMMENT ''candidate | legacy_employee — provenance, backfilled from candidate_code = employees.employee_code''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index it: the whole point is to replace a correlated NOT EXISTS over 30k rows with a cheap
-- indexed predicate. Guarded separately from the column above so a re-run cannot fail here.
SET @i := (SELECT COUNT(1) FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = 'ats_candidate'
              AND index_name = 'idx_ats_candidate_record_type');
SET @ddl := IF(@i = 0,
  'ALTER TABLE ats_candidate ADD INDEX idx_ats_candidate_record_type (record_type)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
