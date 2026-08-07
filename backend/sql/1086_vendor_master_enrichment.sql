-- 1086_vendor_master_enrichment.sql
-- Vendor Master has not been altered since 024_erp.sql created it. The GRN screen needs
-- vendor GST registration, structured address and TDS terms that simply have nowhere to
-- live today, so the raiser retypes them per invoice and nothing validates them.
--
-- Deliberately NOT added: a `gstin` column. vendor_master.gst_number already holds the
-- GSTIN — vendorService.list searches it (erp.service.ts) and VendorSheet edits it. Adding
-- a second column for the same fact is how `head`/`head_name` drift started elsewhere in
-- this schema. gst_number stays canonical; everything here hangs off it.
--
-- Two backfills run below. Both are DERIVATIONS from data already in the row, not guessed
-- business meaning: gst_enabled is "this vendor has a GSTIN", and gst_state_code is the
-- first two digits of that GSTIN, which is what those digits are defined to be. Rows
-- without a GSTIN keep gst_enabled = 0 and gst_state_code = NULL.
--
-- Deliberately NOT added: any branch scoping column. If a vendor is ever restricted to a
-- subset of branches that becomes its own vendor_branch_scope row-per-branch table — never
-- a comma-separated id list in a VARCHAR.
--
-- The existing `address TEXT` column is left in place and untouched. address_line1..3 /
-- city / state / pin_code are the structured form; read paths fall back to `address` for
-- historical rows, which is where every current vendor's address still lives.
--
-- Additive only, safe to rerun.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'vendor_master'
      AND column_name = 'tally_name') = 0,
  'ALTER TABLE vendor_master ADD COLUMN tally_name VARCHAR(255) NULL AFTER vendor_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'vendor_master'
      AND column_name = 'address_line1') = 0,
  'ALTER TABLE vendor_master
     ADD COLUMN address_line1 VARCHAR(255) NULL AFTER address,
     ADD COLUMN address_line2 VARCHAR(255) NULL AFTER address_line1,
     ADD COLUMN address_line3 VARCHAR(255) NULL AFTER address_line2,
     ADD COLUMN city VARCHAR(100) NULL AFTER address_line3,
     ADD COLUMN state VARCHAR(100) NULL AFTER city,
     ADD COLUMN pin_code VARCHAR(10) NULL AFTER state',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'vendor_master'
      AND column_name = 'gst_enabled') = 0,
  'ALTER TABLE vendor_master
     ADD COLUMN gst_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER gst_number,
     ADD COLUMN gst_state_code VARCHAR(2) NULL AFTER gst_enabled',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'vendor_master'
      AND column_name = 'tds_enabled') = 0,
  'ALTER TABLE vendor_master
     ADD COLUMN tds_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER pan_number,
     ADD COLUMN tds_section VARCHAR(20) NULL AFTER tds_enabled,
     ADD COLUMN tds_rate DECIMAL(7,4) NULL AFTER tds_section',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill 1: a vendor with a GSTIN is GST-enabled. Only touches rows still on the
-- DEFAULT 0 that actually carry a GSTIN, so a rerun after someone manually clears the
-- flag will not silently re-set it.
UPDATE vendor_master
   SET gst_enabled = 1
 WHERE gst_enabled = 0
   AND gst_number IS NOT NULL
   AND TRIM(gst_number) <> '';

-- Backfill 2: the first two characters of a GSTIN are the state code, by definition.
-- Guarded to well-formed 15-character GSTINs beginning with two digits so malformed
-- legacy values are left NULL rather than producing a bogus state.
UPDATE vendor_master
   SET gst_state_code = LEFT(TRIM(gst_number), 2)
 WHERE gst_state_code IS NULL
   AND gst_number IS NOT NULL
   AND CHAR_LENGTH(TRIM(gst_number)) = 15
   AND TRIM(gst_number) REGEXP '^[0-9]{2}';

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'vendor_master'
      AND index_name = 'idx_vendor_master_name') = 0,
  'ALTER TABLE vendor_master ADD INDEX idx_vendor_master_name (vendor_name)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1086_vendor_master_enrichment.sql applied' AS migration_status;
