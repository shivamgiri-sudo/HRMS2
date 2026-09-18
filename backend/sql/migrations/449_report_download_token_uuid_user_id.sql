-- Migration 449: fix report_download_token user ID columns
-- INT UNSIGNED was wrong: auth_user.id is CHAR(36) UUID throughout the codebase.
-- MySQL strict mode rejects inserting a UUID string into an INT column, so every
-- restricted/highly_restricted report has failed at the createDownloadToken step
-- since migration 414 was applied. All existing rows (if any) carry 0 — they are
-- unusable regardless, so the MODIFY is safe to apply without data-loss concern.
-- DIRECTION: ADDITIVE — no existing business data altered.

ALTER TABLE report_download_token
  MODIFY COLUMN requesting_user_id  CHAR(36) NOT NULL,
  MODIFY COLUMN revoked_by_user_id  CHAR(36) NULL;
