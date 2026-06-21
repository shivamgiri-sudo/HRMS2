/**
 * Quality Correlation Analysis Queries
 * Shivamgiri APR + mas_hrms Employees
 * Run against: 122.184.128.90:3306
 * Databases: mas_hrms, db_audit (Shivamgiri), dialer_db
 * Timeframe: Last 90 days (configurable)
 *
 * Execution:
 *   mysql -h 122.184.128.90 -u root -p mas_hrms < quality-correlation-queries.sql
 */

-- =====================================================================
-- QUERY SET 1: AGENT TENURE vs QUALITY PERFORMANCE
-- =====================================================================
-- Objective: Correlate employee tenure (months since join) with call quality
-- Finding: Expected positive correlation (longer tenure = higher quality)
-- Impact: Informs onboarding investments, ramp-up timelines, retention strategy

SELECT
  'TENURE_ANALYSIS' as query_type,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 0) as tenure_months,
  COUNT(DISTINCT e.id) as agent_count,
  COUNT(DISTINCT cqa.id) as audited_calls,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_score,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_volatility,
  ROUND(MIN(cqa.quality_percentage), 1) as worst_score,
  ROUND(MAX(cqa.quality_percentage), 1) as best_score,
  COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) as poor_calls_count,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_rate_pct,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
JOIN mas_hrms.employees e ON cqa.User = e.employee_code
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND e.employment_status = 'Active'
  AND e.active_status = 1
  AND cqa.quality_percentage IS NOT NULL
GROUP BY ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 0)
ORDER BY tenure_months ASC;


-- =====================================================================
-- QUERY SET 2: TEAM SIZE vs INDIVIDUAL QUALITY
-- =====================================================================
-- Objective: Correlate team size (reporting manager's span of control) with individual quality
-- Finding: Expected negative correlation (larger team = lower avg quality)
-- Impact: Informs org structure, manager span of control optimization

SELECT
  'TEAM_SIZE_ANALYSIS' as query_type,
  COUNT(DISTINCT e2.id) as team_size,
  COUNT(DISTINCT e.id) as agent_count_in_bracket,
  COUNT(DISTINCT cqa.id) as total_audited_calls,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance,
  ROUND(MAX(cqa.quality_percentage) - MIN(cqa.quality_percentage), 1) as range,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) * 100.0 / COUNT(*), 1) as failure_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
JOIN mas_hrms.employees e ON cqa.User = e.employee_code
JOIN mas_hrms.employees rm ON rm.id = e.reporting_manager_id
LEFT JOIN mas_hrms.employees e2 ON e2.reporting_manager_id = rm.id
  AND e2.employment_status = 'Active'
  AND e2.active_status = 1
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND e.employment_status = 'Active'
  AND e.active_status = 1
  AND rm.active_status = 1
  AND cqa.quality_percentage IS NOT NULL
GROUP BY rm.id
HAVING team_size > 0
ORDER BY team_size ASC;


-- =====================================================================
-- QUERY SET 3: SHIFT TIMING & HOUR-OF-DAY QUALITY PATTERNS
-- =====================================================================
-- Objective: Identify quality variations by hour of day and shift phase
-- Finding: Expected pattern (morning peak > lunch valley > afternoon recovery > evening decline)
-- Impact: Informs call routing, shift scheduling, resource allocation

SELECT
  'HOUR_OF_DAY_ANALYSIS' as query_type,
  HOUR(cqa.CallDate) as hour_of_day,
  COUNT(*) as call_volume,
  COUNT(DISTINCT cqa.User) as agent_count,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_score,
  ROUND(MIN(cqa.quality_percentage), 1) as lowest_quality,
  ROUND(MAX(cqa.quality_percentage), 1) as highest_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_volatility,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) * 100.0 / COUNT(*), 1) as critical_rate_pct,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 9 AND 11 THEN 'Morning Peak'
    WHEN HOUR(cqa.CallDate) BETWEEN 12 AND 14 THEN 'Lunch Valley'
    WHEN HOUR(cqa.CallDate) BETWEEN 15 AND 17 THEN 'Afternoon Peak'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 20 THEN 'Evening'
    ELSE 'Off-Peak'
  END as shift_phase,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY HOUR(cqa.CallDate)
ORDER BY hour_of_day ASC;


