-- ==================================================================================
-- ROI and Efficiency Analysis by Process Type
-- ==================================================================================
-- Purpose: Comprehensive process-level efficiency matrix combining operational,
--          financial, and quality metrics to calculate ROI and efficiency rankings
--
-- Data Sources:
--   - integration_call_daily: Call volume and talk time by process/employee/date
--   - salary_prep_line + salary_prep_run: Payroll costs mapped to employees
--   - kpi_daily_actual: Quality, conversion, adherence and other KPI scores
--   - employees + process_master: Team and process hierarchy
--
-- Rolling Window: 90 days (CURDATE() - INTERVAL 90 DAY)
-- Execution Context: MySQL 8.0+, mas_hrms database
-- ==================================================================================

USE mas_hrms;

-- ==================================================================================
-- QUERY 1: Process Efficiency Matrix (Primary Analysis)
-- ==================================================================================
-- Shows complete efficiency profile for each active process including:
--   PROCESS: Process name
--   LOB: Line of business
--   ACTIVE_AGENTS: Count of employees assigned to process
--   CALL_VOLUME: Total calls handled in 90 days
--   AVG_TALK_TIME_SEC: Average talk time per call (seconds)
--   AVG_COST_PER_AGENT_MONTHLY: Average monthly cost per agent
--   COST_PER_CALL: Direct cost attribution per call
--   QUALITY_SCORE_PCT: Average quality audit score (0-100)
--   CONVERSION_RATE_PCT: Sales/offer conversion rate
--   ADHERENCE_PCT: Schedule adherence percentage
--   CALLS_PER_DAY: Average daily call volume
--   ROI_INDEX: Composite efficiency index (lower cost + higher quality = higher ROI)
-- ==================================================================================

SELECT
  pm.process_name AS 'PROCESS',
  pm.business_lob AS 'LOB',
  COUNT(DISTINCT e.id) AS 'ACTIVE_AGENTS',
  COALESCE(SUM(icd.total_calls), 0) AS 'CALL_VOLUME',
  ROUND(
    AVG(
      CASE WHEN icd.total_calls > 0
        THEN (icd.talk_minutes * 60 / icd.total_calls)
        ELSE NULL
      END
    ),
    0
  ) AS 'AVG_TALK_TIME_SEC',
  ROUND(
    COALESCE(SUM(spl.gross_salary), 0) /
    NULLIF(COUNT(DISTINCT e.id), 0) / 3,
    2
  ) AS 'AVG_COST_PER_AGENT_MONTHLY',
  ROUND(
    COALESCE(SUM(spl.gross_salary), 0) /
    NULLIF(SUM(icd.total_calls), 0),
    2
  ) AS 'COST_PER_CALL',
  ROUND(
    COALESCE(AVG(kda_quality.actual_value), 0),
    2
  ) AS 'QUALITY_SCORE_PCT',
  ROUND(
    COALESCE(AVG(kda_conversion.actual_value), 0),
    2
  ) AS 'CONVERSION_RATE_PCT',
  ROUND(
    COALESCE(AVG(kda_adherence.actual_value), 0),
    2
  ) AS 'ADHERENCE_PCT',
  ROUND(
    SUM(icd.total_calls) /
    NULLIF(DATEDIFF(MAX(icd.activity_date), MIN(icd.activity_date)) + 1, 0),
    0
  ) AS 'CALLS_PER_DAY',
  ROUND(
    (COALESCE(AVG(kda_quality.actual_value), 50) / 100) *
    NULLIF(
      (SUM(icd.total_calls) / 100) /
      NULLIF(SUM(spl.gross_salary) / 10000, 0),
      0
    ),
    2
  ) AS 'ROI_INDEX'
FROM
  process_master pm
  LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
  LEFT JOIN integration_call_daily icd
    ON icd.process_name = pm.process_name
    AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  LEFT JOIN salary_prep_line spl
    ON spl.employee_id = e.id
  LEFT JOIN salary_prep_run spr
    ON spr.id = spl.run_id
    AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
  LEFT JOIN kpi_daily_actual kda_quality
    ON kda_quality.employee_id = e.id
    AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    AND kda_quality.metric_id = (
      SELECT id FROM kpi_metric_master
      WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
      LIMIT 1
    )
  LEFT JOIN kpi_daily_actual kda_conversion
    ON kda_conversion.employee_id = e.id
    AND kda_conversion.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    AND kda_conversion.metric_id = (
      SELECT id FROM kpi_metric_master
      WHERE metric_code = 'CONVERSION_RATE' AND active_status = 1
      LIMIT 1
    )
  LEFT JOIN kpi_daily_actual kda_adherence
    ON kda_adherence.employee_id = e.id
    AND kda_adherence.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    AND kda_adherence.metric_id = (
      SELECT id FROM kpi_metric_master
      WHERE metric_code = 'ADHERENCE' AND active_status = 1
      LIMIT 1
    )
