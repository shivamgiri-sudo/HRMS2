import { createHmac } from "node:crypto";
import { getDialerPool } from "../../db/dialerDb.js";
import { PROJECTS } from "./inbound.service.js";
import { buildPeriodColumns } from "../process-performance/clovia-lob.shared.js";

/**
 * Inbound insights for the dialer-backed inbound processes (DU Bangladesh, Exicom, Viega,
 * Dalmia, Neemans = pattern B; GNC, Bellavita = pattern A).
 *
 * Additive module: the existing /api/inbound endpoints are untouched. The
 * calls for the selected window are read ONCE from the read-only dialer table
 * and every view (overview, hour-wise, date-wise, agent-wise, LOB-wise, wait,
 * callers) is derived from that same row set, so no two tabs can disagree.
 *
 * Definitions (identical to inbound.service.ts; unified across every project
 * 2026-09-23 at explicit user request -- previously pattern A counted certain
 * VDCL rows as "answered (after-hours)" and SL%/AL% were computed differently;
 * both are now the same formula for every process, threshold aside):
 *   answered  = AgentId != 'VDCL'   (VDCL = call never reached an agent; no
 *               after-hours carve-out any more -- a call an agent never took
 *               is abandoned, full stop, for every project)
 *   abandoned = offered - answered
 *   AL%       = Answered / Offered
 *   SL%       = (calls answered with wait <= threshold) / Answered
 *               -- threshold is 20s for pattern A (GNC, Bellavita), 30s for
 *               pattern B (DU Bangladesh, Exicom, Viega, Dalmia, Neemans)
 *   wait      = TIME_TO_SEC(QueueDuration)
 *   AHT       = mean CallDurationSecond of agent-handled calls (AgentId != 'VDCL')
 *   hour      = HOUR(HoursSlot)  (CallDate carries no time of day)
 *
 * Not computed because the dialer table holds no source for them: occupancy /
 * utilisation (no login-time data), planned staffing, callback outcomes.
 */

export const INSIGHT_PROJECT_KEYS = ["dubangladesh", "exicom", "viega", "dalmia", "neemans", "gnc", "bellavita", "clovia"] as const;
/** Pattern A projects (GNC, Bellavita) measure service level at 20s, pattern B at 30s -- as inbound.service.ts does. */
const SL_SEC_A = 20;
const SL_SEC_B = 30;
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
  /** "09:15" style 15-minute-of-day bucket, from quarterOf(time) -- see quarterHourly. */
  quarter?: string;
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
  /** Reached an agent (AgentId != 'VDCL') -- identical to `handled`, kept as
   * its own field since most of this file reads "answered" by name. */
  answered: boolean;
  /** Same as `answered` (AgentId != 'VDCL'); kept for the AHT/talk-time code
   * below, which predates the two fields being merged. */
  handled: boolean;
  /** Answered within the project's service-level threshold. */
  inSl: boolean;
  /** Queue wait within the threshold (used for "short abandon"). */
  shortWait: boolean;
}

const n = (v: unknown) => Number(v) || 0;
const fmtN = (v: number) => v.toLocaleString("en-IN");
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (num: number, den: number) => (den ? round2((num / den) * 100) : 0);
const avg = (sum: number, cnt: number) => (cnt ? Math.round(sum / cnt) : 0);

export function isInsightProject(key: string): boolean {
  return (INSIGHT_PROJECT_KEYS as readonly string[]).includes(key);
}

