/**
 * Attrition Risk Analysis — Quick Reference Guide
 * Fast SQL snippets for common analysis scenarios
 * Use these to validate data, test thresholds, and generate ad-hoc reports
 */

-- =====================================================================
-- QUICK CHECK 1: Data Freshness Validation
-- =====================================================================
-- Are we getting current data? Run this first.

SELECT
  'Call Quality Assessment' as data_source,
  MAX(CallDate) as latest_date,
  DATEDIFF(NOW(), MAX(CallDate)) as days_old,
  COUNT(*) as total_records,
  COUNT(DISTINCT User) as unique_agents,
  ROUND(AVG(quality_percentage), 1) as avg_quality
FROM db_audit.call_quality_assessment
WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)

UNION ALL

SELECT
  'Attendance Records' as data_source,
  MAX(record_date) as latest_date,
  DATEDIFF(NOW(), MAX(record_date)) as days_old,
  COUNT(*) as total_records,
  COUNT(DISTINCT employee_id) as unique_employees,
  NULL
FROM mas_hrms.attendance_daily_record
WHERE record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)

UNION ALL

SELECT
  'Active Employees' as data_source,
  MAX(date_of_joining) as latest_date,
  DATEDIFF(NOW(), MAX(date_of_joining)) as days_old,
  COUNT(*) as total_records,
  COUNT(*) as unique_employees,
  NULL
FROM mas_hrms.employees
WHERE employment_status = 'Active' AND active_status = 1;


-- =====================================================================
-- QUICK CHECK 2: High-Risk Agents (Snapshot)
-- =====================================================================
-- One-liner to get top 10 at-risk agents RIGHT NOW

SELECT
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) as name,
  ROUND(AVG(cqa.quality_percentage), 1) as quality,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_mo,
  COUNT(DISTINCT cqa.id) as audits,
  CASE
    WHEN AVG(cqa.quality_percentage) < 65 THEN 'CRITICAL'
    WHEN AVG(cqa.quality_percentage) < 75 THEN 'HIGH'
    ELSE 'MEDIUM'
  END as risk
FROM mas_hrms.employees e
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE e.employment_status = 'Active' AND e.active_status = 1
GROUP BY e.id
ORDER BY quality ASC
LIMIT 10;


-- =====================================================================
-- QUICK CHECK 3: Attendance Issues This Week
-- =====================================================================
-- Find employees absent > 2 days this week

SELECT
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) as name,
  d.designation_name,
  p.process_name,
  COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.record_date END) as absences_this_week,
  COUNT(DISTINCT adr.record_date) as total_days,
  ROUND(AVG(cqa.quality_percentage), 1) as recent_quality
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
LEFT JOIN mas_hrms.attendance_daily_record adr ON e.id = adr.employee_id
  AND adr.record_date >= DATE_SUB(CURDATE(), INTERVAL DAYOFWEEK(NOW())-2 DAY)
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
WHERE e.employment_status = 'Active'
GROUP BY e.id
HAVING COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.record_date END) > 2
ORDER BY absences_this_week DESC;


-- =====================================================================
-- QUICK CHECK 4: Quality Velocity (Last 4 Weeks)
-- =====================================================================
-- See who's trending down (risk) vs up (improving)

WITH weekly AS (
  SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) as name,
    WEEK(cqa.CallDate, 1) as week,
    ROUND(AVG(cqa.quality_percentage), 1) as quality,
    COUNT(*) as calls
  FROM db_audit.call_quality_assessment cqa
  JOIN mas_hrms.employees e ON cqa.User = e.employee_code
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    AND e.employment_status = 'Active'
  GROUP BY e.id, WEEK(cqa.CallDate, 1)
  HAVING calls >= 5
)
SELECT
  CONCAT(
    w1.name,
    ' | W-0: ', COALESCE(w1.quality, 'N/A'),
    ' | W-1: ', COALESCE(w2.quality, 'N/A'),
    ' | W-2: ', COALESCE(w3.quality, 'N/A'),
    ' | W-3: ', COALESCE(w4.quality, 'N/A')
  ) as trend_view,
  CASE
    WHEN w1.quality < w2.quality AND w2.quality < w3.quality THEN '📉 DECLINING'
    WHEN w1.quality > w2.quality AND w2.quality > w3.quality THEN '📈 IMPROVING'
    ELSE '➡️ STABLE'
  END as velocity
