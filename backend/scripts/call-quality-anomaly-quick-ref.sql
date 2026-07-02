/**
 * QUICK REFERENCE: Call Quality Anomaly Detection (Simplified)
 * File: call-quality-anomaly-quick-ref.sql
 * Purpose: Fast queries for daily/weekly operational use
 *
 * Execution:
 *   mysql -u [user] -p mas_hrms < call-quality-anomaly-quick-ref.sql
 */

-- =====================================================================
-- 1. DAILY ANOMALIES - AGENTS TO CHECK TODAY
-- =====================================================================
SELECT
  'TODAY_ALERTS' as alert_type,
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) as agent_name,
  ROUND(AVG(cqa.quality_percentage), 1) as today_quality,
  COUNT(*) as calls_today,
  CASE
    WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL'
    WHEN AVG(cqa.quality_percentage) < 65 THEN 'HIGH'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'MEDIUM'
    ELSE 'OK'
  END as severity,
  'Check call quality immediately' as action
FROM db_audit.call_quality_assessment cqa
JOIN employees e ON cqa.User = e.employee_code
WHERE DATE(cqa.CallDate) = DATE(NOW())
  AND cqa.quality_percentage IS NOT NULL
GROUP BY e.employee_code
HAVING AVG(cqa.quality_percentage) < 70
ORDER BY today_quality ASC;


-- =====================================================================
-- 2. WEEKLY PERFORMANCE DEGRADATION - AGENTS DECLINING THIS WEEK
-- =====================================================================
WITH this_week AS (
  SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) as agent_name,
    ROUND(AVG(cqa.quality_percentage), 1) as week_quality,
    COUNT(*) as week_calls
  FROM db_audit.call_quality_assessment cqa
  JOIN employees e ON cqa.User = e.employee_code
  WHERE WEEK(cqa.CallDate, 1) = WEEK(NOW(), 1)
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY e.employee_code
),
last_week AS (
  SELECT
    e.employee_code,
    ROUND(AVG(cqa.quality_percentage), 1) as week_quality
  FROM db_audit.call_quality_assessment cqa
  JOIN employees e ON cqa.User = e.employee_code
  WHERE WEEK(cqa.CallDate, 1) = WEEK(NOW(), 1) - 1
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY e.employee_code
)
SELECT
  'WEEKLY_DEGRADATION' as alert_type,
  tw.employee_code,
  tw.agent_name,
  tw.week_quality as this_week_quality,
  lw.week_quality as last_week_quality,
  ROUND(tw.week_quality - lw.week_quality, 1) as quality_change,
  CASE
    WHEN tw.week_quality < lw.week_quality - 10 THEN 'CRITICAL_DROP'
    WHEN tw.week_quality < lw.week_quality - 5 THEN 'HIGH_DROP'
    WHEN tw.week_quality < lw.week_quality THEN 'MODERATE_DROP'
    ELSE 'STABLE'
  END as change_severity,
  'Manager follow-up required' as action
FROM this_week tw
LEFT JOIN last_week lw ON tw.employee_code = lw.employee_code
WHERE tw.week_quality < lw.week_quality
  OR (lw.week_quality IS NULL AND tw.week_quality < 75)
ORDER BY quality_change ASC;


-- =====================================================================
-- 3. SHIFT QUALITY HOTSPOTS - CURRENT WEEK SHIFTS PERFORMING POORLY
-- =====================================================================
SELECT
  'SHIFT_HOTSPOT' as alert_type,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
    WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
    ELSE 'Night'
  END as shift,
  HOUR(cqa.CallDate) as peak_hour,
  ROUND(AVG(cqa.quality_percentage), 1) as shift_quality,
  COUNT(*) as calls_in_shift,
  COUNT(DISTINCT cqa.User) as agents_in_shift,
  CASE
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'CRITICAL'
    WHEN AVG(cqa.quality_percentage) < 75 THEN 'HIGH'
    ELSE 'OK'
  END as severity,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 12 AND 13 THEN 'Lunch Valley - Reduce call complexity'
    WHEN HOUR(cqa.CallDate) >= 18 THEN 'End of shift - Reduce volume, wind-down'
    ELSE 'Review workload distribution'
  END as action
FROM db_audit.call_quality_assessment cqa
WHERE WEEK(cqa.CallDate, 1) = WEEK(NOW(), 1)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY HOUR(cqa.CallDate)
HAVING AVG(cqa.quality_percentage) < 75
ORDER BY shift_quality ASC;


