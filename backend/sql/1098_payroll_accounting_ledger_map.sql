-- 1098_payroll_accounting_ledger_map.sql
-- The Payroll → Tally salary voucher mapping layer.
--
-- Two masters, both configuration rather than code, because the brief is explicit that ledger
-- names must not be hardcoded inside payroll calculation:
--
--   finance_payroll_entity_rule   which legal entity an employee's salary posts to
--   finance_payroll_ledger_map    which Tally ledger each payroll component becomes
--
-- WHY THE ENTITY RULE IS A TABLE AND NOT AN IF-STATEMENT
-- The business runs two entities: MAS = MasCallnet, IDC = iSpark Data Connect. HRMS2's payroll
-- has no company dimension at all — nothing in modules/payroll references company_id,
-- legal_entity or company_code — so today MAS and IDC cannot be separated, and faking it from
-- Branch is wrong: HEAD OFFICE issues vouchers under BOTH entities
-- (HEAD OFFICE/MAS/06/26/614 and HEAD OFFICE/IDC/06/26/614).
--
-- The dimensions that CAN separate them already exist on employees:
--   employment_type  ONROLL 921 | MGMT. TRAINEE 183 | Full Time 21
--   cost_centre_id → cost_centre_master.company_name
-- and the distribution is suggestive — MGMT. TRAINEE exists at AHMEDABAD-JALDARSHAN (166) and
-- nowhere in NOIDA or NOIDA-2, which is exactly where the reference MAS voucher's two unnamed
-- columns are non-zero and zero respectively.
--
-- Suggestive is not proven, so the rule is DATA. Each row matches on any combination of branch,
-- cost centre, employment type and billable status, and the most specific match wins. Whatever
-- the real rule turns out to be, it becomes a row rather than a code change — and if the
-- trainee hypothesis is wrong, nothing needs rewriting.
--
-- NO ROWS ARE SEEDED INTO THE ENTITY RULE. An empty rule table means "cannot determine the
-- entity", and the generator must refuse to produce a voucher rather than guess. Silently
-- defaulting everyone to MAS would put iSpark salaries in MasCallnet's books.
--
-- WHY THE LEDGER MAP IS SEEDED
-- Those ledger names are verified from the supplied MAS and IDC June-2026 vouchers, so they are
-- a known contract rather than an assumption. Two quirks are preserved deliberately, both
-- confirmed as intended: `Gross Salary` and `GROSS SALARY` are DIFFERENT ledgers, and
-- `Advance Against Salary (BRANCH)` is branch-qualified by pattern.
--
-- Additive only, safe to rerun.

