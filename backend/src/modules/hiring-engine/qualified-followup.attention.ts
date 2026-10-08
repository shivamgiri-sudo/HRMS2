/**
 * Follow-up pipeline, operator view: failed steps grouped by cause, a guarded manual retry, mark-called, and a per-row audit.
 * Responses and logs never carry a full phone number (maskMobile) and error text is scrubbed of digit runs.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { maskMobile, metaErrorCode, OUTCOME_UNKNOWN_ERROR } from "./qualified-followup.rules.js";
import { readSwitches, rowTag } from "./qualified-followup.policy.js";
import { stampFollowupCallResult, type CallResultCode } from "./qualified-followup.callresult.js";
import type { SourceType } from "./qualified-followup.types.js";

export type AttentionChannel = "email" | "whatsapp" | "call";

export interface AttentionRow {
  id: string; name: string | null; mobileMasked: string; requisitionId: string; sourceType: SourceType;
  error: string | null; attempts: number; updatedAt: string;
  /** The send may already have happened (process died mid-send); retry is refused. */
  outcomeUnknown: boolean;
  /** false when a retry would be refused or could double-send; retryReason says why. */
  retryable: boolean;
  retryReason: "outcome_unknown" | "already_sent" | "already_in_file" | null;
}
export interface AttentionGroup { channel: AttentionChannel; cause: string; count: number; rows: AttentionRow[] }

const C = "COLLATE utf8mb4_unicode_ci";
/** Newest rows read per channel; the groups are built from these, so counts are exact up to this many open failures. */
const FETCH_CAP = 5000;
const scrub = (t: unknown): string | null => (t == null ? null : String(t).replace(/\+?\d[\d ]{8,}\d/g, "[number]"));

interface ChannelDef { sentExpr: string; channel: AttentionChannel; errorCol: string; attemptsCol: string; where: string; cause: (e: string | null) => string }

const DEFS: ChannelDef[] = [
  { sentExpr: "0", channel: "email", errorCol: "email_error", attemptsCol: "email_attempts", where: "qf.email_status = 'failed'",
    cause: (e) => { const t = (e ?? "").split(":")[0].trim().slice(0, 60); return t || "unknown"; } },
  { sentExpr: "(qf.wa_sent_at IS NOT NULL)", channel: "whatsapp", errorCol: "wa_error", attemptsCol: "wa_attempts", where: "qf.wa_status = 'failed'", cause: (e) => metaErrorCode(e) },
  { sentExpr: "0", channel: "call", errorCol: "call_error", attemptsCol: "call_attempts", where: "qf.call_error IS NOT NULL AND qf.call_state IN ('pending','in_file')",
    cause: (e) => { const t = (e ?? "").split(":")[0].trim(); return t || "unknown"; } },
];

function retryInfo(channel: AttentionChannel, error: string | null, r: RowDataPacket): { retryable: boolean; retryReason: AttentionRow["retryReason"] } {
  if (error === OUTCOME_UNKNOWN_ERROR) return { retryable: false, retryReason: "outcome_unknown" };
  if (Number(r.already_sent) === 1) return { retryable: false, retryReason: "already_sent" };
  if (channel === "call" && r.batch_id) return { retryable: false, retryReason: "already_in_file" };
  return { retryable: true, retryReason: null };
}

