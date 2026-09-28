/**
 * Employee Process / Cost Centre / LOB Mapping bulk upload (upload type EMPLOYEE_LOB_MAPPING).
 *
 * One sheet, four columns — employee_code, cost_centre_code, process_code, lob_code — sets
 * employees.cost_centre_id (+ the legacy cost_center_code text), employees.process_id and
 * employees.lob_id together. Each of the three org columns accepts the master's code, or its
 * exact name when that name is unique. A row is applied only when EVERY rule below holds;
 * otherwise the whole row is rejected with its reason and the rest of the file still applies:
 *
 *   - the employee exists, is active, has a branch, and is inside the uploader's WFM scope
 *     (resolveWfmScope; an employee with no process yet is in scope for a caller who holds
 *     that employee's branch);
 *   - the process exists, is active, is inside the uploader's scope, and belongs to the
 *     employee's branch (or is a shared process with no branch);
 *   - the cost centre exists, is open (active, not closed) and is one of MAS Callnet's own,
 *     and belongs to the employee's branch (a cost centre with no branch is left to the branch
 *     check, as the single-employee editor does);
 *   - the LOB exists, is active, and is ACTIVELY mapped to that process in process_lob_map;
 *   - the employee_code is not repeated earlier in the file and no cell is blank (this uploader
 *     never clears a value — use the single-employee screens for that).
 *
 * There is deliberately no process<->cost-centre allow-list: cost_centre_master.process_id is
 * empty and a cost centre routinely serves several processes, so the branch + open-cost-centre
 * checks are the enforceable rule. Codes and names are matched trimmed and case-insensitively
 * IN JAVASCRIPT after fetching the (small) masters — no COLLATE casts on indexed columns
 * because prod has mixed collations. Writes are one transaction, one audit_action_log row.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import {
  LOB_MODULE_KEY,
  processScopeSql,
  type ScopeSql,
} from "../wfm/process-lob-map.service.js";
import { resolveWfmScope } from "../wfm/wfm-scope-fallback.js";
import { DashboardScopeConfigurationError } from "../../shared/dashboardScope.js";
import {
  chunk,
  marks,
  norm,
  parseData,
  resolveRef,
  buildRefIndex,
  type BatchRow,
  type RefIndex,
} from "./employee-org-mapping.helpers.js";

export const EMPLOYEE_LOB_UPLOAD_TYPE = "EMPLOYEE_LOB_MAPPING";
/** cost_centre_master.company_name of MAS's own cost centres (the others are IDC and Pikquick). */
const MAS_COMPANY_NAME = "Mas Callnet India Pvt Ltd";
const CHUNK_SIZE = 500;
const AUDIT_SAMPLE_SIZE = 200;
const DENY_ALL_SCOPE: ScopeSql = { sql: "1=0", params: [] };

interface EmployeeInfo {
  id: string;
  employeeCode: string;
  branchId: string | null;
  processId: string | null;
  lobId: string | null;
  costCentreId: string | null;
  active: boolean;
  inScope: boolean;
}

interface ProcessInfo {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  active: boolean;
  inScope: boolean;
}

interface CostCentreInfo {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  company: string | null;
  open: boolean;
}

interface LobInfo {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  costCentreRef: string;
  processRef: string;
  lobRef: string;
}

