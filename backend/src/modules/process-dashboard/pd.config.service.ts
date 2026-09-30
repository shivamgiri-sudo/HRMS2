/** Process Dashboard -- config CRUD, validation, scope, targets and auto-provisioning. */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { ALL_CATEGORIES, FIELD_KEYS, METRIC_BY_KEY, REQUIRED_FIELDS, TIME_UNITS, profileFor, type CategoryOrUnconfigured, type TimeUnit } from "./pd.fields.js";
import { invalidateProcess } from "./pd.cache.js";
import { PdError, assertSourceName, listColumns, quoteIdent, verifyColumnMap, type PdConfig, type ProcessFilter } from "./pd.source.js";

export const VIEWER_ROLES = ["admin", "ceo", "coo", "manager", "process_manager", "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head"];
export const ADMIN_ROLES = ["admin", "process_manager", "operations_manager"];

const asJson = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
};

export function rowToConfig(r: RowDataPacket): PdConfig {
  return {
    processId: String(r.process_id), category: r.category as CategoryOrUnconfigured, label: r.label ?? null,
    aprSchema: r.apr_schema ?? null, aprTable: r.apr_table ?? null, columnMap: asJson<Record<string, string>>(r.column_map, {}),
    timeUnit: (r.time_unit ?? "sec") as TimeUnit, processFilter: asJson<ProcessFilter | null>(r.process_filter, null),
    refreshSeconds: Number(r.refresh_seconds ?? 60), enabled: Number(r.enabled) === 1,
    configuredBy: r.configured_by ?? null, updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
}

export async function getConfig(processId: string): Promise<PdConfig | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM process_dashboard_config WHERE process_id = ? LIMIT 1`, [processId]);
  return rows.length ? rowToConfig(rows[0]) : null;
}

export const isConfigured = (c: PdConfig): boolean => c.category !== "unconfigured" && !!c.aprSchema && !!c.aprTable && !!c.columnMap.agent_code && !!c.columnMap.date;

/** Viewer scope: the same predicate dashboard-builder applies, evaluated for the reader, never the author. */
export async function isProcessReadable(userId: string, processId: string): Promise<boolean> {
  const scope = await buildScopeWhereClause(userId, VIEWER_ROLES, { processId: "p.id", branchId: "p.branch_id" }, { allowAdminBypass: true, allowCeoAllRead: true });
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT p.id FROM process_master p WHERE p.id = ? AND (${scope.sql}) LIMIT 1`, [processId, ...scope.params]);
  return rows.length > 0;
}

/** Write scope: same predicate assertProcessWritable (process-data-source) uses. */
export async function isProcessWritable(userId: string, processId: string): Promise<boolean> {
  const scope = await buildScopeWhereClause(userId, ADMIN_ROLES, { processId: "p.id", branchId: "p.branch_id" }, { allowAdminBypass: true });
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT p.id FROM process_master p WHERE p.id = ? AND (${scope.sql}) LIMIT 1`, [processId, ...scope.params]);
  return rows.length > 0;
}

/** Does the caller hold write scope over at least one process? Gate for the process-less admin helpers (table lists, suggestions, config list). */
export async function hasAnyWritableProcess(userId: string): Promise<boolean> {
  const scope = await buildScopeWhereClause(userId, ADMIN_ROLES, { processId: "p.id", branchId: "p.branch_id" }, { allowAdminBypass: true });
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT p.id FROM process_master p WHERE (${scope.sql}) LIMIT 1`, scope.params);
  return rows.length > 0;
}

