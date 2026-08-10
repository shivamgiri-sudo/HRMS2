-- Migration 294: TAT and Escalation Matrix
-- Creates: tat_matrix_master, escalation_matrix_master, task_tat_instance, task_escalation_log
-- Seeds default TAT rules, registers page codes
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, INSERT IGNORE

CREATE TABLE IF NOT EXISTS tat_matrix_master (
  id               CHAR(36)     NOT NULL,
  task_type        VARCHAR(100) NOT NULL,
  task_description VARCHAR(255) DEFAULT NULL,
  default_tat_hours INT         NOT NULL DEFAULT 24,
  branch_specific  TINYINT(1)   NOT NULL DEFAULT 0,
  branch_id        CHAR(36)     DEFAULT NULL,
  role_code        VARCHAR(50)  DEFAULT NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       CHAR(36)     DEFAULT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_task_branch (task_type, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS escalation_matrix_master (
  id                  CHAR(36)    NOT NULL,
  task_type           VARCHAR(100) NOT NULL,
  escalation_level    INT         NOT NULL DEFAULT 1,
  trigger_after_hours INT         NOT NULL,
  notify_role         VARCHAR(50) DEFAULT NULL,
  notify_user_id      CHAR(36)    DEFAULT NULL,
  escalation_action   VARCHAR(50) NOT NULL DEFAULT 'notify' COMMENT 'notify/reassign/block',
  is_active           TINYINT(1)  NOT NULL DEFAULT 1,
  created_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_task_level (task_type, escalation_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_tat_instance (
  id                      CHAR(36)    NOT NULL,
  task_type               VARCHAR(100) NOT NULL,
  entity_type             VARCHAR(50) NOT NULL,
  entity_id               CHAR(36)    NOT NULL,
  assigned_to             CHAR(36)    DEFAULT NULL,
  branch_id               CHAR(36)    DEFAULT NULL,
  due_at                  DATETIME    DEFAULT NULL,
  started_at              DATETIME    DEFAULT NULL,
  completed_at            DATETIME    DEFAULT NULL,
  current_escalation_level INT        NOT NULL DEFAULT 0,
  status                  VARCHAR(30) NOT NULL DEFAULT 'open' COMMENT 'open/in_progress/completed/escalated/sla_breached',
  created_at              DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_status (status),
  INDEX idx_due (due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_escalation_log (
  id               CHAR(36)    NOT NULL,
  tat_instance_id  CHAR(36)    NOT NULL,
  escalation_level INT         NOT NULL,
  triggered_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_user_id CHAR(36)    DEFAULT NULL,
  action_taken     VARCHAR(50) DEFAULT NULL,
  resolved_at      DATETIME    DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_instance (tat_instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default TAT rules (INSERT IGNORE skips duplicates on uq_task_branch)
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES
  (UUID(), 'BIOMETRIC_ENROLL',       'Biometric enrollment after joining',        48, 1),
  (UUID(), 'DOMAIN_CREATION',        'Domain/Active Directory account creation',   4, 1),
  (UUID(), 'EMAIL_CREATION',         'Official email creation',                    4, 1),
  (UUID(), 'ASSET_ALLOCATION',       'Laptop/asset allocation',                   24, 1),
  (UUID(), 'ID_CARD',                'Physical ID card issuance',                 72, 1),
  (UUID(), 'APPOINTMENT_LETTER',     'Appointment letter generation and sign',     24, 1),
  (UUID(), 'BGV_INITIATION',         'BGV check initiation',                       8, 1),
  (UUID(), 'PAYROLL_HR_VALIDATION',  'Payroll HR validation of joining',           48, 1),
  (UUID(), 'JCLR_ENTRY',             'JCLR joining details entry',                24, 1);

-- Register page codes
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'TAT_MATRIX',    'TAT Matrix Config', 'governance', 'Configure task TAT and escalation', 1),
  (UUID(), 'TAT_DASHBOARD', 'TAT Dashboard',     'governance', 'Monitor task SLA status', 1);

-- Grant super_admin
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog WHERE page_code IN ('TAT_MATRIX','TAT_DASHBOARD');
