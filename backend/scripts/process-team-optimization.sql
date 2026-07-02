/**
 * Process Quality Ranking & Optimal Team Composition Analysis
 * File: process-team-optimization.sql
 * Purpose: Find best process combinations and optimal team composition
 * Run Against: MySQL databases (mas_hrms + db_audit)
 *
 * Execution:
 *   mysql -h [host] -u [user] -p mas_hrms < process-team-optimization.sql > process-optimization-results.csv
 *
 * Output Format: PROCESS | QUALITY_RANK | VARIANCE | OPTIMAL_SHIFT | FATIGUE_FACTOR
 */

-- =====================================================================
-- QUERY 1: PROCESS QUALITY RANKING (Which process best trained/managed)
-- =====================================================================
-- Objective: Rank processes by quality metrics, manager effectiveness, and consistency
-- Output: Process name, quality rank, team size, variance (stability), min/max quality, complexity estimate
-- Impact: Informs process allocation, team sizing, and resource optimization

SELECT
  'PROCESS_QUALITY_RANKING' as analysis_type,
  cqa.Campaign as process_name,
  RANK() OVER (ORDER BY AVG(cqa.quality_percentage) DESC) as quality_rank,
  COUNT(DISTINCT cqa.User) as unique_agents,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_score,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance,
  ROUND(MIN(cqa.quality_percentage), 1) as min_quality,
  ROUND(MAX(cqa.quality_percentage), 1) as max_quality,
  COUNT(*) as total_calls,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 85 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as good_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) * 100.0 / COUNT(*), 1) as critical_rate_pct,
  CASE
    WHEN AVG(cqa.quality_percentage) >= 85 THEN 'ELITE'
    WHEN AVG(cqa.quality_percentage) >= 80 THEN 'HIGH'
    WHEN AVG(cqa.quality_percentage) >= 75 THEN 'MEDIUM'
    WHEN AVG(cqa.quality_percentage) >= 70 THEN 'DEVELOPING'
    ELSE 'AT_RISK'
  END as process_tier,
  CASE
    WHEN STDDEV(cqa.quality_percentage) < 8 THEN 'STABLE'
    WHEN STDDEV(cqa.quality_percentage) < 12 THEN 'MODERATE'
    ELSE 'VOLATILE'
  END as consistency_rating,
  ROUND(MIN(cqa.CallDate), 0) as data_start_date,
  ROUND(MAX(cqa.CallDate), 0) as data_end_date,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
  AND cqa.Campaign IS NOT NULL
  AND cqa.Campaign != ''
GROUP BY cqa.Campaign
ORDER BY quality_rank ASC;


-- =====================================================================
-- QUERY 2: DAY-OF-WEEK & HOUR FATIGUE CYCLE ANALYSIS
-- =====================================================================
-- Objective: Identify weekly fatigue patterns and hour-of-day quality degradation
-- Finding: Expected pattern - Friday fatigue, lunch valley, end-of-shift decline
-- Impact: Informs shift rotation, break scheduling, and workload distribution

SELECT
  'FATIGUE_CYCLE_ANALYSIS' as analysis_type,
  DAYNAME(cqa.CallDate) as day_of_week,
  HOUR(cqa.CallDate) as hour_of_day,
  ROUND(DATEDIFF(DATE(cqa.CallDate), DATE_ADD(DATE(cqa.CallDate), INTERVAL -DAYOFWEEK(cqa.CallDate) + 2 DAY)) + 1) as day_in_week,
  COUNT(*) as call_volume,
  COUNT(DISTINCT cqa.User) as unique_agents,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance,
  ROUND(MIN(cqa.quality_percentage), 1) as lowest_quality,
  ROUND(MAX(cqa.quality_percentage), 1) as highest_quality,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as good_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 11 THEN 'Morning Peak'
    WHEN HOUR(cqa.CallDate) BETWEEN 12 AND 13 THEN 'Lunch Valley'
    WHEN HOUR(cqa.CallDate) BETWEEN 14 AND 17 THEN 'Afternoon Peak'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 20 THEN 'Evening'
    ELSE 'Off-Peak'
  END as shift_phase,
  CASE
    WHEN DAYNAME(cqa.CallDate) IN ('Saturday', 'Sunday') THEN 'High Fatigue'
    WHEN DAYNAME(cqa.CallDate) = 'Friday' THEN 'Elevated Fatigue'
    WHEN DAYNAME(cqa.CallDate) = 'Monday' THEN 'Post-Rest'
    ELSE 'Standard'
  END as fatigue_level,
  CASE
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'ACTION_REQUIRED'
    WHEN AVG(cqa.quality_percentage) < 75 THEN 'MONITOR'
    ELSE 'ACCEPTABLE'
  END as quality_status,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY
  DAYNAME(cqa.CallDate),
  HOUR(cqa.CallDate)
