-- Migration 506: Sales performance KPI metric foundation
-- Additive only. Do not execute against production without explicit approval.
USE mas_hrms;

INSERT INTO kpi_metric_master (
  metric_code,
  metric_name,
  category,
  unit,
  direction
) VALUES
  ('SALES_COUNT', 'Sales Count', 'sales', 'count', 'higher_is_better'),
  ('AOV', 'Average Order Value', 'sales', 'currency', 'higher_is_better'),
  ('COD_SHARE', 'COD Order Share', 'sales', 'percent', 'lower_is_better'),
  ('RTO_RATE', 'RTO Rate', 'sales', 'percent', 'lower_is_better')
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name),
  category = VALUES(category),
  unit = VALUES(unit),
  direction = VALUES(direction);

INSERT IGNORE INTO kpi_formula_version (
  formula_code,
  version_no,
  metric_code,
  formula_expression,
  numerator_definition,
  denominator_definition,
  source_system,
  effective_from,
  status
) VALUES
  ('SALES_TOTAL', 1, 'SALES_COUNT', 'COUNT(sales_orders)', 'sales_orders', NULL, 'sales', '2026-07-01', 'draft'),
  ('REVENUE_TOTAL', 1, 'REVENUE', 'SUM(net_revenue)', 'net_revenue', NULL, 'sales', '2026-07-01', 'draft'),
  ('AOV_WEIGHTED', 1, 'AOV', 'SUM(net_revenue) / NULLIF(SUM(sales_orders), 0)', 'net_revenue', 'sales_orders', 'sales', '2026-07-01', 'draft'),
  ('COD_SHARE', 1, 'COD_SHARE', 'SUM(cod_orders) / NULLIF(SUM(sales_orders), 0) * 100', 'cod_orders', 'sales_orders', 'sales', '2026-07-01', 'draft'),
  ('RTO_RATE', 1, 'RTO_RATE', 'SUM(rto_orders) / NULLIF(SUM(sales_orders), 0) * 100', 'rto_orders', 'sales_orders', 'sales', '2026-07-01', 'draft');

-- VERIFY AFTER STAGING EXECUTION:
-- SELECT metric_code, metric_name, unit, direction FROM kpi_metric_master WHERE metric_code IN ('SALES_COUNT','REVENUE','AOV','COD_SHARE','RTO_RATE');
-- SELECT formula_code, metric_code, status FROM kpi_formula_version WHERE formula_code IN ('SALES_TOTAL','REVENUE_TOTAL','AOV_WEIGHTED','COD_SHARE','RTO_RATE');
