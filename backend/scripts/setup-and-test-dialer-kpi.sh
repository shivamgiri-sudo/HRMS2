#!/bin/bash

# Setup and Test Dialer KPI Integration
# Run this after database is accessible

set -e

echo "================================================================================"
echo "DIALER KPI INTEGRATION - SETUP AND TEST"
echo "================================================================================"

# Database credentials must be supplied by environment.
: "${DB_HOST:?DB_HOST is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${DB_NAME:?DB_NAME is required}"
DB_PORT="${DB_PORT:-3306}"

echo ""
echo "Step 1: Creating KPI Metrics..."
echo "================================================================================"

# Create KPI metrics
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<EOF
-- Create call center KPI metrics
INSERT INTO kpi_metric (id, metric_code, metric_name, family, unit, direction, description, active_status, created_at)
VALUES
  (UUID(), 'AHT', 'Average Handle Time', 'operations', 'seconds', 'lower_is_better',
   'Average time spent handling calls including talk time, hold time, and after-call work', 1, NOW()),

  (UUID(), 'ACW', 'After Call Work', 'operations', 'seconds', 'lower_is_better',
   'Average time spent on post-call documentation and follow-up tasks', 1, NOW()),

  (UUID(), 'TALK_TIME', 'Talk Time', 'operations', 'seconds', 'higher_is_better',
   'Average time spent actively talking with customers', 1, NOW()),

  (UUID(), 'HOLD_TIME', 'Hold Time', 'operations', 'seconds', 'lower_is_better',
   'Average time customers spend on hold during calls', 1, NOW()),

  (UUID(), 'CALLS_HANDLED', 'Calls Handled', 'operations', 'count', 'higher_is_better',
   'Total number of calls handled by agent', 1, NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  active_status = VALUES(active_status);

SELECT 'Metrics created successfully' as status;
EOF

echo "✅ KPI metrics created"

echo ""
echo "Step 2: Verifying Metrics..."
echo "================================================================================"

mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT
  metric_code,
  metric_name,
  family,
  unit,
  direction
FROM kpi_metric
WHERE metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
ORDER BY metric_code;
"

echo ""
echo "Step 3: Getting Active Processes..."
echo "================================================================================"

mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT
  id,
  process_name,
  process_code
FROM process_master
WHERE active_status = 1
LIMIT 5;
" > /tmp/processes.txt

cat /tmp/processes.txt

echo ""
echo "Step 4: Creating Default Process Targets (First Active Process)..."
echo "================================================================================"

# Get first process ID
FIRST_PROCESS=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -e "
SELECT id FROM process_master WHERE active_status = 1 LIMIT 1;
" | head -1)

if [ -n "$FIRST_PROCESS" ]; then
  echo "Setting up targets for process: $FIRST_PROCESS"

  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<EOF
INSERT INTO kpi_process_config (id, process_id, metric_id, target_value, min_threshold, weightage, active_status, created_at)
SELECT
  UUID(),
  '$FIRST_PROCESS',
  km.id,
  CASE km.metric_code
    WHEN 'AHT' THEN 300
    WHEN 'ACW' THEN 60
    WHEN 'TALK_TIME' THEN 240
    WHEN 'HOLD_TIME' THEN 30
    WHEN 'CALLS_HANDLED' THEN 80
  END as target_value,
  CASE km.metric_code
    WHEN 'AHT' THEN 360
    WHEN 'ACW' THEN 90
    WHEN 'TALK_TIME' THEN 180
    WHEN 'HOLD_TIME' THEN 60
    WHEN 'CALLS_HANDLED' THEN 60
  END as min_threshold,
  CASE km.metric_code
    WHEN 'AHT' THEN 30
    WHEN 'ACW' THEN 20
    WHEN 'TALK_TIME' THEN 20
    WHEN 'HOLD_TIME' THEN 15
    WHEN 'CALLS_HANDLED' THEN 15
  END as weightage,
  1,
  NOW()
FROM kpi_metric km
WHERE km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
ON DUPLICATE KEY UPDATE
  target_value = VALUES(target_value),
  min_threshold = VALUES(min_threshold);

SELECT 'Process targets configured' as status;
EOF

  echo "✅ Process targets set for: $FIRST_PROCESS"
else
  echo "⚠️  No active processes found - skipping target configuration"
fi

echo ""
echo "Step 5: Verification Summary..."
echo "================================================================================"

mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT
  'Metrics' as type,
  COUNT(*) as count
FROM kpi_metric
WHERE metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
UNION ALL
SELECT
  'Process Configs' as type,
  COUNT(*) as count
FROM kpi_process_config kpc
JOIN kpi_metric km ON km.id = kpc.metric_id
WHERE km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED');
"

echo ""
echo "================================================================================"
echo "✅ DIALER KPI SETUP COMPLETE"
echo "================================================================================"
echo ""
echo "Next Steps:"
echo "  1. Start backend server: npm run dev"
echo "  2. Test employee metrics: GET /api/dialer/kpi/employee/:code/:date"
echo "  3. Test process leaderboard: GET /api/dialer/kpi/leaderboard/:processId/:date"
echo "  4. Sync data: POST /api/dialer/kpi/sync/process {processId, date}"
echo ""
echo "Documentation:"
echo "  - backend/docs/DIALER_KPI_INTEGRATION.md"
echo "  - backend/docs/DIALER_API_ENDPOINTS.md"
echo ""
echo "================================================================================"
