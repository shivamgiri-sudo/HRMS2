-- Migration 1994: Ops Control Tower joiner nudge log.
-- One row per nudge attempt (manual "Notify" click or the 24h auto sweep). Cooldown and the
-- "last nudged / count" columns on the tower are derived from rows with status = 'sent'.
CREATE TABLE IF NOT EXISTS ops_nudge_log (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)     NOT NULL,
  candidate_id  CHAR(36)     NULL,
  branch_id     CHAR(36)     NULL,
  issue_key     VARCHAR(40)  NOT NULL,
  channel       VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
  trigger_type  ENUM('manual','auto') NOT NULL,
  status        ENUM('sent','failed','skipped_unconfigured','skipped_no_contact','skipped_not_joining') NOT NULL,
  sent_by       CHAR(36)     NULL,
  error_message VARCHAR(500)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ops_nudge_emp_issue (employee_id, issue_key, status, created_at),
  KEY idx_ops_nudge_branch (branch_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
