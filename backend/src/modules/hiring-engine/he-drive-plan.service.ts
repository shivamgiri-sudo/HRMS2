/**
 * Plan section of the Drive Command Center (GET /drive-plan). READ-ONLY: the D-1 checklist runs the Plan 3 stream pass as a DRY RUN
 * (planStreamsForDay with dryRun true: no lock, no insert, no update), every other statement is a SELECT. Branch-scoped, cached 60 s per
 * scope. Each section is read on its own; a failure logs { section, code } only and flags the result partial (a partial result is never
 * cached). ER_NO_SUCH_TABLE on requisition_stream* reads as "no rows". No candidate data: counts, dates, ids and labels only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { calendarCells, planDay, streamRate, type CalendarCell, type PlanDay, type PlanStreamInput, type StreamRate } from "./he-drive-plan.js";
import { INSIGHT_DEFAULTS, type InsightThresholds } from "./he-drive-insights.js";
import { loadInsightThresholds } from "./he-insight-params.service.js";
import { nextWorkingDay } from "./he-plan.service.js";
import { getRequisitionReadiness } from "./he-readiness.service.js";
import { getDailyPlan } from "./he-policy.service.js";
import { valueAddOn } from "./he-valueadd-switches.js";
import { calibratedCaps, calibratedPerSlot } from "./he-showrate-calibration.js";
import { loadRateBook, rateForStream, type RateBook } from "./he-showrate-calibration.service.js";
import { driveCapacity, dailyPlanNumbers, DEFAULT_DAILY_PLAN, type DailyPlan } from "./he-slots.js";
import { planStreamsForDay, streamCaps, type StreamDayPlan } from "./he-stream-plan.service.js";
import { readAgg } from "./he-drive-trend.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import { loadActiveStreams, toWindow, type StreamRow } from "./requisition-stream.service.js";
import { addDays, coversDay, istToday, windowDays, windowEnd } from "./requisition-stream.window.js";

export interface ChecklistItem { kind: "will_plan" | "already_planned" | "fill_soon" | "stream_ends_tomorrow" | "pool_below_quota" | "readiness"; text: string; streamId?: string }
export interface DrivePlan {
  requisitionId: string; code: string; branch: string; generatedAt: string; from: string;
  days: PlanDay[]; calendar: CalendarCell[]; rates: StreamRate[];
  /** Present only with HE_SHOWRATE_CALIBRATION on and measured: the day lines and caps use the planner's calibrated rates. */
  showRateMode?: "calibrated";
  /** With showRateMode: the trailing window the rates were measured over (insight.plan_trailing_days). */
  showRateWindowDays?: number;
  checklist: { date: string; preview: StreamDayPlan | null; items: ChecklistItem[] };
  partial: boolean; failedSections: string[];
}

const CACHE_MS = 60_000;
const CACHE_MAX = 100;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 14;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const ph = (n: number): string => Array(n).fill("?").join(",");
const code = (err: unknown): string => (err as { code?: string })?.code ?? "unknown";
const noTable = (err: unknown): boolean => code(err) === "ER_NO_SUCH_TABLE";
const isRealDay = (x: unknown): x is string => {
  if (typeof x !== "string" || !ISO_RE.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
};
const day10 = (v: unknown): string => String(v).slice(0, 10);
const TYPE_NAME: Record<SourceType, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };
const labelOf = (s: StreamRow): string => (s.originLabel && s.originLabel.trim() ? s.originLabel : TYPE_NAME[s.sourceType]);

// Never the driver message (it can echo SQL and values): only the section and the error code.
async function section<T>(name: string, failed: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    if (!failed.includes(name)) failed.push(name);
    logger.error({ section: name, code: code(err) }, "[he-drive-plan] section failed");
    return fallback;
  }
}
async function tolerant<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try { return await fn(); } catch (err) { if (noTable(err)) return empty; throw err; }
}

// ---- SQL ---------------------------------------------------------------------------------------------------------------------------------
const HEADER_SQL = "SELECT requisition_code, branch_name, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1";
const DRIVES_SQL = `SELECT id, drive_date, status, target_shows, slot_start, slot_end, slot_minutes, slot_capacity
  FROM he_drive WHERE requisition_id = ? AND drive_date BETWEEN ? AND ? ORDER BY drive_date, (status = 'closed'), id`;
