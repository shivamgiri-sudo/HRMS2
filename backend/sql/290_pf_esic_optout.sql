-- 290_pf_esic_optout.sql
-- Employee-level voluntary PF / ESI opt-out with Payroll HO approval workflow.
-- Additive migration — no existing rows or columns are altered.

CREATE TABLE IF NOT EXISTS employee_statutory_override (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  override_type        ENUM('pf_opt_out','esic_opt_out') NOT NULL,
  status               ENUM('pending','approved','rejected','revoked') NOT NULL DEFAULT 'pending',
  requested_by         CHAR(36)     NOT NULL,          -- auth_user.id of the employee
  requested_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  declaration_text     TEXT         NULL,               -- Employee's written opt-out declaration
  approved_by          CHAR(36)     NULL,
  approved_at          DATETIME     NULL,
  effective_from_month VARCHAR(7)   NULL,               -- YYYY-MM, set by approver
  revoked_by           CHAR(36)     NULL,
  revoked_at           DATETIME     NULL,
  audit_note           TEXT         NULL,
  UNIQUE KEY uq_emp_override_active (employee_id, override_type, status),
  INDEX idx_eso_employee (employee_id),
  INDEX idx_eso_status   (status),
  INDEX idx_eso_effective (effective_from_month)
);
