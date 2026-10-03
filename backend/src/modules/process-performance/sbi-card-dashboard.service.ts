import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  totalsOf, dailyRows, byCampaign, agentsOf, teamsOf, accountsOf,
  type DialerRow, type AgentRow, type AccountRow, type DailyOut, type CampaignOut, type AgentOut, type TeamOut, type AccountsOut,
} from "./sbi-card-dashboard.calc.js";
import { agentTimeOf, type AgentTimeOut, type AgentTimeRow } from "./sbi-card-agent-time.calc.js";
import { collectionsOps, type AccountOpsRow, type CollectionsOpsOut } from "./sbi-card-collections-ops.calc.js";

/**
 * SBI Card Collections dashboard (process_master 'SBI Card Collections', code SBI_CARD). Everything is read from the mas_hrms tables
 * filled by the SBI_CARD_* uploaders. Dialer totals come ONLY from real campaign rows (is_rollup = 0): the workbook's Master / Overall
 * sheets are stored but excluded here so nothing is counted twice. Until a sheet is uploaded its section honestly reads zero / empty.
 */

const pad2 = (n: number): string => String(n).padStart(2, "0");
const localISO = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SbiCardDashboardData {
  range: { from: string; to: string };
  campaigns: string[];
  summary: {
    accounts: number; dials: number; answers: number; connects: number; ptp: number; pad: number; otp: number;
    contactRatePct: number; connectRatePct: number; ptpRatePct: number; amountCollected: number; agentsActive: number;
    scheduled: number; penetration: number; completionPct: number; penetrationTarget: number | null;
  };
  daily: DailyOut[];
  byCampaign: CampaignOut[];
  agents: AgentOut[];
  teams: TeamOut[];
  downtime: Array<{ date: string; startTime: string | null; upTime: string | null; downtimeMinutes: number; impactedUsers: number; reason: string | null; status: string | null }>;
  accounts: AccountsOut;
  agentTime: AgentTimeOut;
  collections: CollectionsOpsOut & { agents: Array<CollectionsOpsOut["agents"][number] & { name: string | null }> };
}

