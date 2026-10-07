/**
 * D-1 stream pass: for every requisition that owns an open stream covering a day, create (or reuse) that day's one drive and line up
 * each stream up to its cap, crediting every new match to the stream that touched it first (INSERT IGNORE on the match id).
 * Runs from planNextDay (evening), "Plan now" and the engine's 5-minute top-up. Never throws: every requisition and every stream is
 * wrapped, and failures come back as reasons. Each requisition is planned under a MySQL advisory lock so two passes never overlap.
 * Logs carry ids and error codes only, never candidate data.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { createDrive, lineUpCandidates, setDriveStatus, type AudienceSpec } from "./he-drive.service.js";
import { bridgeMetaLeads } from "./he-meta-bridge.service.js";
import { getDailyPlan } from "./he-policy.service.js";
import { dailyPlanNumbers, type DailyPlan } from "./he-slots.js";
import type { SourceType } from "./qualified-followup.types.js";
import { autoCloseStreams, loadActiveStreams, toWindow, type AutoCloseReason, type StreamRow } from "./requisition-stream.service.js";
import { coversDay, istToday } from "./requisition-stream.window.js";

export interface StreamLine { streamId: string; sourceType: SourceType; originLabel: string; cap: number; alreadyLined: number; lined: number; wouldLine?: number; skipped?: string }
export interface StreamDayPlan {
  requisitionId: string; code: string; branch: string; date: string; driveId: string | null;
  drive: "created" | "exists" | "would_create" | "skipped"; reason?: string; streams: StreamLine[];
}
export interface StreamPassResult { plans: StreamDayPlan[]; closed: Array<{ streamId: string; requisitionId: string; reason: AutoCloseReason }>; failed?: string }

const day10 = (v: unknown): string => String(v).slice(0, 10);
/** Error text for results: trimmed, long digit runs masked (a driver message can echo values). */
const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/\d{6,}/g, "#").slice(0, 160);
const codeOf = (err: unknown): string => { const e = err as { code?: string; name?: string }; return e?.code ?? e?.name ?? "error"; };

/** A stream's cap is its daily_invites; streams without one share the plan default equally (rounded up, at least 1). */
export function streamCaps(streams: Array<{ id: string; dailyInvites: number | null }>, planInvites: number): Map<string, number> {
  const shared = streams.filter((s) => s.dailyInvites == null).length;
  const share = shared ? Math.max(1, Math.ceil(planInvites / shared)) : 0;
  return new Map(streams.map((s) => [s.id, s.dailyInvites ?? share]));
}

/** null when the stream tables could not be read (the caller decides how to fail). */
export async function readStreamOwned(): Promise<Set<string> | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT DISTINCT requisition_id FROM requisition_stream WHERE status IN ('open','paused')");
    return new Set(rows.map((r) => String(r.requisition_id)));
  } catch (err) {
    logger.warn({ code: codeOf(err) }, "[he-streams] could not read stream-owned requisitions");
    return null;
  }
}

/** Requisitions with an open or paused stream (planned only by their streams). Empty set on any error. */
export async function streamOwnedRequisitions(): Promise<Set<string>> {
  return (await readStreamOwned()) ?? new Set();
}

/** The audience a stream lines up from; null when a meta_old origin launch no longer exists. */
export async function streamAudience(s: StreamRow): Promise<AudienceSpec | null> {
  if (s.sourceType === "meta_live") return { source_kind: "campaign", source_ids: [s.originId], max_lead_age_days: null };
  if (s.sourceType === "he") return { source_kind: "pool", source_ids: null, max_lead_age_days: null };
  const [d] = await db.execute<RowDataPacket[]>("SELECT source_kind, source_ids, max_lead_age_days FROM he_drive WHERE id = ? AND source_kind <> 'pool' LIMIT 1", [s.originId]);
  if (!d[0]) return null;
  return { source_kind: String(d[0].source_kind), source_ids: d[0].source_ids, max_lead_age_days: d[0].max_lead_age_days == null ? null : Number(d[0].max_lead_age_days) };
}

type Conn = Awaited<ReturnType<typeof db.getConnection>>;

/** Runs fn under GET_LOCK(name, 0) on a dedicated connection; null when the lock is busy. The lock is always released. */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  let conn: Conn | null = await db.getConnection();
  let got = false;
  try {
    const [l] = await conn.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [name]);
    got = Number(l[0]?.got) === 1;
    if (!got) return null;
    return await fn();
  } finally {
    if (got) {
      try { await conn.execute("SELECT RELEASE_LOCK(?) AS released", [name]); }
      catch (err) {
        // a connection that may still hold the lock must not go back to the pool: closing it frees the lock
        logger.warn({ lock: name, code: codeOf(err) }, "[he-streams] lock release failed; dropping the connection");
        try { conn.destroy(); } catch { /* already gone */ }
        conn = null;
      }
    }
    conn?.release();
  }
}

