/**
 * CALL QUALITY ANOMALY DETECTION & OUTLIER ANALYSIS
 * File: call-quality-anomaly-detection.sql
 * Purpose: Identify outlier agents, fatigue patterns, seasonal anomalies, and behavioral anomalies
 * Run Against: MySQL database (mas_hrms + db_audit)
 *
 * Execution:
 *   mysql -h [host] -u [user] -p mas_hrms < call-quality-anomaly-detection.sql > anomaly-results.csv
 *
 * Output Format: ANOMALY_TYPE | AGENT | SEVERITY | PATTERN | RECOMMENDED_ACTION
 */

-- =====================================================================
-- QUERY 1: OUTLIER AGENTS - QUALITY >2 STDDEV FROM MEAN (TOP/BOTTOM)
-- =====================================================================
-- Objective: Find agents whose quality is significantly different from organization average
-- Severity: CRITICAL (>3σ), HIGH (2-3σ), MEDIUM (1-2σ)
-- Use Case: Performance interventions, elite recognition, at-risk coaching

SELECT
  'AGENT_OUTLIER_QUALITY' as anomaly_type,
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) as agent_name,
  cqa.Campaign as process,
  ROUND(AVG(cqa.quality_percentage), 2) as agent_avg_quality,
  org_stats.org_avg_quality,
  org_stats.org_stddev,
  ROUND(ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) / org_stats.org_stddev, 2) as stddev_distance,
  CASE
    WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > (3 * org_stats.org_stddev) THEN 'CRITICAL'
    WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > (2 * org_stats.org_stddev) THEN 'HIGH'
    WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > org_stats.org_stddev THEN 'MEDIUM'
    ELSE 'LOW'
  END as severity,
  CASE
    WHEN AVG(cqa.quality_percentage) > org_stats.org_avg_quality THEN 'ELITE_PERFORMER'
    ELSE 'UNDERPERFORMER'
  END as performance_category,
  COUNT(*) as sample_calls,
  MIN(cqa.quality_percentage) as min_quality,
  MAX(cqa.quality_percentage) as max_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as agent_stddev,
  CASE
    WHEN AVG(cqa.quality_percentage) > org_stats.org_avg_quality + (2 * org_stats.org_stddev) THEN 'Replicate practices across team'
    WHEN AVG(cqa.quality_percentage) < org_stats.org_avg_quality - (2 * org_stats.org_stddev) THEN 'Mandatory coaching + monitoring'
    ELSE 'Standard monitoring'
  END as recommended_action,
  ROUND(MIN(cqa.CallDate), 0) as period_start,
  ROUND(MAX(cqa.CallDate), 0) as period_end,
  NOW() as analysis_timestamp
FROM db_audit.call_quality_assessment cqa
JOIN employees e ON cqa.User = e.employee_code
CROSS JOIN (
  SELECT
    AVG(quality_percentage) as org_avg_quality,
    STDDEV(quality_percentage) as org_stddev
  FROM db_audit.call_quality_assessment
  WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND quality_percentage IS NOT NULL
) org_stats
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY e.employee_code, cqa.Campaign
HAVING ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) >= org_stats.org_stddev
ORDER BY stddev_distance DESC;


-- =====================================================================
-- QUERY 2: FATIGUE DETECTION - QUALITY DEGRADATION AFTER CONSECUTIVE DAYS
-- =====================================================================
-- Objective: Detect agents experiencing fatigue (quality drops on consecutive work days)
-- Pattern: Monday-Friday degradation, post-day-off recovery, week-long decline
-- Severity: CRITICAL (<60%), HIGH (60-65%), MEDIUM (65-70%), LOW (70-75%)

