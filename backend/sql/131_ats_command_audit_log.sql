-- 131_ats_command_audit_log.sql
USE mas_hrms;

-- Generic audit log used by the atsFullParity audit() helper
CREATE TABLE IF NOT EXISTS ats_command_audit_log (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  actor         VARCHAR(255),
  action        VARCHAR(100) NOT NULL,
  candidate_id  CHAR(36),
  details       TEXT,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_candidate (candidate_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_created (created_at)
);
