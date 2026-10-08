/**
 * Drive analytics for the Command Center (GET /drive-analytics). Read-only, branch-scoped, cached 60 s per scope + filters.
 *
 * Reuses the read models: leads / qualified / selected / joined from getSourcesForRequisitions (he-sources-window.service.ts),
 * (selected / joined there and in the outcomes read follow the drive credit rule of he-drive-credit.ts: arrived at the drive, and
 * selected / joined on or after its drive date),
 * invited / confirmed / arrived from the drive state buckets (readDriveAggRows), so nothing the sources model already provides is re-queried.
 * New reads (each its own section, never one per requisition): requisitions, streams, outcomes, stops, replies, arrivals, previous.
 * Every statement starts from he_drive / qualified_followup / requisition_stream / meta_campaign; he_lead, he_message, he_lead_event and
 * ats_candidate are reached by key through JOINs only. Window bounds are IST wall clock: >= '<from> 00:00:00' AND < '<to+1> 00:00:00'.
 * A failing section flags itself (logged as section + code only), the rest stays, and a partial result is never cached.
 * No candidate data in the result: counts, dates, ids and labels only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import {
  SOURCE_TYPES, conversions, dailySeries, scatterPoints, stageCountsByType, timingGrids, waterfall,
  type Conversion, type DailyPoint, type Grid, type MatchOutcome, type ScatterPoint, type StageCounts, type TaggedAggRow, type TimingCell, type TypedStageCounts, type WaterfallStep,
} from "./he-drive-analytics.js";
import { costBlock, type CostBlock } from "./he-cost.js";
import { driveCreditSql } from "./he-drive-credit.js";
import { LIVE_FROM_DEFAULT, attributionJoinsSql, sourceTypeSql } from "./he-source-attribution.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import { readCostUsage } from "./he-cost.service.js";
import { evaluateInsights, type DriveInsight } from "./he-drive-insights.js";
import { collectInsightFacts } from "./he-drive-insight-facts.service.js";
import { loadInsightThresholds } from "./he-insight-params.service.js";
import { buildDriveGroups, readAgg, readDriveAggRows, type DriveGroup, type DriveGroupInput } from "./he-drive-trend.service.js";
import { getSourcesForRequisitions, type RequisitionSourceRows } from "./he-sources-window.service.js";
import { outcomeReasonCounts } from "./he-outcome-reason.service.js";
import { valueAddOn } from "./he-valueadd-switches.js";
import { followupMode } from "./qualified-followup.schedule.js";
import type { FollowupMode, SourceType } from "./qualified-followup.types.js";
import { loadActiveStreams, type StreamRow } from "./requisition-stream.service.js";
import { addDays, istToday, windowDays } from "./requisition-stream.window.js";

export interface AnalyticsQuery { from?: string | null; to?: string | null; requisitionId?: string | null; branch?: string | null }
export interface AnalyticsValidationError { error: string }
export interface TypeAnalytics { stages: StageCounts; previous: StageCounts; noShow: number; declined: number; conversions: Conversion[]; sparkline: number[] }
export interface DriveAnalytics {
  generatedAt: string;
  window: { from: string; to: string; days: number };
  previousWindow: { from: string; to: string };
  filter: { requisitionId: string | null; branch: string | null };
  followupMode: FollowupMode;
  qualifiedTracked: boolean;
  /** Live Meta cutoff day (IST): Meta-origin people with a form fill on or after it are meta_live, earlier ones meta_old. */
  liveFrom: string;
  types: Record<SourceType, TypeAnalytics>;
  typesPresent: SourceType[];
  daily: DailyPoint[];
  timing: { replies: Record<SourceType, Grid>; arrivals: Record<SourceType, Grid>; arrivalsWithoutTime: number };
  scatter: ScatterPoint[];
  waterfall: Record<SourceType, WaterfallStep[]>;
  groups: DriveGroup[];
  cost: CostBlock | { available: false; note: string };
  insights: DriveInsight[];
  requisitionCount: number;
  truncated: boolean;
  partial: boolean;
  failedSections: string[];
}

