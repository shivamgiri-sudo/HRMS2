-- Migration 1214: add period_code to billing_provision_snapshot
-- billing_provision_snapshot comes from db_bill.provision_master via the sync script.
-- It stores finance_year ("2026-27") + month_label ("Jul-26") but no derived period_code,
-- which forces every PnL query that needs to filter by month to do a runtime CASE expression.
-- Adding period_code once (here + in the sync script) makes the revenue UNION efficient and
-- lets the index on (period_code, cost_centre_code) serve all PnL revenue lookups.

ALTER TABLE billing_provision_snapshot
  ADD COLUMN period_code CHAR(7) NULL AFTER month_label,
  ADD INDEX idx_bps_period_cc (period_code, cost_centre_code);

-- Back-fill all existing rows from finance_year + month_label.
-- Finance year "YYYY-YY": Apr-Sep belong to the first calendar year; Oct-Mar to year+1.
UPDATE billing_provision_snapshot
SET period_code = CASE LEFT(month_label, 3)
  WHEN 'Apr' THEN CONCAT(SUBSTRING(finance_year, 1, 4), '-04')
  WHEN 'May' THEN CONCAT(SUBSTRING(finance_year, 1, 4), '-05')
  WHEN 'Jun' THEN CONCAT(SUBSTRING(finance_year, 1, 4), '-06')
  WHEN 'Jul' THEN CONCAT(SUBSTRING(finance_year, 1, 4), '-07')
  WHEN 'Aug' THEN CONCAT(SUBSTRING(finance_year, 1, 4), '-08')
  WHEN 'Sep' THEN CONCAT(SUBSTRING(finance_year, 1, 4), '-09')
  WHEN 'Oct' THEN CONCAT(CAST(SUBSTRING(finance_year, 1, 4) AS UNSIGNED) + 1, '-10')
  WHEN 'Nov' THEN CONCAT(CAST(SUBSTRING(finance_year, 1, 4) AS UNSIGNED) + 1, '-11')
  WHEN 'Dec' THEN CONCAT(CAST(SUBSTRING(finance_year, 1, 4) AS UNSIGNED) + 1, '-12')
  WHEN 'Jan' THEN CONCAT(CAST(SUBSTRING(finance_year, 1, 4) AS UNSIGNED) + 1, '-01')
  WHEN 'Feb' THEN CONCAT(CAST(SUBSTRING(finance_year, 1, 4) AS UNSIGNED) + 1, '-02')
  WHEN 'Mar' THEN CONCAT(CAST(SUBSTRING(finance_year, 1, 4) AS UNSIGNED) + 1, '-03')
  ELSE NULL
END
WHERE period_code IS NULL;
