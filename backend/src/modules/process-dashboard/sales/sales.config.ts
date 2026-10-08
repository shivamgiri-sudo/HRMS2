/** Sales source config (process_sales_source_config, sql/1961): field catalogue, pure parsing/suggestions, load + save. */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { logger } from "../../../logger.js";
import { invalidateProcess } from "../pd.cache.js";
import { PdError, listColumns } from "../pd.source.js";
import { asJson, norm, parseSource, strList, verifyExtMap, type ExtField, type ExtFilter } from "../shared/ext.source.js";
import type { StatusMap, TargetMetric } from "./sales.metrics.js";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export const SALES_FIELDS: ExtField[] = [
  { key: "date", label: "Order date", kind: "date", required: true, synonyms: ["order_date", "date", "created_at", "created_date", "booking_date", "sale_date", "placed_on", "order_datetime", "orderdate"] },
  { key: "agent_code", label: "Agent code", kind: "text", required: true, synonyms: ["agent_code", "agent_id", "emp_id", "employee_code", "emp_code", "mas_id", "sales_agent", "caller_id", "agentid", "empid", "user_id"] },
  { key: "order_id", label: "Order id", kind: "text", required: false, synonyms: ["order_id", "order_no", "order_number", "orderid", "order_ref", "booking_id", "sale_id"] },
  { key: "amount", label: "Order amount", kind: "number", required: false, synonyms: ["amount", "order_value", "order_amount", "total_amount", "grand_total", "revenue", "gmv", "sale_value", "net_amount", "total", "turnover"] },
  { key: "status", label: "Order status", kind: "text", required: false, synonyms: ["status", "order_status", "delivery_status", "fulfilment_status", "fulfillment_status", "current_status", "shipment_status"] },
  { key: "payment_mode", label: "Payment mode", kind: "text", required: false, synonyms: ["payment_mode", "payment_method", "payment_type", "pay_mode", "cod_prepaid", "paymentmode", "payment"] },
  { key: "product", label: "Product", kind: "text", required: false, synonyms: ["product", "product_name", "sku", "item", "item_name", "category", "product_category"] },
  { key: "lob", label: "LOB / campaign", kind: "text", required: false, synonyms: ["lob", "line_of_business", "campaign", "brand", "vertical", "department", "queue"] },
  { key: "tl_name", label: "Team leader", kind: "text", required: false, synonyms: ["tl_name", "tl", "team_leader", "teamleader", "supervisor", "team_lead", "manager_name"] },
];
export const ROSTER_FIELDS: ExtField[] = [
  { key: "agent_code", label: "Agent code", kind: "text", required: true, synonyms: ["agent_code", "agent_id", "emp_id", "employee_code", "emp_code", "mas_id", "empid"] },
  { key: "target", label: "Monthly target", kind: "number", required: true, synonyms: ["target", "monthly_target", "sales_target", "revenue_target", "target_value", "goal", "quota"] },
  { key: "tl", label: "Team leader", kind: "text", required: false, synonyms: ["tl", "tl_name", "team_leader", "supervisor", "team_lead"] },
];
export const TARGET_METRICS: TargetMetric[] = ["net_revenue", "gross_revenue", "orders"];

export interface RosterConfig { schema: string; table: string; columnMap: Record<string, string> }
export interface SalesConfig {
  processId: string; ordersSchema: string; ordersTable: string; columnMap: Record<string, string>; statusMap: StatusMap; prepaidValues: string[];
  filter: ExtFilter | null; roster: RosterConfig | null; targetMetric: TargetMetric; refreshSeconds: number; enabled: boolean; updatedAt: string | null;
}
export type SalesDraft = Omit<SalesConfig, "processId" | "updatedAt">;

const emptyStatus = (): StatusMap => ({ delivered: [], rto: [], cancelled: [], pending: [] });

function parseMap(v: unknown, what: string, fields: ExtField[], problems: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) { problems.push(`${what} must be an object of field -> column`); return out; }
  for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
    if (c === null || c === undefined || String(c).trim() === "") continue;
    if (!fields.some((f) => f.key === k)) { problems.push(`unknown ${what} field "${k}"`); continue; }
    const col = String(c).trim();
    if (col.includes(".") || col.includes("`") || col.length > 64) { problems.push(`column for ${k} is not a plain column name`); continue; }
    out[k] = col;
  }
  return out;
}

