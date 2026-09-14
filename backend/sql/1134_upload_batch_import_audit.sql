-- 1134_upload_batch_import_audit.sql
--
-- Adds upload_batch.imported_by and upload_batch.imported_at, the two columns every
-- bulk-upload service already tried to write when it finished importing a batch.
--
-- WHY
--
-- upload_batch records who uploaded a file (uploaded_by) and who validated it
-- (validated_by, validated_at), but nothing about the import itself beyond
-- imported_rows and batch_status. Both bulk services closed a batch with
--
--   UPDATE upload_batch SET batch_status=?, imported_rows=?, imported_by=?, imported_at=NOW()
--
-- and neither column existed, so the statement raised ER_BAD_FIELD_ERROR and the batch
-- was never marked imported at all - imported_rows stayed unset and batch_status stayed
-- at whatever it was before. Commit 227b92c1 dropped the two names to make the update
-- work; this adds the columns so the actor and the moment are recorded rather than lost,
-- which is what the original statement was reaching for.
--
-- SHAPE
--
-- imported_by CHAR(36) NULL, matching uploaded_by and validated_by on the same table -
-- same type, same nullability, no foreign key, consistent with how the other two actor
-- columns are declared here.
--
-- imported_at DATETIME NULL, matching validated_at. Nullable because a batch that has
-- been uploaded or validated but not yet imported has no import time, and because the 4
-- existing rows predate the column.
--
-- Additive only. No existing column, index or constraint is touched. Both columns are
-- nullable with no default, so nothing is backfilled and no existing row changes.
-- Idempotent: each ADD is guarded independently by information_schema, so re-running is
-- a no-op and a partially-applied state resolves correctly.

SET @has_imported_by = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'upload_batch'
     AND column_name = 'imported_by'
);

SET @ddl = IF(@has_imported_by = 0,
  'ALTER TABLE upload_batch ADD COLUMN imported_by CHAR(36) NULL AFTER validated_at',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_imported_at = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'upload_batch'
     AND column_name = 'imported_at'
);

SET @ddl = IF(@has_imported_at = 0,
  'ALTER TABLE upload_batch ADD COLUMN imported_at DATETIME NULL AFTER imported_by',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
