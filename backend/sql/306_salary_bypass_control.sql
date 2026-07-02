-- Migration 306: Salary Bypass Control — Governance Tables
-- Adds payroll_salary_slabs, salary_proposal, salary_register, salary_register_audit_log
-- Additive only. Safe to re-run (IF NOT EXISTS / INSERT IGNORE).

-- ─── 1. payroll_salary_slabs ─────────────────────────────────────────────────
-- Named slabs with explicit ctc_annual for direct assignment governance.
-- Different from salary_slab_master (range-based) — this table maps a code to an
-- exact annual CTC approved for assignment.
CREATE TABLE IF NOT EXISTS payroll_salary_slabs (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  slab_code      VARCHAR(50)   NOT NULL,
  slab_name      VARCHAR(150)  NOT NULL,
  branch_id      CHAR(36)      NULL,
  process_id     CHAR(36)      NULL,
  designation_id CHAR(36)      NULL,
  grade_id       CHAR(36)      NULL,
  ctc_annual     DECIMAL(12,2) NOT NULL,
  active_status  TINYINT(1)    NOT NULL DEFAULT 1,
  created_by     CHAR(36)      NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_slab_code (slab_code),
  INDEX idx_pss_branch  (branch_id),
  INDEX idx_pss_process (process_id),
  INDEX idx_pss_active  (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Named salary slabs with explicit annual CTC for payroll governance';

-- ─── 2. salary_proposal ──────────────────────────────────────────────────────
-- Employee-level salary proposal requiring approval chain before assignment.
CREATE TABLE IF NOT EXISTS salary_proposal (
  id                         CHAR(36)      NOT NULL DEFAULT (UUID()),
  candidate_id               CHAR(36)      NULL,
  employee_id                CHAR(36)      NULL,
  salary_slab_id             CHAR(36)      NULL  COMMENT 'Reference to payroll_salary_slabs',
  proposed_ctc_annual        DECIMAL(12,2) NOT NULL,
  reason                     TEXT          NOT NULL,
  status                     VARCHAR(30)   NOT NULL DEFAULT 'pending'
    COMMENT 'pending|branch_approved|payroll_approved|finance_approved|final_approved|rejected|expired',
  created_by                 CHAR(36)      NOT NULL,
  approved_by_branch_head    CHAR(36)      NULL,
  approved_by_branch_head_at DATETIME      NULL,
  approved_by_payroll_head   CHAR(36)      NULL,
  approved_by_payroll_head_at DATETIME     NULL,
  approved_by_finance_head   CHAR(36)      NULL,
  approved_by_finance_head_at DATETIME     NULL,
  final_approved_at          DATETIME      NULL,
  rejected_by                CHAR(36)      NULL,
  rejected_at                DATETIME      NULL,
  rejection_reason           TEXT          NULL,
  created_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_sp_candidate (candidate_id),
  INDEX idx_sp_employee  (employee_id),
  INDEX idx_sp_status    (status),
  INDEX idx_sp_slab      (salary_slab_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Salary proposals requiring approval before assignment';

-- ─── 3. salary_register ──────────────────────────────────────────────────────
-- Approved and locked salary records. The authoritative source for payroll input.
CREATE TABLE IF NOT EXISTS salary_register (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  candidate_id        CHAR(36)      NULL,
  employee_id         CHAR(36)      NULL,
  salary_slab_id      CHAR(36)      NULL,
  salary_proposal_id  CHAR(36)      NULL,
  approved_ctc_annual DECIMAL(12,2) NOT NULL,
  governance_mode     VARCHAR(30)   NOT NULL DEFAULT 'STANDARD_SLAB'
    COMMENT 'STANDARD_SLAB|APPROVED_EXCEPTION|MIGRATION_OVERRIDE',
  locked_status       TINYINT(1)    NOT NULL DEFAULT 0,
  locked_by           CHAR(36)      NULL,
  locked_at           DATETIME      NULL,
  created_by          CHAR(36)      NOT NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_sr_candidate (candidate_id),
  INDEX idx_sr_employee  (employee_id),
  INDEX idx_sr_slab      (salary_slab_id),
  INDEX idx_sr_locked    (locked_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Approved salary register — locked before payroll processing';

-- ─── 4. salary_register_audit_log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_register_audit_log (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  salary_register_id CHAR(36)     NULL,
  actor_user_id      CHAR(36)     NOT NULL,
  action_type        VARCHAR(80)  NOT NULL,
  change_summary     JSON         NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_sral_register (salary_register_id),
  INDEX idx_sral_actor    (actor_user_id),
  INDEX idx_sral_action   (action_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log for all salary register actions';

-- ─── 5. Add salary_slab_id + salary_proposal_id columns to employee_salary_assignment ───
-- These link assignments back to governance decisions.
DROP PROCEDURE IF EXISTS _m306_esa_cols;
DELIMITER //
CREATE PROCEDURE _m306_esa_cols()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'employee_salary_assignment'
      AND column_name = 'salary_slab_id'
  ) THEN
    ALTER TABLE employee_salary_assignment
      ADD COLUMN salary_slab_id     CHAR(36) NULL AFTER structure_id,
      ADD COLUMN salary_proposal_id CHAR(36) NULL AFTER salary_slab_id,
      ADD COLUMN governance_mode    VARCHAR(30) NULL DEFAULT 'STANDARD_SLAB' AFTER salary_proposal_id,
      ADD COLUMN assigned_by        CHAR(36) NULL AFTER governance_mode,
      ADD COLUMN assignment_reason  TEXT     NULL AFTER assigned_by;
  END IF;
END //
DELIMITER ;
CALL _m306_esa_cols();
DROP PROCEDURE IF EXISTS _m306_esa_cols;

-- ─── 6. Seed a few representative payroll_salary_slabs from salary_slab_master ──
-- Converts range-based slabs to exact-CTC named slabs (midpoint of each range).
-- These are governance-safe seeds; HR can add more via UI.
INSERT IGNORE INTO payroll_salary_slabs (id, slab_code, slab_name, ctc_annual, active_status)
SELECT
  UUID(),
  CONCAT('PSS_', slab_code),
  label,
  ROUND((range_from + range_to) / 2, 2),
  active_status
FROM salary_slab_master
WHERE active_status = 1
LIMIT 20;

-- ─── 7. Register page codes ──────────────────────────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'SALARY_SLAB_MASTER',   'Salary Slab Master',   'payroll', 'Manage payroll salary slabs', 1),
  (UUID(), 'SALARY_PROPOSAL_QUEUE','Salary Proposal Queue', 'payroll', 'Review and approve salary proposals', 1);