// Credit goes through he_match.id: a credit row may carry a stale drive_id, so sm.drive_id is never read. An uncredited match has stream_id NULL.
const linedSql = (streams: boolean): string => `SELECT STRAIGHT_JOIN m.drive_id, ${streams ? "rs.id" : "NULL"} AS stream_id, COUNT(*) AS n
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id${streams ? `
  LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id` : ""}
 WHERE d.requisition_id = ? AND d.drive_date BETWEEN ? AND ? AND m.state NOT IN ('declined','no_show','slot_released')
 GROUP BY 1, 2`;
// Same state buckets as BUCKETS_SQL of he-drive-trend.service.ts.
const ratesSql = (streams: boolean): string => `SELECT STRAIGHT_JOIN ${streams ? "rs.id" : "NULL"} AS stream_id,
       SUM(m.state IN ('invited','confirmed','slot_released','arrived','no_show','selected')) AS invited, SUM(m.state IN ('arrived','selected')) AS arrived
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id${streams ? `
  LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id` : ""}
 WHERE d.requisition_id = ? AND d.drive_date BETWEEN ? AND ?
 GROUP BY 1`;
// From the requisition's streams (uq_rs_origin) to the plan row by its primary key (stream_id, drive_date).
const PLANNED_SQL = `SELECT p.stream_id, p.lined FROM requisition_stream s STRAIGHT_JOIN requisition_stream_plan p ON p.stream_id = s.id AND p.drive_date = ?
 WHERE s.requisition_id = ? ORDER BY p.stream_id`;
// Qualified form fills of the campaigns with no match for the requisition (the audience a stream can still line up from).
const campaignPoolSql = (n: number): string => `SELECT COUNT(DISTINCT lc.lead_id) AS n
  FROM he_lead_campaign lc
  JOIN meta_lead_raw q ON q.id = lc.meta_lead_id COLLATE utf8mb4_unicode_ci AND q.screening_result = 'qualified'
 WHERE lc.campaign_id IN (${ph(n)}) AND NOT EXISTS (SELECT 1 FROM he_match m WHERE m.lead_id = lc.lead_id AND m.requisition_id = ?)`;
const batchPoolSql = (n: number): string => `SELECT COUNT(DISTINCT lb.lead_id) AS n
  FROM he_lead_batch lb
 WHERE lb.batch_id IN (${ph(n)}) AND NOT EXISTS (SELECT 1 FROM he_match m WHERE m.lead_id = lb.lead_id AND m.requisition_id = ?)`;
const ORIGIN_SQL = "SELECT source_kind, source_ids FROM he_drive WHERE id = ? AND source_kind <> 'pool' LIMIT 1";

const idsOf = (raw: unknown): string[] => {
  try { const v = Array.isArray(raw) ? raw : raw ? JSON.parse(String(raw)) : []; return Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 100) : []; } catch { return []; }
};

/**
 * People a stream can still line up from. Measured only for campaign / batch audiences; null ("not measured", no cap) for the whole
 * Hiring Engine pool and all-Meta audiences, because counting those would scan he_lead.
 */
export async function poolRemaining(s: StreamRow): Promise<number | null> {
  if (s.sourceType === "meta_live") return countOf(campaignPoolSql(1), [s.originId, s.requisitionId]);
  if (s.sourceType !== "meta_old") return null;
  const [d] = await db.execute<RowDataPacket[]>(ORIGIN_SQL, [s.originId]);
  if (!d[0]) return null;
  const kind = String(d[0].source_kind), ids = idsOf(d[0].source_ids);
  if ((kind !== "campaign" && kind !== "batch") || !ids.length) return null;
  return countOf(kind === "campaign" ? campaignPoolSql(ids.length) : batchPoolSql(ids.length), [...ids, s.requisitionId]);
}
async function countOf(sql: string, params: unknown[]): Promise<number> {
  const [r] = await db.execute<RowDataPacket[]>(sql, params);
  return Math.max(0, Number(r[0]?.n ?? 0) || 0);
}

// ---- cache ------------------------------------------------------------------------------------------------------------------------------
const cache = new Map<string, { at: number; data: DrivePlan }>();
const scopeKey = (s: BranchScope): string => (s.all ? "all" : `b:${s.branchName ?? ""}`);
export function clearDrivePlanCache(): void { cache.clear(); }

interface DriveRow { id: string; date: string; target: number; cfg: { date: string; start: string; end: string; minutes: number; capacity: number } }

/**
 * Null when the requisition is unknown or outside the caller's scope (never says which). `days` is clamped to 1..14 (default 7); a
 * malformed `from` falls back to the next working day. The scope check runs before the cache is read.
 */
