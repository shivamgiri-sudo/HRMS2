/**
 * Pure calculation layer for the BLA / BLI / BLU Sales Dashboard.
 * Mirrors the "Formula Demo" sheet of BLA_BLI_BLU_Dashboard_Calculation:
 *   Capped Data   = MIN(Fresh Workable, Required x Cap%)          (per day)
 *   Target Sale   = Capped Data x Conversion Target               (per day)
 *   Target Revenue= Target Sale x Target AOV
 *   Delivery Conv = Real Time Sale / Capped Data, Prepaid% = Prepaid / RTS, RTO% = RTO / RTS, AOV = Revenue / RTS
 * Daily rows are additive, so Week and MTD are plain sums of daily rows with ratios re-derived.
 */

export interface ReceivedAgg {
  date: string; lob: string;
  freshBase: number; freshWorkable: number; totalWorkable: number; dnd: number;
  uniqueAttempt: number; connected: number; le30: number; lt1m: number; ge1m: number;
}
export interface SalesAgg {
  date: string; campaign: string;
  realTimeSale: number; prepaid: number; rto: number; revenue: number; ptp: number; h24: number;
}
export interface TargetCfg {
  lob: string; requiredPerDay: number; capPct: number; conversionTarget: number;
  prepaidTarget: number; rtoTarget: number; targetAov: number;
}

export interface Additive {
  freshBase: number; freshWorkable: number; totalWorkable: number; dnd: number;
  uniqueAttempt: number; connected: number; le30: number; lt1m: number; ge1m: number;
  realTimeSale: number; prepaid: number; rto: number; revenue: number; ptp: number; h24: number;
  requiredData: number; cappedData: number; targetSale: number; targetRevenue: number;
  /** realTimeSale x prepaid/rto target, so weighted targets survive aggregation across LOBs. */
  prepaidTgtNum: number; rtoTgtNum: number;
}
export interface Metrics extends Additive {
  connectPct: number; attemptPct: number;
  conversionTarget: number; prepaidTarget: number; rtoTarget: number; targetAov: number;
  deliveryConversion: number; deliveryPrepaid: number; deliveryRto: number; aov: number;
  saleAchievement: number; conversionAchievement: number; prepaidAchievement: number; revenueAchievement: number;
}
export interface Row extends Metrics { key: string; label: string }

export const ZERO: Additive = {
  freshBase: 0, freshWorkable: 0, totalWorkable: 0, dnd: 0, uniqueAttempt: 0, connected: 0, le30: 0, lt1m: 0, ge1m: 0,
  realTimeSale: 0, prepaid: 0, rto: 0, revenue: 0, ptp: 0, h24: 0,
  requiredData: 0, cappedData: 0, targetSale: 0, targetRevenue: 0, prepaidTgtNum: 0, rtoTgtNum: 0,
};
const ADD_KEYS = Object.keys(ZERO) as (keyof Additive)[];

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function addInto(target: Additive, src: Additive): Additive {
  for (const k of ADD_KEYS) target[k] += src[k];
  return target;
}

/** Week label matches the source workbook's "Week 1".."Week 5" (7-day blocks of the month). */
export function weekLabel(date: string): string {
  return `Week ${Math.ceil(Number(date.slice(8, 10)) / 7)}`;
}

/** Daily additive figures for one LOB on one day. `hasReceived` gates the daily required-data target. */
export function dayAdditive(recv: ReceivedAgg | undefined, sales: SalesAgg | undefined, cfg: TargetCfg | undefined): Additive {
  const a: Additive = { ...ZERO };
  if (recv) {
    a.freshBase = recv.freshBase; a.freshWorkable = recv.freshWorkable; a.totalWorkable = recv.totalWorkable; a.dnd = recv.dnd;
    a.uniqueAttempt = recv.uniqueAttempt; a.connected = recv.connected;
    a.le30 = recv.le30; a.lt1m = recv.lt1m; a.ge1m = recv.ge1m;
  }
  if (sales) {
    a.realTimeSale = sales.realTimeSale; a.prepaid = sales.prepaid; a.rto = sales.rto;
    a.revenue = sales.revenue; a.ptp = sales.ptp; a.h24 = sales.h24;
  }
  if (cfg && recv) {
    a.requiredData = cfg.requiredPerDay;
    a.cappedData = Math.min(a.freshWorkable, cfg.requiredPerDay * cfg.capPct);
    a.targetSale = a.cappedData * cfg.conversionTarget;
    a.targetRevenue = a.targetSale * cfg.targetAov;
  }
  if (cfg) {
    a.prepaidTgtNum = a.realTimeSale * cfg.prepaidTarget;
    a.rtoTgtNum = a.realTimeSale * cfg.rtoTarget;
  }
  return a;
}