FROM weekly w1
LEFT JOIN weekly w2 ON w1.employee_code = w2.employee_code AND w2.week = w1.week - 1
LEFT JOIN weekly w3 ON w1.employee_code = w3.employee_code AND w3.week = w1.week - 2
LEFT JOIN weekly w4 ON w1.employee_code = w4.employee_code AND w4.week = w1.week - 3
WHERE w1.week = WEEK(NOW(), 1) - 1  -- Last complete week
ORDER BY w1.quality ASC;


-- =====================================================================
-- QUICK CHECK 5: Process-Level Risk Summary
-- =====================================================================
-- Which LOB has most at-risk agents?

SELECT
  p.process_name as process,
  bm.branch_name as branch,
  COUNT(DISTINCT e.id) as total_agents,
  COUNT(DISTINCT CASE WHEN AVG(cqa.quality_percentage) < 70 THEN e.id END) as at_risk_agents,
  ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
  ROUND((COUNT(DISTINCT CASE WHEN AVG(cqa.quality_percentage) < 70 THEN e.id END) /
         COUNT(DISTINCT e.id) * 100), 1) as pct_at_risk
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE e.employment_status = 'Active' AND e.active_status = 1
GROUP BY p.id, bm.id
ORDER BY pct_at_risk DESC;


-- =====================================================================
-- QUICK CHECK 6: Early Warning Signals (Absence Spike Last Week)
-- =====================================================================
-- Who went from normal to many absences?

SELECT
  e.employee_code,
  CONCAT(e.first_name, ' ', e.last_name) as name,
  d.designation_name,
  (SELECT COUNT(*) FROM mas_hrms.attendance_daily_record
   WHERE employee_id = e.id AND record_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
   AND attendance_status = 'absent') as absences_last_7d,
  (SELECT COUNT(*) FROM mas_hrms.attendance_daily_record
   WHERE employee_id = e.id AND record_date >= DATE_SUB(NOW(), INTERVAL 14 DAY)
   AND record_date < DATE_SUB(NOW(), INTERVAL 7 DAY)
   AND attendance_status = 'absent') as absences_prior_7d,
  ROUND(AVG(cqa.quality_percentage), 1) as quality
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
WHERE e.employment_status = 'Active' AND e.active_status = 1
  AND (SELECT COUNT(*) FROM mas_hrms.attendance_daily_record
       WHERE employee_id = e.id AND record_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND attendance_status = 'absent') >
      (SELECT COALESCE(COUNT(*), 0) FROM mas_hrms.attendance_daily_record
       WHERE employee_id = e.id AND record_date >= DATE_SUB(NOW(), INTERVAL 14 DAY)
       AND record_date < DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND attendance_status = 'absent') + 2
ORDER BY absences_last_7d DESC;


-- =====================================================================
-- QUICK CHECK 7: Manager-Level Risk Distribution
-- =====================================================================
-- Risk concentration by manager (span of control + agent quality)

SELECT
  rm.employee_code as manager_code,
  CONCAT(rm.first_name, ' ', rm.last_name) as manager_name,
  COUNT(DISTINCT e.id) as team_size,
  COUNT(DISTINCT CASE WHEN AVG(cqa.quality_percentage) < 70 THEN e.id END) as at_risk_count,
  ROUND(AVG(cqa.quality_percentage), 1) as team_avg_quality,
  ROUND(STDDEV(cqa.quality_percentage), 1) as team_quality_variance,
  CASE
    WHEN COUNT(DISTINCT CASE WHEN AVG(cqa.quality_percentage) < 70 THEN e.id END) >= 5 THEN 'HIGH'
    WHEN COUNT(DISTINCT CASE WHEN AVG(cqa.quality_percentage) < 70 THEN e.id END) >= 2 THEN 'MEDIUM'
    ELSE 'LOW'
  END as manager_risk_level
FROM mas_hrms.employees e
JOIN mas_hrms.employees rm ON e.reporting_manager_id = rm.id
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE e.employment_status = 'Active' AND e.active_status = 1
  AND rm.active_status = 1
GROUP BY rm.id
ORDER BY at_risk_count DESC;


-- =====================================================================
-- QUICK CHECK 8: Tenure vs Quality (Ramp-Up Analysis)
-- =====================================================================
-- Are newer employees performing worse? (Expected ramp pattern)

SELECT
  CASE
    WHEN DATEDIFF(NOW(), e.date_of_joining) < 30 THEN '0-1 month'
    WHEN DATEDIFF(NOW(), e.date_of_joining) < 60 THEN '1-2 months'
    WHEN DATEDIFF(NOW(), e.date_of_joining) < 90 THEN '2-3 months'
    WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN '3-6 months'
    WHEN DATEDIFF(NOW(), e.date_of_joining) < 365 THEN '6-12 months'
    ELSE '12+ months'
  END as tenure_band,
  COUNT(DISTINCT e.id) as agent_count,
  COUNT(DISTINCT cqa.id) as total_audits,
  ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
  ROUND(MIN(cqa.quality_percentage), 1) as worst,
  ROUND(MAX(cqa.quality_percentage), 1) as best,
  ROUND(STDDEV(cqa.quality_percentage), 1) as volatility