ORDER BY
  FIELD(DAYNAME(cqa.CallDate), 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
  HOUR(cqa.CallDate) ASC;


-- =====================================================================
-- QUERY 3: SHIFT TIMING OPTIMIZATION (Peak performance windows)
-- =====================================================================
-- Objective: Identify optimal shift timing, agent productivity windows, and peak performance slots
-- Finding: Best times for difficult tasks, best times for high-volume work, recovery periods
-- Impact: Informs shift design, task routing, and call allocation strategy

SELECT
  'SHIFT_TIMING_OPTIMIZATION' as analysis_type,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning (8-12)'
    WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon (13-17)'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening (18-22)'
    WHEN HOUR(cqa.CallDate) IN (0, 1, 2, 3, 4, 5, 6, 7) THEN 'Night (0-7)'
    ELSE 'Off-Peak (23)'
  END as shift_window,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 1
    WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 2
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 3
    WHEN HOUR(cqa.CallDate) IN (0, 1, 2, 3, 4, 5, 6, 7) THEN 4
    ELSE 5
  END as shift_sequence,
  AVG(HOUR(cqa.CallDate)) as avg_hour,
  ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as quality_variance,
  COUNT(*) as total_calls,
  COUNT(DISTINCT cqa.User) as unique_agents,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 85 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as good_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) * 100.0 / COUNT(*), 1) as critical_failure_pct,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 9 AND 11 THEN 'PRIMARY_PEAK'
    WHEN HOUR(cqa.CallDate) BETWEEN 14 AND 16 THEN 'SECONDARY_PEAK'
    WHEN HOUR(cqa.CallDate) IN (8, 17, 18) THEN 'RAMP'
    WHEN HOUR(cqa.CallDate) IN (12, 13) THEN 'RECOVERY'
    ELSE 'LOW_ACTIVITY'
  END as shift_classification,
  CASE
    WHEN AVG(cqa.quality_percentage) >= 82 THEN 'OPTIMAL_FOR_COMPLEX_WORK'
    WHEN AVG(cqa.quality_percentage) >= 78 THEN 'SUITABLE_FOR_MIXED_WORK'
    WHEN AVG(cqa.quality_percentage) >= 70 THEN 'ACCEPTABLE_ROUTINE_ONLY'
    ELSE 'RESTRICTED_WORKLOAD'
  END as recommended_workload,
  ROUND(MIN(cqa.quality_percentage), 1) as min_quality,
  ROUND(MAX(cqa.quality_percentage), 1) as max_quality,
  MIN(cqa.CallDate) as data_start,
  MAX(cqa.CallDate) as data_end,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
GROUP BY shift_sequence
ORDER BY shift_sequence ASC;


-- =====================================================================
-- QUERY 4: PROCESS + SHIFT COMBINATION MATRIX (Best combinations)
-- =====================================================================
-- Objective: Identify which process-shift combinations perform best
-- Finding: Some processes excel in specific shifts; match teams accordingly
-- Output: Process | Shift | Quality | Stability | Recommendation