export function derive(a: Additive, cfg?: TargetCfg): Metrics {
  const rts = a.realTimeSale;
  const conversionTarget = cfg ? cfg.conversionTarget : div(a.targetSale, a.cappedData);
  const prepaidTarget = cfg ? cfg.prepaidTarget : div(a.prepaidTgtNum, rts);
  const rtoTarget = cfg ? cfg.rtoTarget : div(a.rtoTgtNum, rts);
  const targetAov = cfg ? cfg.targetAov : div(a.targetRevenue, a.targetSale);
  const deliveryConversion = div(rts, a.cappedData);
  const deliveryPrepaid = div(a.prepaid, rts);
  return {
    ...a,
    connectPct: div(a.connected, a.freshWorkable),
    attemptPct: div(a.uniqueAttempt, a.totalWorkable),
    conversionTarget, prepaidTarget, rtoTarget, targetAov,
    deliveryConversion, deliveryPrepaid, deliveryRto: div(a.rto, rts), aov: div(a.revenue, rts),
    saleAchievement: div(rts, a.targetSale),
    conversionAchievement: div(deliveryConversion, conversionTarget),
    prepaidAchievement: div(deliveryPrepaid, prepaidTarget),
    revenueAchievement: div(a.revenue, a.targetRevenue),
  };
}

export interface LobBlock { lob: string; daily: Row[]; weekly: Row[]; mtd: Row; hasTarget: boolean }
export interface DashboardResult {
  lobs: string[];
  targets: TargetCfg[];
  blocks: LobBlock[];
  /** Every LOB combined (Sales MBR view). */
  all: LobBlock;
}

function foldRows(dayMap: Map<string, Additive>, cfg?: TargetCfg): { daily: Row[]; weekly: Row[]; mtd: Row } {
  const dates = [...dayMap.keys()].sort();
  const weeks = new Map<string, Additive>();
  const total: Additive = { ...ZERO };
  const daily = dates.map((d) => {
    const a = dayMap.get(d)!;
    const w = weekLabel(d);
    addInto(weeks.get(w) ?? weeks.set(w, { ...ZERO }).get(w)!, a);
    addInto(total, a);
    return { key: d, label: d, ...derive(a, cfg) };
  });
  const weekly = [...weeks.keys()].sort().map((w) => ({ key: w, label: w, ...derive(weeks.get(w)!, cfg) }));
  return { daily, weekly, mtd: { key: "MTD", label: "MTD", ...derive(total, cfg) } };
}

export function buildDashboard(received: ReceivedAgg[], sales: SalesAgg[], targets: TargetCfg[]): DashboardResult {
  const cfgBy = new Map(targets.map((t) => [t.lob.toLowerCase(), t]));
  const canon = new Map<string, string>(); // case-insensitive LOB -> display name
  const see = (n: string) => { const k = n.trim().toLowerCase(); if (k && !canon.has(k)) canon.set(k, n.trim()); return k; };
  const rBy = new Map<string, ReceivedAgg>(); const sBy = new Map<string, SalesAgg>();
  for (const r of received) { const k = see(r.lob); if (k) rBy.set(`${k}|${r.date}`, r); }
  for (const s of sales) { const k = see(s.campaign); if (k) sBy.set(`${k}|${s.date}`, s); }
  for (const t of targets) see(t.lob);

  const lobKeys = [...canon.keys()];
  const allDays = new Map<string, Additive>();
  const blocks: LobBlock[] = lobKeys.map((k) => {
    const cfg = cfgBy.get(k);
    const dates = new Set<string>();
    for (const key of [...rBy.keys(), ...sBy.keys()]) if (key.startsWith(`${k}|`)) dates.add(key.slice(k.length + 1));
    const dayMap = new Map<string, Additive>();
    for (const d of dates) {
      const a = dayAdditive(rBy.get(`${k}|${d}`), sBy.get(`${k}|${d}`), cfg);
      dayMap.set(d, a);
      addInto(allDays.get(d) ?? allDays.set(d, { ...ZERO }).get(d)!, a);
    }
    return { lob: canon.get(k)!, hasTarget: !!cfg, ...foldRows(dayMap, cfg) };
  });
  return {
    lobs: blocks.map((b) => b.lob), targets, blocks,
    all: { lob: "All LOBs", hasTarget: blocks.some((b) => b.hasTarget), ...foldRows(allDays) },
  };
}
