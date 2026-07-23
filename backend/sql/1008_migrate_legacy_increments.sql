-- ============================================================================
-- Migration 1008: Convert legacy_salary_snapshot → HRMS tables
-- Prerequisite: 1007_legacy_salary_snapshot.sql must be run first
-- Run from: Production server after snapshot is populated
-- ============================================================================

-- ============================================================================
-- Step 1: Create employee_salary_assignment rows from legacy snapshot
--
-- Logic: For each employee, create assignment rows ordered by effective_date
--        Set effective_to = next record's effective_from - 1 day
--        Latest record gets active_status = 1
-- ============================================================================

-- First, add effective_to column if not exists
ALTER TABLE employee_salary_assignment
ADD COLUMN IF NOT EXISTS effective_to DATE DEFAULT NULL AFTER effective_from;

-- Temporary table to hold ordered legacy records with row numbers
DROP TEMPORARY TABLE IF EXISTS tmp_legacy_ordered;
CREATE TEMPORARY TABLE tmp_legacy_ordered AS
SELECT
  lss.id AS legacy_id,
  lss.employee_code,
  e.id AS employee_id,
  lss.effective_date,
  lss.ctc_annual,
  lss.gross,
  lss.basic,
  lss.hra,
  ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY lss.effective_date ASC) AS rn,
  COUNT(*) OVER (PARTITION BY e.id) AS total_records
FROM legacy_salary_snapshot lss
JOIN employees e ON e.employee_code = lss.employee_code
WHERE lss.migrated_to_hrms = 0
  AND lss.ctc_annual > 0;

-- Get next effective date for each record
DROP TEMPORARY TABLE IF EXISTS tmp_legacy_with_next;
CREATE TEMPORARY TABLE tmp_legacy_with_next AS
SELECT
  t1.*,
  t2.effective_date AS next_effective_date
FROM tmp_legacy_ordered t1
LEFT JOIN tmp_legacy_ordered t2
  ON t1.employee_id = t2.employee_id
  AND t1.rn + 1 = t2.rn;

-- Insert into employee_salary_assignment
-- Skip if already exists for same employee + effective_from
INSERT INTO employee_salary_assignment (
  id,
  employee_id,
  structure_id,
  ctc_annual,
  effective_from,
  effective_to,
  active_status,
  created_at
)
SELECT
  UUID() AS id,
  t.employee_id,
  NULL AS structure_id,  -- Legacy records don't have structure
  t.ctc_annual,
  t.effective_date AS effective_from,
  CASE
    WHEN t.next_effective_date IS NOT NULL
    THEN DATE_SUB(t.next_effective_date, INTERVAL 1 DAY)
    ELSE NULL  -- Latest record has no end date
  END AS effective_to,
  CASE WHEN t.rn = t.total_records THEN 1 ELSE 0 END AS active_status,
  NOW() AS created_at
FROM tmp_legacy_with_next t
WHERE NOT EXISTS (
  SELECT 1 FROM employee_salary_assignment esa
  WHERE esa.employee_id = t.employee_id
    AND esa.effective_from = t.effective_date
);

-- ============================================================================
-- Step 2: Create salary_increment_request rows for each salary change
--
-- Logic: For each employee with multiple records, create increment request
--        linking previous assignment to new assignment
--        status = 'implemented', source = 'legacy'
-- ============================================================================

-- Insert increment requests for records after the first one (rn > 1)
INSERT INTO salary_increment_request (
  id,
  employee_id,
  current_assignment_id,
  new_assignment_id,
  current_ctc,
  proposed_ctc,
  increment_percentage,
  effective_from,
  reason_code,
  reason,
  status,
  source,
  implemented_at,
  created_at
)
SELECT
  UUID() AS id,
  curr.employee_id,
  prev_esa.id AS current_assignment_id,
  curr_esa.id AS new_assignment_id,
  prev.ctc_annual AS current_ctc,
  curr.ctc_annual AS proposed_ctc,
  CASE
    WHEN prev.ctc_annual > 0
    THEN ROUND(((curr.ctc_annual - prev.ctc_annual) / prev.ctc_annual) * 100, 4)
    ELSE 0
  END AS increment_percentage,
  curr.effective_date AS effective_from,
  'Legacy Migration' AS reason_code,
  'Migrated from db_bill legacy system' AS reason,
  'implemented' AS status,
  'legacy' AS source,
  NOW() AS implemented_at,
  NOW() AS created_at
FROM tmp_legacy_with_next curr
JOIN tmp_legacy_ordered prev
  ON curr.employee_id = prev.employee_id
  AND curr.rn = prev.rn + 1
LEFT JOIN employee_salary_assignment curr_esa
  ON curr_esa.employee_id = curr.employee_id
  AND curr_esa.effective_from = curr.effective_date
LEFT JOIN employee_salary_assignment prev_esa
  ON prev_esa.employee_id = prev.employee_id
  AND prev_esa.effective_from = prev.effective_date
WHERE curr.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM salary_increment_request sir
    WHERE sir.employee_id = curr.employee_id
      AND sir.effective_from = curr.effective_date
      AND sir.source = 'legacy'
  );

-- ============================================================================
-- Step 3: Mark legacy snapshot records as migrated
-- ============================================================================

UPDATE legacy_salary_snapshot lss
JOIN employees e ON e.employee_code = lss.employee_code
SET
  lss.migrated_to_hrms = 1,
  lss.migrated_at = NOW(),
  lss.migration_notes = 'Migrated to employee_salary_assignment and salary_increment_request'
WHERE lss.migrated_to_hrms = 0
  AND lss.ctc_annual > 0;

-- ============================================================================
-- Step 4: Deactivate old assignments, keep only latest active
-- ============================================================================

-- Ensure only the latest assignment per employee is active
UPDATE employee_salary_assignment esa
JOIN (
  SELECT employee_id, MAX(effective_from) AS max_effective
  FROM employee_salary_assignment
  GROUP BY employee_id
) latest ON esa.employee_id = latest.employee_id
SET esa.active_status = CASE
  WHEN esa.effective_from = latest.max_effective THEN 1
  ELSE 0
END;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Check migration counts
SELECT
  'legacy_salary_snapshot' AS tbl,
  COUNT(*) AS total,
  SUM(migrated_to_hrms) AS migrated
FROM legacy_salary_snapshot
UNION ALL
SELECT
  'employee_salary_assignment' AS tbl,
  COUNT(*) AS total,
  SUM(active_status) AS active
FROM employee_salary_assignment
UNION ALL
SELECT
  'salary_increment_request' AS tbl,
  COUNT(*) AS total,
  SUM(source = 'legacy') AS legacy
FROM salary_increment_request;

-- Check employees with multiple assignments (should have increment requests)
SELECT
  e.employee_code,
  e.first_name,
  COUNT(esa.id) AS assignment_count,
  (SELECT COUNT(*) FROM salary_increment_request sir WHERE sir.employee_id = e.id) AS increment_count
FROM employees e
JOIN employee_salary_assignment esa ON esa.employee_id = e.id
GROUP BY e.id
HAVING assignment_count > 1
LIMIT 20;

-- Cleanup temp tables
DROP TEMPORARY TABLE IF EXISTS tmp_legacy_ordered;
DROP TEMPORARY TABLE IF EXISTS tmp_legacy_with_next;
