/**
 * Notify All on the server: the same notifyQualifiedLead as the single Notify button, one lead after another (never forced, so every
 * guard of the single route applies: STOP, closed requisition, already notified, engine ownership, follow-up pipeline), with one
 * result per lead and one audit row for the batch. Invites created here are tagged legacy_meta_bulk.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { writeAuditLog } from '../../shared/auditLog.js';
import { notifyQualifiedLead } from './lead-outreach.service.js';
import { canAccessLead, type BranchScope } from './meta-access.js';

export type BulkStatus = 'sent' | 'skipped' | 'failed';
export interface BulkResult { leadId: string; status: BulkStatus; reason?: string }
export interface BulkSummary { results: BulkResult[]; counts: Record<BulkStatus, number> }
export const BULK_MAX = 200;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per id, why it may not be sent by this caller: unknown lead (404) or another branch's lead (403). In-scope ids are absent. */
export async function refusedLeads(ids: string[], scope: BranchScope): Promise<Map<string, string>> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM meta_lead_raw WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const known = new Set(rows.map((r) => String(r.id)));
  const out = new Map<string, string>();
  for (const id of ids) {
    if (!known.has(id)) out.set(id, 'Lead not found (404)');
    else if (!(await canAccessLead(id, scope))) out.set(id, 'Not in your branch (403)');
  }
  return out;
}

/** After a lost response (timeout, proxy error): which of the caller's in-scope leads are now marked notified. Others are not answered. */
export async function notifiedStatus(ids: string[], scope: BranchScope): Promise<Array<{ leadId: string; notified: boolean }>> {
  const refused = await refusedLeads(ids, scope);
  const mine = ids.filter((id) => !refused.has(id));
  if (!mine.length) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, notification_sent_at IS NOT NULL AS notified FROM meta_lead_raw WHERE id IN (${mine.map(() => '?').join(',')})`, mine);
  const by = new Map(rows.map((r) => [String(r.id), Number(r.notified) === 1]));
  return mine.map((leadId) => ({ leadId, notified: by.get(leadId) ?? false }));
}

export async function notifyLeadsBulk(ids: string[], o: { actor: string; delayMs?: number; refused?: Map<string, string> }): Promise<BulkSummary> {
  const results: BulkResult[] = [];
  const delay = o.delayMs ?? 300;
  const toSend = ids.filter((id) => !o.refused?.has(id));
  for (let i = 0; i < ids.length; i++) {
    const leadId = ids[i];
    const refusal = o.refused?.get(leadId);
    if (refusal) { results.push({ leadId, status: 'failed', reason: refusal }); continue; }
    try {
      const out = await notifyQualifiedLead(leadId, { force: false, sourcePath: 'legacy_meta_bulk', manual: true, actor: o.actor });
      if (out.succeeded.length > 0) results.push({ leadId, status: 'sent' });
      else if (out.failed.length > 0) results.push({ leadId, status: 'failed', reason: `${out.failed[0].channel}: ${out.failed[0].error}`.slice(0, 200) });
      else results.push({ leadId, status: 'skipped', ...(out.skipped[0] ? { reason: out.skipped[0].reason.slice(0, 200) } : {}) });
    } catch (err) {
      results.push({ leadId, status: 'failed', reason: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
    }
    if (delay > 0 && leadId !== toSend[toSend.length - 1]) await pause(delay);
  }
  const counts: Record<BulkStatus, number> = { sent: 0, skipped: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  await writeAuditLog({ actor_user_id: o.actor, action_type: 'meta_notify_bulk', module_key: 'meta_campaign', metadata: { leads: ids.length, counts } });
  return { results, counts };
}

/** 1..200 distinct non-empty string ids, else null. */
export function parseLeadIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > BULK_MAX) return null;
  if (!raw.every((x) => typeof x === 'string' && x.trim() !== '' && x.length <= 64)) return null;
  return [...new Set((raw as string[]).map((x) => x.trim()))];
}