export interface ConfigListItem { processId: string; processCode: string; processName: string; category: string; label: string | null; enabled: boolean; configured: boolean; refreshSeconds: number }
export async function listReadableConfigs(userId: string, opts: { onlyEnabled?: boolean } = {}): Promise<ConfigListItem[]> {
  const scope = await buildScopeWhereClause(userId, VIEWER_ROLES, { processId: "p.id", branchId: "p.branch_id" }, { allowAdminBypass: true, allowCeoAllRead: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*, p.process_code, p.process_name FROM process_dashboard_config c JOIN process_master p ON p.id = c.process_id
      WHERE (${scope.sql}) ${opts.onlyEnabled ? "AND c.enabled = 1" : ""} ORDER BY p.process_name LIMIT 1000`, scope.params);
  return rows.map((r) => { const c = rowToConfig(r); return {
    processId: c.processId, processCode: String(r.process_code), processName: String(r.process_name), category: c.category, label: c.label,
    enabled: c.enabled, configured: isConfigured(c), refreshSeconds: c.refreshSeconds }; });
}

export async function listAllConfigsAdmin(userId: string): Promise<Array<ConfigListItem & { aprSchema: string | null; aprTable: string | null; configuredBy: string | null; updatedAt: string | null }>> {
  // Only processes the caller may administer: a scoped process manager must not learn other processes' source tables.
  const scope = await buildScopeWhereClause(userId, ADMIN_ROLES, { processId: "p.id", branchId: "p.branch_id" }, { allowAdminBypass: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*, p.process_code, p.process_name FROM process_dashboard_config c JOIN process_master p ON p.id = c.process_id WHERE (${scope.sql}) ORDER BY p.process_name LIMIT 2000`, scope.params);
  return rows.map((r) => { const c = rowToConfig(r); return {
    processId: c.processId, processCode: String(r.process_code), processName: String(r.process_name), category: c.category, label: c.label,
    enabled: c.enabled, configured: isConfigured(c), refreshSeconds: c.refreshSeconds, aprSchema: c.aprSchema, aprTable: c.aprTable,
    configuredBy: c.configuredBy, updatedAt: c.updatedAt }; });
}

/* ---------- validation ---------- */

export interface ConfigInput {
  category?: unknown; label?: unknown; aprSchema?: unknown; aprTable?: unknown; columnMap?: unknown; timeUnit?: unknown;
  processFilter?: unknown; refreshSeconds?: unknown; enabled?: unknown;
}
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export type ConfigDraft = Omit<PdConfig, "processId" | "configuredBy" | "updatedAt">;
/** Shape validation only (sync, no DB): the draft plus every problem found. */
export function parseConfigShape(input: ConfigInput): { draft: ConfigDraft; problems: string[] } {
  const problems: string[] = [];
  const category = String(input.category ?? "unconfigured");
  if (!(ALL_CATEGORIES as readonly string[]).includes(category)) problems.push(`category must be one of ${ALL_CATEGORIES.join(", ")}`);
  const label = input.label === undefined || input.label === null || String(input.label).trim() === "" ? null : String(input.label).trim();
  if (label && label.length > 120) problems.push("label is too long (max 120)");
  let aprSchema: string | null = null; let aprTable: string | null = null;
  try { const s = assertSourceName(String(input.aprSchema ?? ""), String(input.aprTable ?? "")); aprSchema = s.schema; aprTable = s.table; } catch (e) { problems.push((e as Error).message); }
  const columnMap: Record<string, string> = {};
  if (typeof input.columnMap !== "object" || input.columnMap === null || Array.isArray(input.columnMap)) problems.push("columnMap must be an object of canonicalField -> column");
  else for (const [k, v] of Object.entries(input.columnMap as Record<string, unknown>)) {
    if (!FIELD_KEYS.includes(k)) { problems.push(`unknown canonical field "${k}"`); continue; }
    if (v === null || v === undefined || String(v).trim() === "") continue; // blank = unmapped
    const col = String(v).trim();
    if (col.includes(".") || col.length > 64) { problems.push(`column for ${k} is not a plain column name`); continue; }
    try { quoteIdent(col); columnMap[k] = col; } catch { problems.push(`column "${col.slice(0, 40)}" for ${k} is not a valid identifier`); }
  }
  for (const f of REQUIRED_FIELDS) if (!columnMap[f]) problems.push(`required field ${f} is not mapped`);
  const timeUnit = String(input.timeUnit ?? "sec");
  if (!(TIME_UNITS as readonly string[]).includes(timeUnit)) problems.push(`timeUnit must be one of ${TIME_UNITS.join(", ")}`);
  let processFilter: ProcessFilter | null = null;
  if (input.processFilter !== undefined && input.processFilter !== null) {
    const pf = input.processFilter as { column?: unknown; value?: unknown };
    const okVal = typeof pf?.value === "string" || typeof pf?.value === "number" || typeof pf?.value === "boolean";
    if (typeof pf?.column !== "string" || !okVal || String(pf.value).length > 191) problems.push("processFilter must be {column, value}");
    else { try { quoteIdent(pf.column); processFilter = { column: pf.column, value: pf.value as ProcessFilter["value"] }; } catch { problems.push("processFilter.column is not a valid identifier"); } }
  }
  const refresh = input.refreshSeconds === undefined || input.refreshSeconds === null ? 60 : Number(input.refreshSeconds);
  if (!Number.isInteger(refresh) || refresh < 10 || refresh > 3600) problems.push("refreshSeconds must be an integer 10-3600");
  const enabled = input.enabled === true || input.enabled === 1 || input.enabled === "1";
  if (enabled && category === "unconfigured") problems.push("choose a category before enabling the dashboard");
  return { draft: { category: category as CategoryOrUnconfigured, label, aprSchema, aprTable, columnMap, timeUnit: timeUnit as TimeUnit, processFilter, refreshSeconds: refresh, enabled }, problems };
}
/** Same, but throws PdError(400) when anything is wrong. */
export function validateConfigShape(input: ConfigInput): ConfigDraft {
  const { draft, problems } = parseConfigShape(input);
  if (problems.length) throw new PdError(400, "INVALID_CONFIG", problems.join("; "));
  return draft;
}

/** Full validation: shape, then every identifier verified against information_schema. Returns the draft with column names in their real spelling. */
export async function validateConfigFull(processId: string, input: ConfigInput): Promise<Omit<PdConfig, "configuredBy" | "updatedAt">> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const shape = validateConfigShape(input);
  const [p] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  if (!p.length) throw new PdError(404, "PROCESS_NOT_FOUND", "Process not found");
  const columns = await listColumns(shape.aprSchema!, shape.aprTable!);
  const v = verifyColumnMap(shape.columnMap, columns, shape.processFilter);
  if (v.problems.length) throw new PdError(400, "INVALID_CONFIG", v.problems.map((x) => `${x.field}: ${x.message}`).join("; "));
  return { ...shape, processId, columnMap: v.map, processFilter: shape.processFilter ? { ...shape.processFilter, column: v.filterColumn! } : null };
}

