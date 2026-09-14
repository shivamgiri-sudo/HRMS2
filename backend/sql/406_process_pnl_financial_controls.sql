-- Migration 406: Process P&L finance controls hardening
-- Adds adjustment workflow metadata needed by the existing Process P&L module.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'adjustment_class') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN adjustment_class VARCHAR(100) NULL AFTER metric_key',
  'SELECT ''pnl_adjustment_journal.adjustment_class already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'submitted_at') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN submitted_at DATETIME NULL AFTER attachment_path',
  'SELECT ''pnl_adjustment_journal.submitted_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'checked_at') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN checked_at DATETIME NULL AFTER approved_at',
  'SELECT ''pnl_adjustment_journal.checked_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'rejection_reason') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN rejection_reason TEXT NULL AFTER checked_at',
  'SELECT ''pnl_adjustment_journal.rejection_reason already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'reversed_at') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN reversed_at DATETIME NULL AFTER rejection_reason',
  'SELECT ''pnl_adjustment_journal.reversed_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'reversed_by') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN reversed_by CHAR(36) NULL AFTER reversed_at',
  'SELECT ''pnl_adjustment_journal.reversed_by already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'reversal_reason') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN reversal_reason TEXT NULL AFTER reversed_by',
  'SELECT ''pnl_adjustment_journal.reversal_reason already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND column_name = 'approval_status') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT ''draft'' AFTER checker_user_id',
  'SELECT ''pnl_adjustment_journal.approval_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE pnl_adjustment_journal
  MODIFY COLUMN approval_status ENUM('draft','pending','approved','rejected','reversed') NOT NULL DEFAULT 'draft';

UPDATE pnl_adjustment_journal
   SET approval_status = CASE
     WHEN approval_status IN ('approved', 'rejected', 'pending', 'draft', 'reversed') THEN approval_status
     WHEN approved_at IS NOT NULL THEN 'approved'
     ELSE 'pending'
   END;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'pnl_adjustment_journal' AND index_name = 'idx_pnl_adjustment_process_period_status') = 0,
  'ALTER TABLE pnl_adjustment_journal ADD INDEX idx_pnl_adjustment_process_period_status (process_id, period_code, approval_status)',
  'SELECT ''idx_pnl_adjustment_process_period_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '406_process_pnl_financial_controls.sql applied' AS migration_status;
