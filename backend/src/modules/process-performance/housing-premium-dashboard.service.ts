import { db } from "../../db/mysql.js";

/**
 * Housing Premium's real "Sale Performance" dashboard -- live aggregates
 * over db_masmis.pre_sale (order-level sales), db_masmis.pre_agent_details
 * (agent roster with real target/achievement/ach_pct, uploaded directly --
 * not recomputed) and db_masmis.Pre_cdr (raw per-call records, one row per
 * call), via GET /api/process-performance/housing-premium-dashboard.
 *
 * All three tables are genuinely thin right now -- confirmed live
 * 2026-09-17: pre_sale has 3 rows, pre_agent_details has 4 rows, Pre_cdr
 * has 4 rows, all uploaded 2026-09-15. The numbers below are real, just
 * small; they will grow as more files are uploaded.
 *
 * No date-range filter: pre_sale's report_date/created_date columns are
 * NULL on every current row (only a free-text `week` column like "Week-1"
 * is populated), so there is no reliable date to filter sales by yet. This
 * dashboard shows all currently uploaded data rather than fabricate a date
 * range from an unreliable field. Pre_cdr does have a real report_date,
 * but sale and call figures are kept on the same "all data" basis so the
 * headline stays internally consistent. Add real date filtering once
 * pre_sale's date columns are actually populated.
 *
 * pre_agent_details already carries target/achievement/ach_pct as reported
 * by the uploaded roster file itself -- used as-is (real uploaded numbers),
 * not recomputed from pre_sale, since the two are the same underlying
 * figures the source file already computed.
 */

export interface HousingPremiumHeadline {
  totalRevenue: number;
  totalSaleCount: number;
  aov: number;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
  activeAgents: number;
  totalTarget: number;
  totalAchievement: number;
  achievementPct: number;
}

export interface HousingPremiumGroupRow {
  tlName: string;
  agentCount: number;
  target: number;
  achievement: number;
  achievementPct: number;
  revenue: number;
  saleCount: number;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
}

export interface HousingPremiumAgentRow {
  empId: string | null;
  name: string;
  tlName: string;
  center: string;
  doj: string | null;
  tenureDays: number | null;
  bucket: string | null;
  status: string;
  target: number;
  achievement: number;
  achievementPct: number;
  revenue: number;
  saleCount: number;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
}