CREATE TABLE IF NOT EXISTS finance_payroll_entity_rule (
  id CHAR(36) NOT NULL,
  company_code VARCHAR(16) NOT NULL COMMENT 'FK by value to finance_company.company_code',
  -- Every matcher is optional. NULL means "does not constrain", so a rule can be as broad or
  -- as narrow as the business needs.
  branch_id CHAR(36) NULL,
  cost_centre_id CHAR(36) NULL,
  employment_type VARCHAR(50) NULL COMMENT 'ONROLL | MGMT. TRAINEE | Full Time, as employees.employment_type holds it',
  billable_status VARCHAR(10) NULL,
  -- Higher wins. Lets a narrow exception sit on top of a broad default without deleting it.
  priority INT NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(500) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_payroll_entity_rule_match (active_status, priority, effective_from),
  INDEX idx_payroll_entity_rule_company (company_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_payroll_ledger_map (
  id CHAR(36) NOT NULL,
  company_code VARCHAR(16) NOT NULL,
  -- What HRMS2 calls it. Resolved against the payroll component snapshot, not free text.
  component_code VARCHAR(60) NOT NULL,
  component_kind ENUM('earning','deduction','employer_cost','net_payable','statutory_payable')
    NOT NULL DEFAULT 'earning',
  -- What Tally calls it. Header spelling is a format contract; see the reference vouchers.
  ledger_name VARCHAR(255) NOT NULL,
  tally_ledger_name VARCHAR(255) NULL COMMENT 'When the Tally name differs from the display name',
  debit_credit ENUM('D','C') NOT NULL,
  -- The reference vouchers put the BRANCH NAME in Cost Category and a short code + YYMM in
  -- Cost Centre (AHM/2606, HO/2606, NOIDA-2/2606, NOIDA-DD/2606). Held as rules, not literals,
  -- because the period suffix changes every month.
  cost_category_rule VARCHAR(60) NOT NULL DEFAULT 'branch_name',
  cost_centre_rule VARCHAR(60) NOT NULL DEFAULT 'branch_short_code_period',
  voucher_type VARCHAR(40) NOT NULL DEFAULT 'JRNLSAL',
  -- Branch-qualified ledgers such as 'Advance Against Salary (HEAD OFFICE)'. Confirmed a
  -- pattern rather than hand-typed, so it is generated, not enumerated per branch.
  branch_qualified TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_ledger_map (company_code, component_code, ledger_name, effective_from),
  INDEX idx_payroll_ledger_map_company (company_code, active_status, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeded for both entities from the reference vouchers. display_order reproduces the row order
-- those files use, because voucher line order is part of the format.
INSERT INTO finance_payroll_ledger_map
  (id, company_code, component_code, component_kind, ledger_name, debit_credit,
   branch_qualified, display_order, effective_from, created_by)
-- The joined SELECT is wrapped in a derived table: MySQL will not parse
-- ON DUPLICATE KEY UPDATE directly after a JOIN in an INSERT ... SELECT.
SELECT * FROM (
  SELECT UUID() AS id, c.company_code, m.component_code, m.component_kind, m.ledger_name,
         m.debit_credit, m.branch_qualified, m.display_order, '2026-04-01' AS effective_from,
         'SYSTEM_SEED' AS created_by
    FROM (SELECT 'MAS' AS company_code UNION ALL SELECT 'IDC') c
    JOIN (
    SELECT 'GROSS_EARNED'      AS component_code, 'earning'           AS component_kind, 'Gross Salary'                       AS ledger_name, 'D' AS debit_credit, 0 AS branch_qualified, 1  AS display_order
    UNION ALL SELECT 'ESIC_EMPLOYER', 'employer_cost',     'Employer''s Contribution to Esic',  'D', 0, 2
    UNION ALL SELECT 'EPF_EMPLOYER',  'employer_cost',     'Employer''s Contribution to Epf',   'D', 0, 3
    UNION ALL SELECT 'EPF_ADMIN',     'employer_cost',     'EPF Admin Charges',                 'D', 0, 4
    UNION ALL SELECT 'NET_PAYABLE',   'net_payable',       'Salary Payable A/C',                'C', 0, 5
    UNION ALL SELECT 'ESIC_PAYABLE',  'statutory_payable', 'ESIC Payable',                      'C', 0, 6
    UNION ALL SELECT 'EPF_PAYABLE',   'statutory_payable', 'EPF Payable',                       'C', 0, 7
    UNION ALL SELECT 'ADVANCE_RECOVERY','deduction',       'Advance Against Salary',            'C', 1, 8
    UNION ALL SELECT 'INSURANCE',     'deduction',         'STAY HEALTHY STAY HAPPY INSURANCE', 'C', 0, 9
    -- Distinct from 'Gross Salary' above. Confirmed deliberate: two separate Tally ledgers.
    UNION ALL SELECT 'GROSS_SALARY_ALT','earning',         'GROSS SALARY',                      'C', 0, 10
    UNION ALL SELECT 'PROFESSIONAL_TAX','deduction',       'Professional Tax 2026-27',          'C', 0, 11
    UNION ALL SELECT 'TDS_SALARY',    'deduction',         'TDS SALARY 2026-27',                'C', 0, 12
    ) m
) AS seed
ON DUPLICATE KEY UPDATE updated_at = updated_at;

SELECT CONCAT('1098 payroll ledger map rows: ', COUNT(*)) AS migration_status
  FROM finance_payroll_ledger_map;
