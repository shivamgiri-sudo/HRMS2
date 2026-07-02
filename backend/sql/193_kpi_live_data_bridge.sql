-- Connect Integration Hub and attendance facts to the live KPI dashboards.
USE mas_hrms;

INSERT INTO kpi_process_config
  (id, process_id, metric_id, target_value, min_threshold, max_achievement, weightage, effective_from)
SELECT
  UUID(),
  pm.id,
  kmm.id,
  CASE kmm.metric_code
    WHEN 'TALK_TIME' THEN 240
    WHEN 'DIALS' THEN 80
    WHEN 'ATTENDANCE_PCT' THEN 95
  END,
  CASE kmm.metric_code
    WHEN 'TALK_TIME' THEN 360
    WHEN 'DIALS' THEN 60
    WHEN 'ATTENDANCE_PCT' THEN 85
  END,
  120,
  CASE kmm.metric_code
    WHEN 'TALK_TIME' THEN 30
    WHEN 'DIALS' THEN 30
    WHEN 'ATTENDANCE_PCT' THEN 40
  END,
  CURDATE()
FROM process_master pm
CROSS JOIN kpi_metric_master kmm
WHERE pm.active_status = 1
  AND kmm.active_status = 1
  AND kmm.metric_code IN ('TALK_TIME', 'DIALS', 'ATTENDANCE_PCT')
ON DUPLICATE KEY UPDATE
  target_value = kpi_process_config.target_value,
  min_threshold = kpi_process_config.min_threshold,
  weightage = kpi_process_config.weightage;

INSERT INTO kpi_master_config
  (id, metric_id, org_unit_type, org_unit_id, target_value, min_threshold,
   max_achievement, weightage, is_active)
SELECT
  UUID(),
  kpc.metric_id,
  'process',
  kpc.process_id,
  kpc.target_value,
  kpc.min_threshold,
  kpc.max_achievement,
  kpc.weightage,
  1
FROM kpi_process_config kpc
JOIN kpi_metric_master kmm ON kmm.id = kpc.metric_id
WHERE kmm.metric_code IN ('TALK_TIME', 'DIALS', 'ATTENDANCE_PCT')
ON DUPLICATE KEY UPDATE
  target_value = kpi_master_config.target_value,
  min_threshold = kpi_master_config.min_threshold,
  weightage = kpi_master_config.weightage,
  is_active = 1;

INSERT INTO kpi_daily_actual
  (id, employee_id, metric_id, score_date, actual_value, source)
SELECT
  UUID(),
  e.id,
  kmm.id,
  icd.activity_date,
  CASE kmm.metric_code
    WHEN 'DIALS' THEN SUM(icd.total_calls)
    WHEN 'TALK_TIME' THEN
      CASE
        WHEN SUM(icd.total_calls) > 0
        THEN ROUND(SUM(icd.talk_minutes) * 60 / SUM(icd.total_calls), 1)
        ELSE 0
      END
  END,
  'apr'
FROM integration_call_daily icd
JOIN employees e
  ON UPPER(TRIM(e.employee_code)) = UPPER(TRIM(icd.employee_code))
 AND e.active_status = 1
JOIN kpi_metric_master kmm
  ON kmm.metric_code IN ('TALK_TIME', 'DIALS')
WHERE icd.employee_code IS NOT NULL
GROUP BY e.id, kmm.id, kmm.metric_code, icd.activity_date
ON DUPLICATE KEY UPDATE
  actual_value = VALUES(actual_value),
  source = VALUES(source);

INSERT INTO kpi_daily_actual
  (id, employee_id, metric_id, score_date, actual_value, source)
SELECT
  UUID(),
  adr.employee_id,
  kmm.id,
  adr.record_date,
  CASE
    WHEN UPPER(adr.attendance_status) IN ('P', 'PRESENT') THEN 100
    WHEN UPPER(adr.attendance_status) IN ('H', 'HALF_DAY') THEN 50
    ELSE 0
  END,
  'attendance'
FROM attendance_daily_record adr
JOIN kpi_metric_master kmm ON kmm.metric_code = 'ATTENDANCE_PCT'
ON DUPLICATE KEY UPDATE
  actual_value = VALUES(actual_value),
  source = VALUES(source);
