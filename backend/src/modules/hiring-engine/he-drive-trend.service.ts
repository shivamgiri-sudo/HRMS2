/**
 * Day-wise drive series for one requisition (GET /drive-trend) and the grouped drive rows of the campaign dashboard (driveGroups).
 *
 * Counts per drive day come from he_match state buckets (the same ones `driveDays` uses): lined = every match; invited / confirmed /
 * arrived / noShow / declined by he_match.state. They are state counts, not message counts, so delivery_status plays no part:
 * a person whose invite is still being sent (or whose delivery status is NULL) is already in state 'invited' and counts as invited.
 * Attribution: the shared source rule (he-source-attribution.ts): a Meta-origin person (Meta stream credit, Meta-sourced drive, meta_lead_id or
 * campaign link) is Live / Old Meta by form fill against the cutoff, everyone else `he`; the three never overlap. source_type is NULL for a
 * `he` match, so `streamType` keeps meaning "typed other than he". The credit row can carry an old drive_id, so drives are always
 * reached through he_match.drive_id, never through the credit.
 *
 * Every query starts from he_drive (requisition + branch + date window), then LEFT JOINs he_match by drive_id, the credit by match_id,
 * the stream by its key and he_lead by primary key (form fills by key inside the rule). A failing sub-query yields a partial result with failedSections, never a throw.
 * No candidate data in the result or in any log line: counts, dates, ids and labels only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import type { SourceType } from "./qualified-followup.types.js";
import { loadActiveStreams, loadStreamsOfType, toWindow, type StreamRow } from "./requisition-stream.service.js";
import { addDays, isSunday, istToday, windowDays } from "./requisition-stream.window.js";
import type { DriveDayRow } from "./he-campaign-dashboard.service.js";
import type { TaggedAggRow } from "./he-drive-analytics.js";
import { UNPLANNED_ARRIVAL } from "./he-rate-buckets.js";
import { attributionJoinsSql, sourceTypeSql } from "./he-source-attribution.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";

export interface DriveTotals { wanted: number; lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number; showRate: number }
export interface WindowInfo { from: string; to: string; dayIndex: number; days: number }
export interface TrendPoint extends DriveTotals {
  date: string; driveId: string | null; status: string;
  streams: Array<{ streamId: string; lined: number; invited: number; confirmed: number; arrived: number }>;
}
export interface DriveTrend {
  requisitionId: string; branch: string; sourceType: SourceType | null; window: WindowInfo; points: TrendPoint[];
  /** True when a section failed to load (its numbers are zeros); the section names are listed. Never cached. */
  partial: boolean; failedSections: string[];
}
export interface DriveGroup {
  requisitionId: string; branch: string; requisition: string; role: string; sourceType: SourceType; types: SourceType[]; streamIds: string[];
  window: WindowInfo; totals: DriveTotals; days: DriveDayRow[];
}
export interface DriveAggRow {
  driveId: string; date: string; status: string; wanted: number; streamId: string | null; streamType: SourceType | null;
  lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number;
  /** Of `arrived`: walk-ins never booked (UNPLANNED_ARRIVAL). Counted as arrivals, left out of the show rate. */
  unplanned?: number;
}
export interface DriveGroupInput { requisitionId: string; branch: string; requisition: string; role: string; streams: StreamRow[]; rows: DriveAggRow[]; today: string }

const TYPE_ORDER: Record<SourceType, number> = { he: 0, meta_live: 1, meta_old: 2 };
const SOURCE_TYPES: readonly string[] = ["meta_live", "meta_old", "he"];
const DEFAULT_BACK = 13;
const DEFAULT_AHEAD = 3;
const CACHE_MS = 60_000;
const CACHE_MAX = 200;

export const showRate = (arrived: number, confirmed: number): number => (confirmed > 0 ? arrived / confirmed : 0);
const typeOf = (r: DriveAggRow): SourceType => r.streamType ?? "he";
const byDate = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const BUCKETS_SQL = `COUNT(m.id) AS lined,
       SUM(m.state IN ('invited','confirmed','slot_released','arrived','no_show','selected')) AS invited,
       SUM(m.state IN ('confirmed','arrived','selected')) AS confirmed, SUM(m.state IN ('arrived','selected')) AS arrived,
       SUM(m.state = 'no_show') AS no_show, SUM(m.state = 'declined') AS declined, SUM(${UNPLANNED_ARRIVAL}) AS unplanned`;
