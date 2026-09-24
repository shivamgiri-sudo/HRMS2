/**
 * Process-wise LOB mapping (migration 1845) + employee LOB assignment.
 *
 * process_lob_map says which LOBs (lob_master rows) a process runs. employees.lob_id may only
 * be set to a LOB mapped to the employee's process. Every write enforces row scope in the
 * query (a WFM user only touches processes in their branch/process scope) and is audited to
 * audit_action_log. The finance tables process_lob_master / employee_lob_assignment are NOT
 * touched anywhere in this file.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import {
  DashboardScopeConfigurationError,
  resolveDashboardScopeForRequest,
  type DashboardScope,
} from "../../shared/dashboardScope.js";

export const LOB_MODULE_KEY = "wfm_process_lob";
export const WFM_LOB_ROLES = ["wfm", "wfm_spoc", "branch_wfm", "ho_wfm", "admin", "hr", "super_admin"] as const;
export const BULK_LOB_MAX = 2000;
const BULK_CHUNK = 500;
const MAX_PAGE_SIZE = 200;

export class LobServiceError extends Error {
  constructor(public statusCode: number, message: string, public code = "LOB_ERROR") {
    super(message);
  }
}

/** Anything with execute(): the pool, or a transaction connection (orchestrator). */
export type SqlExecutor = { execute: (sql: string, params?: any[]) => Promise<any> };

export type Actor = { id: string; role?: string; roles?: string[]; isDemo?: boolean };
export type ScopeSql = { sql: string; params: string[] };

const rows = (result: any): any[] => (Array.isArray(result) ? (result[0] as any[]) : []);
const placeholders = (n: number) => Array(n).fill("?").join(",");

// ── scope ────────────────────────────────────────────────────────────────────

/** SQL predicate over process_master (alias `pm`) for a resolved scope. Fail-closed. */
export function processScopeSql(scope: DashboardScope, alias = "pm"): ScopeSql {
  const inList = (col: string, ids: string[]) => `${alias}.${col} IN (${placeholders(ids.length)})`;
  switch (scope.level) {
    case "ORG_ALL":
      return { sql: "1=1", params: [] };
    case "BRANCH_ALL":
      return scope.branchIds.length
        ? { sql: inList("branch_id", scope.branchIds), params: [...scope.branchIds] }
        : { sql: "1=0", params: [] };
    case "PROCESS_ALL":
      return scope.processIds.length
        ? { sql: inList("id", scope.processIds), params: [...scope.processIds] }
        : { sql: "1=0", params: [] };
    case "CUSTOM_SCOPE": {
      const parts: string[] = [];
      const params: string[] = [];
      if (scope.branchIds.length) { parts.push(inList("branch_id", scope.branchIds)); params.push(...scope.branchIds); }
      if (scope.processIds.length) { parts.push(inList("id", scope.processIds)); params.push(...scope.processIds); }
      return parts.length ? { sql: `(${parts.join(" OR ")})`, params } : { sql: "1=0", params: [] };
    }
    default:
      return { sql: "1=0", params: [] };
  }
}

export async function resolveCallerScope(actor: Actor): Promise<ScopeSql> {
  try {
    const scope = await resolveDashboardScopeForRequest(
      { id: actor.id, role: actor.role, isDemo: actor.isDemo },
      actor.role ?? "",
    );
    return processScopeSql(scope);
  } catch (err) {
    if (err instanceof DashboardScopeConfigurationError) {
      throw new LobServiceError(403, "Your account has no branch/process scope configured for WFM.", "SCOPE_NOT_CONFIGURED");
    }
    throw err;
  }
}

export async function loadProcessInScope(exec: SqlExecutor, scope: ScopeSql, processId: string) {
  const r = rows(await exec.execute(
    `SELECT pm.id, pm.process_name, pm.branch_id FROM process_master pm WHERE pm.id = ? AND ${scope.sql} LIMIT 1`,
    [processId, ...scope.params],
  ));
  if (!r.length) throw new LobServiceError(403, "Process not found or outside your scope.", "PROCESS_OUT_OF_SCOPE");
  return r[0] as { id: string; process_name: string; branch_id: string | null };
}

