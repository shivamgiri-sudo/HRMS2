import { createHmac } from "node:crypto";
import { getDialerPool } from "../../db/dialerDb.js";
import { PROJECTS } from "./inbound.service.js";

/**
 * Inbound insights for the "pattern B" projects (DU Bangladesh, Exicom, Viega, Dalmia).
 *
 * Additive module: the existing /api/inbound endpoints are untouched. The
 * calls for the selected window are read ONCE from the read-only dialer table
 * and every view (overview, hour-wise, date-wise, agent-wise, LOB-wise, wait,
 * callers) is derived from that same row set, so no two tabs can disagree.
 *
 * Definitions (identical to inbound.service.ts pattern B):
 *   offered   = every row
 *   answered  = AgentId != 'VDCL'   (VDCL = call never reached an agent)
 *   abandoned = AgentId  = 'VDCL'
 *   wait      = TIME_TO_SEC(QueueDuration)
 *   SL%       = answered calls with wait <= 30s, as a share of OFFERED calls
 *               (the base the existing hourly / agent / LOB views use)
 *   AHT       = mean CallDurationSecond of answered calls
 *   hour      = HOUR(HoursSlot)  (CallDate carries no time of day)
 *
 * Not computed because the dialer table holds no source for them: occupancy /
 * utilisation (no login-time data), planned staffing, callback outcomes.
 */

export const INSIGHT_PROJECT_KEYS = ["dubangladesh", "exicom", "viega", "dalmia"] as const;
const SL_THRESHOLD_SEC = 30;
const MAX_RANGE_DAYS = 366;
const MAX_ROWS = 200_000;
const DRILL_LIMIT = 300;

const WAIT_BUCKETS = [
  { label: "0s", min: 0, max: 0 },
  { label: "1-10s", min: 1, max: 10 },
  { label: "11-20s", min: 11, max: 20 },
  { label: "21-30s", min: 21, max: 30 },
  { label: "31-60s", min: 31, max: 60 },
  { label: "1-2 min", min: 61, max: 120 },
  { label: "2+ min", min: 121, max: Infinity },
] as const;

const TALK_BUCKETS = [
  { label: "< 1 min", min: 0, max: 59 },
  { label: "1-3 min", min: 60, max: 179 },
  { label: "3-5 min", min: 180, max: 299 },
  { label: "5-10 min", min: 300, max: 599 },
  { label: "10+ min", min: 600, max: Infinity },
] as const;

export interface InsightFilters {
  startDate: string;
  endDate: string;
  campaign?: string;
}

export interface DrillFilters extends InsightFilters {
  date?: string;
  hour?: number;
  agentId?: string;
  outcome?: "answered" | "abandoned";
  waitBucket?: string;
  callerKey?: string;
  weekday?: string;
  disposition?: string;
  disconnBy?: string;
  page?: number;
}

interface CallRow {
  id: number;
  date: string;
  time: string;
  hour: number;
  agentId: string;
  agentName: string;
  campaign: string;
  phone: string;
  disposition: string;
  disconnBy: string;
  duration: number;
  wait: number;
  hold: number;
  talk: number;
  acw: number;
  transferred: boolean;
  answered: boolean;
}

const n = (v: unknown) => Number(v) || 0;
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (num: number, den: number) => (den ? round2((num / den) * 100) : 0);
const avg = (sum: number, cnt: number) => (cnt ? Math.round(sum / cnt) : 0);

export function isInsightProject(key: string): boolean {
  return (INSIGHT_PROJECT_KEYS as readonly string[]).includes(key);
}

function getProject(key: string) {
  const p = PROJECTS.find((x) => x.key === key);
  if (!p || p.pattern !== "B" || !isInsightProject(key)) {
    throw new Error(`Inbound insights are not available for project: ${key}`);
  }
  return p;
}

/** Validate a YYYY-MM-DD string and return its UTC day number (throws otherwise). */
function dayNumber(s: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Dates must be YYYY-MM-DD");
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error("Invalid date");
  return Math.floor(t / 86_400_000);
}

