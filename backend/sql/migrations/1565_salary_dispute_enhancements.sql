-- Salary Dispute Enhancements: attachments, SLA, appeal

-- 1. Add SLA and appeal columns
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='salary_dispute' AND COLUMN_NAME='sla_due_at') = 0,
  'ALTER TABLE salary_dispute ADD COLUMN sla_due_at DATETIME NULL COMMENT "WFM must review by this time"',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='salary_dispute' AND COLUMN_NAME='sla_breached') = 0,
  'ALTER TABLE salary_dispute ADD COLUMN sla_breached TINYINT(1) DEFAULT 0',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='salary_dispute' AND COLUMN_NAME='appeal_count') = 0,
  'ALTER TABLE salary_dispute ADD COLUMN appeal_count INT DEFAULT 0',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='salary_dispute' AND COLUMN_NAME='appeal_reason') = 0,
  'ALTER TABLE salary_dispute ADD COLUMN appeal_reason TEXT NULL',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='salary_dispute' AND COLUMN_NAME='original_dispute_id') = 0,
  'ALTER TABLE salary_dispute ADD COLUMN original_dispute_id CHAR(36) NULL COMMENT "Links appeal to original dispute"',
  'SELECT 1'
); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Attachments table
CREATE TABLE IF NOT EXISTS salary_dispute_attachment (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  dispute_id      CHAR(36)      NOT NULL,
  file_name       VARCHAR(255)  NOT NULL,
  file_path       VARCHAR(500)  NOT NULL,
  file_type       VARCHAR(100)  NULL,
  file_size       INT           NULL,
  uploaded_by     CHAR(36)      NOT NULL,
  uploaded_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dispute (dispute_id),
  FOREIGN KEY (dispute_id) REFERENCES salary_dispute(id) ON DELETE CASCADE
);

-- 3. Audit log table for detailed tracking
CREATE TABLE IF NOT EXISTS salary_dispute_audit (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  dispute_id      CHAR(36)      NOT NULL,
  action          VARCHAR(50)   NOT NULL COMMENT 'raised, wfm_approved, wfm_rejected, ph_approved, ph_rejected, withdrawn, appealed, escalated',
  actor_user_id   CHAR(36)      NOT NULL,
  actor_role      VARCHAR(50)   NULL,
  from_status     VARCHAR(30)   NULL,
  to_status       VARCHAR(30)   NULL,
  remarks         TEXT          NULL,
  metadata_json   JSON          NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dispute (dispute_id),
  INDEX idx_actor (actor_user_id),
  INDEX idx_action (action)
);

-- 4. SLA config table
CREATE TABLE IF NOT EXISTS salary_dispute_sla_config (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  stage           VARCHAR(30)   NOT NULL UNIQUE COMMENT 'pending_wfm, pending_payroll_head',
  sla_hours       INT           NOT NULL DEFAULT 48,
  escalate_to     VARCHAR(100)  NULL COMMENT 'Role to escalate to on breach',
  active_status   TINYINT(1)    DEFAULT 1,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default SLA config
INSERT INTO salary_dispute_sla_config (id, stage, sla_hours, escalate_to) VALUES
  (UUID(), 'pending_wfm', 48, 'payroll_head'),
  (UUID(), 'pending_payroll_head', 24, 'cfo')
ON DUPLICATE KEY UPDATE sla_hours = VALUES(sla_hours);

SELECT '1565_salary_dispute_enhancements.sql applied' AS status;
