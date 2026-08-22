import { querySource } from "../../db/sourceDb.js";

/**
 * Per-client quality drill-down for ClientQualityDrillModal.
 *
 * The modal has always called seven /client-drill endpoints and none existed, so every tab
 * rendered blank. The data was there the whole time: db_audit.call_quality_assessment holds
 * ~438k audited calls with client, agent, score, scenario, mobile and transcript.
 *
 * Nothing here invents a definition. Every threshold is the one already used by
 * inbound-quality.service.ts, so this drill-down and the dashboards above it cannot disagree:
 *
 *   fatal            quality_percentage = 0
 *   CQ without fatal AVG over quality_percentage > 0 only
 *   excellent        >= 98
 *   good             >= 90 and < 98
 *   average          >= 85 and < 90
 *   below average    > 0 and < 85
 *
 * db_audit is an upstream read-only source; everything below is SELECT.
 */

export interface ClientDrillFilters {
  clientId: string;
  from: string;
  to: string;
}

/** Shared predicate: a scored audit for this client in range. */
const SCOPE = `q.ClientId = ? AND q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL`;
const scopeParams = (f: ClientDrillFilters) => [f.clientId, f.from, f.to];

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const pct = (part: unknown, whole: unknown) => {
  const total = Number(whole ?? 0);
  return total > 0 ? Math.round((Number(part ?? 0) / total) * 1000) / 10 : 0;
};

/** Headline figures for the client. */
export async function getClientKpis(f: ClientDrillFilters) {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT q.ClientId AS client_id,
            CONCAT('Client ', q.ClientId) AS client_name,
            COUNT(*) AS audit_count,
            ROUND(AVG(q.quality_percentage),1) AS cq_score,
            ROUND(AVG(CASE WHEN q.quality_percentage>0 THEN q.quality_percentage END),1) AS without_fatal_cq,
            SUM(CASE WHEN q.quality_percentage>=98 THEN 1 ELSE 0 END) AS excellent,
            SUM(CASE WHEN q.quality_percentage>=90 AND q.quality_percentage<98 THEN 1 ELSE 0 END) AS good,
            SUM(CASE WHEN q.quality_percentage>0 AND q.quality_percentage<85 THEN 1 ELSE 0 END) AS below_avg,
            SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
            ROUND(AVG(q.total_score),1) AS avg_parameters
       FROM db_audit.call_quality_assessment q
      WHERE ${SCOPE}
      GROUP BY q.ClientId`,
    scopeParams(f)
  );
  const row = rows[0];
  // A client with no audits in range is an empty period, not an error. Zeros here are
  // genuine — they are counted from rows that exist — unlike an absent feed.
  if (!row) {
    return {
      client_id: f.clientId, client_name: `Client ${f.clientId}`, audit_count: 0,
      cq_score: 0, without_fatal_cq: 0, excellent_pct: 0, good_pct: 0,
      below_avg_pct: 0, fatal_count: 0, avg_parameters: 0,
    };
  }
  return {
    client_id: String(row.client_id),
    client_name: String(row.client_name),
    audit_count: num(row.audit_count),
    cq_score: num(row.cq_score),
    without_fatal_cq: num(row.without_fatal_cq),
    // The modal renders percentages; the shared definition counts. Converted here so the
    // thresholds stay in one place.
    excellent_pct: pct(row.excellent, row.audit_count),
    good_pct: pct(row.good, row.audit_count),
    below_avg_pct: pct(row.below_avg, row.audit_count),
    fatal_count: num(row.fatal_count),
    avg_parameters: num(row.avg_parameters),
  };
}

/** Daily trend. */
export async function getClientDaily(f: ClientDrillFilters) {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS date,
            ROUND(AVG(q.quality_percentage),1) AS cq_score,
            ROUND(AVG(CASE WHEN q.quality_percentage>0 THEN q.quality_percentage END),1) AS without_fatal_cq,
            SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
            COUNT(*) AS audit_count
       FROM db_audit.call_quality_assessment q
      WHERE ${SCOPE}
      GROUP BY DATE_FORMAT(q.CallDate,'%Y-%m-%d')
      ORDER BY date ASC`,
    scopeParams(f)
  );
  return rows.map((r) => ({
    date: String(r.date),
    cq_score: num(r.cq_score),
    without_fatal_cq: num(r.without_fatal_cq),
    fatal_count: num(r.fatal_count),
    audit_count: num(r.audit_count),
  }));
}