// `streams` false: the same read before 2135 is applied (no stream tables): the rule without the stream credit.
const joinsSql = (streams: boolean): string => `LEFT JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
  ${attributionJoinsSql({ streams, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id", stream: "s" })}`;
// source_type: the shared rule, NULL for a `he` match (and for a drive with no match), so `streamType` keeps meaning "typed other than he".
const typeSql = (streams: boolean, liveFrom: string): string =>
  `IF(m.id IS NULL, NULL, NULLIF(${sourceTypeSql({ streams, d: "d", lead: "al", liveFrom, stream: "s", ref: "d.drive_date" })}, 'he'))`;
// source_type is column 6 of the trend read and 10 of the groups read: GROUP BY uses the position, because a bare name would bind to s.source_type.
const streamCols = (streams: boolean, liveFrom: string): string => `${streams ? "s.id" : "NULL"} AS stream_id, ${typeSql(streams, liveFrom)} AS source_type`;
const trendSql = (liveFrom: string) => (streams: boolean): string => `SELECT d.id, d.drive_date, d.status, d.target_shows, ${streamCols(streams, liveFrom)}, ${BUCKETS_SQL}
  FROM he_drive d
  ${joinsSql(streams)}
 WHERE d.requisition_id = ? AND d.branch_name = ? AND d.drive_date BETWEEN ? AND ?
 GROUP BY d.id${streams ? ", s.id" : ""}, 6
 ORDER BY d.drive_date, d.id`;
const HEADER_SQL = "SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1";
// Open drives of the next days and yesterday decide which requisitions get a group (idx_he_drive_date: drive_date, status).
const DISCOVER_SQL = "SELECT DISTINCT d.requisition_id, d.branch_name FROM he_drive d WHERE d.drive_date BETWEEN ? AND ? AND d.status <> 'closed'";
// job_requisition is the driving side only to carry code and role; its id is compared with an explicit collation (mixed table collations) and he_drive keeps its own index side.
const groupsSql = (n: number, streams: boolean, liveFrom: string): string => `SELECT jr.id AS requisition_id, jr.requisition_code, jr.designation_name, d.branch_name,
       d.id, d.drive_date, d.status, d.target_shows, ${streamCols(streams, liveFrom)}, ${BUCKETS_SQL}
  FROM job_requisition jr
  LEFT JOIN he_drive d ON d.requisition_id = jr.id COLLATE utf8mb4_unicode_ci AND d.drive_date BETWEEN ? AND ?
  ${joinsSql(streams)}
 WHERE jr.id IN (${Array(n).fill("?").join(",")})
 GROUP BY jr.id, d.id${streams ? ", s.id" : ""}, 10`;

const noTable = (err: unknown): boolean => (err as { code?: string })?.code === "ER_NO_SUCH_TABLE";
/** The stream-attributed read; before 2135 is applied the stream-free form (a missing table is not a failed section). */
export async function readAgg(sqlOf: (streams: boolean) => string, params: unknown[]): Promise<RowDataPacket[]> {
  try { return (await db.execute<RowDataPacket[]>(sqlOf(true), params))[0]; } catch (err) {
    if (!noTable(err)) throw err;
    return (await db.execute<RowDataPacket[]>(sqlOf(false), params))[0];
  }
}
/** Stream reads that answer "no streams" while the stream tables do not exist yet. */
const orNoStreams = async (fn: () => Promise<StreamRow[]>): Promise<StreamRow[]> => {
  try { return await fn(); } catch (err) { if (noTable(err)) return []; throw err; }
};

function parseAgg(r: RowDataPacket): DriveAggRow {
  return {
    driveId: String(r.id), date: String(r.drive_date).slice(0, 10), status: String(r.status), wanted: Number(r.target_shows ?? 0),
    streamId: r.stream_id == null ? null : String(r.stream_id), streamType: r.source_type == null ? null : (String(r.source_type) as SourceType),
    lined: Number(r.lined ?? 0), invited: Number(r.invited ?? 0), confirmed: Number(r.confirmed ?? 0), arrived: Number(r.arrived ?? 0),
    noShow: Number(r.no_show ?? 0), declined: Number(r.declined ?? 0), unplanned: Number(r.unplanned ?? 0),
  };
}