export async function loadActiveLob(exec: SqlExecutor, lobId: string) {
  const r = rows(await exec.execute(
    `SELECT id, lob_code, lob_name FROM lob_master WHERE id = ? AND active_status = 1 LIMIT 1`, [lobId],
  ));
  if (!r.length) throw new LobServiceError(400, "LOB not found or inactive.", "LOB_INACTIVE");
  return r[0] as { id: string; lob_code: string; lob_name: string };
}

function audit(actor: Actor, action: string, entityType: string, entityId: string, meta: Record<string, unknown>) {
  return writeAuditLog({
    actor_user_id: actor.id,
    action_type: action,
    module_key: LOB_MODULE_KEY,
    entity_type: entityType,
    entity_id: entityId,
    metadata: { ...meta, actor_role: actor.role ?? null },
  });
}

function clampPage(page?: number, limit?: number) {
  const l = Math.min(Math.max(Math.trunc(limit ?? 50), 1), MAX_PAGE_SIZE);
  const p = Math.max(Math.trunc(page ?? 1), 1);
  return { limit: l, offset: (p - 1) * l, page: p };
}

// ── mappings ─────────────────────────────────────────────────────────────────

const MAPPING_SELECT = `
  SELECT m.id, m.process_id, pm.process_code, pm.process_name, m.branch_id, bm.branch_name,
         m.lob_id, l.lob_code, l.lob_name, l.active_status AS lob_active, m.active_status,
         m.created_by, m.created_at, m.updated_by, m.updated_at
    FROM process_lob_map m
    JOIN process_master pm ON pm.id = m.process_id
    JOIN lob_master l ON l.id = m.lob_id
    LEFT JOIN branch_master bm ON bm.id = pm.branch_id`;

export async function listMappings(actor: Actor, f: { process_id?: string; branch_id?: string; lob_id?: string; include_inactive?: boolean; page?: number; limit?: number }) {
  const scope = await resolveCallerScope(actor);
  const { limit, offset } = clampPage(f.page, f.limit);
  const where = [scope.sql];
  const params: any[] = [...scope.params];
  if (!f.include_inactive) where.push("m.active_status = 1");
  if (f.process_id) { where.push("m.process_id = ?"); params.push(f.process_id); }
  if (f.branch_id) { where.push("pm.branch_id = ?"); params.push(f.branch_id); }
  if (f.lob_id) { where.push("m.lob_id = ?"); params.push(f.lob_id); }
  const data = rows(await db.execute(
    `${MAPPING_SELECT} WHERE ${where.join(" AND ")} ORDER BY bm.branch_name, pm.process_name, l.lob_name LIMIT ${limit} OFFSET ${offset}`,
    params,
  ));
  const total = rows(await db.execute(
    `SELECT COUNT(*) AS c FROM process_lob_map m JOIN process_master pm ON pm.id = m.process_id WHERE ${where.join(" AND ")}`,
    params,
  ))[0]?.c ?? 0;
  return { items: data, total: Number(total) };
}

export async function listManageableProcesses(actor: Actor, f: { branch_id?: string; search?: string; only_unmapped?: boolean; page?: number; limit?: number }) {
  const scope = await resolveCallerScope(actor);
  const { limit, offset } = clampPage(f.page, f.limit);
  const where = ["pm.active_status = 1", scope.sql];
  const params: any[] = [...scope.params];
  if (f.branch_id) { where.push("pm.branch_id = ?"); params.push(f.branch_id); }
  if (f.search?.trim()) {
    where.push("(pm.process_name LIKE ? OR pm.process_code LIKE ?)");
    const like = `%${f.search.trim().replace(/[%_\\]/g, "\\$&")}%`;
    params.push(like, like);
  }
  if (f.only_unmapped) {
    where.push("NOT EXISTS (SELECT 1 FROM process_lob_map x WHERE x.process_id = pm.id AND x.active_status = 1)");
  }
  const procs = rows(await db.execute(
    `SELECT pm.id, pm.process_code, pm.process_name, pm.branch_id, bm.branch_name
       FROM process_master pm LEFT JOIN branch_master bm ON bm.id = pm.branch_id
      WHERE ${where.join(" AND ")} ORDER BY bm.branch_name, pm.process_name LIMIT ${limit} OFFSET ${offset}`,
    params,
  ));
  const total = rows(await db.execute(
    `SELECT COUNT(*) AS c FROM process_master pm WHERE ${where.join(" AND ")}`, params,
  ))[0]?.c ?? 0;
  const lobsByProcess = await loadMappedLobs(db, procs.map((p) => p.id));
  return {
    items: procs.map((p) => ({ ...p, lobs: lobsByProcess.get(p.id) ?? [] })),
    total: Number(total),
  };
}

