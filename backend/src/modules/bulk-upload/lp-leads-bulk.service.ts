import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * LP's "9. Leads" (per its own SOP: "Open BPO Panel... Select BPO Leads
 * (M)... Download each Excel sheet one by one... Paste into Leads sheet"
 * -- no DB backing exists anywhere). Columns read verbatim from two real
 * samples: "Lp Regional Sale Dashboard July26.xlsx" and "Lp Non Regional
 * Dashboard July'26.xlsx", both sheet "Leads". Phone/Email arrive already
 * masked in the source (e.g. "******1068") -- stored as-is, not re-masked.
 *
 * Row identity (verified live against 1,072 real Regional rows, zero
 * collisions): Name + Phone + Campaign + AllocatedOn.
 */

export const LP_LEADS_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "Campaign",
  "city",
  "Card",
  "PL",
  "Unsecured_Loan",
  "Income",
  "Date",
  "Status",
  "SubStatus",
  "Lead_By",
  "AllocatedOn",
  "Harassment",
  "Last_Amount",
  "Bpo_Name",
  "Attempt",
  "Disposition",
  "Sub_Disposition",
  "CR_Download",
  "token_amount",
  "LS_Amount",
  "Followup",
] as const;

export function parseNullableAmount(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** The real source's date columns are "01 Jul 2026" text, or an Excel serial when re-exported. */
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
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  m = /^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})$/.exec(v);
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

async function importBatch(
  batchId: string,
  importedByUserId: string,
  dashboardLabel: "REGIONAL" | "NON_REGIONAL",
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Lawyer Panel' LIMIT 1",
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
      const msg = `Row ${row.row_no}: no "Lawyer Panel" process found to attach this row to`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const leadName = String(data["Name"] ?? "").trim();
    const phone = String(data["Phone"] ?? "").trim();
    const campaign = String(data["Campaign"] ?? "").trim() || null;
    const allocatedOn = parseDate(data["AllocatedOn"]);
    if (!leadName || !phone) {
      const msg = `Row ${row.row_no}: "Name" and "Phone" are required — they are part of the row's identity`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const reportDate = parseDate(data["Date"]) ?? allocatedOn;
    if (!reportDate) {
      const msg = `Row ${row.row_no}: "Date" is required and could not be read`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      await db.execute(
        `INSERT INTO lp_leads_raw
           (id, process_id, dashboard_label, lead_name, phone_masked, email_masked, campaign,
            city, card_range, pl_amount, unsecured_loan_amount, income_band, lead_date,
            status, sub_status, lead_by, allocated_on, harassment_note, last_amount,
            bpo_name, attempt, disposition, sub_disposition, cr_download, token_amount,
            ls_amount, followup, report_date, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            email_masked = VALUES(email_masked),
            city = VALUES(city),
            card_range = VALUES(card_range),
            pl_amount = VALUES(pl_amount),
            unsecured_loan_amount = VALUES(unsecured_loan_amount),
            income_band = VALUES(income_band),
            lead_date = VALUES(lead_date),
            status = VALUES(status),
            sub_status = VALUES(sub_status),
            lead_by = VALUES(lead_by),
            harassment_note = VALUES(harassment_note),
            last_amount = VALUES(last_amount),
            bpo_name = VALUES(bpo_name),
            attempt = VALUES(attempt),
            disposition = VALUES(disposition),
            sub_disposition = VALUES(sub_disposition),
            cr_download = VALUES(cr_download),
            token_amount = VALUES(token_amount),
            ls_amount = VALUES(ls_amount),
            followup = VALUES(followup),
            report_date = VALUES(report_date)`,
        [
          randomUUID(), processId, dashboardLabel, leadName, phone,
          String(data["Email"] ?? "").trim() || null,
          campaign,
          String(data["city"] ?? "").trim() || null,
          String(data["Card"] ?? "").trim() || null,
          parseNullableAmount(data["PL"]),
          parseNullableAmount(data["Unsecured_Loan"]),
          String(data["Income"] ?? "").trim() || null,
          parseDate(data["Date"]),
          String(data["Status"] ?? "").trim() || null,
          String(data["SubStatus"] ?? "").trim() || null,
          String(data["Lead_By"] ?? "").trim() || null,
          allocatedOn,
          String(data["Harassment"] ?? "").trim() || null,
          parseNullableAmount(data["Last_Amount"]),
          String(data["Bpo_Name"] ?? "").trim() || null,
          parseNullableInt(data["Attempt"]),
          String(data["Disposition"] ?? "").trim() || null,
          String(data["Sub_Disposition"] ?? "").trim() || null,
          String(data["CR_Download"] ?? "").trim() || null,
          String(data["token_amount"] ?? "").trim() || null,
          String(data["LS_Amount"] ?? "").trim() || null,
          String(data["Followup"] ?? "").trim() || null,
          reportDate,
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

export async function importLpLeadsRegionalBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "REGIONAL");
}

export async function importLpLeadsNonRegionalBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "NON_REGIONAL");
}
