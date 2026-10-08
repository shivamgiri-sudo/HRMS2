import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import {
  ONFIDO_REPORT_CONFIGS,
  type OnfidoReportConfig,
} from "./onfido-report-configs.js";
import { makeRowReader } from "./onfido-header-match.js";
import { coerce } from "./onfido-coerce.js";
import { ensureOnfidoTableColumns } from "./onfido-schema-sync.js";
import { clearOnfidoResponseCache } from "../onfido-process/onfido-response-cache.js";
import { runNameMappingSeed } from "../onfido-process/onfido-name-mapping.service.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

// Onfido process reports run ~1 lakh rows/day/file — 500/chunk keeps round trips to
// onfido_db in the low hundreds for a day's file instead of the low thousands at 200.
const CHUNK_SIZE = 500;
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * Only these two tables feed getDistinctOnfidoNames() (see
 * onfido-name-mapping.service.ts and onfido-process-dashboard.service.ts's own
 * getFilterOptions(), which the seed's query reuses). A raw upload into any
 * other Onfido table (POA raw, quality audits, escalations, etc.) cannot
 * introduce a new distinct TL/AM name, so re-running the seed after one would
 * only slow that upload down for no benefit.
 */
const NAME_MAPPING_SOURCE_TABLES = new Set([
  "onfido_doc_external_audit_raw",
  "onfido_agent_daily_raw",
]);

export function shouldTriggerNameMappingReseed(table: string): boolean {
  return NAME_MAPPING_SOURCE_TABLES.has(table);
}

/**
 * Fires the name-mapping seed after an upload into one of the two name-bearing
 * source tables, so a newly-appearing TL/AM name gets a mapping row without
 * waiting for someone to remember to run scripts/seed-onfido-name-mapping.ts
 * by hand. A failure here is logged, never thrown -- the raw upload itself
 * already succeeded and completed; the seed run is a best-effort follow-up,
 * not part of the upload's own contract.
 */
export async function triggerNameMappingReseedIfRelevant(table: string): Promise<void> {
  if (!shouldTriggerNameMappingReseed(table)) return;

  try {
    const result = await runNameMappingSeed();
    if (result.errors.length) {
      console.error(
        `[onfido-raw-bulk] name-mapping re-seed after ${table} upload: ${result.errors.length} error(s)`,
        result.errors,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[onfido-raw-bulk] name-mapping re-seed after ${table} upload failed:`, message);
  }
}

/** Imports one staged batch, then drops the dashboard's cached responses so new rows show at once. */
export async function importOnfidoRawBatch(
  config: OnfidoReportConfig,
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  try {
    return await importOnfidoRawBatchRows(config, batchId, importedByUserId);
  } finally {
    clearOnfidoResponseCache();
    void triggerNameMappingReseedIfRelevant(config.table);
  }
}

async function importOnfidoRawBatchRows(
  config: OnfidoReportConfig,
  batchId: string,
  _importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );

  if (batchRows.length === 0) {
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const onfidoPool = await getOnfidoPool();
  await ensureOnfidoTableColumns(config.table);
  const extractColumns = config.extract.map((e) => e.column);
  const insertColumns = [
    "id",
    ...extractColumns,
    "raw_data",
    "upload_batch_id",
    "source_row_no",
    "uploaded_by",
  ];
  const placeholderOne = `(${insertColumns.map(() => "?").join(",")})`;
  const updateClause = extractColumns
    .map((c) => `${c} = COALESCE(VALUES(${c}), ${c})`)
    .concat(["raw_data = VALUES(raw_data)"])
    .join(", ");

  const errors: string[] = [];
  let errorRows = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const importedRowIds: string[] = [];
  let importedRows = 0;

  type PreparedRow = { rowId: string; rowNo: number; values: unknown[] };
  const prepared: PreparedRow[] = [];

  // CRE/CRQ (and likely other multi-error-per-report exports) come out of Excel with the
  // dedup column merged-cell-style: it is only populated on the FIRST of several error rows
  // belonging to the same report, and blank on the rest. Confirmed live on the CRE Dashboard
  // export: treating a blank dedup column as invalid dropped 219 of 730 rows (30%) as errors
  // when every one of them was a real, distinct error line for the report named a few rows
  // above it. Forward-filling from the last non-blank value (rows arrive in row_no order)
  // recovers the grouping Excel display, while an occurrence suffix on the row `id` keeps
  // each error line its own row instead of the group's later rows overwriting the first via
  // ON DUPLICATE KEY UPDATE.
  const occurrenceByDedupValue = new Map<string, number>();
  let lastDedupValue = "";

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : (row.normalized_data ?? {});

    // Composite-key sources (a monthly HR fact table, not a per-task export with an
    // IMS URL) join several header values instead of reading one dedupHeader — see
    // OnfidoReportConfig.dedupHeaders. Forward-fill (the CRE/CRQ merged-cell case,
    // below) does not apply to these: every row already carries all key fields.
    const read = makeRowReader(data);
    const rawDedupValue = config.dedupHeaders
      ? (() => {
          const parts = config.dedupHeaders!.map((h) =>
            String(read(h) ?? "").trim(),
          );
          return parts.every((p) => p !== "") ? parts.join("|") : "";
        })()
      : String(read(config.dedupHeader!) ?? "").trim();
    const dedupValue = rawDedupValue || lastDedupValue;
    if (!dedupValue) {
      const keyLabel = config.dedupHeaders
        ? config.dedupHeaders.join(" + ")
        : config.dedupHeader;
      const msg = `Row ${row.row_no}: "${keyLabel}" is required to dedupe this record`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }
    lastDedupValue = dedupValue;

    const extractValues = config.extract.map((e) =>
      e.column === config.dedupColumn
        ? coerce(e.type, dedupValue)
        : coerce(e.type, read(e.header, e.aliases)),
    );
    // id derives from the natural key (plus an occurrence suffix for a forward-filled
    // group) so a re-upload of an overlapping day upserts rather than duplicates, without a
    // round trip to look up an existing row first.
    const occurrence = (occurrenceByDedupValue.get(dedupValue) ?? 0) + 1;
    occurrenceByDedupValue.set(dedupValue, occurrence);
    const id =
      `${config.table}:${dedupValue}${occurrence > 1 ? `:${occurrence}` : ""}`.slice(
        0,
        191,
      );

    prepared.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        id,
        ...extractValues,
        JSON.stringify(data),
        batchId,
        row.row_no,
        _importedByUserId,
      ],
    });
  }

  async function insertChunk(rowsInChunk: PreparedRow[]): Promise<void> {
    const placeholders = rowsInChunk.map(() => placeholderOne).join(", ");
    const params = rowsInChunk.flatMap((r) => r.values);
    const sql = `INSERT INTO ${config.table} (${insertColumns.join(",")})
                 VALUES ${placeholders}
                 ON DUPLICATE KEY UPDATE ${updateClause}`;

    try {
      await onfidoPool.execute(sql, params as any);
      for (const r of rowsInChunk) {
        importedRowIds.push(r.rowId);
        importedRows++;
      }
    } catch {
      // Isolate the bad row(s) in this chunk instead of failing the whole chunk —
      // same pattern as process-master-bulk.service.ts.
      for (const r of rowsInChunk) {
        try {
          await onfidoPool.execute(
            `INSERT INTO ${config.table} (${insertColumns.join(",")})
             VALUES ${placeholderOne}
             ON DUPLICATE KEY UPDATE ${updateClause}`,
            r.values as any,
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

  // Chunks run with bounded concurrency rather than strictly one after another — at
  // ~1 lakh rows/day/file, a fully sequential loop of 500-row chunks means hundreds of
  // round trips to onfido_db back to back. The pool (connectionLimit: 8) has the
  // headroom; 4 in flight keeps a comfortable margin for whatever else shares the pool.
  const CONCURRENCY = 4;
  const chunks = chunk(prepared, CHUNK_SIZE);
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + CONCURRENCY).map(insertChunk));
  }

  // 20k-row files produce 20k IDs — a single WHERE id IN (?) with 20k placeholders
  // is slow and can stall the connection. Chunked at 500 to keep each statement fast.
  const ROW_UPDATE_CHUNK = 500;
  for (let i = 0; i < importedRowIds.length; i += ROW_UPDATE_CHUNK) {
    const slice = importedRowIds.slice(i, i + ROW_UPDATE_CHUNK);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported'
       WHERE id IN (${slice.map(() => "?").join(",")})`,
      slice,
    );
  }
  if (errorUpdates.length > 0) {
    for (let i = 0; i < errorUpdates.length; i += ROW_UPDATE_CHUNK) {
      const slice = errorUpdates.slice(i, i + ROW_UPDATE_CHUNK);
      const cases = slice.map(() => "WHEN ? THEN ?").join(" ");
      const caseParams = slice.flatMap((u) => [
        u.rowId,
        JSON.stringify([u.message]),
      ]);
      const ids = slice.map((u) => u.rowId);
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
         WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...caseParams, ...ids],
      );
    }
  }

  const finalStatus =
    errorRows === 0
      ? "imported"
      : importedRows === 0
        ? "validation_failed"
        : "imported_with_errors";

  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}

export function findOnfidoConfig(
  rpcName: string,
): OnfidoReportConfig | undefined {
  return ONFIDO_REPORT_CONFIGS.find((c) => c.rpcName === rpcName);
}
