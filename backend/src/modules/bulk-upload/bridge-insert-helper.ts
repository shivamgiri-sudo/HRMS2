import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Shared driver for bulk-upload importers that bridge into an existing
 * sales-upload.service.ts insertXxxRows(rows, uploadedBy) function instead of
 * writing their own duplicate INSERT logic -- keeps exactly one real writer
 * per db_masmis table, reachable from both the old sales-upload UI and
 * Process Performance V2's bulk-upload UI.
 *
 * insertXxxRows only returns an aggregate rowsInserted count (it silently
 * `continue`s past rows missing a required field), so unlike this module's
 * other importers this cannot report exactly WHICH staged rows failed --
 * only how many. That's still reported honestly via error_summary rather
 * than claiming per-row detail this shared path doesn't have.
 */

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importViaSharedInsert(
  batchId: string,
  insertRows: (rows: Record<string, unknown>[], uploadedBy: string) => Promise<{ rowsInserted: number }>,
  importedByUserId: string,
  requiredFieldLabel: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`,
      [batchId],
    );
    if (Number(staged[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW()
         WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const rows = batchRows.map((row) =>
    typeof row.normalized_data === "string"
      ? JSON.parse(row.normalized_data)
      : ((row.normalized_data ?? {}) as Record<string, unknown>),
  );

  const { rowsInserted } = await insertRows(rows, importedByUserId);
  const importedRows = rowsInserted;
  const errorRows = batchRows.length - importedRows;
  const errors: string[] = [];

  if (errorRows === 0) {
    const ids = batchRows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${slice.map(() => "?").join(",")})`,
        slice,
      );
    }
  } else {
    errors.push(`${errorRows} row(s) were skipped -- missing a required "${requiredFieldLabel}" column.`);
  }

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ?,
        error_summary = ?, updated_at = NOW()
     WHERE id = ?`,
    [finalStatus, importedRows, errorRows, errors[0] ?? null, batchId],
  );

  return { importedRows, errorRows, errors };
}
