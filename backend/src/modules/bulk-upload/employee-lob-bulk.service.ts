/**
 * Employee LOB Mapping bulk upload (upload type EMPLOYEE_LOB_MAPPING).
 *
 * Sets employees.lob_id from a two-column sheet: employee_code, lob_code. Every rule the
 * single-employee editor enforces in process-lob-map.service.ts is applied per row here, but
 * with batched lookups so a file of thousands of rows costs a handful of queries:
 *
 *   - the employee exists, is active, has a process, and is inside the uploader's WFM scope
 *     (resolveCallerScope: ORG_ALL for super_admin/admin/hr-all, branch/process otherwise);
 *   - the LOB exists in lob_master and is active;
 *   - the LOB is ACTIVELY mapped to the employee's process in process_lob_map;
 *   - the employee_code is not repeated earlier in the file, and neither cell is blank
 *     (this uploader never clears a LOB — use the Process LOB Mapping screen for that).
 *
 * A failing row is rejected with its reason and the rest of the file is still applied, exactly
 * like the sibling master uploaders. Approval flow: like the other direct-apply uploaders
 * (reporting manager, roster, LOB master) there is no bulk-approval stage; the caller is
 * restricted to the WFM LOB roles in bulk-dispatch.ts and row scope is enforced here.
 *
 * Codes are matched trimmed and case-insensitively IN JAVASCRIPT after fetching (no COLLATE
 * casts on indexed columns — prod has mixed collations).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import {
  LOB_MODULE_KEY,
  LobServiceError,
  resolveCallerScope,
  type ScopeSql,
} from "../wfm/process-lob-map.service.js";

export const EMPLOYEE_LOB_UPLOAD_TYPE = "EMPLOYEE_LOB_MAPPING";
const CHUNK_SIZE = 500;
const AUDIT_SAMPLE_SIZE = 200;
const DENY_ALL_SCOPE: ScopeSql = { sql: "1=0", params: [] };

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown> | null;
}

interface EmployeeInfo {
  id: string;
  employeeCode: string;
  processId: string | null;
  processName: string | null;
  lobId: string | null;
  active: boolean;
  inScope: boolean;
}

interface LobInfo {
  id: string;
  code: string;
  active: boolean;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  lobCode: string;
}

interface PlannedUpdate {
  rowId: string;
  employeeId: string;
  employeeCode: string;
  oldLobId: string | null;
  newLobId: string;
}

interface RowError {
  rowId: string;
  message: string;
}

export interface EmployeeLobImportResult {
  importedRows: number;
  errorRows: number;
  errors: string[];
  updatedRows: number;
  unchangedRows: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const norm = (value: unknown): string => String(value ?? "").trim().toUpperCase();
const marks = (n: number): string => Array(n).fill("?").join(",");

function parseData(raw: BatchRow["normalized_data"]): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) ?? {};
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

/** Scope failure becomes a per-row rejection reason rather than a batch crash. */
async function loadScope(userId: string): Promise<{ scope: ScopeSql; scopeError: string | null }> {
  const ctx = await getUserRoleContext(userId);
  try {
    const scope = await resolveCallerScope({ id: userId, role: ctx.primaryRole, roles: ctx.roleKeys });
    return { scope, scopeError: null };
  } catch (err) {
    if (err instanceof LobServiceError && err.statusCode === 403) {
      return { scope: DENY_ALL_SCOPE, scopeError: err.message };
    }
    throw err;
  }
}

