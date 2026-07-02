/**
 * Attrition Risk & Performance Degradation Analysis
 * File: attrition-risk-analysis.sql
 * Purpose: Identify agents at risk of attrition through performance degradation,
 *          absenteeism correlation, and compound risk factors
 * Run Against: MySQL database (mas_hrms + db_audit)
 * Execution:
 *   mysql -h [host] -u [user] -p mas_hrms < attrition-risk-analysis.sql > attrition-risk-results.csv
 */

-- =====================================================================
-- QUERY SET 1: PERFORMANCE DEGRADATION (30-DAY ROLLING AVG)
-- =====================================================================
-- Objective: Detect agents whose quality is declining over time (attrition risk indicator)
-- Threshold: Week-over-week quality drop > 5% = WARNING, > 10% = RISK
-- Output Columns: RISK_AGENT | DEGRADATION_RATE | ATTRITION_RISK_SCORE | INTERVENTION_PRIORITY

SELECT
  'PERFORMANCE_DEGRADATION' as analysis_type,
  e.employee_code as RISK_AGENT,
  e.first_name,
  e.last_name,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
  WEEK(cqa.CallDate, 1) as week_num,
  YEAR(cqa.CallDate) as year_num,
  DATE_FORMAT(DATE_SUB(MAX(cqa.CallDate), INTERVAL DAYOFWEEK(MAX(cqa.CallDate))-2 DAY), '%Y-%m-%d') as week_start,
  COUNT(DISTINCT cqa.id) as call_count,
  ROUND(AVG(cqa.quality_percentage), 2) as weekly_avg_quality,
  LAG(ROUND(AVG(cqa.quality_percentage), 2))
    OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)) as prev_week_avg_quality,
  ROUND(AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
    OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)), 2) as quality_delta,
  CASE
    WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < -10 THEN 'RISK'
    WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < -5 THEN 'WARNING'
    WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < 0 THEN 'WATCH'
    ELSE 'STABLE'
  END as performance_trend,
  DATEDIFF(NOW(), e.date_of_joining) as tenure_days,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
  e.employment_status,
  CASE
    WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH_PRIORITY'
    WHEN AVG(cqa.quality_percentage) < 80 THEN 'MEDIUM_PRIORITY'
    ELSE 'ROUTINE'
  END as INTERVENTION_PRIORITY,
  -- Attrition risk score: 0-100
  CASE
    WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < -15 THEN 85
    WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < -10 THEN 70
    WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < -5 THEN 55
    ELSE 30
  END as DEGRADATION_RATE_SCORE,
  NOW() as analysis_timestamp
FROM db_audit.call_quality_assessment cqa
JOIN mas_hrms.employees e ON cqa.User = e.employee_code
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND e.employment_status = 'Active'
  AND e.active_status = 1
  AND cqa.quality_percentage IS NOT NULL
GROUP BY
  e.id,
  YEAR(cqa.CallDate),
  WEEK(cqa.CallDate, 1)
HAVING COUNT(DISTINCT cqa.id) >= 5  -- At least 5 calls per week
  AND LAG(AVG(cqa.quality_percentage)) OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)) IS NOT NULL
  AND (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
       OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < 0
ORDER BY quality_delta ASC, e.employee_code, week_num DESC;


-- =====================================================================
-- QUERY SET 2: ABSENTEEISM CORRELATION WITH QUALITY
-- =====================================================================
-- Objective: Correlate attendance patterns with quality degradation
-- Finding: High absenteeism + low quality = high attrition risk
-- Output: High-risk agents with combined attendance & quality issues

SELECT
  'ABSENTEEISM_CORRELATION' as analysis_type,
  e.employee_code as RISK_AGENT,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
  COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) as present_days,
  COUNT(DISTINCT adr.record_date) as total_days,
  ROUND((COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
         COUNT(DISTINCT adr.record_date) * 100), 2) as DEGRADATION_RATE,
  COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.record_date END) as absent_days,
  COUNT(DISTINCT CASE WHEN adr.attendance_status = 'half_day' THEN adr.record_date END) as half_days,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_score,
  COUNT(DISTINCT cqa.id) as audited_calls,
  CASE
    WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
          COUNT(DISTINCT adr.record_date) * 100) < 80
      AND AVG(cqa.quality_percentage) < 75 THEN 'CRITICAL'
    WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
          COUNT(DISTINCT adr.record_date) * 100) < 85
      AND AVG(cqa.quality_percentage) < 80 THEN 'HIGH_PRIORITY'
    WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
          COUNT(DISTINCT adr.record_date) * 100) < 90
      OR AVG(cqa.quality_percentage) < 70 THEN 'MEDIUM_PRIORITY'
    ELSE 'ROUTINE'
  END as INTERVENTION_PRIORITY,
  -- Calculate composite attrition risk score
  ROUND(
    CASE
      WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
            COUNT(DISTINCT adr.record_date) * 100) < 75 THEN 30
      WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
            COUNT(DISTINCT adr.record_date) * 100) < 85 THEN 20
      WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
            COUNT(DISTINCT adr.record_date) * 100) < 90 THEN 10
      ELSE 5
    END +
    CASE
      WHEN AVG(cqa.quality_percentage) < 60 THEN 50
      WHEN AVG(cqa.quality_percentage) < 70 THEN 40
      WHEN AVG(cqa.quality_percentage) < 80 THEN 20
      ELSE 5
    END
  , 1) as ATTRITION_RISK_SCORE,
  DATEDIFF(NOW(), e.date_of_joining) as tenure_days,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
  e.employment_status,
  NOW() as analysis_timestamp
