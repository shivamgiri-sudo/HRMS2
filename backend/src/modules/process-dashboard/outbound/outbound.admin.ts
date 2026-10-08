/** Outbound source admin: suggest mapping, preview (distinct dispositions, KPIs, sample). Writes nothing. */
import { addDays } from "../shared/ext.math.js";
import { buildExtSelect, parseSource, readDistinct, readExtFreshness, readRaw, suggestExtMap, verifyExtMap, type DistinctValue, type ExtSource } from "../shared/ext.source.js";
import { listColumns } from "../pd.source.js";
import { OUTBOUND_FIELDS, effectiveMap, guessConnected, parseOutboundInput, suggestConnected } from "./outbound.config.js";
import { computeOutKpis, dispositionMix, normalizeCalls, type DispositionRow, type OutKpis } from "./outbound.metrics.js";
import { outCapsOf } from "./outbound.service.js";

export async function suggestOutbound(schema: string, table: string) {
  const s = parseSource(schema, table, null);
  const columns = await listColumns(s.schema, s.table);
  return { columns, ...suggestExtMap(columns, OUTBOUND_FIELDS) };
}

export interface OutboundPreview {
  problems: Array<{ severity: "error" | "warn"; code: string; message: string }>;
  freshness: { latestDate: string | null; earliestDate: string | null; rows: number } | null;
  dispositions: Array<DistinctValue & { suggestedConnected: boolean }>; suggestedConnected: string[];
  window: { from: string; to: string } | null; kpis: OutKpis | null; mix: DispositionRow[]; badDurations: number;
  capabilities: Record<string, boolean> | null; sample: Array<Record<string, unknown>>;
}

export async function previewOutbound(input: Record<string, unknown>): Promise<OutboundPreview> {
  const out: OutboundPreview = { problems: [], freshness: null, dispositions: [], suggestedConnected: [], window: null, kpis: null, mix: [], badDurations: 0, capabilities: null, sample: [] };
  const { draft, problems } = parseOutboundInput(input);
  for (const p of problems) out.problems.push({ severity: "error", code: "INVALID_CONFIG", message: p });
  if (!draft.cdrSchema || !draft.cdrTable) return out;
  const src: ExtSource = { schema: draft.cdrSchema, table: draft.cdrTable, filter: draft.filter };
  const columns = await listColumns(src.schema, src.table);
  const v = verifyExtMap(effectiveMap(draft), columns, OUTBOUND_FIELDS, draft.filter);
  const known = new Set(out.problems.map((p) => p.message));
  for (const p of v.problems) if (!known.has(p.message) && !/must be mapped/.test(p.message)) out.problems.push({ severity: "error", code: "MAPPING", message: `${p.field}: ${p.message}` });
  if (!v.map.date || !v.map.agent_code) return out;
  const fresh = await readExtFreshness(src, v.map, v.filterColumn);
  out.freshness = fresh;
  if (!fresh.rows || !fresh.latestDate) { out.problems.push({ severity: "error", code: "NO_ROWS", message: "The table has no rows for this filter" }); return out; }
  if (v.map.disposition) {
    const d = await readDistinct(src, v.map, v.filterColumn, "disposition");
    out.dispositions = d.values.map((x) => ({ ...x, suggestedConnected: guessConnected(x.value) }));
    out.suggestedConnected = suggestConnected(d.values.map((x) => x.value));
    if (d.truncated) out.problems.push({ severity: "warn", code: "MANY_DISPOSITIONS", message: "More than 200 distinct dispositions; only the most frequent are listed" });
  }
  const from = addDays(fresh.latestDate, -6), to = fresh.latestDate;
  out.window = { from, to };
  const { sql, params } = buildExtSelect(src, v.map, v.filterColumn, columns, { from, to, limit: 50_001 });
  const raw = (await readRaw(sql, params)) as Array<Record<string, unknown>>;
  const caps = outCapsOf(v.map, columns);
  out.capabilities = { ...caps };
  const n = normalizeCalls(raw.slice(0, 50_000), draft.connectedDispositions, caps);
  out.kpis = computeOutKpis(n.rows, caps); out.mix = dispositionMix(n.rows).slice(0, 15); out.badDurations = n.badDurations;
  out.sample = raw.slice(-15).reverse();
  if (raw.length > 50_000) out.problems.push({ severity: "warn", code: "PREVIEW_CAPPED", message: "The last 7 days hold more than 50,000 calls; preview totals use the first 50,000" });
  if (n.badDurations) out.problems.push({ severity: "warn", code: "BAD_DURATIONS", message: `${n.badDurations} rows have a duration that is negative or not a number and are left out of talk time` });
  if (out.kpis.dials > 0 && out.kpis.connects === 0) out.problems.push({ severity: "warn", code: "NO_CONNECTS", message: "No call in the preview window matches the connected dispositions: connect rate will read 0%" });
  if (!caps.hour) out.problems.push({ severity: "warn", code: "NO_HOUR", message: "The date column has no time of day and no call-time column is mapped: the hourly heat map will be empty" });
  if (!caps.lead) out.problems.push({ severity: "warn", code: "NO_LEAD", message: "No lead id mapped: contact penetration is unavailable" + (caps.uniqueFlag ? "" : ", as are unique leads and attempts per lead") });
  return out;
}