function assertRange(f: InsightFilters) {
  const a = dayNumber(f.startDate);
  const b = dayNumber(f.endDate);
  if (b < a) throw new Error("endDate is before startDate");
  if (b - a + 1 > MAX_RANGE_DAYS) throw new Error(`Date range is limited to ${MAX_RANGE_DAYS} days`);
}

function callerSecret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || "inbound-insights";
}

/** Opaque per-number key so the UI can drill into a caller without ever holding the number. */
function callerKey(phone: string): string {
  return createHmac("sha256", callerSecret()).update(phone).digest("hex").slice(0, 12);
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\s+/g, "");
  if (digits.length <= 4) return digits ? "••••" : "—";
  return `${"•".repeat(Math.max(digits.length - 4, 3))}${digits.slice(-4)}`;
}

async function loadCalls(projectKey: string, f: InsightFilters): Promise<{ rows: CallRow[]; truncated: boolean; campaigns: string[] }> {
  const p = getProject(projectKey);
  assertRange(f);
  if (f.campaign && !p.campaigns.includes(f.campaign)) throw new Error("Unknown campaign for this project");

  const campaigns = f.campaign ? [f.campaign] : p.campaigns;
  const ph = campaigns.map(() => "?").join(",");
  const pool = await getDialerPool();
  const [raw] = await pool.execute(
    `SELECT id, DATE_FORMAT(CallDate,'%Y-%m-%d') AS d, DATE_FORMAT(\`Time\`,'%H:%i:%s') AS t,
            HOUR(HoursSlot) AS hr, AgentId, AgentName, CampaignName, PhoneNumber, Disposition, DisconnBy,
            CAST(CallDurationSecond AS UNSIGNED) AS dur, TIME_TO_SEC(QueueDuration) AS wait,
            TIME_TO_SEC(HoldTime) AS hold, TIME_TO_SEC(Talkduration) AS talk, TIME_TO_SEC(Acwduration) AS acw,
            CallTransferId
       FROM dialer_db.${p.table}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
        AND CampaignName IN (${ph})
      ORDER BY CallDate ASC, id ASC
      LIMIT ${MAX_ROWS + 1}`,
    [f.startDate, f.endDate, ...campaigns]
  );

  const list = raw as Record<string, unknown>[];
  const truncated = list.length > MAX_ROWS;
  const rows: CallRow[] = (truncated ? list.slice(0, MAX_ROWS) : list).map((r) => {
    const agentId = String(r.AgentId ?? "");
    const answered = agentId !== "VDCL";
    const transferId = String(r.CallTransferId ?? "").trim();
    return {
      id: n(r.id),
      date: String(r.d),
      time: String(r.t ?? ""),
      hour: n(r.hr),
      agentId,
      agentName: String(r.AgentName ?? "").trim() || agentId,
      campaign: String(r.CampaignName ?? ""),
      phone: String(r.PhoneNumber ?? "").trim(),
      disposition: String(r.Disposition ?? "") || "—",
      disconnBy: String(r.DisconnBy ?? "") || "—",
      duration: n(r.dur),
      wait: n(r.wait),
      hold: n(r.hold),
      talk: n(r.talk),
      acw: n(r.acw),
      transferred: transferId !== "" && transferId !== "0",
      answered,
    };
  });
  return { rows, truncated, campaigns: p.campaigns };
}

/* ────────────────────────── aggregation helpers ────────────────────────── */

interface Acc {
  offered: number;
  answered: number;
  abandoned: number;
  slNum: number;
  durSum: number;
  talkSum: number;
  holdSum: number;
  acwSum: number;
  waitAnsweredSum: number;
  waitAbandonSum: number;
  maxWait: number;
  transfers: number;
  shortAbandon: number;
}

const newAcc = (): Acc => ({
  offered: 0, answered: 0, abandoned: 0, slNum: 0, durSum: 0, talkSum: 0, holdSum: 0, acwSum: 0,
  waitAnsweredSum: 0, waitAbandonSum: 0, maxWait: 0, transfers: 0, shortAbandon: 0,
});

