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
import { coversDay, istToday, windowEnd } from "./requisition-stream.window.js";
import { enqueueMatchedFollowups } from "./qualified-followup.service.js";
import { followupMode } from "./qualified-followup.schedule.js";

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

/**
 * Requisitions with an open or paused stream; with `date`, only those with such a stream whose window has not ended before that date (a
 * stream that ended yesterday no longer holds the requisition back from the legacy plan). Empty set when the table does not exist yet;
 * null on any other read error (the caller decides how to fail).
 */
export async function readStreamOwned(date?: string): Promise<Set<string> | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT DISTINCT requisition_id FROM requisition_stream WHERE status IN ('open','paused')");
    const owned = new Set(rows.map((r) => String(r.requisition_id)));
    if (!date || !owned.size) return owned;
    const active = await loadActiveStreams();
    const running = new Set(active.filter((s) => windowEnd(toWindow(s)) >= date).map((s) => s.requisitionId));
    const ended = new Set(active.filter((s) => windowEnd(toWindow(s)) < date).map((s) => s.requisitionId));
    // a requisition the second read no longer lists (closed meanwhile) keeps the first read's answer
    return new Set([...owned].filter((r) => running.has(r) || !ended.has(r)));
  } catch (err) {
    logger.warn({ code: codeOf(err) }, "[he-streams] could not read stream-owned requisitions");
    return codeOf(err) === "ER_NO_SUCH_TABLE" ? new Set() : null;
  }
}

/**
 * Requisitions a stream already planned for `date` (they keep their stream drive even after their streams closed). Empty set when the
 * table does not exist yet; null on any other read error.
 */
