/**
 * Eligibility at enrolment for people who did not come through a drive line-up (Live Meta leads): the line-up gate
 * (he-eligibility.ts: cooling-off, 6 approaches / 30 days, 3 no-shows here, ex-employees, hard rejects, ...) plus the Meta
 * location rule (he-location-match.ts, the one the legacy outreach applies). Line-ups are already gated and skip this.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { evaluateEligibility } from "./he-eligibility.js";
import { loadEligibilityFacts, type LeadFactsRow } from "./he-eligibility.service.js";
import { locationVerdict } from "./he-location-match.js";
import { getCoolingOffDays } from "./he-policy.service.js";

export interface EnrolLocation { text: string | null; branchName: string | null; branchCity: string | null; branchState: string | null }

const CODE: Record<string, string> = {
  rejected_in_process_cooling: "cooling_off", contact_cap_30d: "approach_cap", no_show_cap_here: "no_show_cap",
  ex_employee_not_eligible: "ex_employee", hard_rejected_in_process: "hard_reject",
};

/** The stopped_reason suffix for the first block (gate order), or location_elsewhere; null = eligible. */
export function ineligibleCode(blocks: readonly string[], locationElsewhere: boolean): string | null {
  if (blocks.length) return CODE[blocks[0]] ?? blocks[0];
  return locationElsewhere ? "location_elsewhere" : null;
}

export async function enrolIneligibility(i: {
  mobile10: string; heLeadId: string | null; atsCandidateId: string | null; requisitionId: string; location?: EnrolLocation | null; now?: Date;
}): Promise<string | null> {
  const now = i.now ?? new Date();
  const [l] = await db.execute<RowDataPacket[]>(
    `SELECT id, mobile10, ats_candidate_id, status, final_status, is_employee, age, last_attempt_date, walkin_count, last_outcome FROM he_lead
      WHERE ${i.heLeadId ? "id = ?" : "mobile10 = ? COLLATE utf8mb4_unicode_ci"} LIMIT 1`, [i.heLeadId ?? i.mobile10]);
  // Someone with no Hiring Engine record yet: a blank record, so the mobile-based rules (rejections, approaches, ex-employee) still apply.
  const lead = (l[0] as LeadFactsRow | undefined) ?? {
    id: "-", mobile10: i.mobile10, ats_candidate_id: i.atsCandidateId, status: "new", final_status: "none", is_employee: 0, age: null,
    last_attempt_date: null, walkin_count: 0, last_outcome: null,
  };
  const [jr] = await db.execute<RowDataPacket[]>("SELECT process_name FROM job_requisition WHERE id = ? LIMIT 1", [i.requisitionId]);
  const facts = (await loadEligibilityFacts([lead], { id: i.requisitionId, processName: (jr[0]?.process_name as string | null) ?? null }, now)).get(lead.id);
  const blocks = facts ? evaluateEligibility(facts, { coolingDays: await getCoolingOffDays() }).blocks : [];
  const loc = i.location;
  const elsewhere = Boolean(loc?.branchName) && locationVerdict(loc?.text, loc?.branchName, loc?.branchCity, loc?.branchState) === "elsewhere";
  return ineligibleCode(blocks, elsewhere);
}
