import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const VALID_TYPES = new Set(["frozen", "weekly", "daily", "rotating"]);

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: unknown;
}

interface EmployeeRow extends RowDataPacket {
  employee_code: string;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  rotationType: string;
}

export async function importShiftRotationTypeBatch(
  batchId: string,
  userId: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no ASC",
    [batchId]
  );

  if (batchRows.length === 0) {
    return { imported: 0, skipped: 0, errors: [] };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  let skipped = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const codes = new Set<string>();

  for (const batchRow of batchRows) {
    const raw = (typeof batchRow.normalized_data === "string"
      ? JSON.parse(batchRow.normalized_data)
      : batchRow.normalized_data) as Record<string, string>;

    const { employee_code, shift_rotation_type } = raw;

    if (!employee_code || !shift_rotation_type) {
      const msg = `Row ${batchRow.row_no}: missing employee_code or shift_rotation_type`;
      errors.push(msg);
      errorUpdates.push({ rowId: batchRow.id, message: msg });
      skipped++;
      continue;
    }

    if (!VALID_TYPES.has(shift_rotation_type.toLowerCase())) {
      const msg = `Row ${batchRow.row_no}: invalid shift_rotation_type '${shift_rotation_type}' — must be frozen/weekly/daily/rotating`;
      errors.push(msg);
      errorUpdates.push({ rowId: batchRow.id, message: msg });
      skipped++;
      continue;
    }

    parsed.push({
      rowId: batchRow.id, rowNo: batchRow.row_no,
      employeeCode: employee_code, rotationType: shift_rotation_type.toLowerCase(),
    });
    codes.add(employee_code);
  }

  // One bulk existence check covering every employee_code in the file,
  // instead of relying on each row's own UPDATE's affectedRows.
  const foundCodes = new Set<string>();
  if (codes.size > 0) {
    const codeList = Array.from(codes);
    const [rows] = await db.execute<EmployeeRow[]>(
      `SELECT employee_code FROM employees
       WHERE employee_code IN (${codeList.map(() => "?").join(",")}) AND employment_status = 'active'`,
      codeList
    );
    for (const r of rows) foundCodes.add(r.employee_code);
  }

  let imported = 0;
  const importedRowIds: string[] = [];
  const notFound: ParsedRow[] = [];
  const found: ParsedRow[] = [];

  for (const row of parsed) {
    if (foundCodes.has(row.employeeCode)) {
      found.push(row);
    } else {
      notFound.push(row);
    }
  }

  for (const row of notFound) {
    const msg = `Row ${row.rowNo}: employee_code '${row.employeeCode}' not found or inactive`;
    errors.push(msg);
    errorUpdates.push({ rowId: row.rowId, message: msg });
    skipped++;
  }

  // A duplicate employee_code across rows keeps the LAST row's rotation type
  // — matching the original per-row loop, where a later row's sequential
  // UPDATE always overwrote an earlier one for the same employee.
  const lastByCode = new Map<string, string>();
  for (const row of found) lastByCode.set(row.employeeCode, row.rotationType);

  const codesByType = new Map<string, string[]>();
  for (const [code, type] of lastByCode) {
    if (!codesByType.has(type)) codesByType.set(type, []);
    codesByType.get(type)!.push(code);
  }

  // One bulk UPDATE per distinct rotation type value, instead of one per row.
  //
  // The original per-row UPDATE also set `updated_by = ?`, but `employees` has
  // no such column (only `updated_at`) — every single row threw ER_BAD_FIELD_ERROR
  // on this UPDATE, uncaught, which crashed the entire import on its first valid
  // row every time this was ever run. schema-column-refs.test.ts (which scans
  // every write in the repo against the real column list) confirms `updated_by`
  // does not exist on `employees`. Fixed here rather than carried forward.
  for (const [type, codesForType] of codesByType) {
    await db.execute(
      `UPDATE employees SET shift_rotation_type = ?, updated_at = NOW()
       WHERE employee_code IN (${codesForType.map(() => "?").join(",")}) AND employment_status = 'active'`,
      [type, ...codesForType]
    );
  }

  for (const row of found) {
    importedRowIds.push(row.rowId);
    imported++;
  }

  if (importedRowIds.length > 0) {
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported'
       WHERE id IN (${importedRowIds.map(() => "?").join(",")})`,
      importedRowIds
    );
  }
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

  await db.execute(
    `UPDATE upload_batch SET batch_status=?, imported_rows=?, imported_by=?, imported_at=NOW()
     WHERE id=?`,
    [errors.length > 0 ? "imported_with_errors" : "imported", imported, userId, batchId]
  );

  return { imported, skipped, errors };
}
