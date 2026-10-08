/**
 * Notify All on the server: the same notifyQualifiedLead as the single Notify button, one lead after another (never forced, so every
 * guard of the single route applies: STOP, closed requisition, already notified, engine ownership, follow-up pipeline), with one
 * result per lead and one audit row for the batch. Invites created here are tagged legacy_meta_bulk.
 */
import { writeAuditLog } from '../../shared/auditLog.js';
import { notifyQualifiedLead } from './lead-outreach.service.js';

export type BulkStatus = 'sent' | 'skipped' | 'failed';
export interface BulkResult { leadId: string; status: BulkStatus; reason?: string }
export interface BulkSummary { results: BulkResult[]; counts: Record<BulkStatus, number> }
export const BULK_MAX = 200;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function notifyLeadsBulk(ids: string[], o: { actor: string; delayMs?: number }): Promise<BulkSummary> {
  const results: BulkResult[] = [];
  const delay = o.delayMs ?? 300;
  for (let i = 0; i < ids.length; i++) {
    const leadId = ids[i];
    try {
      const out = await notifyQualifiedLead(leadId, { force: false, sourcePath: 'legacy_meta_bulk' });
      if (out.succeeded.length > 0) results.push({ leadId, status: 'sent' });
      else if (out.failed.length > 0) results.push({ leadId, status: 'failed', reason: `${out.failed[0].channel}: ${out.failed[0].error}`.slice(0, 200) });
      else results.push({ leadId, status: 'skipped', ...(out.skipped[0] ? { reason: out.skipped[0].reason.slice(0, 200) } : {}) });
    } catch (err) {
      results.push({ leadId, status: 'failed', reason: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
    }
    if (delay > 0 && i < ids.length - 1) await pause(delay);
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
