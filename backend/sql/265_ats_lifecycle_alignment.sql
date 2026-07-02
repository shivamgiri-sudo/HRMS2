-- Additive lifecycle alignment support. Safe to run repeatedly.

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ats_candidate ADD COLUMN offer_performance_incentive VARCHAR(255) NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_candidate'
    AND COLUMN_NAME = 'offer_performance_incentive'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status)
VALUES
  ('ATS_PAYROLL_HR', 'ATS Payroll HR', 'ATS', '/ats/payroll-hr', 'Payroll HR salary slab validation for selected candidates', 1),
  ('ATS_BRANCH_HEAD_APPROVAL', 'Branch Head Approval', 'ATS', '/ats/offer-approvals', 'Branch head offer and salary approval queue', 1)
ON DUPLICATE KEY UPDATE
  page_path = VALUES(page_path),
  active_status = 1;
