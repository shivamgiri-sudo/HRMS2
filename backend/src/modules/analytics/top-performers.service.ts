/**
 * Top Performers Analytics Service
 *
 * Analyzes what makes top 10% agents excel through:
 * 1. 90th percentile quality threshold identification
 * 2. Trait mastery comparison (top 10% vs overall population)
 * 3. Teachability & replication difficulty scoring
 * 4. Detailed excellence profile patterns
 */

import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getCredentialsForKey, getPoolForKey } from '../external-db/external-db.service.js';

interface TraitExcellence {
  trait_name: string;
  trait_label: string;
  top_10_pass_rate: number;
  overall_pass_rate: number;
  excellence_delta: number;
  excellence_category: 'KEY_DIFFERENTIATOR' | 'STRONG_ADVANTAGE' | 'MODERATE_ADVANTAGE' | 'MINOR_ADVANTAGE';
  top_10_sample_size: number;
  overall_sample_size: number;
}

interface TeachabilityMetric {
  trait_name: string;
  trait_code: string;
  avg_pass_rate_pct: number;
  variance_stddev: number;
  total_observations: number;
  success_count: number;
  population_mastery_rate: number;
  teachability_category: 'HIGH_TEACHABILITY' | 'MODERATE_TEACHABILITY' | 'LOW_TEACHABILITY' | 'UNEVEN_MASTERY';
  replication_difficulty: 'LOW' | 'MODERATE' | 'HIGH';
  replication_notes: string;
}

interface TopPerformerProfile {
  employee_code: string;
  agent_name: string;
  overall_quality_score: number;
  audited_calls: number;
  tenure_months: number;
  trait_response_speed: number;
  trait_empathy: number;
  trait_professionalism: number;
  trait_listening: number;
  trait_grammar: number;
  trait_closure: number;
  excellence_profile: 'ALL_ROUNDED_EXCELLENCE' | 'SPECIALIST_EXCELLENCE' | 'BALANCED_EXCELLENCE';
}

interface Top10PercentAnalysis {
  top_10_percent_count: number;
  total_agents: number;
  top_10_pct_of_total: number;
  top_10_avg_quality: number;
  top_10_avg_tenure_days: number;
  top_10_avg_tenure_months: number;
  top_10_avg_audited_calls: number;
  top_10_min_quality: number;
  top_10_max_quality: number;
}

async function getQualityPool(): Promise<Pool> {
  const credentials = await getCredentialsForKey('shivamgiri_quality');
  if (!credentials) throw new Error('Quality database connector is not configured');
  if (credentials.db_type !== 'mysql') {
    throw new Error('Top performers analysis requires a MySQL connector');
  }
  return await getPoolForKey('shivamgiri_quality') as Pool;
}

/**
 * Get top 10% agent profile summary
 */
export async function getTop10PercentSummary(): Promise<Top10PercentAnalysis | null> {
  try {
    const pool = await getQualityPool();

    const [results] = await pool.execute<RowDataPacket[]>(
      `WITH quality_percentiles AS (
        SELECT
          e.id,
          e.employee_code,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
          COUNT(cqa.id) as audited_calls,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY AVG(cqa.quality_percentage)) OVER () as percentile_90
        FROM mas_hrms.employees e
        LEFT JOIN db_audit.call_quality_assessment cqa
          ON cqa.User = e.employee_code
          AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.quality_percentage IS NOT NULL
        WHERE e.employment_status = 'Active' AND e.active_status = 1
        GROUP BY e.id, e.employee_code
        HAVING COUNT(cqa.id) >= 10
      ),
      top_10_agents AS (
        SELECT id, employee_code, avg_quality, audited_calls
        FROM quality_percentiles
        WHERE avg_quality >= percentile_90
      )
      SELECT
        COUNT(*) as top_10_percent_count,
        (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e WHERE e.employment_status = 'Active' AND e.active_status = 1) as total_agents,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e WHERE e.employment_status = 'Active' AND e.active_status = 1), 2) as top_10_pct_of_total,
        ROUND(AVG(avg_quality), 2) as top_10_avg_quality,
        ROUND(AVG((SELECT DATEDIFF(NOW(), date_of_joining) FROM mas_hrms.employees WHERE id = t10.id)), 1) as top_10_avg_tenure_days,
        ROUND(AVG((SELECT DATEDIFF(NOW(), date_of_joining) FROM mas_hrms.employees WHERE id = t10.id)) / 30.0, 1) as top_10_avg_tenure_months,
        ROUND(AVG(audited_calls), 1) as top_10_avg_audited_calls,
        ROUND(MIN(avg_quality), 2) as top_10_min_quality,
        ROUND(MAX(avg_quality), 2) as top_10_max_quality
      FROM top_10_agents t10`
    );

    if (!results || results.length === 0) {
      return null;
    }

    return results[0] as Top10PercentAnalysis;
  } catch (error) {
    console.error('Error fetching top 10% summary:', error);
    return null;
  }
}

