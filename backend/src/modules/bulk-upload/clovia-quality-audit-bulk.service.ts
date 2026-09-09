import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Clovia's own "Quality Raw" sheet -- found while auditing every sheet of
 * the same workbook family already used this session for Chat Performance/
 * CRM Disposition/Team Alignment/APR Utilization/IB+Outbound CDR Raw/
 * Feedback/Rechurn Calls, not named in Clovia Steps.docx's own SOP text,
 * but real data with no DB backing anywhere: a per-chat/email QA audit
 * scorecard.
 */

export const CLOVIA_QUALITY_AUDIT_HEADERS = [
  "Unique", "Chat_ID", "Chat_Mail_Date", "Audit_Date", "Emp_ID", "Emp_Name", "TL",
  "Chat_Source", "Cx_Query", "FRT_Score", "Correct_Info_Score", "Soft_Skills_Score",
  "Reminder_Score", "Concern_Resolved_Score", "Tagging_Score", "AOI", "LOB", "Week",
  "CQ_Score", "Fatal", "ACPT", "ACPT_Reason",
] as const;

export function parseNullableDecimal(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importCloviaQualityAuditBatch(
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

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Clovia' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Clovia" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const uniqueRef = String(data["Unique"] ?? "").trim();
    const chatId = String(data["Chat_ID"] ?? "").trim();
    const reportDate = parseDate(data["Chat_Mail_Date"]);
    if (!uniqueRef || !chatId || !reportDate) {
      const msg = `Row ${row.row_no}: "Unique", "Chat_ID" and "Chat_Mail_Date" are all required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO clovia_quality_audit_raw
           (id, process_id, report_date, chat_mail_date, audit_date, unique_ref, chat_id,
            mas_employee_code, agent_name, tl_name, chat_source, cx_query,
            frt_shared_score, correct_info_score, soft_skills_score, reminder_shared_score,
            concern_resolved_score, tagging_shared_score, aoi, lob, week_label,
            cq_score, fatal, acpt, acpt_reason,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            chat_mail_date = VALUES(chat_mail_date),
            audit_date = VALUES(audit_date),
            mas_employee_code = VALUES(mas_employee_code),
            agent_name = VALUES(agent_name),
            tl_name = VALUES(tl_name),
            chat_source = VALUES(chat_source),
            cx_query = VALUES(cx_query),
            frt_shared_score = VALUES(frt_shared_score),
            correct_info_score = VALUES(correct_info_score),
            soft_skills_score = VALUES(soft_skills_score),
            reminder_shared_score = VALUES(reminder_shared_score),
            concern_resolved_score = VALUES(concern_resolved_score),
            tagging_shared_score = VALUES(tagging_shared_score),
            aoi = VALUES(aoi),
            lob = VALUES(lob),
            week_label = VALUES(week_label),
            cq_score = VALUES(cq_score),
            fatal = VALUES(fatal),
            acpt = VALUES(acpt),
            acpt_reason = VALUES(acpt_reason)`,
        [
          randomUUID(), processId, reportDate, reportDate,
          parseDate(data["Audit_Date"]),
          uniqueRef, chatId,
          String(data["Emp_ID"] ?? "").trim() || null,
          String(data["Emp_Name"] ?? "").trim() || null,
          String(data["TL"] ?? "").trim() || null,
          String(data["Chat_Source"] ?? "").trim() || null,
          String(data["Cx_Query"] ?? "").trim() || null,
          parseNullableDecimal(data["FRT_Score"]),
          parseNullableDecimal(data["Correct_Info_Score"]),
          parseNullableDecimal(data["Soft_Skills_Score"]),
          parseNullableDecimal(data["Reminder_Score"]),
          parseNullableDecimal(data["Concern_Resolved_Score"]),
          parseNullableDecimal(data["Tagging_Score"]),
          String(data["AOI"] ?? "").trim() || null,
          String(data["LOB"] ?? "").trim() || null,
          String(data["Week"] ?? "").trim() || null,
          parseNullableDecimal(data["CQ_Score"]),
          String(data["Fatal"] ?? "").trim() || null,
          String(data["ACPT"] ?? "").trim() || null,
          String(data["ACPT_Reason"] ?? "").trim() || null,
          batchId,
          importedByUserId,
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

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  return { importedRows, errorRows, errors };
}