function getProject(key: string) {
  const p = PROJECTS.find((x) => x.key === key);
  if (!p || !isInsightProject(key)) {
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

async function loadCalls(projectKey: string, f: InsightFilters): Promise<{ rows: CallRow[]; truncated: boolean; campaigns: string[]; slSec: number }> {
  const p = getProject(projectKey);
  assertRange(f);
  if (f.campaign && !p.campaigns.includes(f.campaign)) throw new Error("Unknown campaign for this project");

  const slSec = p.pattern === "A" ? SL_SEC_A : SL_SEC_B;
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
        AND CampaignName IN (${ph})${p.pattern === "A" ? " AND DisconnBy != 'HOLDTIME'" : ""}
      ORDER BY CallDate ASC, id ASC
      LIMIT ${MAX_ROWS + 1}`,
    [f.startDate, f.endDate, ...campaigns]
  );

  const list = raw as Record<string, unknown>[];
  const truncated = list.length > MAX_ROWS;
  const rows: CallRow[] = (truncated ? list.slice(0, MAX_ROWS) : list).map((r) => {
    const agentId = String(r.AgentId ?? "");
    const handled = agentId !== "VDCL";
    const waitSec = n(r.wait);
    // No after-hours carve-out any more -- a call an agent never took is
    // abandoned, for every project (removed 2026-09-23 per explicit request).
    const answered = handled;
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
      wait: waitSec,
      hold: n(r.hold),
      talk: n(r.talk),
      acw: n(r.acw),
      transferred: transferId !== "" && transferId !== "0",
      answered,
      handled,
      inSl: answered && waitSec <= slSec,
      shortWait: waitSec <= slSec,
    };
  });
  return { rows, truncated, campaigns: p.campaigns, slSec };
}

/* ────────────────────────── aggregation helpers ────────────────────────── */

interface Acc {
  offered: number;
  answered: number;
  handled: number;
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
  offered: 0, answered: 0, handled: 0, abandoned: 0, slNum: 0, durSum: 0, talkSum: 0, holdSum: 0, acwSum: 0,
  waitAnsweredSum: 0, waitAbandonSum: 0, maxWait: 0, transfers: 0, shortAbandon: 0,
});

function add(a: Acc, r: CallRow) {
  a.offered++;
  if (r.wait > a.maxWait) a.maxWait = r.wait;
  if (r.transferred) a.transfers++;
  if (r.answered) {
    a.answered++;
    if (r.inSl) a.slNum++;
  } else {
    a.abandoned++;
    a.waitAbandonSum += r.wait;
    if (r.shortWait) a.shortAbandon++;
  }
  if (r.handled) {
    a.handled++;
    a.durSum += r.duration;
    a.talkSum += r.talk;
    a.holdSum += r.hold;
    a.acwSum += r.acw;
    a.waitAnsweredSum += r.wait;
  }
}

function metrics(a: Acc) {
  return {
    offered: a.offered,
    answered: a.answered,
    abandoned: a.abandoned,
    answeredPct: pct(a.answered, a.offered),
    // AL% redefined 2026-09-23 at explicit user request: Answered / Offered
    // (previously Abandoned / Offered) -- same field/label everywhere it's
    // already shown as "AL%", just a different formula now. Identical to
    // answeredPct above; kept as its own field so every existing "AL%"
    // consumer keeps reading the same key.
    abandonPct: pct(a.answered, a.offered),
    // SL% redefined 2026-09-23: (answered within threshold) / Answered
    // (previously / Offered) -- this is what slOfAnsweredPct used to compute;
    // that field is now gone since slPct IS that number.
    slPct: pct(a.slNum, a.answered),
    aht: avg(a.durSum, a.handled),
    avgTalk: avg(a.talkSum, a.handled),
    avgHold: avg(a.holdSum, a.handled),
    avgAcw: avg(a.acwSum, a.handled),
    asa: avg(a.waitAnsweredSum, a.handled),
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

/** "09:15" style 15-minute-of-day bucket from a "HH:MM:SS" time string (falls back to "00:00"). */
function quarterOf(time: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  if (!m) return "00:00";
  const q = Math.floor(Number(m[2]) / 15) * 15;
  return `${m[1]}:${String(q).padStart(2, "0")}`;
}

function bucketIndex(sec: number, buckets: readonly { min: number; max: number }[]) {
  return buckets.findIndex((b) => sec >= b.min && sec <= b.max);
}

/**
 * First-contact-resolution, tagged by the agent on the dialer's disposition form (dialer_db.data_master_in).
 *  - Neemans:   client 475, Field1 = 'Inbound', FCR = Field2 = 'FCR', over the calls that carry a Field2 tag
 *               (the same share inbound.service.ts / the SOP report use).
 *  - Bellavita: client 375, Field13 = 'Inbound', FCR = Field28 = 'FCR', over every tagged inbound call
 *               (the SOP report's definition, inbound-cdr-sync.service.ts bellavitaQuery) -- "Not Required" counts in the base.
 * The tagging row carries the agent as callcreated = "DialDesk - <employee code>", which is the CDR's AgentId.
 * Best-effort -- a failure here must not take the whole dashboard down.
 */
const FCR_SOURCES: Record<string, { clientId: number; valueField: string; inboundCond: string; totalExpr: string }> = {
  neemans: { clientId: 475, valueField: "Field2", inboundCond: "Field1 = 'Inbound'", totalExpr: "COUNT(Field2)" },
  bellavita: { clientId: 375, valueField: "Field28", inboundCond: "Field13 = 'Inbound'", totalExpr: "COUNT(*)" },
};

interface FcrResult {
  overall: number | null;
  byDate: Map<string, number>;
  byAgent: Map<string, { fcr: number; tot: number }>;
  byAgentDate: Map<string, { fcr: number; tot: number }>;
}

const agentCodeOf = (callcreated: unknown): string => {
  const m = /-\s*([A-Za-z0-9]+)\s*$/.exec(String(callcreated ?? ""));
  return m ? m[1].toUpperCase() : "";
};

// data_master_in is large and the range scan takes 7-20s on the shared DB, so a result is kept for a while and a slow
// query is never awaited past FCR_WAIT_MS -- the dashboard then shows "—" for FCR and the finished query fills the cache.
const FCR_TTL_MS = 15 * 60 * 1000;
const FCR_WAIT_MS = 22_000;
const fcrCache = new Map<string, { at: number; value: Promise<FcrResult | null> }>();

async function queryFcr(projectKey: string, f: InsightFilters): Promise<FcrResult | null> {
  const src = FCR_SOURCES[projectKey];
  if (!src) return null;
  try {
    const pool = await getDialerPool();
    const [raw] = await pool.execute(
      `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS d, callcreated AS a,
              SUM(CASE WHEN ${src.valueField} = 'FCR' THEN 1 ELSE 0 END) AS fcr, ${src.totalExpr} AS tot
         FROM dialer_db.data_master_in
        WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY) AND ClientId = ? AND ${src.inboundCond}
        GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d'), callcreated`,
      [f.startDate, f.endDate, src.clientId],
    );
    const dayTot = new Map<string, { fcr: number; tot: number }>();
    const byAgent = new Map<string, { fcr: number; tot: number }>();
    const byAgentDate = new Map<string, { fcr: number; tot: number }>();
    const bump = (m: Map<string, { fcr: number; tot: number }>, k: string, fcr: number, tot: number) => {
      const c = m.get(k) ?? { fcr: 0, tot: 0 };
      c.fcr += fcr; c.tot += tot; m.set(k, c);
    };
    let fcrSum = 0;
    let totSum = 0;
    for (const r of raw as Record<string, unknown>[]) {
      const d = String(r.d); const fcr = n(r.fcr); const tot = n(r.tot); const agent = agentCodeOf(r.a);
      bump(dayTot, d, fcr, tot);
      if (agent) { bump(byAgent, agent, fcr, tot); bump(byAgentDate, `${agent}|${d}`, fcr, tot); }
      fcrSum += fcr; totSum += tot;
    }
    const byDate = new Map<string, number>();
    for (const [d, v] of dayTot) byDate.set(d, pct(v.fcr, v.tot));
    return { overall: totSum ? pct(fcrSum, totSum) : null, byDate, byAgent, byAgentDate };
  } catch {
    return null;
  }
}

