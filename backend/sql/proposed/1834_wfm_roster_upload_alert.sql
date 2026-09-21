-- PROPOSED, NOT APPLIED. To activate: move to backend/sql/, add to MIGRATION_MANIFEST in
-- src/db/runPendingMigrations.ts and regenerate the lock (scripts/update-migration-lock.mjs).
-- Kept under proposed/ so the manifest guard does not treat it as a forgotten migration.
--
-- 1834: notification log for the weekly roster-upload tracker.
--
-- One row per (branch, process, week, stage, recipient) alert sent by
-- modules/wfm/roster-upload-escalation.service.ts. The unique key is the claim that stops the same
-- stage being sent twice to the same person; 'manual' rows (Send reminder now) refresh sent_at.
--
-- Purely additive: new table only, no existing object is touched. The tracker grid works without
-- it (its notification trail is just empty); the escalation sweep needs it.
CREATE TABLE IF NOT EXISTS wfm_roster_upload_alert (
  id                CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  branch_id         CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  process_id        CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  week_start        DATE        NOT NULL COMMENT 'Monday of the W/C week the roster is for',
  stage             VARCHAR(20) NOT NULL COMMENT 'reminder | heads_up | missing | escalated | late_upload | manual',
  recipient_user_id CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  recipient_role    VARCHAR(20) NOT NULL COMMENT 'wfm | manager | skip_level',
  sent_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_upload_alert (branch_id, process_id, week_start, stage, recipient_user_id),
  KEY idx_upload_alert_week (week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