/**
 * Get trait mastery comparison: Top 10% vs Overall population
 */
export async function getTraitMasteryComparison(): Promise<TraitExcellence[]> {
  try {
    const pool = await getQualityPool();

    const [results] = await pool.execute<RowDataPacket[]>(
      `WITH quality_base AS (
        SELECT e.id, e.employee_code, ROUND(AVG(cqa.quality_percentage), 2) as avg_quality, COUNT(cqa.id) as audited_calls
        FROM mas_hrms.employees e
        LEFT JOIN db_audit.call_quality_assessment cqa
          ON cqa.User = e.employee_code
          AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.quality_percentage IS NOT NULL
        WHERE e.employment_status = 'Active' AND e.active_status = 1
        GROUP BY e.id, e.employee_code
        HAVING COUNT(cqa.id) >= 10
      ),
      percentile_90_threshold AS (
        SELECT PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY avg_quality) as threshold FROM quality_base
      ),
      top_10_agents AS (
        SELECT id, employee_code FROM quality_base WHERE avg_quality >= (SELECT threshold FROM percentile_90_threshold)
      ),
      trait_analysis AS (
        SELECT
          'call_answered_within_5_seconds' as trait_name,
          'Response Speed' as trait_label,
          ROUND(AVG(CASE WHEN t10.id IS NOT NULL THEN cqa.call_answered_within_5_seconds ELSE NULL END) * 100, 1) as top_10_pass_rate,
          ROUND(AVG(CASE WHEN t10.id IS NULL THEN cqa.call_answered_within_5_seconds ELSE NULL END) * 100, 1) as overall_pass_rate,
          COUNT(CASE WHEN t10.id IS NOT NULL AND cqa.call_answered_within_5_seconds IS NOT NULL THEN 1 END) as top_10_sample_size,
          COUNT(CASE WHEN t10.id IS NULL AND cqa.call_answered_within_5_seconds IS NOT NULL THEN 1 END) as overall_sample_size
        FROM db_audit.call_quality_assessment cqa
        LEFT JOIN top_10_agents t10 ON cqa.User = t10.employee_code
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND cqa.call_answered_within_5_seconds IS NOT NULL
        UNION ALL
        SELECT 'customer_concern_acknowledged', 'Empathy & Concern Acknowledgment',
          ROUND(AVG(CASE WHEN t10.id IS NOT NULL THEN cqa.customer_concern_acknowledged ELSE NULL END) * 100, 1),
          ROUND(AVG(CASE WHEN t10.id IS NULL THEN cqa.customer_concern_acknowledged ELSE NULL END) * 100, 1),
          COUNT(CASE WHEN t10.id IS NOT NULL AND cqa.customer_concern_acknowledged IS NOT NULL THEN 1 END),
          COUNT(CASE WHEN t10.id IS NULL AND cqa.customer_concern_acknowledged IS NOT NULL THEN 1 END)
        FROM db_audit.call_quality_assessment cqa
        LEFT JOIN top_10_agents t10 ON cqa.User = t10.employee_code
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND cqa.customer_concern_acknowledged IS NOT NULL
        UNION ALL
        SELECT 'professionalism_maintained', 'Professionalism & Conduct',
          ROUND(AVG(CASE WHEN t10.id IS NOT NULL THEN cqa.professionalism_maintained ELSE NULL END) * 100, 1),
          ROUND(AVG(CASE WHEN t10.id IS NULL THEN cqa.professionalism_maintained ELSE NULL END) * 100, 1),
          COUNT(CASE WHEN t10.id IS NOT NULL AND cqa.professionalism_maintained IS NOT NULL THEN 1 END),
          COUNT(CASE WHEN t10.id IS NULL AND cqa.professionalism_maintained IS NOT NULL THEN 1 END)
        FROM db_audit.call_quality_assessment cqa
        LEFT JOIN top_10_agents t10 ON cqa.User = t10.employee_code
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND cqa.professionalism_maintained IS NOT NULL
        UNION ALL
        SELECT 'active_listening', 'Active Listening & Comprehension',
          ROUND(AVG(CASE WHEN t10.id IS NOT NULL THEN cqa.active_listening ELSE NULL END) * 100, 1),
          ROUND(AVG(CASE WHEN t10.id IS NULL THEN cqa.active_listening ELSE NULL END) * 100, 1),
          COUNT(CASE WHEN t10.id IS NOT NULL AND cqa.active_listening IS NOT NULL THEN 1 END),
          COUNT(CASE WHEN t10.id IS NULL AND cqa.active_listening IS NOT NULL THEN 1 END)
        FROM db_audit.call_quality_assessment cqa
        LEFT JOIN top_10_agents t10 ON cqa.User = t10.employee_code
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND cqa.active_listening IS NOT NULL
        UNION ALL
        SELECT 'proper_grammar', 'Verbal Grammar & Clarity',
          ROUND(AVG(CASE WHEN t10.id IS NOT NULL THEN cqa.proper_grammar ELSE NULL END) * 100, 1),
          ROUND(AVG(CASE WHEN t10.id IS NULL THEN cqa.proper_grammar ELSE NULL END) * 100, 1),
          COUNT(CASE WHEN t10.id IS NOT NULL AND cqa.proper_grammar IS NOT NULL THEN 1 END),
          COUNT(CASE WHEN t10.id IS NULL AND cqa.proper_grammar IS NOT NULL THEN 1 END)
        FROM db_audit.call_quality_assessment cqa
        LEFT JOIN top_10_agents t10 ON cqa.User = t10.employee_code
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND cqa.proper_grammar IS NOT NULL
        UNION ALL
        SELECT 'proper_call_closure', 'Call Closure & Resolution',
          ROUND(AVG(CASE WHEN t10.id IS NOT NULL THEN cqa.proper_call_closure ELSE NULL END) * 100, 1),
          ROUND(AVG(CASE WHEN t10.id IS NULL THEN cqa.proper_call_closure ELSE NULL END) * 100, 1),
          COUNT(CASE WHEN t10.id IS NOT NULL AND cqa.proper_call_closure IS NOT NULL THEN 1 END),
          COUNT(CASE WHEN t10.id IS NULL AND cqa.proper_call_closure IS NOT NULL THEN 1 END)
        FROM db_audit.call_quality_assessment cqa
        LEFT JOIN top_10_agents t10 ON cqa.User = t10.employee_code
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND cqa.proper_call_closure IS NOT NULL
      )
      SELECT
        trait_name, trait_label, top_10_pass_rate, overall_pass_rate,
        ROUND(top_10_pass_rate - overall_pass_rate, 2) as excellence_delta,
        CASE
          WHEN (top_10_pass_rate - overall_pass_rate) >= 15 THEN 'KEY_DIFFERENTIATOR'
          WHEN (top_10_pass_rate - overall_pass_rate) >= 10 THEN 'STRONG_ADVANTAGE'
          WHEN (top_10_pass_rate - overall_pass_rate) >= 5 THEN 'MODERATE_ADVANTAGE'
          ELSE 'MINOR_ADVANTAGE'
        END as excellence_category,
        top_10_sample_size, overall_sample_size
      FROM trait_analysis
      ORDER BY excellence_delta DESC`
    );

    return (results || []).map((row: any) => ({
      trait_name: row.trait_name,
      trait_label: row.trait_label,
      top_10_pass_rate: row.top_10_pass_rate,
      overall_pass_rate: row.overall_pass_rate,
      excellence_delta: row.excellence_delta,
      excellence_category: row.excellence_category,
      top_10_sample_size: row.top_10_sample_size,
      overall_sample_size: row.overall_sample_size
    }));
  } catch (error) {
    console.error('Error fetching trait mastery comparison:', error);
    return [];
  }
}

