/**
 * Auto-successor (owner requirement): when a campaign's primary requisition is filled, closed or inactive, the campaign moves to the
 * best open requisition so new leads are never stranded on a dead requisition. Priority: same branch AND same process, then same
 * branch with another process, then a linked or same-branch-family requisition; the designation must always match.
 * sweepStrandedLeads does the same for qualified, never-contacted leads already sitting on a closed requisition. Off unless env META_AUTO_SUCCESSOR names the campaign or says all. Leads already placed never move here (the HR
 * relink does that); only the campaign's primary changes, and the switch is audited in meta_campaign_relink with leads_moved 0.
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { closedReasonOf, syncPrimaryLink } from "./campaign-requisition.service.js";
import { isLeadContactedSql, optionalTables } from "./lead-contact-lock.js";

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const branchFamily = (b: unknown): string => String(b ?? "").toUpperCase().replace(/[-\s]*\d+$/, "").trim();

export interface Candidate { id: string; designation: string; branch: string; process: string; validity: string | null; seatsLeft: number; linked: boolean }

/**
 * Pure ranking. Eligible: seats left, not past its end date, same designation, same branch (family) or already linked to the campaign.
 * Order: same branch + same process, same branch + other process, linked, then more seats left, then the later validity.
 */
export function pickSuccessor(current: { designation: string; branch: string; process?: string }, candidates: Candidate[], today: string): Candidate | null {
  const sameBranch = (c: Candidate) => c.branch.toUpperCase() === current.branch.toUpperCase();
  const sameProcess = (c: Candidate) => !!current.process && c.process.toUpperCase() === current.process.toUpperCase();
  const ok = candidates.filter((c) => c.seatsLeft > 0 && c.designation.toUpperCase() === current.designation.toUpperCase()
    && (!c.validity || c.validity >= today) && (c.linked || sameBranch(c) || branchFamily(c.branch) === branchFamily(current.branch)));
  const tier = (c: Candidate) => (sameBranch(c) && sameProcess(c) ? 0 : sameBranch(c) ? 1 : c.linked ? 2 : 3);
  ok.sort((a, b) => tier(a) - tier(b) || b.seatsLeft - a.seatsLeft || String(b.validity ?? "9999").localeCompare(String(a.validity ?? "9999")));
  return ok[0] ?? null;
}

export function autoSuccessorOn(campaignId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.META_AUTO_SUCCESSOR ?? "").trim();
  if (!v || /^(off|0|false)$/i.test(v)) return false;
  if (/^(all|1|true|on)$/i.test(v)) return true;
  return v.split(",").map((x) => x.trim()).includes(campaignId);
}

const toCandidate = (r: RowDataPacket): Candidate => ({
  id: String(r.id), designation: String(r.designation_name), branch: String(r.branch_name), process: String(r.process_id ?? r.process_name ?? ""),
  validity: r.requisition_validity ? String(r.requisition_validity).slice(0, 10) : null,
  seatsLeft: Number(r.requested_headcount) - Number(r.fulfilled_headcount), linked: Number(r.linked) === 1,
});

