-- Create Missing KPI Metrics for Operations Dashboard
-- Run this ONLY if verification shows metrics are missing

-- IMPORTANT: Check first with verify-kpi-metrics.sql before running this

-- 1. Insert TALK_TIME metric if missing
INSERT INTO kpi_metric_master (
    id,
    metric_code,
    metric_name,
    family,
    category,
    unit,
    direction,
    description,
    active_status,
    created_at,
    updated_at
)
SELECT
    UUID(),
    'TALK_TIME',
    'Talk Time',
    'operations',
    'call_metrics',
    'seconds',
    'lower_is_better',
    'Average talk time per call in seconds (lower is better for efficiency)',
    1,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_metric_master WHERE metric_code = 'TALK_TIME'
);

-- 2. Insert NET_LOGIN metric if missing
INSERT INTO kpi_metric_master (
    id,
    metric_code,
    metric_name,
    family,
    category,
    unit,
    direction,
    description,
    active_status,
    created_at,
    updated_at
)
SELECT
    UUID(),
    'NET_LOGIN',
    'Net Login Time',
    'operations',
    'attendance',
    'seconds',
    'higher_is_better',
    'Total productive login time excluding breaks (higher is better)',
    1,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_metric_master WHERE metric_code = 'NET_LOGIN'
);

-- 3. Insert TOTAL_CALLS metric if missing (alternative to DIALS)
INSERT INTO kpi_metric_master (
    id,
    metric_code,
    metric_name,
    family,
    category,
    unit,
    direction,
    description,
    active_status,
    created_at,
    updated_at
)
SELECT
    UUID(),
    'TOTAL_CALLS',
    'Total Calls Handled',
    'operations',
    'call_metrics',
    'count',
    'higher_is_better',
    'Total number of calls handled (inbound + outbound)',
    1,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_metric_master WHERE metric_code = 'TOTAL_CALLS'
);

-- 4. Verify insertions
SELECT
    metric_code,
    metric_name,
    family,
    unit,
    direction,
    CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
         THEN '✓ JUST CREATED' ELSE 'Existed before' END AS status
FROM kpi_metric_master
WHERE metric_code IN ('TALK_TIME', 'NET_LOGIN', 'TOTAL_CALLS', 'DIALS')
ORDER BY metric_code;

-- 5. Alternative: If DIALS already exists and covers TOTAL_CALLS, just verify
SELECT
    'HD / Total Calls Metric' AS info,
    metric_code,
    metric_name,
    'Can be used for HD (Handling/Dials) metric' AS note
FROM kpi_metric_master
WHERE metric_code IN ('DIALS', 'CALLS_HANDLED', 'TOTAL_CALLS')
  AND family = 'operations';

-- 6. Alternative: If LOGIN_HOURS exists instead of NET_LOGIN
SELECT
    'Login Time Metric' AS info,
    metric_code,
    metric_name,
    'Can be used for Net Login metric' AS note
FROM kpi_metric_master
WHERE metric_code IN ('NET_LOGIN', 'LOGIN_HOURS', 'LOGIN_TIME')
  AND family = 'operations';

-- 7. Show all operations metrics after insertion
SELECT
    'All Operations Metrics' AS section,
    metric_code,
    metric_name,
    category,
    unit,
    direction
FROM kpi_metric_master
WHERE family = 'operations'
  AND active_status = 1
ORDER BY category, metric_code;