export const MAX_REQUISITIONS = 200;
export const MAX_SPAN_DAYS = 92;
export const MAX_AHEAD_DAYS = 14;
const DEFAULT_BACK = 13;
const CACHE_MS = 60_000;
const CACHE_MAX = 100;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const hasReasons = (r: { no_show: object; declined: object }): boolean => Object.keys(r.no_show).length + Object.keys(r.declined).length > 0;
const ph = (n: number): string => Array(n).fill("?").join(",");
const noTable = (err: unknown): boolean => (err as { code?: unknown })?.code === "ER_NO_SUCH_TABLE";
const perType = <T>(make: (t: SourceType) => T): Record<SourceType, T> => ({ meta_live: make("meta_live"), meta_old: make("meta_old"), he: make("he") });
const isRealDay = (x: unknown): x is string => {
  if (typeof x !== "string" || !ISO_RE.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x; // the round trip rejects 2026-02-30
};
/** Fractions to 4 decimals: the response carries rates for display, and a raw float would put long digit runs in the JSON. */
export const tidy = <T>(v: T): T => {
  if (typeof v === "number") return (Number.isInteger(v) ? v : Math.round(v * 10_000) / 10_000) as T;
  if (Array.isArray(v)) return v.map(tidy) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)])) as T;
  return v;
};
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const bounds = (from: string, to: string): [string, string] => [`${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`];

/** Window rules (before any read): real ISO dates, from <= to, at most 92 days, to at most today + 14; default today-13..today IST. */
export function resolveWindow(q: Pick<AnalyticsQuery, "from" | "to">, now: Date): { from: string; to: string; days: number } | AnalyticsValidationError {
  const today = istToday(now);
  const given = (v: unknown): boolean => v !== undefined && v !== null;
  if ((given(q.from) && !isRealDay(q.from)) || (given(q.to) && !isRealDay(q.to))) return { error: "Pick valid dates" };
  const to = given(q.to) ? (q.to as string) : today;
  const from = given(q.from) ? (q.from as string) : addDays(to, -DEFAULT_BACK);
  if (from > to) return { error: "The start date must not be after the end date" };
  const days = dayDiff(from, to) + 1;
  if (days > MAX_SPAN_DAYS) return { error: `Pick at most ${MAX_SPAN_DAYS} days` };
  if (to > addDays(today, MAX_AHEAD_DAYS)) return { error: `The end date can be at most ${MAX_AHEAD_DAYS} days ahead` };
  return { from, to, days };
}

// Never the driver message (it can echo SQL and values): only the section and the error code.
async function section<T>(name: string, failed: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    if (!failed.includes(name)) failed.push(name);
    logger.error({ section: name, code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-drive-analytics] section failed");
    return fallback;
  }
}
/** A table that is not deployed yet reads as no rows (not a failed section). */
async function tolerant<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try { return await fn(); } catch (err) { if (noTable(err)) return empty; throw err; }
}

