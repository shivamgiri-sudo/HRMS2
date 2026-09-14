import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Clovia's Email Dashboard, daily per-agent.
 *
 * Unlike most of the Report Builder SOP gaps, a real sample file was found
 * and read directly: "Clovia Email Tracker Sept'26.xlsb" (the Drive folder
 * named in Clovia's own SOP), sheet "Raw". Columns below are taken verbatim
 * from that live file, not guessed.
 */

export const CLOVIA_EMAIL_DAILY_HEADERS = [
  "Week",
  "Date",
  "AgentName",
  "Open Email",
  "In Process",
  "Re-Open",
  "Total Mail Assigned",
  "Total Touched Email",
  "Closed Email",
  "JunkMail",
] as const;

/** These are NOT NULL with a 0 default -- a blank cell means zero, not null. */
export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/**
 * The source workbook stores Date as an Excel serial number (e.g. 46266 =
 * 2026-09-01), not text -- same epoch convention as this codebase's
 * excel_serial KPI Studio date format (1899-12-30, matching Excel's own
 * leap-year-1900 bug). Also accepts a normal date string, so a sheet that
 * has already been reformatted as text still imports.
 */
export function parseDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const serial = Number(v);
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
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

export async function importCloviaEmailDailyBatch(
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

    // The source file has a trailing space on some names ("Kanishka ") --
    // trimmed here so it does not fork the same agent into two identities.
    const agentName = String(data["AgentName"] ?? "").trim();
    if (!agentName) {
      const msg = `Row ${row.row_no}: "AgentName" is required — it is part of the row's identity`;
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

    const weekLabel = String(data["Week"] ?? "").trim() || null;

    try {
      await db.execute(
        `INSERT INTO clovia_email_daily_actual
           (id, process_id, agent_name, report_date, week_label, open_email, in_process, re_open,
            total_mail_assigned, total_touched_email, closed_email, junk_mail,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            week_label = VALUES(week_label),
            open_email = VALUES(open_email),
            in_process = VALUES(in_process),
            re_open = VALUES(re_open),
            total_mail_assigned = VALUES(total_mail_assigned),
            total_touched_email = VALUES(total_touched_email),
            closed_email = VALUES(closed_email),
            junk_mail = VALUES(junk_mail)`,
        [
          randomUUID(), processId, agentName, reportDate, weekLabel,
          parseCount(data["Open Email"]),
          parseCount(data["In Process"]),
          parseCount(data["Re-Open"]),
          parseCount(data["Total Mail Assigned"]),
          parseCount(data["Total Touched Email"]),
          parseCount(data["Closed Email"]),
          parseCount(data["JunkMail"]),
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
