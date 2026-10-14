/**
 * Quality Query Builders
 * Generates parameterized SQL for quality dashboard APIs
 * No schema changes - uses existing db_audit.call_quality_assessment + mas_hrms.employees
 */

import { sqlLimitOffset } from "../../db/pagination.js";

export interface QueryResult {
  query: string;
  params: (string | number | Date)[];
}

// CQ formula mirrors the deployed Mydashboards app (inbound-quality.service.ts) so an agent sees the
// same number in HRMS as on the audit site: the stored quality_percentage is not trusted; per call,
// CQ = params scored 1 / params graded (NULL excluded from both sides, explicit 0 is a fail).
export const CQ_PARAM_COLS = [
  "call_answered_within_5_seconds", "customer_concern_acknowledged", "professionalism_maintained",
  "assurance_or_appreciation_provided", "pronunciation_and_clarity", "enthusiasm_and_no_fumbling",
  "active_listening", "politeness_and_no_sarcasm", "proper_grammar", "accurate_issue_probing",
  "proper_hold_procedure", "proper_transfer_and_language", "dead_air_under_10_seconds",
  "case_escalated_correctly", "address_recorded_completely", "correct_and_complete_information",
  "upselling_or_offers_suggested", "further_assistance_offered", "proper_call_closure",
];
// Clovia's QA form populates express_empathy on every call, so it is a 20th parameter there only.
export const CLOVIA_CLIENT_ID = "468";
export const EMPATHY_COL = "express_empathy";

/**
 * The inbound QA scorecard: 5 score components over the 19 parameters (+ express_empathy for
 * Clovia only), with labels and coaching tips copied verbatim from the deployed Mydashboards app
 * (inbound-quality.service.ts getScoreComponentDetail / SCORE_LABEL, InboundQualityDashboard
 * PARAM_TIPS) so the agent sees the same structure and wording as on the audit site.
 */
