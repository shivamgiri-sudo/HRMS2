/**
 * Cost usage reads for HE_COST_PER_SOURCE. Read-only. Sections cost:rates, cost:spend, cost:messages and cost:calls each have their own
 * try/catch (logged as section + code only); a failed one counts 0 and is named in failedSections. Never throws.
 * Spend: meta_campaign by requisition_id (Live Meta only). Messages: he_message by requisition_id and created_at, typed by the credited stream,
 * else the follow-up row, else Hiring Engine. Calls: he_call by requisition_id and created_at, typed by the match credit, else Hiring Engine.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { COST_DEFAULTS, parseCostRates, prorateSpend, type CostRates, type CostUsage } from "./he-cost.js";
import { SOURCE_TYPES } from "./he-drive-analytics.js";
import { readAgg } from "./he-drive-trend.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import { addDays } from "./requisition-stream.window.js";

const ph = (n: number): string => Array(n).fill("?").join(",");
const emptyUsage = (): CostUsage => ({ adSpend: 0, waConversations: 0, calls: 0, callMinutes: 0, emails: 0 });
const batchesOf = (ids: string[]): string[][] => { const out: string[][] = []; for (let i = 0; i < ids.length; i += 200) out.push(ids.slice(i, i + 200)); return out; };
const n0 = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) && x > 0 ? x : 0; };
const dayOf = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null || v === "" ? null : String(v).slice(0, 10));

const RATES_SQL = "SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'cost.%'";
const spendSql = (n: number): string => `SELECT id, spend_inr, last_synced_at FROM meta_campaign WHERE requisition_id IN (${ph(n)}) AND spend_inr > 0`;

// A message is typed by its credited stream, else its follow-up row, else Hiring Engine. WhatsApp is billed per conversation: distinct (mobile, IST day).
const messagesSql = (n: number, streams: boolean): string => `SELECT ${streams ? "COALESCE(rs.source_type, qf.source_type, 'he')" : "'he'"} AS source_type, h.channel,
       COUNT(DISTINCT h.mobile10, DATE(h.created_at)) AS persons_days, COUNT(DISTINCT h.id) AS msgs
  FROM he_message h
  LEFT JOIN he_match m ON m.lead_id = h.lead_id AND m.requisition_id = h.requisition_id${streams ? `
  LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = h.requisition_id
  LEFT JOIN qualified_followup qf ON qf.mobile10 = h.mobile10 AND qf.requisition_id = h.requisition_id` : ""}
 WHERE h.requisition_id IN (${ph(n)}) AND h.created_at >= ? AND h.created_at < ? AND h.direction = 'out' AND h.channel IN ('whatsapp','email') AND h.delivery_status <> 'failed'
 GROUP BY 1, h.channel`;

const callsSql = (n: number, streams: boolean): string => `SELECT ${streams ? "COALESCE(rs.source_type, 'he')" : "'he'"} AS source_type,
       COUNT(*) AS calls, SUM(CEIL(COALESCE(c.duration_s, 0) / 60)) AS minutes
  FROM he_call c${streams ? `
  LEFT JOIN requisition_stream_match sm ON sm.match_id = c.match_id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = c.requisition_id` : ""}
 WHERE c.requisition_id IN (${ph(n)}) AND c.created_at >= ? AND c.created_at < ?
 GROUP BY 1`;

const typeOf = (v: unknown): SourceType | null => (SOURCE_TYPES.includes(String(v) as SourceType) ? (String(v) as SourceType) : null);

export async function readCostUsage(
  ids: string[], w: { from: string; to: string },
): Promise<{ usage: Record<SourceType, CostUsage>; rates: CostRates; failedSections: string[] }> {
  const usage: Record<SourceType, CostUsage> = { meta_live: emptyUsage(), meta_old: emptyUsage(), he: emptyUsage() };
  let rates: CostRates = { ...COST_DEFAULTS };
  const failedSections: string[] = [];
  const bounds = [`${w.from} 00:00:00`, `${addDays(w.to, 1)} 00:00:00`];
  const part = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (err) {
      failedSections.push(name);
      logger.error({ section: name, code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-cost] section failed");
    }
  };
  const batched = async (sqlOf: (n: number, streams: boolean) => string, extra: unknown[], ordered: string[]): Promise<RowDataPacket[]> =>
    (await Promise.all(batchesOf(ordered).map((b) => readAgg((st) => sqlOf(b.length, st), [...b, ...extra])))).flat();

  await Promise.all([
    part("cost:rates", async () => { rates = parseCostRates((await db.execute<RowDataPacket[]>(RATES_SQL))[0] as never); }),
    part("cost:spend", async () => {
      const parts = await Promise.all(batchesOf(ids).map(async (b) => (await db.execute<RowDataPacket[]>(spendSql(b.length), b))[0]));
      let total = 0;
      for (const r of parts.flat()) total += prorateSpend(n0(r.spend_inr), dayOf(r.last_synced_at), w.from, w.to);
      usage.meta_live.adSpend = Math.round(total * 100) / 100;
    }),
    part("cost:messages", async () => {
      for (const r of await batched(messagesSql, bounds, ids)) {
        const t = typeOf(r.source_type);
        if (!t) continue;
        if (r.channel === "whatsapp") usage[t].waConversations += n0(r.persons_days);
        else if (r.channel === "email") usage[t].emails += n0(r.msgs);
      }
    }),
    part("cost:calls", async () => {
      for (const r of await batched(callsSql, bounds, ids)) {
        const t = typeOf(r.source_type);
        if (!t) continue;
        usage[t].calls += n0(r.calls); usage[t].callMinutes += n0(r.minutes);
      }
    }),
  ]);
  return { usage, rates, failedSections };
}
