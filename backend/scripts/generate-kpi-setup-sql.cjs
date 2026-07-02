/**
 * Generate SQL statements for KPI setup
 * Outputs SQL that can be run manually on database
 */

console.log('='.repeat(80));
console.log('DIALER KPI METRICS - SQL SETUP STATEMENTS');
console.log('='.repeat(80));
console.log('');
console.log('Copy and run these SQL statements on your mas_hrms database:');
console.log('');
console.log('='.repeat(80));
console.log('-- STEP 1: Create KPI Metrics');
console.log('='.repeat(80));
console.log('');

const metrics = [
  {
    code: 'AHT',
    name: 'Average Handle Time',
    description: 'Average time spent handling calls including talk time, hold time, and after-call work',
    direction: 'lower_is_better',
  },
  {
    code: 'ACW',
    name: 'After Call Work',
    description: 'Average time spent on post-call documentation and follow-up tasks',
    direction: 'lower_is_better',
  },
  {
    code: 'TALK_TIME',
    name: 'Talk Time',
    description: 'Average time spent actively talking with customers',
    direction: 'higher_is_better',
  },
  {
    code: 'HOLD_TIME',
    name: 'Hold Time',
    description: 'Average time customers spend on hold during calls',
    direction: 'lower_is_better',
  },
  {
    code: 'CALLS_HANDLED',
    name: 'Calls Handled',
    description: 'Total number of calls handled by agent',
    direction: 'higher_is_better',
  },
];

metrics.forEach(m => {
  const unit = m.code === 'CALLS_HANDLED' ? 'count' : 'seconds';
  console.log(`INSERT INTO kpi_metric (id, metric_code, metric_name, family, unit, direction, description, active_status, created_at)
VALUES (UUID(), '${m.code}', '${m.name}', 'operations', '${unit}', '${m.direction}', '${m.description}', 1, NOW())
ON DUPLICATE KEY UPDATE description = VALUES(description), active_status = 1;
`);
});

console.log('');
console.log('='.repeat(80));
console.log('-- STEP 2: Verify Metrics Created');
console.log('='.repeat(80));
console.log('');
console.log(`SELECT metric_code, metric_name, family, unit, direction
FROM kpi_metric
WHERE metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
ORDER BY metric_code;
`);

console.log('');
console.log('='.repeat(80));
console.log('-- STEP 3: Get Your Process IDs');
console.log('='.repeat(80));
console.log('');
console.log(`SELECT id, process_name, process_code
FROM process_master
WHERE active_status = 1;
`);

console.log('');
console.log('='.repeat(80));
console.log('-- STEP 4: Configure Process Targets (REPLACE YOUR_PROCESS_ID)');
console.log('='.repeat(80));
console.log('');
console.log(`-- Example: Set targets for a specific process
-- Replace 'YOUR_PROCESS_ID' with actual process ID from step 3

INSERT INTO kpi_process_config (id, process_id, metric_id, target_value, min_threshold, weightage, active_status, created_at)
SELECT
  UUID(),
  'YOUR_PROCESS_ID',  -- REPLACE THIS
  km.id,
  CASE km.metric_code
    WHEN 'AHT' THEN 300          -- 5 minutes target
    WHEN 'ACW' THEN 60           -- 1 minute target
    WHEN 'TALK_TIME' THEN 240    -- 4 minutes target
    WHEN 'HOLD_TIME' THEN 30     -- 30 seconds target
    WHEN 'CALLS_HANDLED' THEN 80 -- 80 calls per day target
  END as target_value,
  CASE km.metric_code
    WHEN 'AHT' THEN 360          -- Max acceptable: 6 minutes
    WHEN 'ACW' THEN 90           -- Max acceptable: 1.5 minutes
    WHEN 'TALK_TIME' THEN 180    -- Min acceptable: 3 minutes
    WHEN 'HOLD_TIME' THEN 60     -- Max acceptable: 1 minute
    WHEN 'CALLS_HANDLED' THEN 60 -- Min acceptable: 60 calls
  END as min_threshold,
  CASE km.metric_code
    WHEN 'AHT' THEN 30           -- 30% weight
    WHEN 'ACW' THEN 20           -- 20% weight
    WHEN 'TALK_TIME' THEN 20     -- 20% weight
    WHEN 'HOLD_TIME' THEN 15     -- 15% weight
    WHEN 'CALLS_HANDLED' THEN 15 -- 15% weight
  END as weightage,
  1,
  NOW()
FROM kpi_metric km
WHERE km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
ON DUPLICATE KEY UPDATE
  target_value = VALUES(target_value),
  min_threshold = VALUES(min_threshold),
  weightage = VALUES(weightage);
`);

console.log('');
console.log('='.repeat(80));
console.log('-- STEP 5: Verify Process Configuration');
console.log('='.repeat(80));
console.log('');
console.log(`SELECT
  pm.process_name,
  km.metric_code,
  kpc.target_value,
  kpc.min_threshold,
  kpc.weightage
FROM kpi_process_config kpc
JOIN process_master pm ON pm.id = kpc.process_id
JOIN kpi_metric km ON km.id = kpc.metric_id
WHERE km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
ORDER BY pm.process_name, km.metric_code;
`);

console.log('');
console.log('='.repeat(80));
console.log('✅ SETUP COMPLETE');
console.log('='.repeat(80));
console.log('');
console.log('After running these SQL statements:');
console.log('');
console.log('1. Test Employee Metrics:');
console.log('   GET /api/dialer/kpi/employee/:employeeCode/2026-06-06');
console.log('');
console.log('2. Test Process Leaderboard:');
console.log('   GET /api/dialer/kpi/leaderboard/:processId/2026-06-06');
console.log('');
console.log('3. Sync Data to KPI Scores:');
console.log('   POST /api/dialer/kpi/sync/process');
console.log('   Body: { "processId": "...", "date": "2026-06-06" }');
console.log('');
console.log('4. View in Frontend:');
console.log('   Navigate to Operations KPI page (/operations-kpi)');
console.log('   Select process and date range');
console.log('');
console.log('='.repeat(80));
