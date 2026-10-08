/**
 * SBI Card Collections dashboard -- pure calculations (no DB), fed by rows of sbi_card_dialer_mis / sbi_card_agent_mis /
 * sbi_card_downtime / sbi_card_account_file.
 *
 * Definitions (read off the client's own DIALER MIS workbook formulas):
 *   accounts          Accounts Called (falls back to Total Accounts when a sheet leaves it blank), summed over days.
 *   Contact Rate %    TOTAL Contacts / Accounts Called          (the workbook's "Contact / Accounts called")
 *   Connect Rate %    Connects / Dials                          (workbook "Connect Rate")
 *   PTP Rate %        PTP / TOTAL Contacts                      (workbook "PTP Rate")
 * ROLLUPS: sheets "Master" and "Overall ..." (see isRollupCampaign) sum the real campaigns, so they are stored with is_rollup = 1
 * and excluded by the loader; nothing here ever receives them. Empty / zero denominators give 0, never NaN.
 */

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const pct = (num: number, den: number): number => (den > 0 ? round1((num / den) * 100) : 0);
const n0 = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface DialerRow {
  date: string; campaign: string; accountsCalled: number | null; accountsScheduled?: number | null; totalAccounts: number | null; dials: number | null; answers: number | null;
  connects: number | null; ptp: number | null; pad: number | null; otp: number | null; totalContacts: number | null;
}
export interface DialerTotals {
  accounts: number; dials: number; answers: number; connects: number; ptp: number; pad: number; otp: number;
  contacts: number; contactRatePct: number; connectRatePct: number; ptpRatePct: number;
  /** The client's workbook definitions: Penetration = Dials / Accounts Scheduled (dials per account), Completion = Accounts Called / Accounts Scheduled. */
  scheduled: number; called: number; penetration: number; completionPct: number;
}
export interface DailyOut { date: string; campaign: string; accounts: number; dials: number; answers: number; connects: number; ptp: number; pad: number; otp: number; contacts: number; contactRatePct: number; ptpRatePct: number }
export interface CampaignOut { campaign: string; accounts: number; dials: number; answers: number; connects: number; ptp: number; pad: number; otp: number; contactRatePct: number; ptpRatePct: number }

export function totalsOf(rows: DialerRow[]): DialerTotals {
  const t = { accounts: 0, dials: 0, answers: 0, connects: 0, ptp: 0, pad: 0, otp: 0, contacts: 0 };
  let scheduled = 0; let called = 0;
  for (const r of rows) {
    t.accounts += n0(r.accountsCalled ?? r.totalAccounts); t.dials += n0(r.dials); t.answers += n0(r.answers);
    scheduled += n0(r.accountsScheduled); called += n0(r.accountsCalled); t.connects += n0(r.connects); t.ptp += n0(r.ptp); t.pad += n0(r.pad); t.otp += n0(r.otp); t.contacts += n0(r.totalContacts);
  }
  return {
    ...t, scheduled, called, penetration: scheduled > 0 ? Math.round((t.dials / scheduled) * 100) / 100 : 0, completionPct: pct(called, scheduled),
    contactRatePct: pct(t.contacts, t.accounts), connectRatePct: pct(t.connects, t.dials), ptpRatePct: pct(t.ptp, t.contacts),
  };
}

