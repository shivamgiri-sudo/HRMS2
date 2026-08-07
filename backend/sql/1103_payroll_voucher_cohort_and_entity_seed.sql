-- 1103_payroll_voucher_cohort_and_entity_seed.sql
-- Makes the salary voucher generatable: the entity rule gets the matchers it actually needs,
-- and the two-column split becomes configuration.
--
-- WHAT WAS RESOLVED ON 2026-08-08 (see docs/finance/salary-voucher-column-analysis.md)
-- Both unknowns that blocked 1098 are now answered from data, against the June-2026 run
-- 939efccb-e7ea-4194-b059-db9b9c200a7d.
--
-- 1. ENTITY IS THE EMPLOYEE CODE PREFIX. `MAS…` is MasCallnet, `IDC…` is iSpark Data Connect.
--    1098 speculated that employment_type or cost centre carried it and deliberately seeded
--    nothing. The speculation was wrong, and the trainee hypothesis it rested on is disproven:
--    HEAD OFFICE has 16 ONROLL and 0 trainees in that run, yet its extra column holds 166,262.
--    finance_payroll_entity_rule has no matcher for a code prefix, so one is added here.
--
-- 2. THE MAS VOUCHER'S EXTRA COLUMNS ARE C-SUITE REMUNERATION, split out from staff salary.
--    Amount = col4 + col5 on every row, and a SINGLE employee reproduces all four of col4's
--    headline figures at each branch:
--      HEAD OFFICE           166,262 / 133,462 / 16,800 / 16,000  MAS00001, Chief Executive Officer
--      AHMEDABAD-JALDARSHAN   99,598 /  84,958 /  8,640 /  5,800  MAS02477, Chief Operations Officer
--      NOIDA, NOIDA-2         all zero — neither branch has a CHIEF* employee
--    The two ZERO branches are what make this conclusive rather than coincidental: if the split
--    were "highest earner per branch" they would carry a figure. Key managerial remuneration
--    posting to its own ledger is ordinary Tally practice.
--
-- WHY A COHORT TABLE RATHER THAN AN IF-STATEMENT
-- The C-suite changes. Two employee codes compiled into a service would be wrong the first time
-- someone is appointed or leaves, and wrong silently — the voucher would still balance, it would
-- just put a director's pay in the staff column. As a row, Finance changes it without a deploy.
--
-- The IDC rule is seeded even though it matches nobody today: mas_hrms holds ZERO IDC-coded
-- employees out of 58,627, and NOIDA-DIALDESK — an IDC voucher branch — has 149 employees and 0
-- active. Seeding it costs nothing and means the day that payroll arrives, the rule is already
-- there rather than being a forgotten prerequisite.
--
-- Additive only, safe to rerun.

-- ── Matchers the entity rule was missing ──────────────────────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_payroll_entity_rule'
      AND column_name = 'employee_code_prefix') = 0,
  'ALTER TABLE finance_payroll_entity_rule
     ADD COLUMN employee_code_prefix VARCHAR(16) NULL
       COMMENT ''Matches employees.employee_code LIKE <prefix>%. The verified entity key.'',
     ADD COLUMN designation_pattern VARCHAR(120) NULL
       COMMENT ''Matches designation_master.designation_name LIKE this pattern''',
  'SELECT ''finance_payroll_entity_rule matchers already present'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── The voucher column split ──────────────────────────────────────────────────
-- A voucher line may be reported as a single amount or split across N cohort columns. Column 0
-- is always "everyone not matched by a cohort rule", so a company with no rows here produces a
-- single-amount voucher — which is exactly what IDC's reference file looks like.
CREATE TABLE IF NOT EXISTS finance_payroll_voucher_cohort (
  id CHAR(36) NOT NULL,
  company_code VARCHAR(16) NOT NULL,
  cohort_key VARCHAR(40) NOT NULL COMMENT 'Stable key used by the generator',
  label VARCHAR(120) NOT NULL COMMENT 'Column heading in the export',
  -- Matchers. All optional; a cohort with none matches nobody, which is safer than matching all.
  designation_pattern VARCHAR(120) NULL,
  employment_type VARCHAR(50) NULL,
  employee_code_prefix VARCHAR(16) NULL,
  -- 1-based. Column 0 is the implicit remainder and is never stored.
  column_index INT NOT NULL,
  priority INT NOT NULL DEFAULT 0 COMMENT 'Higher wins when an employee matches two cohorts',
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_cohort (company_code, cohort_key),
  INDEX idx_payroll_cohort_lookup (company_code, active_status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Seeds ─────────────────────────────────────────────────────────────────────
-- Entity: the verified code prefix. Guarded so a re-run does not duplicate.
INSERT INTO finance_payroll_entity_rule
  (id, company_code, employee_code_prefix, priority, effective_from, active_status, notes, created_by)
SELECT UUID(), 'MAS', 'MAS', 100, '2000-04-01', 1,
       'Verified 2026-08-08: employee_code prefix is the legal entity. 23,827 MAS-coded employees.',
       'system'
 WHERE NOT EXISTS (
   SELECT 1 FROM finance_payroll_entity_rule
    WHERE company_code = 'MAS' AND employee_code_prefix = 'MAS');

INSERT INTO finance_payroll_entity_rule
  (id, company_code, employee_code_prefix, priority, effective_from, active_status, notes, created_by)
SELECT UUID(), 'IDC', 'IDC', 100, '2000-04-01', 1,
       'Seeded ahead of the data: mas_hrms holds 0 IDC-coded employees as of 2026-08-08, so this rule matches nobody until that payroll is migrated in.',
       'system'
 WHERE NOT EXISTS (
   SELECT 1 FROM finance_payroll_entity_rule
    WHERE company_code = 'IDC' AND employee_code_prefix = 'IDC');

-- Cohort: the MAS voucher's second column. Only MAS — the IDC reference voucher has no split.
INSERT INTO finance_payroll_voucher_cohort
  (id, company_code, cohort_key, label, designation_pattern, column_index, priority, active_status, notes)
SELECT UUID(), 'MAS', 'c_suite', 'C-Suite', 'CHIEF%', 1, 100, 1,
       'Verified 2026-08-08 against the June-2026 MAS voucher: MAS00001 (CEO, Head Office) and MAS02477 (COO, Ahmedabad) each reproduce all four of the column exactly, and the two branches with no CHIEF employee have a zero column.'
 WHERE NOT EXISTS (
   SELECT 1 FROM finance_payroll_voucher_cohort WHERE company_code = 'MAS' AND cohort_key = 'c_suite');

SELECT '1103_payroll_voucher_cohort_and_entity_seed.sql applied' AS migration_status;
