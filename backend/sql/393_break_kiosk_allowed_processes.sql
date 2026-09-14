-- Migration 393: Allow one break kiosk desk to be mapped to multiple processes.
-- Additive only; existing single process_id behavior remains supported.

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'break_kiosk_devices'
     AND COLUMN_NAME  = 'allowed_process_ids'
);

SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE break_kiosk_devices ADD COLUMN allowed_process_ids JSON NULL AFTER process_id',
  'SELECT 1'
);
PREPARE _stmt FROM @ddl;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

UPDATE break_kiosk_devices
   SET allowed_process_ids = JSON_ARRAY(process_id)
 WHERE allowed_process_ids IS NULL
   AND process_id IS NOT NULL;
