/**
 * Requisition source streams: create, change, history, auto-close.
 * Every change is ONE guarded UPDATE (guard on the row's old status and window) plus ONE requisition_stream_event row in ONE
 * transaction. Expected failures come back as `{ ok: false, reason }` from tryCreateStream / tryChangeStream (the planner path);
 * createStream / changeStream wrap them and throw StreamError for the routes. Nothing here logs candidate data.
 */
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import type { SourceType } from "./qualified-followup.types.js";
import { getRequisitionReadiness } from "./he-readiness.service.js";
import { isBlocking, NEVER_OVERRIDE, type ReadinessProblem } from "./requisition-readiness.js";
import {
  MAX_CREATE_DAYS, WINDOW_MESSAGES, applyWindowChange, istToday, windowEnd, windowLabel, windowStatus,
  type StreamWindow, type WindowChange,
} from "./requisition-stream.window.js";

export type StreamStatus = "draft" | "open" | "paused" | "closed";
export type StreamAction = "create" | "open" | "pause" | "close" | "reopen" | "extend" | "extend_to" | "add_day" | "skip_day" | "shorten" | "auto_close";
export type AutoCloseReason = "window_ended" | "requisition_filled" | "requisition_closed";

export interface StreamRow {
  id: string; requisitionId: string; branchName: string; sourceType: SourceType; originId: string; originLabel: string;
  openFrom: string; openDays: number; dailyInvites: number | null; status: StreamStatus; closedReason: string | null;
  createdBy: string | null; createdAt: string; add: string[]; skip: string[];
}
export const toWindow = (s: StreamRow): StreamWindow => ({ openFrom: s.openFrom, openDays: s.openDays, add: s.add, skip: s.skip });
export interface StreamView extends StreamRow { window: ReturnType<typeof windowStatus>; label: string; warnings: ReadinessProblem[] }
export interface StreamActor { userId: string | null; isAdmin: boolean; scope: BranchScope }

export class StreamError extends Error {
  constructor(message: string, public statusCode: 400 | 404 | 409, public problems?: ReadinessProblem[]) { super(message); this.name = "StreamError"; }
}

export type StreamFailReason = "invalid" | "not_found" | "conflict" | "not_ready" | "changed_meanwhile" | "error";
export interface StreamFail { ok: false; reason: StreamFailReason; statusCode: 400 | 404 | 409 | 500; message: string; problems?: ReadinessProblem[] }
const fail = (reason: StreamFailReason, statusCode: StreamFail["statusCode"], message: string, problems?: ReadinessProblem[]): StreamFail => ({ ok: false, reason, statusCode, message, problems });

export interface CreateStreamInput {
  requisitionId: string; sourceType: SourceType; originId: string; originLabel?: string | null; openFrom: string; openDays: number;
  dailyInvites?: number | null; open?: boolean; override?: boolean; reason?: string | null;
}
export interface StreamChangeInput {
  action: "open" | "pause" | "close" | "reopen" | "extend" | "extend_to" | "add_day" | "skip_day" | "shorten";
  days?: number; toDate?: string; day?: string; reason?: string | null; override?: boolean;
}
export interface StreamEvent {
  id: string; action: StreamAction; changedBy: string | null; changedAt: string; oldOpenFrom: string | null; oldOpenDays: number | null;
  newOpenDays: number | null; oldStatus: string | null; newStatus: string | null; day: string | null; reason: string | null;
}