FROM mas_hrms.attendance_daily_record adr
JOIN mas_hrms.employees e ON adr.employee_id = e.id
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
WHERE adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
  AND e.employment_status = 'Active'
  AND e.active_status = 1
GROUP BY e.id
HAVING (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
        COUNT(DISTINCT adr.record_date) * 100) < 90
  OR AVG(cqa.quality_percentage) < 70
ORDER BY ATTRITION_RISK_SCORE DESC, e.employee_code;


-- =====================================================================
-- QUERY SET 3: COMPOUND RISK PROFILE (MULTI-FACTOR ANALYSIS)
-- =====================================================================
-- Objective: Identify agents with multiple concurrent risk factors
-- Factors: degrading quality + increasing absence + low tenure + high team load
-- Output: Prioritized intervention list

WITH agent_risk_factors AS (
  SELECT
    e.id,
    e.employee_code,
    CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
    -- Tenure factor
    DATEDIFF(NOW(), e.date_of_joining) as tenure_days,
    ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
    CASE
      WHEN DATEDIFF(NOW(), e.date_of_joining) < 90 THEN 'Onboarding (< 3mo)'
      WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN 'Ramp (3-6mo)'
      WHEN DATEDIFF(NOW(), e.date_of_joining) < 365 THEN 'Early Career (6-12mo)'
      ELSE 'Established (> 12mo)'
    END as experience_level,

    -- Team size (span of control)
    (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e2
     WHERE e2.reporting_manager_id = e.reporting_manager_id
     AND e2.active_status = 1) as team_size,

    -- Quality metrics (last 60 days)
    ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
    COUNT(DISTINCT cqa.id) as call_audits_count,
    ROUND(STDDEV(cqa.quality_percentage), 2) as quality_volatility,
    ROUND(MIN(cqa.quality_percentage), 1) as worst_call_quality,

    -- Attendance metrics (last 60 days)
    COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) as present_days,
    COUNT(DISTINCT adr.record_date) as total_attendance_days,
    ROUND((COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
           NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100), 2) as attendance_pct,
    COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.record_date END) as absent_count,

    -- Process and designation
    d.designation_name,
    p.process_name,
    bm.branch_name

  FROM mas_hrms.employees e
  LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
  LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
  LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
  LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
    AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
  LEFT JOIN mas_hrms.attendance_daily_record adr ON e.id = adr.employee_id
    AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
  WHERE e.employment_status = 'Active'
    AND e.active_status = 1
  GROUP BY e.id
)
SELECT
  'COMPOUND_RISK_PROFILE' as analysis_type,
  employee_code as RISK_AGENT,
  agent_name,
  designation_name,
  process_name,
  branch_name,
  tenure_months,
  experience_level,
  team_size,
  CASE
    WHEN team_size <= 5 THEN 'Lean'
    WHEN team_size <= 10 THEN 'Optimal'
    WHEN team_size <= 15 THEN 'Stretched'
    ELSE 'Overloaded'
  END as team_load_level,
  avg_quality,
  call_audits_count,
  quality_volatility,
  worst_call_quality,
  attendance_pct,
  absent_count,
  present_days,
  total_attendance_days,
  -- Risk scoring logic
  CASE
    WHEN avg_quality < 65 AND attendance_pct < 80 AND tenure_months < 6 AND team_size > 12 THEN 'CRITICAL'
    WHEN avg_quality < 70 AND quality_volatility > 15 THEN 'HIGH'
    WHEN (avg_quality < 75 AND tenure_months < 6) OR (attendance_pct < 85 AND avg_quality < 75) THEN 'MEDIUM'
    ELSE 'LOW'
  END as risk_level,
  -- Composite ATTRITION_RISK_SCORE (0-100)
  ROUND(
    CASE
      WHEN avg_quality < 60 THEN 40
      WHEN avg_quality < 70 THEN 30
      WHEN avg_quality < 75 THEN 15
      ELSE 5
    END +
    CASE
      WHEN attendance_pct < 75 THEN 30
      WHEN attendance_pct < 85 THEN 20
      WHEN attendance_pct < 90 THEN 10
      ELSE 5
    END +
    CASE
      WHEN tenure_months < 3 THEN 15
      WHEN tenure_months < 6 THEN 10
      ELSE 0
    END +
    CASE
      WHEN team_size > 15 THEN 10
      WHEN team_size > 12 THEN 5
      ELSE 0
    END +
    CASE
      WHEN quality_volatility > 20 THEN 10
      WHEN quality_volatility > 15 THEN 5
      ELSE 0
    END
  , 1) as ATTRITION_RISK_SCORE,

  -- DEGRADATION_RATE as combined metric
  ROUND((100 - attendance_pct) + COALESCE((SELECT
    ABS(ROUND(AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
      OVER (PARTITION BY cqa.User ORDER BY WEEK(cqa.CallDate, 1)), 2))
    FROM db_audit.call_quality_assessment cqa
    WHERE cqa.User = employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    LIMIT 1), 0), 2) as DEGRADATION_RATE,

  CASE
    WHEN avg_quality < 65 AND attendance_pct < 80 AND tenure_months < 6 AND team_size > 12 THEN 'Immediate: Coaching, mentorship, workload reduction'
    WHEN avg_quality < 70 AND quality_volatility > 15 THEN 'High Priority: Stability support, performance plan'
    WHEN (avg_quality < 75 AND tenure_months < 6) OR (attendance_pct < 85 AND avg_quality < 75) THEN 'Medium Priority: Enhanced monitoring, accelerated ramp'
    ELSE 'Routine monitoring'
  END as INTERVENTION_PRIORITY,

  NOW() as analysis_timestamp
