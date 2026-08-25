-- Migration 1606: Normalize salary_prep_line_component names against master
-- and fix salary_prep_line.total_deductions = 0 where component data exists.
--
-- Background: legacy migration imported salary_prep_line_component rows using the
-- component_code as the component_name (e.g. "PF_EMP", "BASIC", "HRA").
-- salary_component_master is the authoritative source for display names.
-- Aug 2026+ live payroll will auto-populate correct names; this fixes the backfill.

-- ─── Part 1: normalize component_name where it equals the raw component_code ──
UPDATE salary_prep_line_component splc
  JOIN salary_component_master scm ON scm.component_code = splc.component_code
SET splc.component_name = scm.component_name
WHERE splc.component_name = splc.component_code;

-- ─── Part 2: fix total_deductions = 0 on lines that have deduction components ──
-- Recalculate total_deductions as SUM of deduction-type component amounts.
UPDATE salary_prep_line spl
  JOIN (
    SELECT line_id, SUM(amount) AS ded_sum
      FROM salary_prep_line_component
     WHERE component_type = 'deduction'
     GROUP BY line_id
  ) agg ON agg.line_id = spl.id
SET spl.total_deductions = agg.ded_sum
WHERE spl.total_deductions = 0
  AND agg.ded_sum > 0;