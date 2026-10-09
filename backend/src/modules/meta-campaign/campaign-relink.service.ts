/**
 * Relink a campaign to an open requisition (owner requirement: the K7BK situation, a live campaign linked to a closed requisition).
 * Two steps, nothing written before HR confirms:
 *  1. preview: the target must be open; the campaign's leads on the current primary are split into "will move" (never contacted) and
 *     "stay" (contacted: notified, matched, invited or in a follow-up), with counts by screening result and a hash of the exact set;
 *  2. apply: re-reads the preview, refuses (409) when the set changed since HR saw it, then in one transaction links the target as the
 *     primary (the old one stays linked, not primary), moves the uncontacted leads (routed_by 'hr') and writes the audit row.
 * The preview also warns when the campaign's form carries a hidden routing code for another requisition: the routing-code self-heal would
 * re-point the campaign on the next lead unless the form is changed.
 */
import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { extractRoutingCode } from "./meta-lead.parser.js";
import { closedReasonOf, type LinkActor } from "./campaign-requisition.service.js";
import { isLeadContactedSql, optionalTables } from "./lead-contact-lock.js";

export interface RelinkPreview {
  campaignId: string; fromRequisitionId: string | null; fromCode: string | null; fromClosedReason: string | null;
  toRequisitionId: string; toCode: string; toBranch: string;
  move: { total: number; qualified: number; disqualified: number; pending: number }; stay: number;
  warnings: string[]; previewHash: string;
}

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const CHUNK = 500;

async function leadsOf(campaignId: string, fromId: string | null): Promise<RowDataPacket[]> {
  const t = await optionalTables();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.screening_result, ${isLeadContactedSql("r", t)} AS contacted FROM meta_lead_raw r
      WHERE r.campaign_id = ? AND (r.requisition_id IS NULL${fromId ? " OR r.requisition_id = ?" : ""}) ORDER BY r.id`,
    fromId ? [campaignId, fromId] : [campaignId]);
  return rows;
}

export async function previewRelink(campaignId: string, toRequisitionId: string): Promise<RelinkPreview & { moveIds: string[] }> {
  const [c] = await db.execute<RowDataPacket[]>("SELECT id, requisition_id, meta_form_id FROM meta_campaign WHERE id = ? LIMIT 1", [campaignId]);
  if (!c[0]) throw fail(404, "Campaign not found");
  const fromId = String(c[0].requisition_id ?? "") || null;
  if (fromId === toRequisitionId) throw fail(409, "The campaign is already linked to that requisition");
  const [reqs] = await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_code, branch_name, approval_status, active_status, closed_at, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id IN (?, ?)`,
    [toRequisitionId, fromId ?? toRequisitionId]);
  const to = reqs.find((r) => String(r.id) === toRequisitionId);
  if (!to) throw fail(400, "Requisition not found");
  const toClosed = closedReasonOf(to);
  if (toClosed) throw fail(409, `Pick an open requisition (${toClosed})`);
  const from = fromId ? reqs.find((r) => String(r.id) === fromId) ?? null : null;

  const leads = await leadsOf(campaignId, fromId);
  const moving = leads.filter((l) => Number(l.contacted) !== 1);
  const count = (s: string) => moving.filter((l) => String(l.screening_result) === s).length;
  const moveIds = moving.map((l) => String(l.id));
  const warnings: string[] = [];
  if (from && String(from.branch_name) !== String(to.branch_name)) warnings.push(`The new requisition is in ${String(to.branch_name)}, the old one in ${String(from.branch_name)}`);
  const [last] = await db.execute<RowDataPacket[]>("SELECT raw_payload FROM meta_lead_raw WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1", [campaignId]);
  const code = routingCodeOf(last[0]?.raw_payload);
  if (code && code !== String(to.requisition_code ?? "").toUpperCase()) {
    warnings.push(`The lead form carries the hidden code ${code}; the next lead will point the campaign back at it unless the form is changed`);
  }
  // E9: stable on an active campaign: the requisition pair and who must stay (contacted people), not every new lead id. A new lead moves
  // with the rest; someone contacted since the preview changes it (409 with the fresh preview).
  const previewHash = createHash("sha256").update(JSON.stringify({ campaignId, fromId, to: toRequisitionId, stayIds: leads.filter((l) => Number(l.contacted) === 1).map((l) => String(l.id)) })).digest("hex");
  return {
    campaignId, fromRequisitionId: fromId, fromCode: from ? String(from.requisition_code ?? "") : null, fromClosedReason: from ? closedReasonOf(from) : null,
    toRequisitionId, toCode: String(to.requisition_code ?? ""), toBranch: String(to.branch_name ?? ""),
    move: { total: moving.length, qualified: count("qualified"), disqualified: count("disqualified"), pending: count("pending") }, stay: leads.length - moving.length,
    warnings, previewHash, moveIds,
  };
}

