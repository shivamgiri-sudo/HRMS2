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
  lobCode: string;
  lobName: string;
  description: string | null;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function importLobMasterBatch(
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

    const lobCode = String(data.lob_code ?? "").trim();
    const lobName = String(data.lob_name ?? "").trim();

    if (!lobCode || !lobName) {
      const msg = `Row ${row.row_no}: lob_code and lob_name are required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    parsed.push({
      rowId: row.id, rowNo: row.row_no, lobCode, lobName,
      description: data.description ? String(data.description).trim() : null,
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
    const placeholders = rowsInChunk.map(() => "(?,?,?,1)").join(", ");
    const params = rowsInChunk.flatMap((r) => [r.lobCode, r.lobName, r.description]);

    try {
      await db.execute(
        `INSERT INTO lob_master (lob_code, lob_name, description, active_status)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           lob_name = VALUES(lob_name),
           description = COALESCE(VALUES(description), description)`,
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
            `INSERT INTO lob_master (lob_code, lob_name, description, active_status)
             VALUES (?,?,?,1)
             ON DUPLICATE KEY UPDATE
               lob_name = VALUES(lob_name),
               description = COALESCE(VALUES(description), description)`,
            [r.lobCode, r.lobName, r.description]
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
