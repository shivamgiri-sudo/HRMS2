import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
Clovia's Quality Audit export (cl_quality.xlsx, 23 real
 * columns). Distinct table from the existing clovia_quality_audit_raw
 * (mas_hrms) per the same Housing Owner/Premium precedent. "Emp ID" in the
 * real file has trailing spaces in its header text -- harmless, the
 * normalizer strips all whitespace anyway.
 *
 * No real Excel export was known ahead of time for most of this session's
 * uploaders, but this one WAS confirmed directly against the real file --
 * every header below is read off it verbatim, not normalized-matched
 * blind. Still using normalized (case/space/separator-stripped) matching
 * as the mechanism, since it costs nothing and only adds tolerance.
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

export async function importClQualityBatch(
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
  let importedRows = 0;
  let errorRows = 0;

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "Unique");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "Unique" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.cl_quality
           (unique_id, chat_mail_date, audit_date, chat_id, emp_id, emp_name, tl, chat_source, cx_query, frt_shared_within_timeline, correct_information_shared, soft_skills_followed_on_chat, reminder_shared_to_cx, cx_concern_resolved, tagging_mail_shared, aoi_if_any, lob, week, count_val, cq_score, fatal, acpt, acpt_reason, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requiredVal,
          n(data, "Chat/Mail Date"),
          n(data, "Audit Date"),
          n(data, "Chat ID"),
          n(data, "Emp ID"),
          n(data, "Emp Name"),
          n(data, "TL"),
          n(data, "Chat Source"),
          n(data, "Cx Query"),
          n(data, "FRT shared within timeline"),
          n(data, "Correct Information Shared"),
          n(data, "Softs skills followed on chat"),
          n(data, "Reminder shared to cx"),
          n(data, "Cx's Concern Resolved"),
          n(data, "Tagging/mail shared"),
          n(data, "AOI if any"),
          n(data, "LOB"),
          n(data, "Week"),
          n(data, "Count"),
          n(data, "CQ Score"),
          n(data, "Fatal"),
          n(data, "ACPT"),
          n(data, "ACPT Reason"),
          uploadedByInt, batchId,
        ] as never[],
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) });
      errorRows++;
    }
  }

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'cl_quality', ?, ?, NULL)`,
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