async function loadMappedLobs(exec: SqlExecutor, processIds: string[], activeOnly = false) {
  const out = new Map<string, Array<{ map_id: string; lob_id: string; lob_code: string; lob_name: string; active_status: number }>>();
  if (!processIds.length) return out;
  const r = rows(await exec.execute(
    `SELECT m.id AS map_id, m.process_id, m.lob_id, l.lob_code, l.lob_name, m.active_status
       FROM process_lob_map m JOIN lob_master l ON l.id = m.lob_id
      WHERE m.process_id IN (${placeholders(processIds.length)}) ${activeOnly ? "AND m.active_status = 1 AND l.active_status = 1" : ""}
      ORDER BY l.lob_name`,
    processIds,
  ));
  for (const row of r) {
    const list = out.get(row.process_id) ?? [];
    list.push({ map_id: row.map_id, lob_id: row.lob_id, lob_code: row.lob_code, lob_name: row.lob_name, active_status: Number(row.active_status) });
    out.set(row.process_id, list);
  }
  return out;
}

export async function addMapping(actor: Actor, input: { process_id: string; lob_id: string }) {
  const scope = await resolveCallerScope(actor);
  const proc = await loadProcessInScope(db, scope, input.process_id);
  const lob = await loadActiveLob(db, input.lob_id);
  const existing = rows(await db.execute(
    `SELECT id, active_status FROM process_lob_map WHERE process_id = ? AND lob_id = ? LIMIT 1`,
    [proc.id, lob.id],
  ));
  if (existing.length) {
    const row = existing[0];
    if (Number(row.active_status) === 1) throw new LobServiceError(409, "This LOB is already mapped to the process.", "DUPLICATE_MAPPING");
    await db.execute(
      `UPDATE process_lob_map SET active_status = 1, branch_id = ?, updated_by = ? WHERE id = ?`,
      [proc.branch_id, actor.id, row.id],
    );
    await audit(actor, "process_lob_map.reactivate", "process_lob_map", row.id, { process_id: proc.id, lob_id: lob.id, lob_code: lob.lob_code });
    return { id: row.id as string, reactivated: true };
  }
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO process_lob_map (id, process_id, lob_id, branch_id, active_status, created_by, updated_by)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [id, proc.id, lob.id, proc.branch_id, actor.id, actor.id],
    );
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") throw new LobServiceError(409, "This LOB is already mapped to the process.", "DUPLICATE_MAPPING");
    throw err;
  }
  await audit(actor, "process_lob_map.add", "process_lob_map", id, { process_id: proc.id, process_name: proc.process_name, lob_id: lob.id, lob_code: lob.lob_code });
  return { id, reactivated: false };
}

