/**
 * Cost Efficiency Analysis: Salary vs Quality Performance
 * Database: mas_hrms (+ optional db_audit for call_quality_assessment)
 * Timeframe: Last 30-90 days (configurable)
 * Purpose: Calculate cost per call, cost per quality point, process-level ROI
 *
 * Execution:
 *   mysql -h localhost -u root -p mas_hrms < cost-efficiency-analysis.sql
 *
 * or via direct connection if running in Docker/local environment.
 */

-- =====================================================================
-- QUERY 1: AGENT-LEVEL COST EFFICIENCY
-- =====================================================================
-- Objective: Cost per quality point by agent, ranked from best to worst ROI
-- Output: Agent code, name, salary, calls handled, avg quality, cost metrics
-- Risk Drivers: Overpaid for quality delivered; quality/salary mismatch

SELECT
  'AGENT_COST_EFFICIENCY' as analysis_type,
  e.employee_code,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
  COALESCE(spl.gross_salary, 0) as monthly_salary,
  COUNT(DISTINCT CASE
    WHEN cqa.id IS NOT NULL THEN cqa.id
  END) as calls_handled_30d,
  ROUND(AVG(COALESCE(cqa.quality_percentage, 0)), 2) as avg_quality_pct,
  ROUND(COALESCE(spl.gross_salary, 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) as cost_per_call,
  ROUND(COALESCE(spl.gross_salary, 0) / NULLIF(AVG(cqa.quality_percentage), 0), 2) as cost_per_quality_point,
  ROUND(COALESCE(spl.gross_salary, 0), 2) as payroll_investment,
  CASE
    WHEN COUNT(DISTINCT cqa.id) = 0 THEN 'NO_CALL_DATA'
    WHEN AVG(cqa.quality_percentage) >= 85 THEN 'HIGH_ROI'
    WHEN AVG(cqa.quality_percentage) >= 75 THEN 'GOOD_ROI'
    WHEN AVG(cqa.quality_percentage) >= 65 THEN 'MEDIUM_ROI'
    ELSE 'LOW_ROI'
  END as efficiency_rating,
  ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
  e.employment_status,
  NOW() as run_timestamp
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.salary_prep_line spl
  ON spl.employee_id = e.id
  AND spl.status = 'processed'
  AND spl.month = MONTH(NOW())
  AND spl.year = YEAR(NOW())
LEFT JOIN db_audit.call_quality_assessment cqa
  ON cqa.User = e.employee_code
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE e.active_status = 1
  AND e.employment_status = 'Active'
GROUP BY e.id, spl.id
HAVING calls_handled_30d >= 5 OR spl.gross_salary > 0
ORDER BY cost_per_quality_point ASC, avg_quality_pct DESC
LIMIT 100;


-- =====================================================================
-- QUERY 2: PROCESS/CAMPAIGN-LEVEL ROI ANALYSIS
-- =====================================================================
-- Objective: Identify which process delivers best quality per rupee spent
-- Output: Process name, call volume, avg quality, total payroll, cost metrics
-- Strategy: Allocate budget to high-ROI processes, identify low-ROI candidates for optimization

SELECT
  'PROCESS_COST_ROI' as analysis_type,
  cqa.Campaign as process_name,
  COUNT(DISTINCT cqa.id) as total_calls_30d,
  COUNT(DISTINCT cqa.User) as agent_count,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_process_quality,
  ROUND(MIN(cqa.quality_percentage), 1) as worst_call_quality,
  ROUND(MAX(cqa.quality_percentage), 1) as best_call_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_consistency,
  COALESCE(ROUND(SUM(spl.gross_salary), 2), 0) as total_process_payroll,
  ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) as cost_per_call,
  ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(AVG(cqa.quality_percentage), 0), 2) as cost_per_quality_point,
  ROUND(COUNT(DISTINCT cqa.id) / NULLIF(COUNT(DISTINCT cqa.User), 0), 1) as calls_per_agent_per_day,
  CASE
    WHEN AVG(cqa.quality_percentage) >= 80 THEN 1
    WHEN AVG(cqa.quality_percentage) >= 70 THEN 2
    WHEN AVG(cqa.quality_percentage) >= 60 THEN 3
    ELSE 4
  END as quality_tier,
  CASE
    WHEN ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) < 50 THEN 1
    WHEN ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) < 100 THEN 2
    ELSE 3
  END as cost_tier,
  CASE
    WHEN AVG(cqa.quality_percentage) >= 80 AND ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) < 80 THEN 'PREMIUM_ROI'
    WHEN AVG(cqa.quality_percentage) >= 75 THEN 'GOOD_ROI'
    WHEN AVG(cqa.quality_percentage) >= 65 THEN 'ACCEPTABLE_ROI'
    ELSE 'POOR_ROI'
  END as roi_classification,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
