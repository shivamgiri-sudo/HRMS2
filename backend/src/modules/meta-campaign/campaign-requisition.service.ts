/**
 * Many requisitions per Meta campaign (WS3 A2, decision C1). meta_campaign_requisition holds the links; exactly one is primary and
 * is mirrored into meta_campaign.requisition_id ('' = "JR pending") in the same transaction, so every existing reader keeps reading
 * the primary. Removing a link is soft. Before migration 2142 the table is absent: reads fall back to the mirror, and the live-path
 * helper (syncPrimaryLink) does nothing.
 */
import type { FieldPacket, QueryResult, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requisitionClosedReason } from "./lead-screener.service.js";
import { applyTemplateToRequisition } from "../selection/criteria.service.js";
import { LOAD_ROW_SQL, toCriteriaRow } from "../selection/criteria-row.js";
import { criteriaOf, criteriaSummary, endDateOf, endDatePassed, loadEndDateEnforced, requisitionEndedReason, seatsLeft, type CriteriaSummary } from "../hiring-engine/requisition-criteria.js";

export interface LinkActor { id: string; role: string }
export interface CampaignRequisitionLink {
  campaignId: string; requisitionId: string; code: string; branch: string; isPrimary: boolean; sortOrder: number;
  openReason: string | null; endDate: string | null; endDatePassed: boolean; endedReason: string | null; seatsLeft: number; bmiLinkPresent: boolean;
  criteria: CriteriaSummary | null;
}
export interface AddResult { isPrimary: boolean; warnings: string[]; offerCopy: boolean; templateApplied: boolean }

type Exec = { execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> };
type Conn = Awaited<ReturnType<typeof db.getConnection>>;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const noTable = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";
const istToday = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

const REQ_STATE_SQL = `SELECT id, requisition_code, branch_name, approval_status, active_status, closed_at, requested_headcount, fulfilled_headcount, requisition_validity
  FROM job_requisition WHERE id = ? LIMIT 1`;
const LINKS_SQL = "SELECT campaign_id, requisition_id, is_primary, sort_order, removed_at FROM meta_campaign_requisition WHERE campaign_id = ? ORDER BY sort_order, added_at";

export const closedReasonOf = (r: RowDataPacket | Record<string, unknown>): string | null => requisitionClosedReason({
  activeStatus: r.active_status == null ? null : Number(r.active_status), closedAt: r.closed_at == null ? null : String(r.closed_at),
  approvalStatus: r.approval_status == null ? null : String(r.approval_status),
  requestedHeadcount: r.requested_headcount == null ? null : Number(r.requested_headcount), fulfilledHeadcount: r.fulfilled_headcount == null ? null : Number(r.fulfilled_headcount),
});

async function loadCampaign(exec: Exec, campaignId: string): Promise<RowDataPacket | null> {
  const [rows] = await exec.execute<RowDataPacket[]>("SELECT id, requisition_id, screening_config FROM meta_campaign WHERE id = ? LIMIT 1", [campaignId]);
  return rows[0] ?? null;
}
async function activeLinks(exec: Exec, campaignId: string): Promise<RowDataPacket[]> {
  const [rows] = await exec.execute<RowDataPacket[]>(LINKS_SQL, [campaignId]);
  return rows.filter((r) => r.removed_at == null);
}
async function mirror(exec: Exec, campaignId: string, requisitionId: string): Promise<void> {
  await exec.execute("UPDATE meta_campaign SET requisition_id = ? WHERE id = ?", [requisitionId, campaignId]);
}
async function inTx<T>(fn: (c: Conn) => Promise<T>, conn?: Conn): Promise<T> {
  if (conn) return fn(conn);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const out = await fn(c);
    await c.commit();
    return out;
  } catch (e) {
    try { await c.rollback(); } catch { /* the original error matters */ }
    throw e;
  } finally { c.release(); }
}

/**
 * Live-path helper (campaign create, routing-code self-heal): make `requisitionId` the campaign's primary link and demote the others.
 * Never throws: before migration 2142, or on any error, the mirror alone stays authoritative as today.
 */