async function loadMappingInScope(actor: Actor, id: string) {
  const scope = await resolveCallerScope(actor);
  const r = rows(await db.execute(`${MAPPING_SELECT} WHERE m.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params]));
  if (!r.length) throw new LobServiceError(404, "Mapping not found.", "NOT_FOUND");
  return r[0];
}

export async function setMappingActive(actor: Actor, id: string, active: boolean) {
  const current = await loadMappingInScope(actor, id);
  if (Number(current.active_status) === (active ? 1 : 0)) return { id, changed: false };
  if (active) await loadActiveLob(db, current.lob_id);
  await db.execute(`UPDATE process_lob_map SET active_status = ?, updated_by = ? WHERE id = ?`, [active ? 1 : 0, actor.id, id]);
  await audit(actor, active ? "process_lob_map.reactivate" : "process_lob_map.deactivate", "process_lob_map", id, {
    process_id: current.process_id, lob_id: current.lob_id, lob_code: current.lob_code,
  });
  return { id, changed: true };
}

export async function getMappingDetail(actor: Actor, id: string) {
  const mapping = await loadMappingInScope(actor, id);
  const rawAudit = rows(await db.execute(
    `SELECT a.id, a.action_type, a.actor_user_id, a.metadata_json, a.created_at
       FROM audit_action_log a
      WHERE a.module_key = ? AND a.entity_type = 'process_lob_map' AND a.entity_id = ?
      ORDER BY a.created_at DESC LIMIT 100`,
    [LOB_MODULE_KEY, id],
  ));
  // Actor emails are looked up by parameter, not joined: audit_action_log and auth_user do not
  // share a collation in every environment and a column-to-column join would raise
  // ER_CANT_AGGREGATE_2COLLATIONS.
  const actorIds = Array.from(new Set(rawAudit.map((a) => a.actor_user_id).filter(Boolean)));
  const emails = new Map<string, string>();
  if (actorIds.length) {
    for (const u of rows(await db.execute(`SELECT id, email FROM auth_user WHERE id IN (${placeholders(actorIds.length)})`, actorIds))) {
      emails.set(u.id, u.email);
    }
  }
  const auditRows = rawAudit.map((a) => ({ ...a, actor_email: emails.get(a.actor_user_id) ?? null }));
  const emp = rows(await db.execute(
    `SELECT COUNT(*) AS c FROM employees WHERE process_id = ? AND lob_id = ?`, [mapping.process_id, mapping.lob_id],
  ))[0]?.c ?? 0;
  return { mapping, employees_with_lob: Number(emp), audit: auditRows };
}

// ── LOB creation ─────────────────────────────────────────────────────────────

export function deriveLobCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
}

export async function createLob(actor: Actor, input: { lob_name: string; lob_code?: string; description?: string }) {
  const name = input.lob_name.trim();
  const code = (input.lob_code?.trim() ? input.lob_code.trim().toUpperCase() : deriveLobCode(name));
  if (!/^[A-Z0-9_]{2,50}$/.test(code)) {
    throw new LobServiceError(400, "LOB code must be 2-50 characters of A-Z, 0-9 or underscore.", "INVALID_CODE");
  }
  const dup = rows(await db.execute(
    `SELECT id, lob_name, lob_code FROM lob_master WHERE UPPER(TRIM(lob_name)) = UPPER(?) OR UPPER(lob_code) = ? LIMIT 1`,
    [name, code],
  ));
  if (dup.length) {
    throw new LobServiceError(409, `A LOB named "${dup[0].lob_name}" (${dup[0].lob_code}) already exists.`, "DUPLICATE_LOB");
  }
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO lob_master (id, lob_code, lob_name, active_status, description) VALUES (?, ?, ?, 1, ?)`,
      [id, code, name, input.description?.trim() || null],
    );
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") throw new LobServiceError(409, "A LOB with this name or code already exists.", "DUPLICATE_LOB");
    throw err;
  }
  await audit(actor, "lob_master.create", "lob_master", id, { lob_code: code, lob_name: name });
  return { id, lob_code: code, lob_name: name };
}

export async function listActiveLobs() {
  return rows(await db.execute(`SELECT id, lob_code, lob_name FROM lob_master WHERE active_status = 1 ORDER BY lob_name`));
}

// ── employee LOB ─────────────────────────────────────────────────────────────

async function loadEmployeeInScope(exec: SqlExecutor, scope: ScopeSql, employeeId: string) {
  const r = rows(await exec.execute(
    `SELECT e.id, e.employee_code, e.full_name, e.process_id, e.lob_id
       FROM employees e JOIN process_master pm ON pm.id = e.process_id
      WHERE e.id = ? AND ${scope.sql} LIMIT 1`,
    [employeeId, ...scope.params],
  ));
  if (!r.length) throw new LobServiceError(404, "Employee not found, has no process, or is outside your scope.", "EMPLOYEE_OUT_OF_SCOPE");
  return r[0] as { id: string; employee_code: string; full_name: string; process_id: string; lob_id: string | null };
}

/** True when lobId is an ACTIVE mapping (and active LOB) of processId. */
export async function isLobMappedToProcess(exec: SqlExecutor, processId: string, lobId: string): Promise<boolean> {
  const r = rows(await exec.execute(
    `SELECT 1 AS ok FROM process_lob_map m JOIN lob_master l ON l.id = m.lob_id
      WHERE m.process_id = ? AND m.lob_id = ? AND m.active_status = 1 AND l.active_status = 1 LIMIT 1`,
    [processId, lobId],
  ));
  return r.length > 0;
}