// ---- SQL ---------------------------------------------------------------------------------------------------------------------------------
// Selected / joined only for people who arrived at the drive and were selected / joined on or after its drive date (he-drive-credit.ts).
const { joined: FLAG_JOINED, selected: FLAG_SELECTED } = driveCreditSql({ m: "m", d: "d", hl: "hl", ac: "ac" });
// The shared source rule (he-source-attribution.ts): credit through he_match.id (the credit's own drive_id is ignored), else a Meta drive or a
// Meta-origin person (Live / Old by form fill time), else `he`. he_lead is joined by primary key as `al`.
const creditJoin = (streams: boolean): string => attributionJoinsSql({ streams, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id" });
const typeCol = (streams: boolean, liveFrom: string): string => sourceTypeSql({ streams, d: "d", lead: "al", liveFrom });
const DRIVE_MATCH = `FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id`;

// STRAIGHT_JOIN on the three he_match readers: always drive from he_drive (window + requisition) and reach he_message / he_lead_event / he_lead by key,
// whatever the table statistics say. Same predicates as the header of he-requisition-sources.service.ts; he_lead and ats_candidate by primary key only,
// the ATS stage log and onboarding bridge by candidate id inside the credit rule.
const outcomesSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeCol(streams, liveFrom)} AS source_type,
       COUNT(DISTINCT CASE WHEN ${FLAG_SELECTED} THEN m.id END) AS selected, COUNT(DISTINCT CASE WHEN ${FLAG_JOINED} THEN m.id END) AS joined,
       COUNT(DISTINCT CASE WHEN m.state = 'slot_released' THEN m.id END) AS slot_released
  ${DRIVE_MATCH}
  ${creditJoin(streams)}
  LEFT JOIN he_lead hl ON hl.id = m.lead_id
  LEFT JOIN ats_candidate ac ON ac.id = hl.ats_candidate_id COLLATE utf8mb4_unicode_ci
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY 1`;

const stopsSql = (n: number): string => `SELECT qf.source_type, qf.stopped_reason, COUNT(*) AS n
  FROM qualified_followup qf
 WHERE qf.requisition_id IN (${ph(n)}) AND qf.qualified_at >= ? AND qf.qualified_at < ? AND qf.stopped_reason IN ('opted_out','requisition_closed','no_contact_details')
 GROUP BY qf.source_type, qf.stopped_reason`;

// Inbound messages of leads matched on window drives (idx_he_msg_lead); IST wall clock, so WEEKDAY() 0 = Monday and HOUR() 0-23 are IST.
const repliesSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeCol(streams, liveFrom)} AS source_type, WEEKDAY(hm.created_at) AS wd, HOUR(hm.created_at) AS hr, COUNT(DISTINCT hm.id) AS n
  ${DRIVE_MATCH}
  ${creditJoin(streams)}
  JOIN he_message hm ON hm.lead_id = m.lead_id AND hm.direction = 'in' AND hm.created_at >= ? AND hm.created_at < ?
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY 1, 2, 3`;

// idx_he_event_drive (drive_id, event_type).
const arrivalsSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeCol(streams, liveFrom)} AS source_type, WEEKDAY(ev.created_at) AS wd, HOUR(ev.created_at) AS hr, COUNT(DISTINCT m.id) AS n
  ${DRIVE_MATCH}
  ${creditJoin(streams)}
  JOIN he_lead_event ev ON ev.drive_id = d.id AND ev.lead_id = m.lead_id AND ev.event_type = 'arrived'
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY 1, 2, 3`;

// One statement: drives in the window, plus requisitions of overlapping open / paused streams, active campaigns and the requested requisition.
// Every id is cast to one collation so the UNION cannot mix collations; the branch filter compares under utf8mb4_unicode_ci.
const discoverSql = (o: { streamIds: number; branch: boolean; requisition: boolean }): string => `SELECT jr.id, jr.requisition_code, jr.designation_name, jr.branch_name, MAX(x.last_drive) AS last_drive
  FROM (
    SELECT d.requisition_id COLLATE utf8mb4_unicode_ci AS rid, MAX(d.drive_date) AS last_drive FROM he_drive d WHERE d.drive_date BETWEEN ? AND ? GROUP BY d.requisition_id
    UNION ALL
    SELECT mc.requisition_id COLLATE utf8mb4_unicode_ci, NULL FROM meta_campaign mc WHERE mc.campaign_status = 'active' AND mc.requisition_id IS NOT NULL${o.streamIds ? `
    UNION ALL
    SELECT s.requisition_id COLLATE utf8mb4_unicode_ci, NULL FROM requisition_stream s WHERE s.id IN (${ph(o.streamIds)})` : ""}${o.requisition ? `
    UNION ALL
    SELECT ? COLLATE utf8mb4_unicode_ci, NULL` : ""}
  ) x
  JOIN job_requisition jr ON jr.id = x.rid COLLATE utf8mb4_unicode_ci
 WHERE 1 = 1${o.branch ? " AND jr.branch_name COLLATE utf8mb4_unicode_ci = ?" : ""}${o.requisition ? " AND jr.id = ? COLLATE utf8mb4_unicode_ci" : ""}
 GROUP BY jr.id, jr.requisition_code, jr.designation_name, jr.branch_name
 ORDER BY MAX(x.last_drive) IS NULL, MAX(x.last_drive) DESC, jr.id
 LIMIT ${MAX_REQUISITIONS + 1}`;
const BRANCH_SQL = "SELECT 1 FROM job_requisition WHERE branch_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1";
const HEADER_SQL = "SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1";

// ---- reads ------------------------------------------------------------------------------------------------------------------------------
interface Head { id: string; code: string; role: string; branch: string }
const batchesOf = (ids: string[]): string[][] => { const out: string[][] = []; for (let i = 0; i < ids.length; i += 200) out.push(ids.slice(i, i + 200)); return out; };
/** One statement per 200 ids; `streams` false is the same read before the stream tables exist. */
const runBatched = async (ids: string[], sqlOf: (n: number, streams: boolean) => string, params: (b: string[]) => unknown[]): Promise<RowDataPacket[]> =>
  (await Promise.all(batchesOf(ids).map((b) => readAgg((st) => sqlOf(b.length, st), params(b))))).flat();

const readOutcomes = async (ids: string[], from: string, to: string, liveFrom: string): Promise<{ outcomes: MatchOutcome[]; slotReleased: Record<SourceType, number> }> => {
  const rows = await runBatched(ids, outcomesSql(liveFrom), (b) => [...b, from, to]);
  const slotReleased = perType(() => 0);
  const outcomes: MatchOutcome[] = [];
  for (const r of rows) {
    const t = String(r.source_type) as SourceType;
    if (!SOURCE_TYPES.includes(t)) continue;
    outcomes.push({ sourceType: t, selected: Number(r.selected ?? 0), joined: Number(r.joined ?? 0) });
    slotReleased[t] += Number(r.slot_released ?? 0);
  }
  return { outcomes, slotReleased };
};

const readStops = async (ids: string[], dt: string[]): Promise<Record<SourceType, Partial<Record<"opted_out" | "requisition_closed" | "no_contact_details", number>>>> => {
  const out = perType(() => ({}) as Partial<Record<"opted_out" | "requisition_closed" | "no_contact_details", number>>);
  const parts = await Promise.all(batchesOf(ids).map((b) => tolerant(async () => (await db.execute<RowDataPacket[]>(stopsSql(b.length), [...b, ...dt]))[0], [] as RowDataPacket[])));
  for (const r of parts.flat()) {
    const t = String(r.source_type) as SourceType;
    const k = String(r.stopped_reason) as "opted_out" | "requisition_closed" | "no_contact_details";
    if (out[t]) out[t][k] = (out[t][k] ?? 0) + Number(r.n ?? 0);
  }
  return out;
};

const toCells = (rows: RowDataPacket[]): TimingCell[] =>
  rows.map((r) => ({ sourceType: String(r.source_type) as SourceType, weekday: Number(r.wd), hour: Number(r.hr), n: Number(r.n ?? 0) }));

const stageOnly = (t: TypedStageCounts): StageCounts => ({ leads: t.leads, qualified: t.qualified, invited: t.invited, confirmed: t.confirmed, arrived: t.arrived, selected: t.selected, joined: t.joined });
const anyStage = (s: StageCounts): boolean => Object.values(s).some((v) => v > 0);
const inRange = (d: string, from: string, to: string): boolean => d >= from && d <= to;

// ---- cache ------------------------------------------------------------------------------------------------------------------------------
const cache = new Map<string, { at: number; data: DriveAnalytics }>();
const scopeKey = (s: BranchScope): string => (s.all ? "all" : `b:${s.branchName ?? ""}`);
/** Single flight: concurrent calls with the same key (scope included) share one build; removed when it settles. */
const inflight = new Map<string, Promise<DriveAnalytics>>();
export function clearDriveAnalyticsCache(): void { cache.clear(); inflight.clear(); }
export function driveAnalyticsCacheSize(): number { return cache.size; }

const text = (v: unknown, max: number): string | null | false => (v === undefined || v === null || v === "" ? null : typeof v === "string" && v.length <= max ? v : false);

/**
 * Null when the requisition or branch is outside the caller's scope or unknown (never says which). A validation error object for a bad
 * window or filter value (checked before any read). The scope and window checks run before the cache is read.
 */
export async function getDriveAnalytics(q: AnalyticsQuery, scope: BranchScope, now: Date = new Date()): Promise<DriveAnalytics | AnalyticsValidationError | null> {
  const w = resolveWindow(q, now);
  if ("error" in w) return w;
  const requisitionId = text(q.requisitionId, 64), branchIn = text(q.branch, 150);
  if (requisitionId === false || branchIn === false) return { error: "Invalid filter" };
  if (!scope.all && !scope.branchName) return null; // fail closed: a branch user without a resolved branch sees nothing
  if (!scope.all && branchIn && branchIn !== scope.branchName) return null;
  const branch = scope.all ? branchIn : scope.branchName;
  if (requisitionId) {
    const [h] = await db.execute<RowDataPacket[]>(HEADER_SQL, [requisitionId]);
    if (!h[0]) return null;
    const reqBranch = String(h[0].branch_name ?? "");
    if (!scope.all && reqBranch !== scope.branchName) return null;
    if (branchIn && branchIn !== reqBranch) return null;
  }
  if (scope.all && branchIn && !requisitionId) { // an org-wide caller naming a branch that does not exist: not found, never zeros
    let exists = true; // a failing probe must not turn into a 404
    try { exists = ((await db.execute<RowDataPacket[]>(BRANCH_SQL, [branchIn]))[0] ?? []).length > 0; } catch (err) {
      logger.error({ section: "branch", code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-drive-analytics] section failed");
    }
    if (!exists) return null;
  }
  const key = `${scopeKey(scope)}|${w.from}|${w.to}|${requisitionId ?? "*"}|${branchIn ?? "*"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return structuredClone(hit.data); // a copy: a caller may extend or edit the result
  if (hit) cache.delete(key);

  let run = inflight.get(key);
  if (!run) {
    const p = (async () => {
      const data = tidy(await build(w, requisitionId, branch, scope, now));
      if (!data.partial) { // a partial result is shared with the callers already waiting, never cached
        const t = Date.now();
        for (const [k, v] of cache) if (t - v.at >= CACHE_MS) cache.delete(k); // expired entries go on every write, not only on overflow
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: t, data: structuredClone(data) });
      }
      return data;
    })();
    run = p;
    inflight.set(key, p);
    p.then(() => undefined, () => undefined).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  }
  return structuredClone(await run); // every caller gets its own copy
}

