import { db } from "../../db/mysql.js";
import { withDeadlockRetry } from "../../shared/deadlockRetry.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";

export interface ChunkInsertRow {
  rowId: string;
  rowNo: number;
  values: unknown[];
}

/**
 * Shared by the Bellavita/Owner/Premium/LP db_masmis importers (bb-sale/apr/
 * chat/cart, owner-sale, pre-sale, ...), which each used to INSERT one row
 * at a time in a plain for-loop — 23,391 rows meant 23,391 sequential round
 * trips to a DB that is not always on the LAN (per .env's own DB_HOST
 * latency notes, sometimes 300-750ms/query off-LAN), which is what made a
 * real Sale-file upload take unacceptably long.
 *
 * Inserts in chunks of one multi-row INSERT each — the common case (every row
 * valid) becomes a handful of round trips instead of one per row. A chunk that
 * fails falls back to inserting that chunk's rows one at a time, ONLY for that
 * chunk, so a genuinely bad row is still identified and reported individually,
 * exactly as the original per-row loop did — this is purely a fast path, not a
 * change in error-reporting granularity.
 *
 * Chunks run with up to BULK_ROW_CONCURRENCY in flight at once (same bounded
 * helper the attendance/leave import engines already use), not strictly one
 * after another -- confirmed live 2026-09-18: a 13,433-row Chat upload sat
 * at 'importing' for 40+ minutes running chunks sequentially against a
 * heavily-loaded shared DB, with upload_batch.imported_rows stuck at 0 the
 * whole time because nothing marked individual rows done until the very
 * end. Concurrency shortens the wall-clock wait; the row-status marking
 * below is what actually fixes the "looks stuck forever with no feedback"
 * complaint, by making real progress visible via readBatchProgress()
 * (batch-job.ts) as it happens, not just at completion.
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
  /** Appended after the VALUES clause, e.g. "ON DUPLICATE KEY UPDATE target = VALUES(target)"
   * for the one importer in this family (neemans_month_targets) whose target column has a
   * real UNIQUE key and must upsert rather than append-only insert. Omit for plain inserts. */
  insertSuffix?: string;
}): Promise<{ importedRows: number; errorUpdates: Array<{ rowId: string; message: string }>; importedRowIds: string[] }> {
  const { insertPrefix, placeholderGroup, rows, chunkSize = 300, insertSuffix = "" } = params;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const importedRowIds: string[] = [];
  const suffix = insertSuffix ? ` ${insertSuffix}` : "";

  const chunks: ChunkInsertRow[][] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    chunks.push(rows.slice(offset, offset + chunkSize));
  }

  // errorUpdates/importedRowIds are plain array pushes from inside each
  // concurrent task, which is safe: JS never preempts one task's
  // synchronous push with another's.
  await mapWithConcurrency(chunks, BULK_ROW_CONCURRENCY, async (chunk) => {
    try {
      await withDeadlockRetry(() =>
        db.execute(
          `${insertPrefix} VALUES ${chunk.map(() => placeholderGroup).join(", ")}${suffix}`,
          chunk.flatMap((r) => r.values) as never[],
        ),
      );
      for (const row of chunk) importedRowIds.push(row.rowId);
    } catch {
      for (const row of chunk) {
        try {
          await withDeadlockRetry(() =>
            db.execute(`${insertPrefix} VALUES ${placeholderGroup}${suffix}`, row.values as never[]),
          );
          importedRowIds.push(row.rowId);
        } catch (err: unknown) {
          const rawMsg = err instanceof Error ? err.message : String(err);
          const msg = `Row ${row.rowNo}: ${rawMsg}`;
          errorUpdates.push({ rowId: row.rowId, message: msg.slice(0, 500) });
        }
      }
    }
  });

  /**
   * Marks every successfully-inserted row 'imported' in upload_batch_row —
   * without this, readBatchProgress() can never show real progress (it
   * counts rows that left 'valid'/'pending'), and a re-triggered import
   * after a crash would re-select and re-insert every already-imported row
   * as a duplicate, since callers' own SELECT filters on row_status IN
   * ('valid','pending'). Chunked into groups of 1000 ids to keep each
   * UPDATE's IN-clause a reasonable size for a large file.
   */
  const MARK_IMPORTED_CHUNK = 1000;
  for (let offset = 0; offset < importedRowIds.length; offset += MARK_IMPORTED_CHUNK) {
    const idChunk = importedRowIds.slice(offset, offset + MARK_IMPORTED_CHUNK);
    await withDeadlockRetry(() =>
      db.execute(
        `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${idChunk.map(() => "?").join(",")})`,
        idChunk,
      ),
    );
  }

  return { importedRows: importedRowIds.length, errorUpdates, importedRowIds };
}
