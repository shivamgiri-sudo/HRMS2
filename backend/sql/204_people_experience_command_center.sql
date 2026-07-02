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

ALTER TABLE helpdesk_ticket
  MODIFY COLUMN category VARCHAR(100) NOT NULL,
  MODIFY COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS sla_due_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS breached_flag TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_level INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_department VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS root_cause VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS closure_rating INT NULL,
  ADD COLUMN IF NOT EXISTS reopened_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impact_type VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS employee_blocked TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS productivity_impact TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payroll_impact TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS system_access_impact TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE grievance
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS due_date DATE NULL,
  ADD COLUMN IF NOT EXISTS escalation_level INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidentiality_level VARCHAR(30) NOT NULL DEFAULT 'restricted',
  ADD COLUMN IF NOT EXISTS anti_retaliation_flag TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_committee VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS evidence_count INT NOT NULL DEFAULT 0;

SELECT 'Migration 204 applied: People Experience command center tables and support metadata ready' AS status;
