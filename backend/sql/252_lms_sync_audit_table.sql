-- LMS Sync Audit table (if not already created by migration 251)
CREATE TABLE IF NOT EXISTS lms_sync_audit (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  sync_type VARCHAR(50) NOT NULL COMMENT 'learner_progress, assessment_scores, etc',
  status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending, completed, failed',
  rows_synced INT DEFAULT 0,
  rows_failed INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  KEY idx_sync_type (sync_type),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