export interface HousingPremiumDashboardData {
  headline: HousingPremiumHeadline;
  byTl: HousingPremiumGroupRow[];
  agents: HousingPremiumAgentRow[];
  partnerBreakdown: { partnerName: string; revenue: number; saleCount: number }[];
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

/** doj is stored as free text like "3/21/26" (M/D/YY). Parses to a real
 * tenure-in-days figure the same way GNC's dashboard derives Tenure from a
 * real date column, instead of trusting an uploaded "tenure" text field
 * that goes stale the moment it's not re-uploaded. */
function tenureDaysFromDoj(doj: unknown): number | null {
  const m = String(doj ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const year = 2000 + parseInt(m[3], 10);
  const d = new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function tenureBucket(days: number | null): string {
  if (days === null) return "Unknown";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  if (days <= 180) return "121-180";
  return "180 Above";
}

interface RosterAgent {
  empId: string | null;
  name: string;
  tlName: string;
  center: string;
  doj: string | null;
  status: string;
  target: number;
  achievement: number;
}

interface SaleAgg {
  revenue: number;
  saleCount: number;
}

interface CdrAgg {
  totalCalls: number;
  connected: number;
  talkSecSum: number;
}

export async function getHousingPremiumDashboard(): Promise<HousingPremiumDashboardData> {
  const [agentRows] = await db.execute<any[]>(
    `SELECT emp_id, agent_name, tl_name, center, doj, status, target, achievement
     FROM db_masmis.pre_agent_details`,
  );
  const [saleRows] = await db.execute<any[]>(
    `SELECT agent_name, tl_name, partner_name, amount
     FROM db_masmis.pre_sale`,
  );
  const [cdrRows] = await db.execute<any[]>(
    `SELECT member, tl_name, status, duration, talk_duration
     FROM db_masmis.Pre_cdr`,
  );

  const roster = new Map<string, RosterAgent>();
  for (const r of agentRows as any[]) {
    const name = normalizeName(r.agent_name);
    if (!name) continue;
    roster.set(name, {
      empId: r.emp_id ?? null,
      name,
      tlName: normalizeName(r.tl_name) || "Unassigned",
      center: normalizeName(r.center) || "Unknown",
      doj: r.doj ?? null,
      status: r.status ?? "Unknown",
      target: num(r.target),
      achievement: num(r.achievement),
    });
  }

  const saleAggByName = new Map<string, SaleAgg>();
  const saleAggByTl = new Map<string, SaleAgg>();
  const partnerMap = new Map<string, SaleAgg>();

  for (const r of saleRows as any[]) {
    const value = num(r.amount);
    const name = normalizeName(r.agent_name);
    if (name) {
      const cur = saleAggByName.get(name) ?? { revenue: 0, saleCount: 0 };
      cur.revenue += value;
      cur.saleCount += 1;
      saleAggByName.set(name, cur);
    }
    const tl = normalizeName(r.tl_name) || "Unassigned";
    const tlCur = saleAggByTl.get(tl) ?? { revenue: 0, saleCount: 0 };
    tlCur.revenue += value;
    tlCur.saleCount += 1;
    saleAggByTl.set(tl, tlCur);

    const partner = normalizeName(r.partner_name) || "Unknown";
    const pCur = partnerMap.get(partner) ?? { revenue: 0, saleCount: 0 };
    pCur.revenue += value;
    pCur.saleCount += 1;
    partnerMap.set(partner, pCur);
  }

  const cdrAggByName = new Map<string, CdrAgg>();
  const cdrAggByTl = new Map<string, CdrAgg>();

  function addCdr(map: Map<string, CdrAgg>, key: string, connected: boolean, talkSec: number) {
    const cur = map.get(key) ?? { totalCalls: 0, connected: 0, talkSecSum: 0 };
    cur.totalCalls += 1;
    if (connected) cur.connected += 1;
    cur.talkSecSum += talkSec;
    map.set(key, cur);
  }

  for (const r of cdrRows as any[]) {
    const connected = String(r.status ?? "").trim().toLowerCase() === "answered";
    const talkSec = num(r.talk_duration);
    const name = normalizeName(r.member);
    if (name) addCdr(cdrAggByName, name, connected, talkSec);
    addCdr(cdrAggByTl, normalizeName(r.tl_name) || "Unassigned", connected, talkSec);
  }

  const allNames = new Set<string>([...roster.keys(), ...saleAggByName.keys(), ...cdrAggByName.keys()]);

  const agents: HousingPremiumAgentRow[] = [];
  for (const name of allNames) {
    const ro = roster.get(name);
    const sale = saleAggByName.get(name);
    const cdr = cdrAggByName.get(name);
    const tenureDays = tenureDaysFromDoj(ro?.doj);

    agents.push({
      empId: ro?.empId ?? null,
      name,
      tlName: ro?.tlName ?? "Unmapped",
      center: ro?.center ?? "Unknown",
      doj: ro?.doj ?? null,
      tenureDays,
      bucket: tenureBucket(tenureDays),
      status: ro?.status ?? (sale || cdr ? "Unmapped" : "Unknown"),
      target: ro?.target ?? 0,
      achievement: ro?.achievement ?? 0,
      achievementPct: ro && ro.target > 0 ? Math.round((ro.achievement / ro.target) * 10000) / 100 : 0,
      revenue: sale?.revenue ?? 0,
      saleCount: sale?.saleCount ?? 0,
      totalCalls: cdr?.totalCalls ?? 0,
      connectedCalls: cdr?.connected ?? 0,
      connectedPct: cdr && cdr.totalCalls > 0 ? Math.round((cdr.connected / cdr.totalCalls) * 10000) / 100 : 0,
      avgTalkTimeSec: cdr && cdr.totalCalls > 0 ? Math.round(cdr.talkSecSum / cdr.totalCalls) : 0,
    });
  }
  agents.sort((a, b) => b.revenue - a.revenue);

  const targetByTl = new Map<string, number>();
  const achievementByTl = new Map<string, number>();
  const agentCountByTl = new Map<string, number>();
  for (const ro of roster.values()) {
    targetByTl.set(ro.tlName, (targetByTl.get(ro.tlName) ?? 0) + ro.target);
    achievementByTl.set(ro.tlName, (achievementByTl.get(ro.tlName) ?? 0) + ro.achievement);
    agentCountByTl.set(ro.tlName, (agentCountByTl.get(ro.tlName) ?? 0) + 1);
  }

  const tlNames = new Set<string>([...saleAggByTl.keys(), ...cdrAggByTl.keys(), ...targetByTl.keys()]);
  const byTl: HousingPremiumGroupRow[] = [...tlNames].map((tlName) => {
    const sale = saleAggByTl.get(tlName);
    const cdr = cdrAggByTl.get(tlName);
    const target = targetByTl.get(tlName) ?? 0;
    const achievement = achievementByTl.get(tlName) ?? 0;
    const totalCalls = cdr?.totalCalls ?? 0;
    return {
      tlName,
      agentCount: agentCountByTl.get(tlName) ?? 0,
      target,
      achievement,
      achievementPct: target > 0 ? Math.round((achievement / target) * 10000) / 100 : 0,
      revenue: sale?.revenue ?? 0,
      saleCount: sale?.saleCount ?? 0,
      totalCalls,
      connectedCalls: cdr?.connected ?? 0,
      connectedPct: totalCalls > 0 ? Math.round(((cdr?.connected ?? 0) / totalCalls) * 10000) / 100 : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = agents.reduce((s, a) => s + a.revenue, 0);
  const totalSaleCount = agents.reduce((s, a) => s + a.saleCount, 0);
  const totalCalls = agents.reduce((s, a) => s + a.totalCalls, 0);
  const connectedCalls = agents.reduce((s, a) => s + a.connectedCalls, 0);
  const activeAgentsArr = [...roster.values()].filter((r) => r.status === "Active");
  const totalTarget = activeAgentsArr.reduce((s, r) => s + r.target, 0);
  const totalAchievement = activeAgentsArr.reduce((s, r) => s + r.achievement, 0);
  const talkAgents = agents.filter((a) => a.totalCalls > 0);
  const avgTalkTimeSec = talkAgents.length > 0
    ? Math.round(talkAgents.reduce((s, a) => s + a.avgTalkTimeSec, 0) / talkAgents.length)
    : 0;

  const headline: HousingPremiumHeadline = {
    totalRevenue,
    totalSaleCount,
    aov: totalSaleCount > 0 ? Math.round((totalRevenue / totalSaleCount) * 100) / 100 : 0,
    totalCalls,
    connectedCalls,
    connectedPct: totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 10000) / 100 : 0,
    avgTalkTimeSec,
    activeAgents: activeAgentsArr.length,
    totalTarget,
    totalAchievement,
    achievementPct: totalTarget > 0 ? Math.round((totalAchievement / totalTarget) * 10000) / 100 : 0,
  };

  const partnerBreakdown = [...partnerMap.entries()]
    .map(([partnerName, v]) => ({ partnerName, revenue: v.revenue, saleCount: v.saleCount }))
    .sort((a, b) => b.revenue - a.revenue);

  return { headline, byTl, agents, partnerBreakdown };
}