-- =====================================================================
-- 4. AGENTS WITH RISING STARS - RECENT IMPROVEMENTS
-- =====================================================================
WITH recent_quality AS (
  SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) as agent_name,
    ROUND(AVG(cqa.quality_percentage), 1) as recent_quality,
    COUNT(*) as recent_calls
  FROM db_audit.call_quality_assessment cqa
  JOIN employees e ON cqa.User = e.employee_code
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY e.employee_code
),
prior_quality AS (
  SELECT
    e.employee_code,
    ROUND(AVG(cqa.quality_percentage), 1) as prior_quality
  FROM db_audit.call_quality_assessment cqa
  JOIN employees e ON cqa.User = e.employee_code
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 14 DAY)
    AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 7 DAY)
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY e.employee_code
)
SELECT
  'RISING_STAR' as alert_type,
  rq.employee_code,
  rq.agent_name,
  rq.recent_quality,
  pq.prior_quality,
  ROUND(rq.recent_quality - pq.prior_quality, 1) as improvement,
  'Recognize achievement, document practices' as action
FROM recent_quality rq
LEFT JOIN prior_quality pq ON rq.employee_code = pq.employee_code
WHERE rq.recent_quality > 85
  OR (pq.prior_quality IS NOT NULL AND rq.recent_quality > pq.prior_quality + 5)
ORDER BY improvement DESC
LIMIT 10;


-- =====================================================================
-- 5. CONSISTENCY CHECK - AGENTS WITH HIGH VARIABILITY (TODAY)
-- =====================================================================
SELECT
  'HIGH_VARIABILITY_TODAY' as alert_type,
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) as agent_name,
  ROUND(AVG(cqa.quality_percentage), 1) as today_avg,
  ROUND(STDDEV(cqa.quality_percentage), 1) as today_stddev,
  COUNT(*) as calls,
  ROUND(MIN(cqa.quality_percentage), 1) as worst_call,
  ROUND(MAX(cqa.quality_percentage), 1) as best_call,
  CASE
    WHEN STDDEV(cqa.quality_percentage) > 15 THEN 'CRITICAL_INCONSISTENCY'
    WHEN STDDEV(cqa.quality_percentage) > 10 THEN 'HIGH_VARIANCE'
    ELSE 'ACCEPTABLE'
  END as variance_status,
  'Review call recordings for patterns' as action
FROM db_audit.call_quality_assessment cqa
JOIN employees e ON cqa.User = e.employee_code
WHERE DATE(cqa.CallDate) = DATE(NOW())
  AND cqa.quality_percentage IS NOT NULL
GROUP BY e.employee_code
HAVING STDDEV(cqa.quality_percentage) > 10 AND COUNT(*) >= 5
ORDER BY today_stddev DESC;


-- =====================================================================
-- 6. PROCESS HOTSPOTS - WHICH CAMPAIGNS/PROCESSES ARE STRUGGLING
-- =====================================================================
SELECT
  'PROCESS_HOTSPOT' as alert_type,
  cqa.Campaign as process,
  ROUND(AVG(cqa.quality_percentage), 1) as process_quality,
  COUNT(*) as call_volume,
  COUNT(DISTINCT cqa.User) as team_size,
  COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) as poor_calls,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct,
  CASE
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'CRITICAL'
    WHEN AVG(cqa.quality_percentage) < 75 THEN 'HIGH'
    WHEN AVG(cqa.quality_percentage) < 80 THEN 'MEDIUM'
    ELSE 'OK'
  END as severity,
  'Review process documentation, team training' as action
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  AND cqa.quality_percentage IS NOT NULL
  AND cqa.Campaign IS NOT NULL
GROUP BY cqa.Campaign
HAVING AVG(cqa.quality_percentage) < 80
ORDER BY process_quality ASC;


-- =====================================================================
-- 7. DASHBOARD SUMMARY - ONE-PAGE SCORECARD
-- =====================================================================
SELECT
  'ORGANIZATION_SUMMARY' as metric_type,
  (SELECT ROUND(AVG(quality_percentage), 1) FROM db_audit.call_quality_assessment WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as org_quality_7day,
  (SELECT COUNT(DISTINCT User) FROM db_audit.call_quality_assessment WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 1 DAY)) as active_agents_today,
  (SELECT COUNT(*) FROM db_audit.call_quality_assessment WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 1 DAY)) as total_calls_today,
  (SELECT COUNT(DISTINCT Campaign) FROM db_audit.call_quality_assessment WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as active_processes,
  (SELECT COUNT(DISTINCT CASE WHEN AVG(quality_percentage) < 70 THEN 1 END) FROM db_audit.call_quality_assessment WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY User) as agents_below_target,
  NOW() as report_timestamp
LIMIT 1;


-- =====================================================================
-- EXPORT: One command to get all daily alerts
-- =====================================================================
-- mysql -u [user] -p mas_hrms < call-quality-anomaly-quick-ref.sql | grep -E "TODAY_ALERTS|WEEKLY_DEGRADATION|CRITICAL|HIGH"