function loadFcr(projectKey: string, f: InsightFilters): Promise<FcrResult | null> {
  if (!FCR_SOURCES[projectKey]) return Promise.resolve(null);
  const key = `${projectKey}|${f.startDate}|${f.endDate}`;
  const hit = fcrCache.get(key);
  if (hit && Date.now() - hit.at < FCR_TTL_MS) return hit.value;
  const value = queryFcr(projectKey, f).then((v) => { if (!v) fcrCache.delete(key); return v; });
  fcrCache.set(key, { at: Date.now(), value });
  if (fcrCache.size > 60) for (const k of fcrCache.keys()) { fcrCache.delete(k); if (fcrCache.size <= 40) break; }
  return value;
}

/** loadFcr, but never waits longer than FCR_WAIT_MS (the query keeps running and fills the cache). */
function loadFcrWithinBudget(projectKey: string, f: InsightFilters): Promise<FcrResult | null> {
  return Promise.race([loadFcr(projectKey, f), new Promise<null>((resolve) => setTimeout(() => resolve(null), FCR_WAIT_MS))]);
}

/**
 * A number that accounts for a large share of all calls is a shared line (trunk /
 * IVR CLI), not a customer. Neemans is the live example: one number is 5,322 of
 * 5,771 calls in a month. Treating it as a "caller" would report 97% repeat calls
 * and hide every real caller, so caller analysis excludes it and says so.
 */
