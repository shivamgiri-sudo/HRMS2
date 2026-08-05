-- 1077_ai_prompt_audit_detected_intent.sql
-- Adds a detected_intent column to ai_prompt_audit_log so Mira Analytics can
-- show top-intent breakdowns for requests going forward. question_hash and
-- sanitized_context_hash are one-way hashes (SHA-256) with nothing to derive
-- intent from retroactively — this only instruments future requests, it does
-- not and cannot backfill historical rows.
--
-- Additive and idempotent, matching this repo's established pattern for
-- ALTER TABLE migrations (see 1071_onboarding_reminder_sent_at.sql).

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'ai_prompt_audit_log'
     AND COLUMN_NAME = 'detected_intent'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE ai_prompt_audit_log ADD COLUMN detected_intent VARCHAR(80) NULL AFTER response_summary',
  'SELECT "detected_intent already present" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'ai_prompt_audit_log'
     AND INDEX_NAME = 'idx_ai_prompt_intent_created'
);

SET @idx_ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE ai_prompt_audit_log ADD KEY idx_ai_prompt_intent_created (detected_intent, created_at)',
  'SELECT "idx_ai_prompt_intent_created already present" AS note'
);

PREPARE idx_stmt FROM @idx_ddl;
EXECUTE idx_stmt;
DEALLOCATE PREPARE idx_stmt;