export async function saveConfig(userId: string, processId: string, input: ConfigInput): Promise<PdConfig> {
  const d = await validateConfigFull(processId, input);
  await db.execute(
    `INSERT INTO process_dashboard_config
       (id, process_id, category, label, apr_schema, apr_table, column_map, time_unit, process_filter, refresh_seconds, enabled, configured_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE category = VALUES(category), label = VALUES(label), apr_schema = VALUES(apr_schema), apr_table = VALUES(apr_table),
       column_map = VALUES(column_map), time_unit = VALUES(time_unit), process_filter = VALUES(process_filter),
       refresh_seconds = VALUES(refresh_seconds), enabled = VALUES(enabled), configured_by = VALUES(configured_by)`,
    [randomUUID(), processId, d.category, d.label, d.aprSchema, d.aprTable, JSON.stringify(d.columnMap), d.timeUnit,
      d.processFilter ? JSON.stringify(d.processFilter) : null, d.refreshSeconds, d.enabled ? 1 : 0, userId]);
  invalidateProcess(processId);
  await seedProfileMetricDefinitions(processId, d.category).catch((e) => logger.warn({ err: e, processId }, "[process-dashboard] metric definition seeding failed"));
  logger.info({ processId, userId, category: d.category, table: `${d.aprSchema}.${d.aprTable}`, enabled: d.enabled }, "[process-dashboard] config saved");
  return (await getConfig(processId))!;
}

