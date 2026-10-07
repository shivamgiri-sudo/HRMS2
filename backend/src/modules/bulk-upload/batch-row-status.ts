import { db } from "../../db/mysql.js";

/**
 * Rows per UPDATE when flagging staged rows. One statement with a 26,924-id IN list held row locks
 * on upload_batch_row for hours (BATCH-1790414059915, 2026-09-26) and starved every other upload
 * behind it with "Lock wait timeout exceeded". A thousand ids per statement finishes in
 * milliseconds and holds its locks only that long.
 */
export const ROW_STATUS_CHUNK_SIZE = 1000;

/** Flags staged rows as imported, one short statement per chunk. */
export async function markRowsImported(
  rowIds: readonly string[],
): Promise<void> {
  for (let i = 0; i < rowIds.length; i += ROW_STATUS_CHUNK_SIZE) {
    const chunk = rowIds.slice(i, i + ROW_STATUS_CHUNK_SIZE);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${chunk.map(() => "?").join(",")})`,
      chunk as string[],
    );
  }
}

/** Rows removed per DELETE. upload_batch_row carries two JSON columns per row and an FK to upload_batch. */
export const ROW_DELETE_CHUNK_SIZE = 1000;
const ROW_DELETE_PAUSE_MS = 25;

/**
 * Deletes a batch's staged rows in short statements instead of one giant one.
 *
 * A single `DELETE ... WHERE upload_batch_id = ?` over a batch of hundreds of thousands of JSON
 * rows ran for minutes and held every row lock until it finished. `ORDER BY row_no` follows the
 * (upload_batch_id, row_no) unique index, so each chunk is an index-ordered range with no sort.
 * Deletes exactly the same rows as the one-shot statement (optionally narrowed to `statuses`).
 * Returns the number of rows removed.
 */
export async function deleteBatchRowsChunked(
  batchId: string,
  statuses?: readonly string[],
): Promise<number> {
  const statusSql =
    statuses && statuses.length
      ? ` AND row_status IN (${statuses.map(() => "?").join(",")})`
      : "";
  let total = 0;
  for (;;) {
    const [result] = await db.query(
      `DELETE FROM upload_batch_row WHERE upload_batch_id = ?${statusSql} ORDER BY row_no LIMIT ${ROW_DELETE_CHUNK_SIZE}`,
      [batchId, ...(statuses ?? [])],
    );
    const affected = Number(
      (result as { affectedRows?: number } | undefined)?.affectedRows ?? 0,
    );
    total += affected;
    if (affected < ROW_DELETE_CHUNK_SIZE) return total;
    await new Promise((r) => setTimeout(r, ROW_DELETE_PAUSE_MS));
  }
}