export async function readStreamPlanned(date: string): Promise<Set<string> | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT DISTINCT s.requisition_id FROM requisition_stream_plan p JOIN requisition_stream s ON s.id = p.stream_id WHERE p.drive_date = ?", [date]);
    return new Set(rows.map((r) => String(r.requisition_id)));
  } catch (err) {
    logger.warn({ code: codeOf(err) }, "[he-streams] could not read planned stream days");
    return codeOf(err) === "ER_NO_SUCH_TABLE" ? new Set() : null;
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

interface DriveRef { id: string; requisitionId: string; sourceKind: string; runLabel: string | null }

/** People credited to this stream for this drive (re-counted, never taken from affectedRows). */
async function creditedCount(streamId: string, driveId: string): Promise<number> {
  const [n] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM requisition_stream_match sm JOIN he_match m ON m.id = sm.match_id WHERE sm.stream_id = ? AND sm.drive_id = ? AND m.drive_id = ?", [streamId, driveId, driveId]);
  return Number(n[0]?.n ?? 0);
}

/**
 * Follow-up records lost earlier (a failed enqueue, a restart during the fire-and-forget): people this stream put on the drive who have
 * no qualified_followup row are enqueued again. Runs before the line-up, so it never races that line-up's own enqueue. Idempotent.
 */
async function healFollowups(s: StreamRow, drive: DriveRef, date: string): Promise<void> {
  if (followupMode() === "off") return;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.lead_id FROM requisition_stream_match sm JOIN he_match m ON m.id = sm.match_id JOIN he_lead l ON l.id = m.lead_id
        WHERE sm.stream_id = ? AND sm.drive_id = ? AND m.drive_id = ?
          AND NOT EXISTS (SELECT 1 FROM qualified_followup qf WHERE qf.mobile10 = l.mobile10 AND qf.requisition_id = m.requisition_id) LIMIT 500`,
      [s.id, drive.id, drive.id]);
    if (!rows.length) return;
    await enqueueMatchedFollowups({ id: drive.id, requisitionId: drive.requisitionId, sourceKind: drive.sourceKind, runLabel: drive.runLabel, driveDate: date },
      rows.map((r) => String(r.lead_id)), { streamId: s.id, sourceType: s.sourceType, originId: s.originId, originLabel: s.originLabel });
  } catch (err) {
    logger.warn({ streamId: s.id, code: codeOf(err) }, "[he-streams] follow-up heal failed");
  }
}

async function lineStream(s: StreamRow, cap: number, drive: DriveRef | null, c: Ctx): Promise<StreamLine> {
  const line: StreamLine = { streamId: s.id, sourceType: s.sourceType, originLabel: s.originLabel, cap, alreadyLined: 0, lined: 0 };
  const driveId = drive?.id ?? null;
  try {
    if (driveId) line.alreadyLined = await creditedCount(s.id, driveId);
    const want = cap - line.alreadyLined;
    if (c.dryRun) { line.wouldLine = Math.max(0, want); return line; }
    if (!drive || !driveId) return line;
    await healFollowups(s, drive, c.date);
    if (want <= 0) return line;
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
      // Credit per drive. On the SAME drive the first stream keeps the person (first touch for that day); a match re-pointed here from
      // an earlier drive is credited to the stream that lined it today, so it counts toward that stream's cap.
      await db.execute<ResultSetHeader>(
        `INSERT INTO requisition_stream_match (match_id, stream_id, drive_id)
         SELECT m.id, ?, ? FROM he_match m WHERE m.drive_id = ? AND m.lead_id IN (${r.leadIds.map(() => "?").join(",")})
         ON DUPLICATE KEY UPDATE
           stream_id = IF(requisition_stream_match.drive_id <=> VALUES(drive_id), requisition_stream_match.stream_id, VALUES(stream_id)),
           drive_id = VALUES(drive_id)`,
        [s.id, driveId, driveId, ...r.leadIds]);
      line.lined = Math.max(0, (await creditedCount(s.id, driveId)) - line.alreadyLined);
    }
    await markPlanned(s.id, c.date, driveId, line.alreadyLined + line.lined);
  } catch (err) {
    line.skipped = reasonOf(err);
    logger.warn({ streamId: s.id, code: codeOf(err) }, "[he-streams] stream line-up failed");
  }
  return line;
}

/** A draft the stream pass itself created (label "Streams", pool audience, no creator) and stream-fed: safe to activate. */
const ownStreamsDraft = (d: RowDataPacket): boolean => d.status === "draft" && d.run_label === "Streams" && d.source_kind === "pool" && d.created_by == null;

async function planRequisition(requisitionId: string, streams: StreamRow[], c: Ctx): Promise<StreamDayPlan> {
  const base: StreamDayPlan = { requisitionId, code: requisitionId, branch: streams[0].branchName, date: c.date, driveId: null, drive: "skipped", streams: [] };
  const [rq] = await db.execute<RowDataPacket[]>(
    "SELECT id, requisition_code, branch_name, approval_status, active_status, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  const r = rq[0];
  if (r?.requisition_code) base.code = String(r.requisition_code);
  if (!r || r.approval_status !== "approved" || !r.active_status || Number(r.fulfilled_headcount) >= Number(r.requested_headcount)) return { ...base, reason: "requisition is closed or filled" };
  // the requisition's CURRENT branch: the same key createDrive writes, so a closed drive is always found (and never reopened)
  const branch = String(r.branch_name ?? base.branch);
  base.branch = branch;
  const caps = streamCaps(streams, c.invites);

  const work = async (): Promise<StreamDayPlan> => {
    const [ex] = await db.execute<RowDataPacket[]>(
      "SELECT id, status, run_label, source_kind, created_by FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?", [requisitionId, branch, c.date]);
    let row: RowDataPacket | undefined = ex[0];
    let drive: StreamDayPlan["drive"];
    if (row?.status === "closed") return { ...base, driveId: String(row.id), reason: "the drive for this day was closed" };
    if (row) drive = "exists";
    else if (c.dryRun) drive = "would_create";
    else if (c.mayCreate === false) return { ...base, reason: "no drive" };
    else {
      const sum = [...caps.values()].reduce((a, b) => a + b, 0);
      const d = await createDrive({
        requisitionId, driveDate: c.date, slotStart: c.plan.slotStart, slotEnd: c.plan.slotEnd, slotMinutes: c.plan.slotMinutes, slotCapacity: c.perSlot,
        showRatePct: c.plan.showRatePct, targetShows: Math.max(1, Math.round((sum * c.plan.showRatePct) / 100)), autoSend: true, audience: { kind: "pool", label: "Streams" },
      });
      const [after] = await db.execute<RowDataPacket[]>("SELECT status, run_label, source_kind, created_by FROM he_drive WHERE id = ?", [d.id]);
      row = { ...(after[0] ?? {}), id: d.id } as RowDataPacket;
      if (row.status === "closed") return { ...base, driveId: d.id, reason: "the drive for this day was closed" };
      if (!ownStreamsDraft(row)) drive = "exists"; // a drive someone else made or controls meanwhile: reused, never activated here
      else {
        try {
          // Marked stream-fed BEFORE it goes active: the engine never re-lines an unmarked "Streams" drive from the whole pool.
          for (const s of streams) await markPlanned(s.id, c.date, d.id, 0);
          await setDriveStatus(d.id, "active");
        } catch (err) {
          logger.warn({ requisitionId, code: codeOf(err) }, "[he-streams] drive created but not activated");
          return { ...base, driveId: d.id, drive: "created", reason: `drive created but not activated: ${reasonOf(err)}` };
        }
        drive = "created";
      }
    }
    const driveId = row ? String(row.id) : null;
    const ref: DriveRef | null = row && driveId ? { id: driveId, requisitionId, sourceKind: String(row.source_kind ?? "pool"), runLabel: row.run_label == null ? null : String(row.run_label) } : null;
    const lines: StreamLine[] = [];
    for (const s of streams) lines.push(await lineStream(s, caps.get(s.id) ?? 1, ref, c));
    // A Streams draft left behind by a failed activation is activated once it is stream-fed (never a drive HR created).
    if (!c.dryRun && drive === "exists" && row && driveId && ownStreamsDraft(row)) {
      const [fed] = await db.execute<RowDataPacket[]>("SELECT 1 AS hit FROM requisition_stream_plan WHERE drive_id = ? LIMIT 1", [driveId]);
      if (fed.length) await setDriveStatus(driveId, "active");
    }
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
