import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Bla Bli Blu's real "DD tagging (Dial Desk)" export -- an HTML-table .xls
 * file downloaded straight from the DialDesk ticketing website (folder:
 * rebla_bli_bludashboard_sop_formulation_inboundabc_with_). Plain text
 * "YYYY-MM-DD HH:MM:SS" datetimes (not Excel serials -- this is an HTML
 * export, not a real workbook). See sql/1739 for the cross-schema check
 * that confirmed no DB backing exists for this ticket/complaint taxonomy.
 */

export const BLA_BLI_BLU_DD_TAGGING_HEADERS = [
  "IN CALL FROM", "Call Id", "SCENARIO", "SUB SCENARIO 1", "SUB SCENARIO 2", "SUB SCENARIO 3",
  "Customer Name", "AWB Logistic", "BBB Oder ID", "Email ID", "Product Name", "Sale Amt with GST",
  "Category", "Call From", "Customer Feedback", "Payment Mode", "Agent Remarks", "CallDate",
  "Call Action", "Call Sub Action", "Call Action Remarks", "Closer Date", "Follow Up Date",
  "Case Close By", "TAT", "Due Date", "Call Created", "Call Status", "Ticket Status", "Remarks",
  "Damage Product Name", "Closer Time",
] as const;

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

/** Plain "YYYY-MM-DD HH:MM:SS" (or date-only) text -> "YYYY-MM-DD HH:MM:SS". No Excel serials here. */
export function parseDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (d) return `${d[1]}-${d[2]}-${d[3]} 00:00:00`;
  return null;
}

export function parseNullableDecimal(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "Closer Time" is a plain integer-seconds text field (e.g. "0"), unlike the
 * fraction-of-a-day durations seen in real Excel workbooks this session --
 * this file is an HTML export with no Excel serials at all. */
export function parseNullableSeconds(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** "Call Created" carries the real agent code as free text, e.g.
 * "DialDesk - MAS60037" -> "MAS60037". This is the only column that has it. */
export function parseAgentCode(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  const m = /\b(MAS\d{4,6})\b/i.exec(v);
  return m ? m[1].toUpperCase() : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importBlaBliBluDdTaggingBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Bla Bli Blu" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const callId = cleanText(data["Call Id"]);
    const callDate = parseDateTime(data["CallDate"]);
    if (!callId || !callDate) {
      const msg = `Row ${row.row_no}: "Call Id" and "CallDate" are both required -- Call Id is this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO bla_bli_blu_dd_tagging_raw
           (id, process_id, call_id, phone_number, scenario, sub_scenario_1, sub_scenario_2, sub_scenario_3,
            customer_name, awb_logistic, order_id, email, product_name, sale_amount, category, call_direction,
            customer_feedback, payment_mode, agent_remarks, call_date, call_action, call_sub_action,
            call_action_remarks, closer_date, follow_up_date, case_close_by, tat, due_date, agent_code,
            call_status, ticket_status, remarks, damage_product_name, closer_time_seconds,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            call_status = VALUES(call_status),
            ticket_status = VALUES(ticket_status),
            remarks = VALUES(remarks)`,
        [
          randomUUID(), processId, callId,
          cleanText(data["IN CALL FROM"]),
          cleanText(data["SCENARIO"]),
          cleanText(data["SUB SCENARIO 1"]),
          cleanText(data["SUB SCENARIO 2"]),
          cleanText(data["SUB SCENARIO 3"]),
          cleanText(data["Customer Name"]),
          cleanText(data["AWB Logistic"]),
          cleanText(data["BBB Oder ID"]),
          cleanText(data["Email ID"]),
          cleanText(data["Product Name"]),
          parseNullableDecimal(data["Sale Amt with GST"]),
          cleanText(data["Category"]),
          cleanText(data["Call From"]),
          cleanText(data["Customer Feedback"]),
          cleanText(data["Payment Mode"]),
          cleanText(data["Agent Remarks"]),
          callDate,
          cleanText(data["Call Action"]),
          cleanText(data["Call Sub Action"]),
          cleanText(data["Call Action Remarks"]),
          parseDateTime(data["Closer Date"]),
          parseDateTime(data["Follow Up Date"]),
          cleanText(data["Case Close By"]),
          cleanText(data["TAT"]),
          parseDateTime(data["Due Date"]),
          parseAgentCode(data["Call Created"]),
          cleanText(data["Call Status"]),
          cleanText(data["Ticket Status"]),
          cleanText(data["Remarks"]),
          cleanText(data["Damage Product Name"]),
          parseNullableSeconds(data["Closer Time"]),
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