async function markPlanned(streamId: string, date: string, driveId: string, lined: number): Promise<void> {
  await db.execute(
    `INSERT INTO requisition_stream_plan (stream_id, drive_date, drive_id, lined) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE drive_id = VALUES(drive_id), lined = VALUES(lined)`, [streamId, date, driveId, lined]);
}

interface Ctx { date: string; dryRun: boolean; mayCreate: boolean; plan: DailyPlan; invites: number; perSlot: number }

async function lineStream(s: StreamRow, cap: number, driveId: string | null, c: Ctx): Promise<StreamLine> {
  const line: StreamLine = { streamId: s.id, sourceType: s.sourceType, originLabel: s.originLabel, cap, alreadyLined: 0, lined: 0 };
  try {
    if (driveId) {
      const [n] = await db.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM requisition_stream_match sm JOIN he_match m ON m.id = sm.match_id WHERE sm.stream_id = ? AND m.drive_id = ?", [s.id, driveId]);
      line.alreadyLined = Number(n[0]?.n ?? 0);
    }
    const want = cap - line.alreadyLined;
    if (c.dryRun) { line.wouldLine = Math.max(0, want); return line; }
    if (want <= 0 || !driveId) return line;
    const audience = await streamAudience(s);
    if (!audience) { line.skipped = "origin launch not found"; return line; }
    if (s.sourceType === "meta_live") {
      try { await bridgeMetaLeads({ campaignIds: [s.originId], onlyUnlinked: true }); }
      catch (err) { logger.warn({ streamId: s.id, code: codeOf(err) }, "[he-streams] campaign bridge failed; lining up from what is linked"); }
    }
    const r = await lineUpCandidates(driveId, {
      limit: want, audience, excludeOnDrive: true, keepOtherSuggestions: true,
      followupStream: { streamId: s.id, sourceType: s.sourceType, originId: s.originId, originLabel: s.originLabel },
    });
    if (r.leadIds.length) {
      // first touch: a match another stream already credited keeps that credit
      const [ins] = await db.execute<ResultSetHeader>(
        `INSERT IGNORE INTO requisition_stream_match (match_id, stream_id, drive_id)
         SELECT m.id, ?, ? FROM he_match m WHERE m.drive_id = ? AND m.lead_id IN (${r.leadIds.map(() => "?").join(",")})`,
        [s.id, driveId, driveId, ...r.leadIds]);
      line.lined = ins.affectedRows;
    }
    await markPlanned(s.id, c.date, driveId, line.alreadyLined + line.lined);
  } catch (err) {
    line.skipped = reasonOf(err);
    logger.warn({ streamId: s.id, code: codeOf(err) }, "[he-streams] stream line-up failed");
  }
  return line;
}

