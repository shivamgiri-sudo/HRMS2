import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Appreciate Health's "Billing" (agent productivity/billing) export --
 * writes into the SAME already-live db_masmis.aw_billing table (474 real
 * rows, uploaded_by=7, upload_batch_id populated -- inserted by the
 * separate My Dashboards tool; confirmed no existing HRMS2 code path
 * writes here yet).
 *
 * No real Excel export has been seen for this upload type, so header
 * matching is normalized rather than alias-listed -- see
 * aw-mandate-bulk.service.ts's own comment for the full reasoning.
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

export async function importAwBillingBatch(
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

    const requiredVal = getByColumn(data, "agent_id");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "agent_id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.aw_billing
           (call_date, agent_id, agent_name, total_calls, connected_calls, not_connected_calls, total_talk_time, total_wrapup_time, total_pause_time, total_idle_time, pickup_time, total_login_time, first_login_time, last_logout_time, customer_disconnect, uuid, emp_id, lob, week, month, call_date_agent_id, bio, bio_break, lunch, tea, tea_break, inbound_aux, meeting_aux, meeting, ticket_work, whatsapp_chat, technical_cc, technical_dialer, email_work, training, sip_disconnected, sip_unregistered, technical_issue_dialer, technical_issue_cc, change_mode, technical_issue_crm, qa_feedback, video_kyc_aux, net_login_hrs, actual_mandays, shift_time, roster_count, shift_start_time, late_login_status, ontime_login_status, late_login_count, ontime_login_count, acht_with_picked_up_time, acht, occupancy_pct, calling_target, break_exceed_count, net_occupancy_pct, lob2, billing_type, actual_versant, billing_in_number, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n(data, "call_date"),
          requiredVal,
          n(data, "agent_name"),
          n(data, "total_calls"),
          n(data, "connected_calls"),
          n(data, "not_connected_calls"),
          n(data, "total_talk_time"),
          n(data, "total_wrapup_time"),
          n(data, "total_pause_time"),
          n(data, "total_idle_time"),
          n(data, "pickup_time"),
          n(data, "total_login_time"),
          n(data, "first_login_time"),
          n(data, "last_logout_time"),
          n(data, "customer_disconnect"),
          n(data, "uuid"),
          n(data, "emp_id"),
          n(data, "lob"),
          n(data, "week"),
          n(data, "month"),
          n(data, "call_date_agent_id"),
          n(data, "bio"),
          n(data, "bio_break"),
          n(data, "lunch"),
          n(data, "tea"),
          n(data, "tea_break"),
          n(data, "inbound_aux"),
          n(data, "meeting_aux"),
          n(data, "meeting"),
          n(data, "ticket_work"),
          n(data, "whatsapp_chat"),
          n(data, "technical_cc"),
          n(data, "technical_dialer"),
          n(data, "email_work"),
          n(data, "training"),
          n(data, "sip_disconnected"),
          n(data, "sip_unregistered"),
          n(data, "technical_issue_dialer"),
          n(data, "technical_issue_cc"),
          n(data, "change_mode"),
          n(data, "technical_issue_crm"),
          n(data, "qa_feedback"),
          n(data, "video_kyc_aux"),
          n(data, "net_login_hrs"),
          n(data, "actual_mandays"),
          n(data, "shift_time"),
          n(data, "roster_count"),
          n(data, "shift_start_time"),
          n(data, "late_login_status"),
          n(data, "ontime_login_status"),
          n(data, "late_login_count"),
          n(data, "ontime_login_count"),
          n(data, "acht_with_picked_up_time"),
          n(data, "acht"),
          n(data, "occupancy_pct"),
          n(data, "calling_target"),
          n(data, "break_exceed_count"),
          n(data, "net_occupancy_pct"),
          n(data, "lob2"),
          n(data, "billing_type"),
          n(data, "actual_versant"),
          n(data, "billing_in_number"),
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
       VALUES (?, 'aw_billing', ?, ?, NULL)`,
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