SELECT
  'FATIGUE_PATTERN' as anomaly_type,
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) as agent_name,
  DAYNAME(cqa.CallDate) as work_day,
  DATE(cqa.CallDate) as work_date,
  ROUND(AVG(cqa.quality_percentage), 2) as daily_quality,
  COALESCE(
    ROUND(LAG(AVG(cqa.quality_percentage)) OVER (PARTITION BY cqa.User ORDER BY DATE(cqa.CallDate)), 2),
    0
  ) as prev_day_quality,
  COALESCE(
    ROUND(AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage)) OVER (PARTITION BY cqa.User ORDER BY DATE(cqa.CallDate)), 2),
    0
  ) as quality_change,
  COUNT(*) as daily_calls,
  CASE
    WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL'
    WHEN AVG(cqa.quality_percentage) < 65 THEN 'HIGH'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'MEDIUM'
    WHEN AVG(cqa.quality_percentage) < 75 THEN 'LOW'
    ELSE 'ACCEPTABLE'
  END as severity,
  CASE
    WHEN DAYNAME(cqa.CallDate) = 'Friday' AND AVG(cqa.quality_percentage) < 70 THEN 'FRIDAY_FATIGUE'
    WHEN DAYNAME(cqa.CallDate) IN ('Saturday', 'Sunday') AND AVG(cqa.quality_percentage) < 70 THEN 'WEEKEND_FATIGUE'
    WHEN AVG(cqa.quality_percentage) < COALESCE(LAG(AVG(cqa.quality_percentage)) OVER (PARTITION BY cqa.User ORDER BY DATE(cqa.CallDate)), 75) - 5 THEN 'SHARP_DECLINE'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'SUSTAINED_LOW_QUALITY'
    ELSE 'NORMAL'
  END as fatigue_pattern,
  CASE
    WHEN AVG(cqa.quality_percentage) < 60 THEN 'Immediate intervention + reduced workload'
    WHEN AVG(cqa.quality_percentage) < 65 AND DAYNAME(cqa.CallDate) IN ('Friday', 'Saturday', 'Sunday') THEN 'Schedule adjustment + break optimization'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'Increase monitoring + offer break'
    ELSE 'Continue normal monitoring'
  END as recommended_action,
  NOW() as analysis_timestamp
FROM db_audit.call_quality_assessment cqa
JOIN employees e ON cqa.User = e.employee_code
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY e.employee_code, DATE(cqa.CallDate)
HAVING AVG(cqa.quality_percentage) < 75
  OR (COALESCE(LAG(AVG(cqa.quality_percentage)) OVER (PARTITION BY cqa.User ORDER BY DATE(cqa.CallDate)), 0) > 0
    AND AVG(cqa.quality_percentage) < COALESCE(LAG(AVG(cqa.quality_percentage)) OVER (PARTITION BY cqa.User ORDER BY DATE(cqa.CallDate)), 75) - 5)
ORDER BY e.employee_code, work_date DESC;


-- =====================================================================
-- QUERY 3: SEASONAL PATTERNS - WEEKLY TRENDS & CYCLICAL DEGRADATION
-- =====================================================================
-- Objective: Identify systematic weekly patterns (Monday blues, Friday fatigue, etc.)
-- Pattern: Compare each day-of-week across multiple weeks
-- Severity: How much the pattern deviates from org average

