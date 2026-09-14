-- backend/sql/migrations/434_salary_dispute.sql
CREATE TABLE IF NOT EXISTS salary_dispute (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()),
  employee_id               CHAR(36)      NOT NULL,
  employee_code             VARCHAR(50)   NOT NULL,
  run_month                 VARCHAR(7)    NOT NULL COMMENT 'YYYY-MM of disputed payroll',
  dispute_type              ENUM(
    'MISSING_OT','INCORRECT_ATTENDANCE','REGULARIZATION_NOT_APPLIED',
    'LEAVE_NOT_ASSIGNED','INCENTIVE_MISSING','WRONG_DEDUCTION',
    'WRONG_COMPONENT_AMOUNT','SHIFT_ALLOWANCE_MISSING',
    'DOUBLE_DEDUCTION','WRONG_LWP_COUNT','OTHER'
  ) NOT NULL,
  affected_dates            JSON          NOT NULL COMMENT 'Array of YYYY-MM-DD strings',
  description               TEXT          NOT NULL,
  status                    ENUM(
    'draft','pending_wfm','pending_payroll_head','approved','rejected','closed'
  ) NOT NULL DEFAULT 'pending_wfm',
  manager_id                CHAR(36)      NULL COMMENT 'Reporting manager at raise time (view-only)',
  branch_id                 CHAR(36)      NOT NULL,
  process_id                CHAR(36)      NULL,
  wfm_corrective_json       JSON          NULL COMMENT 'Corrective details entered by WFM',
  differential_amount       DECIMAL(10,2) NULL,
  differential_basis        TEXT          NULL COMMENT 'How differential was calculated',
  wfm_remarks               TEXT          NULL,
  wfm_reviewed_at           DATETIME      NULL,
  wfm_reviewed_by           CHAR(36)      NULL,
  payroll_head_remarks      TEXT          NULL,
  payroll_head_reviewed_at  DATETIME      NULL,
  payroll_head_reviewed_by  CHAR(36)      NULL,
  arrear_run_month          VARCHAR(7)    NULL COMMENT 'Month arrear will be/was paid',
  arrear_line_id            CHAR(36)      NULL COMMENT 'FK to salary_prep_line_component.id',
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_emp_month_type (employee_id, run_month, dispute_type),
  KEY idx_employee   (employee_id),
  KEY idx_status     (status),
  KEY idx_branch     (branch_id),
  KEY idx_run_month  (run_month),
  KEY idx_manager    (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
