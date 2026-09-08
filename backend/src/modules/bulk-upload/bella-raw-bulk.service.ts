/**
 * Bella Vita raw-report importer.
 *
 * Deliberately a sibling of onfido-raw-bulk.service.ts rather than a shared
 * generic: the two differ only in which pool they write to, and this codebase
 * already keeps one bulk service per domain (deduction, incentive, roster...).
 * Forking kept the proven Onfido import path untouched while Bella Vita lands.
 * Behaviour is identical - forward-filled dedup keys, occurrence-suffixed ids,
 * per-row isolation on chunk failure.
 */
import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getBellaPool } from "../../db/bellaDb.js";
import { BELLA_REPORT_CONFIGS, type BellaReportConfig } from "./bella-report-configs.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

// Bella Vita CDR and lead-allocation files run 100k+ rows/month — 500/chunk keeps round trips to
// bella_db in the low hundreds for a day's file instead of the low thousands at 200.
const CHUNK_SIZE = 500;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Bella Vita dialler and Shopify exports mix several date-ish formats in the same column
 * ("1-Jul-26", "7/1/26 14:17", "2026-07"). Returns a MySQL DATE string
 * (YYYY-MM-DD) or null — never throws, since a raw analytics export is not
 * expected to always carry a well-formed date.
 */
function parseFlexibleDate(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const dMonY = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(value);
  if (dMonY) {
    const month = MONTHS[dMonY[2].toLowerCase()];
    if (month) {
      const year = dMonY[3].length === 2 ? 2000 + Number(dMonY[3]) : Number(dMonY[3]);
      return `${year}-${String(month).padStart(2, "0")}-${dMonY[1].padStart(2, "0")}`;
    }
  }

  const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+\d{1,2}:\d{2})?/.exec(value);
  if (mdY) {
    const year = mdY[3].length === 2 ? 2000 + Number(mdY[3]) : Number(mdY[3]);
    return `${year}-${mdY[1].padStart(2, "0")}-${mdY[2].padStart(2, "0")}`;
  }

  const isoYm = /^(\d{4})-(\d{2})$/.exec(value);
  if (isoYm) return `${isoYm[1]}-${isoYm[2]}-01`;

  const isoYmd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoYmd) return `${isoYmd[1]}-${isoYmd[2]}-${isoYmd[3]}`;

  const native = new Date(value);
  if (!Number.isNaN(native.getTime())) return native.toISOString().slice(0, 10);

  return null;
}

function parseInt10(raw: unknown): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Unlike parseInt10, keeps the fraction — some shrinkage/UL columns are genuinely
 *  half-day values (e.g. "Actual UL" of -0.5), not whole counts. */
function parseFloatValue(raw: unknown): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseBoolYesNo(raw: unknown): 0 | 1 | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  return value === "yes" || value === "y" || value === "true" || value === "1" ? 1 : 0;
}

function coerce(type: "string" | "date" | "int" | "float" | "bool_yes_no", raw: unknown): unknown {
  switch (type) {
    case "date": return parseFlexibleDate(raw);
    case "int": return parseInt10(raw);
    case "float": return parseFloatValue(raw);
    case "bool_yes_no": return parseBoolYesNo(raw);
    default: {
      const s = String(raw ?? "").trim();
      return s === "" ? null : s.slice(0, 500);
    }
  }
}

export async function importBellaRawBatch(
  config: BellaReportConfig,
  batchId: string,
  _importedByUserId: string
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

  const bellaPool = await getBellaPool();
  const extractColumns = config.extract.map((e) => e.column);
  const insertColumns = ["id", ...extractColumns, "raw_data", "upload_batch_id", "source_row_no", "uploaded_by"];
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
    // BellaReportConfig.dedupHeaders. Forward-fill (the CRE/CRQ merged-cell case,
    // below) does not apply to these: every row already carries all key fields.
    const rawDedupValue = config.dedupHeaders
      ? (() => {
          const parts = config.dedupHeaders!.map((h) => String(data[h] ?? "").trim());
          return parts.every((p) => p !== "") ? parts.join("|") : "";
        })()
      : String(data[config.dedupHeader!] ?? "").trim();
    const dedupValue = rawDedupValue || lastDedupValue;
    if (!dedupValue) {
      const keyLabel = config.dedupHeaders ? config.dedupHeaders.join(" + ") : config.dedupHeader;
      const msg = `Row ${row.row_no}: "${keyLabel}" is required to dedupe this record`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }
    lastDedupValue = dedupValue;

    const extractValues = config.extract.map((e) =>
      e.column === config.dedupColumn ? coerce(e.type, dedupValue) : coerce(e.type, data[e.header])
    );
    // id derives from the natural key (plus an occurrence suffix for a forward-filled
    // group) so a re-upload of an overlapping day upserts rather than duplicates, without a
    // round trip to look up an existing row first.
    const occurrence = (occurrenceByDedupValue.get(dedupValue) ?? 0) + 1;
    occurrenceByDedupValue.set(dedupValue, occurrence);
    const id = `${config.table}:${dedupValue}${occurrence > 1 ? `:${occurrence}` : ""}`.slice(0, 191);

    prepared.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [id, ...extractValues, JSON.stringify(data), batchId, row.row_no, _importedByUserId],
    });
  }

  async function insertChunk(rowsInChunk: PreparedRow[]): Promise<void> {
    const placeholders = rowsInChunk.map(() => placeholderOne).join(", ");
    const params = rowsInChunk.flatMap((r) => r.values);
    const sql = `INSERT INTO ${config.table} (${insertColumns.join(",")})
                 VALUES ${placeholders}
                 ON DUPLICATE KEY UPDATE ${updateClause}`;

    try {
      await bellaPool.execute(sql, params as any);
      for (const r of rowsInChunk) {
        importedRowIds.push(r.rowId);
        importedRows++;
      }
    } catch {
      // Isolate the bad row(s) in this chunk instead of failing the whole chunk —
      // same pattern as process-master-bulk.service.ts.
      for (const r of rowsInChunk) {
        try {
          await bellaPool.execute(
            `INSERT INTO ${config.table} (${insertColumns.join(",")})
             VALUES ${placeholderOne}
             ON DUPLICATE KEY UPDATE ${updateClause}`,
            r.values as any
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
  // round trips to bella_db back to back. The pool (connectionLimit: 8) has the
  // headroom; 4 in flight keeps a comfortable margin for whatever else shares the pool.
  const CONCURRENCY = 4;
  const chunks = chunk(prepared, CHUNK_SIZE);
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + CONCURRENCY).map(insertChunk));
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
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";

  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId]
  );

  return { importedRows, errorRows, errors };
}

export function findBellaConfig(rpcName: string): BellaReportConfig | undefined {
  return BELLA_REPORT_CONFIGS.find((c) => c.rpcName === rpcName);
}
