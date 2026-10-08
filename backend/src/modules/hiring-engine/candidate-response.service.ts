/**
 * The response ledger: one candidate_response row per inbound event (a tap, a message, a call result, an import row, an HR action),
 * idempotent on (source_kind, source_ref) so provider retries and re-imports never add a second row. The context (requisition, drive,
 * slot, branch, campaign, drive type) is resolved once here and stored: the match, else the invite, else the match activeMatch would pick,
 * else the person's Meta form fill. The first confirming response stamps he_match.confirmed_* (one "confirmed to attend" truth); later
 * confirms point at it with dedupe_of; a decline / another time after a confirm is flagged as a conflict.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { attributionJoinsSql, fillTypeSql, sourceTypeSql } from "./he-source-attribution.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import { statusFor, type ResponseAnswer, type ResponseChannel, type ResponseMode, type ResponseStatus } from "./response-normalise.js";
import { loadResponseSwitches } from "./responses.policy.js";

export interface ResponseInput {
  occurredAt: Date; channel: ResponseChannel; mode: ResponseMode; answer: ResponseAnswer;
  suggested?: { answer: ResponseAnswer; confidence: number } | null;
  mobile10: string; leadId?: string | null; metaLeadId?: string | null; matchId?: string | null; inviteId?: string | null; followupId?: string | null;
  sourceKind: string; sourceRef: string; rawText?: string | null; handledBy?: string; applied: boolean;
  /** Overrides the derived status (e.g. needs_review for a reply HR must look at even though its words are clear). */
  status?: ResponseStatus;
}
export interface RecordResult { id: number; created: boolean; dedupeOf: number | null; conflict: boolean }

interface Ctx {
  leadId: string | null; metaLeadId: string | null; matchId: string | null; inviteId: string | null; followupId: string | null;
  requisitionId: string | null; campaignId: string | null; driveId: string | null; driveType: string | null; slotAt: string | null; branchName: string | null;
  confirmedResponseId: number | null;
}
type Exec = { execute: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<[T, unknown]> };

const NONE: RecordResult = { id: 0, created: false, dedupeOf: null, conflict: false };
const istStamp = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY" || (e as { errno?: number })?.errno === 1062;
const str = (v: unknown) => (v == null ? null : String(v));

