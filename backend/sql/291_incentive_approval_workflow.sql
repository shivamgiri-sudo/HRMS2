-- Migration 291: Incentive Approval Workflow
-- Creates: incentive_upload_batch, incentive_approval_step, incentive_payroll_register
-- Registers page codes in page_catalog, grants to super_admin in role_page_access
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, INSERT IGNORE

CREATE TABLE IF NOT EXISTS incentive_upload_batch (
  id                   CHAR(36)       NOT NULL,
  batch_ref            VARCHAR(100)   DEFAULT NULL,
  salary_month         CHAR(7)        DEFAULT NULL,
  uploaded_by          CHAR(36)       DEFAULT NULL,
  branch_id            CHAR(36)       DEFAULT NULL,
  process_id           CHAR(36)       DEFAULT NULL,
  total_employees      INT            NOT NULL DEFAULT 0,
  total_amount         DECIMAL(18,2)  NOT NULL DEFAULT 0.00,
  status               VARCHAR(30)    NOT NULL DEFAULT 'draft',
  approval_chain       JSON           DEFAULT NULL,
  current_approval_step INT           NOT NULL DEFAULT 0,
  payroll_register_id  CHAR(36)       DEFAULT NULL,
  created_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS incentive_approval_step (
  id               CHAR(36)    NOT NULL,
  batch_id         CHAR(36)    NOT NULL,
  step_number      INT         NOT NULL,
  required_role    VARCHAR(50) DEFAULT NULL,
  approver_user_id CHAR(36)    DEFAULT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected/skipped',
  remarks          TEXT        DEFAULT NULL,
  decided_at       DATETIME    DEFAULT NULL,
  created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS incentive_payroll_register (
  id               CHAR(36)      NOT NULL,
  batch_id         CHAR(36)      NOT NULL,
  salary_month     CHAR(7)       DEFAULT NULL,
  register_date    DATE          DEFAULT NULL,
  total_employees  INT           NOT NULL DEFAULT 0,
  total_amount     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  finalized_by     CHAR(36)      DEFAULT NULL,
  finalized_at     DATETIME      DEFAULT NULL,
  payroll_run_id   CHAR(36)      DEFAULT NULL,
  status           VARCHAR(20)   NOT NULL DEFAULT 'draft',
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register page codes
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'PAYROLL_INCENTIVE_UPLOAD',    'Incentive Upload',    'payroll', 'Upload incentive batch', 1),
  (UUID(), 'PAYROLL_INCENTIVE_APPROVALS', 'Incentive Approvals', 'payroll', 'Approve incentive batches', 1),
  (UUID(), 'PAYROLL_INCENTIVE_REGISTER',  'Incentive Register',  'payroll', 'View payroll register for incentives', 1);

-- Grant super_admin full access to new pages
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog
WHERE page_code IN ('PAYROLL_INCENTIVE_UPLOAD','PAYROLL_INCENTIVE_APPROVALS','PAYROLL_INCENTIVE_REGISTER');
