import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Molecular Email / Reginald Men Email dashboard daily actuals.
 *
 * Both dashboards' SOPs describe an identical shape: tickets, ticket_messages
 * and ticket_events in an external MySQL DB (molecular_db_email) that does not
 * exist anywhere in this project's infrastructure — confirmed via SHOW
 * DATABASES against every host this project has ever touched (2026-09-09
 * audit). This is the manual-upload path for that gap, at the same daily
 * grain the SOP's own "Day Wise Table" and Raw Export use: Date, Total
 * Tickets, Email Closure, Open/Pending, Reopen — plus Opening Pending, which
 * the SOP states explicitly feeds the closure% denominator and is not
 * derivable from the other columns.
 *
 * Both processes are anchored to the single "Reginald" process_id (no
 * separate "Molecular" process exists in process_master today); "Dashboard"
 * is the column that tells the two report instances apart.
 */

export const EMAIL_TICKET_DAILY_HEADERS = [
  "Dashboard",
  "Date",
  "Total Tickets",
  "Email Closure",
  "Open/Pending",
  "Reopen",
  "Opening Pending",
] as const;

const DASHBOARD_LABELS: Record<string, "MOLECULAR" | "REGINALD_MEN"> = {
  "molecular email": "MOLECULAR",
  "molecular": "MOLECULAR",
  "reginald men email": "REGINALD_MEN",
  "reginald men": "REGINALD_MEN",
  "reginald": "REGINALD_MEN",
};

export function parseDashboardLabel(raw: unknown): "MOLECULAR" | "REGINALD_MEN" | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return DASHBOARD_LABELS[v] ?? null;
}

/** These are NOT NULL with a 0 default (blank cell = zero, same convention as process_delivery_actual). */
export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** opening_pending is nullable: "not supplied yet" must not silently become zero and skew closure %. */
export function parseOpeningPending(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
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

export async function importEmailTicketDailyBatch(
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

  // Only one email-support process exists today; resolved by name rather than
  // hardcoded so a future process rename or split does not silently orphan this.
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Reginald" process found to attach this row to`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const dashboardLabel = parseDashboardLabel(data["Dashboard"]);
    if (!dashboardLabel) {
      const msg = `Row ${row.row_no}: "Dashboard" must be "Molecular Email" or "Reginald Men Email"`;
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

    try {
      await db.execute(
        `INSERT INTO email_ticket_daily_actual
           (id, process_id, dashboard_label, report_date, total_tickets, email_closed,
            open_pending, email_reopen, opening_pending, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            total_tickets = VALUES(total_tickets),
            email_closed = VALUES(email_closed),
            open_pending = VALUES(open_pending),
            email_reopen = VALUES(email_reopen),
            opening_pending = VALUES(opening_pending)`,
        [
          randomUUID(), processId, dashboardLabel, reportDate,
          parseCount(data["Total Tickets"]), parseCount(data["Email Closure"]),
          parseCount(data["Open/Pending"]), parseCount(data["Reopen"]),
          parseOpeningPending(data["Opening Pending"]),
          // source_reference is part of the unique key, so a re-upload of the same
          // day from a different batch does not silently collide with the first.
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