-- =====================================================================
-- QUERY SET 4: HOUR-OF-WEEK QUALITY HEATMAP
-- =====================================================================
-- Objective: 2D analysis of hour x day-of-week quality patterns
-- Finding: Identify consistent low-performers (e.g., Friday afternoons) vs variable patterns

SELECT
  'HOUR_WEEK_HEATMAP' as query_type,
  DAYNAME(cqa.CallDate) as day_of_week,
  HOUR(cqa.CallDate) as hour_of_day,
  COUNT(*) as call_volume,
  ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 0) as excellence_pct
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY DAYNAME(cqa.CallDate), HOUR(cqa.CallDate)
ORDER BY
  FIELD(DAYNAME(cqa.CallDate), 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
  HOUR(cqa.CallDate) ASC;


-- =====================================================================
-- QUERY SET 5: COMPOUND RISK PROFILE ANALYSIS
-- =====================================================================
-- Objective: Multi-factor risk assessment (tenure + team size + quality volatility)
-- Finding: Agents with multiple risk factors (e.g., new + large team + volatile) need priority intervention

WITH risk_profile AS (
  SELECT
    e.id,
    e.employee_code,
    CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
    DATEDIFF(NOW(), e.date_of_joining) as tenure_days,
    (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e2
     WHERE e2.reporting_manager_id = e.reporting_manager_id
     AND e2.active_status = 1) as team_size,
    ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
    COUNT(cqa.id) as audit_count,
    ROUND(STDDEV(cqa.quality_percentage), 1) as volatility
  FROM mas_hrms.employees e
  LEFT JOIN db_audit.call_quality_assessment cqa
    ON cqa.User = e.employee_code
    AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  WHERE e.employment_status = 'Active'
    AND e.active_status = 1
  GROUP BY e.id
)
SELECT
  'COMPOUND_RISK' as query_type,
  agent_name,
  employee_code,
  tenure_days,
  ROUND(tenure_days / 30.0, 1) as tenure_months,
  team_size,
  ROUND(avg_quality, 1) as quality_score,
  audit_count,
  ROUND(volatility, 1) as stability,
  CASE
    WHEN tenure_days < 90 THEN 'Onboarding'
    WHEN tenure_days < 180 THEN 'Ramp'
    ELSE 'Stabilized'
  END as experience_level,
  CASE
    WHEN team_size <= 5 THEN 'Lean'
    WHEN team_size <= 10 THEN 'Optimal'
    ELSE 'Stretched'
  END as team_load,
  CASE
    WHEN avg_quality >= 85 THEN 'A'
    WHEN avg_quality >= 75 THEN 'B'
    WHEN avg_quality >= 65 THEN 'C'
    ELSE 'D'
  END as rating,
  CASE
    WHEN avg_quality < 65 AND tenure_days < 90 AND team_size > 15 THEN 'CRITICAL'
    WHEN avg_quality < 70 AND volatility > 15 THEN 'HIGH'
    WHEN avg_quality < 75 AND tenure_days < 180 THEN 'MEDIUM'
    ELSE 'LOW'
  END as risk_level,
  CASE
    WHEN avg_quality < 65 AND tenure_days < 90 AND team_size > 15 THEN 'Immediate coaching + reduce team load'
    WHEN avg_quality < 70 AND volatility > 15 THEN 'Monitor closely, stability concern'
    WHEN avg_quality < 75 AND tenure_days < 180 THEN 'Accelerated ramp program'
    ELSE 'Routine monitoring'
  END as recommended_action,
  NOW() as run_timestamp
FROM risk_profile
WHERE audit_count >= 10
ORDER BY CASE
  WHEN avg_quality < 65 THEN 1
  WHEN avg_quality < 70 THEN 2
  WHEN avg_quality < 75 THEN 3
  ELSE 4
END,
avg_quality ASC
LIMIT 50;


-- =====================================================================
-- QUERY SET 6: QUALITY DATA VALIDATION & COMPLETENESS
-- =====================================================================
-- Objective: Data quality checks before relying on correlations
-- Finding: Identifies gaps, outliers, unmatched records

SELECT
  'DATA_VALIDATION' as check_type,
  'Overall Quality Assessment Data' as metric,
  COUNT(*) as total_records,
  COUNT(DISTINCT User) as unique_agents,
  COUNT(DISTINCT DATE(CallDate)) as days_with_data,
  MIN(CallDate) as earliest_call,
  MAX(CallDate) as latest_call,
  ROUND(AVG(quality_percentage), 2) as avg_quality_overall,
  COUNT(CASE WHEN quality_percentage IS NULL THEN 1 END) as null_quality_records,
  COUNT(CASE WHEN User IS NULL OR User = '' THEN 1 END) as unmatched_agent_records,
  ROUND(COUNT(CASE WHEN User IS NULL OR User = '' THEN 1 END) * 100.0 / COUNT(*), 2) as orphaned_rate_pct,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment
WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)

