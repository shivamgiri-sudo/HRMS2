import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { pct, round1 } from "./sbi-card-dashboard.calc.js";

/**
 * SBI_CARD KPI rollups: after a Dialer MIS / Agent MIS import, recompute the touched days' process-grain KPI values from the tables
 * (all real campaigns / all agents for that day, rollup sheets excluded) and upsert them into process_metric_actual so the KPI page
 * shows real numbers. Recomputing from the table, not from the uploaded file, keeps a day correct when campaigns arrive in separate uploads.
 */
export const SBI_KPI = {
  contactRate: "sbi_contact_rate_pct",
  connectRate: "sbi_connect_rate_pct",
  ptpRate: "sbi_ptp_rate_pct",
  penetration: "sbi_penetration",
  amountCollected: "sbi_amount_collected",
  callsPerAgent: "sbi_calls_per_agent",
  leakageSeconds: "sbi_leakage_sec",
  coverage: "sbi_coverage_pct",
  untouchedAccounts: "sbi_untouched_accounts",
  untouchedExposure: "sbi_untouched_exposure",
  attemptsPerAccount: "sbi_attempts_per_account",
  accountPtpRate: "sbi_account_ptp_pct",
  overduePtp: "sbi_overdue_ptp_accounts",
  exhausted: "sbi_exhausted_accounts",
  utilisation: "sbi_utilisation_pct",
  occupancy: "sbi_occupancy_pct",
  pausePct: "sbi_pause_pct",
  acht: "sbi_acht_sec",
  callsPerLoginHour: "sbi_calls_per_login_hour",
} as const;

const CONNECTOR_KEY = "sbi_card_upload";

async function upsert(processId: string, rows: Array<{ key: string; date: string; value: number }>): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    await db.execute(
      `INSERT INTO process_metric_actual (id, process_id, metric_key, score_date, actual_value, source, source_connector_key)
       VALUES ${part.map(() => "(?, ?, ?, ?, ?, 'connector', ?)").join(", ")}
       ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = 'connector', source_connector_key = VALUES(source_connector_key)`,
      part.flatMap((r) => [randomUUID(), processId, r.key, r.date, r.value, CONNECTOR_KEY]),
    );
  }
}

const inList = (dates: string[]): string => dates.map(() => "?").join(",");

export async function refreshSbiKpiFromDialerMis(processId: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, SUM(COALESCE(accounts_called, total_accounts, 0)) AS accounts, SUM(COALESCE(accounts_scheduled, 0)) AS scheduled, SUM(COALESCE(dials, 0)) AS dials,
            SUM(COALESCE(connects, 0)) AS connects, SUM(COALESCE(ptp, 0)) AS ptp, SUM(COALESCE(total_contacts, 0)) AS contacts
       FROM sbi_card_dialer_mis WHERE process_id = ? AND is_rollup = 0 AND report_date IN (${inList(dates)}) GROUP BY report_date`,
    [processId, ...dates],
  );
  const out: Array<{ key: string; date: string; value: number }> = [];
  for (const r of rows) {
    const dials = Number(r.dials);
    if (!(dials > 0)) continue; // a day with no dials is not a 0% day
    const date = String(r.d);
    out.push({ key: SBI_KPI.contactRate, date, value: pct(Number(r.contacts), Number(r.accounts)) });
    out.push({ key: SBI_KPI.connectRate, date, value: pct(Number(r.connects), dials) });
    if (Number(r.scheduled) > 0) out.push({ key: SBI_KPI.penetration, date, value: Math.round((dials / Number(r.scheduled)) * 100) / 100 });
    out.push({ key: SBI_KPI.ptpRate, date, value: pct(Number(r.ptp), Number(r.contacts)) });
  }
  await upsert(processId, out);
}

export async function refreshSbiKpiFromAgentMis(processId: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, SUM(COALESCE(calls, 0)) AS calls, SUM(COALESCE(amt_collected, 0)) AS amount,
            COUNT(DISTINCT CASE WHEN COALESCE(calls, 0) > 0 THEN employee_id END) AS agents,
            AVG(CASE WHEN COALESCE(calls, 0) > 0 THEN leakage_seconds END) AS leak
       FROM sbi_card_agent_mis WHERE process_id = ? AND report_date IN (${inList(dates)}) GROUP BY report_date`,
    [processId, ...dates],
  );
  const out: Array<{ key: string; date: string; value: number }> = [];
  for (const r of rows) {
    const agents = Number(r.agents);
    if (!(agents > 0)) continue;
    const date = String(r.d);
    out.push({ key: SBI_KPI.callsPerAgent, date, value: round1(Number(r.calls) / agents) });
    out.push({ key: SBI_KPI.amountCollected, date, value: Math.round(Number(r.amount) * 100) / 100 });
    if (r.leak !== null && r.leak !== undefined) out.push({ key: SBI_KPI.leakageSeconds, date, value: Math.round(Number(r.leak)) });
  }
  await upsert(processId, out);
}