interface PlannedUpdate {
  rowId: string;
  employeeId: string;
  employeeCode: string;
  old: {
    processId: string | null;
    lobId: string | null;
    costCentreId: string | null;
  };
  next: {
    processId: string;
    lobId: string;
    costCentreId: string;
    costCentreCode: string;
  };
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

interface Lookups {
  employees: Map<string, EmployeeInfo>;
  processes: RefIndex<ProcessInfo>;
  costCentres: RefIndex<CostCentreInfo>;
  lobs: RefIndex<LobInfo>;
  mappings: Set<string>;
  scopeError: string | null;
}

interface CallerScope {
  scope: ScopeSql;
  /** Branches the caller holds outright (BRANCH_ALL / CUSTOM_SCOPE); empty otherwise. */
  branchIds: string[];
  scopeError: string | null;
}

/** Scope failure becomes a per-row rejection reason rather than a batch crash. */
async function loadScope(userId: string): Promise<CallerScope> {
  const ctx = await getUserRoleContext(userId);
  try {
    const dash = await resolveWfmScope({
      id: userId,
      role: ctx.primaryRole,
    });
    const holdsBranches =
      dash.level === "BRANCH_ALL" || dash.level === "CUSTOM_SCOPE";
    return {
      scope: processScopeSql(dash),
      branchIds: holdsBranches ? dash.branchIds : [],
      scopeError: null,
    };
  } catch (err) {
    if (err instanceof DashboardScopeConfigurationError) {
      return {
        scope: DENY_ALL_SCOPE,
        branchIds: [],
        scopeError:
          "Your account has no branch/process scope configured for WFM.",
      };
    }
    throw err;
  }
}

/**
 * Employee row scope. The process scope alone cannot see an employee who has no process yet
 * (there is no process to test), and assigning one is this upload's main job — so such an
 * employee is also in scope for a caller who holds that employee's branch.
 */
function employeeScopeSql(caller: CallerScope): ScopeSql {
  const base = caller.scope.employee ?? caller.scope;
  if (caller.branchIds.length === 0) return base;
  return {
    sql: `((${base.sql}) OR (e.process_id IS NULL AND e.branch_id IN (${marks(caller.branchIds.length)})))`,
    params: [...base.params, ...caller.branchIds],
  };
}

async function loadEmployees(
  codes: string[],
  caller: CallerScope,
): Promise<Map<string, EmployeeInfo>> {
  const scope = employeeScopeSql(caller);
  const byCode = new Map<string, EmployeeInfo>();
  // Both the trimmed original and the upper-case variant are sent so a case-sensitive column
  // collation still matches; the result is keyed case-insensitively in JS.
  const variants = Array.from(
    new Set(codes.flatMap((c) => [c, c.toUpperCase()])),
  );
  for (const part of chunk(variants, CHUNK_SIZE)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.branch_id, e.process_id, e.lob_id, e.cost_centre_id,
              e.active_status, CASE WHEN ${scope.sql} THEN 1 ELSE 0 END AS in_scope
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
        branchId: r.branch_id ? String(r.branch_id) : null,
        processId: r.process_id ? String(r.process_id) : null,
        lobId: r.lob_id ? String(r.lob_id) : null,
        costCentreId: r.cost_centre_id ? String(r.cost_centre_id) : null,
        active: Number(r.active_status) === 1,
        inScope: Number(r.in_scope) === 1,
      });
    }
  }
  return byCode;
}

async function loadProcesses(scope: ScopeSql): Promise<RefIndex<ProcessInfo>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pm.id, pm.process_code, pm.process_name, pm.branch_id, pm.active_status,
            CASE WHEN ${scope.sql} THEN 1 ELSE 0 END AS in_scope
       FROM process_master pm`,
    scope.params,
  );
  return buildRefIndex(
    rows.map((r) => ({
      id: String(r.id),
      code: String(r.process_code ?? ""),
      name: String(r.process_name ?? ""),
      branchId: r.branch_id ? String(r.branch_id) : null,
      active: Number(r.active_status) === 1,
      inScope: Number(r.in_scope) === 1,
    })),
  );
}

async function loadCostCentres(): Promise<RefIndex<CostCentreInfo>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, cost_centre_code, cost_centre_name, branch_id, company_name, active_status, status
       FROM cost_centre_master`,
  );
  return buildRefIndex(
    rows.map((r) => ({
      id: String(r.id),
      code: String(r.cost_centre_code ?? ""),
      name: String(r.cost_centre_name ?? ""),
      branchId: r.branch_id ? String(r.branch_id) : null,
      company: r.company_name ? String(r.company_name) : null,
      open:
        Number(r.active_status) === 1 &&
        String(r.status ?? "").toLowerCase() !== "closed",
    })),
  );
}

async function loadLobs(): Promise<RefIndex<LobInfo>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, lob_code, lob_name, active_status FROM lob_master`,
  );
  return buildRefIndex(
    rows.map((r) => ({
      id: String(r.id),
      code: String(r.lob_code ?? ""),
      name: String(r.lob_name ?? ""),
      active: Number(r.active_status) === 1,
    })),
  );
}

/** Set of "processId|lobId" for every ACTIVE mapping (a few dozen rows). */
async function loadActiveMappings(): Promise<Set<string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, lob_id FROM process_lob_map WHERE active_status = 1`,
  );
  return new Set(rows.map((r) => `${r.process_id}|${r.lob_id}`));
}