const MSG_CHANGED = "The stream changed meanwhile; reload and try again";
const MSG_DUP = "A stream for this source already exists; reopen or extend it";
const MSG_NOT_FOUND = "Stream not found";
const SOURCE_TYPES: readonly string[] = ["meta_live", "meta_old", "he"];
const ACTIONS: readonly string[] = ["open", "pause", "close", "reopen", "extend", "extend_to", "add_day", "skip_day", "shorten"];
const WINDOW_ACTIONS: readonly string[] = ["extend", "extend_to", "add_day", "skip_day", "shorten"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const day10 = (v: unknown): string => String(v).slice(0, 10);
const inScope = (branch: string, scope: BranchScope): boolean => scope.all || (!!scope.branchName && scope.branchName === branch);
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const logFail = (where: string, err: unknown): void => {
  // code/name only: a driver message can echo statement values
  const e = err as { code?: string; name?: string };
  console.error(`[streams] ${where} failed: ${e?.code ?? e?.name ?? "error"}`);
};

function mapRow(r: RowDataPacket, add: string[] = [], skip: string[] = []): StreamRow {
  return {
    id: String(r.id), requisitionId: String(r.requisition_id), branchName: String(r.branch_name), sourceType: r.source_type as SourceType,
    originId: String(r.origin_id), originLabel: String(r.origin_label), openFrom: day10(r.open_from), openDays: Number(r.open_days),
    dailyInvites: r.daily_invites == null ? null : Number(r.daily_invites), status: r.status as StreamStatus,
    closedReason: r.closed_reason == null ? null : String(r.closed_reason), createdBy: r.created_by == null ? null : String(r.created_by),
    createdAt: String(r.created_at), add, skip,
  };
}

async function attachDays(rows: RowDataPacket[]): Promise<StreamRow[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const [d] = await db.execute<RowDataPacket[]>(
    `SELECT stream_id, day, kind FROM requisition_stream_day WHERE stream_id IN (${ids.map(() => "?").join(",")}) ORDER BY day`, ids);
  return rows.map((r) => {
    const mine = d.filter((x) => String(x.stream_id) === String(r.id));
    return mapRow(r, mine.filter((x) => x.kind === "add").map((x) => day10(x.day)), mine.filter((x) => x.kind === "skip").map((x) => day10(x.day)));
  });
}

async function loadStream(id: string): Promise<StreamRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM requisition_stream WHERE id = ? LIMIT 1", [id]);
  return (await attachDays(rows))[0] ?? null;
}

/** Entries after the new last day are stale: dropped so an old add cannot resurface after shorten + extend. */
function prune(w: StreamWindow): StreamWindow {
  const end = windowEnd(w);
  return { ...w, add: w.add.filter((d) => d <= end), skip: w.skip.filter((d) => d <= end) };
}

function toView(s: StreamRow, today: string, problems: ReadinessProblem[]): StreamView {
  const w = toWindow(s);
  return { ...s, window: windowStatus(w, today), label: windowLabel(w, today), warnings: s.status === "open" || s.status === "paused" ? problems : [] };
}

async function warningsFor(s: StreamRow): Promise<ReadinessProblem[]> {
  if (s.status !== "open" && s.status !== "paused") return [];
  try { return (await getRequisitionReadiness(s.requisitionId, s.sourceType))?.problems ?? []; } catch (err) { logFail("readiness", err); return []; }
}

/** Blocking problems left after an admin override; the overridden codes (never those in NEVER_OVERRIDE). */
async function checkReadiness(requisitionId: string, sourceType: SourceType, wantOverride: boolean, a: StreamActor): Promise<{ ok: true; prefix: string } | StreamFail> {
  const r = await getRequisitionReadiness(requisitionId, sourceType);
  if (!r) return fail("not_found", 404, "Requisition not found");
  if (!isBlocking(r.problems)) return { ok: true, prefix: "" };
  const blocking = r.problems.filter((p) => p.severity === "blocking");
  const canOverride = wantOverride && a.isAdmin;
  const left = canOverride ? blocking.filter((p) => NEVER_OVERRIDE.has(p.code)) : blocking;
  if (left.length) return fail("not_ready", 409, "The requisition is not ready", r.problems);
  return { ok: true, prefix: `override: ${blocking.map((p) => p.code).join(",")}; ` };
}

interface EventData { action: StreamAction; oldStatus: string | null; newStatus: string | null; oldOpenFrom: string | null; oldOpenDays: number | null; newOpenDays: number | null; day: string | null; reason: string | null }