UNION ALL

SELECT
  'DATA_VALIDATION' as check_type,
  'Matched Employee Records' as metric,
  (SELECT COUNT(DISTINCT e.id) FROM mas_hrms.employees e
   JOIN db_audit.call_quality_assessment cqa ON cqa.User = e.employee_code
   WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)) as total_records,
  (SELECT COUNT(DISTINCT e.employee_code) FROM mas_hrms.employees e
   JOIN db_audit.call_quality_assessment cqa ON cqa.User = e.employee_code
   WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)) as unique_agents,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  0.0,
  NOW()
FROM DUAL

UNION ALL

SELECT
  'DATA_VALIDATION' as check_type,
  'Employee Master Data' as metric,
  COUNT(*) as total_records,
  COUNT(DISTINCT employee_code) as unique_agents,
  COUNT(DISTINCT DATE(date_of_joining)) as days_with_data,
  MIN(date_of_joining) as earliest_call,
  MAX(date_of_joining) as latest_call,
  NULL,
  COUNT(CASE WHEN date_of_joining IS NULL THEN 1 END),
  COUNT(CASE WHEN reporting_manager_id IS NULL THEN 1 END),
  ROUND(COUNT(CASE WHEN reporting_manager_id IS NULL THEN 1 END) * 100.0 / COUNT(*), 2) as orphaned_rate_pct,
  NOW()
FROM mas_hrms.employees
WHERE active_status = 1 AND employment_status = 'Active';


-- =====================================================================
-- QUERY SET 7: TOP/BOTTOM PERFORMERS BY TENURE & TEAM SIZE
-- =====================================================================
-- Objective: Identify outliers and best-practice clusters

SELECT
  'PERFORMER_ANALYSIS' as query_type,
  'Top Performers (Quality >= 85%)' as segment,
  e.employee_code,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
  (SELECT COUNT(*) FROM mas_hrms.employees e2
   WHERE e2.reporting_manager_id = e.reporting_manager_id
   AND e2.active_status = 1) as team_size,
  ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
  COUNT(cqa.id) as audit_count,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 90 THEN 1 END) * 100.0 / COUNT(*), 0) as excellence_pct
FROM mas_hrms.employees e
JOIN db_audit.call_quality_assessment cqa ON cqa.User = e.employee_code
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND e.employment_status = 'Active'
  AND e.active_status = 1
GROUP BY e.id
HAVING AVG(cqa.quality_percentage) >= 85 AND COUNT(*) >= 10
ORDER BY avg_quality DESC
LIMIT 20

UNION ALL

SELECT
  'PERFORMER_ANALYSIS' as query_type,
  'At-Risk Performers (Quality < 70%)' as segment,
  e.employee_code,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
  (SELECT COUNT(*) FROM mas_hrms.employees e2
   WHERE e2.reporting_manager_id = e.reporting_manager_id
   AND e2.active_status = 1) as team_size,
  ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
  COUNT(cqa.id) as audit_count,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) * 100.0 / COUNT(*), 0) as critical_rate_pct
FROM mas_hrms.employees e
JOIN db_audit.call_quality_assessment cqa ON cqa.User = e.employee_code
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND e.employment_status = 'Active'
  AND e.active_status = 1
GROUP BY e.id
HAVING AVG(cqa.quality_percentage) < 70 AND COUNT(*) >= 10
ORDER BY avg_quality ASC
LIMIT 20;


-- =====================================================================
-- EXPORT SUMMARY: Run all analysis in sequence
-- =====================================================================
-- Usage: Copy all above queries into MySQL client
-- OR:    mysql -h 122.184.128.90 -u root -pVICIDIALNOW mas_hrms < quality-correlation-queries.sql > quality-analysis-results.csv
-- Results will be in tab-separated format suitable for Excel/Tableau import