WHERE
  pm.active_status = 1
GROUP BY
  pm.id, pm.process_name, pm.business_lob
ORDER BY
  ROI_INDEX DESC NULLS LAST,
  CALL_VOLUME DESC
;

-- ==================================================================================
-- QUERY 2: Process Efficiency Breakdown by LOB (Aggregate View)
-- ==================================================================================
-- Summarizes efficiency metrics at LOB level to identify business unit performance
-- Columns:
--   LOB: Line of business
--   PROCESS_COUNT: Number of processes under this LOB
--   TOTAL_AGENTS: Total active agents
--   TOTAL_CALLS_90D: Aggregate call volume
--   PAYROLL_COST_K: Total payroll in thousands
--   AVG_COST_PER_CALL: Weighted cost per call
--   AVG_TALK_TIME_SEC: Weighted average talk time
--   AVG_QUALITY_SCORE: Aggregate quality score
--   CALLS_PER_AGENT_PER_DAY: Productivity metric
--   EFFICIENCY_TIER: HIGH/MEDIUM/LOW based on cost per call
-- ==================================================================================

SELECT
  COALESCE(pm.business_lob, 'UNASSIGNED') AS 'LOB',
  COUNT(DISTINCT pm.id) AS 'PROCESS_COUNT',
  COUNT(DISTINCT e.id) AS 'TOTAL_AGENTS',
  COALESCE(SUM(icd.total_calls), 0) AS 'TOTAL_CALLS_90D',
  ROUND(COALESCE(SUM(spl.gross_salary) / 1000, 0), 0) AS 'PAYROLL_COST_K',
  ROUND(
    COALESCE(SUM(spl.gross_salary), 0) /
    NULLIF(SUM(icd.total_calls), 0),
    2
  ) AS 'AVG_COST_PER_CALL',
  ROUND(
    AVG(
      CASE WHEN icd.total_calls > 0
        THEN (icd.talk_minutes * 60 / icd.total_calls)
        ELSE NULL
      END
    ),
    0
  ) AS 'AVG_TALK_TIME_SEC',
  ROUND(
    COALESCE(AVG(kda_quality.actual_value), 0),
    2
  ) AS 'AVG_QUALITY_SCORE',
  ROUND(
    (SUM(icd.total_calls) / NULLIF(COUNT(DISTINCT e.id), 0)) / 90,
    1
  ) AS 'CALLS_PER_AGENT_PER_DAY',
  CASE
    WHEN (SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0)) < 10 THEN 'HIGH'
    WHEN (SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0)) < 20 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS 'EFFICIENCY_TIER'
FROM
  process_master pm
  LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
  LEFT JOIN integration_call_daily icd
    ON icd.process_name = pm.process_name
    AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  LEFT JOIN salary_prep_line spl
    ON spl.employee_id = e.id
  LEFT JOIN salary_prep_run spr
    ON spr.id = spl.run_id
    AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
  LEFT JOIN kpi_daily_actual kda_quality
    ON kda_quality.employee_id = e.id
    AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    AND kda_quality.metric_id = (
      SELECT id FROM kpi_metric_master
      WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
      LIMIT 1
    )
WHERE
  pm.active_status = 1
GROUP BY
  pm.business_lob
ORDER BY
  AVG_COST_PER_CALL ASC,
  TOTAL_CALLS_90D DESC
;

-- ==================================================================================
-- QUERY 3: ROI Calculation by Process (Weighted Composite Score)
-- ==================================================================================
-- Detailed ROI analysis combining quality, productivity, and cost metrics.
-- Metrics:
--   PROCESS: Process identifier
--   CALL_VOLUME: 90-day call count
--   QUALITY_SCORE_PCT: Average quality percentage (0-100)
--   TOTAL_PAYROLL_90D: Total cost for period
--   COST_PER_CALL: Direct unit economics
--   PRODUCTIVITY_INDEX: Calls per 1K payroll (higher = better)
--   ROI_EFFICIENCY_SCORE: Composite weighted score combining quality × productivity
-- ==================================================================================