export type QualityParamGroup = "Opening Skill" | "Soft Skill" | "Hold Procedure" | "Resolution" | "Closing";
export const QUALITY_GROUPS: readonly QualityParamGroup[] = ["Opening Skill", "Soft Skill", "Hold Procedure", "Resolution", "Closing"];
export const QUALITY_PARAMS: ReadonlyArray<{ col: string; label: string; group: QualityParamGroup; fatal: boolean; tip: string | null }> = [
  { col: "call_answered_within_5_seconds", label: "Call Answered Within 5s", group: "Opening Skill", fatal: false, tip: "Answer calls within the first ring. Check headset readiness and auto-answer settings." },
  { col: "professionalism_maintained", label: "Professionalism Maintained", group: "Soft Skill", fatal: false, tip: "Maintain formal tone throughout. Avoid casual phrases, slang, or informal greetings." },
  { col: "assurance_or_appreciation_provided", label: "Assurance / Appreciation", group: "Soft Skill", fatal: false, tip: "Thank the customer for their patience. Use confidence statements like \"I'll make sure this is resolved\"." },
  { col: "pronunciation_and_clarity", label: "Pronunciation & Clarity", group: "Soft Skill", fatal: false, tip: "Speak slowly and clearly. Practice product names and technical terms during pre-shift review." },
  { col: "enthusiasm_and_no_fumbling", label: "Enthusiasm & No Fumbling", group: "Soft Skill", fatal: false, tip: "Prepare call scripts and product knowledge to reduce hesitation. Practice with call recordings." },
  { col: "active_listening", label: "Active Listening", group: "Soft Skill", fatal: false, tip: "Use affirmations: \"I see\", \"absolutely\", \"understood\". Avoid interrupting the customer mid-sentence." },
  { col: "politeness_and_no_sarcasm", label: "Politeness & No Sarcasm", group: "Soft Skill", fatal: false, tip: "Always use \"please\", \"thank you\", \"sir/ma'am\". Listen to own recordings to detect tone issues." },
  { col: "proper_grammar", label: "Proper Grammar", group: "Soft Skill", fatal: false, tip: "Review communication training. Use complete sentences. Avoid broken language or half-formed responses." },
  { col: "accurate_issue_probing", label: "Accurate Issue Probing", group: "Soft Skill", fatal: false, tip: "Ask structured questions to identify root cause before suggesting solutions. Don't assume the issue." },
  { col: "customer_concern_acknowledged", label: "Customer Concern Acknowledged", group: "Soft Skill", fatal: false, tip: "Echo the customer's concern at call start. Use: \"I understand you're calling about…\"" },
  { col: EMPATHY_COL, label: "Express Empathy", group: "Soft Skill", fatal: false, tip: null },
  { col: "proper_hold_procedure", label: "Proper Hold Procedure", group: "Hold Procedure", fatal: false, tip: "Always ask permission before hold: \"May I put you on hold for 2 minutes?\" Inform before unmuting." },
  { col: "proper_transfer_and_language", label: "Proper Transfer & Language", group: "Hold Procedure", fatal: false, tip: "Do warm transfers with full context briefing. Use the standard transfer script consistently." },
  { col: "dead_air_under_10_seconds", label: "Dead Air Under 10s", group: "Hold Procedure", fatal: false, tip: "Fill silence with status updates: \"I'm looking into this for you.\" Never go silent for 10+ seconds." },
  { col: "case_escalated_correctly", label: "Case Escalated Correctly", group: "Resolution", fatal: true, tip: "Follow the escalation matrix strictly. Document the full case before escalating to the next level." },
  { col: "address_recorded_completely", label: "Address Recorded Completely", group: "Resolution", fatal: true, tip: "Confirm all address fields: house/flat number, street, area, city, and pincode before closing." },
  { col: "correct_and_complete_information", label: "Correct & Complete Info", group: "Resolution", fatal: true, tip: "Cross-check policy/product details before confirming. Never guess. Verify using knowledge base." },
  { col: "upselling_or_offers_suggested", label: "Upselling / Offers Suggested", group: "Resolution", fatal: false, tip: "At call resolution, briefly mention one relevant offer: \"We have a current promotion you may be interested in…\"" },
  { col: "further_assistance_offered", label: "Further Assistance Offered", group: "Closing", fatal: false, tip: "Before closing, always ask: \"Is there anything else I can help you with today?\"" },
  { col: "proper_call_closure", label: "Proper Call Closure", group: "Closing", fatal: false, tip: "Use the standard closing script. Summarise actions taken, set expectations, and thank the customer." },
];
/** Clovia's own name for the opening parameter (display label only, scoring unchanged). */
export const CLOVIA_LABEL_OVERRIDES: Record<string, string> = { call_answered_within_5_seconds: "Standard Call Opening" };

/**
 * Per-call component score (0-1), as Mydashboards computes it: a call whose scenario is a dropped
 * or blank call scores 1 on every component; otherwise blank-excluded pass ratio over the
 * component's parameters. express_empathy is never part of a component score, Clovia included.
 */
const COMPONENT_EXEMPT_SQL = `q.scenario1 IN ('Call Drop in between','Short Call/Blank Call')`;
export function componentCallSql(group: QualityParamGroup): string {
  const cols = QUALITY_PARAMS.filter((p) => p.group === group && p.col !== EMPATHY_COL).map((p) => p.col);
  return `(CASE WHEN ${COMPONENT_EXEMPT_SQL} THEN 1 ELSE ${excludeBlankRatio(cols)} END)`;
}
export const componentKey = (g: QualityParamGroup) => g.toLowerCase().replace(/\s+/g, "_");

// express_empathy only counts on Clovia rows; everywhere else it is treated as not graded.
const paramExpr = (col: string) =>
  col === EMPATHY_COL ? `(CASE WHEN q.ClientId = '${CLOVIA_CLIENT_ID}' THEN q.${col} END)` : `q.${col}`;