/** Parse every staged row, rejecting blanks and repeated employee codes. */
function parseRows(
  batchRows: BatchRow[],
  errors: RowError[],
  messages: string[],
): ParsedRow[] {
  const parsed: ParsedRow[] = [];
  const firstRowByEmployee = new Map<string, number>();
  const reject = (row: BatchRow, message: string) => {
    errors.push({ rowId: row.id, message });
    messages.push(`Row ${row.row_no}: ${message}`);
  };
  for (const row of batchRows) {
    const data = parseData(row.normalized_data);
    const employeeCode = String(data.employee_code ?? "").trim();
    const costCentreRef = String(data.cost_centre_code ?? "").trim();
    const processRef = String(data.process_code ?? "").trim();
    const lobRef = String(data.lob_code ?? "").trim();
    if (!employeeCode || !costCentreRef || !processRef || !lobRef) {
      reject(
        row,
        "employee_code, cost_centre_code, process_code and lob_code are all required (this upload cannot clear a value)",
      );
      continue;
    }
    const key = norm(employeeCode);
    const firstRow = firstRowByEmployee.get(key);
    if (firstRow !== undefined) {
      reject(
        row,
        `Duplicate employee_code "${employeeCode}" — already on row ${firstRow}; only the first occurrence is processed`,
      );
      continue;
    }
    firstRowByEmployee.set(key, row.row_no);
    parsed.push({
      rowId: row.id,
      rowNo: row.row_no,
      employeeCode,
      costCentreRef,
      processRef,
      lobRef,
    });
  }
  return parsed;
}

type Checked<T> = { error: string } | { value: T };

function checkProcess(
  row: ParsedRow,
  emp: EmployeeInfo,
  lk: Lookups,
): Checked<ProcessInfo> {
  const found = resolveRef(lk.processes, row.processRef);
  if (found.kind === "ambiguous")
    return {
      error: `Process "${row.processRef}" matches ${found.count} processes — use the process code`,
    };
  if (found.kind === "missing")
    return { error: `Process "${row.processRef}" not found in Process Master` };
  const process = found.item;
  if (!process.active) return { error: `Process ${process.code} is inactive` };
  if (!process.inScope)
    return { error: `Process ${process.code} is outside your scope` };
  if (process.branchId && process.branchId !== emp.branchId)
    return {
      error: `Process ${process.code} belongs to a different branch than employee "${emp.employeeCode}"`,
    };
  return { value: process };
}

function checkCostCentre(
  row: ParsedRow,
  emp: EmployeeInfo,
  lk: Lookups,
): Checked<CostCentreInfo> {
  const found = resolveRef(lk.costCentres, row.costCentreRef);
  if (found.kind === "ambiguous")
    return {
      error: `Cost centre "${row.costCentreRef}" matches ${found.count} cost centres — use the cost centre code`,
    };
  if (found.kind === "missing")
    return {
      error: `Cost centre "${row.costCentreRef}" not found in Cost Centre Master`,
    };
  const cc = found.item;
  if (cc.company !== MAS_COMPANY_NAME)
    return {
      error: `Cost centre ${cc.code} is not a ${MAS_COMPANY_NAME} cost centre`,
    };
  if (!cc.open)
    return { error: `Cost centre ${cc.code} is closed or inactive` };
  if (cc.branchId && cc.branchId !== emp.branchId)
    return {
      error: `Cost centre ${cc.code} belongs to a different branch than employee "${emp.employeeCode}"`,
    };
  return { value: cc };
}

function checkLob(
  row: ParsedRow,
  process: ProcessInfo,
  lk: Lookups,
): Checked<LobInfo> {
  const found = resolveRef(lk.lobs, row.lobRef);
  if (found.kind === "ambiguous")
    return {
      error: `LOB "${row.lobRef}" matches ${found.count} LOBs — use the LOB code`,
    };
  if (found.kind === "missing")
    return { error: `LOB "${row.lobRef}" not found in LOB master` };
  const lob = found.item;
  if (!lob.active) return { error: `LOB ${lob.code} is inactive` };
  if (!lk.mappings.has(`${process.id}|${lob.id}`))
    return {
      error: `LOB ${lob.code} is not mapped to process ${process.code} — add it in Process LOB Mapping first`,
    };
  return { value: lob };
}

/** First failing rule for a row, or the planned change (null change = already set). */
function validateRow(
  row: ParsedRow,
  lk: Lookups,
): { error: string } | { change: PlannedUpdate | null } {
  const emp = lk.employees.get(norm(row.employeeCode));
  if (!emp || !emp.inScope) {
    return {
      error:
        lk.scopeError ??
        `Employee "${row.employeeCode}" not found or outside your scope`,
    };
  }
  if (!emp.active)
    return { error: `Employee "${row.employeeCode}" is inactive` };
  if (!emp.branchId)
    return {
      error: `Employee "${row.employeeCode}" has no branch assigned — assign a branch first`,
    };

  const process = checkProcess(row, emp, lk);
  if ("error" in process) return process;
  const cc = checkCostCentre(row, emp, lk);
  if ("error" in cc) return cc;
  const lob = checkLob(row, process.value, lk);
  if ("error" in lob) return lob;

  if (
    emp.processId === process.value.id &&
    emp.lobId === lob.value.id &&
    emp.costCentreId === cc.value.id
  )
    return { change: null };
  return {
    change: {
      rowId: row.rowId,
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      old: {
        processId: emp.processId,
        lobId: emp.lobId,
        costCentreId: emp.costCentreId,
      },
      next: {
        processId: process.value.id,
        lobId: lob.value.id,
        costCentreId: cc.value.id,
        costCentreCode: cc.value.code,
      },
    },
  };
}

