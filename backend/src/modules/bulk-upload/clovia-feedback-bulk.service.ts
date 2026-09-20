import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Clovia's own "Feedback" sheet -- found while auditing every sheet of the
 * same workbook family already used this session for Chat Performance/CRM
 * Disposition/Team Alignment/APR Utilization/IB+Outbound CDR Raw, not named
 * in Clovia Steps.docx's own SOP text, but real data with no DB backing
 * anywhere: a per-call post-call IVR CSAT/DSAT survey response.
 */

export const CLOVIA_FEEDBACK_HEADERS = [
  "Unique", "Call Date", "Date", "Advisor Id", "Phone Number", "Language", "Option", "C-SAT/D-SAT",
] as const;

export function parseNullableFlag(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 0 : 1;
}

export function parseDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  return null;
}

/**
 * Call Date is a FRACTIONAL Excel serial (date + time-of-day), floored per
 * this session's clovia-crm-disposition-bulk.service.ts convention.
 */
export function parseCallDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const days = Math.floor(raw);
    const secondsOfDay = Math.round((raw - days) * 86400);
    const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + secondsOfDay * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importCloviaFeedbackBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    // "Nothing left to do" is ambiguous on its own: it is the normal, legitimate shape of a
    // re-run after every row already finished ('imported'/'error' from a prior pass), but it is
    // ALSO the shape of a batch whose row-staging step never persisted anything at all despite the
    // header claiming valid rows. Only the second case is a failure; telling them apart needs a
    // second query, at ANY row_status.
    const [staged] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`,
      [batchId],
    );
    if (Number((staged as RowDataPacket[])[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW()
         WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Clovia' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const toInsert: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Clovia" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const uniqueRef = String(data["Unique"] ?? "").trim();
    const callDate = parseCallDate(data["Call Date"]);
    const reportDate = parseDate(data["Date"]) ?? callDate?.slice(0, 10) ?? null;
    if (!uniqueRef || !callDate || !reportDate) {
      const msg = `Row ${row.row_no}: "Unique", "Call_Date" and "Date" are all required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, reportDate, callDate, uniqueRef,
        String(data["Advisor Id"] ?? "").trim() || null,
        String(data["Phone Number"] ?? "").trim() || null,
        String(data["Language"] ?? "").trim() || null,
        String(data["Option"] ?? "").trim() || null,
        parseNullableFlag(data["C-SAT/D-SAT"]),
        'bulk_upload',
        batchId,
        importedByUserId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO clovia_feedback_raw
           (id, process_id, report_date, call_date, unique_ref, advisor_id, phone_number,
            language, survey_option, csat_flag, data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
            advisor_id = VALUES(advisor_id),
            phone_number = VALUES(phone_number),
            language = VALUES(language),
            survey_option = VALUES(survey_option),
            csat_flag = VALUES(csat_flag)`,
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

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
