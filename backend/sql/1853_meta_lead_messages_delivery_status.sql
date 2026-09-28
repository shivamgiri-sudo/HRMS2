-- 1853_meta_lead_messages_delivery_status.sql
--
-- Adds delivery tracking to meta_lead_messages. Until now an outbound row was written the moment
-- Wassenger ACCEPTED a message into its queue and the inbox drew double ticks for it, so 54
-- messages stuck in a frozen Wassenger queue looked delivered. delivery_status holds the real
-- state (queued / sent / delivered / read / failed), updated from Wassenger's message:update
-- webhook and reconciled by the 30-minute Meta sync.
--
-- Additive, nullable, idempotent (information_schema guards; ADD COLUMN IF NOT EXISTS is rejected
-- by this MySQL 8.0.42). ROLLBACK: ALTER TABLE meta_lead_messages DROP COLUMN delivery_status,
-- DROP COLUMN delivery_updated_at;

SET @col1 = (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_lead_messages' AND COLUMN_NAME = 'delivery_status');
SET @sql1 = IF(@col1 = 0,
  'ALTER TABLE meta_lead_messages ADD COLUMN delivery_status VARCHAR(20) NULL COMMENT ''queued/sent/delivered/read/failed for outbound; NULL = unknown or inbound''',
  'SELECT ''meta_lead_messages.delivery_status already exists'' AS message');
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @col2 = (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_lead_messages' AND COLUMN_NAME = 'delivery_updated_at');
SET @sql2 = IF(@col2 = 0,
  'ALTER TABLE meta_lead_messages ADD COLUMN delivery_updated_at DATETIME NULL',
  'SELECT ''meta_lead_messages.delivery_updated_at already exists'' AS message');
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

SELECT '✓ Migration 1853_meta_lead_messages_delivery_status.sql complete' AS status;
