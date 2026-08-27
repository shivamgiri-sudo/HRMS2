import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { recordManagerChange } from '../management/manager-attribution.service.js';

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: unknown;
}

interface EmployeeRow extends RowDataPacket {
  id: string;
  employee_code: string;
  reporting_manager_id: string | null;
  mgr_name: string | null;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  managerCode: string;
}

interface ErrorUpdate {
  rowId: string;
  messages: string[];
}

export async function importReportingManagerBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
     WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
     ORDER BY row_no`,
    [batchId],
  );

  if (batchRows.length === 0) {
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const parsed: ParsedRow[] = [];
  const errorUpdates: ErrorUpdate[] = [];
  const errors: string[] = [];
  let errorRows = 0;
  const codeSet = new Set<string>();

  for (const row of batchRows) {
    const data = typeof row.normalized_data === 'string'
      ? JSON.parse(row.normalized_data)
      : (row.normalized_data ?? {});

    const employeeCode: string = String(data.employee_code ?? '').trim();
    const managerCode: string = String(data.manager_code ?? '').trim();

    const rowErrors: string[] = [];
    if (!employeeCode) rowErrors.push('employee_code is required');
    if (!managerCode) rowErrors.push('manager_code is required');

    if (rowErrors.length > 0) {
      errorRows++;
      errors.push(`Row ${row.row_no}: ${rowErrors.join('; ')}`);
      errorUpdates.push({ rowId: row.id, messages: rowErrors });
      continue;
    }

    parsed.push({ rowId: row.id, rowNo: row.row_no, employeeCode, managerCode });
    codeSet.add(employeeCode);
    codeSet.add(managerCode);
  }

  // One bulk lookup covering every employee_code and manager_code in the file,
  // instead of two SELECTs per row (employee, then manager). For an 800+ row
  // file that used to be 1,600+ sequential round trips on its own — the main
  // reason a single import could run past the frontend's request timeout even
  // though it eventually completed successfully in the background.
  const codes = Array.from(codeSet);
  const employeeMap = new Map<string, EmployeeRow>();
  if (codes.length > 0) {
    const [empRows] = await db.execute<EmployeeRow[]>(
      `SELECT id, employee_code, reporting_manager_id,
              CONCAT(first_name, ' ', COALESCE(last_name,'')) AS mgr_name
       FROM employees WHERE employee_code IN (${codes.map(() => '?').join(',')}) AND active_status = 1`,
      codes,
    );
    for (const emp of empRows) employeeMap.set(emp.employee_code, emp);
  }

  let importedRows = 0;
  const importedRowIds: string[] = [];
  const managerUpdates: Array<{ empId: string; mgrId: string }> = [];
  const auditEntries: Array<{
    employeeCode: string; empId: string; previousManagerId: string | null; mgrId: string; mgrName: string | null;
  }> = [];

  for (const row of parsed) {
    const emp = employeeMap.get(row.employeeCode);
    if (!emp) {
      const msg = `Employee "${row.employeeCode}" not found or inactive`;
      errorRows++;
      errors.push(`Row ${row.rowNo}: ${msg}`);
      errorUpdates.push({ rowId: row.rowId, messages: [msg] });
      continue;
    }

    if (row.employeeCode === row.managerCode) {
      const msg = `Employee and manager cannot be the same (${row.employeeCode})`;
      errorRows++;
      errors.push(`Row ${row.rowNo}: ${msg}`);
      errorUpdates.push({ rowId: row.rowId, messages: [msg] });
      continue;
    }

    const mgr = employeeMap.get(row.managerCode);
    if (!mgr) {
      const msg = `Manager "${row.managerCode}" not found or inactive`;
      errorRows++;
      errors.push(`Row ${row.rowNo}: ${msg}`);
      errorUpdates.push({ rowId: row.rowId, messages: [msg] });
      continue;
    }

    managerUpdates.push({ empId: emp.id, mgrId: mgr.id });
    auditEntries.push({
      employeeCode: row.employeeCode,
      empId: emp.id,
      previousManagerId: emp.reporting_manager_id ?? null,
      mgrId: mgr.id,
      mgrName: mgr.mgr_name?.trim() ?? null,
    });
    importedRowIds.push(row.rowId);
    importedRows++;
  }

  // One CASE-based UPDATE instead of one UPDATE per employee. SQL's CASE takes
  // the first matching WHEN, so if the same employee_code appears on more than
  // one row we dedupe to the LAST occurrence first — matching the original
  // per-row loop, where a later row's sequential UPDATE always overwrote an
  // earlier one for the same employee.
  if (managerUpdates.length > 0) {
    const lastByEmployee = new Map<string, string>();
    for (const u of managerUpdates) lastByEmployee.set(u.empId, u.mgrId);
    const dedupedUpdates = Array.from(lastByEmployee.entries());
    const cases = dedupedUpdates.map(() => 'WHEN ? THEN ?').join(' ');
    const caseParams = dedupedUpdates.flatMap(([empId, mgrId]) => [empId, mgrId]);
    const ids = dedupedUpdates.map(([empId]) => empId);
    await db.execute(
      `UPDATE employees SET reporting_manager_id = CASE id ${cases} END, updated_at = NOW()
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      [...caseParams, ...ids],
    );

    // Effective-dated history for every row in the batch. This is the highest-volume
    // manager-change path in the platform, so it is also the one whose absence would do the
    // most damage: without a history row, each of these reassignments silently moves the
    // employee's entire past attrition onto their NEW manager and off the old one.
    // Sequential and non-blocking — see manager-attribution.service.ts.
    for (const [empId, mgrId] of dedupedUpdates) {
      await recordManagerChange({
        employeeId: empId,
        newManagerId: mgrId,
        changedBy: importedByUserId ?? null,
        reason: 'Bulk reporting-manager upload',
      });
    }
  }

  // Audit trail is left one INSERT per change — it's a compliance record where
  // each entry needs its own before/after values, not a hot path worth the risk
  // of rewriting the shared audit helper for.
  for (const entry of auditEntries) {
    await logSensitiveAction({
      actor_user_id: importedByUserId,
      action_type: 'reporting_manager_bulk_update',
      module_key: 'employees',
      entity_type: 'employee',
      entity_id: entry.empId,
      change_summary: {
        employee_code: entry.employeeCode,
        previous_manager_id: entry.previousManagerId,
        new_manager_id: entry.mgrId,
        new_manager_name: entry.mgrName,
      },
    });
  }

  if (importedRowIds.length > 0) {
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported', error_messages = NULL
       WHERE id IN (${importedRowIds.map(() => '?').join(',')})`,
      importedRowIds,
    );
  }

  if (errorUpdates.length > 0) {
    const cases = errorUpdates.map(() => 'WHEN ? THEN ?').join(' ');
    const caseParams = errorUpdates.flatMap((u) => [u.rowId, JSON.stringify(u.messages)]);
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      [...caseParams, ...ids],
    );
  }

  const finalStatus = errorRows === 0
    ? 'imported'
    : importedRows === 0 ? 'validation_failed' : 'imported_with_errors';

  await db.execute(
    `UPDATE upload_batch
     SET batch_status = ?, imported_rows = ?, error_rows = ?, updated_at = NOW()
     WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
