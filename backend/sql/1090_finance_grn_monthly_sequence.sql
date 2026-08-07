-- 1090_finance_grn_monthly_sequence.sql
-- Sequence store for the new GRN number format {PREFIX}/MM/YY/SERIAL, e.g. MAS/08/26/0001.
--
-- WHY A NEW TABLE RATHER THAN ALTERING finance_grn_sequence
-- That table's PRIMARY KEY is (branch_id, financial_year) (414_finance_grn_sequence.sql:11).
-- The new format contains no branch code, so its serial must be unique across the company for
-- a given month — otherwise Noida and Ahmedabad both mint MAS/08/26/0001. A table cannot have
-- two primary keys, and the legacy allocator must keep working unchanged for historical data
-- and for the pre-cutover path. So: new table alongside, old table and every historical row
-- byte-identical, rollback is DROP TABLE.
--
-- The two number spaces cannot collide. They differ structurally in slot 2: the legacy format
-- puts a bare branch_seq there (Mas/7/26/143), the new one a zero-padded month
-- (MAS/08/26/0001). uq_grn_number on grn_request remains the backstop either way.
--
-- WHY THE KEY IS (company_code, period_code)
-- The business runs more than one legal entity, and legacy numbers them separately. In
-- db_bill.expense_entry_master, CompId 1 issues 68,646 GRNs prefixed `Mas` and CompId 2
-- issues 8,590 prefixed `IDC`, both still active in FY 2026-27. A single shared monthly
-- serial would leave each entity with a run full of gaps where the other took numbers, which
-- cannot be reconciled against a physical register. Per-company per-month mirrors what
-- Finance already does.
--
-- finance_company exists because HRMS2 has no legal-entity master at all: tenant_config holds
-- one row, and the P&L identifies own-company rows by matching
-- cost_centre_master.company_name LIKE '%mascallnet%'. This is the smallest table that makes
-- the prefix and the sequence scope explicit rather than hard-coded. legacy_comp_id is kept so
-- a later migration of db_bill GRNs can map CompId without guessing.
--
-- NO SEED of the sequence. Every month starts at 1. There are zero historical rows in the new
-- format, and seeding from the legacy numbers would import branch-scoped serials into a
-- company-global space and start each month far above reality. Do not "fix" this later.
--
-- CUTOVER IS A CONFIG FLAG, NOT A DATE AND NOT UNCONDITIONAL. Unconditional leaves no way back
-- if Finance rejects the format mid-year; a hardcoded date cannot move without a deploy.
-- grn_number_format ships as 'legacy_branch_fy' so this migration changes NO behaviour on its
-- own — the new allocator is dormant until the flag is flipped.
--
-- Additive only, safe to rerun.

CREATE TABLE IF NOT EXISTS finance_company (
  company_code VARCHAR(16) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  grn_prefix VARCHAR(16) NOT NULL COMMENT 'Literal first segment of a new-format GRN number',
  legacy_comp_id INT NULL COMMENT 'db_bill.expense_entry_master.CompId, for mapping migrated GRNs',
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_code),
  UNIQUE KEY uq_finance_company_prefix (grn_prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeded from the two entities actually issuing GRNs in db_bill in FY 2026-27. The older
-- prefixes there (MasNew-2017, Pikquick) stopped in 2017-18 and 2020-21 and are deliberately
-- not seeded — they would be dead rows in a dropdown.
INSERT INTO finance_company (company_code, company_name, grn_prefix, legacy_comp_id)
VALUES
  ('MAS', 'MAS Callnet', 'MAS', 1),
  ('IDC', 'IDC', 'IDC', 2)
ON DUPLICATE KEY UPDATE company_name = VALUES(company_name);

CREATE TABLE IF NOT EXISTS finance_grn_monthly_sequence (
  company_code VARCHAR(16) NOT NULL,
  period_code CHAR(7) NOT NULL COMMENT 'YYYY-MM of the accounting period the GRN books into',
  next_sequence BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_code, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO finance_config (config_key, config_value, description)
VALUES
  ('grn_number_format', 'legacy_branch_fy',
   'legacy_branch_fy = Mas/{branch_seq}/{YY}/{seq} from finance_grn_sequence. monthly_company = {prefix}/MM/YY/{seq} from finance_grn_monthly_sequence. Applies to NEWLY created GRNs only; historical numbers are never rewritten.'),
  ('grn_default_company_code', 'MAS',
   'Company used when a GRN does not name one. The per-company prefix lives in finance_company.grn_prefix, not here.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT '1090_finance_grn_monthly_sequence.sql applied' AS migration_status;
