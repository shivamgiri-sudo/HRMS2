-- Per-branch Payroll HR signatory for joining documents
--
-- WHY
-- ---
-- Joining documents carry an HR name and an employer signature, and both are
-- currently wrong in different ways:
--
--   * {{surveillance_hr_name}} on the NDA / Surveillance declaration has
--     source_path NULL, so it has been blank on every document ever issued.
--   * employer_signature on EPF Form 2 and the EPF Declaration is filled from
--     the single company-wide seal (companySeal.service.ts SEALED_DOCUMENTS),
--     so a Noida joiner and a Jaipur joiner get the same signature regardless of
--     which branch's Payroll HR actually processed them.
--
-- Both should be the Payroll HR of the branch the candidate joins. This table
-- holds that mapping, plus the uploaded signature image.
--
-- The signature itself is stored as a bare filename under
-- uploads/company-assets/, the same convention companySeal already uses, so
-- there is one place on disk for these assets and one traversal guard.
-- employee_id is optional: some branches will name a shared Payroll HR desk
-- that has no employee record, exactly as branch_notification_recipient found.
--
-- Additive and guarded — safe to run twice. Production runs
-- SKIP_MIGRATIONS=true, so all reading code must tolerate this table not
-- existing yet and fall back to the company seal.

CREATE TABLE IF NOT EXISTS branch_payroll_hr_signatory (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id         CHAR(36)     NOT NULL,

  -- Printed into {{surveillance_hr_name}} and beside the employer signature.
  hr_name           VARCHAR(150) NOT NULL,
  hr_designation    VARCHAR(150) NULL,

  -- Linked employee where one exists; NULL for a shared Payroll HR desk.
  employee_id       CHAR(36)     NULL,

  -- Bare filename under uploads/company-assets/. NULL until an image is
  -- uploaded, in which case the name still prints and the signature block
  -- falls back to the company seal.
  signature_file    VARCHAR(255) NULL,

  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  created_by        CHAR(36)     NULL,
  updated_by        CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- One active signatory per branch; history is kept by deactivating a row.
  UNIQUE KEY uq_bphs_branch_active (branch_id, active_status),
  INDEX idx_bphs_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An FK to employees(id) needs the collation stated explicitly or it fails with
-- errno 3780 on this schema.
SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'branch_payroll_hr_signatory'
     AND CONSTRAINT_NAME = 'fk_bphs_branch'
);

SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE branch_payroll_hr_signatory
     ADD CONSTRAINT fk_bphs_branch FOREIGN KEY (branch_id)
       REFERENCES branch_master(id) ON DELETE CASCADE',
  "SELECT 'fk_bphs_branch already present' AS status"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ 1061_branch_payroll_hr_signatory.sql complete' AS status;