export async function getDrivePlan(q: { requisitionId: string; from?: string | null; days?: number | null }, scope: BranchScope, now: Date = new Date(), thresholds?: InsightThresholds): Promise<DrivePlan | null> {
  if (!scope.all && !scope.branchName) return null; // fail closed
  if (typeof q.requisitionId !== "string" || !q.requisitionId || q.requisitionId.length > 64) return null;
  const failed: string[] = [];
  const requisitionId = q.requisitionId;

  let head: RowDataPacket | null = null;
  try {
    const [h] = await db.execute<RowDataPacket[]>(HEADER_SQL, [requisitionId]);
    head = h[0] ?? null;
    if (!head) return null;
  } catch (err) {
    logger.error({ section: "header", code: code(err) }, "[he-drive-plan] section failed");
    if (!scope.all) return null; // cannot prove the requisition is in scope
    failed.push("header");
  }
  const branch = String(head?.branch_name ?? "");
  if (!scope.all && branch !== scope.branchName) return null;

  const from = isRealDay(q.from) ? q.from : nextWorkingDay(now);
  const n = Number(q.days);
  const days = Number.isFinite(n) && n >= 1 ? Math.min(MAX_DAYS, Math.floor(n)) : DEFAULT_DAYS;
  const key = `${requisitionId}|${from}|${days}|${scopeKey(scope)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return structuredClone(hit.data); // a copy: a caller may edit the result
  if (hit) cache.delete(key);

  const data = await build({ requisitionId, from, days, head, failed, thresholds }, now);
  if (!data.partial) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), data: structuredClone(data) });
  }
  return data;
}

/** The next `days` working days from `from` (Sundays skipped) united with the next `days` days of the open streams (their added Sundays). */
function planDates(from: string, days: number, open: StreamRow[]): string[] {
  const set = new Set<string>();
  for (let d = from, got = 0, scanned = 0; got < days && scanned < days * 3 + 7; d = addDays(d, 1), scanned++) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) { set.add(d); got++; }
  }
  for (const s of open) windowDays(toWindow(s)).filter((d) => d >= from).slice(0, days).forEach((d) => set.add(d));
  return [...set].sort().slice(0, MAX_DAYS);
}

async function build(
  o: { requisitionId: string; from: string; days: number; head: RowDataPacket | null; failed: string[]; thresholds?: InsightThresholds }, now: Date,
): Promise<DrivePlan> {
  const { requisitionId, from, failed } = o;
  const today = istToday(now);
  const streams = await section("streams", failed, () => tolerant(() => loadActiveStreams({ requisitionId }), [] as StreamRow[]), [] as StreamRow[]);
  const open = streams.filter((s) => s.status === "open");
  const dates = planDates(from, o.days, open);
  const last = dates[dates.length - 1] ?? from;
  const checkDate = nextWorkingDay(now);
  const thresholds: InsightThresholds = o.thresholds ?? await loadInsightThresholds().catch(() => ({ ...INSIGHT_DEFAULTS }));
  const trailFrom = addDays(today, -Math.max(1, Math.floor(thresholds["insight.plan_trailing_days"])));
  const trailTo = addDays(today, -1);

  const [plan, driveRows, linedRows, rateRows, pools] = await Promise.all([
    section("plan", o.failed, () => getDailyPlan(), DEFAULT_DAILY_PLAN as DailyPlan),
    section("drives", failed, async () => (await db.execute<RowDataPacket[]>(DRIVES_SQL, [requisitionId, from, last]))[0], [] as RowDataPacket[]),
    section("lined", failed, () => readAgg(linedSql, [requisitionId, from, last]), [] as RowDataPacket[]),
    section("rates", failed, () => readAgg(ratesSql, [requisitionId, trailFrom, trailTo]), null as RowDataPacket[] | null),
    (async () => { // one read per stream: a failing audience flags "pool" and leaves only that stream unmeasured
      const m = new Map<string, number | null>();
      for (const s of streams) m.set(s.id, await section("pool", failed, () => poolRemaining(s), null as number | null));
      return m;
    })(),
  ]);

  const driveBy = new Map<string, DriveRow>();
  for (const r of driveRows) { // ordered so a live drive wins over a closed one on the same date
    const date = day10(r.drive_date);
    if (!driveBy.has(date)) driveBy.set(date, { id: String(r.id), date, target: Number(r.target_shows ?? 0), cfg: { date, start: String(r.slot_start), end: String(r.slot_end), minutes: Number(r.slot_minutes), capacity: Number(r.slot_capacity) } });
  }
  const linedBy = new Map<string, number>(); // `${driveId}|${streamId or ""}`
  for (const r of linedRows) linedBy.set(`${r.drive_id}|${r.stream_id ?? ""}`, Number(r.n ?? 0));
  const heStream = streams.find((s) => s.sourceType === "he");

  // rates: failed read => every stream on the plan default
  const planRate = Math.max(0, Math.min(1, plan.showRatePct / 100));
  const sample = new Map<string, { invited: number; arrived: number }>();
  for (const r of rateRows ?? []) {
    const id = r.stream_id == null ? (heStream?.id ?? "") : String(r.stream_id);
    if (!id) continue;
    const c = sample.get(id) ?? { invited: 0, arrived: 0 };
    c.invited += Number(r.invited ?? 0); c.arrived += Number(r.arrived ?? 0);
    sample.set(id, c);
  }
  const rates = streams.map((s) => {
    const c = rateRows ? sample.get(s.id) : undefined;
    return streamRate({ streamId: s.id, sourceType: s.sourceType, invited: c?.invited ?? 0, arrived: c?.arrived ?? 0, planShowRate: planRate, minSample: thresholds["insight.plan_min_sample"] });
  });
  const rateOf = new Map(rates.map((r) => [r.streamId, r]));

  const nums = dailyPlanNumbers(plan);
  // HE_SHOWRATE_CALIBRATION: the same service the planner uses, so the grid, the caps and the preview line agree. A failed read keeps today's numbers.
  let book: RateBook | null = null;
  if (valueAddOn("showrate_calibration")) {
    const heStreamOf = new Map<string, string>();
    if (heStream) heStreamOf.set(requisitionId, heStream.id);
    book = await loadRateBook({ requisitionIds: [requisitionId], today, trailingDays: thresholds["insight.plan_trailing_days"], heStreamOf });
    if (!book && !failed.includes("calibration")) failed.push("calibration");
  }
  const calibrated = book;
  const minSample = thresholds["insight.plan_min_sample"];
  const lineRate = (s: StreamRow, date: string): StreamRate => {
    if (!calibrated) return rateOf.get(s.id) as StreamRate;
    const r = rateForStream(calibrated, s.id, date, planRate, minSample);
    return { streamId: s.id, sourceType: s.sourceType, invited: r.invited, arrived: r.arrived, rate: r.rate, basis: r.basis, ...(r.weekday != null ? { weekday: r.weekday } : {}) };
  };
  const capsFor = (covering: StreamRow[], date: string): Map<string, number> => calibrated
    ? calibratedCaps(covering, plan, (id) => rateForStream(calibrated, id, date, planRate, minSample).rate)
    : streamCaps(covering, nums.invites);
  const poolLeft = new Map(pools); // successive days draw on the same audience
  const planDays: PlanDay[] = dates.map((date) => {
    const drive = driveBy.get(date) ?? null;
    const covering = open.filter((s) => coversDay(toWindow(s), date));
    const caps = capsFor(covering, date);
    // people lined up without a stream while the requisition has no Hiring Engine stream still hold seats
    const orphanSeats = drive && !heStream ? (linedBy.get(`${drive.id}|`) ?? 0) : 0;
    const inputs: PlanStreamInput[] = streams.map((s) => {
      const covers = covering.some((c) => c.id === s.id);
      const credited = drive ? (linedBy.get(`${drive.id}|${s.id}`) ?? 0) : 0;
      const uncredited = drive && s === heStream ? (linedBy.get(`${drive.id}|`) ?? 0) : 0; // people no stream touched count for the Hiring Engine stream
      return { streamId: s.id, sourceType: s.sourceType, label: labelOf(s), cap: covers ? (caps.get(s.id) ?? 0) : 0, lined: credited + uncredited,
        rate: lineRate(s, date), poolRemaining: poolLeft.get(s.id) ?? null, covers };
    });
    const day = planDay({
      date, driveId: drive?.id ?? null, target: drive && drive.target > 0 ? drive.target : nums.targetShows,
      capacity: drive ? driveCapacity(drive.cfg) : calibrated ? nums.slots * calibratedPerSlot(plan, [...caps.values()].reduce((a, b) => a + b, 0)) : nums.capacity, streams: inputs, extraSeatsUsed: orphanSeats,
      extraExpected: orphanSeats * planRate, // they come at the plan default rate whether or not a stream covers the day
    });
    for (const l of day.streams) { const p = poolLeft.get(l.streamId); if (p != null) poolLeft.set(l.streamId, Math.max(0, p - l.recommended)); }
    return day;
  });

  const checklist = await buildChecklist({ requisitionId, head: o.head, streams, open, pools, nums, checkDate, thresholds, failed, capsFor });
  const failedSections = [...new Set(failed)];
  return {
    requisitionId, code: String(o.head?.requisition_code ?? requisitionId), branch: String(o.head?.branch_name ?? ""), generatedAt: now.toISOString(), from,
    days: planDays, calendar: calendarCells(planDays), rates, ...(calibrated ? { showRateMode: "calibrated" as const, showRateWindowDays: Math.max(1, Math.floor(thresholds["insight.plan_trailing_days"])) } : {}), checklist, partial: failedSections.length > 0, failedSections,
  };
}

async function buildChecklist(o: {
  requisitionId: string; head: RowDataPacket | null; streams: StreamRow[]; open: StreamRow[]; pools: Map<string, number | null>;
  nums: ReturnType<typeof dailyPlanNumbers>; checkDate: string; thresholds: InsightThresholds; failed: string[]; capsFor: (covering: StreamRow[], date: string) => Map<string, number>;
}): Promise<DrivePlan["checklist"]> {
  const { requisitionId, checkDate, failed } = o;
  const items: ChecklistItem[] = [];
  const covering = o.open.filter((s) => coversDay(toWindow(s), checkDate));
  const labels = new Map(o.streams.map((s) => [s.id, labelOf(s)]));

  // the Plan 3 stream pass as a DRY RUN: nothing is created, locked or lined up
  const preview = covering.length ? await section("preview", failed, async () => {
    const r = await planStreamsForDay({ date: checkDate, dryRun: true, requisitionId });
    if (r.failed) throw Object.assign(new Error("preview failed"), { code: "PREVIEW_FAILED" });
    return r.plans.find((p) => p.requisitionId === requisitionId) ?? null;
  }, null as StreamDayPlan | null) : null;
  if (preview) {
    if (preview.drive === "skipped") items.push({ kind: "will_plan", text: `Tonight the evening pass will skip this requisition: ${preview.reason ?? "no reason given"}` });
    else {
      const total = preview.streams.reduce((a, l) => a + (l.wouldLine ?? 0), 0);
      const per = preview.streams.map((l) => `${l.originLabel || TYPE_NAME[l.sourceType]} ${l.wouldLine ?? 0}`).join(", ");
      items.push({ kind: "will_plan", text: `Tonight the evening pass will ${preview.drive === "would_create" ? "create the drive" : "reuse the drive"} and line up ${total} people (${per})` });
    }
  }

  const planned = await section("planned", failed, () => tolerant(async () => (await db.execute<RowDataPacket[]>(PLANNED_SQL, [checkDate, requisitionId]))[0], [] as RowDataPacket[]), [] as RowDataPacket[]);
  for (const r of planned) {
    const id = String(r.stream_id);
    items.push({ kind: "already_planned", text: `${labels.get(id) ?? "Stream"}: ${Math.max(0, Number(r.lined ?? 0) || 0)} already lined up`, streamId: id });
  }

  const left = Number(o.head?.requested_headcount ?? 0) - Number(o.head?.fulfilled_headcount ?? 0);
  if (Number.isFinite(left) && left > 0 && left <= o.thresholds["insight.fill_soon_positions"]) items.push({ kind: "fill_soon", text: `Only ${left} positions left: the requisition is about to be filled` });

  for (const s of o.open) if (windowEnd(toWindow(s)) === checkDate) items.push({ kind: "stream_ends_tomorrow", text: `${labelOf(s)}: this stream's last planned day is ${checkDate}`, streamId: s.id });

  const caps = o.capsFor(covering, checkDate);
  for (const s of covering) {
    const pool = o.pools.get(s.id), cap = caps.get(s.id) ?? 0;
    if (pool != null && pool < cap) items.push({ kind: "pool_below_quota", text: `${labelOf(s)}: ${pool} people left in the pool for a daily quota of ${cap}`, streamId: s.id });
  }

  const ready = await section("readiness", failed, () => getRequisitionReadiness(requisitionId), null);
  for (const p of ready?.problems ?? []) items.push({ kind: "readiness", text: `${p.severity === "blocking" ? "Blocking: " : ""}${p.message}` });

  return { date: checkDate, preview, items };
}