FROM agent_risk_factors
WHERE call_audits_count >= 5  -- At least 5 audited calls
ORDER BY ATTRITION_RISK_SCORE DESC, avg_quality ASC
LIMIT 100;


-- =====================================================================
-- QUERY SET 4: TREND ANALYSIS - QUALITY CHANGE VELOCITY
-- =====================================================================
-- Objective: Detect rapid deterioration (velocity of decline)
-- Finding: Week-over-week declining trend = higher attrition risk than absolute low performers

WITH weekly_quality AS (
  SELECT
    e.employee_code,
    e.first_name,
    e.last_name,
    YEAR(cqa.CallDate) as year_num,
    WEEK(cqa.CallDate, 1) as week_num,
    COUNT(*) as call_count,
    ROUND(AVG(cqa.quality_percentage), 2) as weekly_quality,
    ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1) DESC) as recency_rank
  FROM db_audit.call_quality_assessment cqa
  JOIN mas_hrms.employees e ON cqa.User = e.employee_code
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 120 DAY)
    AND e.employment_status = 'Active'
    AND e.active_status = 1
    AND cqa.quality_percentage IS NOT NULL
  GROUP BY e.id, YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)
  HAVING call_count >= 3
)
SELECT
  'QUALITY_VELOCITY' as analysis_type,
  wq_current.employee_code as RISK_AGENT,
  CONCAT(wq_current.first_name, ' ', COALESCE(wq_current.last_name, '')) as agent_name,
  wq_current.weekly_quality as current_week_quality,
  wq_prev1.weekly_quality as week_1_ago,
  wq_prev2.weekly_quality as week_2_ago,
  wq_prev3.weekly_quality as week_3_ago,
  ROUND(wq_current.weekly_quality - wq_prev1.weekly_quality, 2) as delta_week_1,
  ROUND(wq_current.weekly_quality - wq_prev2.weekly_quality, 2) as delta_week_2,
  ROUND(wq_current.weekly_quality - wq_prev3.weekly_quality, 2) as delta_week_3,
  ROUND((wq_current.weekly_quality - wq_prev1.weekly_quality +
         wq_prev1.weekly_quality - wq_prev2.weekly_quality +
         wq_prev2.weekly_quality - wq_prev3.weekly_quality) / 3, 2) as avg_degradation_rate,
  CASE
    WHEN (wq_current.weekly_quality - wq_prev1.weekly_quality < -15 OR
          wq_prev1.weekly_quality - wq_prev2.weekly_quality < -15) THEN 'RAPID_DECLINE'
    WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
           wq_prev1.weekly_quality - wq_prev2.weekly_quality +
           wq_prev2.weekly_quality - wq_prev3.weekly_quality) / 3) < -8 THEN 'SUSTAINED_DECLINE'
    WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
           wq_prev1.weekly_quality - wq_prev2.weekly_quality) / 2) < -5 THEN 'RECENT_DECLINE'
    ELSE 'STABLE'
  END as trend_pattern,
  CASE
    WHEN (wq_current.weekly_quality - wq_prev1.weekly_quality < -15 OR
          wq_prev1.weekly_quality - wq_prev2.weekly_quality < -15) THEN 80
    WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
           wq_prev1.weekly_quality - wq_prev2.weekly_quality +
           wq_prev2.weekly_quality - wq_prev3.weekly_quality) / 3) < -8 THEN 65
    WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
           wq_prev1.weekly_quality - wq_prev2.weekly_quality) / 2) < -5 THEN 50
    ELSE 20
  END as DEGRADATION_RATE,
  CASE
    WHEN (wq_current.weekly_quality - wq_prev1.weekly_quality < -15 OR
          wq_prev1.weekly_quality - wq_prev2.weekly_quality < -15) THEN 'CRITICAL'
    WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
           wq_prev1.weekly_quality - wq_prev2.weekly_quality +
           wq_prev2.weekly_quality - wq_prev3.weekly_quality) / 3) < -8 THEN 'HIGH_PRIORITY'
    WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
           wq_prev1.weekly_quality - wq_prev2.weekly_quality) / 2) < -5 THEN 'MEDIUM_PRIORITY'
    ELSE 'ROUTINE'
  END as INTERVENTION_PRIORITY,
  NOW() as analysis_timestamp
