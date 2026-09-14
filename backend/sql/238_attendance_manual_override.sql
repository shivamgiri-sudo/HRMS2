-- Migration 238: Payroll Head Manual Attendance Override Table
-- Purpose: Create a dedicated, audited, Payroll Head-only table for direct
--          payable-attendance corrections that bypass the employee workflow.
-- Risk: LOW — new table only, no existing schema changed.
-- Hard rules enforced by schema:
--   - reason NOT NULL (mandatory)
--   - old_status + new_status NOT NULL (before/after required)
--   - created_by NOT NULL (no anonymous override)
--   - is_payroll_month_locked flag triggers higher_approval_required
-- Rollback: DROP TABLE attendance_manual_override;

CREATE TABLE IF NOT EXISTS attendance_manual_override (
  id                      VARCHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,

  -- Subject
  employee_id             VARCHAR(36)    NOT NULL COMMENT 'Employee whose attendance is being overridden',
  attendance_date         DATE           NOT NULL COMMENT 'Calendar date being corrected',

  -- Before-state (mandatory — no silent overwrite)
  old_status              VARCHAR(50)    NOT NULL COMMENT 'attendance_daily_record.attendance_status before override',
  old_payable_days        DECIMAL(4,2)   NULL     COMMENT 'Payable days before override',
  old_lwp                 DECIMAL(4,2)   NULL     COMMENT 'LWP value before override',
  old_shift_id            VARCHAR(36)    NULL     COMMENT 'FK wfm_shift.id before override',

  -- After-state (mandatory)
  new_status              VARCHAR(50)    NOT NULL COMMENT 'attendance_daily_record.attendance_status after override',
  new_payable_days        DECIMAL(4,2)   NULL     COMMENT 'Payable days after override',
  new_lwp                 DECIMAL(4,2)   NULL     COMMENT 'LWP value after override',
  new_shift_id            VARCHAR(36)    NULL     COMMENT 'FK wfm_shift.id after override (if shift corrected)',

  -- Mandatory reason (enforced NOT NULL)
  reason                  TEXT           NOT NULL COMMENT 'Mandatory justification — no override without reason',

  -- Supporting document
  supporting_doc_id       VARCHAR(36)    NULL     COMMENT 'FK upload_batch.id or document reference',

  -- Payroll context
  payroll_month           CHAR(7)        NULL     COMMENT 'YYYY-MM of the payroll cycle being affected',
  payroll_run_id          VARCHAR(36)    NULL     COMMENT 'FK payroll_run.id if payroll already calculated',
  payroll_impact_amount   DECIMAL(12,2)  NULL     COMMENT 'Estimated payroll impact in INR (positive = gain, negative = deduction)',

  -- Locked month control
  is_payroll_month_locked TINYINT(1)     NOT NULL DEFAULT 0
    COMMENT '1 = payroll month is locked; higher_approval_required is set automatically',
  higher_approval_required TINYINT(1)   NOT NULL DEFAULT 0
    COMMENT '1 = Super Admin approval needed (set when is_payroll_month_locked = 1)',

  -- Approval lifecycle
  approval_status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'
    COMMENT 'pending = created by Payroll Head, awaiting Super Admin (if locked); approved/rejected = resolved',
  created_by              VARCHAR(36)    NOT NULL COMMENT 'auth_user.id of Payroll Head who created override',
  approved_by             VARCHAR(36)    NULL     COMMENT 'auth_user.id who approved (Super Admin for locked months)',
  rejected_by             VARCHAR(36)    NULL     COMMENT 'auth_user.id who rejected',
  rejection_reason        TEXT           NULL     COMMENT 'Reason if rejected',
  created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at             DATETIME       NULL,
  rejected_at             DATETIME       NULL,

  -- Applied tracking
  applied_to_record_id    VARCHAR(36)    NULL
    COMMENT 'FK attendance_daily_record.id that was updated when override was approved',
  applied_at              DATETIME       NULL     COMMENT 'When the override was actually written to attendance_daily_record',
  applied_by              VARCHAR(36)    NULL     COMMENT 'auth_user.id who triggered the apply (system or Super Admin)',

  INDEX idx_amo_employee      (employee_id),
  INDEX idx_amo_date          (attendance_date),
  INDEX idx_amo_payroll_month (payroll_month),
  INDEX idx_amo_status        (approval_status),
  INDEX idx_amo_created_by    (created_by),
  INDEX idx_amo_created_at    (created_at),

  CONSTRAINT fk_amo_employee   FOREIGN KEY (employee_id) REFERENCES employees(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_amo_created_by FOREIGN KEY (created_by) REFERENCES auth_user(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Payroll Head-only direct attendance corrections. Every row is immutable after approval.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Trigger: auto-set higher_approval_required when payroll month is locked
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_amo_locked_month_check;
CREATE TRIGGER trg_amo_locked_month_check
BEFORE INSERT ON attendance_manual_override
FOR EACH ROW
BEGIN
  IF NEW.is_payroll_month_locked = 1 THEN
    SET NEW.higher_approval_required = 1;
  END IF;
END;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════════
/*
DROP TRIGGER IF EXISTS trg_amo_locked_month_check;
DROP TABLE IF EXISTS attendance_manual_override;
*/
