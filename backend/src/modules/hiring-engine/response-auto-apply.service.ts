/**
 * No HR in the loop: clear replies are applied by the engine itself.
 *   - confirm / decline / reschedule, read with >= 90% confidence (or a button / call answer), not a conflict, not a duplicate;
 *   - tied to a booking or an invitation -> the same path as the Will come / Cannot come / Another time buttons;
 *   - tied to a person and requisition but with no booking yet -> booked on the nearest working day (the manual-confirm path) and closed.
 * A reply that could not be applied now (engine busy, no seat) stays in the queue and is retried on the next tick for 3 days.
 * policy.replies_auto_apply = 0 switches this off. Bounded per tick; never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { classifyResponse, manualResponse, ResponseActionError, type ManualAnswer } from "./response-actions.service.js";
import type { ResponseAnswer } from "./response-normalise.js";

export const AUTO_APPLY_KEY = "policy.replies_auto_apply";
export const AUTO_ACTOR = "auto-reply";
export const AUTO_MIN_CONFIDENCE = 0.9;
const PER_TICK = 25;
const ALL = { all: true, branchName: null } as unknown as BranchScope;
const attempts = new Map<number, number>();
const MAX_ATTEMPTS = 6;

export interface AutoApplyReport { considered: number; applied: number; booked: number; recorded: number; retryLater: number; skipped: number; off: boolean }

async function switchedOn(): Promise<boolean> {
  try {
    const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [AUTO_APPLY_KEY]);
    return r[0] ? Number(r[0].value) !== 0 : true; // absent = on (owner decision: no HR step)
  } catch { return false; }
}

export async function autoResolveReplies(now: Date = new Date()): Promise<AutoApplyReport> {
  const rep: AutoApplyReport = { considered: 0, applied: 0, booked: 0, recorded: 0, retryLater: 0, skipped: 0, off: false };
  try {
    if (!(await switchedOn())) { rep.off = true; return rep; }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, mode, COALESCE(suggested_answer, answer) AS ans, confidence, match_id, invite_id, lead_id, requisition_id, mobile10
         FROM candidate_response
        WHERE status = 'needs_review' AND handled_at IS NULL AND conflict = 0 AND dedupe_of IS NULL
          AND COALESCE(suggested_answer, answer) IN ('confirm','decline','reschedule')
          AND (mode IN ('button','call','manual') OR confidence >= ${AUTO_MIN_CONFIDENCE})
          AND occurred_at <= DATE_SUB(?, INTERVAL 2 MINUTE) AND occurred_at >= DATE_SUB(?, INTERVAL 3 DAY)
        ORDER BY occurred_at LIMIT ${PER_TICK}`, [now, now]);
    for (const r of rows) {
      rep.considered++;
      const id = Number(r.id);
      const tried = (attempts.get(id) ?? 0) + 1;
      if (tried > MAX_ATTEMPTS) { rep.skipped++; continue; }
      attempts.set(id, tried);
      const answer = String(r.ans) as ManualAnswer;
      try {
        if (r.match_id || r.invite_id) {
          const out = await classifyResponse({ actor: AUTO_ACTOR, responseId: id, answer: answer as ResponseAnswer, apply: true, confirmPerson: true }, ALL);
          if (out.status === "applied") rep.applied++; else rep.retryLater++;
        } else if (r.lead_id && r.requisition_id && answer === "confirm") {
          const out = await manualResponse({ actor: AUTO_ACTOR, leadId: String(r.lead_id), requisitionId: String(r.requisition_id), answer, via: "other",
            note: `Candidate replied that they will attend (reply #${id}); booked by the engine` }, ALL);
          if (out.state === "pending" || out.state === "unavailable") { rep.retryLater++; continue; }
          await classifyResponse({ actor: AUTO_ACTOR, responseId: id, answer: "confirm", apply: false }, ALL);
          rep.booked++;
        } else if (answer === "decline") {
          await classifyResponse({ actor: AUTO_ACTOR, responseId: id, answer: "decline", apply: false }, ALL);
          rep.recorded++;
        } else { rep.skipped++; }
      } catch (err) {
        if (err instanceof ResponseActionError && err.status === 409) { rep.skipped++; continue; }
        rep.retryLater++;
        logger.warn({ id, err: (err as Error).message.slice(0, 120) }, "[auto-reply] apply failed; retried next tick");
      }
    }
    if (attempts.size > 2000) attempts.clear();
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 120) }, "[auto-reply] pass failed");
  }
  if (rep.applied || rep.booked || rep.recorded) logger.info(rep, "[auto-reply] pass");
  return rep;
}