WITH weekly_trends AS (
  SELECT
    WEEK(cqa.CallDate, 1) as week_num,
    DAYNAME(cqa.CallDate) as day_name,
    DAYOFWEEK(cqa.CallDate) as day_of_week,
    ROUND(AVG(cqa.quality_percentage), 2) as day_quality,
    COUNT(*) as call_volume,
    COUNT(DISTINCT cqa.User) as agent_count,
    ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance
  FROM db_audit.call_quality_assessment cqa
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY WEEK(cqa.CallDate, 1), DAYNAME(cqa.CallDate)
),
day_of_week_avg AS (
  SELECT
    day_name,
    ROUND(AVG(day_quality), 2) as avg_day_quality,
    ROUND(STDDEV(day_quality), 2) as day_quality_stddev,
    COUNT(*) as weeks_observed
  FROM weekly_trends
  GROUP BY day_name
),
org_avg AS (
  SELECT
    ROUND(AVG(day_quality), 2) as overall_org_quality,
    ROUND(STDDEV(day_quality), 2) as overall_org_stddev
  FROM weekly_trends
)
SELECT
  'SEASONAL_WEEKLY_PATTERN' as anomaly_type,
  dow.day_name as day_of_week,
  dow.avg_day_quality,
  org.overall_org_quality,
  ROUND(dow.avg_day_quality - org.overall_org_quality, 2) as quality_delta,
  CASE
    WHEN dow.avg_day_quality < (org.overall_org_quality - (2 * org.overall_org_stddev)) THEN 'CRITICAL'
    WHEN dow.avg_day_quality < (org.overall_org_quality - org.overall_org_stddev) THEN 'HIGH'
    WHEN dow.avg_day_quality < org.overall_org_quality THEN 'MEDIUM'
    ELSE 'LOW'
  END as severity,
  CASE
    WHEN dow.day_name IN ('Saturday', 'Sunday') THEN 'WEEKEND_DEGRADATION'
    WHEN dow.day_name = 'Friday' AND dow.avg_day_quality < org.overall_org_quality THEN 'FRIDAY_FATIGUE'
    WHEN dow.day_name = 'Monday' AND dow.avg_day_quality < org.overall_org_quality THEN 'MONDAY_BLUES'
    WHEN dow.avg_day_quality < org.overall_org_quality THEN 'WEEKDAY_DECLINE'
    ELSE 'ACCEPTABLE'
  END as seasonal_pattern,
  dow.day_quality_stddev as day_consistency,
  dow.weeks_observed,
  CASE
    WHEN dow.day_name IN ('Saturday', 'Sunday') THEN 'Consider reduced staffing or incentive for weekend shifts'
    WHEN dow.day_name = 'Friday' THEN 'Optimize Friday workload distribution + break timing'
    WHEN dow.day_name = 'Monday' THEN 'Implement Monday re-engagement program'
    ELSE 'Monitor for consistency'
  END as recommended_action,
  NOW() as analysis_timestamp
FROM day_of_week_avg dow
CROSS JOIN org_avg org
ORDER BY quality_delta ASC;


-- =====================================================================
-- QUERY 4: INTRA-DAY PATTERNS - HOUR-BY-HOUR ANOMALIES
-- =====================================================================
-- Objective: Identify specific hours where quality consistently degrades
-- Pattern: Lunch valley, end-of-shift decline, morning ramp-up
-- Severity: Compare each hour to surrounding hours and org average

WITH hourly_stats AS (
  SELECT
    HOUR(cqa.CallDate) as hour_of_day,
    CASE
      WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 11 THEN 'Morning Peak'
      WHEN HOUR(cqa.CallDate) BETWEEN 12 AND 13 THEN 'Lunch Valley'
      WHEN HOUR(cqa.CallDate) BETWEEN 14 AND 17 THEN 'Afternoon Peak'
      WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 20 THEN 'Evening'
      ELSE 'Off-Peak'
    END as shift_phase,
    ROUND(AVG(cqa.quality_percentage), 2) as hourly_quality,
    ROUND(STDDEV(cqa.quality_percentage), 2) as hourly_variance,
    COUNT(*) as hourly_calls,
    COUNT(DISTINCT cqa.User) as hourly_agents,
    ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as good_rate_pct,
    ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct
  FROM db_audit.call_quality_assessment cqa
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY HOUR(cqa.CallDate)
),
org_hourly_avg AS (
  SELECT
    ROUND(AVG(hourly_quality), 2) as org_avg_hourly_quality,
    ROUND(STDDEV(hourly_quality), 2) as org_hourly_stddev
  FROM hourly_stats
)
SELECT
  'INTRADAY_ANOMALY' as anomaly_type,
  hs.hour_of_day,
  hs.shift_phase,
  hs.hourly_quality,
  oha.org_avg_hourly_quality,
  ROUND(hs.hourly_quality - oha.org_avg_hourly_quality, 2) as quality_delta,
  CASE
    WHEN hs.hourly_quality < (oha.org_avg_hourly_quality - (2 * oha.org_hourly_stddev)) THEN 'CRITICAL'
    WHEN hs.hourly_quality < (oha.org_avg_hourly_quality - oha.org_hourly_stddev) THEN 'HIGH'
    WHEN hs.hourly_quality < oha.org_avg_hourly_quality THEN 'MEDIUM'
    ELSE 'LOW'
  END as severity,
  CASE
    WHEN hs.shift_phase = 'Lunch Valley' AND hs.hourly_quality < 75 THEN 'LUNCH_VALLEY_DIP'
    WHEN hs.hour_of_day >= 17 AND hs.hourly_quality < 75 THEN 'END_OF_SHIFT_DECLINE'
    WHEN hs.hour_of_day IN (8, 9) AND hs.hourly_quality < 75 THEN 'MORNING_RAMP_ISSUE'
    WHEN hs.hourly_quality < oha.org_avg_hourly_quality THEN 'HOUR_UNDERPERFORMANCE'
    ELSE 'ACCEPTABLE'
  END as intraday_pattern,
  hs.hourly_calls as sample_size,
  hs.good_rate_pct,
  hs.poor_rate_pct,
  CASE
    WHEN hs.shift_phase = 'Lunch Valley' THEN 'Adjust break timing + reduce complex calls during 12-13'
    WHEN hs.hour_of_day >= 17 THEN 'Implement end-of-shift wind-down + reduce workload'
    WHEN hs.hour_of_day IN (8, 9) THEN 'Add warm-up activities + simpler call routing'
    ELSE 'Monitor for consistency'
  END as recommended_action,
  NOW() as analysis_timestamp
