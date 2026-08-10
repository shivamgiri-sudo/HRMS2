-- Reconcile known dialer campaign names to HRMS process masters and provide
-- department-level KPI defaults for employees who do not have a process yet.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS integration_process_alias (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  source_value  VARCHAR(255) NOT NULL,
  process_id    CHAR(36)     NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_integration_process_alias (source_value),
  FOREIGN KEY (process_id) REFERENCES process_master(id)
);

INSERT INTO integration_process_alias (id, source_value, process_id)
SELECT DISTINCT
  UUID(),
  UPPER(TRIM(icd.process_name)),
  pm.id
FROM integration_call_daily icd
JOIN process_master pm
  ON pm.active_status = 1
 AND (
   (UPPER(TRIM(icd.process_name)) LIKE 'NEEM%' AND pm.process_code = 'NEEMANS')
   OR (UPPER(TRIM(icd.process_name)) LIKE 'DALMIA%' AND pm.process_code = 'DALMIA_CEMENT')
   OR (UPPER(TRIM(icd.process_name)) LIKE 'BELLA%' AND pm.process_code = 'BELLA_VITA')
   OR (UPPER(TRIM(icd.process_name)) LIKE 'VST%' AND pm.process_code = 'VST')
   OR (UPPER(TRIM(icd.process_name)) = 'VIEGA' AND pm.process_code = 'VIEGA')
 )
WHERE TRIM(COALESCE(icd.process_name, '')) <> ''
ON DUPLICATE KEY UPDATE
  process_id = VALUES(process_id),
  active_status = 1;

UPDATE employees e
JOIN (
  SELECT
    icd.employee_code,
    MIN(ipa.process_id) AS process_id
  FROM integration_call_daily icd
  JOIN integration_process_alias ipa
    ON ipa.source_value = UPPER(TRIM(icd.process_name))
   AND ipa.active_status = 1
  GROUP BY icd.employee_code
  HAVING COUNT(DISTINCT ipa.process_id) = 1
) mapped
  ON UPPER(TRIM(mapped.employee_code)) = UPPER(TRIM(e.employee_code))
SET e.process_id = mapped.process_id
WHERE e.active_status = 1
  AND e.process_id IS NULL;

INSERT INTO kpi_master_config
  (id, metric_id, org_unit_type, org_unit_id, target_value, min_threshold,
   max_achievement, weightage, is_active)
SELECT
  UUID(),
  kmm.id,
  'department',
  dm.id,
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
  1
FROM department_master dm
CROSS JOIN kpi_metric_master kmm
WHERE dm.active_status = 1
  AND kmm.active_status = 1
  AND kmm.metric_code IN ('TALK_TIME', 'DIALS', 'ATTENDANCE_PCT')
ON DUPLICATE KEY UPDATE
  is_active = 1;