/** Agent leaderboard for this client. */
export async function getClientAgents(f: ClientDrillFilters) {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT q.User AS agent_code,
            COALESCE(ANY_VALUE(e.full_name), q.User) AS agent_name,
            COUNT(*) AS audit_count,
            ROUND(AVG(q.quality_percentage),1) AS cq_score,
            ROUND(AVG(CASE WHEN q.quality_percentage>0 THEN q.quality_percentage END),1) AS without_fatal_cq,
            SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
            SUM(CASE WHEN q.quality_percentage>=98 THEN 1 ELSE 0 END) AS excellent_count,
            SUM(CASE WHEN q.quality_percentage>=90 AND q.quality_percentage<98 THEN 1 ELSE 0 END) AS good_count,
            SUM(CASE WHEN q.quality_percentage>0 AND q.quality_percentage<85 THEN 1 ELSE 0 END) AS below_avg_count
       FROM db_audit.call_quality_assessment q
       LEFT JOIN mas_hrms.employees e ON e.employee_code = q.User
      WHERE ${SCOPE}
      GROUP BY q.User
      ORDER BY audit_count DESC
      LIMIT 200`,
    scopeParams(f)
  );
  return rows.map((r) => ({
    agent_name: String(r.agent_name ?? r.agent_code ?? "Unknown"),
    agent_code: r.agent_code ? String(r.agent_code) : undefined,
    audit_count: num(r.audit_count),
    cq_score: num(r.cq_score),
    without_fatal_cq: num(r.without_fatal_cq),
    fatal_count: num(r.fatal_count),
    excellent_count: num(r.excellent_count),
    good_count: num(r.good_count),
    below_avg_count: num(r.below_avg_count),
  }));
}

/**
 * Which breach drove the fatals.
 *
 * A fatal is quality_percentage = 0; the reason is whichever serious-breach column answers
 * "Yes" on that call.
 *
 * The test is that literal answer, not "column is non-empty". These columns are written by an
 * assessment model and hold "No" on the overwhelming majority of calls, alongside "",
 * "Yes/No" and even "Respond with either Yes or No." — 137,350 "No" against 47 "Yes" for
 * data theft on one client. Treating non-empty as a breach reported every fatal call as
 * having tripped all seven, which is exactly the kind of confident, plausible, wrong number
 * this drill-down exists to expose.
 *
 * One call can genuinely trip several, so a call is counted under each breach it answers Yes
 * to and the counts deliberately do not sum to fatal_count.
 */
const FATAL_PARAMETERS: ReadonlyArray<{ column: string; label: string }> = [
  { column: "data_theft_or_misuse", label: "Data theft or misuse" },
  { column: "unprofessional_behavior", label: "Unprofessional behaviour" },
  { column: "system_manipulation", label: "System manipulation" },
  { column: "financial_fraud", label: "Financial fraud" },
  { column: "escalation_failure", label: "Escalation failure" },
  { column: "collusion", label: "Collusion" },
  { column: "policy_communication_failure", label: "Policy communication failure" },
];

export async function getClientFatal(f: ClientDrillFilters) {
  // Column names come from the constant above, never from the request.
  const selects = FATAL_PARAMETERS.map(
    ({ column }, i) =>
      `SUM(CASE WHEN LOWER(TRIM(COALESCE(q.${column},''))) = 'yes' THEN 1 ELSE 0 END) AS c${i},
       COUNT(DISTINCT CASE WHEN LOWER(TRIM(COALESCE(q.${column},''))) = 'yes' THEN q.User END) AS a${i}`
  ).join(",\n            ");

  const rows = await querySource<Record<string, unknown>>(
    `SELECT ${selects}
       FROM db_audit.call_quality_assessment q
      WHERE ${SCOPE} AND q.quality_percentage = 0`,
    scopeParams(f)
  );
  const row = rows[0] ?? {};
  return FATAL_PARAMETERS
    .map(({ label }, i) => ({
      fatal_parameter: label,
      count: num(row[`c${i}`]),
      agents_affected: num(row[`a${i}`]),
    }))
    // A breach nobody committed is noise in a table meant to show what went wrong.
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Call scenarios. scenario1 is the sub-scenario the modal shows beside it. */
export async function getClientScenarios(f: ClientDrillFilters) {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT COALESCE(NULLIF(TRIM(q.scenario),''),'Unclassified') AS scenario,
            NULLIF(TRIM(q.scenario1),'') AS sub_scenario,
            COUNT(*) AS count,
            ROUND(AVG(q.quality_percentage),1) AS avg_score
       FROM db_audit.call_quality_assessment q
      WHERE ${SCOPE}
      GROUP BY scenario, sub_scenario
      ORDER BY count DESC
      LIMIT 100`,
    scopeParams(f)
  );
  return rows.map((r) => ({
    scenario: String(r.scenario),
    sub_scenario: r.sub_scenario ? String(r.sub_scenario) : undefined,
    count: num(r.count),
    avg_score: num(r.avg_score),
  }));
}