function routingCodeOf(raw: unknown): string | null {
  try {
    const d = typeof raw === "string" ? JSON.parse(raw) : raw;
    return d && Array.isArray((d as { field_data?: unknown }).field_data) ? extractRoutingCode(d as never) : null;
  } catch { return null; }
}

export async function applyRelink(a: { campaignId: string; toRequisitionId: string; previewHash: string; reason: string; actor: LinkActor }): Promise<{ moved: number; kept: number; relinkId: string }> {
  const reason = String(a.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 300) throw fail(400, "Give a reason (3 to 300 characters)");
  const p = await previewRelink(a.campaignId, a.toRequisitionId);
  if (p.previewHash !== a.previewHash) {
    const { moveIds: _ids, ...preview } = p;
    throw Object.assign(fail(409, "Someone on this campaign was contacted since the preview; check the new preview"), { preview });
  }
  const relinkId = randomUUID();
  const tables = await optionalTables();
  let moved = 0;
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await c.execute("SELECT id FROM meta_campaign WHERE id = ? FOR UPDATE", [a.campaignId]);
    await c.execute(
      `INSERT INTO meta_campaign_requisition (campaign_id, requisition_id, is_primary, sort_order, added_by) VALUES (?, ?, 1, 0, ?)
       ON DUPLICATE KEY UPDATE removed_at = NULL, removed_by = NULL, is_primary = 1`, [a.campaignId, a.toRequisitionId, a.actor.id]);
    if (p.fromRequisitionId) {
      // the old primary stays linked (so its history shows in the matrix); HR may remove it afterwards
      await c.execute(`INSERT IGNORE INTO meta_campaign_requisition (campaign_id, requisition_id, is_primary, sort_order) VALUES (?, ?, 0, 1)`, [a.campaignId, p.fromRequisitionId]);
    }
    await c.execute("UPDATE meta_campaign_requisition SET is_primary = (requisition_id = ?) WHERE campaign_id = ? AND removed_at IS NULL", [a.toRequisitionId, a.campaignId]);
    await c.execute("UPDATE meta_campaign SET requisition_id = ? WHERE id = ?", [a.toRequisitionId, a.campaignId]);
    for (let i = 0; i < p.moveIds.length; i += CHUNK) {
      const ids = p.moveIds.slice(i, i + CHUNK);
      // E9: "contacted" is re-checked here, in the transaction, for every lead: one contacted since the preview stays where it is.
      const [u] = await c.execute(
        `UPDATE meta_lead_raw r SET requisition_id = ?, routed_by = 'hr', routed_at = NOW()
          WHERE r.campaign_id = ? AND r.id IN (${ids.map(() => "?").join(",")}) AND NOT ${isLeadContactedSql("r", tables)}`,
        [a.toRequisitionId, a.campaignId, ...ids]);
      moved += Number((u as { affectedRows?: number }).affectedRows ?? 0);
    }
    await c.execute(
      `INSERT INTO meta_campaign_relink (id, campaign_id, from_requisition_id, to_requisition_id, leads_moved, leads_kept, preview_hash, actor_id, actor_role, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [relinkId, a.campaignId, p.fromRequisitionId, a.toRequisitionId, moved, p.stay + (p.moveIds.length - moved), p.previewHash, a.actor.id, a.actor.role || null, reason]);
    await c.commit();
  } catch (e) {
    try { await c.rollback(); } catch { /* keep the original error */ }
    throw e;
  } finally { c.release(); }
  return { moved, kept: p.stay + (p.moveIds.length - moved), relinkId };
}