const emptyTotals = (): DriveTotals => ({ wanted: 0, lined: 0, invited: 0, confirmed: 0, arrived: 0, noShow: 0, declined: 0, showRate: 0 });

/** Every non-Sunday day from..to plus any Sunday that holds a drive. */
export function defaultTrendDates(from: string, to: string, driveDates: string[]): string[] {
  const drives = new Set(driveDates);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isSunday(d) || drives.has(d)) out.push(d);
  return out;
}

/** The union of the streams' planned days plus any drive date between the first and last of them. */
export function streamWindowDates(streams: StreamRow[], driveDates: string[]): string[] {
  const days = new Set<string>();
  for (const s of streams) for (const d of windowDays(toWindow(s))) days.add(d);
  if (!days.size) return [];
  const sorted = [...days].sort(byDate);
  const first = sorted[0], last = sorted[sorted.length - 1];
  for (const d of driveDates) if (d >= first && d <= last) days.add(d);
  return [...days].sort(byDate);
}

/** One point per date (zero-filled: driveId null, status "no_drive"); counts only matches attributed to `sourceType` when given. */
export function zeroFillPoints(dates: string[], rows: DriveAggRow[], sourceType: SourceType | null): TrendPoint[] {
  return fillPoints(dates, rows, sourceType).points;
}

/** The points plus, per point, the unplanned arrivals left out of its show rate (kept off the output). */
function fillPoints(dates: string[], rows: DriveAggRow[], sourceType: SourceType | null): { points: TrendPoint[]; unplanned: number } {
  let unplannedAll = 0;
  const perDate = new Map<string, DriveAggRow[]>();
  for (const r of rows) { const l = perDate.get(r.date); if (l) l.push(r); else perDate.set(r.date, [r]); }
  const points = [...new Set(dates)].sort(byDate).map((date) => {
    const mine = perDate.get(date) ?? [];
    const t = emptyTotals();
    const wantedSeen = new Set<string>();
    const streams = new Map<string, TrendPoint["streams"][number]>();
    let unplanned = 0;
    for (const r of mine) {
      if (!wantedSeen.has(r.driveId)) { wantedSeen.add(r.driveId); t.wanted += r.wanted; }
      if (sourceType && typeOf(r) !== sourceType) continue;
      t.lined += r.lined; t.invited += r.invited; t.confirmed += r.confirmed; t.arrived += r.arrived; t.noShow += r.noShow; t.declined += r.declined;
      unplanned += r.unplanned ?? 0;
      if (r.streamId) {
        const s = streams.get(r.streamId) ?? { streamId: r.streamId, lined: 0, invited: 0, confirmed: 0, arrived: 0 };
        s.lined += r.lined; s.invited += r.invited; s.confirmed += r.confirmed; s.arrived += r.arrived;
        streams.set(r.streamId, s);
      }
    }
    t.showRate = showRate(t.arrived - unplanned, t.confirmed - unplanned);
    unplannedAll += unplanned;
    return { date, driveId: mine[0]?.driveId ?? null, status: mine[0]?.status ?? "no_drive", ...t, streams: [...streams.values()] };
  });
  return { points, unplanned: unplannedAll };
}

function windowOf(points: TrendPoint[], today: string): WindowInfo {
  return { from: points[0]?.date ?? today, to: points[points.length - 1]?.date ?? today, dayIndex: points.filter((p) => p.date <= today).length, days: points.length };
}

function totalsOf(points: TrendPoint[], unplanned = 0): DriveTotals {
  const t = emptyTotals();
  for (const p of points) { t.wanted += p.wanted; t.lined += p.lined; t.invited += p.invited; t.confirmed += p.confirmed; t.arrived += p.arrived; t.noShow += p.noShow; t.declined += p.declined; }
  t.showRate = showRate(t.arrived - unplanned, t.confirmed - unplanned);
  return t;
}