FROM weekly_quality wq_current
LEFT JOIN weekly_quality wq_prev1 ON wq_current.employee_code = wq_prev1.employee_code
  AND wq_prev1.recency_rank = 2
LEFT JOIN weekly_quality wq_prev2 ON wq_current.employee_code = wq_prev2.employee_code
  AND wq_prev2.recency_rank = 3
LEFT JOIN weekly_quality wq_prev3 ON wq_current.employee_code = wq_prev3.employee_code
  AND wq_prev3.recency_rank = 4
WHERE wq_current.recency_rank = 1
  AND (wq_prev1.weekly_quality IS NOT NULL OR wq_prev2.weekly_quality IS NOT NULL)
ORDER BY DEGRADATION_RATE DESC, current_week_quality ASC;


-- =====================================================================
-- QUERY SET 5: EARLY WARNING INDICATORS
-- =====================================================================
-- Objective: Predictive indicators before attrition (leading indicators)
-- Patterns: Increased absenteeism, decreased engagement (lower audit count), mood swings in quality

SELECT
  'EARLY_WARNING' as analysis_type,
  e.employee_code as RISK_AGENT,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
  d.designation_name,
  p.process_name,
  bm.branch_name,

  -- Recent 30-day absence trend
  (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
   WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
   AND adr.attendance_status = 'absent') as recent_absent_30d,

  -- Previous 30-day absence
  (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
   WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
   AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
   AND adr.attendance_status = 'absent') as prior_absent_30d,

  -- Quality audit frequency (engagement indicator)
  (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
   WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as recent_audit_count,

  (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
   WHERE cqa.User = e.employee_code AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY)
   AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) as prior_audit_count,

  -- Quality volatility (mood indicator)
  ROUND((SELECT STDDEV(cqa.quality_percentage) FROM db_audit.call_quality_assessment cqa
   WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 2) as recent_quality_volatility,

  DATEDIFF(NOW(), e.date_of_joining) as tenure_days,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,

  -- Composite early warning score
  ROUND(
    CASE
      WHEN (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
            WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND adr.attendance_status = 'absent') >
           (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
            WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
            AND adr.attendance_status = 'absent') + 2 THEN 30
      ELSE 10
    END +
    CASE
      WHEN (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
            WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) <
           (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
            WHERE cqa.User = e.employee_code AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) * 0.7 THEN 25
      ELSE 5
    END +
    CASE
      WHEN (SELECT STDDEV(cqa.quality_percentage) FROM db_audit.call_quality_assessment cqa
            WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) > 20 THEN 20
      WHEN (SELECT STDDEV(cqa.quality_percentage) FROM db_audit.call_quality_assessment cqa
            WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) > 15 THEN 15
      ELSE 0
    END
  , 1) as ATTRITION_RISK_SCORE,

  CASE
    WHEN (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
          WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND adr.attendance_status = 'absent') >
         (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
          WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
          AND adr.attendance_status = 'absent') + 2
    AND (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
         WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) <
        (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
         WHERE cqa.User = e.employee_code AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) * 0.7 THEN 'CRITICAL'
    WHEN (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
          WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND adr.attendance_status = 'absent') >
         (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
          WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
          AND adr.attendance_status = 'absent') + 1 THEN 'HIGH_PRIORITY'
    ELSE 'MEDIUM_PRIORITY'
  END as INTERVENTION_PRIORITY,

  'Review absence spike + engagement metrics for workload/burnout' as recommended_action,
  NOW() as analysis_timestamp
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
WHERE e.employment_status = 'Active'
  AND e.active_status = 1
  AND (SELECT COUNT(DISTINCT record_date) FROM mas_hrms.attendance_daily_record adr
       WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)) >= 20
