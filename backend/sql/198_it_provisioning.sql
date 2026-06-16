-- 198_it_provisioning.sql
-- IT Provisioning module: branch_it role + provisioning request table + email upload template
-- Safe / idempotent — CREATE uses IF NOT EXISTS, INSERTs use ON DUPLICATE KEY / INSERT IGNORE

-- ── 1. branch_it role ─────────────────────────────────────────────────────────
INSERT INTO workforce_role_catalog (role_key, role_name, active_status)
VALUES ('branch_it', 'Branch IT Admin', 1)
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name), active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('branch_it', 'IT_PROVISIONING_TRACKER', 1, 0, 1, 0, 1),
  ('branch_it', 'EMPLOYEES',               1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_edit = VALUES(can_edit);

-- ── 2. it_provisioning_request table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS it_provisioning_request (
  id               CHAR(36)            NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id      CHAR(36)            NOT NULL,
  request_type     ENUM('join','exit') NOT NULL,
  task_code        VARCHAR(80)         NOT NULL
    COMMENT 'join: domain_create, biometric_enroll | exit: domain_delete, email_delete, biometric_delete, dialler_delete',
  assigned_role    VARCHAR(100)        NOT NULL
    COMMENT 'branch_it | admin | wfm',
  assigned_user_id CHAR(36)            NULL
    COMMENT 'Specific user resolved at trigger time; NULL = broadcast to all role holders',
  status           ENUM('pending','actioned','confirmed','waived') NOT NULL DEFAULT 'pending',
  trigger_event_id VARCHAR(36)         NULL
    COMMENT 'exit_request.id for exit events; onboarding_request.id for join events',
  requested_at     DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actioned_at      DATETIME            NULL,
  actioned_by      CHAR(36)            NULL,
  evidence_note    TEXT                NULL,
  locked           TINYINT(1)          NOT NULL DEFAULT 0
    COMMENT '1 = record is immutable evidence; no further mutations allowed',
  created_at       DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ipr_employee  (employee_id),
  INDEX idx_ipr_status    (status, request_type),
  INDEX idx_ipr_assigned  (assigned_role, status),
  INDEX idx_ipr_trigger   (trigger_event_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ── 3. Seed OFFICIAL_EMAIL_UPDATE upload template ─────────────────────────────
-- official_email column already exists in employees (migration 187).
-- This just registers the upload type so BulkUploadHub can drive it.
INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'OFFICIAL_EMAIL_UPDATE',
  'Official Email Bulk Update',
  'employees',
  'Bulk-assign official company email to existing employees. Email must be @teammas.in or @teammas.co.in',
  JSON_ARRAY('employee_code', 'official_email'),
  JSON_ARRAY(),
  JSON_OBJECT('employee_code', 'MAS00001', 'official_email', 'firstname.lastname@teammas.in'),
  1
);

SELECT '198_it_provisioning.sql applied successfully' AS migration_status;