export async function syncPrimaryLink(exec: Exec, campaignId: string, requisitionId: string, actorId: string | null): Promise<void> {
  if (!requisitionId) return;
  try {
    await exec.execute(
      `INSERT INTO meta_campaign_requisition (campaign_id, requisition_id, is_primary, sort_order, added_by) VALUES (?, ?, 1, 0, ?)
       ON DUPLICATE KEY UPDATE is_primary = 1, removed_at = NULL, removed_by = NULL`, [campaignId, requisitionId, actorId]);
    await exec.execute("UPDATE meta_campaign_requisition SET is_primary = 0 WHERE campaign_id = ? AND requisition_id <> ? AND is_primary = 1", [campaignId, requisitionId]);
  } catch (e) {
    if (!noTable(e)) console.warn("[meta] campaign link sync failed", e instanceof Error ? e.message.split("\n")[0] : e);
  }
}

export async function addCampaignRequisition(a: { campaignId: string; requisitionId: string; actor: LinkActor; primary?: boolean; templateId?: string | null }): Promise<AddResult> {
  const campaign = await loadCampaign(db, a.campaignId);
  if (!campaign) throw fail(404, "Campaign not found");
  const [rq] = await db.execute<RowDataPacket[]>(REQ_STATE_SQL, [a.requisitionId]);
  if (!rq[0]) throw fail(400, "Requisition not found");
  const pending = !String(campaign.requisition_id ?? "");
  const ownRules = campaign.screening_config != null && String(campaign.screening_config).trim() !== "" && String(campaign.screening_config) !== "null";
  const warnings: string[] = [];
  const closed = closedReasonOf(rq[0]);
  if (closed) warnings.push(closed);
  if (endDatePassed({ validity: rq[0].requisition_validity }, istToday(new Date()))) warnings.push(`requisition end date passed (${endDateOf({ validity: rq[0].requisition_validity })})`);

  const isPrimary = await inTx(async (c) => {
    const links = await activeLinks(c, a.campaignId);
    const first = links.length === 0;
    const makePrimary = first || a.primary === true;
    const order = links.reduce((m, l) => Math.max(m, Number(l.sort_order ?? 0)), -1) + 1;
    await c.execute(
      `INSERT INTO meta_campaign_requisition (campaign_id, requisition_id, is_primary, sort_order, added_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE removed_at = NULL, removed_by = NULL, is_primary = VALUES(is_primary)`,
      [a.campaignId, a.requisitionId, makePrimary ? 1 : 0, order, a.actor.id]);
    if (makePrimary) {
      await c.execute("UPDATE meta_campaign_requisition SET is_primary = (requisition_id = ?) WHERE campaign_id = ? AND removed_at IS NULL", [a.requisitionId, a.campaignId]);
      await mirror(c, a.campaignId, a.requisitionId);
    }
    return makePrimary;
  });

  let templateApplied = false;
  if (a.templateId) {
    // S-O9: the campaign's template fills the new requisition's EMPTY criteria only, through the one criteria write path (version + audit).
    await applyTemplateToRequisition({ requisitionId: a.requisitionId, templateId: a.templateId, replaceFilled: false, actor: a.actor, reason: "Campaign template applied on link", dryRun: false });
    templateApplied = true;
  }
  // A JR-pending campaign screened by its own rules: offer to copy them into the requisition (S5 copy), never copied silently.
  const offerCopy = pending && ownRules;
  return { isPrimary, warnings, offerCopy, templateApplied };
}

export async function removeCampaignRequisition(a: { campaignId: string; requisitionId: string; actor: LinkActor }): Promise<{ newPrimary: string | null }> {
  return inTx(async (c) => {
    const links = await activeLinks(c, a.campaignId);
    const link = links.find((l) => String(l.requisition_id) === a.requisitionId);
    if (!link) throw fail(404, "That requisition is not linked to this campaign");
    const wasPrimary = Number(link.is_primary) === 1;
    await c.execute("UPDATE meta_campaign_requisition SET removed_at = NOW(), removed_by = ?, is_primary = 0 WHERE campaign_id = ? AND requisition_id = ?", [a.actor.id, a.campaignId, a.requisitionId]);
    if (!wasPrimary) return { newPrimary: null };
    const next = links.find((l) => String(l.requisition_id) !== a.requisitionId);
    const nextId = next ? String(next.requisition_id) : "";
    if (nextId) await c.execute("UPDATE meta_campaign_requisition SET is_primary = (requisition_id = ?) WHERE campaign_id = ? AND removed_at IS NULL", [nextId, a.campaignId]);
    await mirror(c, a.campaignId, nextId);
    return { newPrimary: nextId || null };
  });
}

