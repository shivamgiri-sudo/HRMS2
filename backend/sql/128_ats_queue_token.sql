-- Migration 128: Queue token table for walk-in candidate tracking
-- Tracks arrival, current stage, recruiter/interviewer assignment, and wait-time alerting.
-- One active token per candidate enforced by partial unique index on (candidate_id, status='active').

CREATE TABLE IF NOT EXISTS ats_queue_token (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id              CHAR(36)      NOT NULL,
  token                     CHAR(36)      NOT NULL UNIQUE,
  arrival_time              DATETIME      NOT NULL,
  current_stage             VARCHAR(100)  NOT NULL DEFAULT 'Arrived',
  assigned_recruiter_id     CHAR(36)      NULL,
  assigned_interviewer_id   CHAR(36)      NULL,
  status                    ENUM('active','walked_out','completed') NOT NULL DEFAULT 'active',
  wait_alert_sent           TINYINT(1)    NOT NULL DEFAULT 0,
  walk_out_at               DATETIME      NULL,
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id)            REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_recruiter_id)   REFERENCES employees(id)     ON DELETE SET NULL,
  FOREIGN KEY (assigned_interviewer_id) REFERENCES employees(id)     ON DELETE SET NULL,
  INDEX idx_ats_queue_candidate (candidate_id),
  INDEX idx_ats_queue_status   (status)
);

-- Partial unique: only one active token per candidate at a time.
-- MySQL does not support partial unique indexes directly; we enforce this in service layer
-- and use the unique token column to prevent duplicates.
-- A trigger alternative would be more robust but requires SUPER privilege.