SELECT
  'PROCESS_SHIFT_MATRIX' as analysis_type,
  cqa.Campaign as process_name,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
    WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
    ELSE 'Night'
  END as shift,
  RANK() OVER (
    PARTITION BY cqa.Campaign
    ORDER BY AVG(cqa.quality_percentage) DESC
  ) as shift_rank_in_process,
  ROUND(AVG(cqa.quality_percentage), 2) as process_shift_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as process_shift_variance,
  COUNT(*) as call_volume,
  COUNT(DISTINCT cqa.User) as agent_count,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as good_rate_pct,
  ROUND(COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as poor_rate_pct,
  CASE
    WHEN AVG(cqa.quality_percentage) >= 82 AND STDDEV(cqa.quality_percentage) < 10 THEN 'PRIMARY_ALLOCATION'
    WHEN AVG(cqa.quality_percentage) >= 78 AND STDDEV(cqa.quality_percentage) < 12 THEN 'SECONDARY_ALLOCATION'
    WHEN AVG(cqa.quality_percentage) >= 75 THEN 'TERTIARY_ALLOCATION'
    ELSE 'AVOID'
  END as allocation_priority,
  MIN(cqa.CallDate) as period_start,
  MAX(cqa.CallDate) as period_end,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
  AND cqa.Campaign IS NOT NULL
GROUP BY
  cqa.Campaign,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
    WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
    ELSE 'Night'
  END
ORDER BY
  process_name,
  process_shift_quality DESC;


-- =====================================================================
-- QUERY 5: TEAM COMPOSITION OPTIMIZATION
-- =====================================================================
-- Objective: Analyze team size, manager span of control, and quality correlation
-- Finding: Optimal team sizes, quality impact of team load distribution
-- Output: Process | Shift | Recommended_Team_Size | Quality_Impact | Stability

SELECT
  'TEAM_COMPOSITION_ANALYSIS' as analysis_type,
  cqa.Campaign as process_name,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
    WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
    ELSE 'Night'
  END as shift,
  COUNT(DISTINCT cqa.User) as current_team_size,
  ROUND(AVG(cqa.quality_percentage), 2) as current_avg_quality,
  ROUND(STDDEV(cqa.quality_percentage), 2) as current_variance,
  ROUND(COUNT(*) / COUNT(DISTINCT cqa.User), 1) as avg_calls_per_agent,
  CASE
    WHEN COUNT(DISTINCT cqa.User) <= 5 THEN 'LEAN'
    WHEN COUNT(DISTINCT cqa.User) <= 10 THEN 'OPTIMAL'
    WHEN COUNT(DISTINCT cqa.User) <= 15 THEN 'STRETCHED'
    ELSE 'OVER_EXTENDED'
  END as current_team_load_status,
  CASE
    WHEN AVG(cqa.quality_percentage) >= 82 AND COUNT(DISTINCT cqa.User) <= 8 THEN 'MAINTAIN_SIZE'
    WHEN AVG(cqa.quality_percentage) >= 78 AND COUNT(DISTINCT cqa.User) <= 10 THEN 'MAINTAIN_SIZE'
    WHEN AVG(cqa.quality_percentage) < 75 AND COUNT(DISTINCT cqa.User) > 12 THEN 'REDUCE_BY_2'
    WHEN AVG(cqa.quality_percentage) < 70 THEN 'RESTRUCTURE'
    ELSE 'MONITOR'
  END as team_composition_recommendation,
  ROUND((82.0 - AVG(cqa.quality_percentage)) / 82.0 * 100, 1) as quality_gap_to_elite_pct,
  ROUND(MIN(cqa.quality_percentage), 1) as worst_performer_quality,
  ROUND(MAX(cqa.quality_percentage), 1) as best_performer_quality,
  COUNT(*) as call_sample_size,
  NOW() as run_timestamp
FROM db_audit.call_quality_assessment cqa
WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND cqa.quality_percentage IS NOT NULL
  AND cqa.Campaign IS NOT NULL
GROUP BY
  cqa.Campaign,
  CASE
    WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
    WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
    WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
    ELSE 'Night'
  END
ORDER BY
  process_name,
  current_avg_quality DESC;


-- =====================================================================
-- SUMMARY: CONSOLIDATED OPTIMIZATION SCORECARD
-- =====================================================================
-- Purpose: Single-view dashboard of best process + shift + team combinations
-- Output Columns: PROCESS | QUALITY_RANK | VARIANCE | OPTIMAL_SHIFT | FATIGUE_FACTOR

WITH process_scores AS (
  SELECT
    cqa.Campaign as process_name,
    ROUND(AVG(cqa.quality_percentage), 2) as overall_quality,
    ROUND(STDDEV(cqa.quality_percentage), 2) as overall_variance,
    RANK() OVER (ORDER BY AVG(cqa.quality_percentage) DESC) as quality_rank,
    COUNT(DISTINCT cqa.User) as total_agents,
    COUNT(*) as total_calls,
    MIN(cqa.CallDate) as data_start,
    MAX(cqa.CallDate) as data_end
  FROM db_audit.call_quality_assessment cqa
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND cqa.quality_percentage IS NOT NULL
    AND cqa.Campaign IS NOT NULL
  GROUP BY cqa.Campaign
),
shift_scores AS (
  SELECT
    cqa.Campaign as process_name,
    CASE
      WHEN HOUR(cqa.CallDate) BETWEEN 8 AND 12 THEN 'Morning'
      WHEN HOUR(cqa.CallDate) BETWEEN 13 AND 17 THEN 'Afternoon'
      WHEN HOUR(cqa.CallDate) BETWEEN 18 AND 22 THEN 'Evening'
      ELSE 'Night'
    END as shift,
    ROUND(AVG(cqa.quality_percentage), 2) as shift_quality,
    RANK() OVER (
      PARTITION BY cqa.Campaign
      ORDER BY AVG(cqa.quality_percentage) DESC
    ) as shift_rank
  FROM db_audit.call_quality_assessment cqa
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND cqa.quality_percentage IS NOT NULL
    AND cqa.Campaign IS NOT NULL
  GROUP BY cqa.Campaign, shift
),
fatigue_scores AS (
  SELECT
    cqa.Campaign as process_name,
    DAYNAME(cqa.CallDate) as day_name,
    ROUND(AVG(cqa.quality_percentage), 2) as day_quality,
    CASE
      WHEN DAYNAME(cqa.CallDate) IN ('Saturday', 'Sunday') THEN 3
      WHEN DAYNAME(cqa.CallDate) = 'Friday' THEN 2
      ELSE 1
    END as fatigue_factor
  FROM db_audit.call_quality_assessment cqa
  WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND cqa.quality_percentage IS NOT NULL
    AND cqa.Campaign IS NOT NULL
  GROUP BY cqa.Campaign, DAYNAME(cqa.CallDate)
)
SELECT
  'OPTIMIZATION_SCORECARD' as report_type,
  ps.process_name as PROCESS,
  ps.quality_rank as QUALITY_RANK,
  ps.overall_quality as AVG_QUALITY,
  ps.overall_variance as VARIANCE,
  CASE
    WHEN ps.overall_variance < 8 THEN 'STABLE'
    WHEN ps.overall_variance < 12 THEN 'MODERATE'
    ELSE 'VOLATILE'
  END as VARIANCE_CLASSIFICATION,
  COALESCE(ss.shift, 'N/A') as OPTIMAL_SHIFT,
  COALESCE(ss.shift_quality, 0) as OPTIMAL_SHIFT_QUALITY,
  ps.total_agents as TEAM_SIZE,
  ROUND(ps.total_calls / ps.total_agents, 1) as AVG_CALLS_PER_AGENT,
  ROUND(AVG(COALESCE(fs.fatigue_factor, 1)), 1) as FATIGUE_FACTOR,
  ps.total_calls as CALL_SAMPLE,
  CASE
    WHEN ps.quality_rank <= 3 AND ps.overall_variance < 10 THEN 'TIER_1_ELITE'
    WHEN ps.quality_rank <= 5 AND ps.overall_variance < 12 THEN 'TIER_2_HIGH'
    WHEN ps.overall_quality >= 78 THEN 'TIER_3_GOOD'
    WHEN ps.overall_quality >= 75 THEN 'TIER_4_DEVELOPING'
    ELSE 'TIER_5_AT_RISK'
  END as PROCESS_TIER,
  CASE
    WHEN ps.quality_rank <= 3 THEN 'EXPAND_ALLOCATION'
    WHEN ps.overall_quality < 70 THEN 'RESTRICT_ALLOCATION'
    ELSE 'MAINTAIN_ALLOCATION'
  END as STRATEGIC_RECOMMENDATION,
  DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') as report_generated_at
FROM process_scores ps
LEFT JOIN (
  SELECT DISTINCT ON (process_name)
    process_name,
    shift,
    shift_quality
  FROM shift_scores
  WHERE shift_rank = 1
) ss ON ps.process_name = ss.process_name
LEFT JOIN fatigue_scores fs ON ps.process_name = fs.process_name
GROUP BY
  ps.process_name,
  ps.overall_quality,
  ps.overall_variance,
  ps.quality_rank,
  ps.total_agents,
  ps.total_calls,
  ss.shift,
  ss.shift_quality
ORDER BY
  ps.quality_rank ASC,
  ps.overall_quality DESC;


-- =====================================================================
-- EXPORT NOTES
-- =====================================================================
-- Usage:
--   Option 1 (Console Output):
--     mysql -h [host] -u [user] -p mas_hrms < process-team-optimization.sql | tee results.txt
--
--   Option 2 (CSV Export):
--     mysql -h [host] -u [user] -p -e "source process-team-optimization.sql;" mas_hrms > process-optimization-results.csv
--
--   Option 3 (Tab-Separated for Excel):
--     mysql -h [host] -u [user] -p mas_hrms < process-team-optimization.sql -B -e "source process-team-optimization.sql;" > process-optimization-results.tsv
--
-- Output Interpretation:
--   - QUALITY_RANK: 1 = Best, higher = lower quality
--   - VARIANCE: Lower < 8 = STABLE, 8-12 = MODERATE, > 12 = VOLATILE
--   - OPTIMAL_SHIFT: Which shift period shows best quality for process
--   - FATIGUE_FACTOR: 3 = Weekend fatigue, 2 = Friday, 1 = Mid-week (best)
--   - PROCESS_TIER: Classification for resource allocation decisions
--   - STRATEGIC_RECOMMENDATION: Action item for optimization
--
-- Last Updated: 2026-06-21
