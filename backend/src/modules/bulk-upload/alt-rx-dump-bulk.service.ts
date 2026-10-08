import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";
import { toDate } from "../process-performance/alt-rx/alt-rx.engine.js";

/**
 * ALT RX Ticket Dump -- writes into db_masmis.altdump (sql/2117). One Dump is the whole dataset,
 * so a successful import replaces the previous Dump: the new rows go in first, then every older
 * batch's rows are removed. If the new file imports nothing, nothing is removed.
 */

type Kind = "text" | "datetime";
/** Dump header -> [column, kind]. Headers match EXPECTED_COLUMNS in alt-rx.engine.ts. */
export const COLUMN_MAP: Array<[string, string, Kind]> = [
  ["Ticket ID", "ticket_id", "text"], ["Subject", "subject", "text"], ["Status", "status", "text"],
  ["Priority", "priority", "text"], ["Source", "source", "text"], ["Type", "ticket_type", "text"],
  ["Agent", "agent", "text"], ["Group", "group_name", "text"], ["Created time", "created_time", "datetime"],
  ["Due by Time", "due_by_time", "datetime"], ["Resolved time", "resolved_time", "datetime"],
  ["Closed time", "closed_time", "datetime"], ["Last update time", "last_update_time", "datetime"],
  ["Initial response time", "initial_response_time", "datetime"], ["Time tracked", "time_tracked", "text"],
  ["First response time (in hrs)", "first_response_hrs", "text"], ["Resolution time (in hrs)", "resolution_hrs", "text"],
  ["Agent interactions", "agent_interactions", "text"], ["Customer interactions", "customer_interactions", "text"],
  ["Resolution status", "resolution_status", "text"], ["First response status", "first_response_status", "text"],
  ["Tags", "tags", "text"], ["Survey results", "survey_results", "text"], ["Product", "product", "text"],
  ["Every response status", "every_response_status", "text"], ["Reference Number", "reference_number", "text"],
  ["Summary", "summary", "text"], ["Product Series", "product_series", "text"], ["Source Info", "source_info", "text"],
  ["Assigned Ticket Time", "assigned_ticket_time", "datetime"], ["Full name", "full_name", "text"],
  ["Contact ID", "contact_id", "text"],
];
const KNOWN_HEADERS = new Set(COLUMN_MAP.map(([h]) => h));

const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

function field(data: Record<string, unknown>, header: string): unknown {
  const want = normalizeKey(header);
  for (const k of Object.keys(data)) if (normalizeKey(k) === want) return data[k];
  return undefined;
}

function text(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
}

/** "YYYY-MM-DD HH:mm:ss" from the uploaded value, or null when it is not a date. */
function dateTime(v: unknown): string | null {
  const d = toDate(v);
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export const ALT_RX_DUMP_COLUMNS = [...COLUMN_MAP.map(([, c]) => c), "extra_json", "upload_batch_id", "row_no"];

export async function importAltRxDumpBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[]; replacedRows: number }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [], replacedRows: 0 };

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data = typeof row.normalized_data === "string"
      ? (JSON.parse(row.normalized_data) as Record<string, unknown>)
      : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!text(field(data, "Ticket ID"), 40)) {
      const msg = `Row ${row.row_no}: "Ticket ID" is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      continue;
    }

    const values: unknown[] = COLUMN_MAP.map(([header, , kind]) => {
      const raw = field(data, header);
      return kind === "datetime" ? dateTime(raw) : text(raw, 4000);
    });
    // Columns the uploader does not know are kept, so nothing from the file is lost.
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(data)) if (!KNOWN_HEADERS.has(k)) extra[k] = data[k];
    values.push(Object.keys(extra).length ? JSON.stringify(extra) : null, batchId, row.row_no);

    insertRows.push({ rowId: row.id, rowNo: row.row_no, values });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.altdump (${ALT_RX_DUMP_COLUMNS.join(", ")})`,
    placeholderGroup: `(${ALT_RX_DUMP_COLUMNS.map(() => "?").join(", ")})`,
    rows: insertRows,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  // Replace: only once the new Dump has landed, remove the rows of every older Dump.
  let replacedRows = 0;
  if (importedRows > 0) {
    const [del] = await db.executeRun(`DELETE FROM db_masmis.altdump WHERE upload_batch_id <> ?`, [batchId]);
    replacedRows = (del as unknown as { affectedRows: number }).affectedRows ?? 0;
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'altdump', ?, ?, NULL)
       ON DUPLICATE KEY UPDATE row_count = VALUES(row_count), file_name = VALUES(file_name)`,
      [batchId, `HRMS2 upload by ${importedByUserId} (replaced ${replacedRows} older rows)`, importedRows],
    );
  }

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  const finalStatus = errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors, replacedRows };
}
