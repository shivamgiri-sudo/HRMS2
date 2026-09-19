import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bellavita's Chat export -- writes into db_masmis.new_bb_chat (created by
 * backend/sql/dba/new_bb_chat_2026-09-19.sql). The older db_masmis.bb_chat is
 * left untouched: the Bellavita Chat dashboard, the Sales Upload module and
 * the separate My Dashboards tool still use it.
 *
 * The sheet has exactly 24 columns (confirmed against the real file
 * 2026-09-19): Repeat Status, Repeat Status on Assign Time, FRT, Resolution
 * Time (In Min), FRT TAT, Resolution TAT, Phone Number1, Current Agent,
 * Email, Date, ID, LOB, Week, Count 1, Time Slot, Hour, TL Name,
 * Disposition, Day Shift/Night Shift, Unique ID, Fraud, FRT (second one),
 * User Type, Repeat/Chat. One table column per sheet column, nothing else.
 *
 * - The sheet has two columns headed "FRT". The browser's sheet reader
 *   renames the second one "FRT_1", so FRT -> frt and FRT_1 -> frt_2.
 * - "Unique ID" is the row key (the sheet has no ticket id).
 * - chat_date is a real DATE, so "Date" is parsed (D-Mon-YY, D-Mon-YYYY,
 *   YYYY-MM-DD, M/D/YY or an Excel serial), never passed as text.
 * - frt, resolution_time_in_min and count_1 are real decimals; a cell that
 *   isn't a plain number is stored NULL rather than mis-read.
 * - Header matching ignores case, spaces and punctuation.
 */

export const NEW_BB_CHAT_TABLE = "db_masmis.new_bb_chat";

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** First non-blank value among the given header names (normalised match). */
function pick(normalized: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const v = normalized[normalizeKey(name)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function orNull(v: string): string | null {
  return v === "" ? null : v;
}
function parseNullableInt(v: string): number | null {
  return /^-?\d+$/.test(v) ? parseInt(v, 10) : null;
}
/** Plain numbers only -- parseFloat("0:00:04") would wrongly give 0. */
function parseNullableDecimal(v: string): number | null {
  return /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const p2 = (n: number | string) => String(n).padStart(2, "0");

/** Returns "YYYY-MM-DD", or null when the text isn't a recognisable date. */
export function parseChatDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return null;
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${mon}-${p2(m[1])}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${p2(m[1])}-${p2(m[2])}`; // M/D/Y, as the sheet reader formats US-style
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 30000 || serial > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  }
  return null;
}

/** The columns written for every row, in insert order (sheet order). */
export const NEW_BB_CHAT_COLUMNS = [
  "repeat_status", "repeat_status_on_assign_time", "frt", "resolution_time_in_min", "frt_tat", "resolution_tat",
  "phone_number1", "current_agent", "email", "chat_date", "emp_id", "lob", "week", "count_1", "time_slot",
  "hour", "tl_name", "disposition", "day_shift_night_shift", "unique_id", "fraud", "frt_2", "user_type",
  "repeat_chat",
] as const;

export type BbChatRowResult =
  | { ok: true; values: Array<string | number | null> }
  | { ok: false; error: string };

/** Maps one uploaded row to the values for NEW_BB_CHAT_COLUMNS (pure, no DB access). */
export function mapBbChatRow(data: Record<string, unknown>, rowNo: number): BbChatRowResult {
  const h: Record<string, unknown> = {};
  for (const k of Object.keys(data)) h[normalizeKey(k)] = data[k];

  const uniqueId = pick(h, "Unique ID");
  if (!uniqueId) return { ok: false, error: `Row ${rowNo}: "Unique ID" is required` };

  const dateRaw = pick(h, "Date", "Chat Date");
  let chatDate: string | null = null;
  if (dateRaw) {
    chatDate = parseChatDate(dateRaw);
    if (!chatDate) return { ok: false, error: `Row ${rowNo}: "Date" value "${dateRaw}" is not a recognised date` };
  }

  return {
    ok: true,
    values: [
      orNull(pick(h, "Repeat Status")),
      orNull(pick(h, "Repeat Status on Assign Time", "Repeat Status On Assign")),
      parseNullableDecimal(pick(h, "FRT")),
      parseNullableDecimal(pick(h, "Resolution Time (In Min)", "Resolution Time In Minutes")),
      orNull(pick(h, "FRT TAT")),
      orNull(pick(h, "Resolution TAT")),
      orNull(pick(h, "Phone Number1", "Phone Number 1")),
      orNull(pick(h, "Current Agent")),
      orNull(pick(h, "Email")),
      chatDate,
      orNull(pick(h, "ID", "Emp ID")),
      orNull(pick(h, "LOB")),
      orNull(pick(h, "Week")),
      parseNullableDecimal(pick(h, "Count 1", "Count")),
      orNull(pick(h, "Time Slot")),
      parseNullableInt(pick(h, "Hour")),
      orNull(pick(h, "TL Name")),
      orNull(pick(h, "Disposition")),
      orNull(pick(h, "Day Shift/Night Shift")),
      uniqueId,
      orNull(pick(h, "Fraud")),
      orNull(pick(h, "FRT_1", "FRT 2", "FRT2")),
      orNull(pick(h, "User Type")),
      orNull(pick(h, "Repeat/Chat")),
    ],
  };
}

async function assertTableExists(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME = 'new_bb_chat' LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error(
      "db_masmis.new_bb_chat doesn't exist yet -- ask the DBA to run backend/sql/dba/new_bb_chat_2026-09-19.sql, then upload again.",
    );
  }
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBbChatMasmisBatch(
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

  await assertTableExists();
  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const mapped = mapBbChatRow(data, row.row_no);
    if (!mapped.ok) {
      errors.push(mapped.error); errorUpdates.push({ rowId: row.id, message: mapped.error }); continue;
    }
    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [...mapped.values, uploadedByInt, batchId],
    });
  }

  const columns = [...NEW_BB_CHAT_COLUMNS, "uploaded_by", "upload_batch_id"];
  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO ${NEW_BB_CHAT_TABLE} (${columns.join(", ")})`,
    placeholderGroup: `(${columns.map(() => "?").join(", ")})`,
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'new_bb_chat', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