FROM mas_hrms.employees e
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE e.employment_status = 'Active' AND e.active_status = 1
GROUP BY CASE
  WHEN DATEDIFF(NOW(), e.date_of_joining) < 30 THEN '0-1 month'
  WHEN DATEDIFF(NOW(), e.date_of_joining) < 60 THEN '1-2 months'
  WHEN DATEDIFF(NOW(), e.date_of_joining) < 90 THEN '2-3 months'
  WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN '3-6 months'
  WHEN DATEDIFF(NOW(), e.date_of_joining) < 365 THEN '6-12 months'
  ELSE '12+ months'
END
ORDER BY FIELD(tenure_band, '0-1 month', '1-2 months', '2-3 months', '3-6 months', '6-12 months', '12+ months');


-- =====================================================================
-- QUICK CHECK 9: Data Completeness Assessment
-- =====================================================================
-- Verify data quality before running analysis

SELECT
  'Employees' as entity,
  COUNT(*) as total_records,
  COUNT(CASE WHEN date_of_joining IS NULL THEN 1 END) as missing_join_date,
  COUNT(CASE WHEN employment_status IS NULL THEN 1 END) as missing_status,
  COUNT(CASE WHEN active_status = 1 THEN 1 END) as active_count,
  ROUND(COUNT(CASE WHEN active_status = 1 THEN 1 END) / COUNT(*) * 100, 1) as active_pct
FROM mas_hrms.employees

UNION ALL

SELECT
  'Attendance Records' as entity,
  COUNT(*) as total_records,
  COUNT(CASE WHEN record_date IS NULL THEN 1 END) as missing_date,
  COUNT(CASE WHEN attendance_status IS NULL THEN 1 END) as missing_status,
  COUNT(DISTINCT employee_id) as unique_employees,
  NULL
FROM mas_hrms.attendance_daily_record
WHERE record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)

UNION ALL

SELECT
  'Quality Audits' as entity,
  COUNT(*) as total_records,
  COUNT(CASE WHEN CallDate IS NULL THEN 1 END) as missing_date,
  COUNT(CASE WHEN quality_percentage IS NULL THEN 1 END) as missing_quality,
  COUNT(DISTINCT User) as unique_agents,
  NULL
FROM db_audit.call_quality_assessment
WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY);


-- =====================================================================
-- QUICK CHECK 10: Risk Threshold Calibration
-- =====================================================================
-- Validate what % of agents fall into each risk bucket

SELECT
  CASE
    WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL (< 60%)'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH (60-70%)'
    WHEN AVG(cqa.quality_percentage) < 80 THEN 'MEDIUM (70-80%)'
    WHEN AVG(cqa.quality_percentage) < 90 THEN 'GOOD (80-90%)'
    ELSE 'EXCELLENT (90%+)'
  END as quality_band,
  COUNT(DISTINCT e.id) as agent_count,
  ROUND(COUNT(DISTINCT e.id) / (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees
        WHERE employment_status = 'Active' AND active_status = 1) * 100, 1) as pct_of_active,
  COUNT(DISTINCT cqa.id) as total_audits,
  ROUND(AVG(cqa.quality_percentage), 1) as mean_quality,
  ROUND(STDDEV(cqa.quality_percentage), 1) as stddev_quality
FROM mas_hrms.employees e
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE e.employment_status = 'Active' AND e.active_status = 1
GROUP BY CASE
  WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL (< 60%)'
  WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH (60-70%)'
  WHEN AVG(cqa.quality_percentage) < 80 THEN 'MEDIUM (70-80%)'
  WHEN AVG(cqa.quality_percentage) < 90 THEN 'GOOD (80-90%)'
  ELSE 'EXCELLENT (90%+)'
END
ORDER BY agent_count DESC;


-- =====================================================================
-- EXPORTS
-- =====================================================================
-- Run individual queries to CSV for external analysis

-- Export to CSV:
-- mysql -h [host] -u [user] -p [pass] mas_hrms -e "[QUERY]" > output.csv

-- Or use direct export:
-- SELECT ... INTO OUTFILE '/tmp/report.csv' FIELDS TERMINATED BY ','
-- FROM ... WHERE ...;
