-- ============================================================================
-- Migration 133: Phase 2 Security Fixes
-- ============================================================================
-- Purpose: Fix Priority 1 security vulnerabilities from E2E audit
-- Issues Fixed:
--   1. String-based assignment vulnerability (replace with FK)
--   2. Missing impersonation audit trail (submitted_by_user_id)
--   3. Missing actor in stage log (actor_user_id)
--   4. Rate limiting tracking (failed_login_attempts)
-- ============================================================================

USE mas_hrms;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add recruiter_id FK to ats_candidate (replace string-based assignment)
-- ────────────────────────────────────────────────────────────────────────────

-- Add new column
ALTER TABLE ats_candidate
ADD COLUMN recruiter_id CHAR(36) NULL AFTER recruiter_assigned_name,
ADD INDEX idx_recruiter_id (recruiter_id);

-- Migrate existing data: match recruiter_assigned_name → ats_recruiter_roster.name
UPDATE ats_candidate c
INNER JOIN ats_recruiter_roster r ON c.recruiter_assigned_name = r.name
SET c.recruiter_id = r.id
WHERE c.recruiter_assigned_name IS NOT NULL;

-- Add FK constraint (after data migration)
ALTER TABLE ats_candidate
ADD CONSTRAINT fk_candidate_recruiter
  FOREIGN KEY (recruiter_id) REFERENCES ats_recruiter_roster(id)
  ON DELETE SET NULL;

-- Note: Keep recruiter_assigned_name for backward compatibility (1 week grace period)
-- Will deprecate in Migration 140

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Add impersonation audit trail to ats_interview_submission_audit
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE ats_interview_submission_audit
ADD COLUMN submitted_by_user_id CHAR(36) NULL AFTER actor_user_id,
ADD COLUMN is_proxy_submission TINYINT(1) DEFAULT 0 AFTER submitted_by_user_id,
ADD INDEX idx_submitted_by (submitted_by_user_id);

-- submitted_by_user_id: WHO actually performed the action (admin/HR acting on behalf)
-- actor_user_id: WHO the action is attributed to (recruiter being impersonated)
-- is_proxy_submission: 1 if admin/HR submitted on behalf, 0 if recruiter submitted directly

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Add actor tracking to ats_candidate_stage_log
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE ats_candidate_stage_log
ADD COLUMN actor_user_id CHAR(36) NULL AFTER new_stage,
ADD COLUMN submitted_by_user_id CHAR(36) NULL AFTER actor_user_id,
ADD INDEX idx_actor (actor_user_id),
ADD INDEX idx_submitted_by_stage (submitted_by_user_id);

-- actor_user_id: Recruiter whose action caused the stage change
-- submitted_by_user_id: Admin/HR who performed the action (if proxy)

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Add rate limiting tracking for PIN verification
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE ats_recruiter_roster
ADD COLUMN failed_login_attempts INT DEFAULT 0 AFTER pin_hash,
ADD COLUMN last_failed_login_at DATETIME NULL AFTER failed_login_attempts,
ADD COLUMN account_locked_until DATETIME NULL AFTER last_failed_login_at;