/** The successor for a closed requisition `cur` in the context of `campaignId`; null when none qualifies. Seats are HR's fulfilled_headcount only. */
async function successorFor(campaignId: string, cur: RowDataPacket, now: Date): Promise<Candidate | null> {
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT j.*, EXISTS (SELECT 1 FROM meta_campaign_requisition l WHERE l.campaign_id = ? AND l.requisition_id = j.id AND l.removed_at IS NULL) AS linked
       FROM job_requisition j WHERE j.id <> ? AND j.designation_name = ? AND j.active_status = 1 AND j.approval_status = 'approved' AND j.closed_at IS NULL
        AND j.fulfilled_headcount < j.requested_headcount AND (j.requisition_validity IS NULL OR j.requisition_validity >= ?)`,
    [campaignId, String(cur.id), String(cur.designation_name), today]);
  return pickSuccessor(
    { designation: String(cur.designation_name), branch: String(cur.branch_name), process: String(cur.process_id ?? cur.process_name ?? "") },
    rows.filter((r) => !closedReasonOf(r)).map(toCandidate), today);
}

/** Returns the new primary requisition id when the campaign was switched, else null. Never throws. */
export async function ensureOpenPrimary(campaignId: string, now = new Date()): Promise<string | null> {
  try {
    if (!autoSuccessorOn(campaignId)) return null;
    const [c] = await db.execute<RowDataPacket[]>("SELECT requisition_id FROM meta_campaign WHERE id = ? LIMIT 1", [campaignId]);
    const curId = String(c[0]?.requisition_id ?? "");
    if (!curId) return null;
    const [cur] = await db.execute<RowDataPacket[]>("SELECT * FROM job_requisition WHERE id = ? LIMIT 1", [curId]);
    if (!cur[0] || !closedReasonOf(cur[0])) return null;
    const pick = await successorFor(campaignId, cur[0], now);
    if (!pick) return null;
    await db.execute("UPDATE meta_campaign SET requisition_id = ? WHERE id = ? AND requisition_id = ?", [pick.id, campaignId, curId]);
    await syncPrimaryLink(db, campaignId, pick.id, null);
    await audit(campaignId, curId, pick.id, 0, `auto-successor: ${closedReasonOf(cur[0])}`);
    console.warn(`[meta] campaign ${campaignId} auto-switched from ${curId} to ${pick.id}`);
    return pick.id;
  } catch (e) {
    console.warn("[meta] auto-successor failed", e instanceof Error ? e.message.split("\n")[0] : e);
    return null;
  }
}

async function audit(campaignId: string, from: string, to: string, moved: number, reason: string): Promise<void> {
  await db.execute(
    `INSERT INTO meta_campaign_relink (id, campaign_id, from_requisition_id, to_requisition_id, leads_moved, leads_kept, preview_hash, actor_id, actor_role, reason)
     VALUES (?, ?, ?, ?, ?, 0, '', ?, 'system', ?)`, [randomUUID(), campaignId, from, to, moved, SYSTEM_ACTOR, reason.slice(0, 300)]);
}

export const SWEEP_MAX_PER_PAIR = 1000;

/**
 * Qualified leads nobody has contacted that sit on a closed/filled requisition move to that requisition's successor (same rules as
 * above). Contacted people, disqualified and pending leads never move. Each (campaign, closed requisition) pair is one transaction
 * with one audit row. Returns how many leads moved. Never throws.
 */
export async function sweepStrandedLeads(now = new Date()): Promise<{ pairs: number; moved: number }> {
  const out = { pairs: 0, moved: 0 };
  try {
    const tables = await optionalTables();
    const [pairs] = await db.execute<RowDataPacket[]>(
      `SELECT r.campaign_id, r.requisition_id, COUNT(*) n FROM meta_lead_raw r JOIN job_requisition j ON j.id = r.requisition_id
        WHERE r.screening_result = 'qualified' AND r.campaign_id IS NOT NULL AND r.notification_sent_at IS NULL
          AND (j.approval_status IN ('closed','cancelled','rejected') OR j.active_status = 0 OR j.closed_at IS NOT NULL OR j.fulfilled_headcount >= j.requested_headcount)
        GROUP BY r.campaign_id, r.requisition_id ORDER BY n DESC LIMIT 25`);
    for (const p of pairs) {
      const campaignId = String(p.campaign_id), fromId = String(p.requisition_id);
      if (!autoSuccessorOn(campaignId)) continue;
      const [cur] = await db.execute<RowDataPacket[]>("SELECT * FROM job_requisition WHERE id = ? LIMIT 1", [fromId]);
      if (!cur[0] || !closedReasonOf(cur[0])) continue;
      const pick = await successorFor(campaignId, cur[0], now);
      if (!pick) continue;
      const c = await db.getConnection();
      try {
        await c.beginTransaction();
        await c.execute(`INSERT IGNORE INTO meta_campaign_requisition (campaign_id, requisition_id, is_primary, sort_order) VALUES (?, ?, 0, 5)`, [campaignId, pick.id]);
        const [u] = await c.execute(
          `UPDATE meta_lead_raw r SET r.requisition_id = ?, r.routed_by = 'best_fit', r.routed_at = NOW()
            WHERE r.campaign_id = ? AND r.requisition_id = ? AND r.screening_result = 'qualified' AND NOT ${isLeadContactedSql("r", tables)} LIMIT ${SWEEP_MAX_PER_PAIR}`,
          [pick.id, campaignId, fromId]);
        const moved = Number((u as { affectedRows?: number }).affectedRows ?? 0);
        await c.execute(
          `INSERT INTO meta_campaign_relink (id, campaign_id, from_requisition_id, to_requisition_id, leads_moved, leads_kept, preview_hash, actor_id, actor_role, reason)
           VALUES (?, ?, ?, ?, ?, 0, '', ?, 'system', ?)`,
          [randomUUID(), campaignId, fromId, pick.id, moved, SYSTEM_ACTOR, `auto-sweep: ${closedReasonOf(cur[0])}`.slice(0, 300)]);
        await c.commit();
        out.pairs += 1; out.moved += moved;
      } catch (e) {
        try { await c.rollback(); } catch { /* keep the original error */ }
        console.warn("[meta] stranded-lead sweep failed for one requisition", e instanceof Error ? e.message.split("\n")[0] : e);
      } finally { c.release(); }
    }
  } catch (e) {
    console.warn("[meta] stranded-lead sweep failed", e instanceof Error ? e.message.split("\n")[0] : e);
  }
  return out;
}
