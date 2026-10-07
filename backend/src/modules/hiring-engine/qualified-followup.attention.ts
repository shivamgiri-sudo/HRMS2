/**
 * Follow-up pipeline, operator view: failed steps grouped by cause, a guarded manual retry, mark-called, and a per-row audit.
 * Responses and logs never carry a full phone number (maskMobile) and error text is scrubbed of digit runs.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { maskMobile, metaErrorCode, OUTCOME_UNKNOWN_ERROR } from "./qualified-followup.rules.js";
import type { SourceType } from "./qualified-followup.types.js";

export type AttentionChannel = "email" | "whatsapp" | "call";

export interface AttentionRow {
  id: string; name: string | null; mobileMasked: string; requisitionId: string; sourceType: SourceType;
  error: string | null; attempts: number; updatedAt: string;
  /** The send may already have happened (process died mid-send); retry is refused. */
  outcomeUnknown: boolean;
}
export interface AttentionGroup { channel: AttentionChannel; cause: string; count: number; rows: AttentionRow[] }

const C = "COLLATE utf8mb4_unicode_ci";
/** Newest rows read per channel; the groups are built from these, so counts are exact up to this many open failures. */
const FETCH_CAP = 5000;
const scrub = (t: unknown): string | null => (t == null ? null : String(t).replace(/\+?\d[\d ]{8,}\d/g, "[number]"));

interface ChannelDef { channel: AttentionChannel; errorCol: string; attemptsCol: string; where: string; cause: (e: string | null) => string }

const DEFS: ChannelDef[] = [
  { channel: "email", errorCol: "email_error", attemptsCol: "email_attempts", where: "qf.email_status = 'failed'",
    cause: (e) => { const t = (e ?? "").split(":")[0].trim().slice(0, 60); return t || "unknown"; } },
  { channel: "whatsapp", errorCol: "wa_error", attemptsCol: "wa_attempts", where: "qf.wa_status = 'failed'", cause: (e) => metaErrorCode(e) },
  { channel: "call", errorCol: "call_error", attemptsCol: "call_attempts", where: "qf.call_error IS NOT NULL AND qf.call_state IN ('pending','in_file')",
    cause: (e) => { const t = (e ?? "").split(":")[0].trim(); return t || "unknown"; } },
];

export async function listAttention(limitPerGroup = 50): Promise<AttentionGroup[]> {
  const limit = Math.max(1, Math.floor(limitPerGroup));
  const groups: AttentionGroup[] = [];
  for (const d of DEFS) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT qf.id, qf.full_name, qf.mobile10, qf.requisition_id, qf.source_type, qf.${d.errorCol} AS err, qf.${d.attemptsCol} AS attempts, qf.updated_at
         FROM qualified_followup qf
        WHERE qf.stopped_reason IS NULL AND ${d.where}
        ORDER BY qf.updated_at DESC LIMIT ${FETCH_CAP}`);
    const byCause = new Map<string, AttentionGroup>();
    for (const r of rows) {
      const error = scrub(r.err);
      const cause = d.cause(error);
      let g = byCause.get(cause);
      if (!g) { g = { channel: d.channel, cause, count: 0, rows: [] }; byCause.set(cause, g); }
      g.count++;
      if (g.rows.length < limit) {
        g.rows.push({
          id: String(r.id), name: r.full_name ?? null, mobileMasked: maskMobile(String(r.mobile10 ?? "")), requisitionId: String(r.requisition_id),
          sourceType: r.source_type as SourceType, error, attempts: Number(r.attempts ?? 0), updatedAt: String(r.updated_at ?? ""),
          outcomeUnknown: error === OUTCOME_UNKNOWN_ERROR,
        });
      }
    }
    groups.push(...byCause.values());
  }
  return groups.sort((a, b) => b.count - a.count);
}

const RESET_SQL: Record<AttentionChannel, string> = {
  email: "email_status = NULL, email_error = NULL, email_attempts = 0, email_due_at = NOW()",
  whatsapp: "wa_status = NULL, wa_error = NULL, wa_attempts = 0, wa_due_at = NOW()",
  call: "call_state = 'pending', call_error = NULL, call_attempts = 0, call_due_at = NOW(), call_file_batch_id = NULL",
};
// Same condition the reset repeats in its WHERE, so a concurrent change between read and write leaves the row alone.
const RETRYABLE_SQL: Record<AttentionChannel, string> = {
  email: "email_status IN ('failed','test_sent')",
  whatsapp: "wa_status IN ('failed','test_sent')",
  // An in_file row is already stamped into a sent calling file: resetting it would queue a second call.
  call: "call_error IS NOT NULL AND call_state IN ('pending','in_file') AND call_file_batch_id IS NULL",
};
const ERROR_COL: Record<AttentionChannel, string> = { email: "email_error", whatsapp: "wa_error", call: "call_error" };

export async function retryFollowupStep(id: string, channel: AttentionChannel): Promise<"ok" | "not_found" | "not_retryable" | "stopped" | "outcome_unknown"> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, stopped_reason, (${RETRYABLE_SQL[channel]}) AS retryable, ${ERROR_COL[channel]} AS err FROM qualified_followup WHERE id = ? LIMIT 1`, [id]);
  const r = rows[0];
  if (!r) return "not_found";
  if (r.stopped_reason) return "stopped";
  if (r.err === OUTCOME_UNKNOWN_ERROR) return "outcome_unknown";
  if (!Number(r.retryable)) return "not_retryable";
  const [res] = await db.execute<any>(
    `UPDATE qualified_followup SET ${RESET_SQL[channel]} WHERE id = ? AND stopped_reason IS NULL AND (${RETRYABLE_SQL[channel]}) AND COALESCE(${ERROR_COL[channel]}, '') <> ?`, [id, OUTCOME_UNKNOWN_ERROR]);
  return Number(res?.affectedRows ?? 0) > 0 ? "ok" : "not_retryable";
}

