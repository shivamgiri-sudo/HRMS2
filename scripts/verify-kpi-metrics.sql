-- Verify KPI Metrics for Operations Dashboard
-- Check if required metrics exist in kpi_metric_master

-- 1. Check all operations family metrics
SELECT
    metric_code,
    metric_name,
    unit,
    direction,
    family,
    active_status
FROM kpi_metric_master
WHERE family = 'operations'
ORDER BY metric_code;

-- 2. Check specifically for requested metrics
SELECT
    metric_code,
    metric_name,
    unit,
    CASE
        WHEN metric_code IN ('TALK_TIME', 'NET_LOGIN', 'DIALS', 'TOTAL_CALLS') THEN '✓ REQUESTED'
        ELSE ''
    END AS is_requested
FROM kpi_metric_master
WHERE metric_code IN (
    'TALK_TIME',
    'NET_LOGIN',
    'DIALS',
    'TOTAL_CALLS',
    'CALLS_HANDLED',
    'LOGIN_HOURS',
    'AHT',
    'ACW'
)
ORDER BY is_requested DESC, metric_code;

-- 3. Check if metrics have data in kpi_daily_actual
SELECT
    kmm.metric_code,
    kmm.metric_name,
    COUNT(DISTINCT kda.employee_id) AS employees_with_data,
    COUNT(*) AS total_records,
    MIN(kda.score_date) AS earliest_date,
    MAX(kda.score_date) AS latest_date,
    AVG(kda.actual_value) AS avg_value
FROM kpi_metric_master kmm
LEFT JOIN kpi_daily_actual kda ON kda.metric_id = kmm.id
WHERE kmm.family = 'operations'
GROUP BY kmm.id, kmm.metric_code, kmm.metric_name
ORDER BY total_records DESC;

-- 4. Sample data for one employee (last 7 days)
SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) AS full_name,
    kmm.metric_code,
    kmm.metric_name,
    kda.score_date,
    kda.actual_value,
    CASE
        WHEN kmm.unit = 'seconds' THEN SEC_TO_TIME(kda.actual_value)
        WHEN kmm.unit = 'percent' THEN CONCAT(kda.actual_value, '%')
        ELSE kda.actual_value
    END AS formatted_value,
    kda.source
FROM kpi_daily_actual kda
JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
JOIN employees e ON e.id = kda.employee_id
WHERE kmm.family = 'operations'
  AND kda.score_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  AND e.active_status = 1
ORDER BY e.employee_code, kda.score_date DESC, kmm.metric_code
LIMIT 50;

-- 5. Check if missing metrics need to be created
SELECT 'Missing Metrics Check' AS info;

SELECT
    'TALK_TIME' AS metric_code,
    CASE WHEN EXISTS(SELECT 1 FROM kpi_metric_master WHERE metric_code = 'TALK_TIME')
         THEN '✓ EXISTS' ELSE '✗ MISSING - NEEDS CREATION' END AS status
UNION ALL
SELECT
    'NET_LOGIN' AS metric_code,
    CASE WHEN EXISTS(SELECT 1 FROM kpi_metric_master WHERE metric_code = 'NET_LOGIN')
         THEN '✓ EXISTS' ELSE '✗ MISSING - NEEDS CREATION' END AS status
UNION ALL
SELECT
    'DIALS' AS metric_code,
    CASE WHEN EXISTS(SELECT 1 FROM kpi_metric_master WHERE metric_code = 'DIALS')
         THEN '✓ EXISTS' ELSE '✗ MISSING - NEEDS CREATION' END AS status
UNION ALL
SELECT
    'TOTAL_CALLS' AS metric_code,
    CASE WHEN EXISTS(SELECT 1 FROM kpi_metric_master WHERE metric_code = 'TOTAL_CALLS')
         THEN '✓ EXISTS' ELSE '✗ MISSING - NEEDS CREATION' END AS status;

-- 6. If metrics are missing, here are the INSERT statements:

/*
-- Insert TALK_TIME metric if missing
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, active_status)
SELECT UUID(), 'TALK_TIME', 'Talk Time', 'operations', 'call_metrics', 'seconds', 'lower_is_better', 1
WHERE NOT EXISTS (SELECT 1 FROM kpi_metric_master WHERE metric_code = 'TALK_TIME');

-- Insert NET_LOGIN metric if missing
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, active_status)
SELECT UUID(), 'NET_LOGIN', 'Net Login Time', 'operations', 'attendance', 'seconds', 'higher_is_better', 1
WHERE NOT EXISTS (SELECT 1 FROM kpi_metric_master WHERE metric_code = 'NET_LOGIN');

-- Insert TOTAL_CALLS metric if missing (if DIALS doesn't cover it)
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, active_status)
SELECT UUID(), 'TOTAL_CALLS', 'Total Calls Handled', 'operations', 'call_metrics', 'count', 'higher_is_better', 1
WHERE NOT EXISTS (SELECT 1 FROM kpi_metric_master WHERE metric_code = 'TOTAL_CALLS');
*/

-- 7. Check APR sync status (from vicidial_agent_log)
SELECT
    'APR Sync Check' AS info,
    COUNT(DISTINCT employee_id) AS employees_synced,
    MAX(score_date) AS last_sync_date,
    COUNT(*) AS total_records
FROM kpi_daily_actual
WHERE source = 'apr'
  AND score_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);

-- 8. Check Dialer sync status
SELECT
    'Dialer Sync Check' AS info,
    COUNT(DISTINCT employee_id) AS employees_synced,
    MAX(score_date) AS last_sync_date,
    COUNT(*) AS total_records
FROM kpi_daily_actual
WHERE source = 'dialer'
  AND score_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);
