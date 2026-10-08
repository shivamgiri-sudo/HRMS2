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
import { limitedDb } from "./he-read-limit.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import {
  SOURCE_TYPES, conversions, type PersonStageCounts, dailySeries, scatterPoints, stageCountsByType, timingGrids, waterfall,
  type Conversion, type DailyPoint, type Grid, type MatchOutcome, type ScatterPoint, type StageCounts, type TaggedAggRow, type TimingCell, type TypedStageCounts, type WaterfallStep,
} from "./he-drive-analytics.js";
import { costBlock, type CostBlock } from "./he-cost.js";
import { driveCreditSql } from "./he-drive-credit.js";
import { LIVE_FROM_DEFAULT, creditJoinsSql } from "./he-source-attribution.js";
import { PersonFacts, TYPE_KEY_GROUP, typeKeyColsSql } from "./he-person-facts.service.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import { readCostUsage } from "./he-cost.service.js";
import { evaluateInsights, type DriveInsight } from "./he-drive-insights.js";
import { collectInsightFacts } from "./he-drive-insight-facts.service.js";
import { loadInsightThresholds } from "./he-insight-params.service.js";
import { buildDriveGroups, readAgg, readDriveAggRows, type DriveGroup, type DriveGroupInput } from "./he-drive-trend.service.js";
import { getSourcesForRequisitions, type RequisitionSourceRows } from "./he-sources-window.service.js";
import { campaignProgress, readPersonStages, type CampaignProgress, type CampaignProgressRow, type PersonStages } from "./he-drive-persons.service.js";
import { requisitionClosedReason } from "../meta-campaign/lead-screener.service.js";
import { outcomeReasonCounts } from "./he-outcome-reason.service.js";
import { QF_TYPE_FROM_SQL, qfTypeKeysSql } from "./he-requisition-sources.service.js";
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
  /** Per Meta campaign and requisition: people at each stage in the window (events-based, same rules as `types`). */
  campaigns: CampaignProgress[];
  /** Per type: people at each journey stage (form fills, screened, qualified, contacted, replied ...) from the persons read; null when it failed. */
  journey: Record<SourceType, PersonStages> | null;
  /** Open seats of every requisition in scope (0 when closed, inactive or full, with the outreach path's reason). */
  openSeats: OpenSeats[];
  requisitionCount: number;
  truncated: boolean;
  partial: boolean;
  failedSections: string[];
}

export interface OpenSeats { requisitionId: string; code: string; branch: string; open: number; closedReason: string | null }
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

/** A build never waits longer than this: a section still running at the deadline is flagged (partial, never cached) and answers its
 *  fallback; each statement is also bounded by MAX_EXECUTION_TIME (he-read-limit.ts), so the database stops it too. */
export const BUILD_BUDGET_MS = 12_000;

// Never the driver message (it can echo SQL and values): only the section and the error code.
async function section<T>(name: string, failed: string[], fn: () => Promise<T>, fallback: T, deadline?: number): Promise<T> {
  const flag = (code: unknown): T => {
    if (!failed.includes(name)) failed.push(name);
    logger.error({ section: name, code: code ?? "unknown" }, "[he-drive-analytics] section failed");
    return fallback;
  };
  const left = deadline === undefined ? Infinity : deadline - Date.now();
  if (left <= 0) return flag("deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = fn();
    if (!Number.isFinite(left)) return await run;
    run.catch(() => undefined); // a section that loses the race must not become an unhandled rejection
    const late = new Promise<"late">((resolve) => { timer = setTimeout(() => resolve("late"), left); });
    const r = await Promise.race([run, late]);
    return r === "late" ? flag("deadline") : (r as T);
  } catch (err) {
    return flag((err as { code?: unknown })?.code);
  } finally { if (timer) clearTimeout(timer); }
}
/** A table that is not deployed yet reads as no rows (not a failed section). */
async function tolerant<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try { return await fn(); } catch (err) { if (noTable(err)) return empty; throw err; }
}