/** A call result came back for this number (or an operator confirmed it): only rows handed to a calling file or the bot move on. */
export async function markFollowupCalled(mobile10: string, id?: string): Promise<number> {
  const [res] = await db.execute<any>(
    `UPDATE qualified_followup SET call_state = 'called', called_at = NOW()
      WHERE mobile10 = ? ${C} AND call_state IN ('in_file','queued')${id ? " AND id = ?" : ""}`,
    id ? [mobile10, id] : [mobile10]);
  return Number(res?.affectedRows ?? 0);
}

export async function mobileOfFollowup(id: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT mobile10 FROM qualified_followup WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? String(rows[0].mobile10) : null;
}

export interface FollowupAudit {
  id: string; source_type: string; origin_id: string; origin_label: string; mode_at_enqueue: string; mobileMasked: string; requisition_id: string;
  qualified_at: string | null;
  email_due_at: string | null; email_sent_at: string | null; email_status: string | null; email_error: string | null; email_attempts: number;
  wa_due_at: string | null; wa_sent_at: string | null; wa_status: string | null; wa_error: string | null; wa_attempts: number; wa_template_key: string | null;
  call_due_at: string | null; call_state: string; call_error: string | null; call_attempts: number; called_at: string | null;
  stopped_reason: string | null; stopped_at: string | null;
}

const s = (v: unknown): string | null => (v == null ? null : String(v));

export async function getFollowupAudit(id: string): Promise<FollowupAudit | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, source_type, origin_id, origin_label, mode_at_enqueue, mobile10, requisition_id, qualified_at,
            email_due_at, email_sent_at, email_status, email_error, email_attempts,
            wa_due_at, wa_sent_at, wa_status, wa_error, wa_attempts, wa_template_key,
            call_due_at, call_state, call_error, call_attempts, called_at, stopped_reason, stopped_at
       FROM qualified_followup WHERE id = ? LIMIT 1`, [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id), source_type: String(r.source_type), origin_id: String(r.origin_id), origin_label: String(r.origin_label),
    mode_at_enqueue: String(r.mode_at_enqueue), mobileMasked: maskMobile(String(r.mobile10 ?? "")), requisition_id: String(r.requisition_id),
    qualified_at: s(r.qualified_at),
    email_due_at: s(r.email_due_at), email_sent_at: s(r.email_sent_at), email_status: s(r.email_status), email_error: scrub(r.email_error), email_attempts: Number(r.email_attempts ?? 0),
    wa_due_at: s(r.wa_due_at), wa_sent_at: s(r.wa_sent_at), wa_status: s(r.wa_status), wa_error: scrub(r.wa_error), wa_attempts: Number(r.wa_attempts ?? 0), wa_template_key: s(r.wa_template_key),
    call_due_at: s(r.call_due_at), call_state: String(r.call_state), call_error: scrub(r.call_error), call_attempts: Number(r.call_attempts ?? 0), called_at: s(r.called_at),
    stopped_reason: s(r.stopped_reason), stopped_at: s(r.stopped_at),
  };
}

export function logAttentionError(what: string, err: unknown): void {
  logger.error({ err: (err as Error).message?.replace(/\+?\d[\d ]{8,}\d/g, "[number]") }, `[he] qualified-followup ${what} failed`);
}