// Bellavita / GNC / Neemans: an audit at or below 35% is not a real scored call and is excluded.
const LOW_QUALITY_GATE_CLIENT_IDS = ["375", "409", "475"];
// A call is FATAL when all three compliance-critical parameters scored 0 together.
const FATAL_PARAM_COLS = ["case_escalated_correctly", "address_recorded_completely", "correct_and_complete_information"];

function excludeBlankRatio(cols: string[]) {
  const num = cols.map((c) => `(CASE WHEN q.${c} IS NOT NULL THEN IF(q.${c} = 1, 1, 0) ELSE 0 END)`).join(" + ");
  const den = cols.map((c) => `(CASE WHEN q.${c} IS NOT NULL THEN 1 ELSE 0 END)`).join(" + ");
  return `(${num}) / NULLIF(${den}, 0)`;
}
export const CQ_SCORE_SQL = `(CASE WHEN q.ClientId = '${CLOVIA_CLIENT_ID}'
  THEN ${excludeBlankRatio([...CQ_PARAM_COLS, "express_empathy"])}
  ELSE ${excludeBlankRatio(CQ_PARAM_COLS)} END)`;
export const LOW_QUALITY_GATE_SQL = LOW_QUALITY_GATE_CLIENT_IDS
  .map((id) => `AND (q.ClientId != '${id}' OR q.quality_percentage > 35)`).join(" ");
export const FATAL_SQL = `(${FATAL_PARAM_COLS.map((c) => `q.${c} = 0`).join(" AND ")})`;

const clampDays = (d: number) => Math.min(90, Math.max(1, Math.floor(Number(d) || 7)));

/** Client processes this agent was audited in recently (idx_cqa_user_calldate). */
export function buildAgentClientsQuery(employeeCode: string, daysBack: number = 7): QueryResult {
  const lookback = Math.max(clampDays(daysBack), 30);
  return {
    query: `SELECT DISTINCT ClientId FROM db_audit.call_quality_assessment
             WHERE User = ? AND CallDate >= DATE_SUB(NOW(), INTERVAL ${lookback} DAY) AND ClientId IS NOT NULL`
      .replace(/\n\s+/g, " "),
    params: [employeeCode],
  };
}

/**
 * One scan over the given client processes (idx_client_calldate), aggregated per agent. CQ is the
 * average of the per-call CQ ratio over NON-FATAL calls only — Mydashboards' definition
 * (`AVG(CASE WHEN NOT fatal THEN cq END)`, including its three-valued NULL behaviour, so a call
 * whose fatal check is unknown is left out of the average exactly as on the audit site). n_all_win
 * still counts every audited call. Rank and peer average are derived from these rows in code.
 */
