/**
 * Loads the guard facts for one follow-up row and step (followup-guards.ts decides). Person-level reads key on the normalised mobile;
 * message counts on the IST day. A missing he_lead is a person never contacted by the engine: no counts, no campaign switch.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { channelAllowed } from "./he-campaign-config.service.js";
import type { GuardFacts, GuardStep } from "./followup-guards.js";
import { istDayBounds, loadRequisitionFacts } from "./followup-guards.service.js";
import type { FollowupRow } from "./qualified-followup.context.js";

const C = "COLLATE utf8mb4_unicode_ci";
const ist = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v).replace(" ", "T") + "+05:30"));
// Unprompted = not one of the transactional answers (T2 confirmation, T5 new slot, T10 STOP acknowledgement).
const UNPROMPTED = "template_key NOT LIKE 'he_walkin_confirmed:%' AND template_key NOT LIKE 'he_reschedule_offer:%' AND template_key NOT LIKE 'he_optout_ack:%'";

export interface GuardFactsInput {
  row: FollowupRow; step: GuardStep; now: Date; transactional: boolean; firstContact: boolean; cadenceStep: boolean; stage?: "A" | "B";
  killSwitch: boolean; sourcePaused: boolean; waBudgetLeft: number; branchCapLeft: number | null; uploadWaAllowed: boolean; hrOverride?: boolean;
}

export async function loadGuardFacts(i: GuardFactsInput): Promise<GuardFacts> {
  const { row, now } = i;
  const [p] = await db.execute<RowDataPacket[]>(
    `SELECT l.id AS lead_id, l.status,
            EXISTS (SELECT 1 FROM he_consent k WHERE k.lead_id = l.id AND k.consent_type = 'whatsapp_contact' AND k.revoked_at IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM he_consent k2 WHERE k2.lead_id = l.id AND k2.consent_type = 'whatsapp_contact' AND k2.revoked_at IS NULL) AS revoked,
            fp.opted_out_at, fp.last_first_contact_at, fp.active_followup_id
       FROM (SELECT ? AS m) x
       LEFT JOIN he_lead l ON l.mobile10 = x.m ${C}
       LEFT JOIN followup_person fp ON fp.mobile10 = x.m ${C}
      LIMIT 1`, [row.mobile10]);
  const person = p[0] ?? {};
  const leadId: string | null = row.heLeadId ?? (person.lead_id ? String(person.lead_id) : null);
  let waToday = 0, lastUnprompted: Date | null = null, callsToday = 0, lastCall: Date | null = null, allowed = true;
  if (leadId) {
    const [start, end] = istDayBounds(now);
    const [m] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(channel = 'whatsapp' AND created_at >= ? AND created_at < ? AND ${UNPROMPTED}) AS wa_today,
              MAX(IF(${UNPROMPTED}, created_at, NULL)) AS last_unprompted
         FROM he_message WHERE lead_id = ? AND direction = 'out' AND delivery_status <> 'failed'`, [start, end, leadId]);
    waToday = Number(m[0]?.wa_today ?? 0);
    lastUnprompted = ist(m[0]?.last_unprompted);
    const [c] = await db.execute<RowDataPacket[]>(
      "SELECT SUM(started_at >= ? AND started_at < ?) AS today, MAX(started_at) AS last_at FROM he_call WHERE lead_id = ?", [start, end, leadId]);
    callsToday = Number(c[0]?.today ?? 0);
    lastCall = ist(c[0]?.last_at);
    if (i.step !== "call_file") allowed = await channelAllowed(leadId, i.step === "email" ? "email" : i.step === "whatsapp" ? "whatsapp" : "voice");
  }
  let journeyEnded: GuardFacts["journeyEnded"] = person.status === "joined" ? "joined" : null;
  if (!journeyEnded && row.matchId) {
    const [mm] = await db.execute<RowDataPacket[]>("SELECT state FROM he_match WHERE id = ? LIMIT 1", [row.matchId]);
    const st = String(mm[0]?.state ?? "");
    journeyEnded = st === "declined" ? "declined" : st === "arrived" || st === "selected" ? "arrived" : null;
  }
  // The re-contact hold counts another journey's first contact only (this journey's own first contact is not a reason to wait).
  const otherFirst = person.active_followup_id && person.active_followup_id !== row.id ? ist(person.last_first_contact_at)
    : person.active_followup_id ? null : ist(person.last_first_contact_at);
  return {
    now, step: i.step, transactional: i.transactional, firstContact: i.firstContact, stage: i.stage,
    killSwitch: i.killSwitch, sourceRunnable: true, sourcePaused: i.sourcePaused,
    optedOut: person.status === "opted_out" || Number(person.revoked ?? 0) === 1 || person.opted_out_at != null,
    requisition: await loadRequisitionFacts(row.requisitionId), journeyEnded,
    waUnpromptedToday: waToday, lastUnpromptedAt: lastUnprompted, lastCadenceStepAt: null, cadenceStep: i.cadenceStep, // the previous step is in he_message (lastUnpromptedAt)
    callAttemptsToday: callsToday, lastCallAt: lastCall,
    waBudgetLeft: i.waBudgetLeft, branchCapLeft: i.branchCapLeft, lastFirstContactOtherReqAt: i.firstContact ? otherFirst : null, hrOverride: i.hrOverride ?? false,
    channelAllowed: allowed, uploadWithoutOptIn: false, uploadWaAllowed: i.uploadWaAllowed, templateApproved: true, missingVariables: [],
  };
}