export async function listAttention(limitPerGroup = 50): Promise<AttentionGroup[]> {
  const limit = Math.max(1, Math.floor(limitPerGroup));
  const groups: AttentionGroup[] = [];
  for (const d of DEFS) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT qf.id, qf.full_name, qf.mobile10, qf.requisition_id, qf.source_type, qf.${d.errorCol} AS err, qf.${d.attemptsCol} AS attempts, qf.updated_at, ${d.sentExpr} AS already_sent, qf.call_file_batch_id AS batch_id
         FROM qualified_followup qf
        WHERE qf.stopped_reason IS NULL AND qf.owner = 'pipeline' AND ${d.where}
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
          outcomeUnknown: error === OUTCOME_UNKNOWN_ERROR, ...retryInfo(d.channel, error, r),
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
// A row handed to the engine (owner 'engine') is never re-armed: the engine already invites that person.
const RETRYABLE_SQL: Record<AttentionChannel, string> = {
  email: "email_status IN ('failed','test_sent') AND owner = 'pipeline'",
  whatsapp: "wa_status IN ('failed','test_sent') AND wa_sent_at IS NULL AND owner = 'pipeline'",
  // An in_file row is already stamped into a sent calling file: resetting it would queue a second call.
  call: "call_error IS NOT NULL AND call_state IN ('pending','in_file') AND call_file_batch_id IS NULL AND owner = 'pipeline'",
};
const ERROR_COL: Record<AttentionChannel, string> = { email: "email_error", whatsapp: "wa_error", call: "call_error" };

export async function retryFollowupStep(id: string, channel: AttentionChannel): Promise<"ok" | "not_found" | "not_retryable" | "stopped" | "outcome_unknown" | "already_sent"> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, stopped_reason, (${RETRYABLE_SQL[channel]}) AS retryable, ${ERROR_COL[channel]} AS err, ${channel === "whatsapp" ? "(wa_status IN ('failed','test_sent') AND wa_sent_at IS NOT NULL)" : "0"} AS already_sent FROM qualified_followup WHERE id = ? LIMIT 1`, [id]);
  const r = rows[0];
  if (!r) return "not_found";
  if (r.stopped_reason) return "stopped";
  if (r.err === OUTCOME_UNKNOWN_ERROR) return "outcome_unknown";
  if (Number(r.already_sent) === 1) return "already_sent";
  if (!Number(r.retryable)) return "not_retryable";
  const [res] = await db.execute<any>(
    `UPDATE qualified_followup SET ${RESET_SQL[channel]} WHERE id = ? AND stopped_reason IS NULL AND (${RETRYABLE_SQL[channel]}) AND COALESCE(${ERROR_COL[channel]}, '') <> ?`, [id, OUTCOME_UNKNOWN_ERROR]);
  return Number(res?.affectedRows ?? 0) > 0 ? "ok" : "not_retryable";
}

/** A call result came back for this number (or an operator confirmed it): only rows handed to a calling file or the bot move on. */
export async function markFollowupCalled(mobile10: string, id?: string, result?: { result: CallResultCode; reference: string | null; at: Date }): Promise<number> {
  // A call result from any channel (file import, Superbot report or webhook): the unified stamp (retry, T9, do-not-call).
  if (result && !id) return stampFollowupCallResult({ mobile10, ...result });
  // A call result only moves rows of the mode now running (never dry_run/test rows, nothing at all while off); an operator naming one row decides for it.
  const tag = id ? null : rowTag(readSwitches());
  if (!id && !tag) return 0;
  const [res] = await db.execute<any>(
    `UPDATE qualified_followup SET call_state = 'called', called_at = NOW()
      WHERE mobile10 = ? ${C} AND call_state IN ('in_file','queued')${id ? " AND id = ?" : " AND mode_at_enqueue = ?"}`,
    [mobile10, id ?? tag]);
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
  /** Per-person timeline (spec 4.8): sends, replies, guard skips, stops and shadow rows, oldest first. Empty when it cannot be read. */
  timeline: TimelineEntry[];
}

export interface TimelineEntry { at: string; kind: "sent" | "skip" | "shadow" | "reply" | "stop"; step: string; detail: string }

const TIMELINE_CAP = 200;

async function readSafe<T>(what: string, fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn(); } catch (err) { logAttentionError(`timeline ${what}`, err); return []; }
}

/** Messages of the person for this requisition (and every reply), the row's skips and the person's opt-out, and the row's shadow rows. */
export async function followupTimeline(r: { id: string; mobile10: string; requisitionId: string; heLeadId: string | null }): Promise<TimelineEntry[]> {
  const out: TimelineEntry[] = [];
  const msgs = await readSafe("messages", async () => (await db.execute<RowDataPacket[]>(
    `SELECT m.created_at AS at, m.direction, m.channel, m.template_key, m.delivery_status, m.sent_by FROM he_message m
      WHERE m.mobile10 = ? AND (m.requisition_id = ? OR m.direction = 'in') ORDER BY m.created_at LIMIT ${TIMELINE_CAP}`, [r.mobile10, r.requisitionId]))[0]);
  for (const m of msgs) {
    if (m.direction === "in") { out.push({ at: String(m.at), kind: "reply", step: String(m.channel ?? "whatsapp"), detail: "reply" }); continue; }
    const by = m.sent_by === "followup" ? "follow-up" : m.sent_by ? String(m.sent_by) : "engine";
    out.push({ at: String(m.at), kind: "sent", step: String(m.channel ?? "whatsapp"),
      detail: scrub(`${String(m.template_key ?? "message").split(":")[0]} by ${by}${m.delivery_status ? ` (${m.delivery_status})` : ""}`) ?? "" });
  }
  if (r.heLeadId) {
    const ev = await readSafe("events", async () => (await db.execute<RowDataPacket[]>(
      `SELECT e.created_at AS at, e.event_type, e.channel, e.detail FROM he_lead_event e
        WHERE e.lead_id = ? AND (e.event_type = 'opted_out' OR (e.event_type = 'followup_skip' AND JSON_UNQUOTE(JSON_EXTRACT(e.meta_json, '$.followupId')) = ?))
        ORDER BY e.created_at LIMIT ${TIMELINE_CAP}`, [r.heLeadId, r.id]))[0]);
    for (const e of ev) {
      const detail = String(e.detail ?? "");
      if (e.event_type === "followup_skip") {
        const [step, ...why] = detail.split(":");
        out.push({ at: String(e.at), kind: "skip", step: String(e.channel ?? step), detail: scrub(why.join(":") || detail) ?? "" });
      } else out.push({ at: String(e.at), kind: "stop", step: String(e.channel ?? "system"), detail: `opted out${detail ? `: ${scrub(detail)}` : ""}` });
    }
  }
  const sh = await readSafe("shadow", async () => (await db.execute<RowDataPacket[]>(
    `SELECT s.would_at AS at, s.step, s.verdict, s.template_key FROM followup_shadow s WHERE s.followup_id = ? ORDER BY s.would_at LIMIT ${TIMELINE_CAP}`, [r.id]))[0]);
  for (const x of sh) out.push({ at: String(x.at), kind: "shadow", step: String(x.step), detail: `${String(x.verdict)}${x.template_key ? ` ${String(x.template_key)}` : ""}` });
  return out.map((e, i) => ({ e, i })).sort((a, b) => (a.e.at < b.e.at ? -1 : a.e.at > b.e.at ? 1 : a.i - b.i)).map(({ e }) => e);
}

const s = (v: unknown): string | null => (v == null ? null : String(v));

export async function getFollowupAudit(id: string): Promise<FollowupAudit | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, source_type, origin_id, origin_label, mode_at_enqueue, mobile10, requisition_id, qualified_at,
            email_due_at, email_sent_at, email_status, email_error, email_attempts,
            wa_due_at, wa_sent_at, wa_status, wa_error, wa_attempts, wa_template_key,
            call_due_at, call_state, call_error, call_attempts, called_at, stopped_reason, stopped_at, he_lead_id
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
    timeline: await followupTimeline({ id: String(r.id), mobile10: String(r.mobile10 ?? ""), requisitionId: String(r.requisition_id), heLeadId: r.he_lead_id ? String(r.he_lead_id) : null }),
  };
}

export function logAttentionError(what: string, err: unknown): void {
  logger.error({ err: (err as Error).message?.replace(/\+?\d[\d ]{8,}\d/g, "[number]") }, `[he] qualified-followup ${what} failed`);
}
