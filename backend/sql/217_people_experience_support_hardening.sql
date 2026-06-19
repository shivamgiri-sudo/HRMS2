-- 217_people_experience_support_hardening.sql
-- Safe additive migrations for People Experience, Support SLA, Grievance hardening.
-- All statements are idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN safe.

-- ─── 1. people_experience_health_snapshot ────────────────────────────────────
CREATE TABLE IF NOT EXISTS people_experience_health_snapshot (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id               CHAR(36)     NOT NULL,
  snapshot_date             DATE         NOT NULL,
  engagement_score          DECIMAL(5,2) NOT NULL DEFAULT 0,
  data_confidence_score     DECIMAL(5,2) NOT NULL DEFAULT 0,
  risk_label                ENUM('highly_engaged','stable','watchlist','attrition_risk','critical_people_risk')
                                         NOT NULL DEFAULT 'stable',
  pulse_score               DECIMAL(5,2) NOT NULL DEFAULT 0,
  recognition_score         DECIMAL(5,2) NOT NULL DEFAULT 0,
  participation_score       DECIMAL(5,2) NOT NULL DEFAULT 0,
  attendance_score          DECIMAL(5,2) NOT NULL DEFAULT 0,
  performance_score         DECIMAL(5,2) NOT NULL DEFAULT 0,
  support_friction_score    DECIMAL(5,2) NOT NULL DEFAULT 0,
  career_growth_score       DECIMAL(5,2) NOT NULL DEFAULT 0,
  top_risk_drivers_json     JSON,
  recommended_actions_json  JSON,
  created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pe_snap (employee_id, snapshot_date),
  INDEX idx_pe_snap_emp (employee_id),
  INDEX idx_pe_snap_date (snapshot_date),
  INDEX idx_pe_snap_risk (risk_label),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ─── 2. people_experience_action ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS people_experience_action (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id      CHAR(36)     NOT NULL,
  source_type      VARCHAR(50)  NOT NULL DEFAULT 'manual',
  source_id        CHAR(36),
  action_type      VARCHAR(100) NOT NULL,
  priority         ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  owner_user_id    CHAR(36),
  due_date         DATE,
  status           ENUM('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
  notes            TEXT,
  completed_at     DATETIME,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pea_emp (employee_id),
  INDEX idx_pea_owner (owner_user_id),
  INDEX idx_pea_due (due_date),
  INDEX idx_pea_status (status),
  INDEX idx_pea_priority (priority),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ─── 3. helpdesk_ticket hardening ────────────────────────────────────────────
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='escalation_level') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN escalation_level TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.escalation_level exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='reopened_count') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN reopened_count INT NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.reopened_count exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='closure_rating') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN closure_rating TINYINT(1) NULL COMMENT ''1-5 CSAT''', 'SELECT ''helpdesk_ticket.closure_rating exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='root_cause') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN root_cause VARCHAR(255) NULL', 'SELECT ''helpdesk_ticket.root_cause exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='sla_due_at') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN sla_due_at DATETIME NULL', 'SELECT ''helpdesk_ticket.sla_due_at exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='sla_breached') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN sla_breached TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.sla_breached exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='assigned_department') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN assigned_department VARCHAR(100) NULL', 'SELECT ''helpdesk_ticket.assigned_department exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='impact_type') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN impact_type ENUM(''none'',''minor'',''moderate'',''major'',''critical'') NOT NULL DEFAULT ''none''', 'SELECT ''helpdesk_ticket.impact_type exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='employee_blocked') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN employee_blocked TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.employee_blocked exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='productivity_impact') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN productivity_impact TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.productivity_impact exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='payroll_impact') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN payroll_impact TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.payroll_impact exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='rated_at') = 0, 'ALTER TABLE helpdesk_ticket ADD COLUMN rated_at DATETIME NULL', 'SELECT ''helpdesk_ticket.rated_at exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 4. grievance hardening ──────────────────────────────────────────────────
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='severity') = 0, 'ALTER TABLE grievance ADD COLUMN severity ENUM(''low'',''medium'',''high'',''critical'') NOT NULL DEFAULT ''medium''', 'SELECT ''grievance.severity exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='escalation_level') = 0, 'ALTER TABLE grievance ADD COLUMN escalation_level TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''grievance.escalation_level exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='evidence_count') = 0, 'ALTER TABLE grievance ADD COLUMN evidence_count INT NOT NULL DEFAULT 0', 'SELECT ''grievance.evidence_count exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='confidentiality_level') = 0, 'ALTER TABLE grievance ADD COLUMN confidentiality_level ENUM(''standard'',''confidential'',''sensitive'') NOT NULL DEFAULT ''standard''', 'SELECT ''grievance.confidentiality_level exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='anti_retaliation_flag') = 0, 'ALTER TABLE grievance ADD COLUMN anti_retaliation_flag TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''grievance.anti_retaliation_flag exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='assigned_committee') = 0, 'ALTER TABLE grievance ADD COLUMN assigned_committee VARCHAR(255) NULL', 'SELECT ''grievance.assigned_committee exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='due_date') = 0, 'ALTER TABLE grievance ADD COLUMN due_date DATE NULL', 'SELECT ''grievance.due_date exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='closed_at') = 0, 'ALTER TABLE grievance ADD COLUMN closed_at DATETIME NULL', 'SELECT ''grievance.closed_at exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='investigation_notes') = 0, 'ALTER TABLE grievance ADD COLUMN investigation_notes TEXT NULL', 'SELECT ''grievance.investigation_notes exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 5. sensitive_action_log ─────────────────────────────────────────────────
-- Reuse the platform table from 015_platform_foundation.sql. Do not redefine
-- it here; helpdesk/grievance logging writes through backend/src/shared/auditLog.ts.

-- ─── 6. Page catalog entries ──────────────────────────────────────────────────
INSERT IGNORE INTO page_catalog (page_code, page_name, description, module, active_status)
VALUES
  ('PEOPLE_EXPERIENCE_COMMAND_CENTER', 'People Experience Command Center',
   'Employee engagement health, risk watchlist, action management', 'engagement', 1),
  ('SUPPORT_COMMAND_CENTER', 'Support Command Center',
   'Helpdesk SLA dashboard, owner workload, ticket analytics', 'helpdesk', 1),
  ('GRIEVANCE_COMMAND_CENTER', 'Grievance Command Center',
   'Confidential grievance case management for HR/admin', 'helpdesk', 1);

INSERT IGNORE INTO role_page_access (role_key, page_code)
VALUES
  ('super_admin', 'PEOPLE_EXPERIENCE_COMMAND_CENTER'),
  ('admin',       'PEOPLE_EXPERIENCE_COMMAND_CENTER'),
  ('hr',          'PEOPLE_EXPERIENCE_COMMAND_CENTER'),
  ('manager',     'PEOPLE_EXPERIENCE_COMMAND_CENTER'),
  ('process_manager', 'PEOPLE_EXPERIENCE_COMMAND_CENTER'),
  ('super_admin', 'SUPPORT_COMMAND_CENTER'),
  ('admin',       'SUPPORT_COMMAND_CENTER'),
  ('hr',          'SUPPORT_COMMAND_CENTER'),
  ('manager',     'SUPPORT_COMMAND_CENTER'),
  ('process_manager', 'SUPPORT_COMMAND_CENTER'),
  ('super_admin', 'GRIEVANCE_COMMAND_CENTER'),
  ('admin',       'GRIEVANCE_COMMAND_CENTER'),
  ('hr',          'GRIEVANCE_COMMAND_CENTER');
