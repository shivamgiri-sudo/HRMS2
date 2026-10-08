/** Pure model for the Sales / Outbound setup panels and dashboards: field catalogues, form <-> payload, URL state. No React. */
import type { ColumnInfo } from "./extApi";

export type FieldKind = "text" | "date" | "number" | "time";
export interface FieldDef { key: string; label: string; kind: FieldKind; required: boolean }

export const SALES_FIELDS: FieldDef[] = [
  { key: "date", label: "Order date", kind: "date", required: true }, { key: "agent_code", label: "Agent code", kind: "text", required: true },
  { key: "order_id", label: "Order id", kind: "text", required: false }, { key: "amount", label: "Order amount", kind: "number", required: false },
  { key: "status", label: "Order status", kind: "text", required: false }, { key: "payment_mode", label: "Payment mode", kind: "text", required: false },
  { key: "product", label: "Product", kind: "text", required: false }, { key: "lob", label: "LOB / campaign", kind: "text", required: false },
  { key: "tl_name", label: "Team leader", kind: "text", required: false },
];
export const ROSTER_FIELDS: FieldDef[] = [
  { key: "agent_code", label: "Agent code", kind: "text", required: true }, { key: "target", label: "Monthly target", kind: "number", required: true }, { key: "tl", label: "Team leader", kind: "text", required: false },
];
export const OUTBOUND_FIELDS: FieldDef[] = [
  { key: "date", label: "Call date", kind: "date", required: true }, { key: "agent_code", label: "Agent code", kind: "text", required: true },
  { key: "disposition", label: "Disposition", kind: "text", required: true }, { key: "duration_sec", label: "Call duration (sec)", kind: "number", required: false },
  { key: "talk_time", label: "Talk time (sec)", kind: "number", required: false }, { key: "lead_id", label: "Lead id", kind: "text", required: false },
  { key: "campaign", label: "Campaign", kind: "text", required: false }, { key: "tl_name", label: "Team leader", kind: "text", required: false },
  { key: "call_time", label: "Call time of day (optional)", kind: "time", required: false }, { key: "unique_lead_flag", label: "First-attempt flag 0/1 (optional)", kind: "number", required: false },
];
export const STATUS_CLASSES = [{ value: "delivered", label: "Delivered" }, { value: "pending", label: "Pending" }, { value: "rto", label: "RTO (returned)" }, { value: "cancelled", label: "Cancelled" }] as const;
export type StatusClassKey = (typeof STATUS_CLASSES)[number]["value"];
export const TARGET_METRICS = [{ value: "net_revenue", label: "Net revenue" }, { value: "gross_revenue", label: "Gross revenue" }, { value: "orders", label: "Orders" }];
export const SOURCE_SCHEMAS = ["db_masmis", "mas_hrms"];

const NUMERIC = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real)$/i;
const TEXT = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)$/i;
/** Which columns may back a field (mirrors the backend; the server re-checks). */
export function columnFits(kind: FieldKind, c: ColumnInfo): boolean {
  const t = c.dataType.toLowerCase();
  switch (kind) {
    case "date": return /^(date|datetime|timestamp)$/.test(t);
    case "time": return t === "time";
    case "text": return TEXT.test(t) || NUMERIC.test(t);
    case "number": return NUMERIC.test(t) || TEXT.test(t);
  }
}

export interface SourceForm { schema: string; table: string; columnMap: Record<string, string>; filterColumn: string; filterValue: string; refreshSeconds: string; enabled: boolean }
export const emptySource = (): SourceForm => ({ schema: "db_masmis", table: "", columnMap: {}, filterColumn: "", filterValue: "", refreshSeconds: "60", enabled: true });
export const filterPayload = (f: Pick<SourceForm, "filterColumn" | "filterValue">) => (f.filterColumn && f.filterValue.trim() !== "" ? { column: f.filterColumn, value: f.filterValue.trim() } : null);
export const cleanMap = (m: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(m).filter(([, v]) => v && v.trim()));

