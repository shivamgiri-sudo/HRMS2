-- Setup Dialer KPI Metrics
-- Run this once to configure call center metrics in HRMS

-- ============================================================================
-- PART 1: Create KPI Metrics for Call Center Operations
-- ============================================================================

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

-- Verify metrics created
SELECT
  metric_code,
  metric_name,
  family,
  unit,
  direction
FROM kpi_metric
WHERE metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
ORDER BY metric_code;

-- ============================================================================
-- PART 2: Set Default Process Targets
-- ============================================================================

-- Get all active processes
SELECT
  id as process_id,
  process_name,
  process_code
FROM process_master
WHERE active_status = 1;

-- For each process, insert default targets
-- (Replace 'PROCESS_ID_HERE' with actual process IDs from query above)

/*
Example configuration for a process:

INSERT INTO kpi_process_config (id, process_id, metric_id, target_value, min_threshold, weightage, active_status, created_at)
SELECT
  UUID(),
  'YOUR_PROCESS_ID',
  km.id,
  CASE km.metric_code
    WHEN 'AHT' THEN 300          -- 5 minutes
    WHEN 'ACW' THEN 60           -- 1 minute
    WHEN 'TALK_TIME' THEN 240    -- 4 minutes
    WHEN 'HOLD_TIME' THEN 30     -- 30 seconds
    WHEN 'CALLS_HANDLED' THEN 80 -- 80 calls per day
  END as target_value,
  CASE km.metric_code
    WHEN 'AHT' THEN 360          -- Max 6 minutes
    WHEN 'ACW' THEN 90           -- Max 1.5 minutes
    WHEN 'TALK_TIME' THEN 180    -- Min 3 minutes
    WHEN 'HOLD_TIME' THEN 60     -- Max 1 minute
    WHEN 'CALLS_HANDLED' THEN 60 -- Min 60 calls
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
  min_threshold = VALUES(min_threshold),
  weightage = VALUES(weightage);
*/

-- ============================================================================
-- PART 3: Verify Configuration
-- ============================================================================

-- Check metrics
SELECT COUNT(*) as dialer_metrics_count
FROM kpi_metric
WHERE metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED');

-- Check process configs (if any created)
SELECT
  pm.process_name,
  km.metric_code,
  kpc.target_value,
  kpc.weightage
FROM kpi_process_config kpc
JOIN process_master pm ON pm.id = kpc.process_id
JOIN kpi_metric km ON km.id = kpc.metric_id
WHERE km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
ORDER BY pm.process_name, km.metric_code;

-- ============================================================================
-- USAGE NOTES
-- ============================================================================

/*
After running this setup:

1. Update process targets:
   - Modify target_value based on actual SLAs for each process
   - Adjust weightage based on metric importance

2. Test sync:
   POST /api/dialer/kpi/sync/employee
   Body: { "employeeCode": "MAS62686", "date": "2026-06-06" }

3. View leaderboard:
   GET /api/dialer/kpi/leaderboard/:processId/2026-06-06

4. Setup automated daily sync:
   - Create cron job to run at 2 AM daily
   - Syncs previous day's data for all processes
*/
