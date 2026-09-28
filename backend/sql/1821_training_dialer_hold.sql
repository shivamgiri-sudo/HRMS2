-- 1821_training_dialer_hold.sql
--
-- Manual-enforcement dialer hold for critical training TAT breaches (Quality-Learning
-- Governance, FR5 / US3.3).
--
-- WHY THIS IS MANUAL, NOT AUTOMATIC
-- ----------------------------------
-- backend/src/db/dialerDb.ts enforces the Vicidial connection READ-ONLY at three layers:
-- an app-level SQL-verb allowlist (SELECT/SHOW/DESCRIBE/EXPLAIN only), a MySQL session set
-- to `SET SESSION TRANSACTION READ ONLY`, and (presumably) the DB user's own grants. That is
-- a deliberate architectural boundary, confirmed by investigation before this migration was
-- written — there is no write path into Vicidial anywhere in this codebase, and building one
-- is an infrastructure decision for whoever owns the Vicidial credentials, not something to
-- introduce silently inside a training-compliance feature.
--
-- So this table does NOT flip a switch that blocks calls. It records that a hold SHOULD
-- happen, raises a critical Work Inbox item to WFM/Ops (who already have Vicidial admin
-- access and already pause agents manually for other reasons), and gives them a place to
-- record that they did it and when it was lifted. Automatic: detection, notification, audit
-- trail. Manual: the actual pause in Vicidial, exactly as it already is today, but now with
-- evidence and an SLA instead of a hallway conversation.
--
-- WHAT
-- ----
-- training_dialer_hold  one row per employee-currently-should-be-held decision, with a
--                        state machine (requested -> applied -> lifted) and full audit
--                        columns matching account_control_log's pattern (initiated_by,
--                        reason, timestamped) since this is the same class of action
--                        (restricting someone's ability to work) just against a different
--                        system.
--
-- ADDITIVE ONLY. One new table, no alterations to any existing table.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS training_dialer_hold;

CREATE TABLE IF NOT EXISTS training_dialer_hold (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  employee_id         CHAR(36)      NOT NULL COMMENT 'employees.id',
  training_assignment_id CHAR(36)   NOT NULL COMMENT 'the breached assignment that triggered this hold',

  -- requested: system detected a CRITICAL breach and raised the Work Inbox item, nobody has
  --   confirmed action in Vicidial yet.
  -- applied: a WFM/Ops user has confirmed they paused the agent in Vicidial (manual step,
  --   this table just records it).
  -- lifted: training was completed and the hold was manually cleared in Vicidial; recorded
  --   here for the audit trail.
  -- expired: the training_assignment itself was cancelled/superseded before anyone acted —
  --   distinct from 'lifted' so the audit trail can tell "resolved by completion" from
  --   "no longer relevant".
  status              ENUM('requested','applied','lifted','expired') NOT NULL DEFAULT 'requested',

  requested_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_by          CHAR(36)          NULL COMMENT 'auth_user.id of the WFM/Ops user who confirmed the Vicidial pause',
  applied_at          DATETIME          NULL,
  lifted_by           CHAR(36)          NULL,
  lifted_at           DATETIME          NULL,
  reason              VARCHAR(500)  NOT NULL,
  notes               TEXT              NULL,

  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  -- One open hold per assignment at a time — a second CRITICAL breach on the same
  -- already-held assignment must not raise a duplicate Work Inbox item every escalation
  -- poll. A NEW assignment for the same employee (different skill gap) gets its own row.
  UNIQUE KEY uq_tdh_assignment (training_assignment_id),
  KEY idx_tdh_employee_status (employee_id, status),

  CONSTRAINT fk_tdh_employee FOREIGN KEY (employee_id)
    REFERENCES employees (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tdh_assignment FOREIGN KEY (training_assignment_id)
    REFERENCES training_assignment (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification
-- SHOW CREATE TABLE training_dialer_hold;
--   -- confirm fk_tdh_employee, fk_tdh_assignment, uq_tdh_assignment all present
