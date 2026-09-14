-- 293_bank_change_pennyDrop.sql
-- Penny drop log + profile_update_approval routing extensions.
-- Compatible with MySQL 5.7+ (no ADD COLUMN IF NOT EXISTS).

-- ── Penny drop verification log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_penny_drop_log (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id               CHAR(36)     NOT NULL,
  account_number_hash       VARCHAR(64)  NOT NULL,
  ifsc_code                 VARCHAR(20)  NOT NULL,
  penny_drop_ref            VARCHAR(255) NULL,
  penny_drop_status         ENUM('initiated','success','failed','skipped') NOT NULL DEFAULT 'initiated',
  beneficiary_name_returned VARCHAR(255) NULL,
  initiated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at                DATETIME     NULL,
  provider_response_json    JSON         NULL,
  INDEX idx_bpdl_employee (employee_id),
  INDEX idx_bpdl_status   (penny_drop_status)
);

-- ── profile_update_approval: penny_drop_log_id ───────────────────────────────
SET @c1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval'
    AND COLUMN_NAME = 'penny_drop_log_id'
);
SET @s1 = IF(@c1 = 0,
  'ALTER TABLE profile_update_approval ADD COLUMN penny_drop_log_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE p1 FROM @s1; EXECUTE p1; DEALLOCATE PREPARE p1;

-- ── profile_update_approval: effective_run_month ─────────────────────────────
SET @c2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval'
    AND COLUMN_NAME = 'effective_run_month'
);
SET @s2 = IF(@c2 = 0,
  'ALTER TABLE profile_update_approval ADD COLUMN effective_run_month VARCHAR(7) NULL',
  'SELECT 1'
);
PREPARE p2 FROM @s2; EXECUTE p2; DEALLOCATE PREPARE p2;

-- ── profile_update_approval: routed_to_role ──────────────────────────────────
SET @c3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval'
    AND COLUMN_NAME = 'routed_to_role'
);
SET @s3 = IF(@c3 = 0,
  "ALTER TABLE profile_update_approval ADD COLUMN routed_to_role VARCHAR(50) NULL DEFAULT 'payroll'",
  'SELECT 1'
);
PREPARE p3 FROM @s3; EXECUTE p3; DEALLOCATE PREPARE p3;
