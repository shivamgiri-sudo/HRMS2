import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Manual/upload feed for KPI Studio's process-grain sources.
 *
 * kpi_studio_manual_value already exists but is keyed on employee_id NOT NULL —
 * it can carry a per-employee figure, never a client's own number that belongs to
 * nobody in particular (Revenue, Sales Count, AOV). This writes
 * kpi_studio_process_manual_value instead, its process-grain counterpart, and
 * exists specifically because bb_sale, gnc_sale, gnc_allocation, neemans_sale_raw
 * and neemans_allocation stopped being uploaded 58-101 days ago (verified
 * 2026-09-08), leaving 16 commercial KPIs across Bella Vita, GNC and Neemans
 * wired and permanently blank for any current period.
 *
 * One column per field the linked KPI Studio sources already read (sales,
 * revenue, prepaid, connected, allocated, ...) so an uploaded row plugs straight
 * into formulas that already exist — nothing here is a new metric, only a new way
 * to supply the numbers the existing ones were built to read.
 */

export const PROCESS_MANUAL_KPI_HEADERS = [
  "Process Code",
  "Date",
  "Sales",
  "Revenue",
  "Prepaid",
  "Paid",
  "Connected",
  "Allocated",
  "RTO",
  "Delivered",
  "Tickets",
  "Resolved",
  "In TAT",
  "Judged",
] as const;

/**
 * Header -> the field_name a linked KPI Studio source reads. One row can carry
 * any subset — a sales upload and a chat upload for the same process share this
 * table and never collide, because they name different fields.
 *
 * Tickets/Resolved/In TAT/Judged exist for IDAM Natural Wellness's chat KPIs
 * (CHAT_TICKETS, CHAT_RESOLVED_PCT, CHAT_FRT_SLA_PCT), whose real source,
 * db_masmis.bb_chat, is the same stopped-upload problem as the sales tables —
 * verified stale 71 days on 2026-09-08.
 */
const FIELD_COLUMNS: Array<{ header: string; field: string }> = [
  { header: "Sales", field: "sales" },
  { header: "Revenue", field: "revenue" },
  { header: "Prepaid", field: "prepaid" },
  { header: "Paid", field: "paid" },
  { header: "Connected", field: "connected" },
  { header: "Allocated", field: "allocated" },
  { header: "RTO", field: "rto" },
  { header: "Delivered", field: "delivered" },
  { header: "Tickets", field: "tickets" },
  { header: "Resolved", field: "resolved" },
  { header: "In TAT", field: "in_tat" },
  { header: "Judged", field: "judged" },
];

export function parseNumber(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
interface ProcRef extends RowDataPacket { id: string; k: string }

export async function importProcessManualKpiBatch(
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

  // Resolved by code, never created — the same rule process-delivery-bulk.service.ts
  // uses, for the same reason: a row against an unrecognised process is a typo, not
  // a new client to invent.
  const [procRows] = await db.execute<ProcRef[]>(
    "SELECT id, UPPER(process_code) k FROM process_master WHERE active_status = 1",
  );
  const processByCode = new Map(procRows.map((r) => [r.k, r.id]));

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const code = String(data["Process Code"] ?? "").trim().toUpperCase();
    const processId = processByCode.get(code);
    if (!processId) {
      const msg = `Row ${row.row_no}: no active process with code "${code || "(blank)"}"`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const date = parseDate(data["Date"]);
    if (!date) {
      const msg = `Row ${row.row_no}: "Date" is required and must be readable`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    // A row naming no metric column at all is not an error worth stopping the batch
    // for — a sheet with one metric per upload will have that shape on every row —
    // but it is worth zero writes, so it is counted separately rather than as a hit.
    const present = FIELD_COLUMNS
      .map((f) => ({ ...f, value: parseNumber(data[f.header]) }))
      .filter((f) => f.value !== null);

    if (!present.length) {
      const msg = `Row ${row.row_no}: no recognised metric column had a numeric value`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      for (const f of present) {
        await db.execute(
          `INSERT INTO kpi_studio_process_manual_value
             (id, process_id, field_name, value_date, field_value, entry_source, upload_batch_id, created_by)
           VALUES (?, ?, ?, ?, ?, 'upload', ?, ?)
           ON DUPLICATE KEY UPDATE
             field_value = VALUES(field_value),
             upload_batch_id = VALUES(upload_batch_id),
             updated_at = NOW()`,
          [randomUUID(), processId, f.field, date, f.value, batchId, importedByUserId],
        );
      }
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
