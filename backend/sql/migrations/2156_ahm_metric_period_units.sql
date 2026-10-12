-- Migration 2156: AHM metrics that are not additive over a period.
-- Process Operations sums a 'count' metric across the days of a period. That is right for orders, qty and lines, but wrong for
-- "distinct outlets / agents per day" and for per-order / per-agent ratios (a 2-day period showed 13.9 lines per order instead of
-- ~5.2). Switching these four to the 'average' unit makes the page read them as the mean of the days that reported, and the
-- names say "per day". Only touches the rows migrations 2154/2155 created.
UPDATE kpi_metric_master SET unit = 'average', metric_name = 'AHM outlets covered per day'
 WHERE metric_code = 'AHM_OUTLETS';
UPDATE kpi_metric_master SET unit = 'average', metric_name = 'AHM telesales agents active per day'
 WHERE metric_code = 'AHM_TELESALES_AGENTS';
UPDATE kpi_metric_master SET unit = 'average', metric_name = 'AHM orders per telesales agent per day'
 WHERE metric_code = 'AHM_ORDERS_PER_AGENT';
UPDATE kpi_metric_master SET unit = 'average', metric_name = 'AHM lines per order'
 WHERE metric_code = 'AHM_LINES_PER_ORDER';
