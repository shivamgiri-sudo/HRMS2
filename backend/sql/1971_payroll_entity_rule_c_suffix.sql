-- Employees at AHMEDABAD-JALDARSHAN with numeric codes ending in C (63107C, 54563C, ...) carry no MAS
-- prefix, so the salary voucher could not place them. 180 people in Aug-2026 (db_bill holds the same
-- 180). Finance decided on 2026-10-05 they belong to MAS and are included. The prefix field accepts
-- "*C" meaning "digits followed by C". MAS and IDC prefix rules still win for anyone who has one.
-- Additive and idempotent.
INSERT INTO finance_payroll_entity_rule
  (id, company_code, employee_code_prefix, priority, effective_from, active_status, notes, created_by)
SELECT UUID(), 'MAS', '*C', 40, '2000-04-01', 1,
       'Numeric codes ending in C (e.g. 63107C). Included in the MAS salary voucher per Finance, 2026-10-05.', 'system'
 WHERE NOT EXISTS (SELECT 1 FROM finance_payroll_entity_rule WHERE company_code = 'MAS' AND employee_code_prefix = '*C');

SELECT '1971_payroll_entity_rule_c_suffix.sql applied' AS migration_status;
-- Rollback: UPDATE finance_payroll_entity_rule SET active_status = 0 WHERE company_code = 'MAS' AND employee_code_prefix = '*C';
