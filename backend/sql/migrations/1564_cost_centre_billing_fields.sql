-- Add billing config fields to cost_centre_master (optional, for future cost centers)

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='current_mandate') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN current_mandate INT DEFAULT 0',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='working_days_per_week') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN working_days_per_week INT DEFAULT 6',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='billing_days_per_month') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN billing_days_per_month INT DEFAULT 26',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='hours_per_fte_per_day') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN hours_per_fte_per_day DECIMAL(4,2) DEFAULT 8.00',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='billing_type') = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN billing_type VARCHAR(20) DEFAULT ''seat''',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SELECT '1564_cost_centre_billing_fields.sql applied' AS status;
