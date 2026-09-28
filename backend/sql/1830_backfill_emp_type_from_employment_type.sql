-- 1827_backfill_emp_type_from_employment_type.sql
--
-- emp_type is a legacy VARCHAR column that was never written by any current
-- code path. Every employee onboarded via the ATS offer flow, manual create,
-- or bulk upload has emp_type = NULL even though employment_type holds the
-- correct value (OnRoll, MGMT. TRAINEE, OffRoll, etc.).
--
-- This migration backfills emp_type from employment_type for all rows where
-- emp_type IS NULL, and normalises the value to the two strings db_bill
-- recognises: ONROLL and MGMT. TRAINEE (plus OFFROLL for off-roll staff).
-- Going forward, all four write paths (ATS orchestrator, manual create,
-- manual update, bulk upload) now keep both columns in sync.

UPDATE employees
   SET emp_type = CASE
         WHEN UPPER(employment_type) LIKE '%MGMT%' THEN 'MGMT. TRAINEE'
         WHEN UPPER(employment_type) LIKE '%OFF%'  THEN 'OFFROLL'
         ELSE 'ONROLL'
       END
 WHERE emp_type IS NULL
   AND employment_type IS NOT NULL;

SELECT CONCAT('1827: backfilled emp_type for ', ROW_COUNT(), ' rows') AS migration_status;
