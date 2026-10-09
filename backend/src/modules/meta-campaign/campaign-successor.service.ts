/**
 * Auto-successor (owner requirement): when a campaign's primary requisition is filled, closed or inactive, the campaign moves to the
 * best open requisition of the same designation (a linked one first, then one in the same branch family) so new leads are never
 * stranded on a dead requisition. Off unless env META_AUTO_SUCCESSOR names the campaign or says all. Leads already placed never move here (the HR
 * relink does that); only the campaign's primary changes, and the switch is audited in meta_campaign_relink with leads_moved 0.
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { closedReasonOf, syncPrimaryLink } from "./campaign-requisition.service.js";

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const branchFamily = (b: unknown): string => String(b ?? "").toUpperCase().replace(/[-\s]*\d+$/, "").trim();

export interface Candidate { id: string; designation: string; branch: string; validity: string | null; seatsLeft: number; linked: boolean }

/** Pure ranking: linked first, then same branch, then most seats left, then the later validity. */
export function pickSuccessor(current: { designation: string; branch: string }, candidates: Candidate[], today: string): Candidate | null {
  const ok = candidates.filter((c) => c.seatsLeft > 0 && c.designation.toUpperCase() === current.designation.toUpperCase()
    && (!c.validity || c.validity >= today) && (c.linked || branchFamily(c.branch) === branchFamily(current.branch)));
  ok.sort((a, b) => Number(b.linked) - Number(a.linked)
    || Number(b.branch === current.branch) - Number(a.branch === current.branch)
    || b.seatsLeft - a.seatsLeft || String(b.validity ?? "9999").localeCompare(String(a.validity ?? "9999")));
  return ok[0] ?? null;
}

/** META_AUTO_SUCCESSOR = all | <campaign id>,<campaign id>; unset/off = not one statement more on the ingest path. */
export function autoSuccessorOn(campaignId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.META_AUTO_SUCCESSOR ?? "").trim();
  if (!v || /^(off|0|false)$/i.test(v)) return false;
  if (/^(all|1|true|on)$/i.test(v)) return true;
  return v.split(",").map((x) => x.trim()).includes(campaignId);
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
    const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT j.*, EXISTS (SELECT 1 FROM meta_campaign_requisition l WHERE l.campaign_id = ? AND l.requisition_id = j.id AND l.removed_at IS NULL) AS linked
         FROM job_requisition j WHERE j.id <> ? AND j.designation_name = ? AND j.active_status = 1 AND j.approval_status = 'approved' AND j.closed_at IS NULL
          AND j.fulfilled_headcount < j.requested_headcount AND (j.requisition_validity IS NULL OR j.requisition_validity >= ?)`,
      [campaignId, curId, String(cur[0].designation_name), today]);
    const open = rows.filter((r) => !closedReasonOf(r));
    const pick = pickSuccessor(
      { designation: String(cur[0].designation_name), branch: String(cur[0].branch_name) },
      open.map((r) => ({ id: String(r.id), designation: String(r.designation_name), branch: String(r.branch_name), validity: r.requisition_validity ? String(r.requisition_validity).slice(0, 10) : null,
        seatsLeft: Number(r.requested_headcount) - Number(r.fulfilled_headcount), linked: Number(r.linked) === 1 })), today);
    if (!pick) return null;
    await db.execute("UPDATE meta_campaign SET requisition_id = ? WHERE id = ? AND requisition_id = ?", [pick.id, campaignId, curId]);
    await syncPrimaryLink(db, campaignId, pick.id, null);
    await db.execute(
      `INSERT INTO meta_campaign_relink (id, campaign_id, from_requisition_id, to_requisition_id, leads_moved, leads_kept, preview_hash, actor_id, actor_role, reason)
       VALUES (?, ?, ?, ?, 0, 0, '', ?, 'system', ?)`,
      [randomUUID(), campaignId, curId, pick.id, SYSTEM_ACTOR, `auto-successor: ${closedReasonOf(cur[0])}`.slice(0, 300)]);
    console.warn(`[meta] campaign ${campaignId} auto-switched from ${curId} to ${pick.id}`);
    return pick.id;
  } catch (e) {
    console.warn("[meta] auto-successor failed", e instanceof Error ? e.message.split("\n")[0] : e);
    return null;
  }
}