async function matchCtx(matchId: string, liveFrom: string): Promise<Ctx | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.drive_id, m.slot_at, m.confirmed_response_id, jr.branch_name, al.meta_lead_id, alf.campaign_id,
            ${sourceTypeSql({ streams: true, d: "d", lead: "al", ref: "COALESCE(d.drive_date, m.created_at)", liveFrom })} AS drive_type
       FROM he_match m LEFT JOIN he_drive d ON d.id = m.drive_id LEFT JOIN job_requisition jr ON jr.id = m.requisition_id
       ${attributionJoinsSql({ streams: true, match: "m", requisition: "m.requisition_id", lead: "al", leadId: "m.lead_id" })}
      WHERE m.id = ? LIMIT 1`, [matchId]);
  const r = rows[0];
  if (!r) return null;
  return {
    leadId: str(r.lead_id), metaLeadId: str(r.meta_lead_id), matchId: String(r.id), inviteId: null, followupId: null, requisitionId: str(r.requisition_id),
    campaignId: str(r.campaign_id), driveId: str(r.drive_id), driveType: str(r.drive_type), slotAt: str(r.slot_at), branchName: str(r.branch_name),
    confirmedResponseId: r.confirmed_response_id == null ? null : Number(r.confirmed_response_id),
  };
}

async function resolveContext(i: ResponseInput): Promise<Ctx> {
  const liveFrom = await loadLiveFrom();
  const empty: Ctx = { leadId: i.leadId ?? null, metaLeadId: i.metaLeadId ?? null, matchId: null, inviteId: i.inviteId ?? null, followupId: i.followupId ?? null,
    requisitionId: null, campaignId: null, driveId: null, driveType: null, slotAt: null, branchName: null, confirmedResponseId: null };
  const withIds = (c: Ctx): Ctx => ({ ...c, inviteId: i.inviteId ?? c.inviteId, followupId: i.followupId ?? c.followupId, metaLeadId: c.metaLeadId ?? i.metaLeadId ?? null, leadId: c.leadId ?? i.leadId ?? null });
  if (i.matchId) { const c = await matchCtx(i.matchId, liveFrom); if (c) return withIds(c); }
  if (i.inviteId) {
    const [w] = await db.execute<RowDataPacket[]>("SELECT * FROM walkin_invite WHERE id = ? LIMIT 1", [i.inviteId]);
    const v = w[0];
    if (v?.match_id) { const c = await matchCtx(String(v.match_id), liveFrom); if (c) return withIds(c); }
    if (v) return withIds({ ...empty, leadId: str(v.lead_id), metaLeadId: str(v.meta_lead_id), followupId: str(v.followup_id), requisitionId: str(v.requisition_id),
      campaignId: str(v.campaign_id), driveType: str(v.drive_type), slotAt: str(v.slot_at), branchName: str(v.branch_name) });
  }
  const [l] = i.leadId
    ? await db.execute<RowDataPacket[]>("SELECT id, meta_lead_id FROM he_lead WHERE id = ? LIMIT 1", [i.leadId])
    : await db.execute<RowDataPacket[]>("SELECT id, meta_lead_id FROM he_lead WHERE mobile10 = ? LIMIT 1", [i.mobile10]);
  const lead = l[0];
  if (lead) {
    // Same pick as the ingest's activeMatch: the most recently touched open match.
    const [am] = await db.execute<RowDataPacket[]>("SELECT id FROM he_match WHERE lead_id = ? AND state IN ('invited','confirmed','slot_released') ORDER BY updated_at DESC LIMIT 1", [lead.id]);
    if (am[0]) { const c = await matchCtx(String(am[0].id), liveFrom); if (c) return withIds(c); }
  }
  const metaLeadId = i.metaLeadId ?? str(lead?.meta_lead_id);
  if (metaLeadId) {
    const [mr] = await db.execute<RowDataPacket[]>(
      `SELECT r.id, r.requisition_id, r.campaign_id, ${fillTypeSql("r", liveFrom)} AS drive_type FROM meta_lead_raw r WHERE r.id = ? LIMIT 1`, [metaLeadId]);
    if (mr[0]) return withIds({ ...empty, leadId: str(lead?.id), metaLeadId, requisitionId: str(mr[0].requisition_id), campaignId: str(mr[0].campaign_id), driveType: str(mr[0].drive_type) });
  }
  return withIds({ ...empty, leadId: str(lead?.id) });
}

/** Write one response row (idempotent). Never sends anything; the caller has already applied (or not) the state change. */
export async function recordResponse(i: ResponseInput, o: { tx?: PoolConnection } = {}): Promise<RecordResult> {
  if (!(await loadResponseSwitches()).capture) return NONE;
  const ex = (o.tx as unknown as Exec | undefined) ?? (db as unknown as Exec);
  const ctx = await resolveContext(i);
  const confirming = i.answer === "confirm" && i.applied && !!ctx.matchId;
  const dedupeAtInsert = i.answer === "confirm" && ctx.confirmedResponseId != null ? ctx.confirmedResponseId : null;
  const conflict = (i.answer === "decline" || i.answer === "reschedule") && ctx.confirmedResponseId != null;
  const status = i.status ?? statusFor({ answer: i.answer, mode: i.mode, applied: i.applied });
  const at = istStamp(i.occurredAt);
  let id: number;
  try {
    const [res] = await ex.execute<RowDataPacket[]>(
      `INSERT INTO candidate_response (occurred_at, channel, mode, answer, suggested_answer, confidence, status, mobile10, lead_id, meta_lead_id, match_id, invite_id,
                                       followup_id, requisition_id, campaign_id, drive_id, drive_type, source_kind, source_ref, raw_text, handled_by, handled_at,
                                       dedupe_of, conflict, slot_at, branch_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [at, i.channel, i.mode, i.answer, i.suggested?.answer ?? null, i.suggested ? Math.max(0, Math.min(1, i.suggested.confidence)) : null, status, i.mobile10,
        ctx.leadId, ctx.metaLeadId, ctx.matchId, ctx.inviteId, ctx.followupId, ctx.requisitionId, ctx.campaignId, ctx.driveId, ctx.driveType,
        i.sourceKind.slice(0, 16), i.sourceRef.slice(0, 120), i.rawText ? i.rawText.slice(0, 1000) : null, (i.handledBy ?? "system").slice(0, 60),
        i.handledBy && i.handledBy !== "system" ? at : null, dedupeAtInsert, conflict ? 1 : 0, ctx.slotAt, ctx.branchName]);
    id = Number((res as unknown as { insertId: number }).insertId);
  } catch (err) {
    if (!isDup(err)) throw err;
    const [prev] = await ex.execute<RowDataPacket[]>("SELECT id, dedupe_of, conflict FROM candidate_response WHERE source_kind = ? AND source_ref = ? LIMIT 1", [i.sourceKind.slice(0, 16), i.sourceRef.slice(0, 120)]);
    const p = prev[0];
    return p ? { id: Number(p.id), created: false, dedupeOf: p.dedupe_of == null ? null : Number(p.dedupe_of), conflict: Number(p.conflict) === 1 } : NONE;
  }
  let dedupeOf = dedupeAtInsert;
  if (confirming && dedupeAtInsert == null) {
    await ex.execute(
      "UPDATE he_match SET confirmed_at = COALESCE(confirmed_at, ?), confirmed_via = COALESCE(confirmed_via, ?), confirmed_response_id = COALESCE(confirmed_response_id, ?) WHERE id = ?",
      [at, i.channel, id, ctx.matchId]);
    // Another channel may have stamped the match between our read and this update: point this row at the winner.
    const [cur] = await ex.execute<RowDataPacket[]>("SELECT confirmed_at, confirmed_via, confirmed_response_id FROM he_match WHERE id = ? LIMIT 1", [ctx.matchId]);
    const winner = cur[0]?.confirmed_response_id == null ? null : Number(cur[0].confirmed_response_id);
    if (winner != null && winner !== id) {
      await ex.execute("UPDATE candidate_response SET dedupe_of = ? WHERE id = ?", [winner, id]);
      dedupeOf = winner;
    }
  }
  return { id, created: true, dedupeOf, conflict };
}

/** For live ingest paths: a failed response write is logged and never fails the reply / tap / call handling around it. */
export async function recordResponseSafe(i: ResponseInput): Promise<RecordResult> {
  try { return await recordResponse(i); } catch (err) {
    logger.warn({ sourceKind: i.sourceKind, err: (err as Error).message }, "[responses] response record failed");
    return NONE;
  }
}

export async function confirmationOf(matchId: string): Promise<{ at: string; via: ResponseChannel; responseId: number } | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT confirmed_at, confirmed_via, confirmed_response_id FROM he_match WHERE id = ? LIMIT 1", [matchId]);
  const r = rows[0];
  if (!r?.confirmed_at) return null;
  return { at: String(r.confirmed_at), via: r.confirmed_via as ResponseChannel, responseId: Number(r.confirmed_response_id) };
}
