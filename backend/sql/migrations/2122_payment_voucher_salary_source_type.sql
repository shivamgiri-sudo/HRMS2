-- 2122_payment_voucher_salary_source_type.sql
--
-- Adds 'salary' as a payment_voucher purpose (source_type). Same lane as 'general'
-- (Dr Payable Account / Cr Bank) but its own type so lists and reports can tell salary
-- payments apart. Current ENUM is 1837_payment_voucher_internal_transfer.sql's.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COLUMN_TYPE NOT LIKE '%''salary''%',
    "ALTER TABLE payment_voucher MODIFY COLUMN source_type ENUM('vendor_grn','imprest_allocation','sales_receipt','general','vendor_advance','vendor_advance_application','internal_transfer','salary') NOT NULL",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'source_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '2122_payment_voucher_salary_source_type.sql applied' AS migration_status;