export async function getProcessLobOptions(actor: Actor, processId: string) {
  const scope = await resolveCallerScope(actor);
  const proc = await loadProcessInScope(db, scope, processId);
  const lobs = (await loadMappedLobs(db, [proc.id], true)).get(proc.id) ?? [];
  return { process_id: proc.id, process_name: proc.process_name, options: lobs };
}

export async function getEmployeeLobOptions(actor: Actor, employeeId: string) {
  const scope = await resolveCallerScope(actor);
  const emp = await loadEmployeeInScope(db, scope, employeeId);
  const lobs = (await loadMappedLobs(db, [emp.process_id], true)).get(emp.process_id) ?? [];
  return { employee_id: emp.id, process_id: emp.process_id, current_lob_id: emp.lob_id, options: lobs };
}

export async function setEmployeeLob(actor: Actor, employeeId: string, lobId: string | null) {
  const scope = await resolveCallerScope(actor);
  const emp = await loadEmployeeInScope(db, scope, employeeId);
  if (lobId !== null && !(await isLobMappedToProcess(db, emp.process_id, lobId))) {
    throw new LobServiceError(400, "This LOB is not mapped to the employee's process. Add it in Process LOB Mapping first.", "LOB_NOT_MAPPED");
  }
  if ((emp.lob_id ?? null) === lobId) return { employee_id: emp.id, lob_id: lobId, changed: false };
  await db.execute(`UPDATE employees SET lob_id = ?, updated_at = NOW() WHERE id = ?`, [lobId, emp.id]);
  await audit(actor, lobId ? "employee.lob.set" : "employee.lob.clear", "employee", emp.id, {
    employee_code: emp.employee_code, process_id: emp.process_id, old_lob_id: emp.lob_id, new_lob_id: lobId,
  });
  return { employee_id: emp.id, lob_id: lobId, changed: true };
}

/**
 * Creation-time default: when the process has EXACTLY ONE active mapped LOB, stamp it on the
 * new employee. 0 or >1 mappings leave lob_id NULL. Guarded by lob_id IS NULL so it can never
 * overwrite a value. Works on a transaction connection; callers treat failure as non-blocking.
 */
export async function applySingleMappedLob(exec: SqlExecutor, employeeId: string, processId: string | null): Promise<string | null> {
  if (!processId) return null;
  const opts = rows(await exec.execute(
    `SELECT m.lob_id FROM process_lob_map m JOIN lob_master l ON l.id = m.lob_id
      WHERE m.process_id = ? AND m.active_status = 1 AND l.active_status = 1 LIMIT 2`,
    [processId],
  ));
  if (opts.length !== 1) return null;
  await exec.execute(`UPDATE employees SET lob_id = ? WHERE id = ? AND lob_id IS NULL`, [opts[0].lob_id, employeeId]);
  return opts[0].lob_id as string;
}

// ── backfill: employees without LOB ──────────────────────────────────────────

export async function listEmployeesWithoutLob(actor: Actor, f: { process_id?: string; branch_id?: string; search?: string; page?: number; limit?: number }) {
  const scope = await resolveCallerScope(actor);
  const { limit, offset } = clampPage(f.page, f.limit);
  const where = ["e.lob_id IS NULL", "e.active_status = 1", scope.sql];
  const params: any[] = [...scope.params];
  if (f.process_id) { where.push("e.process_id = ?"); params.push(f.process_id); }
  if (f.branch_id) { where.push("pm.branch_id = ?"); params.push(f.branch_id); }
  if (f.search?.trim()) {
    where.push("(e.employee_code LIKE ? OR e.full_name LIKE ?)");
    const like = `%${f.search.trim().replace(/[%_\\]/g, "\\$&")}%`;
    params.push(like, like);
  }
  const from = `FROM employees e JOIN process_master pm ON pm.id = e.process_id LEFT JOIN branch_master bm ON bm.id = pm.branch_id WHERE ${where.join(" AND ")}`;
  const items = rows(await db.execute(
    `SELECT e.id, e.employee_code, e.full_name, e.process_id, pm.process_name, pm.branch_id, bm.branch_name ${from}
      ORDER BY bm.branch_name, pm.process_name, e.employee_code LIMIT ${limit} OFFSET ${offset}`, params,
  ));
  const total = rows(await db.execute(`SELECT COUNT(*) AS c ${from}`, params))[0]?.c ?? 0;
  return { items, total: Number(total) };
}