/** Pure shape validation: the draft plus every problem found. Names are NOT yet verified against information_schema. */
export function parseSalesInput(input: Record<string, unknown>): { draft: SalesDraft; problems: string[] } {
  const problems: string[] = [];
  let ordersSchema = ""; let ordersTable = ""; let filter: ExtFilter | null = null;
  try { const s = parseSource(input.ordersSchema, input.ordersTable, input.filter); ordersSchema = s.schema; ordersTable = s.table; filter = s.filter; } catch (e) { problems.push((e as Error).message); }
  const columnMap = parseMap(input.columnMap, "columnMap", SALES_FIELDS, problems);
  for (const f of SALES_FIELDS) if (f.required && !columnMap[f.key]) problems.push(`${f.label} must be mapped`);
  const sm = (input.statusMap ?? {}) as Record<string, unknown>;
  const statusMap: StatusMap = { delivered: strList(sm.delivered), rto: strList(sm.rto), cancelled: strList(sm.cancelled), pending: strList(sm.pending) };
  const owner = new Map<string, string>();
  for (const k of Object.keys(statusMap) as Array<keyof StatusMap>) for (const v of statusMap[k]) {
    const n = norm(v); const prev = owner.get(n);
    if (prev && prev !== k) problems.push(`status "${v}" is listed under both ${prev} and ${k}`); else owner.set(n, k);
  }
  const prepaidValues = strList(input.prepaidValues);
  if (prepaidValues.length && !columnMap.payment_mode) problems.push("prepaid values need the payment mode column to be mapped");
  if (Object.values(statusMap).some((l) => l.length) && !columnMap.status) problems.push("status values need the order status column to be mapped");
  let roster: RosterConfig | null = null;
  const hasRoster = input.rosterTable !== undefined && input.rosterTable !== null && String(input.rosterTable).trim() !== "";
  if (hasRoster) {
    try {
      const s = parseSource(input.rosterSchema, input.rosterTable, null);
      const rm = parseMap(input.rosterColumnMap, "rosterColumnMap", ROSTER_FIELDS, problems);
      for (const f of ROSTER_FIELDS) if (f.required && !rm[f.key]) problems.push(`Roster: ${f.label} must be mapped`);
      roster = { schema: s.schema, table: s.table, columnMap: rm };
    } catch (e) { problems.push(`Roster: ${(e as Error).message}`); }
  }
  const targetMetric = String(input.targetMetric ?? "net_revenue") as TargetMetric;
  if (!TARGET_METRICS.includes(targetMetric)) problems.push(`targetMetric must be one of ${TARGET_METRICS.join(", ")}`);
  const refresh = input.refreshSeconds === undefined || input.refreshSeconds === null ? 60 : Number(input.refreshSeconds);
  if (!Number.isInteger(refresh) || refresh < 10 || refresh > 3600) problems.push("refreshSeconds must be an integer 10-3600");
  const enabled = input.enabled === true || input.enabled === 1 || input.enabled === "1";
  return { draft: { ordersSchema, ordersTable, columnMap, statusMap, prepaidValues, filter, roster, targetMetric, refreshSeconds: refresh, enabled }, problems };
}

/* ---------- pure suggestions from distinct values ---------- */
const RTO_RE = /(rto|return|undeliver|rts\b|not.?deliver|lost|damag)/i;
const CANC_RE = /(cancel|reject|fail|declin|void|refund|invalid|abandon|duplicate)/i;
const DEL_RE = /(deliver|complete|fulfil|success|closed|received)/i;
const PEND_RE = /(pend|new|open|process|hold|confirm|ship|dispatch|transit|book|placed|packed|await|approv|created)/i;
/** Best-guess class of a raw status. Order matters: "undelivered" must not read as delivered, "not delivered" is RTO-like. */
export function guessStatusClass(v: string): keyof StatusMap | null {
  if (RTO_RE.test(v)) return "rto";
  if (CANC_RE.test(v)) return "cancelled";
  if (DEL_RE.test(v)) return "delivered";
  if (PEND_RE.test(v)) return "pending";
  return null;
}
export function suggestStatusMap(values: string[]): StatusMap {
  const out = emptyStatus();
  for (const v of values) { const c = guessStatusClass(v); if (c && v.trim()) out[c].push(v); }
  return out;
}
const COD_RE = /(cod|cash|postpaid|pay.?on.?deliver|\bpod\b|offline|to.?pay)/i;
const PRE_RE = /(prepaid|pre.?paid|online|upi|card|net.?bank|wallet|paytm|razorpay|gpay|phonepe|paid|credit|debit|emi)/i;
export const suggestPrepaid = (values: string[]): string[] => values.filter((v) => v.trim() && !COD_RE.test(v) && PRE_RE.test(v));