LEFT JOIN mas_hrms.employees e ON cqa.User = e.employee_code
LEFT JOIN mas_hrms.salary_prep_line spl
  ON spl.employee_id = e.id
  AND spl.status = 'processed'
  AND spl.month = MONTH(NOW())
  AND spl.year = YEAR(NOW())
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY cqa.Campaign
ORDER BY cost_per_quality_point ASC, avg_process_quality DESC
LIMIT 50;


-- =====================================================================
-- QUERY 3: COST EFFICIENCY OPPORTUNITIES (Top 20 Savings)
-- =====================================================================
-- Objective: Identify low-hanging fruit—agents/processes with high cost, low quality
-- Output: Ranked opportunities with estimated savings potential

WITH efficiency_ranked AS (
  SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
    spl.gross_salary,
    COUNT(DISTINCT cqa.id) as call_count,
    ROUND(AVG(cqa.quality_percentage), 1) as quality_score,
    ROUND(spl.gross_salary / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) as cost_per_call,
    ROW_NUMBER() OVER (
      ORDER BY (spl.gross_salary / NULLIF(AVG(cqa.quality_percentage), 0)) DESC
    ) as efficiency_rank,
    CASE
      WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL'
      WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH'
      WHEN AVG(cqa.quality_percentage) < 75 THEN 'MEDIUM'
      ELSE 'LOW'
    END as intervention_priority
  FROM mas_hrms.employees e
  LEFT JOIN mas_hrms.salary_prep_line spl
    ON spl.employee_id = e.id
    AND spl.status = 'processed'
    AND spl.month = MONTH(NOW())
  LEFT JOIN db_audit.call_quality_assessment cqa
    ON cqa.User = e.employee_code
    AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  WHERE e.active_status = 1
    AND e.employment_status = 'Active'
    AND spl.gross_salary > 0
  GROUP BY e.id, spl.id
  HAVING call_count >= 10
)
SELECT
  'SAVINGS_OPPORTUNITY' as opportunity_type,
  efficiency_rank,
  agent_name,
  employee_code,
  ROUND(gross_salary, 2) as monthly_salary,
  call_count,
  quality_score,
  cost_per_call,
  intervention_priority,
  CASE
    WHEN quality_score < 60 AND cost_per_call > 150 THEN ROUND(gross_salary * 0.30, 2)
    WHEN quality_score < 70 AND cost_per_call > 120 THEN ROUND(gross_salary * 0.15, 2)
    WHEN quality_score < 75 AND cost_per_call > 100 THEN ROUND(gross_salary * 0.10, 2)
    ELSE 0
  END as potential_monthly_savings,
  CASE
    WHEN quality_score < 60 THEN 'Reskill or replace'
    WHEN quality_score < 70 THEN 'Targeted coaching'
    WHEN quality_score < 75 THEN 'Performance plan'
    ELSE 'Monitor'
  END as recommended_action,
  NOW() as run_timestamp
FROM efficiency_ranked
WHERE efficiency_rank <= 20 AND potential_monthly_savings > 0
ORDER BY potential_monthly_savings DESC;


-- =====================================================================
-- QUERY 4: PAYROLL vs QUALITY SCATTER (All Active Agents)
-- =====================================================================
-- Objective: Visual correlation between salary investment and quality outcome
-- Output: Salary quartiles vs quality distribution