function detectSharedNumber(rows: CallRow[]): { phone: string; calls: number } | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.phone) counts.set(r.phone, (counts.get(r.phone) ?? 0) + 1);
  let top: { phone: string; calls: number } | null = null;
  for (const [phone, calls] of counts) if (!top || calls > top.calls) top = { phone, calls };
  return top && top.calls >= 50 && top.calls / rows.length >= 0.3 ? top : null;
}

function buildBellavitaGroups(rows: CallRow[]) {
  const parse = (campaign: string) => {
    const m = /^([HE])_([A-Za-z]+)_/.exec(campaign);
    return m ? { language: m[1] === "H" ? "Hindi" : "English", brand: m[2] } : null;
  };
  const roll = (keyFn: (c: { language: string; brand: string }) => string) => {
    const acc = new Map<string, Acc>();
    for (const r of rows) {
      const c = parse(r.campaign);
      if (!c) continue;
      const k = keyFn(c);
      let a = acc.get(k);
      if (!a) { a = newAcc(); acc.set(k, a); }
      add(a, r);
    }
    return [...acc.entries()]
      .map(([label, a]) => ({ label, ...metrics(a), sharePct: pct(a.offered, rows.length) }))
      .sort((x, y) => y.offered - x.offered);
  };
  return { byBrand: roll((c) => c.brand), byLanguage: roll((c) => c.language) };
}

/* ─────────────────────────────── insights ─────────────────────────────── */

