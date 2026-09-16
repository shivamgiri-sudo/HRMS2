import { db } from "../../db/mysql.js";
import { withDeadlockRetry } from "../../shared/deadlockRetry.js";

export interface ChunkInsertRow {
  rowId: string;
  rowNo: number;
  values: unknown[];
}

/**
 * Shared by the 4 Bellavita db_masmis importers (bb-sale/apr/chat/cart), which each
 * used to INSERT one row at a time in a plain for-loop — 23,391 rows meant 23,391
 * sequential round trips to a DB that is not always on the LAN (per .env's own
 * DB_HOST latency notes, sometimes 300-750ms/query off-LAN), which is what made a
 * real Sale-file upload take unacceptably long.
 *
 * Inserts in chunks of one multi-row INSERT each — the common case (every row
 * valid) becomes a handful of round trips instead of one per row. A chunk that
 * fails falls back to inserting that chunk's rows one at a time, ONLY for that
 * chunk, so a genuinely bad row is still identified and reported individually,
 * exactly as the original per-row loop did — this is purely a fast path, not a
 * change in error-reporting granularity.
 *
 * withDeadlockRetry is safe here for the same reason the existing /batches/:id/rows
 * staging endpoint already relies on it: each chunk is one autocommit statement, and
 * a lost deadlock/lock-wait-timeout means MySQL rolled the whole statement back (zero
 * rows from it committed), so retrying replays the identical INSERT rather than
 * double-inserting.
 */
export async function chunkedMasmisInsert(params: {
  insertPrefix: string;
  placeholderGroup: string;
  rows: ChunkInsertRow[];
  chunkSize?: number;
}): Promise<{ importedRows: number; errorUpdates: Array<{ rowId: string; message: string }> }> {
  const { insertPrefix, placeholderGroup, rows, chunkSize = 300 } = params;
  let importedRows = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    try {
      await withDeadlockRetry(() =>
        db.execute(
          `${insertPrefix} VALUES ${chunk.map(() => placeholderGroup).join(", ")}`,
          chunk.flatMap((r) => r.values) as never[],
        ),
      );
      importedRows += chunk.length;
    } catch {
      for (const row of chunk) {
        try {
          await withDeadlockRetry(() =>
            db.execute(`${insertPrefix} VALUES ${placeholderGroup}`, row.values as never[]),
          );
          importedRows++;
        } catch (err: unknown) {
          const rawMsg = err instanceof Error ? err.message : String(err);
          const msg = `Row ${row.rowNo}: ${rawMsg}`;
          errorUpdates.push({ rowId: row.rowId, message: msg.slice(0, 500) });
        }
      }
    }
  }

  return { importedRows, errorUpdates };
}
