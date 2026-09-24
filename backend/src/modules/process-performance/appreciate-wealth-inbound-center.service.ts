import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { AW_SQL_DATE, resolveRange, loadCalls, type CallRec } from "./appreciate-wealth-dashboard.service.js";

/**
 * Appreciate Wealth "Inbound Call Performance" slide: KPI strip, offered vs
 * answered trend, abandoned-call breakup, unique vs repeat, the monthly/weekly
 * KPI grid and the daily details table -- all from aw_inbound rows with
 * call_type = Inbound, loaded through the same de-duplicating loadCalls() the
 * existing Inbound tab uses (so numbers agree with it).
 *
 * Definitions (chosen to reproduce the supplied mock-up's own arithmetic):
 *  - Call Offered   distinct call_id.
 *  - Call Answered  distinct call_id with at least one leg whose status is Answered.
 *  - AL %           Answered / Offered (the app's redefined Answer Level).
 *  - Abn Calls      Offered - Answered (calls that no agent answered);  Abn % = Abn / Offered.
 *      split into: never reached an agent (no agent on any leg) and
 *      reached an agent but not answered.
 *  - Unique Calls   distinct callers (caller_no) inside the column's own window;
 *    Repeat Calls   Offered - Unique;  Repeat % = Repeat / Offered.
 *  - Total Talk     sum of talk time over answered legs;  Avg Talk = Total / Answered;
 *    AHT            sum of handling time over answered legs / Answered.
 *
 * NOT computable, so not shown: the mock-up's "abandoned before / within / after
 * window" split (no operating-window definition exists in the data) and queue
 * based service level (queue / answer times exist on only part of the file).
 * History: only the months present in the uploads get a column.
 */

const round1 = (v: number): number => Math.round(v * 10) / 10;
const pct = (part: number, whole: number): number => (whole > 0 ? round1((part / whole) * 100) : 0);
const p2 = (n: number): string => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
function dayDiff(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}
const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;
function monthsBack(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-01`;
}

export interface InKpis {
  offered: number; answered: number; alPct: number; abn: number; abnPct: number;
  neverReached: number; reachedNotAnswered: number;
  uniqueCalls: number; repeatCalls: number; repeatPct: number;
  talkS: number; avgTalkS: number; ahtS: number;
}
export interface InDay extends InKpis { date: string }
export interface InColumn { key: string; label: string; kind: "month" | "week"; from: string; to: string }
export interface AwInboundCenter {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string;
  coverage: { from: string | null; to: string | null };
  kpis: InKpis; prev: InKpis | null;
  daily: InDay[];
  columns: InColumn[]; grid: Record<string, InKpis>;
}

function kpisOf(rows: CallRec[]): InKpis {
  const byCall = new Map<string, CallRec[]>();
  for (const r of rows) { const l = byCall.get(r.callId); if (l) l.push(r); else byCall.set(r.callId, [r]); }
  let answered = 0, neverReached = 0, reachedNotAnswered = 0, talkS = 0, handlingS = 0;
  const callers = new Set<string>();
  for (const [callId, legs] of byCall) {
    const ansLegs = legs.filter((l) => l.answered);
    if (ansLegs.length) { answered += 1; for (const l of ansLegs) { talkS += l.talkS; handlingS += l.handlingS; } }
    else if (legs.some((l) => l.agent !== "(no agent)")) reachedNotAnswered += 1;
    else neverReached += 1;
    callers.add(legs[0].callerNo ? legs[0].callerNo : `call:${callId}`);
  }
  const offered = byCall.size;
  const abn = offered - answered;
  const uniqueCalls = callers.size;
  return {
    offered, answered, alPct: pct(answered, offered), abn, abnPct: pct(abn, offered),
    neverReached, reachedNotAnswered, uniqueCalls, repeatCalls: offered - uniqueCalls, repeatPct: pct(offered - uniqueCalls, offered),
    talkS, avgTalkS: answered > 0 ? Math.round(talkS / answered) : 0, ahtS: answered > 0 ? Math.round(handlingS / answered) : 0,
  };
}

async function inboundCoverage(): Promise<{ from: string | null; to: string | null }> {
  const D = AW_SQL_DATE("call_date");
  const [[r]] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MIN(${D}), '%Y-%m-%d') AS mn, DATE_FORMAT(MAX(${D}), '%Y-%m-%d') AS mx FROM db_masmis.aw_inbound WHERE call_type = 'Inbound'`,
  );
  return { from: (r?.mn as string | null) ?? null, to: (r?.mx as string | null) ?? null };
}