/** Pure: one group per requisition, branch and type (`he` whenever there are drives, plus one per type with an open stream). */
export function buildDriveGroups(input: DriveGroupInput[]): DriveGroup[] {
  const out: DriveGroup[] = [];
  for (const g of input) {
    const open = g.streams.filter((s) => s.status === "open");
    const driveDates = g.rows.map((r) => r.date);
    // A match credited to a paused or closed stream still counts for that stream's type (spec 9d), so a type present among the credited
    // rows gets a group too and the per-type totals add up to the drive totals. Its window is that type's non-draft streams' days, else the default.
    const credited = g.rows.filter((r) => r.streamType && r.lined > 0).map((r) => r.streamType as SourceType);
    const streamTypes = [...new Set([...open.map((s) => s.sourceType), ...credited])];
    const types = [...new Set<SourceType>([...(g.rows.length ? (["he"] as SourceType[]) : []), ...streamTypes])].sort((a, b) => TYPE_ORDER[a] - TYPE_ORDER[b]);
    for (const type of types) {
      const mine = open.filter((s) => s.sourceType === type);
      const ofType = g.streams.filter((s) => s.sourceType === type && s.status !== "draft");
      const creditedDates = g.rows.filter((r) => r.streamType === type && r.lined > 0).map((r) => r.date);
      const dates = ofType.length ? [...new Set([...streamWindowDates(ofType, driveDates), ...creditedDates])].sort(byDate) : defaultTrendDates(addDays(g.today, -DEFAULT_BACK), addDays(g.today, DEFAULT_AHEAD), driveDates);
      const { points, unplanned } = fillPoints(dates, g.rows, type);
      out.push({
        requisitionId: g.requisitionId, branch: g.branch, requisition: g.requisition, role: g.role, sourceType: type, types, streamIds: mine.map((s) => s.id),
        window: windowOf(points, g.today), totals: totalsOf(points, unplanned),
        days: points.map((p) => ({
          driveId: p.driveId ?? "", date: p.date, branch: g.branch, requisition: g.requisition, role: g.role, status: p.status, wanted: p.wanted, lined: p.lined,
          invited: p.invited, confirmed: p.confirmed, arrived: p.arrived, noShow: p.noShow, declined: p.declined,
        })),
      });
    }
  }
  return out;
}

/** Drive state buckets of many requisitions over a window, one statement per 200 ids (same SQL and parsing as the groups read). Throws on failure. */
export async function readDriveAggRows(ids: string[], from: string, to: string, liveFrom?: string): Promise<TaggedAggRow[]> {
  const lf = liveFrom ?? await loadLiveFrom();
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 200) batches.push(unique.slice(i, i + 200));
  const parts = await Promise.all(batches.map((b) => readAgg((st) => groupsSql(b.length, st, lf), [from, to, ...b])));
  return parts.flat().filter((r) => r.id != null).map((r) => ({ ...parseAgg(r), requisitionId: String(r.requisition_id), branch: String(r.branch_name) }));
}

// Never the driver message (it can echo SQL and values): only the section and the error code.
async function section<T>(name: string, failed: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    failed.push(name);
    logger.error({ section: name, code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-drive-trend] section failed");
    return fallback;
  }
}

const cache = new Map<string, { at: number; data: DriveTrend }>();
const scopeKey = (s: BranchScope): string => (s.all ? "all" : `b:${s.branchName ?? ""}`);
/** Test hook. */
export function clearDriveTrendCache(): void { cache.clear(); }

