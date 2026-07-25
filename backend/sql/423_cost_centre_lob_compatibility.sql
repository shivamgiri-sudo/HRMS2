-- 423_cost_centre_lob_compatibility.sql
-- Older installations use cc_code / cc_name while newer Finance services read
-- cost_centre_code / cost_centre_name. Add and backfill the canonical aliases so
-- Process/LOB P&L and GRN attribution are portable across both schema histories.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_centre_master'
      AND column_name = 'cost_centre_code') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN cost_centre_code VARCHAR(50) NULL AFTER cc_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_centre_master'
      AND column_name = 'cost_centre_name') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN cost_centre_name VARCHAR(160) NULL AFTER cc_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cc_code = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'cost_centre_master'
     AND column_name = 'cc_code'
);
SET @sql = IF(
  @has_cc_code > 0,
  'UPDATE cost_centre_master SET cost_centre_code = COALESCE(NULLIF(cost_centre_code, ''''), cc_code) WHERE cost_centre_code IS NULL OR cost_centre_code = ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cc_name = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'cost_centre_master'
     AND column_name = 'cc_name'
);
SET @sql = IF(
  @has_cc_name > 0,
  'UPDATE cost_centre_master SET cost_centre_name = COALESCE(NULLIF(cost_centre_name, ''''), cc_name) WHERE cost_centre_name IS NULL OR cost_centre_name = ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_code = (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'cost_centre_master'
     AND index_name = 'idx_cost_centre_canonical_code'
);
SET @sql = IF(
  @idx_code = 0,
  'ALTER TABLE cost_centre_master ADD INDEX idx_cost_centre_canonical_code (cost_centre_code)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '423_cost_centre_lob_compatibility.sql applied' AS migration_status;
