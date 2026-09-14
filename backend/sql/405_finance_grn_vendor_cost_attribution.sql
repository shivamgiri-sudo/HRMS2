-- Migration 405: Add process/cost-centre attribution to GRN and vendor payments
-- Also aligns the GRN table with the finance service fields already used by code.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'remarks') = 0,
  'ALTER TABLE grn_request ADD COLUMN remarks TEXT NULL',
  'SELECT ''grn_request.remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'submitted_by') = 0,
  'ALTER TABLE grn_request ADD COLUMN submitted_by CHAR(36) NULL',
  'SELECT ''grn_request.submitted_by already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'reviewed_by') = 0,
  'ALTER TABLE grn_request ADD COLUMN reviewed_by CHAR(36) NULL',
  'SELECT ''grn_request.reviewed_by already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'reviewed_at') = 0,
  'ALTER TABLE grn_request ADD COLUMN reviewed_at DATETIME NULL',
  'SELECT ''grn_request.reviewed_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'review_note') = 0,
  'ALTER TABLE grn_request ADD COLUMN review_note TEXT NULL',
  'SELECT ''grn_request.review_note already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'attachment_path') = 0,
  'ALTER TABLE grn_request ADD COLUMN attachment_path VARCHAR(1000) NULL',
  'SELECT ''grn_request.attachment_path already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'attachment_original_name') = 0,
  'ALTER TABLE grn_request ADD COLUMN attachment_original_name VARCHAR(500) NULL',
  'SELECT ''grn_request.attachment_original_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'attachment_mime') = 0,
  'ALTER TABLE grn_request ADD COLUMN attachment_mime VARCHAR(100) NULL',
  'SELECT ''grn_request.attachment_mime already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE grn_request
   SET attachment_path = COALESCE(attachment_path, attachment_file_path),
       attachment_original_name = COALESCE(attachment_original_name, attachment_file_name),
       attachment_mime = COALESCE(attachment_mime, attachment_file_mime),
       reviewed_by = COALESCE(reviewed_by, approved_by),
       reviewed_at = COALESCE(reviewed_at, approved_at);

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'process_id') = 0,
  'ALTER TABLE grn_request ADD COLUMN process_id CHAR(36) NULL',
  'SELECT ''grn_request.process_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'cost_centre_id') = 0,
  'ALTER TABLE grn_request ADD COLUMN cost_centre_id CHAR(36) NULL',
  'SELECT ''grn_request.cost_centre_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND column_name = 'cost_class') = 0,
  'ALTER TABLE grn_request ADD COLUMN cost_class ENUM(''direct'',''indirect'') NOT NULL DEFAULT ''indirect''',
  'SELECT ''grn_request.cost_class already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vendor_payment_tracking' AND column_name = 'process_id') = 0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN process_id CHAR(36) NULL',
  'SELECT ''vendor_payment_tracking.process_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vendor_payment_tracking' AND column_name = 'cost_centre_id') = 0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN cost_centre_id CHAR(36) NULL',
  'SELECT ''vendor_payment_tracking.cost_centre_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vendor_payment_tracking' AND column_name = 'cost_class') = 0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN cost_class ENUM(''direct'',''indirect'') NOT NULL DEFAULT ''indirect''',
  'SELECT ''vendor_payment_tracking.cost_class already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE grn_request
   SET cost_class = CASE
     WHEN process_id IS NOT NULL THEN 'direct'
     WHEN cost_centre_id IS NOT NULL THEN 'direct'
     ELSE COALESCE(cost_class, 'indirect')
   END;

UPDATE vendor_payment_tracking vpt
JOIN grn_request g
  ON g.id = vpt.grn_request_id
   SET vpt.process_id = COALESCE(vpt.process_id, g.process_id),
       vpt.cost_centre_id = COALESCE(vpt.cost_centre_id, g.cost_centre_id),
       vpt.cost_class = CASE
         WHEN COALESCE(vpt.process_id, g.process_id) IS NOT NULL THEN 'direct'
         WHEN COALESCE(vpt.cost_centre_id, g.cost_centre_id) IS NOT NULL THEN 'direct'
         ELSE COALESCE(vpt.cost_class, g.cost_class, 'indirect')
       END;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND index_name = 'idx_grn_process_id') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_process_id (process_id)',
  'SELECT ''idx_grn_process_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND index_name = 'idx_grn_cost_centre_id') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_cost_centre_id (cost_centre_id)',
  'SELECT ''idx_grn_cost_centre_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND index_name = 'idx_grn_cost_class') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_cost_class (cost_class)',
  'SELECT ''idx_grn_cost_class already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'vendor_payment_tracking' AND index_name = 'idx_vpt_process_id') = 0,
  'ALTER TABLE vendor_payment_tracking ADD INDEX idx_vpt_process_id (process_id)',
  'SELECT ''idx_vpt_process_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'vendor_payment_tracking' AND index_name = 'idx_vpt_cost_centre_id') = 0,
  'ALTER TABLE vendor_payment_tracking ADD INDEX idx_vpt_cost_centre_id (cost_centre_id)',
  'SELECT ''idx_vpt_cost_centre_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'vendor_payment_tracking' AND index_name = 'idx_vpt_cost_class') = 0,
  'ALTER TABLE vendor_payment_tracking ADD INDEX idx_vpt_cost_class (cost_class)',
  'SELECT ''idx_vpt_cost_class already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '405_finance_grn_vendor_cost_attribution.sql applied' AS migration_status;