ORDER BY ATTRITION_RISK_SCORE DESC
LIMIT 50;


-- =====================================================================
-- SUMMARY REPORT: HIGH-RISK AGENTS ACROSS ALL ANALYSES
-- =====================================================================
-- Objective: Consolidated view of all high-risk agents with all relevant metrics

SELECT
  'CONSOLIDATED_RISK_REPORT' as report_type,
  e.employee_code as RISK_AGENT,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
  d.designation_name,
  p.process_name,
  bm.branch_name,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
  -- Quality metrics
  ROUND(AVG(cqa.quality_percentage), 2) as current_quality_score,
  COUNT(DISTINCT cqa.id) as total_audits_90d,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_volatility,
  -- Attendance metrics
  ROUND((COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
         NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100), 2) as attendance_pct,
  COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.record_date END) as absent_days_60d,
  -- Team metrics
  (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e2
   WHERE e2.reporting_manager_id = e.reporting_manager_id
   AND e2.active_status = 1) as team_size,
  -- Composite risk score
  ROUND(
    CASE WHEN AVG(cqa.quality_percentage) < 60 THEN 40 ELSE 5 END +
    CASE WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
              NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 85 THEN 25 ELSE 5 END +
    CASE WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN 15 ELSE 0 END +
    CASE WHEN (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e2
              WHERE e2.reporting_manager_id = e.reporting_manager_id
              AND e2.active_status = 1) > 15 THEN 10 ELSE 0 END
  , 1) as ATTRITION_RISK_SCORE,

  -- Degradation metric
  CASE
    WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH'
    WHEN AVG(cqa.quality_percentage) < 80 THEN 'MEDIUM'
    ELSE 'LOW'
  END as DEGRADATION_RATE,

  CASE
    WHEN AVG(cqa.quality_percentage) < 60 AND (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
         NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 85 THEN 'CRITICAL - Immediate intervention required'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH_PRIORITY - Enhanced monitoring & support'
    WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
          NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 85 THEN 'MEDIUM_PRIORITY - Attendance follow-up'
    ELSE 'ROUTINE - Standard monitoring'
  END as INTERVENTION_PRIORITY,

  NOW() as report_timestamp
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
LEFT JOIN mas_hrms.attendance_daily_record adr ON e.id = adr.employee_id
  AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
WHERE e.employment_status = 'Active'
  AND e.active_status = 1
GROUP BY e.id
HAVING COUNT(DISTINCT cqa.id) >= 5 AND COUNT(DISTINCT adr.record_date) >= 20
  AND (AVG(cqa.quality_percentage) < 75 OR (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
       NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 90)
ORDER BY ATTRITION_RISK_SCORE DESC
LIMIT 100;