/** Attempts per account: the larger of the dialer's own count and the call slots that carry a time or a disposition. */
const ATTEMPTS_SQL = `GREATEST(COALESCE(dial_cnt, 0), ${[1, 2, 3, 4, 5, 6].map((n) => `(call${n}_dt IS NOT NULL OR disp${n}_c IS NOT NULL)`).join(" + ")})`;
const PTP_SQL = `(last_ptp_date IS NOT NULL OR last_action_code = 'PTP' OR ${[1, 2, 3, 4, 5, 6].map((n) => `disp${n}_c = 'PTP'`).join(" OR ")})`;

/** Account-file KPIs per snapshot day (same definitions as sbi-card-collections-ops.calc.ts). */
export async function refreshSbiKpiFromAccountFile(processId: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, COUNT(*) AS accounts,
            SUM(${ATTEMPTS_SQL} > 0) AS worked, SUM(${ATTEMPTS_SQL}) AS attempts,
            SUM(${ATTEMPTS_SQL} = 0) AS untouched, SUM(CASE WHEN ${ATTEMPTS_SQL} = 0 THEN COALESCE(total_amount_due, 0) ELSE 0 END) AS untouched_amt,
            SUM(${PTP_SQL}) AS ptp,
            SUM(${PTP_SQL} AND last_ptp_date < report_date) AS overdue_ptp,
            SUM(${ATTEMPTS_SQL} >= 4 AND NOT ${PTP_SQL}) AS exhausted
       FROM sbi_card_account_file WHERE process_id = ? AND report_date IN (${inList(dates)}) GROUP BY report_date`,
    [processId, ...dates],
  );
  const out: Array<{ key: string; date: string; value: number }> = [];
  for (const r of rows) {
    const accounts = Number(r.accounts); const worked = Number(r.worked);
    if (!(accounts > 0)) continue;
    const date = String(r.d);
    out.push({ key: SBI_KPI.coverage, date, value: pct(worked, accounts) });
    out.push({ key: SBI_KPI.untouchedAccounts, date, value: Number(r.untouched) });
    out.push({ key: SBI_KPI.untouchedExposure, date, value: Math.round(Number(r.untouched_amt) * 100) / 100 });
    out.push({ key: SBI_KPI.attemptsPerAccount, date, value: round1(Number(r.attempts) / accounts) });
    out.push({ key: SBI_KPI.overduePtp, date, value: Number(r.overdue_ptp) });
    out.push({ key: SBI_KPI.exhausted, date, value: Number(r.exhausted) });
    if (worked > 0) out.push({ key: SBI_KPI.accountPtpRate, date, value: pct(Number(r.ptp), worked) });
  }
  await upsert(processId, out);
}

/** Agent-time (APR) KPIs per day over all agents that logged in; same definitions as sbi-card-agent-time.calc.ts. */
export async function refreshSbiKpiFromAgentTime(processId: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, SUM(COALESCE(calls, 0)) AS calls, SUM(COALESCE(login_sec, 0)) AS login,
            SUM(COALESCE(wait_sec, 0)) AS wait, SUM(COALESCE(talk_sec, 0)) AS talk, SUM(COALESCE(dispo_sec, 0)) AS dispo,
            SUM(COALESCE(pause_sec, 0)) AS pause, SUM(COALESCE(acht_sec, 0) * COALESCE(calls, 0)) AS acht_calls
       FROM sbi_card_agent_time WHERE process_id = ? AND report_date IN (${inList(dates)}) GROUP BY report_date`,
    [processId, ...dates],
  );
  const out: Array<{ key: string; date: string; value: number }> = [];
  for (const r of rows) {
    const login = Number(r.login); if (!(login > 0)) continue;
    const date = String(r.d); const busy = Number(r.talk) + Number(r.dispo); const calls = Number(r.calls);
    out.push({ key: SBI_KPI.utilisation, date, value: pct(busy, login) });
    out.push({ key: SBI_KPI.pausePct, date, value: pct(Number(r.pause), login) });
    out.push({ key: SBI_KPI.callsPerLoginHour, date, value: round1(calls / (login / 3600)) });
    if (busy + Number(r.wait) > 0) out.push({ key: SBI_KPI.occupancy, date, value: pct(busy, busy + Number(r.wait)) });
    if (calls > 0) out.push({ key: SBI_KPI.acht, date, value: Math.round(Number(r.acht_calls) / calls) });
  }
  await upsert(processId, out);
}