function add(a: Acc, r: CallRow) {
  a.offered++;
  if (r.wait > a.maxWait) a.maxWait = r.wait;
  if (r.transferred) a.transfers++;
  if (r.answered) {
    a.answered++;
    if (r.wait <= SL_THRESHOLD_SEC) a.slNum++;
    a.durSum += r.duration;
    a.talkSum += r.talk;
    a.holdSum += r.hold;
    a.acwSum += r.acw;
    a.waitAnsweredSum += r.wait;
  } else {
    a.abandoned++;
    a.waitAbandonSum += r.wait;
    if (r.wait <= SL_THRESHOLD_SEC) a.shortAbandon++;
  }
}

function metrics(a: Acc) {
  return {
    offered: a.offered,
    answered: a.answered,
    abandoned: a.abandoned,
    answeredPct: pct(a.answered, a.offered),
    abandonPct: pct(a.abandoned, a.offered),
    slPct: pct(a.slNum, a.offered),
    slOfAnsweredPct: pct(a.slNum, a.answered),
    aht: avg(a.durSum, a.answered),
    avgTalk: avg(a.talkSum, a.answered),
    avgHold: avg(a.holdSum, a.answered),
    avgAcw: avg(a.acwSum, a.answered),
    asa: avg(a.waitAnsweredSum, a.answered),
    avgAbandonWait: avg(a.waitAbandonSum, a.abandoned),
    maxWait: a.maxWait,
    transfers: a.transfers,
  };
}

