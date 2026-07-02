import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';

export async function importReportingManagerBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
     WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
     ORDER BY row_no`,
    [batchId],
  );

  let importedRows = 0;
  let errorRows = 0;
  const errors: string[] = [];

  for (const row of batchRows as any[]) {
    const rowId: string = row.id;
    const rowNo: number = row.row_no;
    const data = typeof row.normalized_data === 'string'
      ? JSON.parse(row.normalized_data)
      : (row.normalized_data ?? {});

    const employeeCode: string = String(data.employee_code ?? '').trim();
    const managerCode: string = String(data.manager_code ?? '').trim();

    const rowErrors: string[] = [];
    if (!employeeCode) rowErrors.push('employee_code is required');
    if (!managerCode) rowErrors.push('manager_code is required');

    if (rowErrors.length > 0) {
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        [JSON.stringify(rowErrors), rowId],
      );
      errorRows++;
      errors.push(`Row ${rowNo}: ${rowErrors.join('; ')}`);
      continue;
    }

    // Lookup employee
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, reporting_manager_id FROM employees WHERE employee_code = ? AND active_status = 1 LIMIT 1`,
      [employeeCode],
    );
    const emp = (empRows as any[])[0];
    if (!emp) {
      const msg = `Employee "${employeeCode}" not found or inactive`;
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        [JSON.stringify([msg]), rowId],
      );
      errorRows++;
      errors.push(`Row ${rowNo}: ${msg}`);
      continue;
    }

    // Prevent self-assignment
    if (employeeCode === managerCode) {
      const msg = `Employee and manager cannot be the same (${employeeCode})`;
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        [JSON.stringify([msg]), rowId],
      );
      errorRows++;
      errors.push(`Row ${rowNo}: ${msg}`);
      continue;
    }

    // Lookup manager
    const [mgrRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, CONCAT(first_name, ' ', COALESCE(last_name,'')) AS mgr_name
       FROM employees WHERE employee_code = ? AND active_status = 1 LIMIT 1`,
      [managerCode],
    );
    const mgr = (mgrRows as any[])[0];
    if (!mgr) {
      const msg = `Manager "${managerCode}" not found or inactive`;
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        [JSON.stringify([msg]), rowId],
      );
      errorRows++;
      errors.push(`Row ${rowNo}: ${msg}`);
      continue;
    }

    const previousManagerId = emp.reporting_manager_id ?? null;

    await db.execute(
      `UPDATE employees SET reporting_manager_id = ?, updated_at = NOW() WHERE id = ?`,
      [mgr.id, emp.id],
    );

    await logSensitiveAction({
      actor_user_id: importedByUserId,
      action_type: 'reporting_manager_bulk_update',
      module_key: 'employees',
      entity_type: 'employee',
      entity_id: emp.id,
      change_summary: {
        employee_code: employeeCode,
        previous_manager_id: previousManagerId,
        new_manager_id: mgr.id,
        new_manager_name: mgr.mgr_name?.trim() ?? null,
      },
    });

    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported', error_messages = NULL WHERE id = ?`,
      [rowId],
    );
    importedRows++;
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