export async function setPrimaryRequisition(a: { campaignId: string; requisitionId: string; actor: LinkActor; conn?: Conn }): Promise<void> {
  await inTx(async (c) => {
    const links = await activeLinks(c, a.campaignId);
    if (!links.some((l) => String(l.requisition_id) === a.requisitionId)) throw fail(409, "Link the requisition to this campaign first");
    await c.execute("UPDATE meta_campaign_requisition SET is_primary = (requisition_id = ?) WHERE campaign_id = ? AND removed_at IS NULL", [a.requisitionId, a.campaignId]);
    await mirror(c, a.campaignId, a.requisitionId);
  }, a.conn);
}

/** Active link ids of one campaign (primary first); before 2142 the mirror alone. */
export async function linkedRequisitionIds(campaignId: string): Promise<string[]> {
  try {
    const links = await activeLinks(db, campaignId);
    if (links.length) return [...links].sort((x, y) => Number(y.is_primary) - Number(x.is_primary)).map((l) => String(l.requisition_id));
  } catch (e) { if (!noTable(e)) throw e; }
  const c = await loadCampaign(db, campaignId);
  return c && String(c.requisition_id ?? "") ? [String(c.requisition_id)] : [];
}

/** The campaign's links with their state: open/closed reason, end date, seats left, criteria completeness. One statement per family. */
export async function listCampaignRequisitions(campaignId: string, now = new Date()): Promise<CampaignRequisitionLink[]> {
  const ids = await linkedRequisitionIds(campaignId);
  if (!ids.length) return [];
  const [states] = await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_code, branch_name, approval_status, active_status, closed_at, requested_headcount, fulfilled_headcount, requisition_validity,
            (bmi_assessment_url IS NOT NULL AND bmi_assessment_url <> '') AS has_bmi FROM job_requisition WHERE id IN (${ph(ids.length)})`, ids);
  const [crit] = await db.execute<RowDataPacket[]>(LOAD_ROW_SQL.replace("WHERE jr.id = ? LIMIT 1", `WHERE jr.id IN (${ph(ids.length)})`), ids);
  const enforced = await loadEndDateEnforced();
  const today = istToday(now);
  const byId = new Map(states.map((s) => [String(s.id), s]));
  const critBy = new Map(crit.map((d) => [String(d.id), d]));
  return ids.filter((id) => byId.has(id)).map((id, i) => {
    const s = byId.get(id)!;
    const d = critBy.get(id);
    const v = { validity: s.requisition_validity as string | Date | null };
    return {
      campaignId, requisitionId: id, code: String(s.requisition_code ?? ""), branch: String(s.branch_name ?? ""), isPrimary: i === 0, sortOrder: i,
      openReason: closedReasonOf(s), endDate: endDateOf(v), endDatePassed: endDatePassed(v, today), endedReason: requisitionEndedReason(v, today, enforced),
      seatsLeft: seatsLeft({ requestedHeadcount: Number(s.requested_headcount ?? 0), fulfilledHeadcount: Number(s.fulfilled_headcount ?? 0) }),
      bmiLinkPresent: Number(s.has_bmi) === 1, criteria: d ? criteriaSummary(criteriaOf(toCriteriaRow(d))) : null,
    };
  });
}

/** Linked, not removed, open requisitions (closed rule as outreach; the end date only when enforced), primary first. */
export async function openRequisitionsOfCampaign(campaignId: string, now = new Date()): Promise<string[]> {
  return (await listCampaignRequisitions(campaignId, now)).filter((l) => !l.openReason && !l.endedReason).map((l) => l.requisitionId);
}