/* ---------- storage ---------- */
const toConfig = (r: RowDataPacket): SalesConfig => {
  const sm = asJson<Partial<StatusMap>>(r.status_map, {});
  const rosterMap = asJson<Record<string, string> | null>(r.roster_column_map, null);
  return {
    processId: String(r.process_id), ordersSchema: String(r.orders_schema), ordersTable: String(r.orders_table), columnMap: asJson<Record<string, string>>(r.column_map, {}),
    statusMap: { delivered: sm.delivered ?? [], rto: sm.rto ?? [], cancelled: sm.cancelled ?? [], pending: sm.pending ?? [] }, prepaidValues: asJson<string[]>(r.prepaid_values, []),
    filter: r.filter_column && r.filter_value !== null ? { column: String(r.filter_column), value: String(r.filter_value) } : null,
    roster: r.roster_table && rosterMap ? { schema: String(r.roster_schema), table: String(r.roster_table), columnMap: rosterMap } : null,
    targetMetric: (TARGET_METRICS.includes(r.target_metric) ? r.target_metric : "net_revenue") as TargetMetric,
    refreshSeconds: Number(r.refresh_seconds ?? 60), enabled: Number(r.enabled) === 1, updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
};

export async function getSalesConfig(processId: string): Promise<SalesConfig | null> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM process_sales_source_config WHERE process_id = ? LIMIT 1`, [processId]).catch((err: { code?: string }) => {
    if (err?.code === "ER_NO_SUCH_TABLE") return [[] as RowDataPacket[]] as unknown as [RowDataPacket[]];
    throw err;
  });
  return rows.length ? toConfig(rows[0]) : null;
}

/** Full validation: shape, then every name against information_schema. Returns the draft with names in their real spelling. */
export async function validateSalesDraft(draft: SalesDraft): Promise<SalesDraft> {
  const cols = await listColumns(draft.ordersSchema, draft.ordersTable);
  const v = verifyExtMap(draft.columnMap, cols, SALES_FIELDS, draft.filter);
  const problems = v.problems.map((p) => `${p.field}: ${p.message}`);
  let roster = draft.roster;
  if (roster) {
    const rv = verifyExtMap(roster.columnMap, await listColumns(roster.schema, roster.table), ROSTER_FIELDS, null);
    problems.push(...rv.problems.map((p) => `roster ${p.field}: ${p.message}`));
    roster = { ...roster, columnMap: rv.map };
  }
  if (problems.length) throw new PdError(400, "INVALID_CONFIG", problems.join("; "));
  return { ...draft, columnMap: v.map, filter: draft.filter && v.filterColumn ? { ...draft.filter, column: v.filterColumn } : null, roster };
}

export async function saveSalesConfig(userId: string, processId: string, input: Record<string, unknown>): Promise<SalesConfig> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const { draft: shape, problems } = parseSalesInput(input);
  if (problems.length) throw new PdError(400, "INVALID_CONFIG", problems.join("; "));
  const [p] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  if (!p.length) throw new PdError(404, "PROCESS_NOT_FOUND", "Process not found");
  const d = await validateSalesDraft(shape);
  await db.execute(
    `INSERT INTO process_sales_source_config
       (id, process_id, orders_schema, orders_table, column_map, status_map, prepaid_values, filter_column, filter_value, roster_schema, roster_table, roster_column_map, target_metric, refresh_seconds, enabled, configured_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE orders_schema = VALUES(orders_schema), orders_table = VALUES(orders_table), column_map = VALUES(column_map), status_map = VALUES(status_map),
       prepaid_values = VALUES(prepaid_values), filter_column = VALUES(filter_column), filter_value = VALUES(filter_value), roster_schema = VALUES(roster_schema),
       roster_table = VALUES(roster_table), roster_column_map = VALUES(roster_column_map), target_metric = VALUES(target_metric), refresh_seconds = VALUES(refresh_seconds),
       enabled = VALUES(enabled), configured_by = VALUES(configured_by)`,
    [randomUUID(), processId, d.ordersSchema, d.ordersTable, JSON.stringify(d.columnMap), JSON.stringify(d.statusMap), JSON.stringify(d.prepaidValues), d.filter?.column ?? null, d.filter?.value ?? null,
      d.roster?.schema ?? null, d.roster?.table ?? null, d.roster ? JSON.stringify(d.roster.columnMap) : null, d.targetMetric, d.refreshSeconds, d.enabled ? 1 : 0, userId]);
  invalidateProcess(processId);
  logger.info({ processId, userId, table: `${d.ordersSchema}.${d.ordersTable}`, enabled: d.enabled }, "[process-dashboard] sales source saved");
  return (await getSalesConfig(processId))!;
}