/**
 * Get teachability and replication difficulty metrics
 */
export async function getTeachabilityMetrics(): Promise<TeachabilityMetric[]> {
  try {
    const pool = await getQualityPool();

    const traits = [
      { name: 'Response Speed', code: 'call_answered_within_5_seconds' },
      { name: 'Empathy & Concern Acknowledgment', code: 'customer_concern_acknowledged' },
      { name: 'Professionalism & Conduct', code: 'professionalism_maintained' },
      { name: 'Active Listening & Comprehension', code: 'active_listening' },
      { name: 'Verbal Grammar & Clarity', code: 'proper_grammar' },
      { name: 'Call Closure & Resolution', code: 'proper_call_closure' }
    ];

    const results: TeachabilityMetric[] = [];

    for (const trait of traits) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          STDDEV_SAMP(cqa.${trait.code} * 100) as pass_rate_stddev,
          AVG(cqa.${trait.code} * 100) as avg_pass_rate,
          COUNT(*) as total_observations,
          COUNT(CASE WHEN cqa.${trait.code} = 1 THEN 1 END) as success_count
        FROM db_audit.call_quality_assessment cqa
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND cqa.${trait.code} IS NOT NULL`
      );

      if (rows && rows.length > 0) {
        const row = rows[0];
        const variance = row.pass_rate_stddev || 0;
        const avgRate = row.avg_pass_rate || 0;

        let teachability: 'HIGH_TEACHABILITY' | 'MODERATE_TEACHABILITY' | 'LOW_TEACHABILITY' | 'UNEVEN_MASTERY' = 'UNEVEN_MASTERY';
        if (variance < 15 && avgRate > 80) teachability = 'HIGH_TEACHABILITY';
        else if (variance < 20 && avgRate > 70) teachability = 'MODERATE_TEACHABILITY';
        else if (variance >= 20 || avgRate < 70) teachability = 'LOW_TEACHABILITY';

        let difficulty: 'LOW' | 'MODERATE' | 'HIGH' = 'MODERATE';
        if (variance < 15) difficulty = 'LOW';
        else if (variance >= 25) difficulty = 'HIGH';

        const notes = teachability === 'HIGH_TEACHABILITY'
          ? 'Systematic skill; candidates replicate easily'
          : teachability === 'MODERATE_TEACHABILITY'
          ? 'Learnable skill; coaching required'
          : 'Difficult/variable skill; requires mentoring';

        results.push({
          trait_name: trait.name,
          trait_code: trait.code,
          avg_pass_rate_pct: parseFloat((avgRate || 0).toFixed(1)),
          variance_stddev: parseFloat((variance || 0).toFixed(1)),
          total_observations: row.total_observations || 0,
          success_count: row.success_count || 0,
          population_mastery_rate: parseFloat(((row.success_count * 100 / row.total_observations) || 0).toFixed(1)),
          teachability_category: teachability,
          replication_difficulty: difficulty,
          replication_notes: notes
        });
      }
    }

    return results.sort((a, b) => a.variance_stddev - b.variance_stddev);
  } catch (error) {
    console.error('Error fetching teachability metrics:', error);
    return [];
  }
}

/**
 * Get detailed profiles of top 10% agents
 */
export async function getTopPerformerProfiles(limit: number = 50): Promise<TopPerformerProfile[]> {
  try {
    const pool = await getQualityPool();

    const [results] = await pool.execute<RowDataPacket[]>(
      `WITH quality_base AS (
        SELECT
          e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
          COUNT(cqa.id) as audited_calls,
          DATEDIFF(NOW(), e.date_of_joining) as tenure_days,
          ROUND(AVG(cqa.call_answered_within_5_seconds) * 100, 1) as trait_response_speed,
          ROUND(AVG(cqa.customer_concern_acknowledged) * 100, 1) as trait_empathy,
          ROUND(AVG(cqa.professionalism_maintained) * 100, 1) as trait_professionalism,
          ROUND(AVG(cqa.active_listening) * 100, 1) as trait_listening,
          ROUND(AVG(cqa.proper_grammar) * 100, 1) as trait_grammar,
          ROUND(AVG(cqa.proper_call_closure) * 100, 1) as trait_closure
        FROM mas_hrms.employees e
        LEFT JOIN db_audit.call_quality_assessment cqa
          ON cqa.User = e.employee_code
          AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        WHERE e.employment_status = 'Active' AND e.active_status = 1
        GROUP BY e.id, e.employee_code
        HAVING COUNT(cqa.id) >= 10
      ),
      percentile_threshold AS (
        SELECT PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY avg_quality) as threshold FROM quality_base
      )
      SELECT
        qb.employee_code, qb.agent_name, ROUND(qb.avg_quality, 2) as overall_quality_score,
        qb.audited_calls, ROUND(qb.tenure_days / 30.0, 1) as tenure_months,
        qb.trait_response_speed, qb.trait_empathy, qb.trait_professionalism,
        qb.trait_listening, qb.trait_grammar, qb.trait_closure,
        CASE
          WHEN (qb.trait_response_speed + qb.trait_empathy + qb.trait_professionalism + qb.trait_listening + qb.trait_grammar + qb.trait_closure) / 6 >= 90 THEN 'ALL_ROUNDED_EXCELLENCE'
          WHEN GREATEST(qb.trait_response_speed, qb.trait_empathy, qb.trait_professionalism, qb.trait_listening, qb.trait_grammar, qb.trait_closure) >= 95 THEN 'SPECIALIST_EXCELLENCE'
          ELSE 'BALANCED_EXCELLENCE'
        END as excellence_profile
      FROM quality_base qb, percentile_threshold pt
      WHERE qb.avg_quality >= pt.threshold
      ORDER BY qb.avg_quality DESC
      LIMIT ?`,
      [limit]
    );

    return (results || []).map((row: any) => ({
      employee_code: row.employee_code,
      agent_name: row.agent_name,
      overall_quality_score: row.overall_quality_score,
      audited_calls: row.audited_calls,
      tenure_months: row.tenure_months,
      trait_response_speed: row.trait_response_speed || 0,
      trait_empathy: row.trait_empathy || 0,
      trait_professionalism: row.trait_professionalism || 0,
      trait_listening: row.trait_listening || 0,
      trait_grammar: row.trait_grammar || 0,
      trait_closure: row.trait_closure || 0,
      excellence_profile: row.excellence_profile
    }));
  } catch (error) {
    console.error('Error fetching top performer profiles:', error);
    return [];
  }
}

/**
 * Generate executive summary of what makes top 10% excel
 */
export interface ExecutiveSummary {
  top_10_percent_profile: Top10PercentAnalysis | null;
  trait_excellence: TraitExcellence[];
  teachability_metrics: TeachabilityMetric[];
  key_differentiators: string[];
  teachable_skills: string[];
  difficult_skills: string[];
  replication_path: string[];
  risks: string[];
}

export async function generateExecutiveSummary(): Promise<ExecutiveSummary> {
  const [summary, traits, teachability] = await Promise.all([
    getTop10PercentSummary(),
    getTraitMasteryComparison(),
    getTeachabilityMetrics()
  ]);

  const differentiators = traits
    .filter(t => t.excellence_category === 'KEY_DIFFERENTIATOR')
    .map(t => `${t.trait_label}: ${t.excellence_delta.toFixed(1)}% above average`);

  const teachable = teachability
    .filter(t => t.teachability_category === 'HIGH_TEACHABILITY')
    .map(t => t.trait_name);

  const difficult = teachability
    .filter(t => t.teachability_category === 'LOW_TEACHABILITY')
    .map(t => t.trait_name);

  return {
    top_10_percent_profile: summary,
    trait_excellence: traits,
    teachability_metrics: teachability,
    key_differentiators: differentiators,
    teachable_skills: teachable,
    difficult_skills: difficult,
    replication_path: [
      'SHORT-TERM (30-60 days): Implement call-answering SLA protocol and closure checklist',
      'MEDIUM-TERM (60-90 days): Peer coaching program with top agents on active listening',
      'LONG-TERM (90+ days): Profile behaviors for systematic training and hiring criteria'
    ],
    risks: [
      'Response Speed may be infrastructure-limited (call routing)',
      'Active Listening is personality-driven; difficult to standardize without extensive role-play'
    ]
  };
}
