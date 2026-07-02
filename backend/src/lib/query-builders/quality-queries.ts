/**
 * Quality Query Builders
 * Generates parameterized SQL for quality dashboard APIs
 * No schema changes - uses existing db_audit.call_quality_assessment + mas_hrms.employees
 */

export interface QueryResult {
  query: string;
  params: (string | number | Date)[];
}

/**
 * CQ Score aggregation: current, 7d, 30d, clean, rank, peer avg, weekly
 */
export function buildCQScoreQuery(employeeCode: string, daysBack: number = 7): QueryResult {
  const query = `
    WITH agent_scores AS (
      SELECT
        cqa.User,
        cqa.CallDate,
        cqa.quality_percentage,
        cqa.Campaign,
        professionalism_maintained,
        active_listening
      FROM db_audit.call_quality_assessment cqa
      WHERE cqa.User = ?
        AND cqa.Campaign LIKE 'INBOUND%'
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ${daysBack} DAY)
        AND cqa.User IS NOT NULL AND cqa.User != ''
    ),
    agent_stats AS (
      SELECT
        ROUND(AVG(quality_percentage), 2) as cq_current,
        ROUND(AVG(CASE
          WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
          THEN NULL ELSE quality_percentage
        END), 2) as cq_clean,
        COUNT(*) as total_calls,
        MIN(CallDate) as period_start
      FROM agent_scores
    ),
    weekly_breakdown AS (
      SELECT
        DAYNAME(CallDate) as day_name,
        FIELD(DAYNAME(CallDate), 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') as day_order,
        ROUND(AVG(quality_percentage), 2) as avg_score,
        COUNT(*) as calls
      FROM agent_scores
      GROUP BY DAYNAME(CallDate)
    ),
    peer_stats AS (
      SELECT
        ROUND(AVG(cqa.quality_percentage), 2) as peer_avg,
        COUNT(DISTINCT cqa.User) as total_agents
      FROM db_audit.call_quality_assessment cqa
      WHERE cqa.Campaign LIKE 'INBOUND%'
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ${daysBack} DAY)
        AND cqa.User IS NOT NULL AND cqa.User != ''
    ),
    agent_rank AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY ROUND(AVG(cqa.quality_percentage), 2) DESC) as rank_position,
        cqa.User
      FROM db_audit.call_quality_assessment cqa
      WHERE cqa.Campaign LIKE 'INBOUND%'
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ${daysBack} DAY)
        AND cqa.User IS NOT NULL AND cqa.User != ''
      GROUP BY cqa.User
    )
    SELECT
      ast.cq_current,
      ROUND(AVG(cqa.quality_percentage), 2) as cq_7day_avg,
      (SELECT ROUND(AVG(quality_percentage), 2) FROM db_audit.call_quality_assessment
       WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as cq_30day_avg,
      ast.cq_clean,
      ar.rank_position,
      ps.total_agents,
      ps.peer_avg,
      90 as target_score,
      (90 - ast.cq_current) as gap_pct,
      CASE
        WHEN ast.cq_current >= 80 THEN 'On Track'
        WHEN ast.cq_current >= 70 THEN 'Below Target'
        ELSE 'Risk'
      END as status,
      NOW() as last_updated,
      JSON_ARRAYAGG(
        JSON_OBJECT(
          'day', wb.day_name,
          'avg', wb.avg_score,
          'calls', wb.calls
        )
        ORDER BY wb.day_order
      ) as weekly_breakdown
    FROM agent_stats ast
    CROSS JOIN peer_stats ps
    LEFT JOIN agent_rank ar ON ar.User = ?
    LEFT JOIN weekly_breakdown wb ON 1=1
    LEFT JOIN db_audit.call_quality_assessment cqa ON cqa.User = ?
      AND cqa.Campaign LIKE 'INBOUND%'
      AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode, employeeCode, employeeCode, employeeCode]
  };
}

/**
 * Weakness detail: dimensional scores + top 5 calls with each weakness
 */
export function buildWeaknessDetailQuery(employeeCode: string): QueryResult {
  const query = `
    WITH weakness_scores AS (
      SELECT
        'Opening' as category,
        ROUND(AVG(call_answered_within_5_seconds) * 100, 2) as score,
        COUNT(CASE WHEN call_answered_within_5_seconds = 0 THEN 1 END) as weak_calls,
        'call_answered_within_5_seconds' as marker_column
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)

      UNION ALL

      SELECT
        'Soft Skills',
        ROUND((AVG(professionalism_maintained) + AVG(active_listening) + AVG(enthusiasm_and_no_fumbling)) / 3 * 100, 2),
        COUNT(CASE WHEN (professionalism_maintained = 0 OR active_listening = 0 OR enthusiasm_and_no_fumbling = 0) THEN 1 END),
        'professionalism_maintained'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)

      UNION ALL

      SELECT
        'Hold Procedure',
        ROUND((AVG(proper_hold_procedure) + AVG(dead_air_under_10_seconds)) / 2 * 100, 2),
        COUNT(CASE WHEN (proper_hold_procedure = 0 OR dead_air_under_10_seconds = 0) THEN 1 END),
        'proper_hold_procedure'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)

      UNION ALL

      SELECT
        'Resolution',
        ROUND((AVG(accurate_issue_probing) + AVG(proper_grammar)) / 2 * 100, 2),
        COUNT(CASE WHEN (accurate_issue_probing = 0 OR proper_grammar = 0) THEN 1 END),
        'accurate_issue_probing'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)

      UNION ALL

      SELECT
        'Closing',
        ROUND((AVG(proper_call_closure) + AVG(further_assistance_offered)) / 2 * 100, 2),
        COUNT(CASE WHEN (proper_call_closure = 0 OR further_assistance_offered = 0) THEN 1 END),
        'proper_call_closure'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    ),
    peer_weakness AS (
      SELECT
        'Opening' as category,
        ROUND(AVG(call_answered_within_5_seconds) * 100, 2) as peer_avg
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL

      UNION ALL
      SELECT 'Soft Skills', ROUND((AVG(professionalism_maintained) + AVG(active_listening) + AVG(enthusiasm_and_no_fumbling)) / 3 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL

      UNION ALL
      SELECT 'Hold Procedure', ROUND((AVG(proper_hold_procedure) + AVG(dead_air_under_10_seconds)) / 2 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL

      UNION ALL
      SELECT 'Resolution', ROUND((AVG(accurate_issue_probing) + AVG(proper_grammar)) / 2 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL

      UNION ALL
      SELECT 'Closing', ROUND((AVG(proper_call_closure) + AVG(further_assistance_offered)) / 2 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL
    )
    SELECT
      ws.category,
      ws.score,
      pw.peer_avg,
      (pw.peer_avg - ws.score) as gap,
      ws.weak_calls,
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'call_id', cqa.id,
            'date', cqa.CallDate,
            'cq_pct', cqa.quality_percentage
          )
        ),
        JSON_ARRAY()
      ) as related_calls
    FROM weakness_scores ws
    LEFT JOIN peer_weakness pw ON pw.category = ws.category
    LEFT JOIN db_audit.call_quality_assessment cqa
      ON cqa.User = ?
      AND cqa.Campaign LIKE 'INBOUND%'
      AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND (
        (ws.marker_column = 'call_answered_within_5_seconds' AND cqa.call_answered_within_5_seconds = 0)
        OR (ws.marker_column = 'professionalism_maintained' AND (cqa.professionalism_maintained = 0 OR cqa.active_listening = 0))
        OR (ws.marker_column = 'proper_hold_procedure' AND (cqa.proper_hold_procedure = 0 OR cqa.dead_air_under_10_seconds = 0))
        OR (ws.marker_column = 'accurate_issue_probing' AND (cqa.accurate_issue_probing = 0 OR cqa.proper_grammar = 0))
        OR (ws.marker_column = 'proper_call_closure' AND (cqa.proper_call_closure = 0 OR cqa.further_assistance_offered = 0))
      )
    GROUP BY ws.category, ws.score, pw.peer_avg, ws.weak_calls
    ORDER BY gap DESC
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode, employeeCode, employeeCode, employeeCode, employeeCode, employeeCode]
  };
}

