-- Add calling feedback columns to meta_lead_raw
-- Allows recruiters to log call outcomes on META leads similar to Hiring Entry page

SET @col1 = (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE()
             AND table_name = 'meta_lead_raw'
             AND column_name = 'calling_feedback');

SET @sql1 = IF(@col1 = 0,
  'ALTER TABLE meta_lead_raw ADD COLUMN calling_feedback VARCHAR(50) DEFAULT NULL AFTER voice_called_at',
  'SELECT 1');

PREPARE stmt1 FROM @sql1;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;

SET @col2 = (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE()
             AND table_name = 'meta_lead_raw'
             AND column_name = 'calling_feedback_at');

SET @sql2 = IF(@col2 = 0,
  'ALTER TABLE meta_lead_raw ADD COLUMN calling_feedback_at DATETIME DEFAULT NULL AFTER calling_feedback',
  'SELECT 1');

PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @col3 = (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE()
             AND table_name = 'meta_lead_raw'
             AND column_name = 'calling_feedback_notes');

SET @sql3 = IF(@col3 = 0,
  'ALTER TABLE meta_lead_raw ADD COLUMN calling_feedback_notes TEXT DEFAULT NULL AFTER calling_feedback_at',
  'SELECT 1');

PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

SET @col4 = (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE()
             AND table_name = 'meta_lead_raw'
             AND column_name = 'calling_feedback_by');

SET @sql4 = IF(@col4 = 0,
  'ALTER TABLE meta_lead_raw ADD COLUMN calling_feedback_by CHAR(36) DEFAULT NULL AFTER calling_feedback_notes',
  'SELECT 1');

PREPARE stmt4 FROM @sql4;
EXECUTE stmt4;
DEALLOCATE PREPARE stmt4;
