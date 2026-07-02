import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { OFFICIAL_EMAIL_REGEX } from './it-provisioning.service.js';

export async function importOfficialEmailBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  // Fetch all staged rows for this batch
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
    const officialEmail: string = String(data.official_email ?? '').trim();

    const rowErrors: string[] = [];

    if (!employeeCode) rowErrors.push('employee_code is required');
    if (!officialEmail) rowErrors.push('official_email is required');
    else if (!OFFICIAL_EMAIL_REGEX.test(officialEmail)) {
      rowErrors.push(`official_email "${officialEmail}" must be @teammas.in or @teammas.co.in`);
    }

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
      `SELECT id, first_name, last_name, official_email AS current_email
       FROM employees
       WHERE employee_code = ? AND active_status = 1 LIMIT 1`,
      [employeeCode],
    );
    const emp = (empRows as any[])[0];

    if (!emp) {
      const msg = `Employee with code "${employeeCode}" not found or inactive`;
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        [JSON.stringify([msg]), rowId],
      );
      errorRows++;
      errors.push(`Row ${rowNo}: ${msg}`);
      continue;
    }

    // Update official_email
    await db.execute(
      `UPDATE employees SET official_email = ?, updated_at = NOW() WHERE id = ?`,
      [officialEmail, emp.id],
    );

    await logSensitiveAction({
      actor_user_id: importedByUserId,
      action_type: 'official_email_bulk_update',
      module_key: 'employees',
      entity_type: 'employee',
      entity_id: emp.id,
      change_summary: {
        employee_code: employeeCode,
        previous_email: emp.current_email ?? null,
        new_email: officialEmail,
      },
    });

    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported', error_messages = NULL WHERE id = ?`,
      [rowId],
    );
    importedRows++;
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
