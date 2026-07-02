-- 015_platform_foundation.sql
-- Package 1: Organisation masters gap-fill, grade/band, approval workflow,
-- policy master, sensitive action audit log, role administration support.
-- All additive. Do not execute on production without explicit approval.
USE mas_hrms;

-- ── 1. Organisation masters gap-fill ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaign_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  campaign_code VARCHAR(50)  NOT NULL UNIQUE,
  campaign_name VARCHAR(255) NOT NULL,
  process_id    CHAR(36),
  lob_id        CHAR(36),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id)  REFERENCES process_master(id)  ON DELETE SET NULL,
  FOREIGN KEY (lob_id)      REFERENCES lob_master(id)       ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cost_centre_master (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cost_centre_code  VARCHAR(50)  NOT NULL UNIQUE,
  cost_centre_name  VARCHAR(255) NOT NULL,
  branch_id         CHAR(36),
  department_id     CHAR(36),
  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id)     REFERENCES branch_master(id)     ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES department_master(id) ON DELETE SET NULL
);

-- ── 2. Grade and band master ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grade_band_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  grade_code    VARCHAR(50)  NOT NULL UNIQUE,
  grade_name    VARCHAR(255) NOT NULL,
  band          VARCHAR(50),
  min_ctc       DECIMAL(12,2),
  max_ctc       DECIMAL(12,2),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Link designation_master to grade_band (additive column, safe to add)
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='designation_master' AND COLUMN_NAME='grade_id') = 0,
  'ALTER TABLE designation_master ADD COLUMN grade_id CHAR(36) NULL, ADD CONSTRAINT fk_desig_grade FOREIGN KEY (grade_id) REFERENCES grade_band_master(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. Reporting hierarchy ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reporting_hierarchy (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  reports_to_employee_id CHAR(36),
  effective_from       DATE         NOT NULL,
  effective_to         DATE,
  hierarchy_type       VARCHAR(50)  NOT NULL DEFAULT 'direct',
  active_status        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_hierarchy (employee_id, hierarchy_type, effective_from),
  INDEX idx_rh_employee (employee_id),
  FOREIGN KEY (employee_id)            REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (reports_to_employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

-- ── 4. Approval workflow engine ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_workflow_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  workflow_code   VARCHAR(100) NOT NULL UNIQUE,
  workflow_name   VARCHAR(255) NOT NULL,
  module_key      VARCHAR(100) NOT NULL,
  description     TEXT,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_workflow_step (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  workflow_id     CHAR(36)     NOT NULL,
  step_order      INT          NOT NULL,
  step_name       VARCHAR(255) NOT NULL,
  approver_role   VARCHAR(100) NOT NULL,
  auto_approve    TINYINT(1)   NOT NULL DEFAULT 0,
  sla_hours       INT,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workflow_step (workflow_id, step_order),
  FOREIGN KEY (workflow_id) REFERENCES approval_workflow_master(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approval_request (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  workflow_id     CHAR(36)     NOT NULL,
  module_key      VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       CHAR(36)     NOT NULL,
  current_step    INT          NOT NULL DEFAULT 1,
  status          ENUM('pending','approved','rejected','withdrawn','cancelled')
                              NOT NULL DEFAULT 'pending',
  requested_by    CHAR(36)     NOT NULL,
  summary_text    TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ar_entity (entity_type, entity_id),
  INDEX idx_ar_status (status),
  FOREIGN KEY (workflow_id) REFERENCES approval_workflow_master(id)
);

CREATE TABLE IF NOT EXISTS approval_action_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  request_id      CHAR(36)     NOT NULL,
  step_order      INT          NOT NULL,
  actor_user_id   CHAR(36)     NOT NULL,
  action          ENUM('approved','rejected','withdrawn','delegated','comment') NOT NULL,
  remarks         TEXT,
  acted_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aal_request (request_id),
  FOREIGN KEY (request_id) REFERENCES approval_request(id) ON DELETE CASCADE
);

-- ── 5. Policy master ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  policy_code     VARCHAR(100) NOT NULL UNIQUE,
  policy_name     VARCHAR(255) NOT NULL,
  module_key      VARCHAR(100) NOT NULL,
  policy_type     VARCHAR(100) NOT NULL,
  config_json     JSON,
  effective_from  DATE         NOT NULL,
  effective_to    DATE,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_policy_module (module_key)
);

-- ── 6. Sensitive action / audit log ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sensitive_action_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  actor_user_id   CHAR(36)     NOT NULL,
  action_type     VARCHAR(100) NOT NULL,
  module_key      VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(100),
  entity_id       CHAR(36),
  ip_address      VARCHAR(45),
  user_agent      VARCHAR(512),
  change_summary  JSON,
  acted_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sal_actor (actor_user_id),
  INDEX idx_sal_action (action_type),
  INDEX idx_sal_entity (entity_type, entity_id),
  INDEX idx_sal_time (acted_at)
);

-- ── 7. Seed: approval workflows for core HRMS modules ────────────────────────

INSERT INTO approval_workflow_master (workflow_code, workflow_name, module_key) VALUES
  ('LEAVE_APPROVAL',       'Leave Request Approval',       'LEAVE'),
  ('EXIT_APPROVAL',        'Exit Request Approval',        'EXIT'),
  ('REGULARIZATION_APPROVAL', 'Attendance Regularization', 'WFM'),
  ('SALARY_REVISION_APPROVAL', 'Salary Revision Approval', 'PAYROLL')
ON DUPLICATE KEY UPDATE workflow_name = VALUES(workflow_name);

-- Default 2-step leave approval: TL → HR
INSERT INTO approval_workflow_step (workflow_id, step_order, step_name, approver_role, sla_hours)
SELECT id, 1, 'Team Leader Approval', 'tl', 24 FROM approval_workflow_master WHERE workflow_code = 'LEAVE_APPROVAL'
ON DUPLICATE KEY UPDATE step_name = VALUES(step_name);

INSERT INTO approval_workflow_step (workflow_id, step_order, step_name, approver_role, sla_hours)
SELECT id, 2, 'HR Approval', 'hr', 48 FROM approval_workflow_master WHERE workflow_code = 'LEAVE_APPROVAL'
ON DUPLICATE KEY UPDATE step_name = VALUES(step_name);

-- Default exit approval: Manager → HR → Admin
INSERT INTO approval_workflow_step (workflow_id, step_order, step_name, approver_role, sla_hours)
SELECT id, 1, 'Manager Review', 'manager', 48 FROM approval_workflow_master WHERE workflow_code = 'EXIT_APPROVAL'
ON DUPLICATE KEY UPDATE step_name = VALUES(step_name);

INSERT INTO approval_workflow_step (workflow_id, step_order, step_name, approver_role, sla_hours)
SELECT id, 2, 'HR Review', 'hr', 48 FROM approval_workflow_master WHERE workflow_code = 'EXIT_APPROVAL'
ON DUPLICATE KEY UPDATE step_name = VALUES(step_name);

INSERT INTO approval_workflow_step (workflow_id, step_order, step_name, approver_role, sla_hours)
SELECT id, 3, 'Admin Acceptance', 'admin', 24 FROM approval_workflow_master WHERE workflow_code = 'EXIT_APPROVAL'
ON DUPLICATE KEY UPDATE step_name = VALUES(step_name);
