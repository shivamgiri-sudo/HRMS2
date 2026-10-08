/** Sales source admin: suggest mapping, preview (distinct status / payment values, KPIs, roster match). Writes nothing. */
import { addDays } from "../shared/ext.math.js";
import { MAX_EXT_ROWS, buildExtSelect, readDistinct, readExtFreshness, readRaw, suggestExtMap, verifyExtMap, type DistinctValue, type ExtSource } from "../shared/ext.source.js";
import { listColumns } from "../pd.source.js";
import { ROSTER_FIELDS, SALES_FIELDS, parseSalesInput, suggestPrepaid, suggestStatusMap, guessStatusClass } from "./sales.config.js";
import { computeKpis, normalizeOrders, type SalesKpis, type StatusMap } from "./sales.metrics.js";
import { capsOf, loadRoster, type SalesCtx } from "./sales.service.js";
import { parseSource } from "../shared/ext.source.js";

export async function suggestSales(schema: string, table: string) {
  const s = parseSource(schema, table, null);
  const columns = await listColumns(s.schema, s.table);
  return { columns, ...suggestExtMap(columns, SALES_FIELDS) };
}
export async function suggestRoster(schema: string, table: string) {
  const s = parseSource(schema, table, null);
  const columns = await listColumns(s.schema, s.table);
  return { columns, ...suggestExtMap(columns, ROSTER_FIELDS) };
}

export interface SalesPreview {
  problems: Array<{ severity: "error" | "warn"; code: string; message: string }>;
  freshness: { latestDate: string | null; earliestDate: string | null; rows: number } | null;
  statuses: Array<DistinctValue & { suggested: keyof StatusMap | null }>; suggestedStatusMap: StatusMap;
  paymentModes: Array<DistinctValue & { suggestedPrepaid: boolean }>; suggestedPrepaid: string[];
  window: { from: string; to: string } | null; kpis: SalesKpis | null; unmappedStatuses: Array<{ value: string; orders: number }>; duplicateOrders: number; badAmounts: number;
  sample: Array<Record<string, unknown>>;
  roster: { rows: number; agentsMatched: number; agentsInOrders: number } | null;
}

export async function previewSales(input: Record<string, unknown>): Promise<SalesPreview> {
  const out: SalesPreview = { problems: [], freshness: null, statuses: [], suggestedStatusMap: { delivered: [], rto: [], cancelled: [], pending: [] }, paymentModes: [], suggestedPrepaid: [],
    window: null, kpis: null, unmappedStatuses: [], duplicateOrders: 0, badAmounts: 0, sample: [], roster: null };
  const { draft, problems } = parseSalesInput(input);
  for (const p of problems) out.problems.push({ severity: "error", code: "INVALID_CONFIG", message: p });
  if (!draft.ordersSchema || !draft.ordersTable) return out;
  const src: ExtSource = { schema: draft.ordersSchema, table: draft.ordersTable, filter: draft.filter };
  const columns = await listColumns(src.schema, src.table);
  const v = verifyExtMap(draft.columnMap, columns, SALES_FIELDS, draft.filter);
  const known = new Set(out.problems.map((p) => p.message));
  for (const p of v.problems) { const m = `${p.field}: ${p.message}`; if (!known.has(p.message) && !/must be mapped/.test(p.message)) out.problems.push({ severity: "error", code: "MAPPING", message: m }); }
  if (!v.map.date || !v.map.agent_code) return out;
  const fresh = await readExtFreshness(src, v.map, v.filterColumn);
  out.freshness = fresh;
  if (!fresh.rows || !fresh.latestDate) { out.problems.push({ severity: "error", code: "NO_ROWS", message: "The table has no rows for this filter" }); return out; }
  if (v.map.status) {
    const d = await readDistinct(src, v.map, v.filterColumn, "status");
    out.statuses = d.values.map((x) => ({ ...x, suggested: guessStatusClass(x.value) }));
    out.suggestedStatusMap = suggestStatusMap(d.values.map((x) => x.value));
    if (d.truncated) out.problems.push({ severity: "warn", code: "MANY_STATUSES", message: "More than 200 distinct statuses; only the most frequent are listed" });
  }
  if (v.map.payment_mode) {
    const d = await readDistinct(src, v.map, v.filterColumn, "payment_mode");
    const pre = new Set(suggestPrepaid(d.values.map((x) => x.value)));
    out.paymentModes = d.values.map((x) => ({ ...x, suggestedPrepaid: pre.has(x.value) }));
    out.suggestedPrepaid = [...pre];
  }
  const from = addDays(fresh.latestDate, -29), to = fresh.latestDate;
  out.window = { from, to };
  const { sql, params } = buildExtSelect(src, v.map, v.filterColumn, columns, { from, to, limit: 20_001 });
  const raw = (await readRaw(sql, params)) as Array<Record<string, unknown>>;
  const caps = capsOf(v.map);
  const n = normalizeOrders(raw.slice(0, 20_000), draft.statusMap, draft.prepaidValues, caps);
  out.kpis = computeKpis(n.rows, caps);
  out.unmappedStatuses = n.unmappedStatuses; out.duplicateOrders = n.duplicateOrders; out.badAmounts = n.badAmounts;
  out.sample = raw.slice(-15).reverse();
  if (raw.length > 20_000) out.problems.push({ severity: "warn", code: "PREVIEW_CAPPED", message: "The last 30 days hold more than 20,000 rows; preview totals use the first 20,000" });
  if (n.duplicateOrders) out.problems.push({ severity: "warn", code: "DUPLICATE_ORDERS", message: `${n.duplicateOrders} rows repeat an order id and are counted once (one row = one order)` });
  if (n.badAmounts) out.problems.push({ severity: "warn", code: "BAD_AMOUNTS", message: `${n.badAmounts} rows have an amount that is not a number and are left out of revenue` });
  if (caps.status && n.unmappedStatuses.length) out.problems.push({ severity: "warn", code: "UNMAPPED_STATUS", message: `${n.unmappedStatuses.reduce((a, s) => a + s.orders, 0)} orders have a status not assigned to delivered / RTO / cancelled / pending` });
  if (caps.status && !Object.values(draft.statusMap).some((l) => l.length)) out.problems.push({ severity: "warn", code: "NO_STATUS_MAP", message: "No status values assigned yet: RTO, cancellation and net revenue need it" });
  if (caps.payment && !draft.prepaidValues.length) out.problems.push({ severity: "warn", code: "NO_PREPAID", message: "No payment modes marked as prepaid: Prepaid % will read 0" });
  if (draft.roster) {
    const fake = { cfg: { processId: "preview", roster: draft.roster, updatedAt: String(Date.now()) } } as unknown as SalesCtx;
    const roster = await loadRoster(fake);
    const inOrders = new Set(n.rows.map((r) => r.agent));
    const matched = roster.filter((r) => inOrders.has(r.agent)).length;
    out.roster = { rows: roster.length, agentsMatched: matched, agentsInOrders: inOrders.size };
    if (!roster.length) out.problems.push({ severity: "warn", code: "ROSTER_EMPTY", message: "The roster table returned no usable rows (agent code and numeric target)" });
    else if (!matched) out.problems.push({ severity: "warn", code: "ROSTER_NO_MATCH", message: "No roster agent code matches an agent in the orders table" });
  }
  void MAX_EXT_ROWS;
  return out;
}
