-- Migration 2078: bring the recreated upload_batch_row back to its full schema, and set the upload-batch
-- retention policy to 7 days for every upload type.
--
-- upload_batch_row was dropped from production and recreated (2026-10-03) from migration 068 alone: 8 columns
-- and the 068/069 keys. Migrations 1522 and 1657 are already recorded as applied, so they never re-run, and the
-- table was left without what they added. Anything using the created-entity link (bulk regularization uploads)
-- or the two-stage approval discard would fail. This adds exactly those, each guarded, so it is a no-op for any
-- column or index that already exists:
--   1522  created_entity_type VARCHAR(50), created_entity_id VARCHAR(36), idx_upload_batch_row_entity
--   1657  discarded_by VARCHAR(36), discarded_at DATETIME, discard_stage VARCHAR(30), discard_reason TEXT,
--         idx_ubr_batch_status (upload_batch_id, row_status)
-- Columns are placed where the originals were (after row_status / after error_messages), all NULLable, so existing
-- rows are untouched and no default has to be back-filled.
--
-- Retention: the retention worker snapshots counts then deletes the rows of FINISHED batches older than
-- retain_days / retain_failed_days. The policy held 7/30 (default) and 14/60 (money, statutory, master data);
-- the owner asked for 7 days across the board (2026-10-03), so every row becomes 7/7. Batches that are still
-- uploaded / validated / processing are never purged.

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN created_entity_type VARCHAR(50) NULL AFTER row_status', 'SELECT 1')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND column_name = 'created_entity_type');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN created_entity_id VARCHAR(36) NULL AFTER created_entity_type', 'SELECT 1')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND column_name = 'created_entity_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discarded_by VARCHAR(36) NULL AFTER error_messages', 'SELECT 1')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND column_name = 'discarded_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discarded_at DATETIME NULL AFTER discarded_by', 'SELECT 1')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND column_name = 'discarded_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discard_stage VARCHAR(30) NULL AFTER discarded_at', 'SELECT 1')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND column_name = 'discard_stage');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE upload_batch_row ADD COLUMN discard_reason TEXT NULL AFTER discard_stage', 'SELECT 1')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND column_name = 'discard_reason');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_upload_batch_row_entity ON upload_batch_row (created_entity_type, created_entity_id)', 'SELECT 1')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND index_name = 'idx_upload_batch_row_entity');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_ubr_batch_status ON upload_batch_row (upload_batch_id, row_status)', 'SELECT 1')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'upload_batch_row' AND index_name = 'idx_ubr_batch_status');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE upload_batch_retention_policy
   SET retain_days = 7,
       retain_failed_days = 7,
       note = CONCAT(COALESCE(note, ''), IF(note IS NULL OR note = '', '', ' | '), '7 days (owner, 2026-10-03)')
 WHERE (retain_days <> 7 OR retain_failed_days <> 7)
   AND COALESCE(note, '') NOT LIKE '%7 days (owner, 2026-10-03)%';