async function insertEvent(conn: Awaited<ReturnType<typeof db.getConnection>>, streamId: string, by: string | null, e: EventData): Promise<void> {
  await conn.execute(
    `INSERT INTO requisition_stream_event (stream_id, changed_by, action, old_open_from, old_open_days, new_open_days, old_status, new_status, day, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [streamId, by, e.action, e.oldOpenFrom, e.oldOpenDays, e.newOpenDays, e.oldStatus, e.newStatus, e.day, e.reason == null ? null : e.reason.slice(0, 255)]);
}

async function writeExceptions(conn: Awaited<ReturnType<typeof db.getConnection>>, streamId: string, w: StreamWindow): Promise<void> {
  await conn.execute("DELETE FROM requisition_stream_day WHERE stream_id = ?", [streamId]);
  const rows = [...w.add.map((d) => [d, "add"]), ...w.skip.map((d) => [d, "skip"])];
  if (!rows.length) return;
  await conn.execute(`INSERT INTO requisition_stream_day (stream_id, day, kind) VALUES ${rows.map(() => "(?, ?, ?)").join(", ")}`, rows.flatMap(([d, k]) => [streamId, d, k]));
}

function validReason(reason: unknown): StreamFail | null {
  if (reason != null && (typeof reason !== "string" || reason.length > 255)) return fail("invalid", 400, "Reason must be at most 255 characters");
  return null;
}

async function rollbackQuietly(conn: Awaited<ReturnType<typeof db.getConnection>>): Promise<void> {
  try { await conn.rollback(); } catch { /* connection already gone */ }
}

export async function tryCreateStream(i: CreateStreamInput, a: StreamActor, now: Date = new Date()): Promise<{ ok: true; stream: StreamView } | StreamFail> {
  try {
    const today = istToday(now);
    if (!SOURCE_TYPES.includes(i.sourceType)) return fail("invalid", 400, "Source type must be meta_live, meta_old or he");
    if (typeof i.openFrom !== "string" || !ISO.test(i.openFrom) || Number.isNaN(Date.parse(`${i.openFrom}T00:00:00Z`))) return fail("invalid", 400, WINDOW_MESSAGES.invalid_date);
    if (i.openFrom < today) return fail("invalid", 400, "Start date cannot be before today");
    if (!Number.isInteger(i.openDays) || i.openDays < 1 || i.openDays > MAX_CREATE_DAYS) return fail("invalid", 400, WINDOW_MESSAGES.invalid_days);
    if (i.dailyInvites != null && (!Number.isInteger(i.dailyInvites) || i.dailyInvites < 1 || i.dailyInvites > 500)) return fail("invalid", 400, "Daily invites must be a whole number from 1 to 500");
    const bad = validReason(i.reason);
    if (bad) return bad;

    const [rq] = await db.execute<RowDataPacket[]>("SELECT id, branch_name FROM job_requisition WHERE id = ? LIMIT 1", [i.requisitionId]);
    if (!rq[0] || !inScope(String(rq[0].branch_name), a.scope)) return fail("not_found", 404, "Requisition not found");
    const branchName = String(rq[0].branch_name);

    const origin = await resolveOrigin(i);
    if (!origin.ok) return origin;
    const originLabel = (typeof i.originLabel === "string" && i.originLabel.trim() ? i.originLabel.trim() : origin.label).slice(0, 200);

    const status: StreamStatus = i.open ? "open" : "draft";
    let prefix = "";
    if (i.open) {
      const r = await checkReadiness(i.requisitionId, i.sourceType, i.override === true, a);
      if (!r.ok) return r;
      prefix = r.prefix;
    }

    const id = randomUUID();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO requisition_stream (id, requisition_id, branch_name, source_type, origin_id, origin_label, open_from, open_days, daily_invites, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, i.requisitionId, branchName, i.sourceType, i.originId, originLabel, i.openFrom, i.openDays, i.dailyInvites ?? null, status, a.userId]);
      await insertEvent(conn, id, a.userId, { action: "create", oldStatus: null, newStatus: status, oldOpenFrom: null, oldOpenDays: null, newOpenDays: i.openDays, day: null, reason: prefix + (i.reason ?? "") || null });
      await conn.commit();
    } catch (err) {
      await rollbackQuietly(conn);
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") return fail("conflict", 409, MSG_DUP);
      throw err;
    } finally {
      conn.release();
    }
    const stream: StreamRow = { id, requisitionId: i.requisitionId, branchName, sourceType: i.sourceType, originId: i.originId, originLabel, openFrom: i.openFrom, openDays: i.openDays,
      dailyInvites: i.dailyInvites ?? null, status, closedReason: null, createdBy: a.userId, createdAt: now.toISOString(), add: [], skip: [] };
    return { ok: true, stream: toView(stream, today, await warningsFor(stream)) };
  } catch (err) {
    logFail("create", err);
    return fail("error", 500, "Could not create the stream");
  }
}

async function resolveOrigin(i: CreateStreamInput): Promise<{ ok: true; label: string } | StreamFail> {
  const notFound = fail("not_found", 404, "Source not found");
  if (typeof i.originId !== "string" || !i.originId.trim() || i.originId.length > 64) return notFound;
  if (i.sourceType === "he") return i.originId === "pool" ? { ok: true, label: "Pool: ATS history" } : notFound;
  if (i.sourceType === "meta_live") {
    const [c] = await db.execute<RowDataPacket[]>("SELECT id, campaign_name, requisition_id FROM meta_campaign WHERE id = ? LIMIT 1", [i.originId]);
    if (!c[0]) return notFound;
    if (c[0].requisition_id != null && String(c[0].requisition_id) !== i.requisitionId) return fail("conflict", 409, "That campaign is linked to another requisition");
    return { ok: true, label: String(c[0].campaign_name ?? "Campaign") };
  }
  const [d] = await db.execute<RowDataPacket[]>("SELECT id, run_label, drive_date FROM he_drive WHERE id = ? AND source_kind <> 'pool' LIMIT 1", [i.originId]);
  if (!d[0]) return notFound;
  return { ok: true, label: d[0].run_label ? String(d[0].run_label) : `Re-run ${day10(d[0].drive_date)}` };
}

export async function tryChangeStream(id: string, c: StreamChangeInput, a: StreamActor, now: Date = new Date()): Promise<{ ok: true; changed: boolean; stream: StreamView } | StreamFail> {
  try {
    const today = istToday(now);
    if (!c || !ACTIONS.includes(c.action)) return fail("invalid", 400, "Unknown action");
    const bad = validReason(c.reason);
    if (bad) return bad;
    const s = await loadStream(id);
    if (!s || !inScope(s.branchName, a.scope)) return fail("not_found", 404, MSG_NOT_FOUND);

    const unchanged = async (): Promise<{ ok: true; changed: false; stream: StreamView }> => ({ ok: true, changed: false, stream: toView(s, today, await warningsFor(s)) });
    const act = c.action;
    const notAllowed = fail("conflict", 409, `Not allowed while the stream is ${s.status}`);
    if (act === "open" && s.status !== "draft" && s.status !== "paused") return notAllowed;
    if (act === "pause" && s.status !== "open") return notAllowed;
    if (act === "close" && s.status === "closed") return notAllowed;
    if (act === "reopen" && s.status !== "closed") return notAllowed;
    if (WINDOW_ACTIONS.includes(act) && s.status === "closed") return fail("conflict", 409, "Reopen the stream first");

    let w = toWindow(s);
    let newStatus: StreamStatus = s.status;
    let closedReason: string | null = s.closedReason;
    let prefix = "";
    const winChange: WindowChange | null = windowChangeOf(c);

    if (act === "reopen") {
      const [rq] = await db.execute<RowDataPacket[]>("SELECT approval_status, active_status, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1", [s.requisitionId]);
      const r = rq[0];
      if (!r || r.approval_status !== "approved" || !r.active_status || !(Number(r.fulfilled_headcount) < Number(r.requested_headcount))) return fail("conflict", 409, "A filled or closed requisition cannot be reopened");
    }
    if (winChange) {
      const res = applyWindowChange(w, winChange, today);
      if (!res.ok) {
        if (res.error === "no_change" && act !== "reopen") return await unchanged();
        if (res.error === "before_today" && act === "reopen") return fail("conflict", 409, "Extend the window when reopening");
        if (res.error !== "no_change") return fail("invalid", 400, res.message);
      } else w = prune(res.next);
    }
    if (act === "reopen" && windowEnd(w) < today) return fail("conflict", 409, "Extend the window when reopening");
    if (act === "open" || act === "reopen") {
      const r = await checkReadiness(s.requisitionId, s.sourceType, c.override === true, a);
      if (!r.ok) return r;
      prefix = r.prefix;
      newStatus = "open";
      closedReason = null;
    } else if (act === "pause") newStatus = "paused";
    else if (act === "close") { newStatus = "closed"; closedReason = "manual"; }

    const exceptionsChanged = !sameList(w.add, s.add) || !sameList(w.skip, s.skip);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [u] = await conn.execute<ResultSetHeader>(
        "UPDATE requisition_stream SET status = ?, closed_reason = ?, open_days = ? WHERE id = ? AND status = ? AND open_from = ? AND open_days = ?",
        [newStatus, closedReason, w.openDays, s.id, s.status, s.openFrom, s.openDays]);
      if (!u.affectedRows) { await rollbackQuietly(conn); return fail("changed_meanwhile", 409, MSG_CHANGED); }
      if (exceptionsChanged) await writeExceptions(conn, s.id, w);
      await insertEvent(conn, s.id, a.userId, {
        action: act, oldStatus: s.status, newStatus, oldOpenFrom: s.openFrom, oldOpenDays: s.openDays, newOpenDays: w.openDays,
        day: act === "add_day" || act === "skip_day" ? c.day ?? null : null, reason: prefix + (c.reason ?? "") || null,
      });
      await conn.commit();
    } catch (err) {
      await rollbackQuietly(conn);
      throw err;
    } finally {
      conn.release();
    }
    const next: StreamRow = { ...s, status: newStatus, closedReason, openDays: w.openDays, add: w.add, skip: w.skip };
    return { ok: true, changed: true, stream: toView(next, today, await warningsFor(next)) };
  } catch (err) {
    logFail("change", err);
    return fail("error", 500, "Could not change the stream");
  }
}

/** The window change an action asks for; a reopen with days / toDate extends first. */
function windowChangeOf(c: StreamChangeInput): WindowChange | null {
  switch (c.action) {
    case "extend": return { kind: "extend", days: c.days as number };
    case "extend_to": return { kind: "extend_to", date: c.toDate as string };
    case "shorten": return { kind: "shorten", date: c.toDate as string };
    case "add_day": return { kind: "add_day", day: c.day as string };
    case "skip_day": return { kind: "skip_day", day: c.day as string };
    case "reopen":
      if (c.days != null) return { kind: "extend", days: c.days };
      if (c.toDate != null) return { kind: "extend_to", date: c.toDate };
      return null;
    default: return null;
  }
}

function unwrap<T extends { ok: true }>(r: T | StreamFail): T {
  if (r.ok) return r;
  if (r.statusCode === 500) throw new Error(r.message);
  throw new StreamError(r.message, r.statusCode, r.problems);
}

export async function createStream(i: CreateStreamInput, a: StreamActor, now?: Date): Promise<StreamView> {
  return unwrap(await tryCreateStream(i, a, now)).stream;
}

export async function changeStream(id: string, c: StreamChangeInput, a: StreamActor, now?: Date): Promise<{ changed: boolean; stream: StreamView }> {
  const r = unwrap(await tryChangeStream(id, c, a, now));
  return { changed: r.changed, stream: r.stream };
}

export async function listStreams(requisitionId: string, scope: BranchScope, now: Date = new Date()): Promise<StreamView[]> {
  const today = istToday(now);
  const [rows] = scope.all
    ? await db.execute<RowDataPacket[]>("SELECT * FROM requisition_stream WHERE requisition_id = ? ORDER BY created_at, id", [requisitionId])
    : scope.branchName
      ? await db.execute<RowDataPacket[]>("SELECT * FROM requisition_stream WHERE requisition_id = ? AND branch_name = ? ORDER BY created_at, id", [requisitionId, scope.branchName])
      : [[] as RowDataPacket[]];
  const streams = await attachDays(rows);
  if (!streams.some((s) => s.status === "open" || s.status === "paused")) return streams.map((s) => toView(s, today, []));
  let problems: ReadinessProblem[] = [];
  try { problems = (await getRequisitionReadiness(requisitionId, "meta_live"))?.problems ?? []; } catch (err) { logFail("readiness", err); }
  // one readiness read per requisition: the BookMyInterview link only matters for the meta sources
  return streams.map((s) => toView(s, today, s.sourceType === "he" ? problems.filter((p) => p.code !== "no_bmi_link") : problems));
}

export async function getStream(id: string, scope: BranchScope, now: Date = new Date()): Promise<StreamView | null> {
  const s = await loadStream(id);
  if (!s || !inScope(s.branchName, scope)) return null;
  return toView(s, istToday(now), await warningsFor(s));
}

export async function listStreamEvents(id: string, scope: BranchScope): Promise<StreamEvent[] | null> {
  const [s] = await db.execute<RowDataPacket[]>("SELECT branch_name FROM requisition_stream WHERE id = ? LIMIT 1", [id]);
  if (!s[0] || !inScope(String(s[0].branch_name), scope)) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, action, changed_by, changed_at, old_open_from, old_open_days, new_open_days, old_status, new_status, day, reason
       FROM requisition_stream_event WHERE stream_id = ? ORDER BY changed_at DESC, id`, [id]);
  const str = (v: unknown): string | null => (v == null ? null : String(v));
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return rows.map((r) => ({
    id: String(r.id), action: r.action as StreamAction, changedBy: str(r.changed_by), changedAt: String(r.changed_at),
    oldOpenFrom: r.old_open_from == null ? null : day10(r.old_open_from), oldOpenDays: num(r.old_open_days), newOpenDays: num(r.new_open_days),
    oldStatus: str(r.old_status), newStatus: str(r.new_status), day: r.day == null ? null : day10(r.day), reason: str(r.reason),
  }));
}

