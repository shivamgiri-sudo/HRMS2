/**
 * Planner facts: per-source history for a branch+process (falling back to process, then everything), read from the
 * recruiter attempt ledger, plus how much of the existing pool is already reachable for this requisition.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildPlan, type Plan, type SourceHistory } from "./he-planner.js";

export interface PlannerRequest { requisitionId?: string | null; branch?: string | null; process?: string | null; targetSelected?: number | null; deadline?: string | null; months?: number | null; bufferPct?: number | null }
export interface PlannerResponse extends Plan {
  scope: "branch+process" | "process" | "all";
  requisition: { id: string; code: string; branch: string; process: string | null; position: string; openPositions: number } | null;
  pool: { reachableNow: number; suggested: number; invitedOrConfirmed: number };
  historyMonths: number;
}

// Per-source history moves slowly (one day's calls barely change a 6-month rate), and the grouped scan of the recruiter
// ledger takes seconds on production, so each scope is cached for 15 minutes.
const histCache = new Map<string, { at: number; rows: SourceHistory[] }>();
async function history(where: string, args: unknown[], months: number): Promise<SourceHistory[]> {
  const key = JSON.stringify([where, args, months]);
  const hit = histCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.rows;
  const rows = await historyUncached(where, args, months);
  if (histCache.size > 300) histCache.clear();
  histCache.set(key, { at: Date.now(), rows });
  return rows;
}

async function historyUncached(where: string, args: unknown[], months: number): Promise<SourceHistory[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(hiring_source), ''), 'Unknown') AS source, COUNT(*) AS attempts, COUNT(DISTINCT mobile10) AS uniqueLeads,
            COUNT(DISTINCT CASE WHEN walkin_flag OR final_selection_flag OR joined_flag THEN mobile10 END) AS walkins,
            COUNT(DISTINCT CASE WHEN final_selection_flag OR joined_flag THEN mobile10 END) AS selected,
            COUNT(DISTINCT CASE WHEN joined_flag THEN mobile10 END) AS joined
       FROM ats_recruiter_hiring_activity
      WHERE activity_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH) ${where}
      GROUP BY source ORDER BY uniqueLeads DESC LIMIT 20`, [months, ...args]);
  return rows.map((r) => ({ source: String(r.source), attempts: Number(r.attempts), uniqueLeads: Number(r.uniqueLeads), walkins: Number(r.walkins), selected: Number(r.selected), joined: Number(r.joined) }));
}

export async function planHiring(q: PlannerRequest): Promise<PlannerResponse> {
  let requisition: PlannerResponse["requisition"] = null;
  let branch = q.branch?.trim() || null, proc = q.process?.trim() || null;
  if (q.requisitionId) {
    const [r] = await db.execute<RowDataPacket[]>(
      "SELECT id, requisition_code, branch_name, process_name, designation_name, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1", [q.requisitionId]);
    if (r[0]) {
      requisition = { id: r[0].id, code: r[0].requisition_code, branch: r[0].branch_name, process: r[0].process_name, position: r[0].designation_name, openPositions: Math.max(0, Number(r[0].requested_headcount) - Number(r[0].fulfilled_headcount)) };
      branch = branch ?? r[0].branch_name; proc = proc ?? r[0].process_name;
    }
  }
  const months = Math.min(24, Math.max(1, Math.floor(q.months ?? 6)));
  const target = Math.max(1, Math.floor(q.targetSelected ?? requisition?.openPositions ?? 1));
  const deadline = q.deadline ? new Date(q.deadline + "T23:59:59+05:30") : null;
  const days = deadline ? Math.max(1, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000)) : 7;

  let scope: PlannerResponse["scope"] = "all";
  let hist: SourceHistory[] = [];
  if (branch && proc) { hist = await history("AND branch_name = ? AND process_name = ?", [branch, proc], months); scope = "branch+process"; }
  if (hist.reduce((a, h) => a + h.uniqueLeads, 0) < 50 && proc) { hist = await history("AND process_name = ?", [proc], months); scope = "process"; }
  if (hist.reduce((a, h) => a + h.uniqueLeads, 0) < 50) { hist = await history("", [], months); scope = "all"; }

  const plan = buildPlan({ targetSelected: target, days, bufferPct: q.bufferPct ?? 15, history: hist });
  let pool = { reachableNow: 0, suggested: 0, invitedOrConfirmed: 0 };
  if (requisition) {
    const [p] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(m.state = 'suggested') AS suggested, SUM(m.state IN ('invited','confirmed')) AS booked,
              SUM(m.state = 'suggested' AND (COALESCE(l.email,'') <> '' OR EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = m.lead_id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL))) AS reachable
         FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.requisition_id = ?`, [requisition.id]);
    pool = { reachableNow: Number(p[0]?.reachable ?? 0), suggested: Number(p[0]?.suggested ?? 0), invitedOrConfirmed: Number(p[0]?.booked ?? 0) };
    if (pool.reachableNow < plan.totals.uniqueLeads) plan.notes.push(`The pool already holds ${pool.reachableNow} reachable matches for this requisition; source about ${plan.totals.uniqueLeads - pool.reachableNow} more leads.`);
    else plan.notes.push(`The existing pool covers the lead requirement: work the ${pool.reachableNow} reachable matches before buying new leads.`);
  }
  if (scope !== "branch+process") plan.notes.unshift(scope === "process" ? "Too little history at this branch: rates come from the same process across branches." : "Too little history for this process: rates come from all hiring.");
  return { ...plan, scope, requisition, pool, historyMonths: months };
}