export async function getAwInboundCenter(fromInput: string, toInput: string): Promise<AwInboundCenter> {
  const { from, to } = resolveRange(fromInput, toInput);
  const cov = await inboundCoverage();
  // Uploads end on a known day: compare like with like (same number of DAYS OF DATA) rather than a long empty tail.
  const effectiveTo = cov.to && cov.to >= from && cov.to < to ? cov.to : to;
  const len = dayDiff(from, effectiveTo) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));

  // Enough history for six month-columns and the previous period.
  const loadFrom = [from, prevFrom, monthsBack(effectiveTo, 5)].sort()[0];
  const { rows } = await loadCalls("inbound", loadFrom, to);
  const ib = rows.filter((r) => r.callType === "Inbound");
  const within = (a: string, b: string) => ib.filter((r) => r.date >= a && r.date <= b);

  const cur = within(from, to);
  const prevRows = within(prevFrom, prevTo);

  const byDate = new Map<string, CallRec[]>();
  for (const r of cur) { const l = byDate.get(r.date); if (l) l.push(r); else byDate.set(r.date, [r]); }
  // Most recent 62 days up to the last uploaded day; leading days before the first call are trimmed (a YTD range would otherwise open with weeks of empty rows).
  const dailyFrom = [from, addDays(effectiveTo, -61)].sort().pop() as string;
  let daily: InDay[] = [];
  for (let d = dailyFrom; d <= effectiveTo; d = addDays(d, 1)) daily.push({ date: d, ...kpisOf(byDate.get(d) ?? []) });
  const firstWithData = daily.findIndex((d) => d.offered > 0);
  if (firstWithData > 0) daily = daily.slice(firstWithData);

  // Month columns (only months that hold inbound calls) + 7-day week blocks of the latest month.
  const columns: InColumn[] = [];
  const monthKeys = [...new Set(ib.map((r) => r.date.slice(0, 7)))].sort().slice(-6);
  for (const mk of monthKeys) {
    const mFrom = `${mk}-01`;
    const [y, m] = mk.split("-").map(Number);
    const mTo = `${mk}-${p2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
    columns.push({ key: mk, label: `${MON[m - 1]}'${String(y).slice(2)}`, kind: "month", from: mFrom, to: mTo });
  }
  const anchorMonth = monthKeys[monthKeys.length - 1];
  if (anchorMonth) {
    const [y, m] = anchorMonth.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lastDay = ib.filter((r) => r.date.startsWith(anchorMonth)).reduce((mx, r) => (r.date > mx ? r.date : mx), `${anchorMonth}-01`);
    const lastDom = Number(lastDay.slice(8, 10));
    for (let w = 1; (w - 1) * 7 + 1 <= lastDom; w++) {
      const s = (w - 1) * 7 + 1; const e = Math.min(w * 7, dim);
      columns.push({ key: `${anchorMonth}-W${w}`, label: `Wk-${w}`, kind: "week", from: `${anchorMonth}-${p2(s)}`, to: `${anchorMonth}-${p2(e)}` });
    }
  }
  const grid: Record<string, InKpis> = {};
  for (const c of columns) grid[c.key] = kpisOf(within(c.from, c.to));

  return {
    from, to, effectiveTo, prevFrom, prevTo, coverage: cov,
    kpis: kpisOf(cur), prev: prevRows.length ? kpisOf(prevRows) : null,
    daily, columns, grid,
  };
}
