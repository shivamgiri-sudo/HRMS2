import { db } from "../../db/mysql.js";

/**
 * Rows per UPDATE when flagging staged rows. One statement with a 26,924-id IN list held row locks
 * on upload_batch_row for hours (BATCH-1790414059915, 2026-09-26) and starved every other upload
 * behind it with "Lock wait timeout exceeded". A thousand ids per statement finishes in
 * milliseconds and holds its locks only that long.
 */
export const ROW_STATUS_CHUNK_SIZE = 1000;

/** Flags staged rows as imported, one short statement per chunk. */
export async function markRowsImported(rowIds: readonly string[]): Promise<void> {
  for (let i = 0; i < rowIds.length; i += ROW_STATUS_CHUNK_SIZE) {
    const chunk = rowIds.slice(i, i + ROW_STATUS_CHUNK_SIZE);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${chunk.map(() => "?").join(",")})`,
      chunk as string[],
    );
  }
}
