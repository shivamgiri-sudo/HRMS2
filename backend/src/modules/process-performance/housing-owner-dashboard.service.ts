import { db } from "../../db/mysql.js";

export interface HousingOwnerHeadline {
  totalRevenue: number;
  totalSaleCount: number;
  aov: number;
  totalCalls: number;
  connectedCalls: number;
  notConnectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
  activeAgents: number;
  totalTarget: number;
  totalMtdReported: number;
  achievementPct: number;
  /** totalRevenue / activeAgents -- 0 when there are no active agents. */
  revenuePerAgent: number;
}

export interface HousingOwnerGroupRow {
  name: string;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  revenue: number;
  saleCount: number;
  target: number;
  achievementPct: number;
  aov: number;
  /** Count of this TL's/AM's own active roster agents -- the denominator
   * behind rpa (revenue / agentCount). Same "Active" roster filter the
   * headline's activeAgents count uses. */
  agentCount: number;
  rpa: number;
  /** Count of this TL's/AM's own roster agents landing in each achievement
   * stage (see stageFor: TQ >=80%, MQ >=50-79%, BQ <50%) -- agents with no
   * target of their own don't count toward any of the three. */
  tqCount: number;
  mqCount: number;
  bqCount: number;
}

export interface HousingOwnerAgentRow {
  empId: string | null;
  name: string;
  tlName: string;
  am: string;
  doj: string | null;
  tenureDays: number | null;
  bucket: string | null;
  status: string;
  target: number;
  mtdReported: number;
  totalCalls: number;
  connectedCalls: number;
  notConnectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
  saleCount: number;
  revenue: number;
  achievementPct: number;
  stage: "TQ" | "MQ" | "BQ" | "NA";
}

export interface HousingOwnerFilterOptions {
  tls: string[];
  ams: string[];
  /** AM -> the TLs seen under that AM, so the UI can narrow the TL list once an AM is picked. */
  tlByAm: Record<string, string[]>;
}

