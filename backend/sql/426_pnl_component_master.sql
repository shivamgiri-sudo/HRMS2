-- 426_pnl_component_master.sql
-- P&L redesign (PR 3): a controlled component dictionary driving the transposed statement view
-- (components as rows, entities as dynamic columns). This is a pure display/ordering/formatting
-- dictionary — source_field names the exact BpoPnlRow property (bpo-pnl.service.ts) it reads.
-- No formulas live here; all numbers still come from the single canonical engine
-- (bpo-pnl.calculation.ts -> bpo-pnl.service.ts -> bpo-pnl-allocation-overlay.service.ts).
--
-- Rollback (manual, if ever needed before this ships to any environment):
--   DROP TABLE IF EXISTS finance_pnl_component_master;

CREATE TABLE IF NOT EXISTS finance_pnl_component_master (
  component_key       VARCHAR(60) NOT NULL PRIMARY KEY,
  display_name        VARCHAR(120) NOT NULL,
  section_key         ENUM('headcount','revenue','cost','profitability') NOT NULL,
  parent_component_key VARCHAR(60) NULL,
  display_order       INT NOT NULL,
  component_type       ENUM('SOURCE_ACTUAL','SUM','SUBTOTAL','RATIO') NOT NULL DEFAULT 'SOURCE_ACTUAL',
  source_field        VARCHAR(60) NOT NULL,
  format_type         ENUM('CURRENCY','PERCENTAGE','COUNT') NOT NULL DEFAULT 'CURRENCY',
  sign_convention     ENUM('+','-') NOT NULL DEFAULT '+',
  is_subtotal         TINYINT(1) NOT NULL DEFAULT 0,
  active_status       TINYINT(1) NOT NULL DEFAULT 1,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pnl_component_parent
    FOREIGN KEY (parent_component_key) REFERENCES finance_pnl_component_master(component_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO finance_pnl_component_master
  (component_key, display_name, section_key, parent_component_key, display_order, component_type, source_field, format_type, sign_convention, is_subtotal)
VALUES
  ('contracted_seats',        'Contracted Seats',           'headcount',     NULL, 10, 'SOURCE_ACTUAL', 'contractedSeats',       'COUNT',      '+', 0),
  ('active_headcount',        'Active Headcount',           'headcount',     NULL, 20, 'SOURCE_ACTUAL', 'activeHc',              'COUNT',      '+', 0),
  ('agent_headcount',         'Agent Headcount',            'headcount',     NULL, 30, 'SOURCE_ACTUAL', 'agentHeadcount',        'COUNT',      '+', 0),
  ('billable_headcount',      'Billable Headcount',         'headcount',     NULL, 40, 'SOURCE_ACTUAL', 'billableHc',            'COUNT',      '+', 0),

  ('gross_potential_revenue', 'Gross Potential Revenue',    'revenue',       NULL, 100, 'SOURCE_ACTUAL', 'grossPotentialRevenue', 'CURRENCY',   '+', 0),
  ('base_earned_revenue',     'Base Earned Revenue',        'revenue',       NULL, 110, 'SOURCE_ACTUAL', 'baseEarnedRevenue',     'CURRENCY',   '+', 0),
  ('minimum_commitment_topup','Minimum Commitment Top-up',  'revenue',       NULL, 120, 'SOURCE_ACTUAL', 'minimumCommitmentTopUp','CURRENCY',   '+', 0),
  ('incentive_revenue',       'Incentives and Rewards',     'revenue',       NULL, 130, 'SOURCE_ACTUAL', 'incentiveRevenue',      'CURRENCY',   '+', 0),
  ('penalty',                 'Penalties and SLA Deductions','revenue',      NULL, 140, 'SOURCE_ACTUAL', 'penalty',               'CURRENCY',   '-', 0),
  ('sla_deduction',           'SLA Deduction',              'revenue',       NULL, 150, 'SOURCE_ACTUAL', 'slaDeduction',          'CURRENCY',   '-', 0),
  ('credit_note',             'Credit Notes',               'revenue',       NULL, 160, 'SOURCE_ACTUAL', 'creditNote',            'CURRENCY',   '-', 0),
  ('recognized_revenue',      'Recognised Revenue',         'revenue',       NULL, 170, 'SUBTOTAL',      'recognizedRevenue',     'CURRENCY',   '+', 1),

  ('agent_salary',            'Agent Salary',               'cost',          NULL, 200, 'SOURCE_ACTUAL', 'agentSalary',           'CURRENCY',   '+', 0),
  ('dsc_people',              'DSC People',                 'cost',          NULL, 210, 'SOURCE_ACTUAL', 'dscPeople',             'CURRENCY',   '+', 0),
  ('dsc_non_people',          'DSC Non-People',             'cost',          NULL, 220, 'SOURCE_ACTUAL', 'dscNonPeople',          'CURRENCY',   '+', 0),
  ('total_dsc',               'Total DSC',                  'cost',          NULL, 230, 'SUBTOTAL',      'dsc',                   'CURRENCY',   '+', 1),
  ('bmc_people',              'BMC People',                 'cost',          NULL, 240, 'SOURCE_ACTUAL', 'bmcPeople',             'CURRENCY',   '+', 0),
  ('bmc_non_people',          'BMC Non-People',             'cost',          NULL, 250, 'SOURCE_ACTUAL', 'bmcNonPeople',          'CURRENCY',   '+', 0),
  ('total_bmc',               'Total BMC',                  'cost',          NULL, 260, 'SUBTOTAL',      'bmc',                   'CURRENCY',   '+', 1),

  ('contribution',            'Contribution',               'profitability', NULL, 300, 'SUBTOTAL',      'contribution',          'CURRENCY',   '+', 1),
  ('contribution_margin_pct', 'Contribution Margin %',      'profitability', 'contribution', 310, 'RATIO', 'contributionMarginPct','PERCENTAGE', '+', 0),
  ('ebitda',                  'EBITDA',                      'profitability', NULL, 320, 'SUBTOTAL',      'ebitda',                'CURRENCY',   '+', 1),
  ('ebitda_margin_pct',       'EBITDA Margin %',            'profitability', 'ebitda', 330, 'RATIO',        'ebitdaMarginPct',       'PERCENTAGE', '+', 0),
  ('depreciation',            'Depreciation',                'profitability', NULL, 340, 'SOURCE_ACTUAL', 'depreciation',          'CURRENCY',   '-', 0),
  ('amortization',            'Amortisation',                'profitability', NULL, 350, 'SOURCE_ACTUAL', 'amortization',          'CURRENCY',   '-', 0),
  ('ebit',                    'EBIT',                        'profitability', NULL, 360, 'SUBTOTAL',      'ebit',                  'CURRENCY',   '+', 1),
  ('finance_cost',            'Finance Cost',                'profitability', NULL, 370, 'SOURCE_ACTUAL', 'financeCost',           'CURRENCY',   '-', 0),
  ('pbt',                     'PBT',                         'profitability', NULL, 380, 'SUBTOTAL',      'pbt',                   'CURRENCY',   '+', 1),
  ('tax',                     'Tax',                         'profitability', NULL, 390, 'SOURCE_ACTUAL', 'tax',                   'CURRENCY',   '-', 0),
  ('pat',                     'PAT',                         'profitability', NULL, 400, 'SUBTOTAL',      'pat',                   'CURRENCY',   '+', 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  section_key = VALUES(section_key),
  parent_component_key = VALUES(parent_component_key),
  display_order = VALUES(display_order),
  component_type = VALUES(component_type),
  source_field = VALUES(source_field),
  format_type = VALUES(format_type),
  sign_convention = VALUES(sign_convention),
  is_subtotal = VALUES(is_subtotal);