export function buildAgentTotalsByClientQuery(clientIds: string[], daysBack: number = 7): QueryResult {
  const days = clampDays(daysBack);
  const lookback = Math.max(days, 30);
  const inWin = `q.CallDate >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
  const in7 = `q.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  const in30 = `q.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
  const query = `
    SELECT x.User AS masid,
      COUNT(CASE WHEN x.in_win THEN 1 END) AS n_all_win,
      COUNT(CASE WHEN x.in_win THEN x.cq_nf END) AS n_win, SUM(CASE WHEN x.in_win THEN x.cq_nf END) AS s_win,
      COUNT(CASE WHEN x.in7 THEN x.cq_nf END) AS n_7, SUM(CASE WHEN x.in7 THEN x.cq_nf END) AS s_7,
      COUNT(CASE WHEN x.in30 THEN x.cq_nf END) AS n_30, SUM(CASE WHEN x.in30 THEN x.cq_nf END) AS s_30,
      SUM(CASE WHEN x.in_win AND x.is_fatal THEN 1 ELSE 0 END) AS fatal_win,
      COUNT(CASE WHEN x.in_win THEN x.cq END) AS n_clean,
      SUM(CASE WHEN x.in_win THEN x.cq END) AS s_clean
    FROM (
      SELECT q.User, ${CQ_SCORE_SQL} AS cq,
             CASE WHEN NOT ${FATAL_SQL} THEN ${CQ_SCORE_SQL} END AS cq_nf,
             COALESCE(${FATAL_SQL}, 0) AS is_fatal,
             ${inWin} AS in_win, ${in7} AS in7, ${in30} AS in30
      FROM db_audit.call_quality_assessment q
      WHERE q.ClientId IN (${clientIds.map(() => "?").join(",")})
        AND q.CallDate >= DATE_SUB(NOW(), INTERVAL ${lookback} DAY)
        AND q.User LIKE 'MAS%'
        AND q.quality_percentage IS NOT NULL
        ${LOW_QUALITY_GATE_SQL}
    ) x
    GROUP BY x.User
  `;
  return { query: query.replace(/\n\s+/g, " ").trim(), params: clientIds };
}

/** Day-of-week CQ for one agent in the window (idx_cqa_user_calldate). */
export function buildAgentWeeklyQuery(employeeCode: string, daysBack: number = 7): QueryResult {
  const days = clampDays(daysBack);
  const query = `
    SELECT DAYNAME(q.CallDate) AS day, MIN(WEEKDAY(q.CallDate)) AS day_order,
           ROUND(AVG(CASE WHEN NOT ${FATAL_SQL} THEN ${CQ_SCORE_SQL} END) * 100, 2) AS avg, COUNT(*) AS calls
    FROM db_audit.call_quality_assessment q
    WHERE q.User = ? AND q.CallDate >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      AND q.quality_percentage IS NOT NULL
      ${LOW_QUALITY_GATE_SQL}
    GROUP BY DAYNAME(q.CallDate)
    ORDER BY day_order
  `;
  return { query: query.replace(/\n\s+/g, " ").trim(), params: [employeeCode] };
}

/**
 * One agent's own audited calls in the window, with every parameter column, so per-parameter and
 * per-group scores (blank-excluded) and "which calls failed this parameter" can be derived from the
 * same rows. areas_for_improvement is the AI grader's own feedback text for the call.
 */
export function buildAgentAuditedCallsQuery(employeeCode: string, daysBack: number = 7): QueryResult {
  const days = Math.min(90, Math.max(1, Math.floor(Number(daysBack) || 7)));
  const query = `
    SELECT q.id AS call_id, q.CallDate AS date, q.ClientId AS client_id, q.Campaign AS campaign,
      ${QUALITY_PARAMS.map((p) => `${paramExpr(p.col)} AS ${p.col}`).join(", ")},
      ROUND(${CQ_SCORE_SQL} * 100, 1) AS cq_pct,
      ${QUALITY_GROUPS.map((g) => `${componentCallSql(g)} AS comp_${componentKey(g)}`).join(", ")},
      q.areas_for_improvement AS feedback
    FROM db_audit.call_quality_assessment q
    WHERE q.User = ?
      AND q.CallDate >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      AND q.quality_percentage IS NOT NULL
      ${LOW_QUALITY_GATE_SQL}
    ORDER BY q.CallDate DESC
    LIMIT 2000
  `;
  return { query: query.replace(/\n\s+/g, " ").trim(), params: [employeeCode] };
}

/**
 * Pass / graded totals per parameter across every agent in the same client process(es) as this
 * agent, for the peer comparison. One row, two columns per parameter: <col>__hit and <col>__n.
 */
export function buildPeerParamTotalsQuery(clientIds: string[], daysBack: number = 7): QueryResult {
  const days = clampDays(daysBack);
  const sums = QUALITY_PARAMS.map((p) => `
      SUM(CASE WHEN ${paramExpr(p.col)} = 1 THEN 1 ELSE 0 END) AS ${p.col}__hit,
      SUM(CASE WHEN ${paramExpr(p.col)} IS NOT NULL THEN 1 ELSE 0 END) AS ${p.col}__n`).join(",");
  const comps = QUALITY_GROUPS.map((g) => `AVG(${componentCallSql(g)}) AS comp_${componentKey(g)}`).join(", ");
  const query = `
    SELECT ${sums}, ${comps}
    FROM db_audit.call_quality_assessment q
    WHERE q.CallDate >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      AND q.User IS NOT NULL AND q.User != ''
      AND q.quality_percentage IS NOT NULL
      ${LOW_QUALITY_GATE_SQL}
      AND q.ClientId IN (${clientIds.map(() => "?").join(",")})
  `;
  return { query: query.replace(/\n\s+/g, " ").trim(), params: clientIds };
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
  let orderBy = 'q.CallDate DESC';
  if (sort === 'cq') orderBy = `${CQ_SCORE_SQL} ASC, q.CallDate DESC`;
  if (sort === 'fatal') orderBy = `${FATAL_SQL} DESC, q.CallDate DESC`;

  // lead_name does not exist on call_quality_assessment; length_in_sec is the real call length.
  const query = `
    SELECT
      q.id as call_id,
      q.CallDate as date,
      q.lead_id,
      NULL as lead_name,
      q.Campaign as campaign,
      q.scenario,
      ROUND(${CQ_SCORE_SQL} * 100, 1) as cq_pct,
      IF(${FATAL_SQL}, 1, 0) as has_fatal,
      IF(${FATAL_SQL}, 'Escalation, address capture and information accuracy all failed', NULL) as fatal_reason,
      q.length_in_sec as duration_sec,
      q.User as agent_code
    FROM db_audit.call_quality_assessment q
    WHERE q.User = ?
      AND q.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND q.quality_percentage IS NOT NULL
      ${LOW_QUALITY_GATE_SQL}
    ORDER BY ${orderBy}
    ${sqlLimitOffset(limit, offset, { defaultLimit: 10, maxLimit: 50 })}
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode]
  };
}

