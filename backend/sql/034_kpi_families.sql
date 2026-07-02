-- 034_kpi_families.sql
-- Add family column to kpi_metric_master and create training_need table.
USE mas_hrms;

-- Add family column if it doesn't already exist
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'kpi_metric_master'
     AND COLUMN_NAME  = 'family') = 0,
  "ALTER TABLE kpi_metric_master ADD COLUMN family ENUM('operations','quality','performance','custom') NOT NULL DEFAULT 'performance' AFTER metric_name",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Classify existing seeded metrics to their correct families
UPDATE kpi_metric_master
SET family = 'operations'
WHERE metric_code IN ('AHT','ACW','FCR','ADHERENCE','SHRINKAGE','OCCUPANCY','ATTRITION','THROUGHPUT','HOLD_TIME','TALK_TIME');

UPDATE kpi_metric_master
SET family = 'quality'
WHERE metric_code IN ('CSAT','QA_SCORE','QUALITY_SCORE','FATAL_RATE','COMPLIANCE','NPS','REPEAT_CONTACT','ESCALATIONS');

UPDATE kpi_metric_master
SET family = 'performance'
WHERE metric_code IN ('GOAL_COMPLETION','ATTENDANCE_SCORE','ATTENDANCE_PCT','CONVERSION_RATE','REVENUE','DIALS');

-- Training Needs Identification table
CREATE TABLE IF NOT EXISTS training_need (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id         CHAR(36)     NOT NULL,
  metric_id           CHAR(36)     COMMENT 'KPI metric that triggered the need',
  coaching_session_id CHAR(36)     COMMENT 'Source coaching session if auto-created',
  need_type           VARCHAR(64)  NOT NULL COMMENT 'product_knowledge,soft_skills,compliance,technical,process',
  description         TEXT,
  priority            ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status              ENUM('identified','mapped_to_lms','in_training','completed','closed') NOT NULL DEFAULT 'identified',
  identified_by       CHAR(36),
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tni_emp       (employee_id),
  INDEX idx_tni_metric    (metric_id),
  INDEX idx_tni_coaching  (coaching_session_id),
  INDEX idx_tni_status    (status)
);
