-- 016_employee_lifecycle.sql
-- Package 2: Employee lifecycle events, document enhancements, asset backend,
-- HR helpdesk, grievance, letter generation foundation.
-- All additive. Do not execute on production without explicit approval.
USE mas_hrms;

-- ── 1. Employee lifecycle event types ────────────────────────────────────────
-- Extends employee_journey_log with structured lifecycle events.
-- The lifecycle events table is separate to keep journey_log append-only.

CREATE TABLE IF NOT EXISTS employee_lifecycle_event (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  event_type      ENUM(
    'confirmation','probation_extension','transfer','promotion',
    'demotion','increment','role_change','designation_change',
    'department_change','branch_change','process_change',
    'reporting_change','status_change','other'
  )                            NOT NULL,
  effective_date  DATE         NOT NULL,
  old_value_json  JSON,
  new_value_json  JSON,
  remarks         TEXT,
  approval_request_id CHAR(36),
  initiated_by    CHAR(36)     NOT NULL,
  approved_by     CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lifecycle_emp (employee_id),
  INDEX idx_lifecycle_type (event_type),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ── 2. Employee document enhancements ────────────────────────────────────────
-- Add expiry_date, verified_by, verification_date, access_log to existing table.

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_documents' AND COLUMN_NAME='expiry_date') = 0,
  'ALTER TABLE employee_documents ADD COLUMN expiry_date DATE NULL, ADD COLUMN verified_by CHAR(36) NULL, ADD COLUMN verification_date DATETIME NULL, ADD COLUMN verification_remarks VARCHAR(500) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS employee_document_access_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  document_id     CHAR(36)     NOT NULL,
  accessed_by     CHAR(36)     NOT NULL,
  access_type     ENUM('view','download','verify','delete') NOT NULL DEFAULT 'view',
  ip_address      VARCHAR(45),
  accessed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc_access_doc (document_id),
  INDEX idx_doc_access_user (accessed_by)
);

-- ── 3. Asset master (MySQL backend) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  asset_code      VARCHAR(100) NOT NULL UNIQUE,
  asset_name      VARCHAR(255) NOT NULL,
  asset_category  VARCHAR(100) NOT NULL,
  asset_type      VARCHAR(100),
  serial_number   VARCHAR(255),
  purchase_date   DATE,
  purchase_cost   DECIMAL(12,2),
  vendor          VARCHAR(255),
  warranty_expiry DATE,
  branch_id       CHAR(36),
  status          ENUM('available','assigned','maintenance','repair','retired','lost')
                              NOT NULL DEFAULT 'available',
  notes           TEXT,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_asset_branch (branch_id),
  INDEX idx_asset_status (status),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS asset_assignment (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  asset_id        CHAR(36)     NOT NULL,
  employee_id     CHAR(36)     NOT NULL,
  assigned_date   DATE         NOT NULL,
  returned_date   DATE,
  assigned_by     CHAR(36)     NOT NULL,
  return_condition VARCHAR(100),
  notes           TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_asset_assign_asset (asset_id),
  INDEX idx_asset_assign_emp (employee_id),
  FOREIGN KEY (asset_id)     REFERENCES asset_master(id)  ON DELETE CASCADE,
  FOREIGN KEY (employee_id)  REFERENCES employees(id)     ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_service_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  asset_id        CHAR(36)     NOT NULL,
  service_type    ENUM('maintenance','repair','inspection') NOT NULL,
  service_date    DATE         NOT NULL,
  service_notes   TEXT,
  cost            DECIMAL(10,2),
  performed_by    VARCHAR(255),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES asset_master(id) ON DELETE CASCADE
);

-- ── 4. HR / Payroll / IT helpdesk tickets ────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk_ticket (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  ticket_code     VARCHAR(50)  NOT NULL UNIQUE,
  employee_id     CHAR(36)     NOT NULL,
  category        ENUM('hr','payroll','it','general','asset','leave','attendance') NOT NULL,
  subject         VARCHAR(500) NOT NULL,
  description     TEXT         NOT NULL,
  priority        ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  status          ENUM('open','in_progress','pending_info','resolved','closed','cancelled')
                              NOT NULL DEFAULT 'open',
  assigned_to     CHAR(36),
  resolved_at     DATETIME,
  resolution_note TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ticket_emp (employee_id),
  INDEX idx_ticket_status (status),
  INDEX idx_ticket_category (category),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS helpdesk_ticket_comment (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  ticket_id       CHAR(36)     NOT NULL,
  author_user_id  CHAR(36)     NOT NULL,
  comment_text    TEXT         NOT NULL,
  is_internal     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ticket_comment (ticket_id),
  FOREIGN KEY (ticket_id) REFERENCES helpdesk_ticket(id) ON DELETE CASCADE
);

-- ── 5. Restricted grievance workflow ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grievance (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  grievance_code  VARCHAR(50)  NOT NULL UNIQUE,
  employee_id     CHAR(36)     NOT NULL,
  category        VARCHAR(100) NOT NULL,
  description     TEXT         NOT NULL,
  is_anonymous    TINYINT(1)   NOT NULL DEFAULT 0,
  status          ENUM('submitted','under_review','resolved','closed','escalated')
                              NOT NULL DEFAULT 'submitted',
  assigned_to     CHAR(36),
  resolution_note TEXT,
  resolved_at     DATETIME,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_grievance_emp (employee_id),
  INDEX idx_grievance_status (status),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ── 6. Employee letter / document generation ──────────────────────────────────

CREATE TABLE IF NOT EXISTS letter_template (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_code   VARCHAR(100) NOT NULL UNIQUE,
  template_name   VARCHAR(255) NOT NULL,
  letter_type     VARCHAR(100) NOT NULL,
  body_template   TEXT         NOT NULL,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS generated_letter (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  template_id     CHAR(36)     NOT NULL,
  letter_type     VARCHAR(100) NOT NULL,
  generated_text  TEXT         NOT NULL,
  file_url        VARCHAR(500),
  generated_by    CHAR(36)     NOT NULL,
  issued_date     DATE,
  acknowledged_at DATETIME,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_letter_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES letter_template(id)
);

-- ── 7. Seed: default letter templates ────────────────────────────────────────

INSERT INTO letter_template (template_code, template_name, letter_type, body_template) VALUES
  ('OFFER_LETTER',        'Offer Letter',             'offer',        'Dear {{full_name}},\n\nWe are pleased to offer you the position of {{designation}} at MAS Callnet effective {{date_of_joining}}.\n\nYour CTC will be {{ctc_annual}} per annum.\n\nKindly sign and return this letter as your acceptance.\n\nRegards,\nHR Team'),
  ('CONFIRMATION_LETTER', 'Employment Confirmation',  'confirmation', 'Dear {{full_name}},\n\nWe are pleased to confirm your employment as {{designation}} effective {{effective_date}}.\n\nRegards,\nHR Team'),
  ('EXPERIENCE_LETTER',   'Experience Letter',        'experience',   'To Whom It May Concern,\n\nThis is to certify that {{full_name}} (Employee Code: {{employee_code}}) was employed with MAS Callnet from {{date_of_joining}} to {{date_of_exit}} as {{designation}}.\n\nWe wish them the best.\n\nRegards,\nHR Team')
ON DUPLICATE KEY UPDATE template_name = VALUES(template_name);
