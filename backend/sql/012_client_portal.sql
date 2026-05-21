-- 012_client_portal.sql
USE mas_hrms;

-- Client companies
CREATE TABLE IF NOT EXISTS client_master (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_code  VARCHAR(50)  NOT NULL UNIQUE,
  client_name  VARCHAR(255) NOT NULL,
  active_status TINYINT(1)  NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Link processes to clients (add column only if missing)
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='process_master' AND COLUMN_NAME='client_id') = 0,
  'ALTER TABLE process_master ADD COLUMN client_id CHAR(36) NULL, ADD CONSTRAINT fk_process_client FOREIGN KEY (client_id) REFERENCES client_master(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Portal users (one per contact at the client company)
CREATE TABLE IF NOT EXISTS client_user (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_id    CHAR(36)     NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  designation  VARCHAR(255),
  process_ids  JSON         NOT NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES client_master(id) ON DELETE CASCADE
);

-- OTP store (6-digit, bcrypt-hashed, 10-min TTL, single-use)
CREATE TABLE IF NOT EXISTS portal_otp (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  otp_hash   VARCHAR(255) NOT NULL,
  expires_at DATETIME     NOT NULL,
  used       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_portal_otp_email (email)
);

-- Access log (90-day retention)
CREATE TABLE IF NOT EXISTS portal_access_log (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_user_id CHAR(36)     NOT NULL,
  page           VARCHAR(255) NOT NULL,
  ip_address     VARCHAR(45),
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pal_user (client_user_id),
  INDEX idx_pal_time (created_at)
);

-- Glide path commitments (ops team commits to improvement trajectory)
CREATE TABLE IF NOT EXISTS glide_path_commitment (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36)       NOT NULL,
  metric_id       CHAR(36)       NOT NULL,
  month           CHAR(7)        NOT NULL,
  committed_value DECIMAL(12,4)  NOT NULL,
  committed_by    CHAR(36)       NOT NULL,
  is_locked       TINYINT(1)     NOT NULL DEFAULT 0,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_glide (process_id, metric_id, month),
  INDEX idx_glide_process (process_id),
  FOREIGN KEY (metric_id) REFERENCES kpi_metric_master(id) ON DELETE CASCADE
);

-- Action plans (one per off-track metric)
CREATE TABLE IF NOT EXISTS action_plan (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id  CHAR(36)     NOT NULL,
  metric_id   CHAR(36)     NOT NULL,
  action_text TEXT         NOT NULL,
  owner_level ENUM('analyst','tl','process_manager','branch_head') NOT NULL,
  owner_name  VARCHAR(255) NOT NULL,
  due_date    DATE         NOT NULL,
  status      ENUM('planned','in_progress','done','delayed') NOT NULL DEFAULT 'planned',
  created_by  CHAR(36)     NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ap_process (process_id),
  FOREIGN KEY (metric_id) REFERENCES kpi_metric_master(id) ON DELETE CASCADE
);

-- Governance activity master (seed data defines the activities)
CREATE TABLE IF NOT EXISTS governance_activity_master (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  activity_name  VARCHAR(255) NOT NULL,
  level          ENUM('analyst','tl','process_manager','branch_head') NOT NULL,
  frequency      ENUM('daily','weekly','monthly') NOT NULL,
  required_count INT          NOT NULL DEFAULT 1,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1
);

-- Governance log (how many times activity was completed per period)
CREATE TABLE IF NOT EXISTS governance_checklist_log (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36)  NOT NULL,
  period          CHAR(7)   NOT NULL,
  activity_id     CHAR(36)  NOT NULL,
  completed_count INT       NOT NULL DEFAULT 0,
  updated_by      CHAR(36)  NOT NULL,
  updated_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gov_log (process_id, period, activity_id),
  FOREIGN KEY (activity_id) REFERENCES governance_activity_master(id) ON DELETE CASCADE
);

-- Management commentary (one per process per month)
CREATE TABLE IF NOT EXISTS management_commentary (
  id                             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id                     CHAR(36)     NOT NULL,
  period                         CHAR(7)      NOT NULL,
  author_id                      CHAR(36)     NOT NULL,
  author_name                    VARCHAR(255) NOT NULL,
  author_designation             VARCHAR(255) NOT NULL,
  body                           TEXT         NOT NULL,
  published_at                   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at                DATETIME     NULL,
  acknowledged_by_client_user_id CHAR(36)     NULL,
  UNIQUE KEY uq_commentary (process_id, period),
  INDEX idx_commentary_process (process_id)
);

-- Commentary replies from client users
CREATE TABLE IF NOT EXISTS management_commentary_reply (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  commentary_id             CHAR(36)      NOT NULL,
  replied_by_client_user_id CHAR(36)      NOT NULL,
  reply_text                VARCHAR(1000) NOT NULL,
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (commentary_id) REFERENCES management_commentary(id) ON DELETE CASCADE
);

-- Seed governance activities
INSERT IGNORE INTO governance_activity_master (id, activity_name, level, frequency, required_count) VALUES
  (UUID(), 'Adherence Check', 'analyst', 'daily', 20),
  (UUID(), 'QA Calibration Attendance', 'analyst', 'monthly', 2),
  (UUID(), 'Floor Walk', 'tl', 'weekly', 4),
  (UUID(), 'Team Briefing', 'tl', 'weekly', 4),
  (UUID(), 'Coaching Session', 'tl', 'monthly', 4),
  (UUID(), 'MIS Review', 'process_manager', 'weekly', 4),
  (UUID(), 'Escalation Review', 'process_manager', 'weekly', 2),
  (UUID(), 'SIP Review', 'process_manager', 'monthly', 1),
  (UUID(), 'Client Review Meeting', 'branch_head', 'monthly', 1),
  (UUID(), 'P&L Review', 'branch_head', 'monthly', 1),
  (UUID(), 'Headcount Review', 'branch_head', 'monthly', 1);