function groupBy<K>(rows: CallRow[], keyFn: (r: CallRow) => K): Map<K, Acc> {
  const m = new Map<K, Acc>();
  for (const r of rows) {
    const k = keyFn(r);
    let a = m.get(k);
    if (!a) { a = newAcc(); m.set(k, a); }
    add(a, r);
  }
  return m;
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function bucketIndex(sec: number, buckets: readonly { min: number; max: number }[]) {
  return buckets.findIndex((b) => sec >= b.min && sec <= b.max);
}

/* ─────────────────────────────── insights ─────────────────────────────── */

export async function getInboundInsights(projectKey: string, f: InsightFilters) {
  const { rows, truncated, campaigns } = await loadCalls(projectKey, f);
  const p = getProject(projectKey);

  const total = newAcc();
  const callers = new Map<string, { phone: string; calls: number; answered: number; abandoned: number; lastDate: string; campaigns: Set<string> }>();
  const agentSet = new Set<string>();
  let holdCalls = 0;
  for (const r of rows) {
    add(total, r);
    if (r.answered) {
      agentSet.add(r.agentId);
      if (r.hold > 0) holdCalls++;
    }
    if (r.phone) {
      let c = callers.get(r.phone);
      if (!c) { c = { phone: r.phone, calls: 0, answered: 0, abandoned: 0, lastDate: r.date, campaigns: new Set() }; callers.set(r.phone, c); }
      c.calls++;
      if (r.answered) c.answered++; else c.abandoned++;
      if (r.date > c.lastDate) c.lastDate = r.date;
      c.campaigns.add(r.campaign);
    }
  }

  // ── per-day, per-hour, weekday ──
  const byDate = groupBy(rows, (r) => r.date);
  const dateKeys = [...byDate.keys()].sort();
  const dayAgents = new Map<string, Set<string>>();
  const dayCallers = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.answered) {
      if (!dayAgents.has(r.date)) dayAgents.set(r.date, new Set());
      dayAgents.get(r.date)!.add(r.agentId);
    }
    if (r.phone) {
      if (!dayCallers.has(r.date)) dayCallers.set(r.date, new Set());
      dayCallers.get(r.date)!.add(r.phone);
    }
  }
  const daily = dateKeys.map((d) => ({
    date: d,
    weekday: WEEKDAYS[weekdayOf(d)],
    ...metrics(byDate.get(d)!),
    agents: dayAgents.get(d)?.size ?? 0,
    uniqueCallers: dayCallers.get(d)?.size ?? 0,
  }));

  const byHour = groupBy(rows, (r) => r.hour);
  const hourKeys = [...byHour.keys()].sort((a, b) => a - b);
  const hourly = hourKeys.map((h) => {
    const a = byHour.get(h)!;
    const daysWithCalls = new Set(rows.filter((r) => r.hour === h).map((r) => r.date)).size;
    return {
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      ...metrics(a),
      avgPerDay: daysWithCalls ? round1(a.offered / daysWithCalls) : 0,
      sharePct: pct(a.offered, total.offered),
    };
  });

  const byWeekday = groupBy(rows, (r) => weekdayOf(r.date));
  const weekdayDays = new Map<number, Set<string>>();
  for (const d of dateKeys) {
    const w = weekdayOf(d);
    if (!weekdayDays.has(w)) weekdayDays.set(w, new Set());
    weekdayDays.get(w)!.add(d);
  }
  const weekdays = [1, 2, 3, 4, 5, 6, 0]
    .filter((w) => byWeekday.has(w))
    .map((w) => ({
      weekday: WEEKDAYS[w],
      days: weekdayDays.get(w)?.size ?? 0,
      ...metrics(byWeekday.get(w)!),
      avgPerDay: round1(byWeekday.get(w)!.offered / Math.max(weekdayDays.get(w)?.size ?? 1, 1)),
    }));

  // ── date x hour heatmap (offered / abandoned / answered) ──
  const heat = new Map<string, { o: number; a: number; s: number }>();
  for (const r of rows) {
    const k = `${r.date}|${r.hour}`;
    let c = heat.get(k);
    if (!c) { c = { o: 0, a: 0, s: 0 }; heat.set(k, c); }
    c.o++;
    if (!r.answered) c.a++;
    else if (r.wait <= SL_THRESHOLD_SEC) c.s++;
  }
  const heatmap = [...heat.entries()].map(([k, v]) => {
    const [date, hour] = k.split("|");
    return { date, hour: Number(hour), offered: v.o, abandoned: v.a, answeredInSl: v.s };
  });

  // ── agents ──
  const answeredRows = rows.filter((r) => r.answered);
  const byAgent = groupBy(answeredRows, (r) => r.agentId);
  const agentInfo = new Map<string, { name: string; dates: Set<string>; first: string; last: string; maxDur: number; short: number; long: number }>();
  for (const r of answeredRows) {
    let i = agentInfo.get(r.agentId);
    if (!i) { i = { name: r.agentName, dates: new Set(), first: r.time, last: r.time, maxDur: 0, short: 0, long: 0 }; agentInfo.set(r.agentId, i); }
    i.dates.add(r.date);
    if (r.time && r.time < i.first) i.first = r.time;
    if (r.time > i.last) i.last = r.time;
    if (r.duration > i.maxDur) i.maxDur = r.duration;
    if (r.duration < 10) i.short++;
    if (r.duration >= 600) i.long++;
  }
  const agents = [...byAgent.entries()]
    .map(([agentId, a]) => {
      const i = agentInfo.get(agentId)!;
      const m = metrics(a);
      return {
        agentId,
        agentName: i.name,
        handled: a.answered,
        sharePct: pct(a.answered, total.answered),
        slWithin30Pct: pct(a.slNum, a.answered),
        aht: m.aht,
        avgTalk: m.avgTalk,
        avgHold: m.avgHold,
        avgAcw: m.avgAcw,
        asa: m.asa,
        maxDuration: i.maxDur,
        shortCalls: i.short,
        longCalls: i.long,
        transfers: a.transfers,
        daysActive: i.dates.size,
        callsPerDay: round1(a.answered / Math.max(i.dates.size, 1)),
        firstCall: i.first,
        lastCall: i.last,
      };
    })
    .sort((x, y) => y.handled - x.handled);

  const agentDaily: { agentId: string; date: string; calls: number }[] = [];
  const ad = new Map<string, number>();
  for (const r of answeredRows) ad.set(`${r.agentId}|${r.date}`, (ad.get(`${r.agentId}|${r.date}`) ?? 0) + 1);
  for (const [k, calls] of ad) {
    const [agentId, date] = k.split("|");
    agentDaily.push({ agentId, date, calls });
  }

  const agentHourly: { agentId: string; hour: number; calls: number }[] = [];
  const ah = new Map<string, number>();
  for (const r of answeredRows) ah.set(`${r.agentId}|${r.hour}`, (ah.get(`${r.agentId}|${r.hour}`) ?? 0) + 1);
  for (const [k, calls] of ah) {
    const [agentId, hour] = k.split("|");
    agentHourly.push({ agentId, hour: Number(hour), calls });
  }

  // ── LOB / campaign ──
  const byCampaign = groupBy(rows, (r) => r.campaign);
  const lobs = [...byCampaign.entries()]
    .map(([campaign, a]) => ({
      campaign,
      ...metrics(a),
      sharePct: pct(a.offered, total.offered),
      uniqueCallers: new Set(rows.filter((r) => r.campaign === campaign && r.phone).map((r) => r.phone)).size,
      agents: new Set(rows.filter((r) => r.campaign === campaign && r.answered).map((r) => r.agentId)).size,
    }))
    .sort((x, y) => y.offered - x.offered);

  const lobDaily: { campaign: string; date: string; offered: number }[] = [];
  const ld = new Map<string, number>();
  for (const r of rows) ld.set(`${r.campaign}|${r.date}`, (ld.get(`${r.campaign}|${r.date}`) ?? 0) + 1);
  for (const [k, offered] of ld) {
    const [campaign, date] = k.split("|");
    lobDaily.push({ campaign, date, offered });
  }

  // ── wait / abandon ──
  const waitBuckets = WAIT_BUCKETS.map((b) => ({ label: b.label, answered: 0, abandoned: 0 }));
  for (const r of rows) {
    const i = bucketIndex(r.wait, WAIT_BUCKETS);
    if (i >= 0) { if (r.answered) waitBuckets[i].answered++; else waitBuckets[i].abandoned++; }
  }
  const talkBuckets = TALK_BUCKETS.map((b) => ({ label: b.label, calls: 0 }));
  for (const r of answeredRows) {
    const i = bucketIndex(r.duration, TALK_BUCKETS);
    if (i >= 0) talkBuckets[i].calls++;
  }
  const countBy = (keyFn: (r: CallRow) => string, src: CallRow[]) => {
    const m = new Map<string, number>();
    for (const r of src) m.set(keyFn(r), (m.get(keyFn(r)) ?? 0) + 1);
    return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };
  const dispositions = countBy((r) => r.disposition, rows);
  const disconnects = countBy((r) => r.disconnBy, rows);
  const abandonReasons = countBy((r) => `${r.disposition} / ${r.disconnBy}`, rows.filter((r) => !r.answered));

  // ── callers ──
  const callerList = [...callers.values()];
  const repeatCallers = callerList.filter((c) => c.calls > 1);
  const unserved = callerList.filter((c) => c.answered === 0);
  const repeatDist = [
    { label: "1 call", callers: callerList.filter((c) => c.calls === 1).length },
    { label: "2 calls", callers: callerList.filter((c) => c.calls === 2).length },
    { label: "3 calls", callers: callerList.filter((c) => c.calls === 3).length },
    { label: "4+ calls", callers: callerList.filter((c) => c.calls >= 4).length },
  ];
  const toCaller = (c: (typeof callerList)[number]) => ({
    key: callerKey(c.phone),
    masked: maskPhone(c.phone),
    calls: c.calls,
    answered: c.answered,
    abandoned: c.abandoned,
    lastDate: c.lastDate,
    campaigns: [...c.campaigns].sort(),
  });
  const topRepeatCallers = repeatCallers.sort((a, b) => b.calls - a.calls || (a.lastDate < b.lastDate ? 1 : -1)).slice(0, 25).map(toCaller);
  const unservedCallers = unserved.sort((a, b) => b.abandoned - a.abandoned || (a.lastDate < b.lastDate ? 1 : -1)).slice(0, 25).map(toCaller);

  // ── headline ──
  const m = metrics(total);
  const peak = [...hourly].sort((a, b) => b.offered - a.offered)[0];
  const busiest = [...daily].sort((a, b) => b.offered - a.offered)[0];
  const headline = {
    ...m,
    slThresholdSec: SL_THRESHOLD_SEC,
    uniqueCallers: callerList.length,
    repeatCallers: repeatCallers.length,
    repeatCallerPct: pct(repeatCallers.length, callerList.length),
    repeatCallPct: pct(rows.filter((r) => r.phone && (callers.get(r.phone)?.calls ?? 0) > 1).length, rows.length),
    unservedCallers: unserved.length,
    agentsActive: agentSet.size,
    callsPerAgent: agentSet.size ? round1(total.answered / agentSet.size) : 0,
    daysWithCalls: dateKeys.length,
    avgCallsPerDay: dateKeys.length ? round1(total.offered / dateKeys.length) : 0,
    holdCallPct: pct(holdCalls, total.answered),
    shortAbandonPct: pct(total.shortAbandon, total.abandoned),
    peakHour: peak ? { label: peak.label, offered: peak.offered } : null,
    busiestDay: busiest ? { date: busiest.date, offered: busiest.offered } : null,
  };

  // ── narrative insights: only facts computed from the rows above ──
  const insights: { tone: "info" | "good" | "warn" | "bad"; text: string }[] = [];
  if (total.offered) {
    if (peak) insights.push({ tone: "info", text: `Peak hour is ${peak.label} with ${peak.offered} calls (${peak.sharePct}% of volume).` });
    const worstAband = hourly.filter((h) => h.offered >= 5).sort((a, b) => b.abandonPct - a.abandonPct)[0];
    if (worstAband && worstAband.abandoned > 0) {
      insights.push({ tone: "warn", text: `Highest abandon rate is at ${worstAband.label}: ${worstAband.abandonPct}% (${worstAband.abandoned} of ${worstAband.offered} calls).` });
    }
    const worstSl = hourly.filter((h) => h.offered >= 5).sort((a, b) => a.slPct - b.slPct)[0];
    if (worstSl && worstSl.slPct < 100) {
      insights.push({ tone: worstSl.slPct < 80 ? "bad" : "warn", text: `Lowest service level is at ${worstSl.label}: ${worstSl.slPct}% answered within ${SL_THRESHOLD_SEC}s.` });
    }
    const worstDay = daily.filter((d) => d.offered >= 5).sort((a, b) => b.abandonPct - a.abandonPct)[0];
    if (worstDay && worstDay.abandoned > 0) {
      insights.push({ tone: "warn", text: `Worst abandon day is ${worstDay.date} (${worstDay.weekday}): ${worstDay.abandonPct}% abandoned.` });
    }
    if (agents.length > 1 && agents[0].sharePct >= 35) {
      insights.push({ tone: "info", text: `${agents[0].agentName} handled ${agents[0].sharePct}% of answered calls — workload is concentrated on one agent.` });
    }
    if (unserved.length) {
      insights.push({ tone: "bad", text: `${unserved.length} caller${unserved.length > 1 ? "s" : ""} called in this period and never reached an agent.` });
    }
    if (repeatCallers.length) {
      insights.push({ tone: "info", text: `${repeatCallers.length} callers (${headline.repeatCallerPct}%) called more than once; they account for ${headline.repeatCallPct}% of calls.` });
    }
    if (total.abandoned && headline.shortAbandonPct >= 50) {
      insights.push({ tone: "info", text: `${headline.shortAbandonPct}% of abandoned calls dropped within ${SL_THRESHOLD_SEC}s of queueing.` });
    }
    if (m.slPct >= 90 && m.abandonPct <= 5) insights.push({ tone: "good", text: `Service is healthy: SL ${m.slPct}% and abandon ${m.abandonPct}%.` });
  }

  return {
    project: { key: p.key, name: p.name, campaigns },
    filters: { startDate: f.startDate, endDate: f.endDate, campaign: f.campaign ?? null },
    definitions: {
      offered: "Every inbound call routed to the queue",
      answered: "Calls handled by an agent",
      abandoned: "Calls that never reached an agent (agent = VDCL)",
      sl: `Answered within ${SL_THRESHOLD_SEC}s of queueing, as % of offered`,
      aht: "Average call duration of answered calls",
      asa: "Average queue wait of answered calls",
      unavailable: "Occupancy, staffing plan and callback outcomes are not in the dialer data",
    },
    truncated,
    headline,
    insights,
    daily,
    hourly,
    weekdays,
    heatmap,
    agents,
    agentDaily,
    agentHourly,
    lobs,
    lobDaily,
    waitBuckets,
    talkBuckets,
    dispositions,
    disconnects,
    abandonReasons,
    repeatDist,
    topRepeatCallers,
    unservedCallers,
  };
}