SELECT
  pm.process_name AS 'PROCESS',
  pm.business_lob AS 'LOB',
  COALESCE(SUM(icd.total_calls), 0) AS 'CALL_VOLUME',
  ROUND(
    COALESCE(AVG(kda_quality.actual_value), 75),
    1
  ) AS 'QUALITY_SCORE_PCT',
  ROUND(
    COALESCE(SUM(spl.gross_salary), 0),
    2
  ) AS 'TOTAL_PAYROLL_90D',
  ROUND(
    COALESCE(SUM(spl.gross_salary), 0) /
    NULLIF(SUM(icd.total_calls), 0),
    4
  ) AS 'COST_PER_CALL',
  ROUND(
    (SUM(icd.total_calls) * 100) /
    NULLIF(SUM(spl.gross_salary) / 1000, 0),
    2
  ) AS 'PRODUCTIVITY_INDEX',
  ROUND(
    (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
    NULLIF(
      (SUM(icd.total_calls) * 100) /
      NULLIF(SUM(spl.gross_salary) / 1000, 0),
      0
    ),
    2
  ) AS 'ROI_EFFICIENCY_SCORE',
  RANK() OVER (ORDER BY
    (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
    ((SUM(icd.total_calls) * 100) / NULLIF(SUM(spl.gross_salary) / 1000, 0))
    DESC NULLS LAST
  ) AS 'EFFICIENCY_RANK'
FROM
  process_master pm
  LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
  LEFT JOIN integration_call_daily icd
    ON icd.process_name = pm.process_name
    AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  LEFT JOIN salary_prep_line spl
    ON spl.employee_id = e.id
  LEFT JOIN salary_prep_run spr
    ON spr.id = spl.run_id
    AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
  LEFT JOIN kpi_daily_actual kda_quality
    ON kda_quality.employee_id = e.id
    AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    AND kda_quality.metric_id = (
      SELECT id FROM kpi_metric_master
      WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
      LIMIT 1
    )
WHERE
  pm.active_status = 1
GROUP BY
  pm.id, pm.process_name, pm.business_lob
HAVING
  SUM(icd.total_calls) > 0 OR SUM(spl.gross_salary) > 0
ORDER BY
  ROI_EFFICIENCY_SCORE DESC NULLS LAST,
  CALL_VOLUME DESC
;

-- ==================================================================================
-- QUERY 4: Top Performers and Improvement Targets
-- ==================================================================================
-- Identifies top 5 most efficient processes and bottom 5 for intervention
-- ==================================================================================

-- TOP 5 MOST EFFICIENT PROCESSES
SELECT
  'TOP_PERFORMER' AS 'CATEGORY',
  pm.process_name AS 'PROCESS',
  COUNT(DISTINCT e.id) AS 'AGENTS',
  ROUND(
    (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
    NULLIF(
      (SUM(icd.total_calls) * 100) /
      NULLIF(SUM(spl.gross_salary) / 1000, 0),
      0
    ),
    2
  ) AS 'ROI_SCORE',
  ROUND(
    SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0),
    2
  ) AS 'COST_PER_CALL',
  ROUND(COALESCE(AVG(kda_quality.actual_value), 75), 1) AS 'QUALITY_PCT',
  'Maintain excellence, document best practices' AS 'ACTION'
FROM
  process_master pm
  LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
  LEFT JOIN integration_call_daily icd
    ON icd.process_name = pm.process_name
    AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  LEFT JOIN salary_prep_line spl
    ON spl.employee_id = e.id
  LEFT JOIN salary_prep_run spr
    ON spr.id = spl.run_id
    AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
  LEFT JOIN kpi_daily_actual kda_quality
    ON kda_quality.employee_id = e.id
    AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    AND kda_quality.metric_id = (
      SELECT id FROM kpi_metric_master
      WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
      LIMIT 1
    )
WHERE
  pm.active_status = 1
GROUP BY
  pm.id, pm.process_name
HAVING
  SUM(icd.total_calls) > 0
ORDER BY
  ROI_SCORE DESC
LIMIT 5

UNION ALL

-- BOTTOM 5 PROCESSES NEEDING IMPROVEMENT
SELECT
  'IMPROVEMENT_TARGET' AS 'CATEGORY',
  pm.process_name AS 'PROCESS',
  COUNT(DISTINCT e.id) AS 'AGENTS',
  ROUND(
    (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
    NULLIF(
      (SUM(icd.total_calls) * 100) /
      NULLIF(SUM(spl.gross_salary) / 1000, 0),
      0
    ),
    2
  ) AS 'ROI_SCORE',
  ROUND(
    SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0),
    2
  ) AS 'COST_PER_CALL',
  ROUND(COALESCE(AVG(kda_quality.actual_value), 75), 1) AS 'QUALITY_PCT',
  'Intervention: quality training or process re-design' AS 'ACTION'
FROM
  process_master pm
  LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
  LEFT JOIN integration_call_daily icd
    ON icd.process_name = pm.process_name
    AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  LEFT JOIN salary_prep_line spl
    ON spl.employee_id = e.id
  LEFT JOIN salary_prep_run spr
    ON spr.id = spl.run_id
    AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
  LEFT JOIN kpi_daily_actual kda_quality
    ON kda_quality.employee_id = e.id
    AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    AND kda_quality.metric_id = (
      SELECT id FROM kpi_metric_master
      WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
      LIMIT 1
    )
WHERE
  pm.active_status = 1
GROUP BY
  pm.id, pm.process_name
HAVING
  SUM(icd.total_calls) > 0
ORDER BY
  ROI_SCORE ASC
LIMIT 5
;
