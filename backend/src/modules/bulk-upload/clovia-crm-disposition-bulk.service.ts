import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Clovia's CRM Disposition data (per its own SOP: "Downloaded from CRM:
 * Clovia CRM" -- no DB backing anywhere). A real sample was read directly
 * from a live workbook.
 *
 * "EMP Name" is the MAS-agent display name column, populated on ~42% of
 * rows -- the sheet's own "Agent Name" column is a different company's
 * (Purple Panda) login email, not accepted here.
 */

export const CLOVIA_CRM_DISPOSITION_HEADERS = [
  "Ticket No",
  "Date",
  "EMP Name",
  "Reason",
  "Sub Reason",
  "FTR",
  "Repeat/FTR",
  "Campaign",
  "WEEKS",
] as const;

/** '1' or 1 -> pass; 0 or blank -> fail/unknown. Never guessed beyond that. */
export function parseFtrFlag(raw: unknown): 0 | 1 | null {
  const v = String(raw ?? "").trim();
  if (v === "1") return 1;
  if (v === "0") return 0;
  return null;
}

/**
 * The live source's Date column is a fractional Excel serial (date + time of
 * day, e.g. 46266.399... = 2026-09-01 09:35). Math.floor, not Math.round --
 * rounding a time after noon rolls the row into the NEXT day, which is
 * exactly the kind of silent off-by-one this codebase's other Excel-serial
 * parsers (clovia-email-daily, clovia-chat-daily) don't need to guard against
 * because their Date columns carry no time component.
 */
export function parseDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importCloviaCrmDispositionBatch(
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
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const ticketNo = String(data["Ticket No"] ?? "").trim();
    if (!ticketNo) {
      const msg = `Row ${row.row_no}: "Ticket No" is required — it is the row's identity`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const reportDate = parseDate(data["Date"]);
    if (!reportDate) {
      const msg = `Row ${row.row_no}: "Date" is required and could not be read`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const empName = String(data["EMP Name"] ?? "").trim() || null;
    const reason = String(data["Reason"] ?? "").trim() || null;
    const subReason = String(data["Sub Reason"] ?? "").trim() || null;
    const repeatOrFtr = String(data["Repeat/FTR"] ?? "").trim() || null;
    const campaign = String(data["Campaign"] ?? "").trim() || null;
    const weekLabel = String(data["WEEKS"] ?? "").trim() || null;

    try {
      await db.execute(
        `INSERT INTO clovia_crm_disposition
           (id, process_id, ticket_no, report_date, emp_name, reason, sub_reason,
            ftr_flag, repeat_or_ftr, campaign, week_label,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            emp_name = VALUES(emp_name),
            reason = VALUES(reason),
            sub_reason = VALUES(sub_reason),
            ftr_flag = VALUES(ftr_flag),
            repeat_or_ftr = VALUES(repeat_or_ftr),
            campaign = VALUES(campaign),
            week_label = VALUES(week_label)`,
        [
          randomUUID(), processId, ticketNo, reportDate, empName, reason, subReason,
          parseFtrFlag(data["FTR"]), repeatOrFtr, campaign, weekLabel,
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
