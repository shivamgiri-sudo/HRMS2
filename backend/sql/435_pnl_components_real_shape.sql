-- 435_pnl_components_real_shape.sql
--
-- Realigns finance_pnl_component_master to the P&L the business actually runs, taken from
-- "Onfido PL_Updated till 29-July-26.xlsx" (Jul-2026 column):
--
--   Revenue                                    94,20,623
--   Agent Salary + Incentive   46,52,057          49.4%
--   DSC   # 46   Salary        14,07,527          14.9%
--   BMC   # 12   Salary         5,33,867           5.7%
--   DC Total                   65,93,451          70.0%   = Agent + DSC + BMC
--   Total Indirect Cost        16,88,359          17.9%
--   Total Cost                 82,81,810          87.9%   = DC + IDC
--   Operating Profit           11,38,813          12.1%   = Revenue - Total Cost
--
-- Three mismatches with what was seeded in 426:
--   1. IDC did not exist as a component at all, yet it is a whole cost block — and the workbook's
--      IDC sheet IS the branch-budget expense master (22 heads/40 sub-heads against the HRMS
--      master's 20/38 — the same list). This is why every GRN books to IDC.
--   2. DSC/BMC were modelled as people/non-people PAIRS. In the real statement they are salary
--      categories for two different populations: DSC is delivery support, BMC is non-operational
--      staff (admin, HR, IT). Neither has a non-people half — non-people cost is IDC.
--   3. The tail ran contribution -> EBITDA -> EBIT -> PBT -> PAT. The real statement stops at
--      Operating Profit.
--
-- Additive and reversible: components that do not exist in the real statement are RETIRED
-- (active_status = 0), never deleted, so anything still reading them keeps its row and the change
-- can be undone by flipping the flag back.
--
-- Rollback:
--   UPDATE finance_pnl_component_master SET active_status = 1
--    WHERE component_key IN ('dsc_people','dsc_non_people','bmc_people','bmc_non_people',
--          'contribution','contribution_margin_pct','ebitda','ebitda_margin_pct','depreciation',
--          'amortization','ebit','finance_cost','pbt','tax','pat');
--   DELETE FROM finance_pnl_component_master
--    WHERE component_key IN ('agent_salary_pct','dsc_headcount','dsc_salary','dsc_pct',
--          'bmc_headcount','bmc_salary','bmc_pct','dc_total','dc_pct','total_idc','idc_pct',
--          'total_cost','total_cost_pct','operating_profit','operating_profit_pct');

-- ── 1. retire what the real statement does not have ─────────────────────────
UPDATE finance_pnl_component_master
   SET active_status = 0
 WHERE component_key IN (
   -- DSC/BMC were never split people vs non-people; non-people cost is IDC.
   'dsc_people', 'dsc_non_people', 'bmc_people', 'bmc_non_people',
   -- The statement ends at Operating Profit; none of this tail appears on it.
   'contribution', 'contribution_margin_pct', 'ebitda', 'ebitda_margin_pct',
   'depreciation', 'amortization', 'ebit', 'finance_cost', 'pbt', 'tax', 'pat'
 );

-- ── 2. the real cost blocks and waterfall ───────────────────────────────────
-- source_field names match the camelCase keys resolveValue() reads off a P&L row.
INSERT INTO finance_pnl_component_master
  (component_key, display_name, section_key, parent_component_key, display_order,
   component_type, source_field, format_type, sign_convention, is_subtotal, active_status)
VALUES
  ('agent_salary_pct',    'Agent Salary %',        'cost',          'agent_salary', 205, 'RATIO',    'agentSalaryPct',      'PERCENTAGE', '+', 0, 1),

  ('dsc_headcount',       'DSC #',                 'cost',          NULL,           210, 'SOURCE_ACTUAL', 'dscHeadcount',   'COUNT',      '+', 0, 1),
  ('dsc_salary',          'DSC Salary',            'cost',          NULL,           215, 'SOURCE_ACTUAL', 'dscSalary',      'CURRENCY',   '+', 0, 1),
  ('dsc_pct',             'DSC %',                 'cost',          'dsc_salary',   220, 'RATIO',    'dscPct',              'PERCENTAGE', '+', 0, 1),

  ('bmc_headcount',       'BMC #',                 'cost',          NULL,           225, 'SOURCE_ACTUAL', 'bmcHeadcount',   'COUNT',      '+', 0, 1),
  ('bmc_salary',          'BMC Salary',            'cost',          NULL,           230, 'SOURCE_ACTUAL', 'bmcSalary',      'CURRENCY',   '+', 0, 1),
  ('bmc_pct',             'BMC %',                 'cost',          'bmc_salary',   235, 'RATIO',    'bmcPct',              'PERCENTAGE', '+', 0, 1),

  -- Direct Cost = Agent Salary + DSC + BMC
  ('dc_total',            'DC Total',              'cost',          NULL,           240, 'SUBTOTAL', 'directCostTotal',     'CURRENCY',   '+', 1, 1),
  ('dc_pct',              'DC %',                  'cost',          'dc_total',     245, 'RATIO',    'directCostPct',       'PERCENTAGE', '+', 0, 1),

  -- Indirect Cost = every approved GRN, by expense head/sub-head
  ('total_idc',           'Total Indirect Cost',   'cost',          NULL,           250, 'SUBTOTAL', 'indirectCostTotal',   'CURRENCY',   '+', 1, 1),
  ('idc_pct',             'Indirect Cost %',       'cost',          'total_idc',    255, 'RATIO',    'indirectCostPct',     'PERCENTAGE', '+', 0, 1),

  ('total_cost',          'Total Cost',            'cost',          NULL,           260, 'SUBTOTAL', 'totalCost',           'CURRENCY',   '+', 1, 1),
  ('total_cost_pct',      'Total Cost %',          'cost',          'total_cost',   265, 'RATIO',    'totalCostPct',        'PERCENTAGE', '+', 0, 1),

  ('operating_profit',    'Operating Profit',      'profitability', NULL,           270, 'SUBTOTAL', 'operatingProfit',     'CURRENCY',   '+', 1, 1),
  ('operating_profit_pct','Operating Profit %',    'profitability', 'operating_profit', 275, 'RATIO', 'operatingProfitPct', 'PERCENTAGE', '+', 0, 1)
ON DUPLICATE KEY UPDATE
  display_name    = VALUES(display_name),
  section_key     = VALUES(section_key),
  display_order   = VALUES(display_order),
  component_type  = VALUES(component_type),
  source_field    = VALUES(source_field),
  format_type     = VALUES(format_type),
  is_subtotal     = VALUES(is_subtotal),
  active_status   = VALUES(active_status);