type Conn = { execute: (sql: string, params?: unknown[]) => Promise<unknown> };

async function applyEmployeeUpdates(
  conn: Conn,
  changes: PlannedUpdate[],
): Promise<void> {
  for (const part of chunk(changes, CHUNK_SIZE)) {
    const cases = part.map(() => "WHEN ? THEN ?").join(" ");
    const pairs = (pick: (c: PlannedUpdate) => string) =>
      part.flatMap((c) => [c.employeeId, pick(c)]);
    await conn.execute(
      `UPDATE employees
          SET process_id = CASE id ${cases} END,
              lob_id = CASE id ${cases} END,
              cost_centre_id = CASE id ${cases} END,
              cost_center_code = CASE id ${cases} END,
              updated_at = NOW()
        WHERE id IN (${marks(part.length)})`,
      [
        ...pairs((c) => c.next.processId),
        ...pairs((c) => c.next.lobId),
        ...pairs((c) => c.next.costCentreId),
        ...pairs((c) => c.next.costCentreCode),
        ...part.map((c) => c.employeeId),
      ],
    );
  }
}

async function markRows(
  conn: Conn,
  importedIds: string[],
  errors: RowError[],
): Promise<void> {
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
      [
        ...part.flatMap((e) => [
          e.rowId,
          JSON.stringify([e.message.slice(0, 500)]),
        ]),
        ...part.map((e) => e.rowId),
      ],
    );
  }
}

async function loadLookups(
  parsed: ParsedRow[],
  caller: CallerScope,
): Promise<Lookups> {
  const employees = await loadEmployees(
    parsed.map((r) => r.employeeCode),
    caller,
  );
  const [processes, costCentres, lobs, mappings] = await Promise.all([
    loadProcesses(caller.scope),
    loadCostCentres(),
    loadLobs(),
    loadActiveMappings(),
  ]);
  return {
    employees,
    processes,
    costCentres,
    lobs,
    mappings,
    scopeError: caller.scopeError,
  };
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
    return {
      importedRows: 0,
      errorRows: 0,
      errors: [],
      updatedRows: 0,
      unchangedRows: 0,
    };
  }

  const rowErrors: RowError[] = [];
  const messages: string[] = [];
  const parsed = parseRows(batchRows, rowErrors, messages);

  const caller = await loadScope(importedByUserId);
  const lookups = parsed.length ? await loadLookups(parsed, caller) : null;

  const changes: PlannedUpdate[] = [];
  const okRowIds: string[] = [];
  for (const row of parsed) {
    const result = validateRow(row, lookups!);
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
  const finalStatus =
    errorRows === 0
      ? "imported"
      : importedRows === 0
        ? "validation_failed"
        : "imported_with_errors";

  // Writes are one transaction: a dropped connection mid-file leaves no half-applied mappings
  // and rows stay 'pending' for a retry. Per-row rejections above are outcomes, not aborts.
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
    action_type: "employee.org_mapping.bulk_upload",
    module_key: LOB_MODULE_KEY,
    entity_type: "upload_batch",
    entity_id: batchId,
    metadata: {
      total_rows: batchRows.length,
      updated: changes.length,
      unchanged: importedRows - changes.length,
      rejected: errorRows,
      employee_ids_sample: changes
        .slice(0, AUDIT_SAMPLE_SIZE)
        .map((c) => c.employeeId),
      changes_sample: changes.slice(0, AUDIT_SAMPLE_SIZE).map((c) => ({
        employee_code: c.employeeCode,
        old: {
          process_id: c.old.processId,
          lob_id: c.old.lobId,
          cost_centre_id: c.old.costCentreId,
        },
        new: {
          process_id: c.next.processId,
          lob_id: c.next.lobId,
          cost_centre_id: c.next.costCentreId,
        },
      })),
    },
  });

  return {
    importedRows,
    errorRows,
    errors: messages,
    updatedRows: changes.length,
    unchangedRows: importedRows - changes.length,
  };
}