/** Null when the requisition does not exist or the requisition / branch is outside the caller's scope (checked before the cache is read). */
export async function getDriveTrend(
  q: { requisitionId: string; branch?: string | null; sourceType?: SourceType | null }, scope: BranchScope, now: Date = new Date(),
): Promise<DriveTrend | null> {
  const sourceType = q.sourceType && SOURCE_TYPES.includes(q.sourceType) ? q.sourceType : null;
  const [h] = await db.execute<RowDataPacket[]>(HEADER_SQL, [q.requisitionId]);
  if (!h[0]) return null;
  const reqBranch = String(h[0].branch_name ?? "");
  const branch = q.branch ? q.branch : reqBranch;
  if (!scope.all && !(scope.branchName != null && scope.branchName === reqBranch && scope.branchName === branch)) return null;
  const key = `${q.requisitionId}|${branch}|${scopeKey(scope)}|${sourceType ?? "all"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  if (hit) cache.delete(key);

  const today = istToday(now);
  const failed: string[] = [];
  const streams = sourceType ? await section("streams", failed, () => orNoStreams(() => loadStreamsOfType(q.requisitionId, sourceType)), [] as StreamRow[]) : [];
  const streamDays = streams.length ? streamWindowDates(streams, []) : [];
  const from = streamDays.length ? streamDays[0] : addDays(today, -DEFAULT_BACK);
  const to = streamDays.length ? streamDays[streamDays.length - 1] : addDays(today, DEFAULT_AHEAD);
  const rows = await section("drives", failed, async () => (await readAgg(trendSql(await loadLiveFrom()), [q.requisitionId, branch, from, to])).map(parseAgg), [] as DriveAggRow[]);
  const driveDates = rows.map((r) => r.date);
  const dates = streamDays.length ? streamWindowDates(streams, driveDates) : defaultTrendDates(from, to, driveDates);
  const points = zeroFillPoints(dates, rows, sourceType);
  const data: DriveTrend = { requisitionId: q.requisitionId, branch, sourceType, window: windowOf(points, today), points, partial: failed.length > 0, failedSections: failed };
  if (!data.partial) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), data });
  }
  return data;
}

/** Groups for every requisition with a non-closed drive from yesterday to today + 3 or an open stream, in two reads plus one stream read. */
export async function getDriveGroupsDetailed(now: Date = new Date()): Promise<{ groups: DriveGroup[]; failedSections: string[] }> {
  const today = istToday(now);
  const failed: string[] = [];
  const active = await section("streams", failed, () => orNoStreams(() => loadActiveStreams()), [] as StreamRow[]);
  const open = active.filter((s) => s.status === "open");
  const found = await section("drives", failed, async () => (await db.execute<RowDataPacket[]>(DISCOVER_SQL, [addDays(today, -1), addDays(today, DEFAULT_AHEAD)]))[0], [] as RowDataPacket[]);
  const keys = new Map<string, { requisitionId: string; branch: string }>();
  const keyOf = (r: string, b: string): string => `${r}|${b}`;
  for (const r of found) keys.set(keyOf(String(r.requisition_id), String(r.branch_name)), { requisitionId: String(r.requisition_id), branch: String(r.branch_name) });
  for (const s of open) keys.set(keyOf(s.requisitionId, s.branchName), { requisitionId: s.requisitionId, branch: s.branchName });
  if (!keys.size) return { groups: [], failedSections: failed };

  let from = addDays(today, -DEFAULT_BACK), to = addDays(today, DEFAULT_AHEAD);
  for (const s of active) { const d = windowDays(toWindow(s)); if (d.length) { if (d[0] < from) from = d[0]; if (d[d.length - 1] > to) to = d[d.length - 1]; } }
  const ids = [...new Set([...keys.values()].map((k) => k.requisitionId))];
  const raw = await section("groups", failed, async () => { const lf = await loadLiveFrom(); return await readAgg((st) => groupsSql(ids.length, st, lf), [from, to, ...ids]); }, null as RowDataPacket[] | null);
  if (!raw) return { groups: [], failedSections: failed };

  const heads = new Map<string, { code: string; role: string }>();
  const rowsBy = new Map<string, DriveAggRow[]>();
  for (const r of raw) {
    const rid = String(r.requisition_id);
    heads.set(rid, { code: String(r.requisition_code ?? ""), role: String(r.designation_name ?? "") });
    if (r.id == null) continue;
    const k = keyOf(rid, String(r.branch_name));
    const l = rowsBy.get(k);
    if (l) l.push(parseAgg(r)); else rowsBy.set(k, [parseAgg(r)]);
  }
  const input: DriveGroupInput[] = [];
  for (const [k, v] of keys) {
    const head = heads.get(v.requisitionId);
    if (!head) continue;
    input.push({ requisitionId: v.requisitionId, branch: v.branch, requisition: head.code, role: head.role, today, rows: rowsBy.get(k) ?? [], streams: active.filter((s) => s.requisitionId === v.requisitionId && s.branchName === v.branch) });
  }
  input.sort((a, b) => a.requisition.localeCompare(b.requisition) || a.branch.localeCompare(b.branch) || a.requisitionId.localeCompare(b.requisitionId));
  return { groups: buildDriveGroups(input), failedSections: failed };
}

export async function getDriveGroups(now?: Date): Promise<DriveGroup[]> {
  return (await getDriveGroupsDetailed(now)).groups;
}