/**
 * Single call detail with sub-scores
 */
export function buildCallDetailQuery(callId: string, ownerEmployeeCode: string): QueryResult {
  // Owner check (User = ?) is what stops one agent reading another's call by changing the id.
  // areas_for_improvement is the AI grader's own feedback text for this call.
  const query = `
    SELECT
      q.id as call_id,
      q.CallDate as date,
      q.lead_id,
      NULL as lead_name,
      q.Campaign as campaign,
      q.scenario,
      ROUND(${CQ_SCORE_SQL} * 100, 1) as cq_pct,
      IF(${FATAL_SQL}, 1, 0) as has_fatal,
      q.length_in_sec as duration_sec,
      ROUND(${componentCallSql("Opening Skill")} * 100, 1) as opening_score,
      ROUND(${componentCallSql("Soft Skill")} * 100, 1) as soft_skills_score,
      ROUND(${componentCallSql("Hold Procedure")} * 100, 1) as hold_procedure_score,
      ROUND(${componentCallSql("Resolution")} * 100, 1) as resolution_score,
      ROUND(${componentCallSql("Closing")} * 100, 1) as closing_score,
      q.scenario1,
      ${QUALITY_PARAMS.map((p) => `${paramExpr(p.col)} as ${p.col}`).join(",\n      ")},
      q.call_recording as recording_url,
      q.Transcribe_Text as transcript_text,
      q.areas_for_improvement as feedback,
      NULL as peer_scenario_avg
    FROM db_audit.call_quality_assessment q
    WHERE q.id = ?
      AND q.User = ?
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [callId, ownerEmployeeCode]
  };
}

/**
 * Get total call count for pagination
 */
export function buildTotalCallsCountQuery(employeeCode: string): QueryResult {
  const query = `
    SELECT COUNT(*) as total
    FROM db_audit.call_quality_assessment q
    WHERE q.User = ?
      AND q.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND q.quality_percentage IS NOT NULL
      ${LOW_QUALITY_GATE_SQL}
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode]
  };
}
