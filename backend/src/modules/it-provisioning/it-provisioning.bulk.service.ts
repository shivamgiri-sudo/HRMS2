import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { OFFICIAL_EMAIL_REGEX } from './it-provisioning.service.js';

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: unknown;
}

interface EmployeeRow extends RowDataPacket {
  id: string;
  employee_code: string;
  official_email: string | null;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  officialEmail: string;
}

export async function importOfficialEmailBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  // Fetch all staged rows for this batch
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
  const errors: string[] = [];
  let errorRows = 0;
  const errorUpdates: Array<{ rowId: string; messages: string[] }> = [];
  const employeeCodes = new Set<string>();

  for (const row of batchRows) {
    const data = typeof row.normalized_data === 'string'
      ? JSON.parse(row.normalized_data)
      : (row.normalized_data ?? {});

    const employeeCode: string = String(data.employee_code ?? '').trim();
    const officialEmail: string = String(data.official_email ?? '').trim();

    const rowErrors: string[] = [];
    if (!employeeCode) rowErrors.push('employee_code is required');
    if (!officialEmail) rowErrors.push('official_email is required');
    else if (!OFFICIAL_EMAIL_REGEX.test(officialEmail)) {
      rowErrors.push(`official_email "${officialEmail}" must be @teammas.in or @teammas.co.in`);
    }

    if (rowErrors.length > 0) {
      errorRows++;
      errors.push(`Row ${row.row_no}: ${rowErrors.join('; ')}`);
      errorUpdates.push({ rowId: row.id, messages: rowErrors });
      continue;
    }

    parsed.push({ rowId: row.id, rowNo: row.row_no, employeeCode, officialEmail });
    employeeCodes.add(employeeCode);
  }

  // One bulk lookup covering every employee_code in the file, instead of one
  // SELECT per row.
  const codes = Array.from(employeeCodes);
  const employeeMap = new Map<string, EmployeeRow>();
  if (codes.length > 0) {
    const [empRows] = await db.execute<EmployeeRow[]>(
      `SELECT id, employee_code, official_email
       FROM employees WHERE employee_code IN (${codes.map(() => '?').join(',')}) AND active_status = 1`,
      codes,
    );
    for (const emp of empRows) employeeMap.set(emp.employee_code, emp);
  }

  let importedRows = 0;
  const importedRowIds: string[] = [];
  const emailUpdates: Array<{ empId: string; email: string }> = [];
  const auditEntries: Array<{ employeeCode: string; empId: string; previousEmail: string | null; newEmail: string }> = [];

  for (const row of parsed) {
    const emp = employeeMap.get(row.employeeCode);
    if (!emp) {
      const msg = `Employee with code "${row.employeeCode}" not found or inactive`;
      errorRows++;
      errors.push(`Row ${row.rowNo}: ${msg}`);
      errorUpdates.push({ rowId: row.rowId, messages: [msg] });
      continue;
    }

    emailUpdates.push({ empId: emp.id, email: row.officialEmail });
    auditEntries.push({
      employeeCode: row.employeeCode,
      empId: emp.id,
      previousEmail: emp.official_email ?? null,
      newEmail: row.officialEmail,
    });
    importedRowIds.push(row.rowId);
    importedRows++;
  }

  // One CASE-based UPDATE instead of one UPDATE per employee. SQL's CASE
  // takes the first matching WHEN, so a duplicate employee_code is deduped to
  // the LAST occurrence first — matching the original per-row loop, where a
  // later row's sequential UPDATE always overwrote an earlier one.
  if (emailUpdates.length > 0) {
    const lastByEmployee = new Map<string, string>();
    for (const u of emailUpdates) lastByEmployee.set(u.empId, u.email);
    const deduped = Array.from(lastByEmployee.entries());
    const cases = deduped.map(() => 'WHEN ? THEN ?').join(' ');
    const caseParams = deduped.flatMap(([empId, email]) => [empId, email]);
    const ids = deduped.map(([empId]) => empId);
    await db.execute(
      `UPDATE employees SET official_email = CASE id ${cases} END, updated_at = NOW()
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      [...caseParams, ...ids],
    );
  }

  // Audit trail stays one INSERT per change — each entry needs its own
  // before/after values and this is a compliance record, not a hot path.
  for (const entry of auditEntries) {
    await logSensitiveAction({
      actor_user_id: importedByUserId,
      action_type: 'official_email_bulk_update',
      module_key: 'employees',
      entity_type: 'employee',
      entity_id: entry.empId,
      change_summary: {
        employee_code: entry.employeeCode,
        previous_email: entry.previousEmail,
        new_email: entry.newEmail,
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

  // Update batch status
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
