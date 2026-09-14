-- Migration 411: Correct historical Professional Tax for states with no PT legislation
-- Affected: Uttar Pradesh, Delhi, Rajasthan, Haryana, Punjab (and any test "Smoke State")
-- These states have NO professional tax law, so PT should be 0.
-- Total affected: ~3,496 records, ~Rs 6,99,200 incorrectly deducted
-- All affected records are in 'processing' or 'approved' status (not disbursed).
--
-- Correction: SET professional_tax = 0, reduce total_deductions, increase net_salary by the PT amount.

-- Step 1: Create audit log of what we're about to correct
CREATE TABLE IF NOT EXISTS pt_correction_audit_20260717 (
  id INT AUTO_INCREMENT PRIMARY KEY,
  salary_prep_line_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  run_month VARCHAR(10),
  state VARCHAR(100),
  old_professional_tax DECIMAL(12,2),
  old_total_deductions DECIMAL(12,2),
  old_net_salary DECIMAL(12,2),
  new_professional_tax DECIMAL(12,2) DEFAULT 0.00,
  new_total_deductions DECIMAL(12,2),
  new_net_salary DECIMAL(12,2),
  corrected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Insert audit records BEFORE making changes
INSERT INTO pt_correction_audit_20260717
  (salary_prep_line_id, employee_id, run_month, state,
   old_professional_tax, old_total_deductions, old_net_salary,
   new_total_deductions, new_net_salary)
SELECT
  spl.id,
  spl.employee_id,
  spr.run_month,
  bm.state,
  spl.professional_tax,
  spl.total_deductions,
  spl.net_salary,
  spl.total_deductions - spl.professional_tax,
  spl.net_salary + spl.professional_tax
FROM salary_prep_line spl
JOIN salary_prep_run spr ON spr.id = spl.run_id
JOIN employees e ON e.id = spl.employee_id
JOIN branch_master bm ON bm.id = e.branch_id
WHERE spl.professional_tax > 0
  AND LOWER(bm.state) IN ('uttar pradesh', 'delhi', 'rajasthan', 'haryana', 'punjab', 'smoke state');

-- Step 3: Apply the correction
UPDATE salary_prep_line spl
JOIN employees e ON e.id = spl.employee_id
JOIN branch_master bm ON bm.id = e.branch_id
SET
  spl.net_salary = spl.net_salary + spl.professional_tax,
  spl.total_deductions = spl.total_deductions - spl.professional_tax,
  spl.professional_tax = 0
WHERE spl.professional_tax > 0
  AND LOWER(bm.state) IN ('uttar pradesh', 'delhi', 'rajasthan', 'haryana', 'punjab', 'smoke state');

-- Step 4: Also zero out PT in salary_prep_line_component if it exists there
UPDATE salary_prep_line_component splc
JOIN salary_prep_line spl ON spl.id = splc.line_id
JOIN employees e ON e.id = spl.employee_id
JOIN branch_master bm ON bm.id = e.branch_id
SET splc.amount = 0
WHERE splc.component_code = 'PT'
  AND LOWER(bm.state) IN ('uttar pradesh', 'delhi', 'rajasthan', 'haryana', 'punjab', 'smoke state');

-- Verification query (run after to confirm):
-- SELECT state, COUNT(*) as records, SUM(old_professional_tax) as total_corrected
-- FROM pt_correction_audit_20260717 GROUP BY state;
