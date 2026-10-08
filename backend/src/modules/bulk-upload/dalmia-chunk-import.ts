import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Shared write path of the four Dalmia importers (dalmia_daildesk / Outbound / dalmia_apr / after_hour).
 *
 * They used to INSERT one row per round trip and never marked a row 'imported', so a few thousand rows took minutes
 * against the shared DB and the upload page showed "0 of N" the whole time. This sends multi-row upserts in chunks (same
 * helper the Bellavita importers use), marks rows 'imported' as it goes so progress is real, records the rows that failed,
 * and closes the batch. The upsert semantics (ON DUPLICATE KEY UPDATE ...) are unchanged -- callers pass the same suffix.
 */
export async function flushDalmiaRows(params: {
  batchId: string;
  table: string;
  columns: string[];
  suffix: string;
  rows: ChunkInsertRow[];
  errorUpdates: Array<{ rowId: string; message: string }>;
  errors: string[];
}): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const { batchId, table, columns, suffix, rows, errorUpdates, errors } = params;

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO ${table} (${columns.join(", ")})`,
    placeholderGroup: `(${columns.map(() => "?").join(", ")})`,
    rows,
    insertSuffix: suffix,
    chunkSize: 500,
  });
  for (const u of inserted.errorUpdates) { errorUpdates.push(u); errors.push(u.message); }

  if (errorUpdates.length) {
    const CHUNK = 500;
    for (let i = 0; i < errorUpdates.length; i += CHUNK) {
      const part = errorUpdates.slice(i, i + CHUNK);
      const cases = part.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
      const ids = part.map((u) => u.rowId);
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
          WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...part.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
      );
    }
  }

  // Mark the rows that went in as 'imported' (the same step every other bulk importer performs after its insert), so the upload
  // page's progress and the per-row statuses are real rather than left on 'pending'.
  const failedRowIds = new Set(errorUpdates.map((u) => u.rowId));
  const successRowIds = rows.filter((r) => !failedRowIds.has(r.rowId)).map((r) => r.rowId);
  for (let i = 0; i < successRowIds.length; i += 500) {
    const part = successRowIds.slice(i, i + 500);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${part.map(() => "?").join(",")})`,
      part,
    );
  }

  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;
  const finalStatus = errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