export function missingRequired(fields: FieldDef[], map: Record<string, string>): string[] {
  return fields.filter((f) => f.required && !map[f.key]).map((f) => `Map the ${f.label.toLowerCase()} column.`);
}
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
export const refreshError = (v: string): string[] => (whole(v) >= 10 && whole(v) <= 3600 ? [] : ["Refresh seconds must be 10-3600."]);

/* ----- sales ----- */
export interface SalesForm extends SourceForm {
  statusAssign: Record<string, StatusClassKey | "">; prepaid: string[]; rosterOn: boolean; rosterSchema: string; rosterTable: string; rosterMap: Record<string, string>; targetMetric: string;
}
export const emptySales = (): SalesForm => ({ ...emptySource(), statusAssign: {}, prepaid: [], rosterOn: false, rosterSchema: "db_masmis", rosterTable: "", rosterMap: {}, targetMetric: "net_revenue" });
export interface SalesStored {
  ordersSchema: string; ordersTable: string; columnMap: Record<string, string>; statusMap: Record<StatusClassKey, string[]>; prepaidValues: string[];
  filter: { column: string; value: string } | null; roster: { schema: string; table: string; columnMap: Record<string, string> } | null; targetMetric: string; refreshSeconds: number; enabled: boolean;
}
export function salesFromStored(s: SalesStored | null): SalesForm {
  if (!s) return emptySales();
  const assign: Record<string, StatusClassKey> = {};
  for (const c of STATUS_CLASSES) for (const v of s.statusMap?.[c.value] ?? []) assign[v] = c.value;
  return { schema: s.ordersSchema, table: s.ordersTable, columnMap: s.columnMap ?? {}, filterColumn: s.filter?.column ?? "", filterValue: s.filter?.value ?? "", refreshSeconds: String(s.refreshSeconds ?? 60), enabled: s.enabled,
    statusAssign: assign, prepaid: s.prepaidValues ?? [], rosterOn: !!s.roster, rosterSchema: s.roster?.schema ?? "db_masmis", rosterTable: s.roster?.table ?? "", rosterMap: s.roster?.columnMap ?? {}, targetMetric: s.targetMetric ?? "net_revenue" };
}
export function salesPayload(f: SalesForm) {
  const statusMap: Record<StatusClassKey, string[]> = { delivered: [], pending: [], rto: [], cancelled: [] };
  for (const [v, c] of Object.entries(f.statusAssign)) if (c) statusMap[c].push(v);
  const map = cleanMap(f.columnMap);
  return {
    ordersSchema: f.schema, ordersTable: f.table, columnMap: map, statusMap: map.status ? statusMap : { delivered: [], pending: [], rto: [], cancelled: [] }, prepaidValues: map.payment_mode ? f.prepaid : [],
    filter: filterPayload(f), ...(f.rosterOn && f.rosterTable ? { rosterSchema: f.rosterSchema, rosterTable: f.rosterTable, rosterColumnMap: cleanMap(f.rosterMap) } : {}),
    targetMetric: f.targetMetric, refreshSeconds: whole(f.refreshSeconds) || 60, enabled: f.enabled,
  };
}
export function validateSales(f: SalesForm): string[] {
  const e: string[] = [];
  if (!f.table) e.push("Pick the orders table.");
  e.push(...missingRequired(SALES_FIELDS, f.columnMap), ...refreshError(f.refreshSeconds));
  if (f.filterColumn && !f.filterValue.trim()) e.push("Enter the filter value, or clear the filter column.");
  if (f.rosterOn) { if (!f.rosterTable) e.push("Pick the roster table or switch the roster off."); else e.push(...missingRequired(ROSTER_FIELDS, f.rosterMap).map((m) => `Roster: ${m}`)); }
  const dup = new Set<string>(); for (const v of Object.values(cleanMap(f.columnMap))) { if (dup.has(v.toLowerCase())) { e.push(`Column "${v}" is mapped to two fields.`); break; } dup.add(v.toLowerCase()); }
  return e;
}

