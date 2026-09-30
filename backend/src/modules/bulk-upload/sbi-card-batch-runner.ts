import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { flushDalmiaRows } from "./dalmia-chunk-import.js";
import type { ChunkInsertRow } from "./masmis-chunked-insert.js";
import { canonicalizeRow } from "./dalmia-import-helpers.js";

/** Process this whole pipeline attaches rows to (process_master.process_name). */
export const SBI_CARD_PROCESS_NAME = "SBI Card Collections";

export type SbiRowResult =
  | { values: unknown[] }
  | { error: string }
  | { skip: true };

export interface SbiBatchSpec {
  table: string;
  /** Every column of the INSERT, in order; the first three of each row's values are id, process_id, ... as the mapper builds them. */
  columns: string[];
  /** Columns refreshed on a re-upload of the same natural key. */
  updateColumns: string[];
  headers: readonly string[];
  /** Turns one canonicalised row into the INSERT values (after the id and process_id), or an error / skip. */
  mapRow: (data: Record<string, unknown>, rowNo: number, ctx: { processId: string; batchId: string; userId: string }) => SbiRowResult;
  /** Runs after the rows are written (e.g. KPI daily rollups); a failure here must not fail the import. */
  afterImport?: (processId: string, importedDates: string[]) => Promise<void>;
  /** Extracts the report date (YYYY-MM-DD) from a written row's values, for afterImport. */
  dateOf?: (values: unknown[]) => string | null;
}

interface BatchRow extends RowDataPacket { id: string; row_no: number; normalized_data: string | Record<string, unknown> }
interface Ref extends RowDataPacket { id: string }

export const upsertSuffix = (cols: string[]): string =>
  `ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(", ")}`;

/** Shared loop of the five SBI Card importers: read staged rows, map each, flush as chunked upserts, close the batch. */
export async function runSbiBatch(
  batchId: string,
  userId: string,
  spec: SbiBatchSpec,
  newId: () => string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`, [batchId]);
    if (Number((staged as RowDataPacket[])[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW() WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const [procRows] = await db.execute<Ref[]>(
    `SELECT id FROM process_master WHERE process_name = ? AND active_status = 1 LIMIT 1`,
    [SBI_CARD_PROCESS_NAME],
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const skipped: string[] = [];
  const insertRows: ChunkInsertRow[] = [];
  const dates = new Set<string>();

  for (const row of batchRows) {
    if (!processId) {
      const msg = `Row ${row.row_no}: no active "${SBI_CARD_PROCESS_NAME}" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    const data = canonicalizeRow(
      typeof row.normalized_data === "string" ? JSON.parse(row.normalized_data) : ((row.normalized_data ?? {}) as Record<string, unknown>),
      spec.headers,
    );
    const res = spec.mapRow(data, row.row_no, { processId, batchId, userId });
    if ("error" in res) {
      const msg = `Row ${row.row_no}: ${res.error}`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    if ("skip" in res) { skipped.push(row.id); continue; }
    const d = spec.dateOf?.(res.values);
    if (d) dates.add(d);
    insertRows.push({ rowId: row.id, rowNo: row.row_no, values: [newId(), processId, ...res.values] });
  }

  for (let i = 0; i < skipped.length; i += 500) {
    const part = skipped.slice(i, i + 500);
    await db.execute(`UPDATE upload_batch_row SET row_status = 'skipped' WHERE id IN (${part.map(() => "?").join(",")})`, part);
  }

  const result = await flushDalmiaRows({
    batchId, table: spec.table, columns: spec.columns, suffix: upsertSuffix(spec.updateColumns),
    rows: insertRows, errorUpdates, errors,
  });

  if (spec.afterImport && processId && result.importedRows > 0 && dates.size > 0) {
    try { await spec.afterImport(processId, [...dates]); } catch (e) {
      result.errors.push(`Imported, but the KPI daily rollup failed: ${(e as Error).message}`);
    }
  }
  return result;
}
