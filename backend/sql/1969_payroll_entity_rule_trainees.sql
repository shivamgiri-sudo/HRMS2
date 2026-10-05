-- Management trainees (employee codes like 54563C, no MAS prefix) belong to MAS. Without a rule the
-- salary voucher could not place them and left them off: 180 people, Rs 11.26 lakh net in Aug-2026.
-- Matches on employment_type (the prefix rules still win for anyone with a MAS/IDC code). Finance
-- decided on 2026-10-05 that they are included. Additive and idempotent.
INSERT INTO finance_payroll_entity_rule
  (id, company_code, employment_type, priority, effective_from, active_status, notes, created_by)
SELECT UUID(), 'MAS', 'MGMT. TRAINEE', 50, '2000-04-01', 1,
       'Management trainees carry codes like 54563C (no MAS prefix). Included in the MAS salary voucher per Finance, 2026-10-05.',
       'system'
 WHERE NOT EXISTS (
   SELECT 1 FROM finance_payroll_entity_rule
    WHERE company_code = 'MAS' AND employment_type = 'MGMT. TRAINEE' AND employee_code_prefix IS NULL);

SELECT '1969_payroll_entity_rule_trainees.sql applied' AS migration_status;
-- Rollback: UPDATE finance_payroll_entity_rule SET active_status = 0 WHERE company_code = 'MAS' AND employment_type = 'MGMT. TRAINEE' AND employee_code_prefix IS NULL;
