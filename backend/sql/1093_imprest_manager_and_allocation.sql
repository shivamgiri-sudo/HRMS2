-- 1093_imprest_manager_and_allocation.sql
-- The Imprest Manager master (Requirement 8) and Imprest Allocation (Requirement 6).
--
-- HRMS2 has no imprest model at all today: `imprest` exists only as a value of
-- grn_request.grn_type. The legacy system db_bill does, and these tables are modelled on it
-- rather than invented — imprest_manager (46 rows, 45 active) and imprest_allotment_master (2,818 rows,
-- still being written this month). Counts are exact COUNT(*), not
-- information_schema.TABLE_ROWS, which is an InnoDB estimate and read 2,896 here.
--
-- WHAT IS KEPT FROM LEGACY
--   * One row per (manager, branch). Legacy's imprest_manager carries a single BranchId per
--     row, so a manager covering three branches has three rows. That is the correct shape and
--     it is kept — a comma-separated branch list in a VARCHAR is what the brief explicitly
--     rules out.
--   * TallyHead. Legacy carries a separate Tally name ("HO Imprest", "Aman Lawaniya") distinct
--     from the person's name, because that is the ledger head the entry posts to. Dropping it
--     would break the Tally hand-off.
--
-- WHAT IS DELIBERATELY DIFFERENT
--   * Money is DECIMAL(18,2), not int. legacy imprest_allotment_master.Amount is int(10), so
--     it cannot express paise at all. Migrating those values in is lossless; the reverse is not.
--   * Dates are DATE, not varchar(50). Legacy stores EntryDate as text.
--   * Effective dating on the manager. Legacy has only an Active flag, so there is no way to
--     answer "who held this float in July" once someone is deactivated — which is exactly the
--     question an imprest audit asks.
--   * An approval chain on the allocation. Legacy has none: an allotment is a direct entry by
--     whoever is logged in. Funding a float is a payment, so it gets the same two-stage review
--     the rest of finance uses. It ships with status 'draft' available so nothing forces a
--     workflow onto a back-dated import.
--
-- Additive only, safe to rerun. No existing table is altered here.

CREATE TABLE IF NOT EXISTS imprest_manager (
  id CHAR(36) NOT NULL,
  branch_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL COMMENT 'auth_user.id of the float holder',
  employee_id CHAR(36) NULL COMMENT 'Resolved for display; user_id is the identity',
  tally_name VARCHAR(255) NULL COMMENT 'Ledger head the posting lands on; often not the person name',
  effective_from DATE NOT NULL,
  effective_to DATE NULL COMMENT 'NULL = still current',
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One appointment per holder per branch per start date. A re-appointment after a gap is a
  -- new row with a new effective_from, so the history stays readable.
  UNIQUE KEY uq_imprest_manager_appointment (user_id, branch_id, effective_from),
  INDEX idx_imprest_manager_branch (branch_id, active_status),
  INDEX idx_imprest_manager_user (user_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS imprest_allocation (
  id CHAR(36) NOT NULL,
  allocation_no VARCHAR(40) NOT NULL,
  imprest_manager_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NOT NULL,
  allocation_date DATE NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  payment_mode ENUM('Cheque','NEFT','RTGS','IMPS','UPI','Cash','Bank Transfer','Adjustment','Other')
    NOT NULL DEFAULT 'Bank Transfer',
  bank_id CHAR(36) NULL,
  bank_name VARCHAR(255) NULL COMMENT 'Denormalised at write time, as vendor_payment_transaction does',
  reference_no VARCHAR(255) NULL COMMENT 'Cheque number, UTR or transaction reference',
  transaction_date DATE NULL,
  remarks TEXT NULL,
  document_name VARCHAR(255) NULL,
  document_path VARCHAR(1000) NULL,
  document_mime VARCHAR(120) NULL,
  status ENUM('draft','submitted','branch_head_approved','disbursed','rejected')
    NOT NULL DEFAULT 'draft',
  submitted_by CHAR(36) NULL,
  submitted_at DATETIME NULL,
  branch_head_reviewed_by CHAR(36) NULL,
  branch_head_reviewed_at DATETIME NULL,
  branch_head_review_note TEXT NULL,
  finance_reviewed_by CHAR(36) NULL,
  finance_reviewed_at DATETIME NULL,
  finance_review_note TEXT NULL,
  rejection_reason TEXT NULL,
  disbursed_at DATETIME NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_imprest_allocation_no (allocation_no),
  -- The same duplicate guard vendor payments use. Paying a float twice on one UTR is the
  -- identical failure mode, and it is only catchable at write time.
  UNIQUE KEY uq_imprest_allocation_reference (payment_mode, bank_id, reference_no),
  INDEX idx_imprest_allocation_manager (imprest_manager_id, allocation_date),
  INDEX idx_imprest_allocation_branch (branch_id, allocation_date),
  INDEX idx_imprest_allocation_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- IMP/MM/YY/0001. Same FOR UPDATE discipline as finance_grn_monthly_sequence; never
-- MAX(serial)+1, which has no lock and duplicates under concurrency.
CREATE TABLE IF NOT EXISTS imprest_allocation_sequence (
  period_code CHAR(7) NOT NULL COMMENT 'YYYY-MM of the allocation date',
  next_sequence BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FKs are added only when the referenced column's collation matches, for the reason set out in
-- 1088: branch_master and employees predate the explicit COLLATE convention, and a mismatch
-- throws errno 3780 — which, with MIGRATION_STOP_ON_FAILURE true and migrations running at
-- boot, would block every later migration and leave /api/health at 503.
SET @branch_collation = (
  SELECT COLLATION_NAME FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'branch_master' AND column_name = 'id'
);
SET @mgr_collation = (
  SELECT COLLATION_NAME FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'imprest_manager' AND column_name = 'branch_id'
);
SET @sql = IF(
  @branch_collation IS NOT NULL AND @branch_collation = @mgr_collation
    AND (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE table_schema = DATABASE() AND table_name = 'imprest_manager'
            AND constraint_name = 'fk_imprest_manager_branch') = 0,
  'ALTER TABLE imprest_manager
     ADD CONSTRAINT fk_imprest_manager_branch
     FOREIGN KEY (branch_id) REFERENCES branch_master(id)
     ON DELETE RESTRICT ON UPDATE RESTRICT',
  'SELECT ''fk_imprest_manager_branch skipped or already present'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @alloc_collation = (
  SELECT COLLATION_NAME FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'imprest_allocation' AND column_name = 'imprest_manager_id'
);
SET @mgr_id_collation = (
  SELECT COLLATION_NAME FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'imprest_manager' AND column_name = 'id'
);
SET @sql = IF(
  @alloc_collation IS NOT NULL AND @alloc_collation = @mgr_id_collation
    AND (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE table_schema = DATABASE() AND table_name = 'imprest_allocation'
            AND constraint_name = 'fk_imprest_allocation_manager') = 0,
  'ALTER TABLE imprest_allocation
     ADD CONSTRAINT fk_imprest_allocation_manager
     FOREIGN KEY (imprest_manager_id) REFERENCES imprest_manager(id)
     ON DELETE RESTRICT ON UPDATE RESTRICT',
  'SELECT ''fk_imprest_allocation_manager skipped or already present'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1093_imprest_manager_and_allocation.sql applied' AS migration_status;
