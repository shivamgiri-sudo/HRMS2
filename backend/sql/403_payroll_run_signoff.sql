-- Migration 403: Finance + CEO Sign-Off columns for salary_prep_run
-- Additive only — safe to run on existing schema.

SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'finance_approved_by'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN finance_approved_by  VARCHAR(36)  NULL COMMENT ''User ID who gave finance approval''',
  'SELECT "finance_approved_by already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'finance_approved_at'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN finance_approved_at  DATETIME     NULL COMMENT ''Timestamp of finance approval''',
  'SELECT "finance_approved_at already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'finance_remarks'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN finance_remarks      TEXT         NULL COMMENT ''Optional remarks from finance approver''',
  'SELECT "finance_remarks already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'ceo_acknowledged_by'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN ceo_acknowledged_by  VARCHAR(36)  NULL COMMENT ''User ID who gave CEO acknowledgement''',
  'SELECT "ceo_acknowledged_by already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'ceo_acknowledged_at'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN ceo_acknowledged_at  DATETIME     NULL COMMENT ''Timestamp of CEO acknowledgement''',
  'SELECT "ceo_acknowledged_at already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'ceo_remarks'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN ceo_remarks          TEXT         NULL COMMENT ''Optional remarks from CEO''',
  'SELECT "ceo_remarks already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

-- Seed CEO acknowledgement threshold into payroll_config_flags if not already present.
-- Default: 5,000,000 (₹50 lakhs).  Admins can update this row at any time.
INSERT IGNORE INTO payroll_config_flags (config_key, config_value, description, updated_by)
VALUES ('ceo_ack_threshold', '5000000', 'Minimum total net salary (INR) that requires CEO sign-off before disbursement', 'system');