export interface HousingOwnerDashboardData {
  filterOptions: HousingOwnerFilterOptions;
  appliedFilters: { tl: string | null; am: string | null };
  headline: HousingOwnerHeadline;
  byAm: HousingOwnerGroupRow[];
  byTl: HousingOwnerGroupRow[];
  agents: HousingOwnerAgentRow[];
  topPerformers: HousingOwnerAgentRow[];
  bottomPerformers: HousingOwnerAgentRow[];
  packageTypeBreakdown: { packageType: string; count: number; revenue: number }[];
  dailyTrend: { date: string; revenue: number; saleCount: number; totalCalls: number; connectedCalls: number }[];
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function timeToSec(v: unknown): number {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function normalizeName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** owner_sale has no real date column -- only `month` ("Sep'26") and `day`
 * ("1".."31") text fields. Reconstructs a YYYY-MM-DD string from them so it
 * can be compared against the requested range with a plain string compare
 * (fixed-width format, so lexicographic order == chronological order --
 * safer than routing through Date/toISOString, which has bitten this app's
 * "local date" logic before via UTC conversion). */
function saleRowDate(monthField: unknown, dayField: unknown): string | null {
  const m = String(monthField ?? "").trim().match(/^([A-Za-z]{3})'(\d{2})$/);
  if (!m) return null;
  const mon = MONTH_MAP[m[1].toLowerCase()];
  if (!mon) return null;
  const day = parseInt(String(dayField ?? ""), 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return `20${m[2]}-${mon}-${String(day).padStart(2, "0")}`;
}

/** Owner_cdr.report_date is a real date, but stored as text like
 * "15-Sep-26" rather than a DATE column -- parsed the same way as
 * saleRowDate for a consistent YYYY-MM-DD comparison key. */
function cdrRowDate(reportDate: unknown): string | null {
  const m = String(reportDate ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mon = MONTH_MAP[m[2].toLowerCase()];
  if (!mon) return null;
  return `20${m[3]}-${mon}-${String(m[1]).padStart(2, "0")}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 1st of the current month .. today, in local time -- deliberately NOT
 * via toISOString(), which converts through UTC and rolls the date back a
 * day for a viewer ahead of UTC (e.g. IST, UTC+5:30). Same fix already
 * applied to the Bellavita dashboard's date range default. */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const to = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return { from, to };
}

function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Days in a "YYYY-MM-DD" date's own calendar month -- used to turn one flat
 * monthly target into that day's fair share of it. */
function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function stageFor(achievementPct: number, hasTarget: boolean): "TQ" | "MQ" | "BQ" | "NA" {
  if (!hasTarget) return "NA";
  if (achievementPct >= 80) return "TQ";
  if (achievementPct >= 50) return "MQ";
  return "BQ";
}

interface RosterAgent {
  empId: string | null;
  name: string;
  tlName: string;
  am: string;
  doj: string | null;
  tenureDays: number | null;
  bucket: string | null;
  status: string;
  target: number;
  mtdReported: number;
}

interface SaleAgg {
  revenue: number;
  saleCount: number;
}

interface CdrAgg {
  totalCalls: number;
  connected: number;
  notConnected: number;
  talkSecSum: number;
  talkRows: number;
  tlName?: string;
  am?: string;
}

export async function getHousingOwnerDashboard(
  fromInput: string, toInput: string, tlInput = "", amInput = "",
): Promise<HousingOwnerDashboardData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const tlFilter = normalizeName(tlInput);
  const amFilter = normalizeName(amInput);
  const filterActive = tlFilter !== "" || amFilter !== "";

  const [agentRows] = await db.execute<any[]>(
    `SELECT sno, crm_id, overall, tl_name, doj, status, ageing, bucket, monthly_target, per_day_target, mtd, am
     FROM db_masmis.owner_agent_details`
  );
  const [saleRows] = await db.execute<any[]>(
    `SELECT opp_id, agent_id, agent_name, tl_name, am, value, sale_count, package_type, payment_mode, day, week, month
     FROM db_masmis.owner_sale`
  );
  const [cdrRows] = await db.execute<any[]>(
    `SELECT agent, tl_name, am, total_calls, connected, not_connected, avg_talk_time, report_date, day
     FROM db_masmis.Owner_cdr`
  );

  const roster = new Map<string, RosterAgent>();
  for (const r of agentRows as any[]) {
    const name = normalizeName(r.overall);
    if (!name) continue;
    roster.set(name, {
      empId: r.crm_id ?? null,
      name,
      tlName: normalizeName(r.tl_name) || "Unassigned",
      am: normalizeName(r.am) || "Unassigned",
      doj: r.doj ?? null,
      tenureDays: null,
      bucket: r.bucket ?? null,
      status: r.status ?? "Unknown",
      target: num(r.monthly_target),
      mtdReported: num(r.mtd),
    });
  }

  // An agent's TL / AM comes from the roster when they are on it, otherwise from the
  // row itself -- the same precedence the agent table uses, so a TL / AM filter keeps
  // the KPIs, charts and tables describing the same set of agents.
  const rosterMatches = (ro: RosterAgent) =>
    (!tlFilter || ro.tlName === tlFilter) && (!amFilter || ro.am === amFilter);
  const rowMatches = (agentName: string, rowTl: unknown, rowAm: unknown) => {
    if (!filterActive) return true;
    const ro = roster.get(agentName);
    if (ro) return rosterMatches(ro);
    const tl = normalizeName(rowTl) || "Unassigned";
    const am = normalizeName(rowAm) || "Unassigned";
    return (!tlFilter || tl === tlFilter) && (!amFilter || am === amFilter);
  };
  const tlSet = new Set<string>();
  const amSet = new Set<string>();
  const tlByAmSets = new Map<string, Set<string>>();
  const noteTlAm = (tl: string, am: string) => {
    tlSet.add(tl);
    amSet.add(am);
    const cur = tlByAmSets.get(am) ?? new Set<string>();
    cur.add(tl);
    tlByAmSets.set(am, cur);
  };
  for (const ro of roster.values()) noteTlAm(ro.tlName, ro.am);

  const saleAggByName = new Map<string, SaleAgg>();
  const saleAggByAm = new Map<string, SaleAgg>();
  const saleAggByTl = new Map<string, SaleAgg>();
  const packageTypeMap = new Map<string, { count: number; revenue: number }>();
  const dailyRevenue = new Map<string, { revenue: number; saleCount: number }>();

  // The same opportunity is sometimes uploaded more than once (the Sep-1 rows exist in 4 upload
  // batches), which multiplies revenue / sale count -- count each identical sale once.
  const seenSales = new Set<string>();
  for (const r of saleRows as any[]) {
    const rowDate = saleRowDate(r.month, r.day);
    if (rowDate === null || rowDate < from || rowDate > to) continue;
    const oppId = String(r.opp_id ?? "").trim();
    if (oppId) {
      const key = `${oppId}|${normalizeName(r.agent_name)}|${num(r.value)}|${String(r.package_type ?? "").trim()}`;
      if (seenSales.has(key)) continue;
      seenSales.add(key);
    }

    const name = normalizeName(r.agent_name);
    noteTlAm(normalizeName(r.tl_name) || "Unassigned", normalizeName(r.am) || "Unassigned");
    if (!rowMatches(name, r.tl_name, r.am)) continue;
    const value = num(r.value);
    const count = num(r.sale_count) || 1;

    if (name) {
      const cur = saleAggByName.get(name) ?? { revenue: 0, saleCount: 0 };
      cur.revenue += value;
      cur.saleCount += count;
      saleAggByName.set(name, cur);
    }
    const am = normalizeName(r.am) || "Unassigned";
    const amCur = saleAggByAm.get(am) ?? { revenue: 0, saleCount: 0 };
    amCur.revenue += value;
    amCur.saleCount += count;
    saleAggByAm.set(am, amCur);

    const tl = normalizeName(r.tl_name) || "Unassigned";
    const tlCur = saleAggByTl.get(tl) ?? { revenue: 0, saleCount: 0 };
    tlCur.revenue += value;
    tlCur.saleCount += count;
    saleAggByTl.set(tl, tlCur);

    const pkg = String(r.package_type ?? "Unknown").trim() || "Unknown";
    const pkgCur = packageTypeMap.get(pkg) ?? { count: 0, revenue: 0 };
    pkgCur.count += 1;
    pkgCur.revenue += value;
    packageTypeMap.set(pkg, pkgCur);

    const dCur = dailyRevenue.get(rowDate) ?? { revenue: 0, saleCount: 0 };
    dCur.revenue += value;
    dCur.saleCount += count;
    dailyRevenue.set(rowDate, dCur);
  }

  const cdrAggByName = new Map<string, CdrAgg>();
  const cdrAggByAm = new Map<string, CdrAgg>();
  const cdrAggByTl = new Map<string, CdrAgg>();
  const dailyCalls = new Map<string, { totalCalls: number; connected: number }>();

  function addCdr(map: Map<string, CdrAgg>, key: string, calls: number, connected: number, notConnected: number, talkSec: number, hasTalk: boolean) {
    const cur = map.get(key) ?? { totalCalls: 0, connected: 0, notConnected: 0, talkSecSum: 0, talkRows: 0 };
    cur.totalCalls += calls;
    cur.connected += connected;
    cur.notConnected += notConnected;
    if (hasTalk) {
      cur.talkSecSum += talkSec;
      cur.talkRows += 1;
    }
    map.set(key, cur);
  }

  // Re-uploaded CDR days (agent + day + identical counters) are counted once.
  const seenCdr = new Set<string>();
  for (const r of cdrRows as any[]) {
    const rowDate = cdrRowDate(r.report_date);
    if (rowDate === null || rowDate < from || rowDate > to) continue;
    const cdrKey = [normalizeName(r.agent), rowDate, r.total_calls, r.connected, r.not_connected, r.avg_talk_time].join("|");
    if (seenCdr.has(cdrKey)) continue;
    seenCdr.add(cdrKey);

    const name = normalizeName(r.agent);
    noteTlAm(normalizeName(r.tl_name) || "Unassigned", normalizeName(r.am) || "Unassigned");
    if (!rowMatches(name, r.tl_name, r.am)) continue;
    const calls = num(r.total_calls);
    const connected = num(r.connected);
    const notConnected = num(r.not_connected);
    const talkStr = String(r.avg_talk_time ?? "").trim();
    const hasTalk = talkStr !== "" && talkStr !== "0:00:00";
    const talkSec = hasTalk ? timeToSec(talkStr) : 0;

    if (name) addCdr(cdrAggByName, name, calls, connected, notConnected, talkSec, hasTalk);
    addCdr(cdrAggByAm, normalizeName(r.am) || "Unassigned", calls, connected, notConnected, talkSec, hasTalk);
    addCdr(cdrAggByTl, normalizeName(r.tl_name) || "Unassigned", calls, connected, notConnected, talkSec, hasTalk);

    const dCur = dailyCalls.get(rowDate) ?? { totalCalls: 0, connected: 0 };
    dCur.totalCalls += calls;
    dCur.connected += connected;
    dailyCalls.set(rowDate, dCur);
  }

  const allNames = new Set<string>([...roster.keys(), ...saleAggByName.keys(), ...cdrAggByName.keys()]);

  const agents: HousingOwnerAgentRow[] = [];
  for (const name of allNames) {
    const ro = roster.get(name);
    if (ro && !rosterMatches(ro)) continue;
    const sale = saleAggByName.get(name);
    const cdr = cdrAggByName.get(name);

    const target = ro?.target ?? 0;
    const revenue = sale?.revenue ?? 0;
    const saleCount = sale?.saleCount ?? 0;
    const totalCalls = cdr?.totalCalls ?? 0;
    const connectedCalls = cdr?.connected ?? 0;
    const notConnectedCalls = cdr?.notConnected ?? 0;
    const achievementPct = target > 0 ? (revenue / target) * 100 : 0;

    agents.push({
      empId: ro?.empId ?? null,
      name,
      tlName: ro?.tlName ?? "Unmapped",
      am: ro?.am ?? "Unmapped",
      doj: ro?.doj ?? null,
      tenureDays: null,
      bucket: ro?.bucket ?? null,
      status: ro?.status ?? (sale || cdr ? "Unmapped" : "Unknown"),
      target,
      mtdReported: ro?.mtdReported ?? 0,
      totalCalls,
      connectedCalls,
      notConnectedCalls,
      connectedPct: totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0,
      avgTalkTimeSec: cdr && cdr.talkRows > 0 ? cdr.talkSecSum / cdr.talkRows : 0,
      saleCount,
      revenue,
      achievementPct,
      stage: stageFor(achievementPct, target > 0),
    });
  }
  agents.sort((a, b) => b.revenue - a.revenue);

  // Tally each TL's/AM's own agents by achievement stage, from the same
  // per-agent `stage` just computed above -- so the two counts (group table,
  // agent table) can never disagree.
  interface StageCounts { tq: number; mq: number; bq: number }
  function bumpStage(map: Map<string, StageCounts>, key: string, stage: "TQ" | "MQ" | "BQ" | "NA"): void {
    if (stage === "NA") return;
    const cur = map.get(key) ?? { tq: 0, mq: 0, bq: 0 };
    if (stage === "TQ") cur.tq += 1;
    else if (stage === "MQ") cur.mq += 1;
    else cur.bq += 1;
    map.set(key, cur);
  }
  const stageCountsByTl = new Map<string, StageCounts>();
  const stageCountsByAm = new Map<string, StageCounts>();
  for (const a of agents) {
    bumpStage(stageCountsByTl, a.tlName, a.stage);
    bumpStage(stageCountsByAm, a.am, a.stage);
  }

  function toGroupRows(
    saleMap: Map<string, SaleAgg>, cdrMap: Map<string, CdrAgg>, targetByGroup: Map<string, number>,
    stageCounts: Map<string, StageCounts>, agentCountByGroup: Map<string, number>,
  ): HousingOwnerGroupRow[] {
    const names = new Set<string>([...saleMap.keys(), ...cdrMap.keys(), ...targetByGroup.keys(), ...stageCounts.keys(), ...agentCountByGroup.keys()]);
    const rows: HousingOwnerGroupRow[] = [];
    for (const name of names) {
      const sale = saleMap.get(name);
      const cdr = cdrMap.get(name);
      const target = targetByGroup.get(name) ?? 0;
      const revenue = sale?.revenue ?? 0;
      const saleCount = sale?.saleCount ?? 0;
      const totalCalls = cdr?.totalCalls ?? 0;
      const connectedCalls = cdr?.connected ?? 0;
      const stages = stageCounts.get(name);
      const agentCount = agentCountByGroup.get(name) ?? 0;
      rows.push({
        name,
        totalCalls,
        connectedCalls,
        connectedPct: totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0,
        revenue,
        saleCount,
        target,
        achievementPct: target > 0 ? (revenue / target) * 100 : 0,
        aov: saleCount > 0 ? revenue / saleCount : 0,
        agentCount,
        rpa: agentCount > 0 ? revenue / agentCount : 0,
        tqCount: stages?.tq ?? 0,
        mqCount: stages?.mq ?? 0,
        bqCount: stages?.bq ?? 0,
      });
    }
    return rows.sort((a, b) => b.revenue - a.revenue);
  }

  const targetByAm = new Map<string, number>();
  const targetByTl = new Map<string, number>();
  const activeAgentCountByAm = new Map<string, number>();
  const activeAgentCountByTl = new Map<string, number>();
  for (const ro of roster.values()) {
    if (!rosterMatches(ro)) continue;
    targetByAm.set(ro.am, (targetByAm.get(ro.am) ?? 0) + ro.target);
    targetByTl.set(ro.tlName, (targetByTl.get(ro.tlName) ?? 0) + ro.target);
    if (ro.status === "Active") {
      activeAgentCountByAm.set(ro.am, (activeAgentCountByAm.get(ro.am) ?? 0) + 1);
      activeAgentCountByTl.set(ro.tlName, (activeAgentCountByTl.get(ro.tlName) ?? 0) + 1);
    }
  }

  const byAm = toGroupRows(saleAggByAm, cdrAggByAm, targetByAm, stageCountsByAm, activeAgentCountByAm);
  const byTl = toGroupRows(saleAggByTl, cdrAggByTl, targetByTl, stageCountsByTl, activeAgentCountByTl);

  const totalRevenue = agents.reduce((s, a) => s + a.revenue, 0);
  const totalSaleCount = agents.reduce((s, a) => s + a.saleCount, 0);
  const totalCalls = agents.reduce((s, a) => s + a.totalCalls, 0);
  const connectedCalls = agents.reduce((s, a) => s + a.connectedCalls, 0);
  const notConnectedCalls = agents.reduce((s, a) => s + a.notConnectedCalls, 0);
  const activeAgentsArr = [...roster.values()].filter((r) => r.status === "Active" && rosterMatches(r));
  const totalTarget = activeAgentsArr.reduce((s, r) => s + r.target, 0);
  const totalMtdReported = activeAgentsArr.reduce((s, r) => s + r.mtdReported, 0);
  const talkAgents = agents.filter((a) => a.avgTalkTimeSec > 0);
  const avgTalkTimeSec = talkAgents.length > 0 ? talkAgents.reduce((s, a) => s + a.avgTalkTimeSec, 0) / talkAgents.length : 0;

  const headline: HousingOwnerHeadline = {
    totalRevenue,
    totalSaleCount,
    aov: totalSaleCount > 0 ? totalRevenue / totalSaleCount : 0,
    totalCalls,
    connectedCalls,
    notConnectedCalls,
    connectedPct: totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0,
    avgTalkTimeSec,
    activeAgents: activeAgentsArr.length,
    totalTarget,
    totalMtdReported,
    achievementPct: totalTarget > 0 ? (totalRevenue / totalTarget) * 100 : 0,
    revenuePerAgent: activeAgentsArr.length > 0 ? totalRevenue / activeAgentsArr.length : 0,
  };

  const packageTypeBreakdown = [...packageTypeMap.entries()]
    .map(([packageType, v]) => ({ packageType, count: v.count, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const dates = new Set<string>([...dailyRevenue.keys(), ...dailyCalls.keys()]);
  const dailyTrend = [...dates]
    .sort()
    .map((date) => ({
      date,
      revenue: dailyRevenue.get(date)?.revenue ?? 0,
      saleCount: dailyRevenue.get(date)?.saleCount ?? 0,
      totalCalls: dailyCalls.get(date)?.totalCalls ?? 0,
      connectedCalls: dailyCalls.get(date)?.connected ?? 0,
    }));

  const rankable = agents.filter((a) => a.target > 0);
  const topPerformers = [...rankable].sort((a, b) => b.achievementPct - a.achievementPct).slice(0, 5);
  const bottomPerformers = [...rankable].sort((a, b) => a.achievementPct - b.achievementPct).slice(0, 5);

  const sortAlpha = (a: string, b: string) => a.localeCompare(b);
  const tlByAm: Record<string, string[]> = {};
  for (const [am, tls] of tlByAmSets) tlByAm[am] = [...tls].sort(sortAlpha);

  return {
    filterOptions: { tls: [...tlSet].sort(sortAlpha), ams: [...amSet].sort(sortAlpha), tlByAm },
    appliedFilters: { tl: tlFilter || null, am: amFilter || null },
    headline,
    byAm,
    byTl,
    agents,
    topPerformers,
    bottomPerformers,
    packageTypeBreakdown,
    dailyTrend,
  };
}

export interface HousingOwnerEntityTrendRow {
  date: string;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  saleCount: number;
  revenue: number;
  cumulativeRevenue: number;
  /** This entity's monthly target / days in that date's month -- 0 when the
   * entity has no target. Lets the chart plot Revenue against Target
   * directly, not just the ratio between them. */
  dayTarget: number;
  /** This day's own revenue / dayTarget -- 0 when the entity has no target.
   * Deliberately NOT cumulative-revenue-to-date/target: that produces a
   * smooth ramp climbing all month regardless of any single day's actual
   * performance, which reads as "achievement" but isn't a per-day figure. */
  achievementPct: number;
}

export interface HousingOwnerEntityTrendData {
  entityType: "am" | "tl" | "agent";
  entityName: string;
  from: string;
  to: string;
  target: number;
  headline: {
    totalCalls: number;
    connectedCalls: number;
    connectedPct: number;
    saleCount: number;
    revenue: number;
    achievementPct: number;
    avgTalkTimeSec: number;
  };
  dailyTrend: HousingOwnerEntityTrendRow[];
}

/**
 * Row-click drill-down for the Housing Owner dashboard's AM-wise / TL-wise /
 * Top-Bottom-performer / Agent-wise tables: the same day-wise breakdown the
 * main dashboard already builds for its overall total, but for one AM, TL or
 * agent. Re-reads and re-aggregates owner_sale/Owner_cdr/owner_agent_details
 * the same way getHousingOwnerDashboard does (same de-dup keys, same date
 * parsing, same roster-first TL/AM precedence) rather than sharing state
 * with it, so this endpoint stays correct on its own for any date range
 * independent of whatever range/filters the main dashboard call used.
 */
export async function getHousingOwnerEntityTrend(
  fromInput: string, toInput: string, entityType: "am" | "tl" | "agent", entityNameInput: string,
): Promise<HousingOwnerEntityTrendData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const entityName = normalizeName(entityNameInput);

  const [agentRows] = await db.execute<any[]>(
    `SELECT sno, crm_id, overall, tl_name, doj, status, ageing, bucket, monthly_target, per_day_target, mtd, am
     FROM db_masmis.owner_agent_details`
  );
  const [saleRows] = await db.execute<any[]>(
    `SELECT opp_id, agent_id, agent_name, tl_name, am, value, sale_count, package_type, payment_mode, day, week, month
     FROM db_masmis.owner_sale`
  );
  const [cdrRows] = await db.execute<any[]>(
    `SELECT agent, tl_name, am, total_calls, connected, not_connected, avg_talk_time, report_date, day
     FROM db_masmis.Owner_cdr`
  );

  const roster = new Map<string, RosterAgent>();
  for (const r of agentRows as any[]) {
    const name = normalizeName(r.overall);
    if (!name) continue;
    roster.set(name, {
      empId: r.crm_id ?? null,
      name,
      tlName: normalizeName(r.tl_name) || "Unassigned",
      am: normalizeName(r.am) || "Unassigned",
      doj: r.doj ?? null,
      tenureDays: null,
      bucket: r.bucket ?? null,
      status: r.status ?? "Unknown",
      target: num(r.monthly_target),
      mtdReported: num(r.mtd),
    });
  }

  // Same roster-first precedence as getHousingOwnerDashboard's rowMatches: an
  // agent's TL/AM comes from the roster when they're on it, else from the row itself.
  const matchesEntity = (agentName: string, rowTl: unknown, rowAm: unknown): boolean => {
    if (entityType === "agent") return agentName === entityName;
    const ro = roster.get(agentName);
    const tl = ro?.tlName ?? (normalizeName(rowTl) || "Unassigned");
    const am = ro?.am ?? (normalizeName(rowAm) || "Unassigned");
    return entityType === "tl" ? tl === entityName : am === entityName;
  };

  let target = 0;
  for (const ro of roster.values()) {
    if (entityType === "agent" && ro.name === entityName) target += ro.target;
    else if (entityType === "tl" && ro.tlName === entityName) target += ro.target;
    else if (entityType === "am" && ro.am === entityName) target += ro.target;
  }

  const dailyRevenue = new Map<string, { revenue: number; saleCount: number }>();
  const seenSales = new Set<string>();
  for (const r of saleRows as any[]) {
    const rowDate = saleRowDate(r.month, r.day);
    if (rowDate === null || rowDate < from || rowDate > to) continue;
    const oppId = String(r.opp_id ?? "").trim();
    if (oppId) {
      const key = `${oppId}|${normalizeName(r.agent_name)}|${num(r.value)}|${String(r.package_type ?? "").trim()}`;
      if (seenSales.has(key)) continue;
      seenSales.add(key);
    }
    const name = normalizeName(r.agent_name);
    if (!matchesEntity(name, r.tl_name, r.am)) continue;
    const value = num(r.value);
    const count = num(r.sale_count) || 1;
    const dCur = dailyRevenue.get(rowDate) ?? { revenue: 0, saleCount: 0 };
    dCur.revenue += value;
    dCur.saleCount += count;
    dailyRevenue.set(rowDate, dCur);
  }

  interface DailyCdrAgg { totalCalls: number; connected: number; talkSecSum: number; talkRows: number }
  const dailyCalls = new Map<string, DailyCdrAgg>();
  const seenCdr = new Set<string>();
  for (const r of cdrRows as any[]) {
    const rowDate = cdrRowDate(r.report_date);
    if (rowDate === null || rowDate < from || rowDate > to) continue;
    const cdrKey = [normalizeName(r.agent), rowDate, r.total_calls, r.connected, r.not_connected, r.avg_talk_time].join("|");
    if (seenCdr.has(cdrKey)) continue;
    seenCdr.add(cdrKey);
    const name = normalizeName(r.agent);
    if (!matchesEntity(name, r.tl_name, r.am)) continue;
    const calls = num(r.total_calls);
    const connected = num(r.connected);
    const talkStr = String(r.avg_talk_time ?? "").trim();
    const hasTalk = talkStr !== "" && talkStr !== "0:00:00";
    const talkSec = hasTalk ? timeToSec(talkStr) : 0;
    const cur = dailyCalls.get(rowDate) ?? { totalCalls: 0, connected: 0, talkSecSum: 0, talkRows: 0 };
    cur.totalCalls += calls;
    cur.connected += connected;
    if (hasTalk) { cur.talkSecSum += talkSec; cur.talkRows += 1; }
    dailyCalls.set(rowDate, cur);
  }

  const dates = [...new Set([...dailyRevenue.keys(), ...dailyCalls.keys()])].sort();
  let cumulativeRevenue = 0;
  const dailyTrend: HousingOwnerEntityTrendRow[] = dates.map((date) => {
    const sale = dailyRevenue.get(date);
    const cdr = dailyCalls.get(date);
    const revenue = sale?.revenue ?? 0;
    const saleCount = sale?.saleCount ?? 0;
    const totalCalls = cdr?.totalCalls ?? 0;
    const connectedCalls = cdr?.connected ?? 0;
    cumulativeRevenue += revenue;
    const dayTarget = target > 0 ? Math.round(target / daysInMonth(date)) : 0;
    return {
      date,
      totalCalls,
      connectedCalls,
      connectedPct: totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0,
      saleCount,
      revenue,
      cumulativeRevenue,
      dayTarget,
      achievementPct: dayTarget > 0 ? (revenue / dayTarget) * 100 : 0,
    };
  });

  const totalCalls = dailyTrend.reduce((s, d) => s + d.totalCalls, 0);
  const connectedCalls = dailyTrend.reduce((s, d) => s + d.connectedCalls, 0);
  const saleCount = dailyTrend.reduce((s, d) => s + d.saleCount, 0);
  const revenue = dailyTrend.reduce((s, d) => s + d.revenue, 0);
  const talkDays = [...dailyCalls.values()].filter((c) => c.talkRows > 0);
  const avgTalkTimeSec = talkDays.length > 0
    ? talkDays.reduce((s, c) => s + c.talkSecSum / c.talkRows, 0) / talkDays.length
    : 0;

  return {
    entityType,
    entityName,
    from,
    to,
    target,
    headline: {
      totalCalls,
      connectedCalls,
      connectedPct: totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0,
      saleCount,
      revenue,
      achievementPct: target > 0 ? (revenue / target) * 100 : 0,
      avgTalkTimeSec,
    },
    dailyTrend,
  };
}
