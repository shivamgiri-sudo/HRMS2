-- Migration 300: DPDP Withdrawal — final column parity & page access
-- Safe to re-run: all changes are guarded with IF NOT EXISTS / INSERT IGNORE
-- Adds missing columns to dpdp_consent_withdrawal and ensures page_catalog / role_page_access entries

DELIMITER $$

DROP PROCEDURE IF EXISTS _m300_add_col$$
CREATE PROCEDURE _m300_add_col(
  IN p_table  VARCHAR(64),
  IN p_col    VARCHAR(64),
  IN p_defn   TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = p_table
      AND COLUMN_NAME  = p_col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_col, '` ', p_defn);
    PREPARE _s FROM @sql;
    EXECUTE _s;
    DEALLOCATE PREPARE _s;
  END IF;
END$$

DELIMITER ;

-- ── Add missing columns to dpdp_consent_withdrawal ──────────────────────────

CALL _m300_add_col(
  'dpdp_consent_withdrawal',
  'withdrawal_scope_json',
  'JSON NULL COMMENT ''Which data categories to restrict'' AFTER scope_json'
);

CALL _m300_add_col(
  'dpdp_consent_withdrawal',
  'request_channel',
  "VARCHAR(30) NULL DEFAULT 'self' COMMENT 'self/hr_on_behalf/legal'"
);

CALL _m300_add_col(
  'dpdp_consent_withdrawal',
  'data_restriction_applied',
  'TINYINT(1) NOT NULL DEFAULT 0'
);

CALL _m300_add_col(
  'dpdp_consent_withdrawal',
  'data_restriction_at',
  'DATETIME NULL'
);

CALL _m300_add_col(
  'dpdp_consent_withdrawal',
  'restricted_by',
  'CHAR(36) NULL'
);

CALL _m300_add_col(
  'dpdp_consent_withdrawal',
  'escalation_required',
  'TINYINT(1) NOT NULL DEFAULT 0'
);

DROP PROCEDURE IF EXISTS _m300_add_col;

-- ── Also ensure dpdp_processing_hold has held_by / hold_reason for service ──
-- (293 may have created it without those; guard them the same way)

DELIMITER $$
DROP PROCEDURE IF EXISTS _m300_add_col2$$
CREATE PROCEDURE _m300_add_col2(
  IN p_table  VARCHAR(64),
  IN p_col    VARCHAR(64),
  IN p_defn   TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = p_table
      AND COLUMN_NAME  = p_col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_col, '` ', p_defn);
    PREPARE _s FROM @sql;
    EXECUTE _s;
    DEALLOCATE PREPARE _s;
  END IF;
END$$
DELIMITER ;

CALL _m300_add_col2('dpdp_processing_hold', 'held_by',     'CHAR(36) NULL');
CALL _m300_add_col2('dpdp_processing_hold', 'hold_reason', 'TEXT NULL');
CALL _m300_add_col2('dpdp_processing_hold', 'held_at',     'DATETIME NULL DEFAULT CURRENT_TIMESTAMP');
CALL _m300_add_col2('dpdp_processing_hold', 'release_reason', 'TEXT NULL');

DROP PROCEDURE IF EXISTS _m300_add_col2;

-- ── page_catalog entries ─────────────────────────────────────────────────────

INSERT IGNORE INTO page_catalog
  (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'DPDP_WITHDRAWAL',
   'DPDP Withdrawal Request', 'compliance',
   'Employee self-service: submit and track DPDP consent withdrawal', 1),
  (UUID(), 'DPDP_WITHDRAWAL_ADMIN',
   'DPDP Withdrawal Admin', 'compliance',
   'HR/DPO: review, approve or reject DPDP withdrawal requests', 1);

-- ── role_page_access — super_admin gets full access ──────────────────────────

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', pc.page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog pc
WHERE pc.page_code IN ('DPDP_WITHDRAWAL', 'DPDP_WITHDRAWAL_ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM role_page_access rpa
    WHERE rpa.role_key = 'super_admin' AND rpa.page_code = pc.page_code
  );