async function loadEmployees(codes: string[], scopeIn: ScopeSql): Promise<Map<string, EmployeeInfo>> {
  const scope = scopeIn.employee ?? scopeIn; // employee-aware predicate when the scope provides one
  const byCode = new Map<string, EmployeeInfo>();
  // Both the trimmed original and the upper-case variant are sent so a case-sensitive column
  // collation still matches; the result is keyed case-insensitively in JS.
  const variants = Array.from(new Set(codes.flatMap((c) => [c, c.toUpperCase()])));
  for (const part of chunk(variants, CHUNK_SIZE)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.process_id, e.lob_id, e.active_status, pm.process_name,
              CASE WHEN ${scope.sql} THEN 1 ELSE 0 END AS in_scope
         FROM employees e
         LEFT JOIN process_master pm ON pm.id = e.process_id
        WHERE e.employee_code IN (${marks(part.length)})`,
      [...scope.params, ...part],
    );
    for (const r of rows) {
      const key = norm(r.employee_code);
      if (byCode.has(key)) continue;
      byCode.set(key, {
        id: String(r.id),
        employeeCode: String(r.employee_code),
        processId: r.process_id ? String(r.process_id) : null,
        processName: r.process_name ? String(r.process_name) : null,
        lobId: r.lob_id ? String(r.lob_id) : null,
        active: Number(r.active_status) === 1,
        inScope: Number(r.in_scope) === 1,
      });
    }
  }
  return byCode;
}

async function loadLobs(): Promise<Map<string, LobInfo>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, lob_code, active_status FROM lob_master`,
  );
  const byCode = new Map<string, LobInfo>();
  for (const r of rows) {
    const key = norm(r.lob_code);
    if (!byCode.has(key)) byCode.set(key, { id: String(r.id), code: String(r.lob_code), active: Number(r.active_status) === 1 });
  }
  return byCode;
}

/** Set of "processId|lobId" for every ACTIVE mapping of the given processes. */
async function loadActiveMappings(processIds: string[]): Promise<Set<string>> {
  const mapped = new Set<string>();
  for (const part of chunk(processIds, CHUNK_SIZE)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT process_id, lob_id FROM process_lob_map
        WHERE active_status = 1 AND process_id IN (${marks(part.length)})`,
      part,
    );
    for (const r of rows) mapped.add(`${r.process_id}|${r.lob_id}`);
  }
  return mapped;
}

/** Parse every staged row, rejecting blanks and repeated employee codes. */
function parseRows(batchRows: BatchRow[], errors: RowError[], messages: string[]): ParsedRow[] {
  const parsed: ParsedRow[] = [];
  const firstRowByEmployee = new Map<string, number>();
  const reject = (row: BatchRow, message: string) => {
    errors.push({ rowId: row.id, message });
    messages.push(`Row ${row.row_no}: ${message}`);
  };
  for (const row of batchRows) {
    const data = parseData(row.normalized_data);
    const employeeCode = String(data.employee_code ?? "").trim();
    const lobCode = String(data.lob_code ?? "").trim();
    if (!employeeCode || !lobCode) {
      reject(row, "employee_code and lob_code are both required (this upload cannot clear a LOB)");
      continue;
    }
    const key = norm(employeeCode);
    const firstRow = firstRowByEmployee.get(key);
    if (firstRow !== undefined) {
      reject(row, `Duplicate employee_code "${employeeCode}" — already on row ${firstRow}; only the first occurrence is processed`);
      continue;
    }
    firstRowByEmployee.set(key, row.row_no);
    parsed.push({ rowId: row.id, rowNo: row.row_no, employeeCode, lobCode });
  }
  return parsed;
}

interface Lookups {
  employees: Map<string, EmployeeInfo>;
  lobs: Map<string, LobInfo>;
  mappings: Set<string>;
  scopeError: string | null;
}

/** First failing rule for a row, or the planned change (null change = already set). */
function validateRow(row: ParsedRow, lk: Lookups): { error: string } | { change: PlannedUpdate | null } {
  const emp = lk.employees.get(norm(row.employeeCode));
  if (!emp || !emp.inScope) {
    return { error: lk.scopeError ?? `Employee "${row.employeeCode}" not found or outside your scope` };
  }
  if (!emp.active) return { error: `Employee "${row.employeeCode}" is inactive` };
  if (!emp.processId) return { error: `Employee "${row.employeeCode}" has no process assigned — assign a process first` };

  const lob = lk.lobs.get(norm(row.lobCode));
  if (!lob) return { error: `LOB "${row.lobCode}" not found in LOB master` };
  if (!lob.active) return { error: `LOB "${lob.code}" is inactive` };
  if (!lk.mappings.has(`${emp.processId}|${lob.id}`)) {
    return { error: `LOB ${lob.code} is not mapped to process ${emp.processName ?? emp.processId} — add it in Process LOB Mapping first` };
  }
  if (emp.lobId === lob.id) return { change: null };
  return {
    change: { rowId: row.rowId, employeeId: emp.id, employeeCode: emp.employeeCode, oldLobId: emp.lobId, newLobId: lob.id },
  };
}

type Conn = { execute: (sql: string, params?: unknown[]) => Promise<unknown> };

async function applyEmployeeUpdates(conn: Conn, changes: PlannedUpdate[]): Promise<void> {
  for (const part of chunk(changes, CHUNK_SIZE)) {
    const cases = part.map(() => "WHEN ? THEN ?").join(" ");
    await conn.execute(
      `UPDATE employees SET lob_id = CASE id ${cases} END, updated_at = NOW()
        WHERE id IN (${marks(part.length)})`,
      [...part.flatMap((c) => [c.employeeId, c.newLobId]), ...part.map((c) => c.employeeId)],
    );
  }
}

async function markRows(conn: Conn, importedIds: string[], errors: RowError[]): Promise<void> {
  for (const part of chunk(importedIds, CHUNK_SIZE)) {
    await conn.execute(
      `UPDATE upload_batch_row SET row_status = 'imported', error_messages = NULL
        WHERE id IN (${marks(part.length)})`,
      part,
    );
  }
  for (const part of chunk(errors, CHUNK_SIZE)) {
    const cases = part.map(() => "WHEN ? THEN ?").join(" ");
    await conn.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${marks(part.length)})`,
      [...part.flatMap((e) => [e.rowId, JSON.stringify([e.message.slice(0, 500)])]), ...part.map((e) => e.rowId)],
    );
  }
}

