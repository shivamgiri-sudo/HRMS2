/**
 * Candidate 360: everything known about one person in one call, read in place from the existing tables
 * (nothing is copied): identities, attempts, requisitions touched, walk-ins and decisions, and today's eligibility.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { evaluateEligibility } from "./he-eligibility.js";
import { loadEligibilityFacts, type LeadFactsRow } from "./he-eligibility.service.js";

const OPEN_REQ_LIMIT = 25;

export async function getCandidate360(leadId: string): Promise<Record<string, unknown> | null> {
  const [lr] = await db.execute<RowDataPacket[]>(
    `SELECT id, mobile10, full_name, email, age, education_rank, experience_years, status, primary_source, sources_json, ats_candidate_id,
            attempt_count, first_attempt_date, last_attempt_date, walkin_count, last_walkin_date, last_outcome, final_status,
            conversion_type, is_employee, effort_tier, effort_reason, history_refreshed_at, final_status, status
       FROM he_lead WHERE id = ? LIMIT 1`, [leadId]);
  const lead = lr[0];
  if (!lead) return null;
  const atsId = (lead.ats_candidate_id as string | null) ?? null;

  const [identities] = await db.execute<RowDataPacket[]>("SELECT kind, value, is_primary, source FROM he_lead_identity WHERE lead_id = ? ORDER BY is_primary DESC, id", [leadId]);
  const [clashes] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.kind, c.value, c.status, o.mobile10 AS other_mobile, o.full_name AS other_name
       FROM he_identity_clash c JOIN he_lead o ON o.id = IF(c.lead_id_a = ?, c.lead_id_b, c.lead_id_a)
      WHERE (c.lead_id_a = ? OR c.lead_id_b = ?)`, [leadId, leadId, leadId]);
  const [attempts] = await db.execute<RowDataPacket[]>(
    `SELECT attempted_at, channel, source, branch, process, actor, outcome, walkin_flag, final_selection_flag, joined_flag, requisition_id
       FROM he_attempt_v WHERE mobile10 = ? ORDER BY attempted_at DESC LIMIT 200`, [lead.mobile10]);
  const [matches] = await db.execute<RowDataPacket[]>(
    `SELECT m.requisition_id, jr.requisition_code, jr.process_name, jr.designation_name AS position, jr.branch_name, m.state, m.score, m.slot_at, m.created_at
       FROM he_match m JOIN job_requisition jr ON jr.id = m.requisition_id WHERE m.lead_id = ? ORDER BY m.created_at DESC LIMIT 50`, [leadId]);
  let linked: RowDataPacket[] = []; let walkins: RowDataPacket[] = []; let interviews: RowDataPacket[] = [];
  if (atsId) {
    [linked] = await db.execute<RowDataPacket[]>(
      `SELECT jrc.requisition_id, jr.requisition_code, jr.process_name, jr.designation_name AS position, jr.branch_name, jrc.current_stage, jrc.outcome, jrc.outcome_at, jrc.remarks
         FROM job_requisition_candidate jrc JOIN job_requisition jr ON jr.id = jrc.requisition_id WHERE jrc.candidate_id = ? ORDER BY jrc.linked_at DESC LIMIT 50`, [atsId]);
    [walkins] = await db.execute<RowDataPacket[]>(
      `SELECT walk_in_date, branch, process, source_channel, prior_stage, prior_decision FROM ats_candidate_rewalkin WHERE candidate_id = ? ORDER BY walk_in_date DESC LIMIT 50`, [atsId]);
    [interviews] = await db.execute<RowDataPacket[]>(
      `SELECT interviewed_for_process AS process, final_decision, walkin_end_stage, submitted_at FROM ats_interview_submission WHERE candidate_id = ? ORDER BY submitted_at DESC LIMIT 50`, [atsId]);
  }
  const [prof] = await db.execute<RowDataPacket[]>(
    `SELECT gender, languages, certifications, typing_wpm, english_level, salary_expectation, last_salary, education_status, stream, prev_industry, last_employer, state, address, dob
       FROM he_lead_profile WHERE lead_id = ? LIMIT 1`, [leadId]);
  const [ex] = await db.execute<RowDataPacket[]>("SELECT exit_type, exit_sub_type, exit_reason, exit_date, would_rejoin, clean_voluntary FROM he_ex_employee WHERE mobile10 = ? LIMIT 1", [lead.mobile10]);

  const [open] = await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_code, process_name, designation_name AS position, branch_name FROM job_requisition
      WHERE approval_status = 'approved' AND active_status = 1 AND fulfilled_headcount < requested_headcount ORDER BY created_at DESC LIMIT ${OPEN_REQ_LIMIT}`);
  const eligibility: Array<Record<string, unknown>> = [];
  for (const r of open) {
    const facts = (await loadEligibilityFacts([lead as unknown as LeadFactsRow], { id: r.id as string, processName: (r.process_name as string | null) ?? null })).get(leadId);
    if (!facts) continue;
    const v = evaluateEligibility(facts);
    eligibility.push({ requisitionId: r.id, code: r.requisition_code, process: r.process_name, position: r.position, branch: r.branch_name, ...v });
  }

  const approachesByRequisition: Record<string, number> = {};
  for (const a of attempts) if (a.requisition_id) approachesByRequisition[a.requisition_id as string] = (approachesByRequisition[a.requisition_id as string] ?? 0) + 1;

  return { lead, profile: prof[0] ?? null, identities, clashes, attempts, approachesByRequisition, requisitions: { engine: matches, linked }, walkins, interviews, exEmployee: ex[0] ?? null, eligibility };
}
