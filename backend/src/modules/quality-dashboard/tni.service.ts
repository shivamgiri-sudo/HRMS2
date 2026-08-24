/**
 * TNI (Training Need Identification) service.
 *
 * Queries db_audit.call_quality_assessment per-agent, per-parameter to identify
 * which agents need coaching on which of the 19 inbound quality parameters.
 *
 * Pass rate convention: each parameter column is TINYINT 0/1 (fail/pass).
 * pass_pct = AVG(param) * 100.  A pass_pct < 60 is a TNI flag.
 */

import { getShivamgiriPool } from "../../db/shivamgiriDb.js";
import type { RowDataPacket } from "mysql2";

const TNI_PARAMS = [
  "call_answered_within_5_seconds",
  "customer_concern_acknowledged",
  "professionalism_maintained",
  "assurance_or_appreciation_provided",
  "pronunciation_and_clarity",
  "enthusiasm_and_no_fumbling",
  "active_listening",
  "politeness_and_no_sarcasm",
  "proper_grammar",
  "accurate_issue_probing",
  "proper_hold_procedure",
  "proper_transfer_and_language",
  "dead_air_under_10_seconds",
  "case_escalated_correctly",
  "address_recorded_completely",
  "correct_and_complete_information",
  "upselling_or_offers_suggested",
  "further_assistance_offered",
  "proper_call_closure",
] as const;

export type TniParam = (typeof TNI_PARAMS)[number];

export interface TniAgentRow {
  agent_code: string;
  agent_name: string;
  audit_count: number;
  avg_cq_score: number;
  /** pass % per param, keyed by param name */
  params: Record<TniParam, number>;
  /** number of params below the TNI threshold */
  tni_flag_count: number;
}

export interface TniSummary {
  total_agents: number;
  agents_with_tni: number;
  most_failed_param: string;
  most_failed_param_pass_pct: number;
  avg_cq_score: number;
}

export interface TniAgentCallRecord {
  lead_id: string;
  call_date: string;
  cq_score: number;
  param_pass: 0 | 1;
  scenario: string;
  client: string;
}

const TNI_THRESHOLD = 60; // pass % below this = needs training

function buildSelectColumns(): string {
  return TNI_PARAMS.map(
    (p) => `ROUND(AVG(COALESCE(q.\`${p}\`, 0)) * 100, 1) AS \`${p}\``
  ).join(",\n      ");
}

export async function getTniAnalysis(
  startDate: string,
  endDate: string,
  clientId?: string | null
): Promise<{ agents: TniAgentRow[]; summary: TniSummary }> {
  const pool = getShivamgiriPool();

  const clientCond = clientId ? " AND q.ClientId = ?" : "";
  const baseParams: (string | number)[] = [startDate, endDate, ...(clientId ? [clientId] : [])];

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      q.User AS agent_code,
      COALESCE(am.AgentName, q.User) AS agent_name,
      COUNT(*) AS audit_count,
      ROUND(AVG(q.quality_percentage), 1) AS avg_cq_score,
      ${buildSelectColumns()}
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am
       ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ?
       AND q.quality_percentage IS NOT NULL
       AND q.User IS NOT NULL AND TRIM(q.User) != ''
       ${clientCond}
     GROUP BY q.User, am.AgentName
     ORDER BY audit_count DESC`,
    baseParams
  );

  const agents: TniAgentRow[] = (rows as RowDataPacket[]).map((row) => {
    const params = {} as Record<TniParam, number>;
    let flagCount = 0;
    for (const p of TNI_PARAMS) {
      const val = Number(row[p] ?? 0);
      params[p] = val;
      if (val < TNI_THRESHOLD) flagCount++;
    }
    return {
      agent_code: String(row.agent_code ?? ""),
      agent_name: String(row.agent_name ?? row.agent_code ?? "Unknown"),
      audit_count: Number(row.audit_count ?? 0),
      avg_cq_score: Number(row.avg_cq_score ?? 0),
      params,
      tni_flag_count: flagCount,
    };
  });

  // Sort: most failures first
  agents.sort((a, b) => b.tni_flag_count - a.tni_flag_count);

  // Summary
  const agentsWithTni = agents.filter((a) => a.tni_flag_count > 0).length;
  const avgCq =
    agents.length > 0
      ? Math.round(agents.reduce((s, a) => s + a.avg_cq_score, 0) / agents.length * 10) / 10
      : 0;

  // Most failed param = lowest average pass % across all agents
  let mostFailedParam: TniParam = TNI_PARAMS[0];
  let lowestAvg = Infinity;
  for (const p of TNI_PARAMS) {
    const avg =
      agents.length > 0
        ? agents.reduce((s, a) => s + a.params[p], 0) / agents.length
        : 100;
    if (avg < lowestAvg) {
      lowestAvg = avg;
      mostFailedParam = p;
    }
  }

  return {
    agents,
    summary: {
      total_agents: agents.length,
      agents_with_tni: agentsWithTni,
      most_failed_param: mostFailedParam,
      most_failed_param_pass_pct: Math.round(lowestAvg * 10) / 10,
      avg_cq_score: avgCq,
    },
  };
}

export async function getTniAgentCalls(
  agentCode: string,
  param: TniParam,
  startDate: string,
  endDate: string,
  clientId?: string | null
): Promise<TniAgentCallRecord[]> {
  if (!TNI_PARAMS.includes(param)) throw new Error(`Unknown TNI param: ${param}`);

  const pool = getShivamgiriPool();
  const clientCond = clientId ? " AND q.ClientId = ?" : "";
  const params: (string | number)[] = [agentCode, startDate, endDate, ...(clientId ? [clientId] : [])];

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      COALESCE(q.lead_id, '') AS lead_id,
      DATE_FORMAT(q.CallDate, '%Y-%m-%d') AS call_date,
      ROUND(q.quality_percentage, 1) AS cq_score,
      COALESCE(q.\`${param}\`, 0) AS param_pass,
      CASE WHEN TRIM(q.scenario) = '' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      COALESCE(c.display_name, CONCAT('Client ', q.ClientId)) AS client
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.portal_client_config c
       ON c.client_id = CAST(q.ClientId AS UNSIGNED)
     WHERE q.User = ?
       AND q.CallDate BETWEEN ? AND ?
       AND q.quality_percentage IS NOT NULL
       ${clientCond}
     ORDER BY q.CallDate DESC
     LIMIT 200`,
    params
  );

  return (rows as RowDataPacket[]).map((r) => ({
    lead_id: String(r.lead_id ?? ""),
    call_date: String(r.call_date ?? ""),
    cq_score: Number(r.cq_score ?? 0),
    param_pass: (Number(r.param_pass) === 1 ? 1 : 0) as 0 | 1,
    scenario: String(r.scenario ?? "Unknown"),
    client: String(r.client ?? ""),
  }));
}
