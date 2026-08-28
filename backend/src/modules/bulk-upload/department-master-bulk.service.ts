import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  deptCode: string;
  deptName: string;
  description: string | null;
  activeStatus: 0 | 1;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** "1"/"true"/"yes"/"active" → 1; "0"/"false"/"no"/"inactive" → 0; blank → default. */
function parseActiveStatus(raw: unknown, defaultValue: 0 | 1 = 1): 0 | 1 {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return defaultValue;
  if (["0", "false", "no", "inactive", "n"].includes(v)) return 0;
  return 1;
}

export async function importDepartmentMasterBatch(
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

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : (row.normalized_data ?? {});

    const deptCode = String(data.dept_code ?? "").trim();
    const deptName = String(data.dept_name ?? "").trim();

    if (!deptCode || !deptName) {
      const msg = `Row ${row.row_no}: dept_code and dept_name are required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    parsed.push({
      rowId: row.id, rowNo: row.row_no, deptCode, deptName,
      description: data.description ? String(data.description).trim() : null,
      activeStatus: parseActiveStatus(data.active_status),
    });
  }

  let importedRows = 0;
  const importedRowIds: string[] = [];

  // Chunked multi-row upsert instead of one INSERT per row. If a chunk's
  // statement fails (a constraint violation on one of its rows), that chunk
  // alone is retried row-by-row so only the actually-bad row ends up marked
  // as an error — every other row in the batch still lands, matching the
  // original per-row loop's error isolation.
  for (const rowsInChunk of chunk(parsed, CHUNK_SIZE)) {
    const placeholders = rowsInChunk.map(() => "(?,?,?,?)").join(", ");
    const params = rowsInChunk.flatMap((r) => [r.deptCode, r.deptName, r.description, r.activeStatus]);

    try {
      await db.execute(
        // cost_centre was never a real column on department_master — every row of
        // every DEPARTMENT_MASTER upload failed with ER_BAD_FIELD_ERROR before this
        // fix, live-confirmed via PREPARE. active_status is a template-declared
        // optional column that the service silently ignored; it is now read and
        // applied on both insert and re-upload.
        `INSERT INTO department_master (dept_code, dept_name, description, active_status)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           dept_name = VALUES(dept_name),
           description = COALESCE(VALUES(description), description),
           active_status = VALUES(active_status)`,
        params
      );
      for (const r of rowsInChunk) {
        importedRowIds.push(r.rowId);
        importedRows++;
      }
    } catch {
      for (const r of rowsInChunk) {
        try {
          await db.execute(
            `INSERT INTO department_master (dept_code, dept_name, description, active_status)
             VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE
               dept_name = VALUES(dept_name),
               description = COALESCE(VALUES(description), description),
               active_status = VALUES(active_status)`,
            [r.deptCode, r.deptName, r.description, r.activeStatus]
          );
          importedRowIds.push(r.rowId);
          importedRows++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${r.rowNo}: ${msg}`);
          errorUpdates.push({ rowId: r.rowId, message: msg.slice(0, 500) });
          errorRows++;
        }
      }
    }
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