export async function importEmployeeLobBatch(
  batchId: string,
  importedByUserId: string,
): Promise<EmployeeLobImportResult> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    return { importedRows: 0, errorRows: 0, errors: [], updatedRows: 0, unchangedRows: 0 };
  }

  const rowErrors: RowError[] = [];
  const messages: string[] = [];
  const parsed = parseRows(batchRows, rowErrors, messages);

  const { scope, scopeError } = await loadScope(importedByUserId);
  const employees = parsed.length ? await loadEmployees(parsed.map((r) => r.employeeCode), scope) : new Map<string, EmployeeInfo>();
  const lobs = parsed.length ? await loadLobs() : new Map<string, LobInfo>();
  const processIds = Array.from(new Set(
    Array.from(employees.values()).filter((e) => e.inScope && e.processId).map((e) => e.processId as string),
  ));
  const mappings = processIds.length ? await loadActiveMappings(processIds) : new Set<string>();

  const changes: PlannedUpdate[] = [];
  const okRowIds: string[] = [];
  for (const row of parsed) {
    const result = validateRow(row, { employees, lobs, mappings, scopeError });
    if ("error" in result) {
      rowErrors.push({ rowId: row.rowId, message: result.error });
      messages.push(`Row ${row.rowNo}: ${result.error}`);
      continue;
    }
    okRowIds.push(row.rowId);
    if (result.change) changes.push(result.change);
  }

  const importedRows = okRowIds.length;
  const errorRows = rowErrors.length;
  const finalStatus = errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";

  // Writes are one transaction: a dropped connection mid-file leaves no half-applied LOBs and
  // rows stay 'pending' for a retry. Per-row rejections above are outcomes, not aborts.
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await applyEmployeeUpdates(conn, changes);
    await markRows(conn, okRowIds, rowErrors);
    await conn.execute(
      `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ?, updated_at = NOW() WHERE id = ?`,
      [finalStatus, importedRows, errorRows, batchId],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await writeAuditLog({
    actor_user_id: importedByUserId,
    action_type: "employee.lob.bulk_upload",
    module_key: LOB_MODULE_KEY,
    entity_type: "upload_batch",
    entity_id: batchId,
    metadata: {
      total_rows: batchRows.length,
      updated: changes.length,
      unchanged: importedRows - changes.length,
      rejected: errorRows,
      employee_ids_sample: changes.slice(0, AUDIT_SAMPLE_SIZE).map((c) => c.employeeId),
      changes_sample: changes.slice(0, AUDIT_SAMPLE_SIZE).map((c) => ({
        employee_code: c.employeeCode, old_lob_id: c.oldLobId, new_lob_id: c.newLobId,
      })),
    },
  });

  return { importedRows, errorRows, errors: messages, updatedRows: changes.length, unchangedRows: importedRows - changes.length };
}