/* ----- outbound ----- */
export interface OutboundForm extends SourceForm { connected: string[] }
export const emptyOutbound = (): OutboundForm => ({ ...emptySource(), connected: [] });
export interface OutboundStored {
  cdrSchema: string; cdrTable: string; columnMap: Record<string, string>; connectedDispositions: string[]; uniqueLeadFlagColumn: string | null;
  filter: { column: string; value: string } | null; refreshSeconds: number; enabled: boolean;
}
export function outboundFromStored(s: OutboundStored | null): OutboundForm {
  if (!s) return emptyOutbound();
  return { schema: s.cdrSchema, table: s.cdrTable, columnMap: { ...(s.columnMap ?? {}), ...(s.uniqueLeadFlagColumn ? { unique_lead_flag: s.uniqueLeadFlagColumn } : {}) }, filterColumn: s.filter?.column ?? "", filterValue: s.filter?.value ?? "",
    refreshSeconds: String(s.refreshSeconds ?? 60), enabled: s.enabled, connected: s.connectedDispositions ?? [] };
}
export function outboundPayload(f: OutboundForm) {
  const { unique_lead_flag: flag, ...rest } = cleanMap(f.columnMap);
  return { cdrSchema: f.schema, cdrTable: f.table, columnMap: rest, uniqueLeadFlagColumn: flag ?? null, connectedDispositions: f.connected, filter: filterPayload(f), refreshSeconds: whole(f.refreshSeconds) || 60, enabled: f.enabled };
}
export function validateOutbound(f: OutboundForm): string[] {
  const e: string[] = [];
  if (!f.table) e.push("Pick the call-detail table.");
  e.push(...missingRequired(OUTBOUND_FIELDS, f.columnMap), ...refreshError(f.refreshSeconds));
  if (f.filterColumn && !f.filterValue.trim()) e.push("Enter the filter value, or clear the filter column.");
  if (!f.connected.length) e.push("Choose at least one disposition that counts as a connect (run Preview to list them).");
  return e;
}

/* ----- dashboard URL state (shares from/to/tl/lob/q/agent/day/sort/dir/page keys with the APR dashboard; adds product) ----- */
export interface ExtUrl { from: string; to: string; tl: string; lob: string; product: string; q: string; agent: string; day: string; sort: string; dir: "asc" | "desc"; page: number }
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const real = (v: string) => { const t = Date.parse(`${v}T00:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v; };
const iso = (v: string | null) => (v && ISO.test(v) && real(v) ? v : "");
/** Empty from/to mean "let the server pick the month of the latest data" (correct for a lagging feed). */
export function parseExtUrl(sp: URLSearchParams): ExtUrl {
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  let from = iso(sp.get("from")), to = iso(sp.get("to"));
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to, tl: sp.get("tl")?.trim() ?? "", lob: sp.get("lob")?.trim() ?? "", product: sp.get("product")?.trim() ?? "", q: sp.get("q")?.trim() ?? "", agent: sp.get("agent")?.trim() ?? "", day: iso(sp.get("day")),
    sort: sp.get("sort")?.trim() ?? "", dir: sp.get("dir") === "asc" ? "asc" : "desc", page: Number.isFinite(page) && page > 0 ? page : 1 };
}
export function serializeExtUrl(s: ExtUrl, base: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  const set = (k: string, v: string) => { if (v) out.set(k, v); else out.delete(k); };
  set("from", s.from); set("to", s.to); set("tl", s.tl); set("lob", s.lob); set("product", s.product); set("q", s.q); set("agent", s.agent); set("day", s.day); set("sort", s.sort);
  if (s.sort && s.dir === "asc") out.set("dir", "asc"); else out.delete("dir");
  if (s.page > 1) out.set("page", String(s.page)); else out.delete("page");
  return out;
}