/* ---------- auto-provisioning ---------- */

const PMD_UNIT: Record<string, string> = { count: "count", percent: "percent", seconds: "seconds", hours: "hours", currency: "currency", ratio: "ratio" };

/** Default process_metric_definition rows (local_code PD_<KEY>) for a category's tiles. Never overwrites: skips any (process, local_code) that exists. */
export async function seedProfileMetricDefinitions(processId: string, category: string): Promise<number> {
  const profile = profileFor(category);
  if (!profile) return 0;
  let n = 0;
  for (const [i, key] of profile.kpis.entries()) {
    const def = METRIC_BY_KEY.get(key)!;
    const [res] = await db.execute<import("mysql2").ResultSetHeader>(
      `INSERT INTO process_metric_definition
         (id, process_id, metric_id, local_code, display_name, unit, direction, display_order, weightage, is_fatal, effective_from, active_status)
       SELECT UUID(), ?, NULL, ?, ?, ?, ?, ?, 100, 0, CURDATE(), 1 FROM DUAL
        WHERE EXISTS (SELECT 1 FROM process_master WHERE id = ?)
          AND NOT EXISTS (SELECT 1 FROM process_metric_definition WHERE process_id = ? AND local_code = ?)`,
      [processId, `PD_${key.toUpperCase()}`, def.label, PMD_UNIT[def.unit] ?? "count", def.direction === "higher" ? "higher_is_better" : "lower_is_better", 200 + i, processId, processId, `PD_${key.toUpperCase()}`]);
    n += res.affectedRows;
  }
  return n;
}

/**
 * Idempotent: makes sure process_dashboard_config has a row for this process ('unconfigured', disabled) and, if it already has a category,
 * that its default metric definitions exist. NEVER throws -- it is called from cost-centre flows that must not fail because of a dashboard.
 */
export async function ensureProcessDashboardConfig(processId: string | null | undefined): Promise<boolean> {
  if (!processId) return false;
  try {
    await db.execute(
      `INSERT IGNORE INTO process_dashboard_config (id, process_id, category, label, enabled)
       SELECT UUID(), pm.id, 'unconfigured', pm.process_name, 0 FROM process_master pm WHERE pm.id = ?`, [processId]);
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT category FROM process_dashboard_config WHERE process_id = ? LIMIT 1`, [processId]);
    if (rows.length && rows[0].category !== "unconfigured") await seedProfileMetricDefinitions(processId, String(rows[0].category));
    return true;
  } catch (err) {
    logger.warn({ err, processId }, "[process-dashboard] ensureProcessDashboardConfig failed (ignored)");
    return false;
  }
}

/* ---------- targets ---------- */

/** Targets from kpi_master_config(process) for the scale-free metrics that map onto a kpi_metric_master code. Missing => absent (never fabricated). */
export async function loadTargets(processId: string): Promise<Record<string, number>> {
  const codes = [...new Set([...METRIC_BY_KEY.values()].map((m) => m.targetCode).filter((c): c is string => !!c))];
  if (!codes.length) return {};
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.metric_code AS code, c.target_value AS target FROM kpi_master_config c JOIN kpi_metric_master m ON m.id = c.metric_id
        WHERE c.org_unit_type = 'process' AND c.org_unit_id = ? AND c.is_active = 1 AND m.metric_code IN (${codes.map(() => "?").join(",")}) LIMIT 50`,
      [processId, ...codes]);
    const byCode = new Map(rows.map((r) => [String(r.code), Number(r.target)]));
    const out: Record<string, number> = {};
    for (const m of METRIC_BY_KEY.values()) if (m.targetCode && byCode.has(m.targetCode) && Number.isFinite(byCode.get(m.targetCode))) out[m.key] = byCode.get(m.targetCode)!;
    return out;
  } catch (err) { logger.warn({ err, processId }, "[process-dashboard] target lookup failed"); return {}; }
}