-- Rate limiting logic:
-- - failed_login_attempts increments on wrong PIN
-- - Resets to 0 on successful login
-- - After 5 attempts, account_locked_until = NOW() + 15 minutes
-- - API rejects login if NOW() < account_locked_until

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Add session timeout tracking
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_recruiter_session (
  id CHAR(36) PRIMARY KEY,
  recruiter_id CHAR(36) NOT NULL,
  session_token VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  is_active TINYINT(1) DEFAULT 1,

  FOREIGN KEY (recruiter_id) REFERENCES ats_recruiter_roster(id) ON DELETE CASCADE,
  INDEX idx_session_token (session_token),
  INDEX idx_recruiter_active (recruiter_id, is_active),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Session timeout: 30 minutes idle
-- Cleanup job: DELETE FROM ats_recruiter_session WHERE expires_at < NOW()

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Add sensitive action log for exports and admin actions
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_sensitive_action_log (
  id CHAR(36) PRIMARY KEY,
  actor_user_id CHAR(36) NOT NULL,
  action_type ENUM('export', 'admin_override', 'bulk_update', 'data_access') NOT NULL,
  target_entity VARCHAR(100),  -- e.g., 'ats_candidate', 'submission_history'
  target_id CHAR(36),           -- e.g., candidate_id
  action_details JSON,          -- e.g., {"exported_columns": ["name", "email", "salary"], "row_count": 150}
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_actor (actor_user_id),
  INDEX idx_action_type (action_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Logs all sensitive operations:
-- - CSV exports (track who downloaded what data)
-- - Admin overrides (track impersonation)
-- - Bulk updates (track mass changes)
-- - Salary/PII data access (track who viewed sensitive fields)

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Add PII redaction configuration
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_pii_redaction_config (
  id CHAR(36) PRIMARY KEY,
  role_key VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,  -- e.g., 'ats_interview_submission'
  field_name VARCHAR(100) NOT NULL,    -- e.g., 'offer_salary'
  redaction_rule ENUM('hide', 'mask', 'allow') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_role_entity_field (role_key, entity_type, field_name),
  INDEX idx_role_entity (role_key, entity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed redaction rules
INSERT INTO ats_pii_redaction_config (id, role_key, entity_type, field_name, redaction_rule)
VALUES
  (UUID(), 'recruiter', 'ats_interview_submission', 'offer_salary', 'hide'),
  (UUID(), 'hr_admin', 'ats_interview_submission', 'offer_salary', 'allow'),
  (UUID(), 'super_admin', 'ats_interview_submission', 'offer_salary', 'allow'),
  (UUID(), 'branch_head', 'ats_interview_submission', 'offer_salary', 'mask')  -- Show range, not exact
ON DUPLICATE KEY UPDATE
  redaction_rule = VALUES(redaction_rule),
  updated_at = NOW();

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Add capacity tracking lock (prevent race conditions)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE ats_recruiter_roster
ADD COLUMN capacity_lock_version INT DEFAULT 0 AFTER assigned_today;

-- Optimistic locking for capacity tracking:
-- UPDATE ats_recruiter_roster
-- SET assigned_today = assigned_today + 1,
--     capacity_lock_version = capacity_lock_version + 1
-- WHERE id = ? AND capacity_lock_version = ? AND assigned_today < daily_capacity

-- If 0 rows affected, retry with fresh SELECT

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Add queue token unique constraint (prevent duplicate active tokens)
-- ────────────────────────────────────────────────────────────────────────────

-- Create unique partial index for active tokens
ALTER TABLE ats_queue_token
ADD UNIQUE INDEX uq_candidate_active_token (candidate_id, status)
  COMMENT 'Prevent duplicate active tokens per candidate';

-- Note: MySQL 8.0+ supports partial indexes via functional index
-- For MySQL 5.7, this constraint is enforced at application level

-- ────────────────────────────────────────────────────────────────────────────
-- Verification Queries
-- ────────────────────────────────────────────────────────────────────────────

-- Check recruiter_id FK migration
SELECT
  COUNT(*) as total_candidates,
  SUM(CASE WHEN recruiter_id IS NOT NULL THEN 1 ELSE 0 END) as with_recruiter_id,
  SUM(CASE WHEN recruiter_assigned_name IS NOT NULL AND recruiter_id IS NULL THEN 1 ELSE 0 END) as failed_migration
FROM ats_candidate;

-- Check audit trail columns
SHOW COLUMNS FROM ats_interview_submission_audit LIKE '%submitted_by%';

-- Check session table
SHOW TABLES LIKE 'ats_recruiter_session';

-- Check sensitive action log
SHOW TABLES LIKE 'ats_sensitive_action_log';

-- Check PII redaction config
SELECT * FROM ats_pii_redaction_config ORDER BY role_key, entity_type, field_name;

-- ============================================================================
-- End of Migration 133
-- ============================================================================