export function dailyRows(rows: DialerRow[]): DailyOut[] {
  return rows
    .map((r) => {
      const t = totalsOf([r]);
      return {
        date: r.date, campaign: r.campaign, accounts: t.accounts, dials: t.dials, answers: t.answers, connects: t.connects,
        ptp: t.ptp, pad: t.pad, otp: t.otp, contacts: t.contacts, contactRatePct: t.contactRatePct, ptpRatePct: t.ptpRatePct,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign));
}

export function byCampaign(rows: DialerRow[]): CampaignOut[] {
  const groups = new Map<string, DialerRow[]>();
  for (const r of rows) groups.set(r.campaign, [...(groups.get(r.campaign) ?? []), r]);
  return [...groups.entries()]
    .map(([campaign, rs]) => {
      const t = totalsOf(rs);
      return { campaign, accounts: t.accounts, dials: t.dials, answers: t.answers, connects: t.connects, ptp: t.ptp, pad: t.pad, otp: t.otp, contactRatePct: t.contactRatePct, ptpRatePct: t.ptpRatePct };
    })
    .sort((a, b) => a.campaign.localeCompare(b.campaign));
}

export interface AgentRow {
  date: string; employeeId: string; dialerId: string | null; name: string | null; team: string | null; teamLeader: string | null;
  calls: number | null; contacts: number | null; ptp: number | null; pad: number | null; amtCollected: number | null;
  firstLogin: string | null; lastLogout: string | null; leakageSeconds: number | null;
}
export interface AgentOut {
  employeeId: string; dialerId: string | null; name: string | null; team: string | null; teamLeader: string | null; calls: number; contacts: number;
  ptp: number; pad: number; amountCollected: number; firstLogin: string | null; lastLogout: string | null; leakage: number; days: number;
}
export interface TeamOut { team: string; teamLeader: string | null; agents: number; calls: number; contacts: number; ptp: number; pad: number; amountCollected: number }

/** Per agent over the range. firstLogin = earliest first login of any day, lastLogout = latest logout, leakage = total minutes leaked, days = days with a row. */
export function agentsOf(rows: AgentRow[]): AgentOut[] {
  const m = new Map<string, AgentOut>();
  for (const r of rows) {
    const a = m.get(r.employeeId) ?? {
      employeeId: r.employeeId, dialerId: r.dialerId, name: r.name, team: r.team, teamLeader: r.teamLeader, calls: 0, contacts: 0, ptp: 0, pad: 0,
      amountCollected: 0, firstLogin: null, lastLogout: null, leakage: 0, days: 0,
    };
    a.name = a.name ?? r.name; a.team = a.team ?? r.team; a.teamLeader = a.teamLeader ?? r.teamLeader; a.dialerId = a.dialerId ?? r.dialerId;
    a.calls += n0(r.calls); a.contacts += n0(r.contacts); a.ptp += n0(r.ptp); a.pad += n0(r.pad); a.amountCollected += n0(r.amtCollected);
    if (r.firstLogin && (!a.firstLogin || r.firstLogin < a.firstLogin)) a.firstLogin = r.firstLogin;
    if (r.lastLogout && (!a.lastLogout || r.lastLogout > a.lastLogout)) a.lastLogout = r.lastLogout;
    a.leakage += n0(r.leakageSeconds) / 60; a.days += 1;
    m.set(r.employeeId, a);
  }
  return [...m.values()].map((a) => ({ ...a, leakage: round1(a.leakage) })).sort((x, y) => y.calls - x.calls || x.employeeId.localeCompare(y.employeeId));
}

export function teamsOf(agents: AgentOut[]): TeamOut[] {
  const m = new Map<string, TeamOut>();
  for (const a of agents) {
    const team = a.team ?? "Unassigned";
    const key = `${team}|${a.teamLeader ?? ""}`;
    const t = m.get(key) ?? { team, teamLeader: a.teamLeader, agents: 0, calls: 0, contacts: 0, ptp: 0, pad: 0, amountCollected: 0 };
    t.agents += 1; t.calls += a.calls; t.contacts += a.contacts; t.ptp += a.ptp; t.pad += a.pad; t.amountCollected += a.amountCollected;
    m.set(key, t);
  }
  return [...m.values()].sort((x, y) => y.calls - x.calls || x.team.localeCompare(y.team));
}

export interface AccountRow { delq: string | null; billingCycle: string | null; totalDue: number | null; curBal: number | null }
export interface AccountsOut {
  total: number; totalDue: number; curBal: number;
  byDelq: Array<{ delq: string; count: number; totalDue: number }>; byBillingCycle: Array<{ cycle: string; count: number }>;
}
export function accountsOf(rows: AccountRow[]): AccountsOut {
  const d = new Map<string, { count: number; totalDue: number }>();
  const c = new Map<string, number>();
  let totalDue = 0; let curBal = 0;
  for (const r of rows) {
    totalDue += n0(r.totalDue); curBal += n0(r.curBal);
    const dk = r.delq ?? "Unknown"; const cur = d.get(dk) ?? { count: 0, totalDue: 0 };
    d.set(dk, { count: cur.count + 1, totalDue: cur.totalDue + n0(r.totalDue) });
    const ck = r.billingCycle ?? "Unknown"; c.set(ck, (c.get(ck) ?? 0) + 1);
  }
  const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return {
    total: rows.length, totalDue: Math.round(totalDue * 100) / 100, curBal: Math.round(curBal * 100) / 100,
    byDelq: [...d.entries()].map(([delq, v]) => ({ delq, count: v.count, totalDue: Math.round(v.totalDue * 100) / 100 })).sort((a, b) => natural(a.delq, b.delq)),
    byBillingCycle: [...c.entries()].map(([cycle, count]) => ({ cycle, count })).sort((a, b) => natural(a.cycle, b.cycle)),
  };
}