async function planRequisition(requisitionId: string, streams: StreamRow[], c: Ctx): Promise<StreamDayPlan> {
  const branch = streams[0].branchName;
  const base: StreamDayPlan = { requisitionId, code: requisitionId, branch, date: c.date, driveId: null, drive: "skipped", streams: [] };
  const [rq] = await db.execute<RowDataPacket[]>(
    "SELECT id, requisition_code, approval_status, active_status, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  const r = rq[0];
  if (r?.requisition_code) base.code = String(r.requisition_code);
  if (!r || r.approval_status !== "approved" || !r.active_status || Number(r.fulfilled_headcount) >= Number(r.requested_headcount)) return { ...base, reason: "requisition is closed or filled" };
  const caps = streamCaps(streams, c.invites);

  const work = async (): Promise<StreamDayPlan> => {
    const [ex] = await db.execute<RowDataPacket[]>("SELECT id, status FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?", [requisitionId, branch, c.date]);
    let driveId: string | null = ex[0] ? String(ex[0].id) : null;
    let drive: StreamDayPlan["drive"];
    if (ex[0]?.status === "closed") return { ...base, driveId, reason: "the drive for this day was closed" };
    if (driveId) drive = "exists";
    else if (c.dryRun) drive = "would_create";
    else if (c.mayCreate === false) return { ...base, reason: "no drive" };
    else {
      const sum = [...caps.values()].reduce((a, b) => a + b, 0);
      const d = await createDrive({
        requisitionId, driveDate: c.date, slotStart: c.plan.slotStart, slotEnd: c.plan.slotEnd, slotMinutes: c.plan.slotMinutes, slotCapacity: c.perSlot,
        showRatePct: c.plan.showRatePct, targetShows: Math.max(1, Math.round((sum * c.plan.showRatePct) / 100)), autoSend: true, audience: { kind: "pool", label: "Streams" },
      });
      driveId = d.id;
      // Marked stream-fed BEFORE it goes active: the engine never re-lines an unmarked "Streams" drive from the whole pool.
      for (const s of streams) await markPlanned(s.id, c.date, driveId, 0);
      await setDriveStatus(driveId, "active");
      drive = "created";
    }
    const lines: StreamLine[] = [];
    for (const s of streams) lines.push(await lineStream(s, caps.get(s.id) ?? 1, driveId, c));
    return { ...base, driveId, drive, streams: lines };
  };

  if (c.dryRun) return work();
  const res = await withLock(`he_stream_plan:${requisitionId}`, work);
  return res ?? { ...base, reason: "planning already running" };
}

/** Plans one day for every requisition with an open stream covering it (or only `requisitionId`). Never throws. */
export async function planStreamsForDay(o: { date: string; dryRun: boolean; requisitionId?: string; mayCreate?: boolean }): Promise<StreamPassResult> {
  const out: StreamPassResult = { plans: [], closed: [] };
  try {
    // Closed as of TODAY: a stream still running today must not be closed because a later day is being planned.
    out.closed = await autoCloseStreams(istToday(), o.dryRun);
    const closing = new Set(out.closed.map((x) => x.streamId));
    const active = await loadActiveStreams(o.requisitionId ? { requisitionId: o.requisitionId } : {});
    const due = active.filter((s) => s.status === "open" && !closing.has(s.id) && coversDay(toWindow(s), o.date));
    if (!due.length) return out;
    const plan = await getDailyPlan();
    const n = dailyPlanNumbers(plan);
    const byReq = new Map<string, StreamRow[]>();
    for (const s of due) byReq.set(s.requisitionId, [...(byReq.get(s.requisitionId) ?? []), s]);
    const c: Ctx = { date: o.date, dryRun: o.dryRun, mayCreate: o.mayCreate !== false, plan, invites: n.invites, perSlot: n.perSlot };
    for (const [requisitionId, streams] of byReq) {
      try { out.plans.push(await planRequisition(requisitionId, streams, c)); }
      catch (err) {
        logger.warn({ requisitionId, date: o.date, code: codeOf(err) }, "[he-streams] requisition plan failed");
        out.plans.push({ requisitionId, code: requisitionId, branch: streams[0].branchName, date: o.date, driveId: null, drive: "skipped", reason: reasonOf(err), streams: [] });
      }
    }
  } catch (err) {
    logger.warn({ date: o.date, code: codeOf(err) }, "[he-streams] stream pass failed");
    out.failed = reasonOf(err);
  }
  return out;
}

/**
 * Drives a stream planned (a requisition_stream_plan row). No query for an empty list. Fails closed on a read error (every drive
 * is treated as stream-fed, so none is re-lined from its own pool audience this tick) except when the table does not exist yet.
 */
export async function streamDriveIds(driveIds: string[]): Promise<Set<string>> {
  if (!driveIds.length) return new Set();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT drive_id FROM requisition_stream_plan WHERE drive_id IN (${driveIds.map(() => "?").join(",")})`, driveIds);
    return new Set(rows.map((r) => String(r.drive_id)));
  } catch (err) {
    logger.warn({ code: codeOf(err) }, "[he-streams] could not read stream-fed drives");
    return codeOf(err) === "ER_NO_SUCH_TABLE" ? new Set() : new Set(driveIds);
  }
}

/** The 5-minute re-line-up of a stream-fed drive: each open stream covering its day is topped up to its cap. Never throws. */
export async function topUpStreamDrive(driveId: string): Promise<number> {
  try {
    const [d] = await db.execute<RowDataPacket[]>("SELECT id, requisition_id, drive_date, status FROM he_drive WHERE id = ? LIMIT 1", [driveId]);
    if (!d[0] || d[0].status === "closed") return 0;
    const date = day10(d[0].drive_date);
    if (date < istToday()) return 0;
    const requisitionId = String(d[0].requisition_id);
    const streams = await loadActiveStreams({ requisitionId });
    if (!streams.some((s) => s.status === "open" && coversDay(toWindow(s), date))) return 0;
    const r = await planStreamsForDay({ date, requisitionId, dryRun: false, mayCreate: false });
    return r.plans.reduce((a, p) => a + p.streams.reduce((b, l) => b + l.lined, 0), 0);
  } catch (err) {
    logger.warn({ driveId, code: codeOf(err) }, "[he-streams] top-up failed");
    return 0;
  }
}