/** Open and paused streams with their exception days, in creation order (earlier streams line up first). */
export async function loadActiveStreams(o: { requisitionId?: string } = {}): Promise<StreamRow[]> {
  const [rows] = o.requisitionId
    ? await db.execute<RowDataPacket[]>("SELECT * FROM requisition_stream WHERE status IN ('open','paused') AND requisition_id = ? ORDER BY created_at, id", [o.requisitionId])
    : await db.execute<RowDataPacket[]>("SELECT * FROM requisition_stream WHERE status IN ('open','paused') ORDER BY created_at, id");
  return attachDays(rows);
}

/** Closes open / paused streams whose window ended or whose requisition is filled or closed. Never throws (tick path). */
export async function autoCloseStreams(date: string, dryRun: boolean): Promise<Array<{ streamId: string; requisitionId: string; reason: AutoCloseReason }>> {
  const out: Array<{ streamId: string; requisitionId: string; reason: AutoCloseReason }> = [];
  let rows: RowDataPacket[];
  try {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT s.*, jr.approval_status, jr.active_status, jr.requested_headcount, jr.fulfilled_headcount, jr.id AS jr_id
         FROM requisition_stream s
         LEFT JOIN job_requisition jr ON jr.id = s.requisition_id COLLATE utf8mb4_unicode_ci
        WHERE s.status IN ('open','paused') ORDER BY s.created_at, s.id`);
    rows = r;
  } catch (err) {
    logFail("auto-close select", err);
    return out;
  }
  let streams: StreamRow[];
  try { streams = await attachDays(rows); } catch (err) { logFail("auto-close days", err); return out; }
  for (let n = 0; n < streams.length; n++) {
    const s = streams[n], r = rows[n];
    let reason: AutoCloseReason | null = null;
    if (r.jr_id == null || r.approval_status !== "approved" || !r.active_status) reason = "requisition_closed";
    else if (Number(r.fulfilled_headcount) >= Number(r.requested_headcount)) reason = "requisition_filled";
    else if (windowEnd(toWindow(s)) < date) reason = "window_ended";
    if (!reason) continue;
    if (dryRun) { out.push({ streamId: s.id, requisitionId: s.requisitionId, reason }); continue; }
    let conn: Awaited<ReturnType<typeof db.getConnection>> | null = null;
    try {
      conn = await db.getConnection();
      await conn.beginTransaction();
      const [u] = await conn.execute<ResultSetHeader>("UPDATE requisition_stream SET status = 'closed', closed_reason = ? WHERE id = ? AND status IN ('open','paused')", [reason, s.id]);
      if (!u.affectedRows) { await rollbackQuietly(conn); continue; }
      await insertEvent(conn, s.id, null, { action: "auto_close", oldStatus: s.status, newStatus: "closed", oldOpenFrom: s.openFrom, oldOpenDays: s.openDays, newOpenDays: s.openDays, day: null, reason });
      await conn.commit();
      out.push({ streamId: s.id, requisitionId: s.requisitionId, reason });
    } catch (err) {
      if (conn) await rollbackQuietly(conn);
      logFail("auto-close", err);
    } finally {
      conn?.release();
    }
  }
  return out;
}