FROM hourly_stats hs
CROSS JOIN org_hourly_avg oha
WHERE hs.hourly_quality < oha.org_avg_hourly_quality
  OR hs.poor_rate_pct > 30
ORDER BY quality_delta ASC;


-- =====================================================================
-- QUERY 5: INDIVIDUAL VARIABILITY ANOMALIES - HIGH INCONSISTENCY
-- =====================================================================
-- Objective: Find agents with unusually high variability (unstable performance)
-- Pattern: Agents with stddev >2x org average (unreliable performance)
-- Severity: Indicates lack of skill mastery or emotional/personal instability

WITH agent_variability AS (
  SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) as agent_name,
    cqa.Campaign as process,
    ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
    ROUND(STDDEV(cqa.quality_percentage), 2) as agent_stddev,
    COUNT(*) as sample_calls,
    ROUND(MIN(cqa.quality_percentage), 1) as min_call_quality,
    ROUND(MAX(cqa.quality_percentage), 1) as max_call_quality,
    ROUND(MAX(cqa.quality_percentage) - MIN(cqa.quality_percentage), 1) as quality_range
  FROM db_audit.call_quality_assessment cqa
  JOIN employees e ON cqa.User = e.employee_code
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY e.employee_code, cqa.Campaign
),
org_variability AS (
  SELECT
    ROUND(AVG(agent_stddev), 2) as org_avg_stddev,
    ROUND(STDDEV(agent_stddev), 2) as org_stddev_stddev
  FROM agent_variability
)
SELECT
  'HIGH_VARIABILITY_ANOMALY' as anomaly_type,
  av.employee_code,
  av.agent_name,
  av.process,
  av.avg_quality,
  av.agent_stddev,
  ov.org_avg_stddev,
  ROUND(av.agent_stddev / ov.org_avg_stddev, 2) as variability_ratio,
  CASE
    WHEN av.agent_stddev > (ov.org_avg_stddev + (2 * ov.org_stddev_stddev)) THEN 'CRITICAL'
    WHEN av.agent_stddev > (ov.org_avg_stddev + ov.org_stddev_stddev) THEN 'HIGH'
    WHEN av.agent_stddev > ov.org_avg_stddev THEN 'MEDIUM'
    ELSE 'LOW'
  END as severity,
  CASE
    WHEN av.agent_stddev > (ov.org_avg_stddev * 2) THEN 'HIGHLY_UNPREDICTABLE'
    WHEN av.agent_stddev > (ov.org_avg_stddev * 1.5) THEN 'MODERATELY_INCONSISTENT'
    ELSE 'ACCEPTABLE_VARIANCE'
  END as consistency_pattern,
  av.quality_range,
  av.min_call_quality,
  av.max_call_quality,
  av.sample_calls,
  CASE
    WHEN av.agent_stddev > (ov.org_avg_stddev * 2) THEN 'Diagnostic assessment + individualized coaching program'
    WHEN av.agent_stddev > (ov.org_avg_stddev * 1.5) THEN 'Structured training + performance monitoring'
    ELSE 'Standard monitoring'
  END as recommended_action,
  NOW() as analysis_timestamp
FROM agent_variability av
CROSS JOIN org_variability ov
WHERE av.agent_stddev > ov.org_avg_stddev
ORDER BY variability_ratio DESC;