export async function getInboundInsights(projectKey: string, f: InsightFilters) {
  const fcrP = loadFcrWithinBudget(projectKey, f); // started now so it overlaps the CDR load
  const { rows, truncated, campaigns, slSec } = await loadCalls(projectKey, f);
  const p = getProject(projectKey);

  const total = newAcc();
  const shared = detectSharedNumber(rows);
  const isCaller = (r: CallRow) => Boolean(r.phone) && r.phone !== shared?.phone;
  const callers = new Map<string, { phone: string; calls: number; answered: number; abandoned: number; lastDate: string; campaigns: Set<string> }>();
  const agentSet = new Set<string>();
  let holdCalls = 0;
  for (const r of rows) {
    add(total, r);
    if (r.handled) {
      agentSet.add(r.agentId);
      if (r.hold > 0) holdCalls++;
    }
    if (isCaller(r)) {
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
    if (r.handled) {
      if (!dayAgents.has(r.date)) dayAgents.set(r.date, new Set());
      dayAgents.get(r.date)!.add(r.agentId);
    }
    if (isCaller(r)) {
      if (!dayCallers.has(r.date)) dayCallers.set(r.date, new Set());
      dayCallers.get(r.date)!.add(r.phone);
    }
  }
  const fcr = await fcrP;
  const daily = dateKeys.map((d) => ({
    date: d,
    weekday: WEEKDAYS[weekdayOf(d)],
    ...metrics(byDate.get(d)!),
    agents: dayAgents.get(d)?.size ?? 0,
    uniqueCallers: dayCallers.get(d)?.size ?? 0,
    fcrPct: fcr?.byDate.get(d) ?? null,
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

  // ── 15-minute-of-day slots (reference report's "Slot wise" / "15 Mnts" sheets), summed across
  // the whole selected range -- same shape as `hourly`, just finer-grained. Purely derived from
  // the rows already loaded above (the `time` field), no extra query.
  const byQuarter = groupBy(rows, (r) => quarterOf(r.time));
  const quarterKeys = [...byQuarter.keys()].sort();
  const quarterHourly = quarterKeys.map((q) => ({
    slot: q,
    ...metrics(byQuarter.get(q)!),
    sharePct: pct(byQuarter.get(q)!.offered, total.offered),
  }));

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
    else if (r.inSl) c.s++;
  }
  const heatmap = [...heat.entries()].map(([k, v]) => {
    const [date, hour] = k.split("|");
    return { date, hour: Number(hour), offered: v.o, abandoned: v.a, answeredInSl: v.s };
  });

  // ── agents ──
  const answeredRows = rows.filter((r) => r.handled);
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
        handled: a.handled,
        sharePct: pct(a.handled, total.handled),
        slWithinPct: pct(a.slNum, a.answered),
        fcrPct: fcr?.byAgent.get(agentId.toUpperCase()) ? pct(fcr.byAgent.get(agentId.toUpperCase())!.fcr, fcr.byAgent.get(agentId.toUpperCase())!.tot) : null,
        fcrTagged: fcr?.byAgent.get(agentId.toUpperCase())?.tot ?? 0,
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
        callsPerDay: round1(a.handled / Math.max(i.dates.size, 1)),
        firstCall: i.first,
        lastCall: i.last,
      };
    })
    .sort((x, y) => y.handled - x.handled);

  // One row per agent per day: volume plus the same service/handling metrics as the agent table, so clicking an agent
  // can show that agent's date-wise performance (FCR% included where the project has it).
  const agentDaily: Array<{
    agentId: string; date: string; calls: number; slWithinPct: number; aht: number; avgTalk: number; avgHold: number; avgAcw: number;
    transfers: number; fcrPct: number | null; fcrTagged: number;
  }> = [];
  for (const [k, a] of groupBy(answeredRows, (r) => `${r.agentId}|${r.date}`)) {
    const [agentId, date] = k.split("|");
    const m = metrics(a);
    const fc = fcr?.byAgentDate.get(`${agentId.toUpperCase()}|${date}`);
    agentDaily.push({
      agentId, date, calls: a.handled, slWithinPct: pct(a.slNum, a.answered), aht: m.aht, avgTalk: m.avgTalk, avgHold: m.avgHold,
      avgAcw: m.avgAcw, transfers: a.transfers, fcrPct: fc ? pct(fc.fcr, fc.tot) : null, fcrTagged: fc?.tot ?? 0,
    });
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
      uniqueCallers: new Set(rows.filter((r) => r.campaign === campaign && isCaller(r)).map((r) => r.phone)).size,
      agents: new Set(rows.filter((r) => r.campaign === campaign && r.handled).map((r) => r.agentId)).size,
    }))
    .sort((x, y) => y.offered - x.offered);

  // Bellavita's 16 campaigns are named <H|E>_<Brand>_<Line>; roll them up by brand and by language.
  const lobGroups = projectKey === "bellavita" ? buildBellavitaGroups(rows) : null;

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
    slThresholdSec: slSec,
    uniqueCallers: callerList.length,
    repeatCallers: repeatCallers.length,
    repeatCallerPct: pct(repeatCallers.length, callerList.length),
    repeatCallPct: pct(rows.filter((r) => isCaller(r) && (callers.get(r.phone)?.calls ?? 0) > 1).length, rows.length - (shared?.calls ?? 0)),
    sharedNumber: shared ? { masked: maskPhone(shared.phone), calls: shared.calls, sharePct: pct(shared.calls, rows.length) } : null,
    unservedCallers: unserved.length,
    agentsActive: agentSet.size,
    callsPerAgent: agentSet.size ? round1(total.handled / agentSet.size) : 0,
    daysWithCalls: dateKeys.length,
    avgCallsPerDay: dateKeys.length ? round1(total.offered / dateKeys.length) : 0,
    holdCallPct: pct(holdCalls, total.handled),
    fcrPct: fcr?.overall ?? null,
    shortAbandonPct: pct(total.shortAbandon, total.abandoned),
    peakHour: peak ? { label: peak.label, offered: peak.offered } : null,
    busiestDay: busiest ? { date: busiest.date, offered: busiest.offered } : null,
  };

  // ── narrative insights: only facts computed from the rows above ──
  const insights: { tone: "info" | "good" | "warn" | "bad"; text: string }[] = [];
  if (total.offered) {
    if (peak) insights.push({ tone: "info", text: `Peak hour is ${peak.label} with ${peak.offered} calls (${peak.sharePct}% of volume).` });
    // abandonPct is now AL% (Answered/Offered, high = good), so the WORST hour/day
    // for abandonment is the one with the LOWEST abandonPct -- sort ascending and
    // report the true abandon share (100 - AL%) in the text.
    const worstAband = hourly.filter((h) => h.offered >= 5).sort((a, b) => a.abandonPct - b.abandonPct)[0];
    if (worstAband && worstAband.abandoned > 0) {
      insights.push({ tone: "warn", text: `Highest abandon rate is at ${worstAband.label}: ${round2(100 - worstAband.abandonPct)}% (${worstAband.abandoned} of ${worstAband.offered} calls).` });
    }
    const worstSl = hourly.filter((h) => h.offered >= 5).sort((a, b) => a.slPct - b.slPct)[0];
    if (worstSl && worstSl.slPct < 100) {
      insights.push({ tone: worstSl.slPct < 80 ? "bad" : "warn", text: `Lowest service level is at ${worstSl.label}: ${worstSl.slPct}% answered within ${slSec}s.` });
    }
    const worstDay = daily.filter((d) => d.offered >= 5).sort((a, b) => a.abandonPct - b.abandonPct)[0];
    if (worstDay && worstDay.abandoned > 0) {
      insights.push({ tone: "warn", text: `Worst abandon day is ${worstDay.date} (${worstDay.weekday}): ${round2(100 - worstDay.abandonPct)}% abandoned.` });
    }
    if (agents.length > 1 && agents[0].sharePct >= 35) {
      insights.push({ tone: "info", text: `${agents[0].agentName} handled ${agents[0].sharePct}% of answered calls — workload is concentrated on one agent.` });
    }
    if (shared) {
      insights.push({ tone: "warn", text: `${pct(shared.calls, rows.length)}% of calls (${fmtN(shared.calls)}) come from one number (${maskPhone(shared.phone)}) — a shared line, not a customer. Caller, repeat and never-answered figures exclude it.` });
    }
    if (unserved.length) {
      insights.push({ tone: "bad", text: `${unserved.length} caller${unserved.length > 1 ? "s" : ""} called in this period and never reached an agent.` });
    }
    if (repeatCallers.length) {
      insights.push({ tone: "info", text: `${repeatCallers.length} callers (${headline.repeatCallerPct}%) called more than once; they account for ${headline.repeatCallPct}% of calls.` });
    }
    if (total.abandoned && headline.shortAbandonPct >= 50) {
      insights.push({ tone: "info", text: `${headline.shortAbandonPct}% of abandoned calls dropped within ${slSec}s of queueing.` });
    }
    // abandonPct is AL% (Answered/Offered) now, so "healthy" means both figures high.
    if (m.slPct >= 90 && m.abandonPct >= 90) insights.push({ tone: "good", text: `Service is healthy: SL ${m.slPct}% and AL ${m.abandonPct}%.` });
  }

  return {
    project: { key: p.key, name: p.name, campaigns },
    filters: { startDate: f.startDate, endDate: f.endDate, campaign: f.campaign ?? null },
    definitions: {
      offered: "Every inbound call routed to the queue",
      answered: "Calls handled by an agent",
      abandoned: "Calls that never reached an agent (agent = VDCL)",
      al: "AL % = Answered / Offered",
      sl: `SL % = answered within ${slSec}s of queueing, as % of ANSWERED calls`,
      ...(FCR_SOURCES[projectKey] ? { fcr: projectKey === "bellavita"
        ? "FCR % = calls tagged 'FCR' / all inbound calls tagged on the disposition form (Field13 = Inbound); tagged 'Not Required' stay in the base"
        : "FCR % = calls tagged 'FCR' / inbound calls carrying an FCR tag (FCR + NFCR)" } : {}),
      aht: "Average call duration of answered calls",
      asa: "Average queue wait of answered calls",
      unavailable: "Occupancy, staffing plan and callback outcomes are not in the dialer data",
    },
    truncated,
    headline,
    insights,
    daily,
    hourly,
    quarterHourly,
    weekdays,
    heatmap,
    agents,
    agentDaily,
    agentHourly,
    lobs,
    lobGroups,
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
  if (f.quarter) list = list.filter((r) => quarterOf(r.time) === f.quarter);
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
      agentName: r.handled ? r.agentName : null,
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
      withinSl: r.inSl,
      transferred: r.transferred,
    })),
  };
}

