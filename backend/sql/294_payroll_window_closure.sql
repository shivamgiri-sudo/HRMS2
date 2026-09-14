-- 294_payroll_window_closure.sql
-- Adds payroll window closure tracking columns to salary_prep_run.
-- Compatible with MySQL 5.7+ (no ADD COLUMN IF NOT EXISTS / ADD INDEX IF NOT EXISTS).

-- ── window_close_date ────────────────────────────────────────────────────────
SET @c1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run'
    AND COLUMN_NAME = 'window_close_date'
);
SET @s1 = IF(@c1 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN window_close_date DATE NULL',
  'SELECT 1'
);
PREPARE w1 FROM @s1; EXECUTE w1; DEALLOCATE PREPARE w1;

-- ── auto_closed_at ────────────────────────────────────────────────────────────
SET @c2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run'
    AND COLUMN_NAME = 'auto_closed_at'
);
SET @s2 = IF(@c2 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN auto_closed_at DATETIME NULL',
  'SELECT 1'
);
PREPARE w2 FROM @s2; EXECUTE w2; DEALLOCATE PREPARE w2;

-- ── closed_by ─────────────────────────────────────────────────────────────────
SET @c3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run'
    AND COLUMN_NAME = 'closed_by'
);
SET @s3 = IF(@c3 = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN closed_by CHAR(36) NULL',
  'SELECT 1'
);
PREPARE w3 FROM @s3; EXECUTE w3; DEALLOCATE PREPARE w3;

-- ── Index for cron query (skip if already exists) ─────────────────────────────
SET @ix = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run'
    AND INDEX_NAME = 'idx_spr_window_close'
);
SET @si = IF(@ix = 0,
  'ALTER TABLE salary_prep_run ADD INDEX idx_spr_window_close (window_close_date, status)',
  'SELECT 1'
);
PREPARE wi FROM @si; EXECUTE wi; DEALLOCATE PREPARE wi;
