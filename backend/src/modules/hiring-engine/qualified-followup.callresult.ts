/**
 * Call results for follow-up journeys (calling-file import, Superbot report, Superbot webhook all land here through recordVoiceResult):
 * the row is stamped 'called' with a result code; a first miss (no answer / busy / failed) re-queues the call once at least 2 hours later,
 * a second miss sets missed_call_due_at so the WhatsApp step sends T9 once; do-not-call ends every journey of the row as opted_out.
 * Only rows that own the person (live / canary / test) are stamped, and nothing is read while QUAL_FOLLOWUP_MODE is off.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { VoiceResult } from "./he-signals.js";
import { matchForRef, refForMatch } from "./he-call-ref.service.js";
import { releasePerson } from "./followup-person.service.js";
import { recordPersonOptOut } from "./followup-optout.service.js";
import { nextSendWindowOpen, inSendWindow, CALL_RETRY_GAP_MIN, CALL_ATTEMPTS_MAX } from "./followup-guards.js";
import { followupRef } from "./qualified-followup.rules.js";
import { followupMode } from "./qualified-followup.schedule.js";
import type { FollowupRow } from "./qualified-followup.context.js";

export type CallResultCode = "answered_confirmed" | "answered_reschedule" | "answered_declined" | "answered_other" | "no_answer" | "busy" | "failed" | "do_not_call";

const C = "COLLATE utf8mb4_unicode_ci";
const OWNED = "mode_at_enqueue IN ('live','canary','test')";
const MISSES = new Set<CallResultCode>(["no_answer", "busy", "failed"]);
const hold = (t: Date) => (inSendWindow(t) ? t : nextSendWindowOpen(t));

export function callResultCode(r: VoiceResult, o: { incomplete?: boolean } = {}): CallResultCode {
  if (r.failedReason) {
    if (/\bdnd\b|do not call|don'?t call/i.test(r.failedReason)) return "do_not_call";
    return /busy/i.test(r.failedReason) ? "busy" : "failed";
  }
  // An incomplete call connected and reached the right person before it ended.
  if (o.incomplete) return "answered_other";
  if (!r.answered) return "no_answer";
  if (r.identityConfirmed === "no" || r.identityConfirmed === "unclear") return "answered_other";
  if (r.originalSlotAnswer === "yes") return "answered_confirmed";
  if (r.originalSlotAnswer === "no" && r.offeredSlotAnswer === "yes") return "answered_reschedule";
  return "answered_declined";
}

/** HRMS-... (the match reference) -> the journey booked on that match; QF-xxxxxxxx (rows from before the unified method) -> its id prefix. */
export async function resolveFollowupByReference(ref: string): Promise<{ followupId: string; matchId: string | null } | null> {
  const t = String(ref ?? "").trim();
  const qf = /^QF-([0-9A-F]{8})$/i.exec(t);
  let rows: RowDataPacket[];
  if (qf) [rows] = await db.execute<RowDataPacket[]>(`SELECT id, match_id FROM qualified_followup WHERE REPLACE(id, '-', '') LIKE ? AND ${OWNED} LIMIT 1`, [`${qf[1].toLowerCase()}%`]);
  else if (/^HRMS-\d+$/i.test(t)) {
    const matchId = await matchForRef(t);
    if (!matchId) return null;
    [rows] = await db.execute<RowDataPacket[]>(`SELECT id, match_id FROM qualified_followup WHERE match_id = ? AND ${OWNED} LIMIT 1`, [matchId]);
  } else return null;
  return rows[0] ? { followupId: String(rows[0].id), matchId: rows[0].match_id ?? null } : null;
}

/** The reference every call of a journey carries: the match's HRMS reference once booked (so feedback finds the booking), else QF-. */
export async function callReference(row: FollowupRow): Promise<string> {
  return row.matchId ? refForMatch(row.matchId) : followupRef(row.id);
}

export async function stampFollowupCallResult(o: { mobile10: string; reference: string | null; result: CallResultCode; at: Date }): Promise<number> {
  if (followupMode() === "off") return 0;
  const byRef = o.reference ? await resolveFollowupByReference(o.reference) : null;
  const [rows] = byRef
    ? await db.execute<RowDataPacket[]>(`SELECT id, mobile10, call_attempts, journey_state FROM qualified_followup WHERE id = ? AND stopped_reason IS NULL LIMIT 1`, [byRef.followupId])
    : await db.execute<RowDataPacket[]>(
      `SELECT id, mobile10, call_attempts, journey_state FROM qualified_followup
        WHERE mobile10 = ? ${C} AND ${OWNED} AND stopped_reason IS NULL AND call_state IN ('pending','queued','in_file') LIMIT 20`, [o.mobile10]);
  let n = 0;
  for (const r of rows) {
    const id = String(r.id);
    if (o.result === "do_not_call") {
      await db.execute("UPDATE qualified_followup SET call_state = 'called', call_result = ?, called_at = ? WHERE id = ?", [o.result, o.at, id]);
      // Do-not-call is a STOP for the person: every journey of the mobile ends (Task 12).
      await recordPersonOptOut(String(r.mobile10), { source: "call", detail: "do not call" });
      await releasePerson(String(r.mobile10), id);
    } else if (MISSES.has(o.result)) {
      const attempts = Number(r.call_attempts ?? 0) + 1;
      if (attempts < CALL_ATTEMPTS_MAX) {
        await db.execute(
          `UPDATE qualified_followup SET call_state = 'pending', call_result = ?, call_attempts = ?, call_due_at = ?, call_file_batch_id = NULL WHERE id = ?`,
          [o.result, attempts, hold(new Date(o.at.getTime() + CALL_RETRY_GAP_MIN * 60_000)), id]);
      } else {
        await db.execute(
          `UPDATE qualified_followup SET call_state = 'called', call_result = ?, call_attempts = ?, called_at = ?, missed_call_due_at = ? WHERE id = ?`,
          [o.result, attempts, o.at, hold(o.at), id]);
      }
    } else {
      await db.execute("UPDATE qualified_followup SET call_state = 'called', call_result = ?, called_at = ? WHERE id = ?", [o.result, o.at, id]);
    }
    n++;
  }
  return n;
}