WITH salary_quartiles AS (
  SELECT
    e.employee_code,
    CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
    spl.gross_salary,
    ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
    COUNT(DISTINCT cqa.id) as call_count,
    NTILE(4) OVER (ORDER BY spl.gross_salary) as salary_quartile
  FROM mas_hrms.employees e
  LEFT JOIN mas_hrms.salary_prep_line spl
    ON spl.employee_id = e.id
    AND spl.status = 'processed'
    AND spl.month = MONTH(NOW())
  LEFT JOIN db_audit.call_quality_assessment cqa
    ON cqa.User = e.employee_code
    AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  WHERE e.active_status = 1
    AND e.employment_status = 'Active'
  GROUP BY e.id, spl.id
  HAVING call_count >= 5
)
SELECT
  'SALARY_QUALITY_CORRELATION' as analysis_type,
  CASE
    WHEN salary_quartile = 1 THEN 'Q1_Lowest25pct'
    WHEN salary_quartile = 2 THEN 'Q2_Mid_Low'
    WHEN salary_quartile = 3 THEN 'Q3_Mid_High'
    WHEN salary_quartile = 4 THEN 'Q4_Highest25pct'
  END as salary_bracket,
  ROUND(MIN(gross_salary), 2) as salary_min,
  ROUND(MAX(gross_salary), 2) as salary_max,
  ROUND(AVG(gross_salary), 2) as salary_avg,
  COUNT(*) as agent_count,
  ROUND(AVG(avg_quality), 2) as avg_quality_in_bracket,
  ROUND(MIN(avg_quality), 1) as worst_quality,
  ROUND(MAX(avg_quality), 1) as best_quality,
  ROUND(STDDEV(avg_quality), 2) as quality_variance,
  ROUND(COUNT(CASE WHEN avg_quality >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_pct,
  ROUND(COUNT(CASE WHEN avg_quality < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as underperforming_pct,
  NOW() as run_timestamp
FROM salary_quartiles
GROUP BY salary_quartile
ORDER BY salary_quartile ASC;


-- =====================================================================
-- QUERY 5: ANNUAL COST EFFICIENCY FORECAST
-- =====================================================================
-- Objective: Project annual ROI and cost trajectory based on 30-day actuals

SELECT
  'ANNUAL_FORECAST' as forecast_type,
  'Based on Last 30 Days' as data_basis,
  COUNT(DISTINCT e.id) as active_agents,
  ROUND(SUM(spl.gross_salary) * 12, 2) as annual_payroll_at_current_rate,
  ROUND(COUNT(DISTINCT cqa.id) * 12, 0) as projected_annual_calls,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_maintained,
  ROUND((SUM(spl.gross_salary) * 12) / NULLIF(COUNT(DISTINCT cqa.id) * 12, 0), 2) as projected_annual_cost_per_call,
  ROUND((SUM(spl.gross_salary) * 12) / NULLIF(AVG(cqa.quality_percentage) * 12, 0), 2) as projected_annual_cost_per_quality_point,
  CASE
    WHEN AVG(cqa.quality_percentage) >= 80 THEN 'Sustainable Model - Scale Recommended'
    WHEN AVG(cqa.quality_percentage) >= 70 THEN 'Acceptable Model - Optimize Recommended'
    ELSE 'At-Risk Model - Urgent Intervention'
  END as model_health,
  NOW() as run_timestamp
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.salary_prep_line spl
  ON spl.employee_id = e.id
  AND spl.status = 'processed'
  AND spl.month = MONTH(NOW())
LEFT JOIN db_audit.call_quality_assessment cqa
  ON cqa.User = e.employee_code
  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
WHERE e.active_status = 1
  AND e.employment_status = 'Active'
  AND spl.gross_salary > 0;


-- =====================================================================
-- QUERY 6: EXECUTION SCRIPT - Run all analyses in sequence
-- =====================================================================
-- Usage:
--   Option A: Copy entire script into MySQL client (recommended for exploration)
--   Option B: mysql -h HOST -u USER -p DATABASE < cost-efficiency-analysis.sql > results.csv
--   Option C: Schedule as periodic reporting job
--
-- Output Format: Tab-separated for Excel/Tableau import
-- Next Steps: Import results into BI tool, create dashboards, set alerts for poor ROI agents

-- SELECT 'Analysis Complete - Review results above' as status;
