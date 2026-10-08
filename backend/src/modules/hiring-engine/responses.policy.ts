/**
 * Switches for response capture (he_model_param, policy.responses.*):
 *   capture               1 (default) = every inbound event writes a candidate_response row; 0 = kill switch, nothing written.
 *   book_on_yes           1 (default) = a Yes / another time on an invite token books the slot; 0 = record only, HR books.
 *   auto_apply_confidence 0 (default, off) = free-text replies are never applied automatically.
 * A read error falls back to the defaults (capture only writes records; booking only follows the candidate's own tap).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

export interface ResponseSwitches { capture: boolean; bookOnYes: boolean; autoApplyConfidence: number }
export const RESPONSE_DEFAULTS: ResponseSwitches = { capture: true, bookOnYes: true, autoApplyConfidence: 0 };

export async function loadResponseSwitches(): Promise<ResponseSwitches> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'policy.responses.%'");
    const m = new Map(rows.map((r) => [String(r.param_key), Number(r.value)]));
    const conf = m.get("policy.responses.auto_apply_confidence");
    return {
      capture: m.has("policy.responses.capture") ? m.get("policy.responses.capture") === 1 : RESPONSE_DEFAULTS.capture,
      bookOnYes: m.has("policy.responses.book_on_yes") ? m.get("policy.responses.book_on_yes") === 1 : RESPONSE_DEFAULTS.bookOnYes,
      autoApplyConfidence: conf != null && Number.isFinite(conf) && conf > 0 && conf <= 1 ? conf : 0,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[responses] switch read failed, using defaults");
    return { ...RESPONSE_DEFAULTS };
  }
}