-- =====================================================================
-- QUERY 6: SUDDEN PERFORMANCE SHIFTS - ANOMALOUS BEHAVIOR DETECTION
-- =====================================================================
-- Objective: Detect agents with sudden drops/rises in quality (potential issues or improvements)
-- Pattern: Week-over-week comparison, last week vs. 4-week average
-- Severity: >10% drop = HIGH, 5-10% = MEDIUM, <5% = LOW

WITH weekly_agent_quality AS (
  SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) as agent_name,
    WEEK(cqa.CallDate, 1) as week_num,
    YEAR(cqa.CallDate) as year_num,
    ROUND(AVG(cqa.quality_percentage), 2) as weekly_avg_quality,
    COUNT(*) as weekly_calls
  FROM db_audit.call_quality_assessment cqa
  JOIN employees e ON cqa.User = e.employee_code
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY e.employee_code, YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)
)
SELECT
  'SUDDEN_PERFORMANCE_SHIFT' as anomaly_type,
  waq1.employee_code,
  waq1.agent_name,
  waq1.week_num as current_week,
  waq1.weekly_avg_quality as current_week_quality,
  COALESCE(ROUND(AVG(waq2.weekly_avg_quality), 2), waq1.weekly_avg_quality) as previous_4week_avg,
  ROUND(waq1.weekly_avg_quality - COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality), 2) as quality_change,
  ROUND(
    (waq1.weekly_avg_quality - COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality)) /
    COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality) * 100,
    2
  ) as pct_change,
  CASE
    WHEN ABS(waq1.weekly_avg_quality - COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality)) > 10 THEN 'CRITICAL'
    WHEN ABS(waq1.weekly_avg_quality - COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality)) > 5 THEN 'HIGH'
    ELSE 'MEDIUM'
  END as severity,
  CASE
    WHEN waq1.weekly_avg_quality < COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality) THEN 'PERFORMANCE_DEGRADATION'
    ELSE 'PERFORMANCE_IMPROVEMENT'
  END as shift_direction,
  waq1.weekly_calls as current_week_sample,
  CASE
    WHEN waq1.weekly_avg_quality < COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality) - 10 THEN 'Immediate 1-on-1 check-in + identify root cause'
    WHEN waq1.weekly_avg_quality > COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality) + 10 THEN 'Recognize improvement + maintain momentum'
    WHEN ABS(waq1.weekly_avg_quality - COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality)) > 5 THEN 'Close monitoring + follow-up conversation'
    ELSE 'No immediate action'
  END as recommended_action,
  NOW() as analysis_timestamp
FROM weekly_agent_quality waq1
LEFT JOIN weekly_agent_quality waq2
  ON waq1.employee_code = waq2.employee_code
  AND waq2.week_num < waq1.week_num
  AND waq2.week_num >= (waq1.week_num - 4)
WHERE waq1.week_num = (SELECT MAX(week_num) FROM weekly_agent_quality)
  AND waq1.year_num = (SELECT MAX(year_num) FROM weekly_agent_quality)
GROUP BY waq1.employee_code, waq1.week_num, waq1.weekly_avg_quality, waq1.weekly_calls
HAVING ABS(waq1.weekly_avg_quality - COALESCE(AVG(waq2.weekly_avg_quality), waq1.weekly_avg_quality)) >= 5
ORDER BY ABS(quality_change) DESC;


-- =====================================================================
-- CONSOLIDATED ANOMALY REPORT - SUMMARY BY SEVERITY
-- =====================================================================
-- Purpose: Executive summary of all anomalies ranked by severity and type