/* ──────────────────────────────── drill-down ──────────────────────────────── */

export async function getInboundCalls(projectKey: string, f: DrillFilters) {
  const { rows, truncated } = await loadCalls(projectKey, f);

  let list = rows;
  if (f.date) list = list.filter((r) => r.date === f.date);
  if (f.hour !== undefined && Number.isFinite(f.hour)) list = list.filter((r) => r.hour === f.hour);
  if (f.weekday) list = list.filter((r) => WEEKDAYS[weekdayOf(r.date)] === f.weekday);
  if (f.agentId) list = list.filter((r) => r.agentId === f.agentId);
  if (f.outcome === "answered") list = list.filter((r) => r.answered);
  if (f.outcome === "abandoned") list = list.filter((r) => !r.answered);
  if (f.disposition) list = list.filter((r) => r.disposition === f.disposition);
  if (f.disconnBy) list = list.filter((r) => r.disconnBy === f.disconnBy);
  if (f.waitBucket) {
    const b = WAIT_BUCKETS.find((x) => x.label === f.waitBucket);
    if (b) list = list.filter((r) => r.wait >= b.min && r.wait <= b.max);
  }
  if (f.callerKey) list = list.filter((r) => r.phone && callerKey(r.phone) === f.callerKey);

  const page = Math.max(1, Math.floor(f.page ?? 1));
  const sorted = [...list].sort((a, b) => (a.date === b.date ? (a.time < b.time ? 1 : -1) : a.date < b.date ? 1 : -1));
  const slice = sorted.slice((page - 1) * DRILL_LIMIT, page * DRILL_LIMIT);

  // Per-caller history within the window, used for the "call #k of N" column.
  const perCaller = new Map<string, number>();
  for (const r of rows) if (r.phone) perCaller.set(r.phone, (perCaller.get(r.phone) ?? 0) + 1);

  return {
    total: list.length,
    page,
    pageSize: DRILL_LIMIT,
    truncated,
    rows: slice.map((r) => ({
      id: r.id,
      date: r.date,
      time: r.time,
      hour: r.hour,
      campaign: r.campaign,
      agentId: r.agentId === "VDCL" ? null : r.agentId,
      agentName: r.answered ? r.agentName : null,
      caller: maskPhone(r.phone),
      callerKey: r.phone ? callerKey(r.phone) : null,
      callsInPeriod: r.phone ? perCaller.get(r.phone) ?? 1 : 1,
      outcome: r.answered ? "Answered" : "Abandoned",
      disposition: r.disposition,
      disconnBy: r.disconnBy,
      waitSec: r.wait,
      talkSec: r.talk,
      holdSec: r.hold,
      acwSec: r.acw,
      durationSec: r.duration,
      withinSl: r.answered && r.wait <= SL_THRESHOLD_SEC,
      transferred: r.transferred,
    })),
  };
}
