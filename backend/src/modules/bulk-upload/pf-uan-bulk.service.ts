import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

interface EmployeeRow extends RowDataPacket {
  id: string;
  employee_code: string;
}

interface ExistingUanRow extends RowDataPacket {
  employee_id: string;
  uan_number: string | null;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  rawUan: string;
}

/** EPFO issues a 12 digit Universal Account Number. */
const UAN_PATTERN = /^[0-9]{12}$/;

/**
 * The same masking the PF creation service applies, so the compliance profile
 * never carries a UAN in full.
 */
function maskUan(uan: string): string {
  return uan.replace(/^.{8}/, "XXXXXXXX");
}

/**
 * Bulk assignment of PF Universal Account Numbers.
 *
 * A UAN is a statutory identifier, so three things follow from that and are
 * deliberate here:
 *
 *   - employee_statutory_info.uan_number is the live store, holding 2,171
 *     values today, and employee_uan is the normalised table the PF creation
 *     service writes. Both are kept in step so neither becomes stale.
 *   - the compliance profile only ever receives the masked form.
 *   - nothing raw is written to the audit trail or to a row error message;
 *     only the masked value is recorded, which is enough to trace a change
 *     without copying the identifier into another table.
 *
 * A row is refused rather than overwritten when the employee already holds a
 * different UAN, since silently replacing one is a payroll and EPFO problem
 * rather than a correction. Re-uploading the same value stays harmless.
 *
 * The employee and existing-UAN lookups are bulk-prefetched (2 queries total)
 * instead of one SELECT per row each — for an 800-row file that alone used to
 * be 1,600+ sequential round trips before any write even happened. The actual
 * writes stay one row at a time: each row touches three different tables plus
 * the audit trail, and a statutory identifier is not where batching's
 * error-isolation trade-offs belong.
 */
export async function importPfUanBatch(
  batchId: string,
  importedByUserId: string
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId]
  );

  if (batchRows.length === 0) {
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  let errorRows = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const employeeCodes = new Set<string>();

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : (row.normalized_data ?? {});

    const employeeCode = String(
      data.employee_code ?? data.employee_id ?? data.emp_code ?? ""
    ).trim();
    const rawUan = String(data.uan ?? data.uan_number ?? "").replace(/\D/g, "");

    if (!employeeCode) {
      const msg = `Row ${row.row_no}: employee_code is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }
    if (!UAN_PATTERN.test(rawUan)) {
      const msg = `Row ${row.row_no}: UAN must be exactly 12 digits (received ${rawUan.length} digits)`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    parsed.push({ rowId: row.id, rowNo: row.row_no, employeeCode, rawUan });
    employeeCodes.add(employeeCode);
  }

  const employeeMap = new Map<string, EmployeeRow>();
  if (employeeCodes.size > 0) {
    const codes = Array.from(employeeCodes);
    const [rows] = await db.execute<EmployeeRow[]>(
      `SELECT id, employee_code FROM employees WHERE employee_code IN (${codes.map(() => "?").join(",")})`,
      codes
    );
    for (const r of rows) employeeMap.set(r.employee_code, r);
  }

  const existingUanByEmployeeId = new Map<string, string>();
  const employeeIds = Array.from(employeeMap.values()).map((e) => e.id);
  if (employeeIds.length > 0) {
    const [rows] = await db.execute<ExistingUanRow[]>(
      `SELECT employee_id, uan_number FROM employee_statutory_info WHERE employee_id IN (${employeeIds.map(() => "?").join(",")})`,
      employeeIds
    );
    for (const r of rows) {
      if (r.uan_number) existingUanByEmployeeId.set(r.employee_id, r.uan_number);
    }
  }

  let importedRows = 0;

  for (const row of parsed) {
    try {
      const emp = employeeMap.get(row.employeeCode);
      if (!emp) {
        throw new Error(`Row ${row.rowNo}: no employee with code ${row.employeeCode}`);
      }
      const employeeId = emp.id;

      const currentUan = String(existingUanByEmployeeId.get(employeeId) ?? "").replace(/\D/g, "");
      if (currentUan && currentUan !== row.rawUan) {
        throw new Error(
          `Row ${row.rowNo}: ${row.employeeCode} already holds UAN ${maskUan(currentUan)}. ` +
            `Clear it deliberately before assigning a different one.`
        );
      }

      // The statutory record is the live store for this identifier.
      await db.execute(
        `INSERT INTO employee_statutory_info (id, employee_id, uan_number, created_at, updated_at)
         VALUES (UUID(), ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE uan_number = VALUES(uan_number), updated_at = NOW()`,
        [employeeId, row.rawUan]
      );

      // Keep the normalised table the PF creation service reads in step.
      await db.execute(
        `INSERT INTO employee_uan
           (id, employee_id, uan, eps_eligible, is_active, verification_status, created_at, updated_at)
         SELECT UUID(), ?, ?, 0, 1, 'pending', NOW(), NOW()
         ON DUPLICATE KEY UPDATE uan = VALUES(uan), is_active = 1, updated_at = NOW()`,
        [employeeId, row.rawUan]
      );

      // Only the masked form reaches the compliance profile, and only when the
      // employee already has one.
      await db.execute(
        `UPDATE employee_epf_compliance_profile
            SET uan_masked = ?, universal_account_status = 'active', updated_at = NOW()
          WHERE employee_id = ?`,
        [maskUan(row.rawUan), employeeId]
      );

      await writeAuditLog({
        actor_user_id: importedByUserId,
        action_type: "BULK_UAN_ASSIGNED",
        module_key: "bulk-upload",
        entity_type: "employee_statutory_info",
        entity_id: employeeId,
        employee_id: employeeId,
        // Masked on purpose: the audit trail records that a UAN was set, not
        // the number itself.
        change_summary: { employee_code: row.employeeCode, uan_masked: maskUan(row.rawUan) },
        metadata: { upload_batch_id: batchId, row_no: row.rowNo },
      });

      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'imported' WHERE id = ?`,
        [row.rowId]
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      // error_messages is the JSON array column; error_message does not exist.
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        [JSON.stringify([msg.slice(0, 500)]), row.rowId]
      );
      errorRows++;
    }
  }

  // These are the pre-parse validation failures (missing employee_code /
  // malformed UAN) — errorRows and `errors` were already updated for them
  // above, at the point each was found; this only performs the deferred
  // batch write for those row-status updates.
  if (errorUpdates.length > 0) {
    const cases = errorUpdates.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]);
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...caseParams, ...ids]
    );
  }

  const finalStatus =
    errorRows === 0
      ? "imported"
      : importedRows === 0
      ? "validation_failed"
      : "imported_with_errors";

  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId]
  );

  return { importedRows, errorRows, errors };
}