WITH all_anomalies AS (
  -- Agent Outliers
  SELECT
    'AGENT_OUTLIER' as anomaly_category,
    employee_code as subject_id,
    agent_name as subject_name,
    severity,
    performance_category as anomaly_detail,
    recommended_action,
    sample_calls as data_points,
    anomaly_type
  FROM (
    SELECT
      e.employee_code,
      CONCAT(e.first_name, ' ', e.last_name) as agent_name,
      CASE
        WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > (3 * org_stats.org_stddev) THEN 'CRITICAL'
        WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > (2 * org_stats.org_stddev) THEN 'HIGH'
        WHEN ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) > org_stats.org_stddev THEN 'MEDIUM'
        ELSE 'LOW'
      END as severity,
      CASE
        WHEN AVG(cqa.quality_percentage) > org_stats.org_avg_quality THEN 'ELITE_PERFORMER'
        ELSE 'UNDERPERFORMER'
      END as performance_category,
      CASE
        WHEN AVG(cqa.quality_percentage) > org_stats.org_avg_quality + (2 * org_stats.org_stddev) THEN 'Replicate practices across team'
        WHEN AVG(cqa.quality_percentage) < org_stats.org_avg_quality - (2 * org_stats.org_stddev) THEN 'Mandatory coaching + monitoring'
        ELSE 'Standard monitoring'
      END as recommended_action,
      COUNT(*) as sample_calls,
      'AGENT_OUTLIER_QUALITY' as anomaly_type
    FROM db_audit.call_quality_assessment cqa
    JOIN employees e ON cqa.User = e.employee_code
    CROSS JOIN (
      SELECT
        AVG(quality_percentage) as org_avg_quality,
        STDDEV(quality_percentage) as org_stddev
      FROM db_audit.call_quality_assessment
      WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        AND quality_percentage IS NOT NULL
    ) org_stats
    WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      AND cqa.quality_percentage IS NOT NULL
    GROUP BY e.employee_code
    HAVING ABS(AVG(cqa.quality_percentage) - org_stats.org_avg_quality) >= org_stats.org_stddev
  ) t
)
SELECT
  'ANOMALY_SUMMARY' as report_type,
  COUNT(*) as total_anomalies,
  SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) as critical_count,
  SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) as high_count,
  SUM(CASE WHEN severity = 'MEDIUM' THEN 1 ELSE 0 END) as medium_count,
  anomaly_category,
  GROUP_CONCAT(DISTINCT subject_name SEPARATOR ', ') as affected_agents,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM all_anomalies), 1) as pct_of_total_anomalies,
  NOW() as report_timestamp
FROM all_anomalies
GROUP BY anomaly_category
ORDER BY critical_count DESC, high_count DESC;


-- =====================================================================
-- EXPORT NOTES
-- =====================================================================
-- Usage:
--   mysql -h [host] -u [user] -p mas_hrms < call-quality-anomaly-detection.sql > anomaly-report.txt
--
-- Interpretation Guide:
--
-- 1. AGENT_OUTLIER_QUALITY:
--    - stddev_distance > 3 = CRITICAL, 2-3 = HIGH, 1-2 = MEDIUM, <1 = LOW
--    - ELITE_PERFORMER: Quality significantly above org average (best practices to replicate)
--    - UNDERPERFORMER: Quality significantly below org average (coaching needed)
--
-- 2. FATIGUE_PATTERN:
--    - FRIDAY_FATIGUE: Predictable Friday decline
--    - WEEKEND_FATIGUE: Saturday/Sunday quality drops
--    - SHARP_DECLINE: Unexpected quality drop day-over-day
--    - SUSTAINED_LOW_QUALITY: Consistent poor performance
--
-- 3. SEASONAL_WEEKLY_PATTERN:
--    - Compares each day of week against org average
--    - WEEKEND_DEGRADATION: Expected pattern
--    - FRIDAY_FATIGUE: End-of-week decline
--    - MONDAY_BLUES: Post-weekend ramp-up issue
--
-- 4. INTRADAY_ANOMALY:
--    - LUNCH_VALLEY_DIP: Quality dip during 12-13 hours
--    - END_OF_SHIFT_DECLINE: Quality degradation after 17:00
--    - MORNING_RAMP_ISSUE: Slow start performance
--
-- 5. HIGH_VARIABILITY_ANOMALY:
--    - variability_ratio > 2 = Highly unpredictable (unstable mastery)
--    - 1.5-2 = Moderately inconsistent (needs structure)
--    - Indicator of emotional, skill, or environmental instability
--
-- 6. SUDDEN_PERFORMANCE_SHIFT:
--    - pct_change > 10% = CRITICAL shift
--    - Indicates potential: illness, personal crisis, new skills, attrition risk
--
-- Last Updated: 2026-06-21
