import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Finnable's own "Finnable Audit" Google Sheet ("Audit_Data" tab) -- found
 * via Drive search after "Finnable_Dashboard_v4" (a downloaded Apps Script
 * project) turned out to be a generic, undeployed template with no real
 * values to verify against. The real sheet is an AI call-quality audit
 * pipeline output with no DB backing anywhere.
 *
 * Scoped down from the source's full 78 columns to the ones clearly
 * structured across the real sample -- see sql/1727's own comment for what
 * was left out and why.
 */

export const FINNABLE_QUALITY_AUDIT_HEADERS = [
  "id", "client_id", "campaign_id", "CallDate", "length_in_sec", "AgentName",
  "MobileNo", "CallDisposition", "SaleDone", "Category", "SubCategory",
  "AreaForImprovement", "Feedback", "FileName",
] as const;

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** SaleDone arrives as 1.0/0.0/"None" in the real sample -- "None" means not yet assessed, not "no sale". */
export function parseNullableFlag(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "None") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 0 : 1;
}

export function cleanText(raw: unknown, maxLen: number): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "None") return null;
  return v.slice(0, maxLen);
}

/**
 * CallDate arrives as "22-05-2026 17:00" (DD-MM-YYYY HH:MM) in the real
 * sample -- a format not seen in any other source this session, confirmed
 * against 423 real rows.
 */
export function parseCallDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/.exec(v);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${m[4].padStart(2, "0")}:${m[5]}:00`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:00`;
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importFinnableQualityAuditBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Finnable' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Finnable" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const auditId = parseNullableInt(data["id"]);
    const callDate = parseCallDate(data["CallDate"]);
    if (auditId === null || !callDate) {
      const msg = `Row ${row.row_no}: "id" and "CallDate" are both required — together they define the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }
    const reportDate = callDate.slice(0, 10);

    try {
      await db.execute(
        `INSERT INTO finnable_quality_audit_raw
           (id, process_id, audit_id, client_id, campaign_id, call_date, report_date,
            length_seconds, agent_code, reference_number, call_disposition, sale_done,
            category, sub_category, area_for_improvement, feedback, recording_url,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            client_id = VALUES(client_id),
            campaign_id = VALUES(campaign_id),
            call_date = VALUES(call_date),
            length_seconds = VALUES(length_seconds),
            agent_code = VALUES(agent_code),
            reference_number = VALUES(reference_number),
            call_disposition = VALUES(call_disposition),
            sale_done = VALUES(sale_done),
            category = VALUES(category),
            sub_category = VALUES(sub_category),
            area_for_improvement = VALUES(area_for_improvement),
            feedback = VALUES(feedback),
            recording_url = VALUES(recording_url)`,
        [
          randomUUID(), processId, auditId,
          cleanText(data["client_id"], 50),
          cleanText(data["campaign_id"], 50),
          callDate, reportDate,
          parseNullableInt(data["length_in_sec"]),
          cleanText(data["AgentName"], 50),
          cleanText(data["MobileNo"], 50),
          cleanText(data["CallDisposition"], 100),
          parseNullableFlag(data["SaleDone"]),
          cleanText(data["Category"], 100),
          cleanText(data["SubCategory"], 100),
          cleanText(data["AreaForImprovement"], 500),
          cleanText(data["Feedback"], 500),
          cleanText(data["FileName"], 500),
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
