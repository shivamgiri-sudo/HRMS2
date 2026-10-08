/**
 * Cost usage reads for HE_COST_PER_SOURCE. Read-only. Sections cost:rates, cost:spend, cost:messages and cost:calls each have their own
 * try/catch (logged as section + code only); a failed one counts 0 and is named in failedSections. Never throws.
 * Spend: meta_campaign by requisition_id (Live Meta only). Messages: he_message by requisition_id and created_at; calls: he_call by requisition_id
 * and created_at; both typed by the shared source rule (he-source-attribution.ts).
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import { logger } from "../../logger.js";
import { COST_DEFAULTS, parseCostRates, prorateSpend, type CostRates, type CostUsage } from "./he-cost.js";
import { SOURCE_TYPES } from "./he-drive-analytics.js";
import { readAgg } from "./he-drive-trend.service.js";
import { creditJoinsSql } from "./he-source-attribution.js";
import { PersonFacts, TYPE_KEY_GROUP, typeKeyColsSql } from "./he-person-facts.service.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import { addDays } from "./requisition-stream.window.js";

const ph = (n: number): string => Array(n).fill("?").join(",");
const emptyUsage = (): CostUsage => ({ adSpend: 0, waConversations: 0, calls: 0, callMinutes: 0, emails: 0 });
const batchesOf = (ids: string[]): string[][] => { const out: string[][] = []; for (let i = 0; i < ids.length; i += 200) out.push(ids.slice(i, i + 200)); return out; };
const n0 = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) && x > 0 ? x : 0; };
const dayOf = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null || v === "" ? null : String(v).slice(0, 10));

const RATES_SQL = "SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'cost.%'";
const spendSql = (n: number): string => `SELECT id, spend_inr, last_synced_at FROM meta_campaign WHERE requisition_id IN (${ph(n)}) AND spend_inr > 0`;

// Messages and calls are typed by the shared source rule (he-source-attribution.ts): a Meta-origin person (the match's stream credit, the
// message's / call's drive kind, meta_lead_id or campaign link) is Live / Old Meta by form fill against the cutoff, everyone else he.
// WhatsApp is billed per conversation: distinct (mobile, IST day).
// One row per person signals, channel and (hashed mobile, IST day): conversations are counted distinct per type in JS, as before.
const messagesSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT ${typeKeyColsSql({ streams, d: "d", leadId: "h.lead_id", ref: "h.created_at", liveFrom })}, h.channel,
       MD5(h.mobile10) AS mk, DATE(h.created_at) AS dy, COUNT(DISTINCT h.id) AS msgs
  FROM he_message h
  LEFT JOIN he_drive d ON d.id = h.drive_id
  LEFT JOIN he_match m ON m.lead_id = h.lead_id AND m.requisition_id = h.requisition_id
  ${creditJoinsSql({ streams, match: "m", requisition: "h.requisition_id" })}
 WHERE h.requisition_id IN (${ph(n)}) AND h.created_at >= ? AND h.created_at < ? AND h.direction = 'out' AND h.channel IN ('whatsapp','email') AND h.delivery_status <> 'failed'
 GROUP BY ${TYPE_KEY_GROUP}, h.channel, mk, dy`;

const callsSql = (liveFrom: string) => (n: number, streams: boolean): string => `SELECT ${typeKeyColsSql({ streams, d: "d", leadId: "COALESCE(c.lead_id, m.lead_id)", ref: "c.created_at", liveFrom })},
       COUNT(*) AS calls, SUM(CEIL(COALESCE(c.duration_s, 0) / 60)) AS minutes
  FROM he_call c
  LEFT JOIN he_match m ON m.id = c.match_id
  LEFT JOIN he_drive d ON d.id = COALESCE(c.drive_id, m.drive_id)
  ${creditJoinsSql({ streams, match: "m", requisition: "c.requisition_id" })}
 WHERE c.requisition_id IN (${ph(n)}) AND c.created_at >= ? AND c.created_at < ?
 GROUP BY ${TYPE_KEY_GROUP}`;

const typeOf = (v: unknown): SourceType | null => (SOURCE_TYPES.includes(String(v) as SourceType) ? (String(v) as SourceType) : null);

export async function readCostUsage(
  ids: string[], w: { from: string; to: string }, liveFrom?: string, facts?: PersonFacts,
): Promise<{ usage: Record<SourceType, CostUsage>; rates: CostRates; failedSections: string[] }> {
  const usage: Record<SourceType, CostUsage> = { meta_live: emptyUsage(), meta_old: emptyUsage(), he: emptyUsage() };
  let rates: CostRates = { ...COST_DEFAULTS };
  const failedSections: string[] = [];
  const bounds = [`${w.from} 00:00:00`, `${addDays(w.to, 1)} 00:00:00`];
  const pfP = facts ? Promise.resolve(facts) : (async () => new PersonFacts(liveFrom ?? await loadLiveFrom()))();
  const part = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (err) {
      failedSections.push(name);
      logger.error({ section: name, code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-cost] section failed");
    }
  };
  const batched = async (sqlOf: (n: number, streams: boolean) => string, extra: unknown[], ordered: string[]): Promise<RowDataPacket[]> =>
    (await Promise.all(batchesOf(ordered).map((b) => readAgg((st) => sqlOf(b.length, st), [...b, ...extra])))).flat();

  await Promise.all([
    part("cost:rates", async () => { rates = parseCostRates((await limitedDb.execute<RowDataPacket[]>(RATES_SQL))[0] as never); }),
    part("cost:spend", async () => {
      const parts = await Promise.all(batchesOf(ids).map(async (b) => (await limitedDb.execute<RowDataPacket[]>(spendSql(b.length), b))[0]));
      let total = 0;
      for (const r of parts.flat()) total += prorateSpend(n0(r.spend_inr), dayOf(r.last_synced_at), w.from, w.to);
      usage.meta_live.adSpend = Math.round(total * 100) / 100;
    }),
    part("cost:messages", async () => {
      const pf = await pfP;
      const rows = await batched(messagesSql(pf.liveFrom), bounds, ids);
      await pf.loadRows(rows);
      const convos = new Set<string>();
      for (const r of rows) {
        const t = typeOf(pf.typeOf(r));
        if (!t) continue;
        if (r.channel === "whatsapp") {
          if (r.mk === undefined) { usage[t].waConversations += n0(r.persons_days); continue; } // a pre-counted row
          const k = `${t}|${String(r.mk)}|${String(r.dy)}`;
          if (!convos.has(k)) { convos.add(k); usage[t].waConversations += 1; }
        } else if (r.channel === "email") usage[t].emails += n0(r.msgs);
      }
    }),
    part("cost:calls", async () => {
      const pf = await pfP;
      const rows = await batched(callsSql(pf.liveFrom), bounds, ids);
      await pf.loadRows(rows);
      for (const r of rows) {
        const t = typeOf(pf.typeOf(r));
        if (!t) continue;
        usage[t].calls += n0(r.calls); usage[t].callMinutes += n0(r.minutes);
      }
    }),
  ]);
  return { usage, rates, failedSections };
}
