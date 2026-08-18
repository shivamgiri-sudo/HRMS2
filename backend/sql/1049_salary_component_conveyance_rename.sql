-- Migration 1049: Rename salary_component_master code 'TA' → 'CONV'.
--
-- Context: The payroll engine (payrollCalculate.service.ts) uses 'CONV' as the
-- internal code for conveyance in PAYSLIP_COMPONENT_NAMES and in all
-- salary_prep_line_component writes. The seed row was created as 'TA' (Travel
-- Allowance), so any salary_structure_component row linked to it produces
-- compAmounts['TA'], which the engine silently drops because 'TA' is absent from
-- PAYSLIP_COMPONENT_NAMES. Renaming to 'CONV' aligns the master with the engine.
--
-- salary_prep_line_component already uses 'CONV' in all historical rows — those
-- were written by the engine, not by reading salary_component_master.component_code.
-- No historical payslip data changes.
--
-- The legacy sync map (070_legacy_sync_maps.sql) uses the string literal 'ta'
-- to mean the db_bill Excel column I (Conv.) — that is a column alias, not a
-- reference to salary_component_master.component_code, so it is unaffected.

UPDATE salary_component_master
SET
  component_code = 'CONV',
  component_name = 'Conveyance Allowance'
WHERE component_code = 'TA';

-- Guard: if 'CONV' already exists (e.g. previously seeded), the UPDATE above
-- would create a duplicate. Check and warn.
SELECT
  component_code,
  component_name,
  component_type,
  taxable
FROM salary_component_master
WHERE component_code IN ('CONV', 'TA')
ORDER BY component_code;