/**
 * Customers who called more than once — the repeat-contact view.
 *
 * Grouped by MobileNo, so blank numbers are excluded rather than collapsing every
 * unidentified caller into one enormous fake "repeat customer".
 */
export async function getClientRepeat(f: ClientDrillFilters) {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT q.MobileNo AS mobile,
            COUNT(*) AS repeat_count,
            DATE_FORMAT(MIN(q.CallDate),'%Y-%m-%d') AS first_call_date,
            DATE_FORMAT(MAX(q.CallDate),'%Y-%m-%d') AS last_call_date,
            COUNT(DISTINCT q.User) AS unique_agents
       FROM db_audit.call_quality_assessment q
      WHERE ${SCOPE} AND COALESCE(TRIM(q.MobileNo),'') NOT IN ('','null')
      GROUP BY q.MobileNo
     HAVING repeat_count > 1
      ORDER BY repeat_count DESC
      LIMIT 200`,
    scopeParams(f)
  );
  return rows.map((r) => ({
    mobile: String(r.mobile),
    repeat_count: num(r.repeat_count),
    first_call_date: String(r.first_call_date),
    last_call_date: String(r.last_call_date),
    unique_agents: num(r.unique_agents),
  }));
}

/**
 * One call's transcript.
 *
 * clientId is required and enforced in the WHERE, not just accepted — every sibling function
 * in this file scopes to SCOPE (q.ClientId = ?). This one didn't (Section M RBAC audit,
 * 2026-08-17): a caller holding any of this router's roles (process_manager, manager, qa,
 * quality_analyst, operations_manager — none inherently org-wide) could pass ANY leadId and
 * read the call transcript + agent name for any client/process, not just their own, by
 * guessing or enumerating lead ids. Fixed by requiring the same clientId the rest of the drill
 * already scopes on.
 */
export async function getClientTranscript(leadId: string, clientId: string) {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT q.lead_id,
            DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS date,
            COALESCE(e.full_name, q.User) AS agent_name,
            q.quality_percentage AS cq_score,
            COALESCE(q.Transcribe_Text,'') AS transcript_text,
            ${FATAL_PARAMETERS.map(({ column }) => `q.${column}`).join(", ")}
       FROM db_audit.call_quality_assessment q
       LEFT JOIN mas_hrms.employees e ON e.employee_code = q.User
      WHERE q.lead_id = ? AND q.ClientId = ?
      LIMIT 1`,
    [leadId, clientId]
  );
  const row = rows[0];
  if (!row) return null;

  // Which breaches this specific call recorded, named rather than raw column values.
  const breached = FATAL_PARAMETERS
    .filter(({ column }) => {
      return String(row[column] ?? "").trim().toLowerCase() === "yes";
    })
    .map(({ label }) => label);

  return {
    lead_id: String(row.lead_id),
    date: String(row.date),
    agent_name: row.agent_name ? String(row.agent_name) : undefined,
    cq_score: num(row.cq_score),
    transcript_text: String(row.transcript_text ?? ""),
    fatal_parameters: breached.length ? breached.join(", ") : undefined,
  };
}
