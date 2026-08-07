-- 1088_vendor_expense_mapping.sql
-- Restricts which Finance Head / Sub-head a vendor may be booked against.
--
-- Today selecting a vendor on the GRN screen exposes every head and sub-head in the
-- master. This table is the vendor side of the rule; the budget side already exists.
-- The selectable set is the INTERSECTION of the two:
--
--     {heads mapped to this vendor}  ∩  {heads with an active approved budget line
--                                        for this branch + period with headroom left}
--
-- The intersection is computed server-side and is the authority. A dropdown is not
-- security, and vendor mapping must never be able to bypass budget governance.
--
-- WHY BOTH IDS AND CODES
-- finance_expense_head_master.id is UUID() generated at migration-run time, so the same
-- head has a DIFFERENT id in every environment (see 412_finance_expense_head_master.sql).
-- head_code / sub_head_code are the stable, portable keys and are what a mapping exported
-- from staging can be re-imported by. The ids are the fast join within one environment.
-- The codes are authoritative on conflict.
--
-- WHY sub_head_code DEFAULTS TO '*' RATHER THAN NULL
-- '*' means "every sub-head under this head". It is a sentinel rather than NULL because
-- MySQL treats NULLs as distinct inside a UNIQUE index: a nullable sub_head_code would
-- allow unlimited duplicate "all sub-heads" rows for the same vendor, silently.
--
-- WHY THE FEATURE SHIPS DISABLED
-- Every existing vendor has zero mapping rows. Enforcing on day one would make every head
-- unselectable for every vendor and brick GRN creation. Two rules prevent that:
--   1. finance_config.vendor_expense_mapping_enforced defaults to 0 (advisory only).
--   2. Even when enforced, a vendor with NO mapping rows at all is UNRESTRICTED. Only a
--      vendor that has been deliberately mapped is constrained by its mapping.
--
-- Additive only, safe to rerun.

CREATE TABLE IF NOT EXISTS vendor_expense_mapping (
  id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  head_id CHAR(36) NULL,
  head_code VARCHAR(80) NOT NULL,
  sub_head_id CHAR(36) NULL,
  sub_head_code VARCHAR(100) NOT NULL DEFAULT '*',
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vendor_expense_mapping (vendor_id, head_code, sub_head_code),
  INDEX idx_vendor_expense_mapping_vendor (vendor_id, active_status),
  INDEX idx_vendor_expense_mapping_head (head_code, sub_head_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The FK to vendor_master is added ONLY when the two tables' id columns actually share a
-- collation. vendor_master was created by 024_erp.sql with no ENGINE/CHARSET/COLLATE
-- clause, so it inherited whatever the server default was at install time — which on
-- MySQL 8 is utf8mb4_0900_ai_ci, not the utf8mb4_unicode_ci declared above. Adding the
-- constraint blind would throw errno 3780 ("Referencing column and referenced column are
-- incompatible"), and because MIGRATION_STOP_ON_FAILURE defaults to true and migrations
-- run at boot (server.ts), that failure would block every later migration and leave
-- /api/health at 503. Skipping the FK is the safe outcome: uq_vendor_expense_mapping and
-- the service layer still guarantee integrity, and 1028_salary_certificate_request_collation.sql
-- documents why converting a live table's collation is not an option here either.
SET @vendor_collation = (
  SELECT COLLATION_NAME FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'vendor_master' AND column_name = 'id'
);
SET @mapping_collation = (
  SELECT COLLATION_NAME FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'vendor_expense_mapping' AND column_name = 'vendor_id'
);
SET @sql = IF(
  @vendor_collation IS NOT NULL
    AND @vendor_collation = @mapping_collation
    AND (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE table_schema = DATABASE()
            AND table_name = 'vendor_expense_mapping'
            AND constraint_name = 'fk_vendor_expense_mapping_vendor') = 0,
  'ALTER TABLE vendor_expense_mapping
     ADD CONSTRAINT fk_vendor_expense_mapping_vendor
     FOREIGN KEY (vendor_id) REFERENCES vendor_master(id)
     ON DELETE CASCADE ON UPDATE RESTRICT',
  'SELECT ''fk_vendor_expense_mapping_vendor skipped or already present'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Small key/value table for finance feature switches. Created here because this is the
-- first switch that needs it; later finance flags reuse it rather than adding columns to
-- unrelated tables.
CREATE TABLE IF NOT EXISTS finance_config (
  config_key VARCHAR(80) NOT NULL,
  config_value VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO finance_config (config_key, config_value, description)
VALUES (
  'vendor_expense_mapping_enforced',
  '0',
  'When 1, a vendor that HAS mapping rows may only be booked against those head/sub-head combinations. A vendor with no mapping rows is always unrestricted. Ships 0 so no existing vendor is blocked.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT '1088_vendor_expense_mapping.sql applied' AS migration_status;
