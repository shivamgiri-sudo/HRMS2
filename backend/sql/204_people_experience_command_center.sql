USE mas_hrms;

CREATE TABLE IF NOT EXISTS people_experience_health_snapshot (
  id                         CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id                 CHAR(36) NOT NULL,
  snapshot_date               DATE NOT NULL,
  engagement_score            DECIMAL(5,2) NOT NULL DEFAULT 0,
  data_confidence_score       DECIMAL(5,2) NOT NULL DEFAULT 0,
  risk_label                  VARCHAR(50) NOT NULL DEFAULT 'stable',
  pulse_score                 DECIMAL(5,2) NOT NULL DEFAULT 0,
  recognition_score           DECIMAL(5,2) NOT NULL DEFAULT 0,
  participation_score         DECIMAL(5,2) NOT NULL DEFAULT 0,
  attendance_score            DECIMAL(5,2) NOT NULL DEFAULT 0,
  performance_score           DECIMAL(5,2) NOT NULL DEFAULT 0,
  support_friction_score      DECIMAL(5,2) NOT NULL DEFAULT 0,
  career_growth_score         DECIMAL(5,2) NOT NULL DEFAULT 0,
  top_risk_drivers_json       JSON NULL,
  recommended_actions_json    JSON NULL,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_px_health_employee_date (employee_id, snapshot_date),
  INDEX idx_px_health_date_risk (snapshot_date, risk_label),
  INDEX idx_px_health_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Explainable People Experience health snapshots used by command center';

CREATE TABLE IF NOT EXISTS people_experience_action (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36) NOT NULL,
  source_type     VARCHAR(50) NOT NULL,
  source_id       CHAR(36) NULL,
  action_type     VARCHAR(80) NOT NULL,
  priority        VARCHAR(20) NOT NULL DEFAULT 'medium',
  owner_user_id   CHAR(36) NULL,
  due_date        DATE NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'open',
  notes           TEXT NULL,
  completed_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_px_action_employee (employee_id),
  INDEX idx_px_action_owner_status (owner_user_id, status),
  INDEX idx_px_action_due (due_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Manager/HR action queue for engagement risk, support SLA and grievance follow-up';

-- Normalise existing support workflow fields. These columns are part of the
-- canonical helpdesk/grievance base tables and should fail visibly if that base
-- schema is missing rather than silently manufacturing a competing structure.
ALTER TABLE helpdesk_ticket
  MODIFY COLUMN category VARCHAR(100) NOT NULL,
  MODIFY COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'open';

-- MySQL 8.4 does not support ADD COLUMN IF NOT EXISTS. Guard every additive
-- People Experience field explicitly against the active database.
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='sla_due_at');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN sla_due_at DATETIME NULL', 'SELECT ''helpdesk_ticket.sla_due_at exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='breached_flag');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN breached_flag TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.breached_flag exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='escalation_level');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN escalation_level INT NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.escalation_level exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='assigned_department');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN assigned_department VARCHAR(100) NULL', 'SELECT ''helpdesk_ticket.assigned_department exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='root_cause');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN root_cause VARCHAR(255) NULL', 'SELECT ''helpdesk_ticket.root_cause exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='closure_rating');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN closure_rating INT NULL', 'SELECT ''helpdesk_ticket.closure_rating exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='reopened_count');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN reopened_count INT NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.reopened_count exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='impact_type');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN impact_type VARCHAR(100) NULL', 'SELECT ''helpdesk_ticket.impact_type exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='employee_blocked');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN employee_blocked TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.employee_blocked exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='productivity_impact');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN productivity_impact TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.productivity_impact exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='payroll_impact');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN payroll_impact TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.payroll_impact exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='helpdesk_ticket' AND COLUMN_NAME='system_access_impact');
SET @ddl = IF(@exists=0, 'ALTER TABLE helpdesk_ticket ADD COLUMN system_access_impact TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''helpdesk_ticket.system_access_impact exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE grievance
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'submitted';

SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='severity');
SET @ddl = IF(@exists=0, 'ALTER TABLE grievance ADD COLUMN severity VARCHAR(20) NOT NULL DEFAULT ''medium''', 'SELECT ''grievance.severity exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='due_date');
SET @ddl = IF(@exists=0, 'ALTER TABLE grievance ADD COLUMN due_date DATE NULL', 'SELECT ''grievance.due_date exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='escalation_level');
SET @ddl = IF(@exists=0, 'ALTER TABLE grievance ADD COLUMN escalation_level INT NOT NULL DEFAULT 0', 'SELECT ''grievance.escalation_level exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='confidentiality_level');
SET @ddl = IF(@exists=0, 'ALTER TABLE grievance ADD COLUMN confidentiality_level VARCHAR(30) NOT NULL DEFAULT ''restricted''', 'SELECT ''grievance.confidentiality_level exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='anti_retaliation_flag');
SET @ddl = IF(@exists=0, 'ALTER TABLE grievance ADD COLUMN anti_retaliation_flag TINYINT(1) NOT NULL DEFAULT 1', 'SELECT ''grievance.anti_retaliation_flag exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='assigned_committee');
SET @ddl = IF(@exists=0, 'ALTER TABLE grievance ADD COLUMN assigned_committee VARCHAR(255) NULL', 'SELECT ''grievance.assigned_committee exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='grievance' AND COLUMN_NAME='evidence_count');
SET @ddl = IF(@exists=0, 'ALTER TABLE grievance ADD COLUMN evidence_count INT NOT NULL DEFAULT 0', 'SELECT ''grievance.evidence_count exists'' AS migration_note'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 204 applied: People Experience command center tables and support metadata ready' AS status;