/**
 * Paginated, sortable calls list for review
 */
export function buildCallsReviewQuery(
  employeeCode: string,
  limit: number = 10,
  offset: number = 0,
  sort: 'date' | 'cq' | 'fatal' = 'date'
): QueryResult {
  let orderBy = 'CallDate DESC';
  if (sort === 'cq') orderBy = 'quality_percentage ASC';
  if (sort === 'fatal') orderBy = '(CASE WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0) THEN 1 ELSE 0 END) DESC, CallDate DESC';

  const query = `
    SELECT
      id as call_id,
      CallDate as date,
      lead_id,
      lead_name,
      scenario,
      quality_percentage as cq_pct,
      CASE
        WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
        THEN 1 ELSE 0
      END as has_fatal,
      CASE
        WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
        THEN 'active_listening=0 AND cq<50'
        WHEN quality_percentage < 50 AND professionalism_maintained = 0
        THEN 'professionalism=0 AND cq<50'
        ELSE NULL
      END as fatal_reason,
      CEIL((CallDate - created_at) * 86400) as duration_sec,
      User as agent_code
    FROM db_audit.call_quality_assessment
    WHERE User = ?
      AND Campaign LIKE 'INBOUND%'
      AND CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND User IS NOT NULL AND User != ''
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const limitSafe = Math.min(limit, 50);
  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode, limitSafe, offset]
  };
}

/**
 * Single call detail with sub-scores
 */
export function buildCallDetailQuery(callId: string): QueryResult {
  const query = `
    SELECT
      id as call_id,
      CallDate as date,
      lead_id,
      lead_name,
      scenario,
      quality_percentage as cq_pct,
      CASE
        WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
        THEN 1 ELSE 0
      END as has_fatal,
      CEIL((CallDate - created_at) * 86400) as duration_sec,
      call_answered_within_5_seconds * 100 as opening_score,
      ROUND((professionalism_maintained + active_listening + enthusiasm_and_no_fumbling) / 3 * 100, 2) as soft_skills_score,
      ROUND((proper_hold_procedure + dead_air_under_10_seconds) / 2 * 100, 2) as hold_procedure_score,
      ROUND((accurate_issue_probing + proper_grammar) / 2 * 100, 2) as resolution_score,
      ROUND((proper_call_closure + further_assistance_offered) / 2 * 100, 2) as closing_score,
      CONCAT('https://recordings.internal/call_', id) as recording_url,
      'Transcript text here' as transcript_text,
      'Coach feedback goes here' as feedback,
      (SELECT ROUND(AVG(quality_percentage), 2)
       FROM db_audit.call_quality_assessment
       WHERE scenario = ? AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as peer_scenario_avg
    FROM db_audit.call_quality_assessment
    WHERE id = ?
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: ['Query', callId]
  };
}

/**
 * Get total call count for pagination
 */
export function buildTotalCallsCountQuery(employeeCode: string): QueryResult {
  const query = `
    SELECT COUNT(*) as total
    FROM db_audit.call_quality_assessment
    WHERE User = ?
      AND Campaign LIKE 'INBOUND%'
      AND CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND User IS NOT NULL AND User != ''
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode]
  };
}
