/**
 * Where the legacy Meta outreach meets the unified follow-up (Task 14). A person the method owns (a live / canary row, open or stopped)
 * is never messaged by the legacy path, whatever the mode. When Live Meta runs live (or canary for a listed requisition) the automatic
 * path enrols instead of sending, and HR's Notify enrols and runs the journey's next step now. Otherwise the legacy path is unchanged.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent } from "./he-lead.service.js";
import { followupHasLiveRow } from "./qualified-followup.service.js";
import { enrolMetaArrival } from "../selection/meta-arrival.service.js";
import { enrolTag, loadFollowupSwitches, type FollowupSwitches } from "./qualified-followup.policy.js";
import { ROW_COLUMNS, toFollowupRow } from "./qualified-followup.context.js";
import { newBudget, type StepScope } from "./qualified-followup.stagea.js";
import { dueTimes } from "./qualified-followup.schedule.js";

export type LegacyDecision = { action: "send" } | { action: "skip"; reason: string } | { action: "enrol_and_run" };
export const HANDLED = "Handled by the follow-up method";

export async function legacyOutreachDecision(metaLeadId: string, o: { force: boolean; manual: boolean; switches?: FollowupSwitches }): Promise<LegacyDecision> {
  const s = o.switches ?? (await loadFollowupSwitches());
  const owned = await followupHasLiveRow(metaLeadId);
  const [r] = await db.execute<RowDataPacket[]>("SELECT requisition_id FROM meta_lead_raw WHERE id = ? LIMIT 1", [metaLeadId]);
  const req = r[0]?.requisition_id ? String(r[0].requisition_id) : null;
  const tag = req ? enrolTag(s, "meta_live", req) : null;
  const methodRuns = tag === "live" || tag === "canary";
  if (owned) return o.manual && methodRuns ? { action: "enrol_and_run" } : { action: "skip", reason: HANDLED };
  if (!methodRuns) return { action: "send" };
  if (o.manual) return { action: "enrol_and_run" };
  await enrolMetaArrival(metaLeadId, { switches: s });
  return { action: "skip", reason: HANDLED };
}

/**
 * HR's Notify on an enrolled person: the journey's next stage A step runs now, through the guards. `hrOverride` (Notify with force) lifts
 * the 7-day re-contact hold and re-opens a journey waiting for a re-invite; it never lifts STOP, a closed requisition or the caps.
 */
export async function runJourneyNow(followupId: string, o: { actor: string; hrOverride: boolean }): Promise<{ step: "email" | "whatsapp" | "call" | null; result: string }> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${ROW_COLUMNS} FROM qualified_followup qf WHERE qf.id = ? LIMIT 1`, [followupId]);
  if (!rows[0]) return { step: null, result: "not_found" };
  let row = toFollowupRow(rows[0]);
  if (row.journeyState === "stopped" || rows[0].stopped_reason) return { step: null, result: "stopped" };
  const now = new Date();
  if (o.hrOverride) {
    if (row.heLeadId) await addEvent(row.heLeadId, "hr_reinvite_override", { channel: "system", actor: o.actor, detail: `notify with force (${row.journeyState})` });
    if (row.journeyState === "reinvite_wait") {
      const due = dueTimes({ enrolledAt: now, hasEmail: !!row.email });
      await db.execute(
        `UPDATE qualified_followup SET reinvite_no = reinvite_no + 1, journey_state = 'enrolled', stage_a_ended_at = NULL, email_due_at = ?, email_status = NULL, email_sent_at = NULL,
                wa_due_at = ?, wa_status = NULL, wa_sent_at = NULL, call_due_at = NULL, call_state = 'pending', call_attempts = 0, missed_call_due_at = NULL WHERE id = ? AND journey_state = 'reinvite_wait'`,
        [due.emailDueAt, due.waDueAt, row.id]);
      row = { ...row, journeyState: "enrolled", reinviteNo: row.reinviteNo + 1, emailStatus: null, waStatus: null, callState: "pending" };
    }
  }
  if (row.journeyState === "held_manual") {
    await db.execute("UPDATE qualified_followup SET journey_state = 'enrolled', held_reason = NULL WHERE id = ? AND journey_state = 'held_manual'", [row.id]);
    if (row.heLeadId) await addEvent(row.heLeadId, "followup_released", { detail: "notify", actor: o.actor });
  }
  const step: "email" | "whatsapp" | "call" | null = row.emailStatus === null && row.email ? "email" : row.waStatus === null ? "whatsapp" : row.callState === "pending" ? "call" : null;
  if (!step) return { step: null, result: "nothing_due" };
  const col = step === "email" ? "email_due_at" : step === "whatsapp" ? "wa_due_at" : "call_due_at";
  await db.execute(`UPDATE qualified_followup SET ${col} = ? WHERE id = ?`, [now, row.id]);
  const s = await loadFollowupSwitches();
  const tag = row.modeAtEnqueue;
  const scope: StepScope = { sources: [row.sourceType], budget: newBudget(s.waDailyMax), onlyId: row.id, hrOverride: o.hrOverride };
  try {
    // Loaded on use: the step modules import this module's neighbours, and Notify is rare.
    const c = step === "email" ? await (await import("./qualified-followup.email.js")).runEmailStep(s, tag, now, scope)
      : step === "whatsapp" ? await (await import("./qualified-followup.whatsapp.js")).runWhatsappStep(s, tag, now, scope)
      : await (await import("./qualified-followup.call.js")).runCallStep(s, tag, now, scope);
    return { step, result: c.sent ? "sent" : c.held ? "held" : c.blocked ? "blocked" : c.failed ? "failed" : c.dryRun ? "dry_run" : "not_due" };
  } catch (err) {
    logger.warn({ followupId, err: (err as Error).message }, "[qualified-followup] run now failed");
    return { step, result: "failed" };
  }
}
