-- Migration 339: Payroll validation and rejection workflow
-- Adds formal validate/reject step between calculation and NEFT export.
-- Salary transfer file (NEFT) can only be generated from a 'validated' run.

ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS validation_status ENUM('pending','validated','rejected') NOT NULL DEFAULT 'pending' AFTER status,
  ADD COLUMN IF NOT EXISTS validated_by       CHAR(36) NULL AFTER validation_status,
  ADD COLUMN IF NOT EXISTS validated_at       DATETIME NULL AFTER validated_by,
  ADD COLUMN IF NOT EXISTS rejection_reason   TEXT     NULL AFTER validated_at,
  ADD COLUMN IF NOT EXISTS rejected_by        CHAR(36) NULL AFTER rejection_reason,
  ADD COLUMN IF NOT EXISTS rejected_at        DATETIME NULL AFTER rejected_by;

-- Audit trail for each validate/reject action
CREATE TABLE IF NOT EXISTS payroll_validation_log (
  id              CHAR(36)     NOT NULL,
  run_id          CHAR(36)     NOT NULL,
  action          ENUM('validated','rejected','reopened') NOT NULL,
  actor_id        CHAR(36)     NOT NULL,
  actor_role      VARCHAR(100) NOT NULL,
  reason          TEXT         NULL,
  snapshot_json   JSON         NULL,     -- key figures at time of action
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pvl_run (run_id),
  INDEX idx_pvl_actor (actor_id)
);
