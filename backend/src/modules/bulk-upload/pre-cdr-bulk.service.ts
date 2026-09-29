import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Housing Premium's "Premium CDR" export -- writes into db_masmis.Pre_cdr
 * (sql/1766). Genuinely per-call (unlike its Owner sibling, which turned
 * out to be an APR-style aggregate -- see owner-cdr-bulk.service.ts), but
 * with real columns confirmed against the file the user supplied
 * (C:\Users\MAS60358\Desktop\Housing Premium\Premium_CDR.xlsx): CALLER,
 * MEMBER, End Time, DURATION, STATUS, Routing Numbers, Routing Status,
 * Talk Duration, Ringing Duration, Start Time, Time, Date, TL Name, Count,
 * Unique Count, Date row Count, V+W, Talk Time, TL. No call_id column
 * exists in the real file -- CALLER (the phone number) is the row's own
 * identity, confirmed by the sample data. Deliberately separate from the
 * existing CR_housing_premium (1,549 real rows, a different
 * routing/leg-specific shape), per explicit user confirmation.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function n(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
/** report_date_iso (migration 448): a real indexed DATE column, backfilled from the existing
 * text report_date so date-range dashboard queries (housing-premium-dashboard.service.ts) stop
 * doing a full-table scan on every call. Derived here from the same raw "Date" value that
 * becomes the text report_date column, handling every shape this staging pipeline can produce
 * depending on how the source cell was typed -- Excel serial, ISO, M/D/Y(Y), D-Mon-YY -- same
 * formats owner-sale-bulk.service.ts's own parseDate() already handles for this reason. Never
 * guessed beyond what's actually parseable: an unrecognised shape becomes NULL, same as before
 * this column existed. */
function parseDateIso(raw: string): string | null {
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(raw)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw);
  if (m) return `20${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(raw);
  if (m) {
    const mon = MONTH_ABBR[m[2].toLowerCase()];
    if (mon) {
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${year}-${mon}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

/** Keeps db_masmis.pre_cdr_daily_summary (migration 449, the Housing Premium Overview
 * tab's precomputed day x TL rollup) in sync after an insert -- recomputes the summary
 * rows for exactly the dates this batch touched, from Pre_cdr's current state. Cheap:
 * only re-aggregates these few dates, not the whole table. Self-correcting even for a
 * re-import of an already-covered date -- always overwrites from the real current data,
 * never adds. Mirrors upload_housing_premium_cdr.py's refresh_daily_summary() -- keep
 * both in sync if this logic ever changes.
 *
 * Migration 449 has not been run against production yet (the Overview tab was reverted
 * to read raw Pre_cdr directly until it is), so this table may not exist -- the caller
 * wraps this in try/catch for exactly that reason. Never let this fail a real import
 * that already succeeded: it's a courtesy sync, not part of the insert's own correctness. */
async function refreshDailySummary(isoDates: Set<string>): Promise<void> {
  if (isoDates.size === 0) return;
  const dates = [...isoDates];
  const placeholders = dates.map(() => "?").join(", ");
  await db.execute(
    `INSERT INTO db_masmis.pre_cdr_daily_summary
        (report_date_iso, tl_name, connected, not_connected, unique_connected, present_count, talk_seconds, row_count)
     SELECT report_date_iso, COALESCE(NULLIF(tl_name, ''), ''),
            SUM(status = 'Answered'), SUM(status = 'No Answered'),
            SUM(status = 'Answered' AND unique_count = '1'), SUM(call_count = '1'),
            SUM(talk_duration + 0), COUNT(*)
       FROM db_masmis.Pre_cdr
      WHERE report_date_iso IN (${placeholders})
      GROUP BY report_date_iso, tl_name
      ON DUPLICATE KEY UPDATE
        connected = VALUES(connected), not_connected = VALUES(not_connected),
        unique_connected = VALUES(unique_connected), present_count = VALUES(present_count),
        talk_seconds = VALUES(talk_seconds), row_count = VALUES(row_count)`,
    dates,
  );
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importPreCdrBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];
  const isoDatesSeen = new Set<string>();

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const caller = getByColumn(data, "CALLER");
    if (!caller) {
      const msg = `Row ${row.row_no}: "CALLER" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const rawDate = n(data, "Date");
    const isoDate = parseDateIso(rawDate ?? "");
    if (isoDate) isoDatesSeen.add(isoDate);

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        caller, n(data, "MEMBER"), n(data, "End Time"), n(data, "DURATION"), n(data, "STATUS"),
        n(data, "Routing Numbers"), n(data, "Routing Status"), n(data, "Talk Duration"),
        n(data, "Ringing Duration"), n(data, "Start Time"), n(data, "Time"), rawDate,
        parseDateIso(rawDate ?? ""),
        n(data, "TL Name"), n(data, "Count"), n(data, "Unique Count"), n(data, "Date row Count"),
        n(data, "V+W"), n(data, "Talk Time"), n(data, "TL"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.Pre_cdr
       (caller, member, end_time, duration, status, routing_numbers, routing_status,
        talk_duration, ringing_duration, start_time, time_value, report_date, report_date_iso, tl_name,
        call_count, unique_count, date_row_count, v_plus_w, talk_time, tl,
        uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'Pre_cdr', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
    );
    try {
      await refreshDailySummary(isoDatesSeen);
    } catch (err) {
      // ER_NO_SUCH_TABLE = migration 449 hasn't run yet. The real import above already
      // succeeded and committed; never let this courtesy step turn that into a failed request.
      if ((err as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw err;
    }
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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