/* ─────────────────── week-wise / date-wise columns (export) ─────────────────── */

/**
 * The Overview figures for the whole range, for every week block (W-1 = days
 * 1-7 of the month, W-2 = 8-14, ...) and for every day, from the SAME row set and
 * the SAME metrics() definition as getInboundInsights -- so the export's Value
 * column, its week columns and its date columns cannot disagree with the screen.
 * Empty periods are zeros. Additive: nothing above is changed.
 */
export async function getInboundPeriods(projectKey: string, f: InsightFilters) {
  const { rows, campaigns, slSec } = await loadCalls(projectKey, f);
  const { columns, dailyColumnsOmitted } = buildPeriodColumns(f.startDate, f.endDate);
  const shared = detectSharedNumber(rows);
  const of = (from: string, to: string) => rows.filter((r) => r.date >= from && r.date <= to);
  const compute = (list: CallRow[]) => {
    const a = newAcc();
    const agentSet = new Set<string>();
    const callerSet = new Set<string>();
    for (const r of list) {
      add(a, r);
      if (r.handled) agentSet.add(r.agentId);
      if (r.phone && r.phone !== shared?.phone) callerSet.add(r.phone);
    }
    const m = metrics(a);
    return {
      offered: m.offered, answered: m.answered, abandoned: m.abandoned, answeredPct: m.answeredPct, abandonPct: m.abandonPct,
      slPct: m.slPct, aht: m.aht, avgTalk: m.avgTalk, avgHold: m.avgHold, avgAcw: m.avgAcw, asa: m.asa,
      avgAbandonWait: m.avgAbandonWait, maxWait: m.maxWait, transfers: m.transfers,
      uniqueCallers: callerSet.size, agents: agentSet.size, callsPerAgent: agentSet.size ? round1(a.handled / agentSet.size) : 0,
    } as Record<string, number>;
  };
  const defs: Array<{ key: string; label: string; fmt: "int" | "pct" | "sec" | "dec1" }> = [
    { key: "offered", label: "Offered Calls", fmt: "int" }, { key: "answered", label: "Answered", fmt: "int" }, { key: "abandoned", label: "Abandoned", fmt: "int" },
    { key: "answeredPct", label: "Answer %", fmt: "pct" }, { key: "abandonPct", label: "AL %", fmt: "pct" },
    { key: "slPct", label: `Service Level (${slSec}s, of answered)`, fmt: "pct" },
    { key: "aht", label: "AHT (s)", fmt: "sec" }, { key: "avgTalk", label: "Avg Talk (s)", fmt: "sec" }, { key: "avgHold", label: "Avg Hold (s)", fmt: "sec" },
    { key: "avgAcw", label: "Avg After-call Work (s)", fmt: "sec" }, { key: "asa", label: "Avg Speed of Answer (s)", fmt: "sec" },
    { key: "avgAbandonWait", label: "Avg Abandon Wait (s)", fmt: "sec" }, { key: "maxWait", label: "Longest Wait (s)", fmt: "sec" },
    { key: "uniqueCallers", label: "Unique Callers", fmt: "int" }, { key: "agents", label: "Active Agents", fmt: "int" },
    { key: "callsPerAgent", label: "Calls Handled / Agent", fmt: "dec1" }, { key: "transfers", label: "Transferred Calls", fmt: "int" },
  ];
  const whole = compute(of(f.startDate, f.endDate));
  const perCol = new Map(columns.map((c) => [c.key, compute(of(c.from, c.to))]));
  const metricRows = defs.map((d) => ({
    key: d.key, label: d.label, fmt: d.fmt, value: whole[d.key] ?? 0,
    cols: Object.fromEntries(columns.map((c) => [c.key, perCol.get(c.key)?.[d.key] ?? 0])),
  }));
  const campRows = campaigns.map((c) => ({
    key: c, label: c, fmt: "int" as const, value: rows.filter((r) => r.campaign === c).length,
    cols: Object.fromEntries(columns.map((col) => [col.key, of(col.from, col.to).filter((r) => r.campaign === c).length])),
  }));
  return {
    from: f.startDate, to: f.endDate, columns, dailyColumnsOmitted,
    tables: [
      { title: "Inbound metrics", rowsLabel: "Metric", rows: metricRows },
      ...(campaigns.length > 1 ? [{ title: "Offered calls by campaign", rowsLabel: "Campaign", rows: campRows }] : []),
    ],
  };
}