// ---- SQL ---------------------------------------------------------------------------------------------------------------------------------
// Selected / joined only for people who arrived at the drive and were selected / joined on or after its drive date (he-drive-credit.ts).
const { joined: FLAG_JOINED, selected: FLAG_SELECTED } = driveCreditSql({ m: "m", d: "d", hl: "hl", ac: "ac" });
// The shared source rule, split (he-person-facts.service.ts): each statement returns the row's signals next to the lead id (credit through
// he_match.id, the credit's own drive_id ignored; Meta-sourced drive; activity on or after the cutoff) and PersonFacts types them in JS with
// each person's facts, read once per build.
const creditJoin = (streams: boolean): string => creditJoinsSql({ streams, match: "m", requisition: "d.requisition_id" });
const typeKeys = (streams: boolean, liveFrom: string): string => typeKeyColsSql({ streams, d: "d", leadId: "m.lead_id", ref: "d.drive_date", liveFrom });
const DRIVE_MATCH = `FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id`;

// STRAIGHT_JOIN on the three he_match readers: always drive from he_drive (window + requisition) and reach he_message / he_lead_event / he_lead by key,
// whatever the table statistics say. Same predicates as the header of he-requisition-sources.service.ts; he_lead and ats_candidate by primary key only,
// the ATS stage log and onboarding bridge by candidate id inside the credit rule.
// The window and the previous window in one statement: cur (first column, so its parameter comes first) tells them apart.
const outcomesSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT STRAIGHT_JOIN (d.drive_date >= ?) AS cur, ${typeKeys(streams, liveFrom)},
       COUNT(DISTINCT CASE WHEN ${FLAG_SELECTED} THEN m.id END) AS selected, COUNT(DISTINCT CASE WHEN ${FLAG_JOINED} THEN m.id END) AS joined,
       COUNT(DISTINCT CASE WHEN m.state = 'slot_released' THEN m.id END) AS slot_released
  ${DRIVE_MATCH}
  ${creditJoin(streams)}
  LEFT JOIN he_lead hl ON hl.id = m.lead_id
  LEFT JOIN ats_candidate ac ON ac.id = hl.ats_candidate_id COLLATE utf8mb4_unicode_ci
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY cur, ${TYPE_KEY_GROUP}`;

// Stops typed by the person rule (follow-up row signals, qfTypeKeysSql), never qualified_followup.source_type (the pipeline's type).
const stopsSql = (n: number, liveFrom: string): string => `SELECT ${qfTypeKeysSql(liveFrom)}, qf.stopped_reason, COUNT(*) AS n
  ${QF_TYPE_FROM_SQL}
 WHERE qf.requisition_id IN (${ph(n)}) AND qf.qualified_at >= ? AND qf.qualified_at < ? AND qf.stopped_reason IN ('opted_out','requisition_closed','no_contact_details')
 GROUP BY ${TYPE_KEY_GROUP}, tx, qf.stopped_reason`;

// Inbound messages of leads matched on window drives (idx_he_msg_lead); IST wall clock, so WEEKDAY() 0 = Monday and HOUR() 0-23 are IST.
// One row per message and person signals (hid): a reply of a person matched on two drives counts once per type, as before.
const repliesSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeKeys(streams, liveFrom)}, hm.id AS hid, WEEKDAY(hm.created_at) AS wd, HOUR(hm.created_at) AS hr
  ${DRIVE_MATCH}
  ${creditJoin(streams)}
  JOIN he_message hm ON hm.lead_id = m.lead_id AND hm.direction = 'in' AND hm.created_at >= ? AND hm.created_at < ?
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY ${TYPE_KEY_GROUP}, hm.id`;