async function build(
  w: { from: string; to: string; days: number }, requisitionId: string | null, branch: string | null, scope: BranchScope, now: Date,
): Promise<DriveAnalytics> {
  const failed: string[] = [];
  const today = istToday(now);
  const prev = { from: addDays(w.from, -w.days), to: addDays(w.from, -1) };
  const dt = bounds(w.from, w.to);
  const mode = followupMode();

  // requisitions (+ the streams that decide which ones qualify and which windows the drive read must cover)
  const active = await section("streams", failed, () => tolerant(() => loadActiveStreams(), [] as StreamRow[]), [] as StreamRow[]);
  const overlapping = active.filter((s) => windowDays({ openFrom: s.openFrom, openDays: s.openDays, add: s.add, skip: s.skip }).some((d) => inRange(d, w.from, w.to)));
  const heads: Head[] = [];
  let truncated = false;
  await section("requisitions", failed, async () => {
    const streamIds = overlapping.map((s) => s.id);
    const params: unknown[] = [w.from, w.to, ...streamIds, ...(requisitionId ? [requisitionId] : []), ...(branch ? [branch] : []), ...(requisitionId ? [requisitionId] : [])];
    const [rows] = await db.execute<RowDataPacket[]>(discoverSql({ streamIds: streamIds.length, branch: !!branch, requisition: !!requisitionId }), params);
    truncated = rows.length > MAX_REQUISITIONS;
    for (const r of rows.slice(0, MAX_REQUISITIONS)) heads.push({ id: String(r.id), code: String(r.requisition_code ?? ""), role: String(r.designation_name ?? ""), branch: String(r.branch_name ?? "") });
    return null;
  }, null);
  const ids = heads.map((h) => h.id);
  const headOf = new Map(heads.map((h) => [h.id, h]));
  const mine = (s: StreamRow): boolean => headOf.has(s.requisitionId);

  // window of the drive read: the analytics window united with the open streams' days, so `groups` match the Plan 3 shapes
  let dFrom = w.from, dTo = w.to;
  for (const s of active.filter((x) => x.status === "open" && mine(x))) {
    const d = windowDays({ openFrom: s.openFrom, openDays: s.openDays, add: s.add, skip: s.skip });
    if (d.length) { if (d[0] < dFrom) dFrom = d[0]; if (d[d.length - 1] > dTo) dTo = d[d.length - 1]; }
  }

  const none = ids.length === 0;
  const liveFrom = none ? LIVE_FROM_DEFAULT : await loadLiveFrom(); // one cutoff for every read of this build
  const empty = { outcomes: [] as MatchOutcome[], slotReleased: perType(() => 0) };
  const [sources, driveRows, outcomeRead, stops, repliesRows, arrivalsRows, previous] = await Promise.all([
    none ? null : section("sources", failed, async () => {
      const s = await getSourcesForRequisitions(ids, w, liveFrom);
      if (s.partial) failed.push("sources");
      return s;
    }, null as Awaited<ReturnType<typeof getSourcesForRequisitions>> | null),
    none ? ([] as TaggedAggRow[]) : section("drives", failed, () => readDriveAggRows(ids, dFrom, dTo, liveFrom), [] as TaggedAggRow[]),
    none ? empty : section("outcomes", failed, () => readOutcomes(ids, w.from, w.to, liveFrom), empty),
    none ? perType(() => ({})) : section("stops", failed, () => readStops(ids, dt), perType(() => ({}))),
    none ? ([] as RowDataPacket[]) : section("replies", failed, async () => (await runBatched(ids, repliesSql(liveFrom), (b) => [...dt, ...b, w.from, w.to])), [] as RowDataPacket[]),
    none ? ([] as RowDataPacket[]) : section("arrivals", failed, async () => (await runBatched(ids, arrivalsSql(liveFrom), (b) => [...b, w.from, w.to])), [] as RowDataPacket[]),
    none ? null : section("previous", failed, async () => {
      const [s, rows, o] = await Promise.all([getSourcesForRequisitions(ids, prev, liveFrom), readDriveAggRows(ids, prev.from, prev.to, liveFrom), readOutcomes(ids, prev.from, prev.to, liveFrom)]);
      if (s.partial) failed.push("previous");
      return { sources: s, rows, outcomes: o.outcomes };
    }, null as { sources: Awaited<ReturnType<typeof getSourcesForRequisitions>>; rows: TaggedAggRow[]; outcomes: MatchOutcome[] } | null),
  ]);

  const flat = (list: RequisitionSourceRows[] | undefined) => (list ?? []).flatMap((r) => r.rows);
  const inWindow = driveRows.filter((r) => inRange(r.date, w.from, w.to));
  const cur = stageCountsByType(flat(sources?.byRequisition), inWindow, outcomeRead.outcomes);
  const before = previous
    ? stageCountsByType(flat(previous.sources.byRequisition), previous.rows.filter((r) => inRange(r.date, prev.from, prev.to)), previous.outcomes)
    : stageCountsByType([], [], []);
  const daily = dailySeries(inWindow, w.from, w.to);
  const replies = timingGrids(toCells(repliesRows));
  const arrivals = timingGrids(toCells(arrivalsRows));
  const timed = SOURCE_TYPES.reduce((a, t) => a + arrivals[t].reduce((x, row) => x + row.reduce((y, c) => y + c, 0), 0), 0);
  const arrivedTotal = SOURCE_TYPES.reduce((a, t) => a + cur[t].arrived, 0);

  const types = perType((t): TypeAnalytics => {
    const stages = stageOnly(cur[t]);
    return { stages, previous: stageOnly(before[t]), noShow: cur[t].noShow, declined: cur[t].declined, conversions: conversions(stages), sparkline: daily.map((p) => p.byType[t].arrived) };
  });

  // groups: Plan 3 shapes per requisition and branch, with that requisition's streams
  const rowsBy = new Map<string, TaggedAggRow[]>();
  const keyOf = (r: string, b: string): string => `${r}|${b}`;
  for (const r of driveRows) { const k = keyOf(r.requisitionId, r.branch); const l = rowsBy.get(k); if (l) l.push(r); else rowsBy.set(k, [r]); }
  const keys = new Map<string, { requisitionId: string; branch: string }>();
  for (const r of driveRows) keys.set(keyOf(r.requisitionId, r.branch), { requisitionId: r.requisitionId, branch: r.branch });
  for (const s of active) if (s.status === "open" && mine(s)) keys.set(keyOf(s.requisitionId, s.branchName), { requisitionId: s.requisitionId, branch: s.branchName });
  const input: DriveGroupInput[] = [];
  for (const k of keys.values()) {
    const h = headOf.get(k.requisitionId);
    if (!h) continue;
    input.push({ requisitionId: k.requisitionId, branch: k.branch, requisition: h.code, role: h.role, today, rows: rowsBy.get(keyOf(k.requisitionId, k.branch)) ?? [], streams: active.filter((s) => s.requisitionId === k.requisitionId && s.branchName === k.branch) });
  }
  input.sort((a, b) => a.requisition.localeCompare(b.requisition) || a.branch.localeCompare(b.branch) || a.requisitionId.localeCompare(b.requisitionId));
  const groups = buildDriveGroups(input);

  // scatter: the window's own show rate per requisition and type (not the stream window of a group)
  const sums = new Map<string, { requisitionId: string; code: string; branch: string; sourceType: SourceType; confirmed: number; arrived: number }>();
  for (const r of inWindow) {
    const t = r.streamType ?? "he";
    if (!SOURCE_TYPES.includes(t)) continue;
    const k = `${r.requisitionId}|${r.branch}|${t}`;
    const g = sums.get(k) ?? { requisitionId: r.requisitionId, code: headOf.get(r.requisitionId)?.code ?? "", branch: r.branch, sourceType: t, confirmed: 0, arrived: 0 };
    g.confirmed += r.confirmed; g.arrived += r.arrived;
    sums.set(k, g);
  }

  // reasons: recorded no-show and decline reasons per type; its own statement only while HE_OUTCOME_REASONS is on (a missing table counts zero)
  let reasons: Awaited<ReturnType<typeof outcomeReasonCounts>> | null = null;
  if (!none && valueAddOn("outcome_reasons")) reasons = await section("reasons", failed, () => outcomeReasonCounts(ids, w.from, w.to, liveFrom), null);

  // insights: thresholds once per call, facts (own sections), then the pure rules; any throw leaves the response without insights
  let insights: DriveInsight[] = [];
  if (!none) {
    insights = await section("insights", failed, async () => {
      const t = await loadInsightThresholds();
      const { facts, failedSections: factFailed } = await collectInsightFacts({
        requisitionIds: ids, from: w.from, to: w.to, today, windowDays: w.days, liveFrom,
        types: perType((k) => ({ current: types[k].stages, previous: types[k].previous, noShow: types[k].noShow, declined: types[k].declined })),
        ...(reasons ? { reasons } : {}),
        agg: inWindow, sources: sources?.byRequisition ?? [], codes: new Map(heads.map((h) => [h.id, h.code])), t, arrivals, streams: active, now,
      }, scope);
      for (const f of factFailed) if (!failed.includes(f)) failed.push(f);
      return evaluateInsights(facts, t);
    }, [] as DriveInsight[]);
  }
  // cost per source: its own statements only while HE_COST_PER_SOURCE is on; a failed section counts 0 and flags the result as partial
  let cost: DriveAnalytics["cost"] = { available: false, note: "Cost per source arrives with Plan 5" };
  if (!none && valueAddOn("cost_per_source")) {
    cost = await section<DriveAnalytics["cost"]>("cost", failed, async () => {
      const c = await readCostUsage(ids, w, liveFrom);
      for (const f of c.failedSections) if (!failed.includes(f)) failed.push(f);
      return costBlock(c.usage, c.rates, perType((t) => stageOnly(cur[t])));
    }, cost);
  }
  const failedSections = [...new Set(failed)];

  return {
    generatedAt: now.toISOString(),
    window: w,
    previousWindow: prev,
    filter: { requisitionId, branch },
    followupMode: mode,
    qualifiedTracked: mode !== "off",
    liveFrom,
    types,
    typesPresent: SOURCE_TYPES.filter((t) => anyStage(types[t].stages) || anyStage(types[t].previous)),
    daily,
    timing: { replies, arrivals, arrivalsWithoutTime: Math.max(0, arrivedTotal - timed) },
    scatter: scatterPoints([...sums.values()], sources?.byRequisition ?? []),
    waterfall: perType((t) => waterfall(cur[t], stops[t], outcomeRead.slotReleased[t], reasons && hasReasons(reasons[t]) ? reasons[t] : undefined)),
    groups,
    cost,
    insights,
    requisitionCount: ids.length,
    truncated,
    partial: failedSections.length > 0,
    failedSections,
  };
}
