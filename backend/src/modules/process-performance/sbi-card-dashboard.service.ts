import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  totalsOf, dailyRows, byCampaign, agentsOf, teamsOf, accountsOf,
  type DialerRow, type AgentRow, type AccountRow, type DailyOut, type CampaignOut, type AgentOut, type TeamOut, type AccountsOut,
} from "./sbi-card-dashboard.calc.js";

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
  };
  daily: DailyOut[];
  byCampaign: CampaignOut[];
  agents: AgentOut[];
  teams: TeamOut[];
  downtime: Array<{ date: string; startTime: string | null; upTime: string | null; downtimeMinutes: number; impactedUsers: number; reason: string | null; status: string | null }>;
  accounts: AccountsOut;
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

  const [dRows, aRows, tRows, latest] = await Promise.all([
    empty ? [[]] : db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, campaign, accounts_called, total_accounts, dials, answers, connects, ptp, pad, otp, total_contacts
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
  ]);

  const dialer: DialerRow[] = (dRows[0] as RowDataPacket[]).map((r) => ({
    date: String(r.d), campaign: String(r.campaign), accountsCalled: num(r.accounts_called), totalAccounts: num(r.total_accounts), dials: num(r.dials),
    answers: num(r.answers), connects: num(r.connects), ptp: num(r.ptp), pad: num(r.pad), otp: num(r.otp), totalContacts: num(r.total_contacts),
  }));
  const agentRows: AgentRow[] = (aRows[0] as RowDataPacket[]).map((r) => ({
    date: String(r.d), employeeId: String(r.employee_id), dialerId: r.dialer_id ?? null, name: r.agent_name ?? null, team: r.team ?? null,
    teamLeader: r.team_leader ?? null, calls: num(r.calls), contacts: num(r.contacts), ptp: num(r.ptp), pad: num(r.pad), amtCollected: num(r.amt_collected),
    firstLogin: r.fl ?? null, lastLogout: r.ll ?? null, leakageSeconds: num(r.leakage_seconds),
  }));

  let accounts = accountsOf([]);
  const latestDate = (latest[0] as RowDataPacket[])[0]?.d as string | null | undefined;
  if (!empty && latestDate) {
    const [ar] = await db.execute<RowDataPacket[]>(
      `SELECT delq1, billing_cycle, total_amount_due, cur_bal FROM sbi_card_account_file WHERE process_id = ? AND report_date = ?`, [p, latestDate]);
    const rows: AccountRow[] = ar.map((r) => ({ delq: r.delq1 ?? null, billingCycle: r.billing_cycle ?? null, totalDue: num(r.total_amount_due), curBal: num(r.cur_bal) }));
    accounts = accountsOf(rows);
  }

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
  };
}
