-- 1102_vendor_company_branch_applicability.sql
-- Vendor Master: three separate concepts, never merged.
--
--   1. Vendor IDENTITY          — vendor_master, one row per real vendor
--   2. LEGAL ENTITY applicability — which of our companies may transact with it
--   3. BRANCH applicability      — which of our branches may raise a GRN against it
--
-- WHY THIS IS A TABLE AND NOT TWO COLUMNS
-- The legacy system merged identity with branch applicability by DUPLICATING the vendor row:
-- db_bill.tbl_vendormaster holds 1,829 rows for 1,552 distinct vendor names. 157 names appear
-- more than once, and "Unicel Technologies Pvt. Ltd." exists SIX times across five branches.
-- Every one of those copies has its own PAN, GST number, TDS section and payment history, so
-- correcting a GSTIN means finding and fixing six rows, and any report grouped by vendor
-- silently counts one supplier as six. That is the fragmentation this table exists to prevent.
--
-- The other tempting shortcut — a comma-separated branch list in a VARCHAR — is worse: it
-- cannot be joined, cannot be indexed, cannot have a foreign key, and "12,3" matches "1,23"
-- under LIKE. One row per (vendor, branch) is the only shape that survives contact with SQL.
--
-- NO ROWS MEANS UNRESTRICTED.
-- This is the same rule vendor_expense_mapping already uses, and it is what keeps all 1,821
-- existing vendors working unchanged: a vendor nobody has restricted is available to every
-- company and every branch. Restriction is opt-in, so this migration cannot break a live flow
-- by omission. An empty applicability table on day one behaves exactly like today.
--
-- SHIP-TO
-- Ship-To is where WE want goods delivered, so by default it is the branch's own address and
-- is NOT copied here. The columns below are an OPTIONAL per-(vendor, branch) override for the
-- case where a particular vendor delivers somewhere else — a warehouse, a site office. NULL,
-- which is what every row starts as, means "use the branch address". Storing a copy of the
-- branch address on every row instead would guarantee the two drift apart.
-- (cost_centre_master already carries bill_to_*/ship_to_* columns from the legacy import, but
-- they are empty on all 927 rows, so nothing reads them today.)
--
-- Additive only, safe to rerun.

-- ── The third legal entity ────────────────────────────────────────────────────
-- finance_company shipped with MAS and IDC. Pikquick is a real third entity: it owns four
-- cost centres in cost_centre_master and is company id 3 in db_bill.company_master. Leaving it
-- out would make any Pikquick vendor unassignable, and the GRN numbering sequence — keyed on
-- company_code — could never issue a Pikquick serial.
INSERT INTO finance_company (company_code, company_name, grn_prefix, legacy_comp_id, active_status)
SELECT 'PIK', 'Pikquick Pvt. Ltd.', 'PIK', 3, 1
 WHERE NOT EXISTS (SELECT 1 FROM finance_company WHERE company_code = 'PIK');

-- ── Legal entity applicability ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_company_applicability (
  id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  -- The code, not a surrogate id: company_code is the stable key across environments, and it
  -- is what finance_grn_monthly_sequence and the Tally ledger map already key on.
  company_code VARCHAR(16) NOT NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vendor_company (vendor_id, company_code),
  INDEX idx_vendor_company_lookup (company_code, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Branch applicability ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_branch_applicability (
  id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NOT NULL,
  -- Optional Ship-To override. NULL means "use the branch's own address", which is the case
  -- for every row until someone deliberately sets otherwise.
  ship_to_name VARCHAR(255) NULL,
  ship_to_address1 VARCHAR(255) NULL,
  ship_to_address2 VARCHAR(255) NULL,
  ship_to_address3 VARCHAR(255) NULL,
  ship_to_city VARCHAR(100) NULL,
  ship_to_state VARCHAR(100) NULL,
  ship_to_state_code VARCHAR(2) NULL,
  ship_to_pincode VARCHAR(10) NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vendor_branch (vendor_id, branch_id),
  INDEX idx_vendor_branch_lookup (branch_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FKs only when the collations match, for the reason set out in 1088: vendor_master was created
-- by 024_erp.sql with no COLLATE clause and inherited the server default, so a mismatch is
-- possible and would throw errno 3780. With MIGRATION_STOP_ON_FAILURE true and migrations
-- running at boot, that failure blocks every later migration and leaves /api/health at 503.
SET @vendor_child = (SELECT COLLATION_NAME FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'vendor_company_applicability' AND column_name = 'vendor_id');
SET @vendor_parent = (SELECT COLLATION_NAME FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'vendor_master' AND column_name = 'id');
SET @sql = IF(
  @vendor_child IS NOT NULL AND @vendor_parent IS NOT NULL AND @vendor_child = @vendor_parent
    AND (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE table_schema = DATABASE() AND table_name = 'vendor_company_applicability'
            AND constraint_name = 'fk_vendor_company_applicability') = 0,
  'ALTER TABLE vendor_company_applicability
     ADD CONSTRAINT fk_vendor_company_applicability
     FOREIGN KEY (vendor_id) REFERENCES vendor_master(id)
     ON DELETE CASCADE ON UPDATE RESTRICT',
  'SELECT ''fk_vendor_company_applicability skipped or already present'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @branch_child = (SELECT COLLATION_NAME FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'vendor_branch_applicability' AND column_name = 'vendor_id');
SET @sql = IF(
  @branch_child IS NOT NULL AND @vendor_parent IS NOT NULL AND @branch_child = @vendor_parent
    AND (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE table_schema = DATABASE() AND table_name = 'vendor_branch_applicability'
            AND constraint_name = 'fk_vendor_branch_applicability') = 0,
  'ALTER TABLE vendor_branch_applicability
     ADD CONSTRAINT fk_vendor_branch_applicability
     FOREIGN KEY (vendor_id) REFERENCES vendor_master(id)
     ON DELETE CASCADE ON UPDATE RESTRICT',
  'SELECT ''fk_vendor_branch_applicability skipped or already present'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- No FK to branch_master: branch_id is CHAR(36) there too, but branch rows are soft-deleted
-- rather than removed, and a hard FK would turn a retired branch into an obstacle to retiring
-- it. The unique key and the lookup index are what this table actually needs.

SELECT '1102_vendor_company_branch_applicability.sql applied' AS migration_status;
