-- Migration 2154: AHM process-grain KPI metrics (read by Process Operations).
-- AHM's numbers live in db_masmis.ahm_dump_raw (one row per outlet/SKU order line). ahm-metrics.service.ts rolls them up per
-- survey day into process_metric_actual under these metric codes, so the Process Operations KPI deck has real AHM tiles.
-- Additive: INSERT IGNORE into kpi_metric_master only. Percent metrics keep their parts in rollup_numerator/denominator.
INSERT IGNORE INTO kpi_metric_master
  (id, metric_code, metric_name, category, family, unit, direction, aggregation_method, active_status)
VALUES
  (UUID(), 'AHM_ORDERS',            'AHM orders taken',               'sales',      'volume', 'count',    'higher_is_better', 'sum',     1),
  (UUID(), 'AHM_OUTLETS',           'AHM outlets covered',            'operations', 'volume', 'count',    'higher_is_better', 'sum',     1),
  (UUID(), 'AHM_ORDER_QTY',         'AHM order quantity',             'sales',      'volume', 'count',    'higher_is_better', 'sum',     1),
  (UUID(), 'AHM_ORDER_VALUE',       'AHM order value',                'sales',      'volume', 'currency', 'higher_is_better', 'sum',     1),
  (UUID(), 'AHM_DELIVERED_PCT',     'AHM orders delivered %',         'operations', 'rate',   'percent',  'higher_is_better', 'average', 1),
  (UUID(), 'AHM_FILL_RATE_PCT',     'AHM fill rate (sales vs order qty) %', 'operations', 'rate', 'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'AHM_SURVEY_TAKEN_PCT',  'AHM orders with survey taken %', 'sales',      'rate',   'percent',  'higher_is_better', 'average', 1),
  (UUID(), 'AHM_TELESALES_AGENTS',  'AHM telesales agents active',    'operations', 'volume', 'count',    'higher_is_better', 'average', 1),
  (UUID(), 'AHM_ORDERS_PER_AGENT',  'AHM orders per telesales agent', 'operations', 'rate',   'count',    'higher_is_better', 'average', 1);
