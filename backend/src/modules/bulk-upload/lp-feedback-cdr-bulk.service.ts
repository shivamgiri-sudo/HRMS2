import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";

/**
 * lp_feedback_cdr -- writes into db_masmis.lp_feedback_cdr (sql/1772). Source: LP Feedback CDR.xlsx.
 * Columns confirmed directly against the real file, not guessed.
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

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importLpFeedbackCdrBatch(
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
  const importedRowIds: string[] = [];

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  /**
   * Rows are inserted with up to BULK_ROW_CONCURRENCY in flight at once
   * (same bounded-concurrency helper the attendance/leave import engines
   * already use) instead of one at a time -- a 23,513-row batch awaiting a
   * single INSERT per row serially is what made this import take so long
   * it got killed mid-run by an unrelated server restart. errors/
   * importedRowIds are plain array pushes from inside each task, which is
   * safe: JS never preempts one task's synchronous push with another's.
   */
  await mapWithConcurrency(batchRows, BULK_ROW_CONCURRENCY, async (row) => {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "Call_Number");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "Call_Number" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); return;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.lp_feedback_cdr
           (s_no, report_date, interval_val, call_number, service, agent, login_id, start_time, end_time, extension, remarks, dni, cli, disposition, lead_id, batch, dialer_type, duration, ivr_duration, ring_duration, talk_duration, wrapup_duration, hold_duration, call_status, hangup_by, child_call_number, ivr_terminal, unique_flag, disposition_status, attempt, service_2, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n(data, "S_No"),
          n(data, "Date"),
          n(data, "Interval"),
          requiredVal,
          n(data, "Service"),
          n(data, "Agent"),
          n(data, "Login_Id"),
          n(data, "Start_Time"),
          n(data, "End_Time"),
          n(data, "Extension"),
          n(data, "Remarks"),
          n(data, "Dni"),
          n(data, "Cli"),
          n(data, "Desposition"),
          n(data, "Lead_Id"),
          n(data, "Batch"),
          n(data, "Dialer_Type"),
          n(data, "Duration"),
          n(data, "Ivr_Duration"),
          n(data, "Ring_Duration"),
          n(data, "Talk_Duration"),
          n(data, "Wrapup_Duration"),
          n(data, "Hold_Duration"),
          n(data, "Call_Status"),
          n(data, "Hangup_By"),
          n(data, "Child_CallNumbr"),
          n(data, "Ivr_Terminal"),
          n(data, "Unque"),
          n(data, "Disposition Status"),
          n(data, "Attempt"),
          n(data, "Service_1"),
          uploadedByInt, batchId,
        ] as never[],
      );
      importedRowIds.push(row.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) });
    }
  });

  const importedRows = importedRowIds.length;
  const errorRows = errorUpdates.length;

  /**
   * Marks each successfully-inserted row 'imported' in upload_batch_row.
   * Without this, readBatchProgress() (batch-job.ts) can never show real
   * progress -- it counts rows that left 'valid'/'pending' -- and a
   * re-triggered import after a crash would re-select and re-insert every
   * already-imported row as a duplicate, since the SELECT above filters on
   * row_status IN ('valid','pending').
   */
  if (importedRowIds.length) {
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${importedRowIds.map(() => "?").join(",")})`,
      importedRowIds,
    );
  }

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'lp_feedback_cdr', ?, ?, NULL)`,
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
