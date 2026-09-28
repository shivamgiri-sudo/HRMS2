-- 1883_salary_start_date_governance.sql
-- Salary start date: one authoritative value, every change audited.
--
-- Two additive objects, both guarded so a replay is a no-op. NOTHING here alters employees (a
-- column add on that table is a full COPY rebuild on production - 15+ minutes, and its final
-- metadata lock times out behind long-running queries).
--
--   1. employee_salary_start_date_audit
--      One row per change of employees.salary_start_date made through the service: old and new
--      date, which path made it, who, why, whether it went before joining / before today.
--      employee_id matches employees.id: CHAR(36) utf8mb4_unicode_ci (verified live 2026-09-25).
--
--   2. payroll_config_flags('salary_start_date_gate_enforced' = 'false'), the switch that turns the
--      payroll readiness mismatch check from a warning into a blocker.

CREATE TABLE IF NOT EXISTS employee_salary_start_date_audit (
  id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  old_date DATE NULL,
  new_date DATE NOT NULL,
  source VARCHAR(60) NOT NULL,
  authority VARCHAR(20) NOT NULL,
  pre_joining TINYINT(1) NOT NULL DEFAULT 0,
  before_today TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NULL,
  actor_user_id CHAR(36) NULL,
  copies_written VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ssd_audit_employee (employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payroll gate switch, seeded OFF so the check is discoverable on the Payroll Config Flags screen.
-- OFF = a salary start date mismatch is reported as a WARNING on payroll readiness. Turn it ON
-- (config_value = 'true') once the existing mismatches are repaired and it becomes a BLOCKER.
INSERT INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
SELECT UUID(), NULL, NULL, 'salary_start_date_gate_enforced', 'false',
       'When true, an approved employee whose salary start date differs between the employee record, the HR validation row, the package date and the salary assignment blocks payroll calculation. When false it is only a warning.'
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM payroll_config_flags
    WHERE branch_id IS NULL AND process_id IS NULL AND config_key = 'salary_start_date_gate_enforced'
 );
