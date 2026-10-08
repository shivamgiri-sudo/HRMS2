// ONE Live Meta arrival path (final integration, criteria hook item 7). A qualified Live Meta lead is enrolled either through the
// criteria (a standing approval for its requisition and policy.shortlist.enrol = 1: enrolLiveArrival evaluates it, a pass enrols through
// the enrolment port, a review waits for HR) or through the unified enqueueMetaLeadFollowup. Both end in enqueueQualifiedFollowup (one
// row per mobile and requisition), so a second call answers "exists". Used by the Meta ingest (including best-fit routed leads), HR's
// placement of a held lead, the 30-minute sync safety net and the legacy path's automatic enrolment. Never throws.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { loadFollowupSwitches, type FollowupSwitches } from "../hiring-engine/qualified-followup.policy.js";
import { enqueueMetaLeadFollowup } from "../hiring-engine/qualified-followup.service.js";
import { enrolLiveArrival, standingApprovalFor } from "./approval.service.js";
import { currentFollowupPort } from "./enrolment-port.js";
import { loadMetaLeadFacts } from "./facts-loader.service.js";
import { shortlistEnrolOn } from "./selection-switches.js";

export type ArrivalResult = { path: "unified"; status: string; id?: string } | { path: "standing_approval"; decision: string; status?: string; id?: string };

const autoNotifyOff = (v: unknown): boolean => {
  try { const o = typeof v === "string" ? JSON.parse(v) : v; return Boolean(o && typeof o === "object" && (o as { auto_notify?: unknown }).auto_notify === false); } catch { return false; }
};

async function unified(metaLeadId: string, sw: FollowupSwitches, skipOutreach: boolean): Promise<ArrivalResult> {
  const r = await enqueueMetaLeadFollowup(metaLeadId, { switches: sw, skipOutreach });
  return r.id ? { path: "unified", status: r.status, id: r.id } : { path: "unified", status: r.status };
}

export async function enrolMetaArrival(metaLeadId: string, o: { switches?: FollowupSwitches; skipOutreach?: boolean; now?: Date } = {}): Promise<ArrivalResult> {
  const sw = o.switches ?? (await loadFollowupSwitches());
  // Source off (the unified enrolment answers skipped_off without a statement) or a backfill (held for HR): no criteria read.
  if (sw.sourceModes.meta_live === "off" || o.skipOutreach) return unified(metaLeadId, sw, Boolean(o.skipOutreach));
  const now = o.now ?? new Date();
  try {
    if (await shortlistEnrolOn()) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT r.id, r.requisition_id, r.campaign_id, r.ats_candidate_id, r.screening_result, jr.meta_screening_config
           FROM meta_lead_raw r LEFT JOIN job_requisition jr ON jr.id = r.requisition_id WHERE r.id = ? LIMIT 1`, [metaLeadId]);
      const lead = rows[0];
      const requisitionId = lead?.requisition_id ? String(lead.requisition_id) : null;
      if (lead && requisitionId && lead.screening_result === "qualified" && (await standingApprovalFor(requisitionId, now))) {
        const facts = await loadMetaLeadFacts(metaLeadId, now);
        if (facts) {
          const out = await enrolLiveArrival({ requisitionId, facts, port: currentFollowupPort, now, arrival: {
            metaLeadId, campaignId: lead.campaign_id ? String(lead.campaign_id) : null, atsCandidateId: lead.ats_candidate_id ? String(lead.ats_candidate_id) : null,
            heldReason: autoNotifyOff(lead.meta_screening_config) ? "auto_notify_off" : null } });
          return { path: "standing_approval", ...out };
        }
      }
    }
  } catch (err) {
    // The criteria path refused (requisition no longer open, criteria incomplete, enrolment mode changed) or failed: today's enrolment.
    logger.warn({ metaLeadId, err: String((err as Error).message).slice(0, 200) }, "[selection] Live Meta arrival not enrolled through the criteria; unified enrolment used");
  }
  return unified(metaLeadId, sw, false);
}
