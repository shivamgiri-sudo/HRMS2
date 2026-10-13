/**
 * What the walk-in engine costs, per branch and drive type (Live Meta, Old Meta data, Hiring Engine) for a date range: Meta ad spend,
 * WhatsApp conversations, bot call minutes and e-mails at the owner's rates (he_model_param cost.*, bot calling Rs 2.10 per minute).
 * Reuses the per-source cost reader, one call per branch. Read-only. Estimates: see `note`.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { typeCost, type CostRates, type CostUsage, type TypeCost } from "./he-cost.js";
import { readCostUsage } from "./he-cost.service.js";
import { SOURCE_TYPES } from "./he-drive-analytics.js";
import type { SourceType } from "./qualified-followup.types.js";

export interface BranchCostRow { branch: string; requisitions: number; byType: Record<SourceType, TypeCost>; total: number }
export interface BranchCostReport {
  from: string; to: string; rates: CostRates; failedSections: string[]; note: string;
  rows: BranchCostRow[]; totals: Record<SourceType, TypeCost> & { all: number };
}

const NOTE = "Estimated. Bot calling is minutes x the per-minute rate (each call rounded up to a whole minute); WhatsApp is per conversation (one per person per day); "
  + "Meta ad spend is the campaign's last-30-day total from Meta spread over the days in range, and appears only for campaigns linked to a Meta ad campaign.";
const zero = (): CostUsage => ({ adSpend: 0, waConversations: 0, calls: 0, callMinutes: 0, emails: 0 });
const none = { leads: 0, qualified: 0, arrived: 0, joined: 0 };
const IST_DAY = "DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))";

export async function getCostByBranch(from?: string, to?: string): Promise<BranchCostReport> {
  const ok = (v?: string): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const [d] = await db.execute<RowDataPacket[]>(`SELECT ${IST_DAY} AS today, DATE_SUB(${IST_DAY}, INTERVAL 29 DAY) AS start`);
  const f = ok(from) ? from : String(d[0].start).slice(0, 10);
  const t = ok(to) && to >= f ? to : String(d[0].today).slice(0, 10);
  const [reqs] = await db.execute<RowDataPacket[]>(
    `SELECT jr.id, jr.branch_name FROM job_requisition jr
      WHERE jr.branch_name IS NOT NULL AND jr.branch_name <> '' AND (
            jr.id IN (SELECT requisition_id FROM he_message WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND requisition_id IS NOT NULL)
         OR jr.id IN (SELECT requisition_id FROM he_call WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND requisition_id IS NOT NULL)
         OR jr.id IN (SELECT requisition_id FROM meta_campaign WHERE spend_inr > 0 AND requisition_id IS NOT NULL AND requisition_id <> ''))`, [f, t, f, t]);
  const byBranch = new Map<string, string[]>();
  for (const r of reqs) { const b = String(r.branch_name); (byBranch.get(b) ?? byBranch.set(b, []).get(b)!).push(String(r.id)); }

  const failed = new Set<string>();
  let rates: CostRates | null = null;
  const rows: BranchCostRow[] = [];
  const sum: Record<SourceType, CostUsage> = { meta_live: zero(), meta_old: zero(), he: zero() };
  for (const [branch, ids] of [...byBranch].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = await readCostUsage(ids, { from: f, to: t });
    rates = r.rates; r.failedSections.forEach((s) => failed.add(s));
    const byType = {} as Record<SourceType, TypeCost>;
    for (const s of SOURCE_TYPES) {
      byType[s] = typeCost(r.usage[s], r.rates, none);
      for (const k of Object.keys(sum[s]) as Array<keyof CostUsage>) sum[s][k] += r.usage[s][k];
    }
    rows.push({ branch, requisitions: ids.length, byType, total: Math.round(SOURCE_TYPES.reduce((a, s) => a + byType[s].total, 0) * 100) / 100 });
  }
  const rt = rates ?? (await readCostUsage([], { from: f, to: t })).rates;
  const totals = {} as BranchCostReport["totals"];
  let all = 0;
  for (const s of SOURCE_TYPES) { totals[s] = typeCost(sum[s], rt, none); all += totals[s].total; }
  totals.all = Math.round(all * 100) / 100;
  rows.sort((a, b) => b.total - a.total);
  return { from: f, to: t, rates: rt, failedSections: [...failed], note: NOTE, rows, totals };
}