export async function summarizeEmployeesWithoutLob(actor: Actor, f: { branch_id?: string }) {
  const scope = await resolveCallerScope(actor);
  const where = ["e.lob_id IS NULL", "e.active_status = 1", scope.sql];
  const params: any[] = [...scope.params];
  if (f.branch_id) { where.push("pm.branch_id = ?"); params.push(f.branch_id); }
  const procs = rows(await db.execute(
    `SELECT pm.id AS process_id, pm.process_code, pm.process_name, pm.branch_id, bm.branch_name, COUNT(e.id) AS employees_without_lob
       FROM employees e JOIN process_master pm ON pm.id = e.process_id LEFT JOIN branch_master bm ON bm.id = pm.branch_id
      WHERE ${where.join(" AND ")}
      GROUP BY pm.id, pm.process_code, pm.process_name, pm.branch_id, bm.branch_name
      ORDER BY employees_without_lob DESC LIMIT 500`, params,
  ));
  const lobs = await loadMappedLobs(db, procs.map((p) => p.process_id), true);
  return procs.map((p) => ({
    ...p,
    employees_without_lob: Number(p.employees_without_lob),
    lobs: lobs.get(p.process_id) ?? [],
  }));
}

async function updateInChunks(exec: SqlExecutor, lobId: string, processId: string, ids: string[]) {
  let updated = 0;
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    const res = await exec.execute(
      `UPDATE employees SET lob_id = ?, updated_at = NOW()
        WHERE id IN (${placeholders(chunk.length)}) AND process_id = ? AND lob_id IS NULL`,
      [lobId, ...chunk, processId],
    );
    updated += Number((res[0] as any)?.affectedRows ?? 0);
  }
  return updated;
}

export async function bulkAssignLob(actor: Actor, input: { process_id: string; lob_id: string; employee_ids?: string[] }) {
  const scope = await resolveCallerScope(actor);
  const proc = await loadProcessInScope(db, scope, input.process_id);
  if (!(await isLobMappedToProcess(db, proc.id, input.lob_id))) {
    throw new LobServiceError(400, "This LOB is not mapped to the process. Add it in Process LOB Mapping first.", "LOB_NOT_MAPPED");
  }
  let targetIds: string[];
  let remaining = 0;
  if (input.employee_ids?.length) {
    const wanted = Array.from(new Set(input.employee_ids));
    if (wanted.length > BULK_LOB_MAX) throw new LobServiceError(400, `At most ${BULK_LOB_MAX} employees per request.`, "BATCH_TOO_LARGE");
    targetIds = rows(await db.execute(
      `SELECT e.id FROM employees e WHERE e.process_id = ? AND e.lob_id IS NULL AND e.id IN (${placeholders(wanted.length)})`,
      [proc.id, ...wanted],
    )).map((r) => r.id as string);
  } else {
    const found = rows(await db.execute(
      `SELECT e.id FROM employees e WHERE e.process_id = ? AND e.lob_id IS NULL AND e.active_status = 1 ORDER BY e.employee_code LIMIT ${BULK_LOB_MAX + 1}`,
      [proc.id],
    )).map((r) => r.id as string);
    remaining = Math.max(found.length - BULK_LOB_MAX, 0);
    targetIds = found.slice(0, BULK_LOB_MAX);
  }
  const updated = targetIds.length ? await updateInChunks(db, input.lob_id, proc.id, targetIds) : 0;
  const requested = input.employee_ids?.length ? new Set(input.employee_ids).size : targetIds.length;
  await audit(actor, "employee.lob.bulk_assign", "process_lob_bulk", proc.id, {
    process_id: proc.id, process_name: proc.process_name, lob_id: input.lob_id,
    requested, updated, skipped: Math.max(requested - updated, 0), remaining,
    mode: input.employee_ids?.length ? "selected" : "all_null_in_process",
    employee_ids_sample: targetIds.slice(0, 200),
  });
  return { process_id: proc.id, lob_id: input.lob_id, requested, updated, skipped: Math.max(requested - updated, 0), remaining };
}
