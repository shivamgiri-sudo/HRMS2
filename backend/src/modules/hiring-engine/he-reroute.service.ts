/**
 * "Not a fit for X, fits Y": candidates rejected in the last 3 days get ONE offer for the best other open requisition
 * they are eligible for (different process, passes the eligibility gate). Runs inside the engine tick.
 */
import type { RowDataPacket } from "mysql2";
import { randomBytes } from "node:crypto";
import { db } from "../../db/mysql.js";
import { addEvent } from "./he-lead.service.js";
import { alternativeRequisitions } from "./he-drive.service.js";
import { applyEligibilityGate, type LeadFactsRow } from "./he-eligibility.service.js";
import { isHardReject, normProcess } from "./he-eligibility.js";
import { sendTemplateToLead, type SendResult } from "./he-send.service.js";
import { whatsappRequiresOptIn } from "./he-policy.service.js";

export interface RerouteSummary { considered: number; offered: number; noAlternative: number; blocked: Record<string, number>; dryRun: number }

export async function offerOtherRoles(o: { dryRun?: boolean; max?: number } = {}): Promise<RerouteSummary> {
  const out: RerouteSummary = { considered: 0, offered: 0, noAlternative: 0, blocked: {}, dryRun: 0 };
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT l.id, l.mobile10, l.ats_candidate_id, l.status, l.final_status, l.is_employee, l.age, l.last_attempt_date, l.walkin_count, l.last_outcome,
            x.process AS rejected_process, x.reason AS rejection_reason
       FROM he_lead l JOIN (
         SELECT s.candidate_id, s.interviewed_for_process AS process,
                COALESCE(NULLIF(s.round3_remarks,''), NULLIF(s.round2_remarks,''), NULLIF(s.round1_remarks,'')) AS reason FROM ats_interview_submission s
          WHERE s.final_decision LIKE '%reject%' AND s.submitted_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
         UNION ALL
         SELECT jrc.candidate_id, jr.process_name, jrc.remarks FROM job_requisition_candidate jrc JOIN job_requisition jr ON jr.id = jrc.requisition_id
          WHERE jrc.outcome = 'rejected' AND jrc.outcome_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
       ) x ON x.candidate_id = l.ats_candidate_id
      WHERE l.status NOT IN ('opted_out','joined','dead') AND l.is_employee = 0
        AND (EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL)
             OR (? = 0 AND NOT EXISTS (SELECT 1 FROM he_consent c2 WHERE c2.lead_id = l.id AND c2.consent_type = 'whatsapp_contact' AND c2.revoked_at IS NOT NULL)))
        AND NOT EXISTS (SELECT 1 FROM he_lead_event e WHERE e.lead_id = l.id AND e.event_type = 'other_role_offered' AND e.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY))
      LIMIT ?`, [(await whatsappRequiresOptIn()) ? 1 : 0, o.max ?? 50]);
  for (const r of rows) {
    // Someone turned down for misconduct, fake documents or the like is not offered anything else, whatever the consent policy says.
    if (isHardReject(r.rejection_reason as string | null)) { out.blocked.hard_rejected = (out.blocked.hard_rejected ?? 0) + 1; continue; }
    out.considered++;
    const alts = (await alternativeRequisitions(r.id as string, "", 10));
    const [procs] = alts.length ? await db.execute<RowDataPacket[]>(`SELECT id, process_name FROM job_requisition WHERE id IN (${alts.map(() => "?").join(",")})`, alts.map((a) => a.requisitionId)) : [[] as RowDataPacket[]];
    const procOf = new Map(procs.map((p) => [String(p.id), p.process_name as string | null]));
    let chosen: string | null = null;
    for (const a of alts) {
      const proc = procOf.get(a.requisitionId) ?? null;
      if (normProcess(proc) === normProcess(r.rejected_process)) continue;
      const gate = await applyEligibilityGate([r as unknown as LeadFactsRow], { id: a.requisitionId, processName: proc });
      if (gate.verdicts.get(r.id as string)?.eligible) { chosen = a.requisitionId; break; }
    }
    if (!chosen) { out.noAlternative++; continue; }
    if (o.dryRun) { out.dryRun++; continue; }
    await db.execute(
      `INSERT INTO he_match (lead_id, requisition_id, score, reasons_json, state, token) VALUES (?, ?, ?, ?, 'suggested', ?)
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [r.id, chosen, alts.find((a) => a.requisitionId === chosen)!.score, JSON.stringify({ reasons: ["offered after rejection in " + (r.rejected_process ?? "another process")] }), randomBytes(16).toString("hex")]);
    const [m] = await db.execute<RowDataPacket[]>("SELECT id FROM he_match WHERE lead_id = ? AND requisition_id = ? LIMIT 1", [r.id, chosen]);
    const res: SendResult = await sendTemplateToLead({ leadId: r.id as string, key: "he_other_role_offer", matchId: m[0].id as string });
    if (res.status === "sent") { out.offered++; await addEvent(r.id as string, "other_role_offered", { channel: "whatsapp", detail: `after rejection in ${r.rejected_process ?? "-"}` }); }
    else if (res.status === "blocked") out.blocked[res.reason] = (out.blocked[res.reason] ?? 0) + 1;
    else out.blocked.failed = (out.blocked.failed ?? 0) + 1;
  }
  return out;
}
