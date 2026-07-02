-- Cleanup Duplicate Salary Records
--
-- Issue: Multiple employees have TWO salary entries for the same month
-- Cause: Old system records + Auto-sync records
-- Solution: Keep the HIGHER salary (from db_bill auto-sync), delete the LOWER salary (old system)
--
-- Run Date: 2026-06-12
-- Author: Claude Sonnet 4.5

USE mas_hrms;

-- Step 1: Identify all duplicates
SELECT 'Step 1: Identifying duplicates...' as status;

CREATE TEMPORARY TABLE IF NOT EXISTS duplicate_entries AS
SELECT
    spl.employee_code,
    spr.run_month,
    COUNT(*) as entry_count,
    MIN(spl.gross_salary) as min_gross,
    MAX(spl.gross_salary) as max_gross,
    -- Get the ID of the record with LOWER salary (to delete)
    (SELECT spl2.id
     FROM salary_prep_line spl2
     JOIN salary_prep_run spr2 ON spr2.id = spl2.run_id
     WHERE spl2.employee_code = spl.employee_code
     AND spr2.run_month = spr.run_month
     ORDER BY spl2.gross_salary ASC
     LIMIT 1) as old_record_id,
    -- Get the ID of the record with HIGHER salary (to keep)
    (SELECT spl2.id
     FROM salary_prep_line spl2
     JOIN salary_prep_run spr2 ON spr2.id = spl2.run_id
     WHERE spl2.employee_code = spl.employee_code
     AND spr2.run_month = spr.run_month
     ORDER BY spl2.gross_salary DESC
     LIMIT 1) as new_record_id
FROM salary_prep_line spl
JOIN salary_prep_run spr ON spr.id = spl.run_id
GROUP BY spl.employee_code, spr.run_month
HAVING COUNT(*) > 1;

-- Show summary
SELECT
    COUNT(DISTINCT employee_code) as affected_employees,
    COUNT(*) as duplicate_month_entries,
    SUM(entry_count - 1) as records_to_delete
FROM duplicate_entries;

-- Show sample of what will be deleted
SELECT
    de.employee_code,
    de.run_month,
    de.min_gross as old_gross_to_delete,
    de.max_gross as new_gross_to_keep,
    de.entry_count
FROM duplicate_entries de
ORDER BY de.employee_code
LIMIT 10;

-- Step 2: Delete components of old records
SELECT 'Step 2: Deleting components of old records...' as status;

DELETE splc
FROM salary_prep_line_component splc
WHERE splc.line_id IN (
    SELECT old_record_id FROM duplicate_entries
);

SELECT CONCAT('Deleted ', ROW_COUNT(), ' component records') as result;

-- Step 3: Delete old salary_prep_line records
SELECT 'Step 3: Deleting old salary_prep_line records...' as status;

DELETE spl
FROM salary_prep_line spl
WHERE spl.id IN (
    SELECT old_record_id FROM duplicate_entries
);

SELECT CONCAT('Deleted ', ROW_COUNT(), ' salary_prep_line records') as result;

-- Step 4: Verify no duplicates remain
SELECT 'Step 4: Verifying cleanup...' as status;

SELECT
    employee_code,
    run_month,
    COUNT(*) as remaining_count
FROM salary_prep_line spl
JOIN salary_prep_run spr ON spr.id = spl.run_id
GROUP BY employee_code, run_month
HAVING COUNT(*) > 1
LIMIT 5;

SELECT
    CASE
        WHEN COUNT(*) = 0 THEN 'SUCCESS: No duplicates remain!'
        ELSE CONCAT('WARNING: Still ', COUNT(*), ' duplicates found')
    END as cleanup_status
FROM (
    SELECT employee_code, run_month
    FROM salary_prep_line spl
    JOIN salary_prep_run spr ON spr.id = spl.run_id
    GROUP BY employee_code, run_month
    HAVING COUNT(*) > 1
) remaining_dupes;

-- Step 5: Summary report
SELECT 'Step 5: Final Summary' as status;

SELECT
    COUNT(DISTINCT spl.employee_code) as total_employees_with_salary,
    COUNT(DISTINCT CONCAT(spl.employee_code, '-', spr.run_month)) as total_employee_months,
    COUNT(*) as total_salary_records,
    SUM(CASE WHEN comp_count > 0 THEN 1 ELSE 0 END) as records_with_components
FROM salary_prep_line spl
JOIN salary_prep_run spr ON spr.id = spl.run_id
LEFT JOIN (
    SELECT line_id, COUNT(*) as comp_count
    FROM salary_prep_line_component
    GROUP BY line_id
) comp ON comp.line_id = spl.id;

-- Cleanup temp table
DROP TEMPORARY TABLE IF EXISTS duplicate_entries;

SELECT '========================================' as status;
SELECT 'Cleanup Complete!' as status;
SELECT '========================================' as status;