// idx_he_event_drive (drive_id, event_type).
const arrivalsSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeKeys(streams, liveFrom)}, WEEKDAY(ev.created_at) AS wd, HOUR(ev.created_at) AS hr, COUNT(DISTINCT m.id) AS n
  ${DRIVE_MATCH}
  ${creditJoin(streams)}
  JOIN he_lead_event ev ON ev.drive_id = d.id AND ev.lead_id = m.lead_id AND ev.event_type = 'arrived'
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY ${TYPE_KEY_GROUP}, wd, hr`;

// One statement: drives in the window, plus requisitions of overlapping open / paused streams, active campaigns and the requested requisition.
// Every id is cast to one collation so the UNION cannot mix collations; the branch filter compares under utf8mb4_unicode_ci.
const discoverSql = (o: { streamIds: number; branch: boolean; requisition: boolean }): string => `SELECT jr.id, jr.requisition_code, jr.designation_name, jr.branch_name,
       jr.approval_status, jr.active_status, jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount, MAX(x.last_drive) AS last_drive
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
 GROUP BY jr.id, jr.requisition_code, jr.designation_name, jr.branch_name, jr.approval_status, jr.active_status, jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount
 ORDER BY MAX(x.last_drive) IS NULL, MAX(x.last_drive) DESC, jr.id
 LIMIT ${MAX_REQUISITIONS + 1}`;
const BRANCH_SQL = "SELECT 1 FROM job_requisition WHERE branch_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1";
const HEADER_SQL = "SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1";

// ---- reads ------------------------------------------------------------------------------------------------------------------------------
interface Head { id: string; code: string; role: string; branch: string; open: number; closedReason: string | null }
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
/** Open seats by the outreach path's own rule (lead-screener requisitionClosedReason): a closed, inactive or full requisition has none. */
const seatsOf = (r: RowDataPacket): { open: number; closedReason: string | null } => {
  const closedReason = requisitionClosedReason({ approvalStatus: r.approval_status == null ? null : String(r.approval_status), activeStatus: nOrNull(r.active_status),
    closedAt: r.closed_at == null ? null : String(r.closed_at), requestedHeadcount: nOrNull(r.requested_headcount), fulfilledHeadcount: nOrNull(r.fulfilled_headcount) });
  const open = Math.max(0, Math.floor((Number(r.requested_headcount) || 0) - (Number(r.fulfilled_headcount) || 0)));
  return { open: closedReason ? 0 : open, closedReason };
};
const batchesOf = (ids: string[]): string[][] => { const out: string[][] = []; for (let i = 0; i < ids.length; i += 200) out.push(ids.slice(i, i + 200)); return out; };
/** One statement per 200 ids; `streams` false is the same read before the stream tables exist. */
const runBatched = async (ids: string[], sqlOf: (n: number, streams: boolean) => string, params: (b: string[]) => unknown[]): Promise<RowDataPacket[]> =>
  (await Promise.all(batchesOf(ids).map((b) => readAgg((st) => sqlOf(b.length, st), params(b))))).flat();

type OutcomeRead = { outcomes: MatchOutcome[]; slotReleased: Record<SourceType, number> };
/** Outcomes of the window [from, to] and, with `prevFrom`, of the previous window [prevFrom, from) from the same statement. */
const readOutcomes = async (ids: string[], from: string, to: string, facts: PersonFacts, prevFrom?: string): Promise<OutcomeRead & { previous: MatchOutcome[] }> => {
  const rows = await runBatched(ids, outcomesSql(facts.liveFrom), (b) => [from, ...b, prevFrom ?? from, to]);
  await facts.loadRows(rows);
  const slotReleased = perType(() => 0);
  const outcomes: MatchOutcome[] = [], previous: MatchOutcome[] = [];
  for (const r of rows) {
    const t = facts.typeOf(r);
    if (!SOURCE_TYPES.includes(t)) continue;
    const o = { sourceType: t, selected: Number(r.selected ?? 0), joined: Number(r.joined ?? 0) };
    if (r.cur !== undefined && Number(r.cur) !== 1) { previous.push(o); continue; }
    outcomes.push(o);
    slotReleased[t] += Number(r.slot_released ?? 0);
  }
  return { outcomes, slotReleased, previous };
};

const readStops = async (ids: string[], dt: string[], facts: PersonFacts): Promise<Record<SourceType, Partial<Record<"opted_out" | "requisition_closed" | "no_contact_details", number>>>> => {
  const out = perType(() => ({}) as Partial<Record<"opted_out" | "requisition_closed" | "no_contact_details", number>>);
  const parts = await Promise.all(batchesOf(ids).map((b) => tolerant(async () => (await limitedDb.execute<RowDataPacket[]>(stopsSql(b.length, facts.liveFrom), [...b, ...dt]))[0], [] as RowDataPacket[])));
  await facts.loadRows(parts.flat());
  for (const r of parts.flat()) {
    const t = facts.typeOf(r);
    const k = String(r.stopped_reason) as "opted_out" | "requisition_closed" | "no_contact_details";
    if (out[t]) out[t][k] = (out[t][k] ?? 0) + Number(r.n ?? 0);
  }
  return out;
};

/** Timing cells typed by person facts. Rows with a message id (hid) count each message once per type; other rows carry their count. */
const typedCells = async (rows: RowDataPacket[], facts: PersonFacts): Promise<TimingCell[]> => {
  await facts.loadRows(rows);
  const seen = new Set<string>();
  const out: TimingCell[] = [];
  for (const r of rows) {
    const t = facts.typeOf(r);
    if (r.hid !== undefined) {
      const k = `${t}|${String(r.hid)}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push({ sourceType: t, weekday: Number(r.wd), hour: Number(r.hr), n: r.hid !== undefined ? 1 : Number(r.n ?? 0) });
  }
  return out;
};

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
    const [h] = await limitedDb.execute<RowDataPacket[]>(HEADER_SQL, [requisitionId]);
    if (!h[0]) return null;
    const reqBranch = String(h[0].branch_name ?? "");
    if (!scope.all && reqBranch !== scope.branchName) return null;
    if (branchIn && branchIn !== reqBranch) return null;
  }
  if (scope.all && branchIn && !requisitionId) { // an org-wide caller naming a branch that does not exist: not found, never zeros
    let exists = true; // a failing probe must not turn into a 404
    try { exists = ((await limitedDb.execute<RowDataPacket[]>(BRANCH_SQL, [branchIn]))[0] ?? []).length > 0; } catch (err) {
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
  const deadline = Date.now() + BUILD_BUDGET_MS;
  const sec = <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => section(name, failed, fn, fallback, deadline);
  const today = istToday(now);
  const prev = { from: addDays(w.from, -w.days), to: addDays(w.from, -1) };
  const dt = bounds(w.from, w.to);
  const mode = followupMode();

  // requisitions (+ the streams that decide which ones qualify and which windows the drive read must cover)
  const active = await sec("streams", () => tolerant(() => loadActiveStreams(), [] as StreamRow[]), [] as StreamRow[]);
  const overlapping = active.filter((s) => windowDays({ openFrom: s.openFrom, openDays: s.openDays, add: s.add, skip: s.skip }).some((d) => inRange(d, w.from, w.to)));
  const heads: Head[] = [];
  let truncated = false;
  await sec("requisitions", async () => {
    const streamIds = overlapping.map((s) => s.id);
    const params: unknown[] = [w.from, w.to, ...streamIds, ...(requisitionId ? [requisitionId] : []), ...(branch ? [branch] : []), ...(requisitionId ? [requisitionId] : [])];
    const [rows] = await limitedDb.execute<RowDataPacket[]>(discoverSql({ streamIds: streamIds.length, branch: !!branch, requisition: !!requisitionId }), params);
    truncated = rows.length > MAX_REQUISITIONS;
    for (const r of rows.slice(0, MAX_REQUISITIONS)) heads.push({ id: String(r.id), code: String(r.requisition_code ?? ""), role: String(r.designation_name ?? ""), branch: String(r.branch_name ?? ""), ...seatsOf(r) });
    return null;
  }, null);
  const ids = heads.map((h) => h.id);
  const openSeats: OpenSeats[] = heads.map((h) => ({ requisitionId: h.id, code: h.code, branch: h.branch, open: h.open, closedReason: h.closedReason }));
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
  const pf = new PersonFacts(liveFrom); // each person's facts read once for the whole build
  // Reads that need nothing computed here start with the others (the read limiter keeps the pool safe); their results are used further down.
  const reasonsP = !none && valueAddOn("outcome_reasons") ? sec("reasons", () => outcomeReasonCounts(ids, w.from, w.to, liveFrom, pf), null) : Promise.resolve(null);
  const costP = !none && valueAddOn("cost_per_source") ? sec("cost", () => readCostUsage(ids, w, liveFrom, pf), null) : null;
  // The previous window comes from the same statements as the window (persons, outcomes, follow-up stages; rows tagged by cur): its tiles
  // only need leads .. joined, so no separate previous-window reads. Every read goes through the shared read limiter (he-read-limit.ts).
  const noPersons = { byType: null as Record<SourceType, PersonStages> | null, campaigns: [] as CampaignProgressRow[], previous: null as Record<SourceType, PersonStageCounts> | null };
  const empty = { outcomes: [] as MatchOutcome[], slotReleased: perType(() => 0), previous: [] as MatchOutcome[] };
  const [sources, driveRows, outcomeRead, stops, repliesRows, arrivalsRows, persons] = await Promise.all([
    none ? null : sec("sources", async () => {
      const s = await getSourcesForRequisitions(ids, w, liveFrom, prev, pf);
      if (s.partial) failed.push("sources");
      return s;
    }, null as Awaited<ReturnType<typeof getSourcesForRequisitions>> | null),
    none ? ([] as TaggedAggRow[]) : sec("drives", () => readDriveAggRows(ids, dFrom, dTo, liveFrom, pf), [] as TaggedAggRow[]),
    none ? empty : sec("outcomes", () => readOutcomes(ids, w.from, w.to, pf, prev.from), empty),
    none ? perType(() => ({})) : sec("stops", () => readStops(ids, dt, pf), perType(() => ({}))),
    none ? ([] as TimingCell[]) : sec("replies", async () => typedCells(await runBatched(ids, repliesSql(liveFrom), (b) => [...dt, ...b, w.from, w.to]), pf), [] as TimingCell[]),
    none ? ([] as TimingCell[]) : sec("arrivals", async () => typedCells(await runBatched(ids, arrivalsSql(liveFrom), (b) => [...b, w.from, w.to]), pf), [] as TimingCell[]),
    none ? noPersons : sec("persons", () => readPersonStages(ids, w, liveFrom, prev, pf), noPersons),
  ]);
  const previous = none ? null : { stages: sources?.previousStages ?? [], outcomes: outcomeRead.previous, persons: persons.previous };

  const flat = (list: RequisitionSourceRows[] | undefined) => (list ?? []).flatMap((r) => r.rows);
  const inWindow = driveRows.filter((r) => inRange(r.date, w.from, w.to));
  // A failed persons read leaves leads / invited / confirmed / arrived at zero (flagged), never the state buckets in disguise.
  const zeroPersons = perType((): PersonStageCounts => ({ leads: 0, invited: 0, confirmed: 0, arrived: 0 }));
  const cur = stageCountsByType(flat(sources?.byRequisition), inWindow, outcomeRead.outcomes, none ? undefined : persons.byType ?? zeroPersons);
  // noShow / declined of the previous window are not part of `previous`, so it needs no drive rows.
  const before = previous ? stageCountsByType(previous.stages, [], previous.outcomes, previous.persons ?? zeroPersons) : stageCountsByType([], [], []);
  const campaigns = persons.campaigns.length
    ? await sec("campaigns", () => campaignProgress(persons.campaigns, new Map(heads.map((h) => [h.id, { code: h.code, branch: h.branch }])), scope.all), [] as CampaignProgress[])
    : [];
  const daily = dailySeries(inWindow, w.from, w.to);
  const replies = timingGrids(repliesRows);
  const arrivals = timingGrids(arrivalsRows);
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
  const reasons = await reasonsP;

  // cost per source: its own statements only while HE_COST_PER_SOURCE is on; a failed section counts 0 and flags the result as partial
  let cost: DriveAnalytics["cost"] = { available: false, note: "Cost per source arrives with Plan 5" };
  if (costP) {
    const c = await costP;
    if (c) {
      for (const f of c.failedSections) if (!failed.includes(f)) failed.push(f);
      cost = costBlock(c.usage, c.rates, perType((t) => stageOnly(cur[t])));
    }
  }
  // insights: thresholds once per call, facts (own sections), then the pure rules; any throw leaves the response without insights
  let insights: DriveInsight[] = [];
  if (!none) {
    insights = await sec("insights", async () => {
      const t = await loadInsightThresholds();
      const { facts, failedSections: factFailed } = await collectInsightFacts({
        requisitionIds: ids, from: w.from, to: w.to, today, windowDays: w.days, liveFrom, personFacts: pf,
        types: perType((k) => ({ current: types[k].stages, previous: types[k].previous, noShow: types[k].noShow, declined: types[k].declined })),
        ...(reasons ? { reasons } : {}),
        agg: inWindow, sources: sources?.byRequisition ?? [], codes: new Map(heads.map((h) => [h.id, h.code])), t, arrivals, streams: active, now,
        funnel: {
          journey: persons.byType, campaigns, openSeats, replies,
          cost: "byType" in cost && cost.byType ? perType((k) => ({ perJoin: (cost as CostBlock).byType?.[k]?.perJoin ?? null, joined: types[k].stages.joined })) : null,
        },
      }, scope);
      for (const f of factFailed) if (!failed.includes(f)) failed.push(f);
      return evaluateInsights(facts, t);
    }, [] as DriveInsight[]);
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
    campaigns,
    journey: none ? perType(() => ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0 })) : persons.byType,
    openSeats,
    requisitionCount: ids.length,
    truncated,
    partial: failedSections.length > 0,
    failedSections,
  };
}
