/**
 * Loads the facts the pure eligibility gate needs, in batches (never per lead), and applies the gate to a list.
 * Sources are read in place: ATS interview submissions, requisition links, recruiter activity, the attempt view,
 * bookings and the ex-employee table.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { evaluateEligibility, type Eligibility, type EligibilityFacts, type PastRejection } from "./he-eligibility.js";

const CHUNK = 1000;

export interface LeadFactsRow {
  id: string;
  mobile10: string;
  ats_candidate_id: string | null;
  status: string;
  final_status: "none" | "rejected" | "selected" | "joined";
  is_employee: number;
  age: number | null;
  last_attempt_date: string | null;
  walkin_count: number;
  last_outcome: string | null;
}

function chunks<T>(a: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += CHUNK) out.push(a.slice(i, i + CHUNK));
  return out;
}
const ph = (n: number) => Array(n).fill("?").join(",");
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export async function loadEligibilityFacts(
  leads: LeadFactsRow[],
  requisition: { id: string; processName: string | null },
  now = new Date(),
): Promise<Map<string, EligibilityFacts>> {
  const rejectionsByLead = new Map<string, PastRejection[]>();
  const push = (leadId: string | undefined, r: PastRejection) => {
    if (!leadId) return;
    const a = rejectionsByLead.get(leadId) ?? [];
    a.push(r);
    rejectionsByLead.set(leadId, a);
  };
  const byAts = new Map<string, string>();
  const byMobile = new Map<string, string>();
  for (const l of leads) {
    if (l.ats_candidate_id) byAts.set(l.ats_candidate_id, l.id);
    byMobile.set(l.mobile10, l.id);
  }
  const exEmp = new Map<string, boolean>();
  const approaches = new Map<string, number>();
  const selectedHere = new Set<string>();
  const bookedHere = new Set<string>();
  const noShows = new Map<string, number>();

  for (const part of chunks([...byAts.keys()])) {
    const [s] = await db.execute<RowDataPacket[]>(
      `SELECT candidate_id, interviewed_for_process AS process, submitted_at AS at,
              COALESCE(NULLIF(round3_remarks,''), NULLIF(round2_remarks,''), NULLIF(round1_remarks,'')) AS reason
         FROM ats_interview_submission WHERE candidate_id IN (${ph(part.length)}) AND final_decision LIKE '%reject%'`, part);
    for (const r of s) push(byAts.get(r.candidate_id), { process: r.process, at: iso(r.at), reason: r.reason });
    const [j] = await db.execute<RowDataPacket[]>(
      `SELECT jrc.candidate_id, jr.process_name AS process, jrc.outcome_at AS at, jrc.remarks AS reason
         FROM job_requisition_candidate jrc JOIN job_requisition jr ON jr.id = jrc.requisition_id
        WHERE jrc.candidate_id IN (${ph(part.length)}) AND jrc.outcome = 'rejected'`, part);
    for (const r of j) push(byAts.get(r.candidate_id), { process: r.process, at: iso(r.at), reason: r.reason });
  }
  for (const part of chunks([...byMobile.keys()])) {
    const [a] = await db.execute<RowDataPacket[]>(
      `SELECT mobile10, process_name AS process, activity_date AS at,
              COALESCE(NULLIF(hr_rejection_reason,''), NULLIF(ops_rejection_reason,''), NULLIF(recruiter_rejection_reason,'')) AS reason
         FROM ats_recruiter_hiring_activity
        WHERE mobile10 IN (${ph(part.length)})
          AND (hr_interview_status LIKE '%reject%' OR ops_interview_status LIKE '%reject%'
               OR COALESCE(hr_rejection_reason,'') <> '' OR COALESCE(ops_rejection_reason,'') <> '')`, part);
    for (const r of a) push(byMobile.get(r.mobile10), { process: r.process, at: iso(r.at), reason: r.reason });
    const [x] = await db.execute<RowDataPacket[]>(`SELECT mobile10, clean_voluntary FROM he_ex_employee WHERE mobile10 IN (${ph(part.length)})`, part);
    for (const r of x) exEmp.set(r.mobile10, Number(r.clean_voluntary) === 1);
    const [c] = await db.execute<RowDataPacket[]>(
      `SELECT mobile10, COUNT(*) AS n FROM he_attempt_v WHERE mobile10 IN (${ph(part.length)}) AND attempted_at >= DATE_SUB(?, INTERVAL 30 DAY) GROUP BY mobile10`, [...part, now]);
    for (const r of c) approaches.set(r.mobile10, Number(r.n));
  }
  const leadIds = leads.map((l) => l.id);
  for (const part of chunks(leadIds)) {
    const [m] = await db.execute<RowDataPacket[]>(
      `SELECT m.lead_id, m.state, m.slot_at FROM he_match m LEFT JOIN he_drive d ON d.id = m.drive_id
        WHERE m.requisition_id = ? AND m.lead_id IN (${ph(part.length)}) AND (d.id IS NULL OR d.status <> 'closed' OR m.state = 'selected')`, [requisition.id, ...part]);
    for (const r of m) {
      if (r.state === "selected") selectedHere.add(r.lead_id);
      if ((r.state === "invited" || r.state === "confirmed") && r.slot_at && new Date(r.slot_at) >= now) bookedHere.add(r.lead_id);
    }
    const [n] = await db.execute<RowDataPacket[]>(
      `SELECT e.lead_id, COUNT(*) AS n FROM he_lead_event e JOIN he_drive d ON d.id = e.drive_id
        WHERE e.event_type = 'no_show' AND d.requisition_id = ? AND e.lead_id IN (${ph(part.length)}) GROUP BY e.lead_id`, [requisition.id, ...part]);
    for (const r of n) noShows.set(r.lead_id, Number(r.n));
  }

  const out = new Map<string, EligibilityFacts>();
  for (const l of leads) {
    out.set(l.id, {
      status: l.status, finalStatus: l.final_status, isEmployee: Number(l.is_employee) === 1, age: l.age,
      lastAttemptDate: l.last_attempt_date ? String(l.last_attempt_date).slice(0, 10) : null,
      walkinCount: Number(l.walkin_count ?? 0), lastOutcome: l.last_outcome,
      approaches30d: approaches.get(l.mobile10) ?? 0,
      exEmployee: exEmp.has(l.mobile10) ? { cleanVoluntary: exEmp.get(l.mobile10)! } : null,
      requisition: { processName: requisition.processName },
      rejections: rejectionsByLead.get(l.id) ?? [],
      alreadySelectedForRequisition: selectedHere.has(l.id), alreadyBookedForRequisition: bookedHere.has(l.id),
      noShowsForRequisition: noShows.get(l.id) ?? 0, now,
    });
  }
  return out;
}

export interface GateResult { verdicts: Map<string, Eligibility>; blockedByReason: Record<string, number>; }

export async function applyEligibilityGate(leads: LeadFactsRow[], requisition: { id: string; processName: string | null }): Promise<GateResult> {
  const facts = await loadEligibilityFacts(leads, requisition);
  const verdicts = new Map<string, Eligibility>();
  const blockedByReason: Record<string, number> = {};
  for (const [id, f] of facts) {
    const v = evaluateEligibility(f);
    verdicts.set(id, v);
    for (const b of v.blocks) blockedByReason[b] = (blockedByReason[b] ?? 0) + 1;
  }
  return { verdicts, blockedByReason };
}