/** from/to win; else month=YYYY-MM; else the current month up to today. */
export function resolveRange(month?: string, from?: string, to?: string, now = new Date()): { from: string; to: string } {
  if (from && DATE_RE.test(from)) {
    const t = to && DATE_RE.test(to) ? to : from;
    return { from, to: t < from ? from : t };
  }
  const m = month && MONTH_RE.test(month) ? month : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const last = `${m}-${pad2(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate())}`;
  const today = localISO(now);
  return { from: `${m}-01`, to: !month && last > today ? today : last };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function processId(): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1`);
  return r[0]?.id ?? null;
}

export async function getSbiCardDashboard(month?: string, fromIn?: string, toIn?: string): Promise<SbiCardDashboardData> {
  const { from, to } = resolveRange(month, fromIn, toIn);
  const pid = await processId();
  const empty = !pid;
  const p = pid ?? "";

  const [dRows, aRows, tRows, latest, timeRows, penRows] = await Promise.all([
    empty ? [[]] : db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, campaign, accounts_called, accounts_scheduled, total_accounts, dials, answers, connects, ptp, pad, otp, total_contacts
         FROM sbi_card_dialer_mis WHERE process_id = ? AND is_rollup = 0 AND report_date BETWEEN ? AND ?`, [p, from, to]),
    empty ? [[]] : db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, employee_id, dialer_id, agent_name, team, team_leader, calls, contacts, ptp, pad, amt_collected,
              TIME_FORMAT(first_login_time, '%H:%i:%s') AS fl, TIME_FORMAT(last_logout_time, '%H:%i:%s') AS ll, leakage_seconds
         FROM sbi_card_agent_mis WHERE process_id = ? AND report_date BETWEEN ? AND ?`, [p, from, to]),
    empty ? [[]] : db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, TIME_FORMAT(start_time, '%H:%i') AS st, TIME_FORMAT(up_time, '%H:%i') AS ut,
              downtime_minutes, impacted_users, reason, status
         FROM sbi_card_downtime WHERE process_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date, start_time`, [p, from, to]),
    empty ? [[]] : db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(MAX(report_date), '%Y-%m-%d') AS d FROM sbi_card_account_file WHERE process_id = ? AND report_date BETWEEN ? AND ?`, [p, from, to]),
    empty ? [[]] : db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, employee_id, agent_name, calls, login_sec, wait_sec, talk_sec, dispo_sec, pause_sec, dead_sec, acht_sec,
              TIME_FORMAT(first_login_time, '%H:%i:%s') AS fl, TIME_FORMAT(last_logout_time, '%H:%i:%s') AS ll,
              pause_lb_sec, pause_tb_sec, pause_wb_sec, pause_mb_sec, pause_qb_sec, pause_login_sec
         FROM sbi_card_agent_time WHERE process_id = ? AND report_date BETWEEN ? AND ?`, [p, from, to]),
    // The client's own penetration target (dials per account) travels with the Pen Estimation sheet: Dials Required = Download x Penetration.
    empty ? [[]] : db.execute<RowDataPacket[]>(
      `SELECT AVG(penetration) AS target FROM sbi_card_pen_estimation WHERE process_id = ? AND penetration > 0 AND report_date BETWEEN ? AND ?`, [p, from, to]),
  ]);

  const dialer: DialerRow[] = (dRows[0] as RowDataPacket[]).map((r) => ({
    date: String(r.d), campaign: String(r.campaign), accountsCalled: num(r.accounts_called), accountsScheduled: num(r.accounts_scheduled), totalAccounts: num(r.total_accounts), dials: num(r.dials),
    answers: num(r.answers), connects: num(r.connects), ptp: num(r.ptp), pad: num(r.pad), otp: num(r.otp), totalContacts: num(r.total_contacts),
  }));
  const agentRows: AgentRow[] = (aRows[0] as RowDataPacket[]).map((r) => ({
    date: String(r.d), employeeId: String(r.employee_id), dialerId: r.dialer_id ?? null, name: r.agent_name ?? null, team: r.team ?? null,
    teamLeader: r.team_leader ?? null, calls: num(r.calls), contacts: num(r.contacts), ptp: num(r.ptp), pad: num(r.pad), amtCollected: num(r.amt_collected),
    firstLogin: r.fl ?? null, lastLogout: r.ll ?? null, leakageSeconds: num(r.leakage_seconds),
  }));

  let accounts = accountsOf([]);
  let opsRows: AccountOpsRow[] = [];
  const latestDate = (latest[0] as RowDataPacket[])[0]?.d as string | null | undefined;
  if (!empty && latestDate) {
    const attemptCols = [1, 2, 3, 4, 5, 6].map((n) => `DATE_FORMAT(call${n}_dt, '%Y-%m-%d %H:%i:%s') AS c${n}, disp${n}_c AS d${n}, agent${n}_id AS a${n}`).join(", ");
    const [ar] = await db.execute<RowDataPacket[]>(
      `SELECT account_no, delq1, billing_cycle, cibil_score, vintage, region, product_class, account_class, call_table_name, promo_code,
              ntc_flag, new_to_card_flag, total_amount_due, cur_bal, flow, cd, nrr, DATE_FORMAT(date_last_pmt, '%Y-%m-%d') AS lp, cur_bal_plus_dpi, last_action_code, DATE_FORMAT(last_ptp_date, '%Y-%m-%d') AS ptp_d,
              DATE_FORMAT(callback_dt, '%Y-%m-%d %H:%i:%s') AS cb, donotcall, dial_cnt, ${attemptCols}
         FROM sbi_card_account_file WHERE process_id = ? AND report_date = ?`, [p, latestDate]);
    opsRows = ar.map((r) => ({
      accountNo: String(r.account_no), delq: r.delq1 ?? null, billingCycle: r.billing_cycle ?? null, cibil: num(r.cibil_score),
      vintage: num(r.vintage), region: r.region ?? null, productClass: r.product_class ?? null, accountClass: r.account_class ?? null,
      callTable: r.call_table_name ?? null, promo: r.promo_code ?? null, ntc: r.ntc_flag ?? null, newToCard: r.new_to_card_flag ?? null,
      totalDue: num(r.total_amount_due), curBal: num(r.cur_bal), flow: r.flow ?? null, cd: num(r.cd), nrr: r.nrr ?? null, lastPmtDate: r.lp ?? null, dpiBal: num(r.cur_bal_plus_dpi), lastActionCode: r.last_action_code ?? null, lastPtpDate: r.ptp_d ?? null,
      callbackDt: r.cb ?? null, dnc: r.donotcall ?? null, dialCnt: num(r.dial_cnt),
      attempts: [1, 2, 3, 4, 5, 6].map((n) => ({ dt: r[`c${n}`] ?? null, disp: r[`d${n}`] ?? null, agent: r[`a${n}`] ?? null })),
    }));
    accounts = accountsOf(opsRows.map((r): AccountRow => ({ delq: r.delq, billingCycle: r.billingCycle, totalDue: r.totalDue, curBal: r.curBal })));
  }
  const ops = collectionsOps(opsRows, latestDate ?? null);
  const nameByDialer = new Map<string, string>();
  for (const a of agentRows) if (a.dialerId && a.name && !nameByDialer.has(a.dialerId)) nameByDialer.set(String(a.dialerId), a.name);

  const timeIn: AgentTimeRow[] = (timeRows[0] as RowDataPacket[]).map((r) => ({
    date: String(r.d), employeeId: String(r.employee_id), name: r.agent_name ?? null, calls: num(r.calls), loginSec: num(r.login_sec),
    waitSec: num(r.wait_sec), talkSec: num(r.talk_sec), dispoSec: num(r.dispo_sec), pauseSec: num(r.pause_sec), deadSec: num(r.dead_sec),
    achtSec: num(r.acht_sec), firstLogin: r.fl ?? null, lastLogout: r.ll ?? null, lb: num(r.pause_lb_sec), tb: num(r.pause_tb_sec),
    wb: num(r.pause_wb_sec), mb: num(r.pause_mb_sec), qb: num(r.pause_qb_sec), loginCode: num(r.pause_login_sec),
  }));

  const t = totalsOf(dialer);
  const agents = agentsOf(agentRows);
  return {
    range: { from, to },
    campaigns: [...new Set(dialer.map((r) => r.campaign))].sort(),
    summary: {
      accounts: t.accounts, dials: t.dials, answers: t.answers, connects: t.connects, ptp: t.ptp, pad: t.pad, otp: t.otp,
      contactRatePct: t.contactRatePct, connectRatePct: t.connectRatePct, ptpRatePct: t.ptpRatePct,
      amountCollected: Math.round(agents.reduce((n, a) => n + a.amountCollected, 0) * 100) / 100,
      agentsActive: agents.filter((a) => a.calls > 0).length,
      scheduled: t.scheduled, penetration: t.penetration, completionPct: t.completionPct,
      penetrationTarget: num((penRows[0] as RowDataPacket[])[0]?.target) === null ? null : Math.round(Number((penRows[0] as RowDataPacket[])[0]?.target) * 100) / 100,
    },
    daily: dailyRows(dialer),
    byCampaign: byCampaign(dialer),
    agents,
    teams: teamsOf(agents),
    downtime: (tRows[0] as RowDataPacket[]).map((r) => ({
      date: String(r.d), startTime: r.st ?? null, upTime: r.ut ?? null, downtimeMinutes: num(r.downtime_minutes) ?? 0,
      impactedUsers: num(r.impacted_users) ?? 0, reason: r.reason ?? null, status: r.status ?? null,
    })),
    accounts,
    agentTime: agentTimeOf(timeIn),
    collections: { ...ops, agents: ops.agents.map((a) => ({ ...a, name: nameByDialer.get(a.agentId) ?? null })) },
  };
}
