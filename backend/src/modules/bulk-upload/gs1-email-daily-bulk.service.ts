import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * GS1 India — Email-based GTIN processing daily actuals.
 *
 * gs1_email_daily_actual is one row PER ANALYST PER DAY (its own unique key is
 * (process_id, report_date, analyst_name, mail_date)). The real export ("GS1.xlsx",
 * "Email " sheet) is a raw per-TICKET log — 317 rows for ~10 executives across ~2 weeks,
 * not pre-aggregated. This importer groups the staged raw ticket rows by (WORK Date, Name
 * of executive) in memory and writes one upserted daily row per group, rather than
 * requiring the uploader to pre-aggregate outside the system (which is why this pipeline
 * had zero rows live despite existing since migration 1769 — nobody could produce the
 * old imagined "Report Date/Analyst Name/Mail Received/..." format from the real tool).
 *
 * sla_within_15min stores the PERCENTAGE (0-100) of that day's tickets whose SLA bucket
 * was "0-15" minutes, not a 0/1 flag — the old single-ticket-per-row design could get away
 * with a boolean; a day with several tickets needs the real rate. gs1.service.ts's read
 * side (AVG(sla_within_15min), no further *100) matches this.
 *
 * Upload type: GS1_EMAIL_DAILY
 * Target table: gs1_email_daily_actual
 * UNIQUE key: (process_id, report_date, analyst_name, mail_date)
 */

export const GS1_EMAIL_DAILY_HEADERS = [
  "Email Subject", "Sender Name", "Email Received Time", "Work Start Time", "Work End Time",
  "Mail Date", "WORK Date", "Name of executive", "Type Of Query", "Status", "Ticket", "Type",
  "Month", "Duration", "SLA", "GTIN", "Image", "Months", "Approval",
] as const;

/** Handles "1-Sep-26" (real export's sheet_to_csv-rendered date) and common fallbacks. */
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
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `20${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** The real export's "SLA" column holds a bucket label like "0-15 " (trailing space observed
 * live), not a number -- within-15-minutes is exactly the first bucket. */
export function isWithin15MinSla(raw: unknown): boolean {
  const v = String(raw ?? "").trim();
  return v.startsWith("0-15");
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

interface DailyGroup {
  mailDate: string;
  analystName: string;
  ticketCount: number;
  gtinTotal: number;
  imageTotal: number;
  slaHits: number;
  rowNos: number[];
}

export async function importGs1EmailDailyBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`,
      [batchId],
    );
    if (Number((staged as RowDataPacket[])[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW()
         WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name LIKE '%GS1%' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const rowIdsByGroup = new Map<string, string[]>();
  const groups = new Map<string, DailyGroup>();
  let errorRows = 0;

  if (!processId) {
    const msg = `No active GS1 process found in process_master`;
    for (const row of batchRows) {
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
    }
  } else {
    for (const row of batchRows) {
      const data =
        typeof row.normalized_data === "string"
          ? JSON.parse(row.normalized_data)
          : ((row.normalized_data ?? {}) as Record<string, unknown>);

      const mailDate = parseDate(data["WORK Date"]) ?? parseDate(data["Mail Date"]);
      const analystName = String(data["Name of executive"] ?? "").trim();
      if (!mailDate || !analystName) {
        const msg = `Row ${row.row_no}: "WORK Date" (or "Mail Date") and "Name of executive" are required`;
        errors.push(msg);
        errorUpdates.push({ rowId: row.id, message: msg });
        errorRows++;
        continue;
      }

      const key = `${mailDate}|${analystName}`;
      const g = groups.get(key) ?? {
        mailDate, analystName, ticketCount: 0, gtinTotal: 0, imageTotal: 0, slaHits: 0, rowNos: [],
      };
      g.ticketCount += 1;
      g.gtinTotal += parseCount(data["GTIN"]);
      g.imageTotal += parseCount(data["Image"]);
      if (isWithin15MinSla(data["SLA"])) g.slaHits += 1;
      g.rowNos.push(row.row_no);
      groups.set(key, g);
      rowIdsByGroup.set(key, [...(rowIdsByGroup.get(key) ?? []), row.id]);
    }
  }

  const toInsert: ChunkInsertRow[] = [];
  const groupKeys: string[] = [];
  for (const [key, g] of groups) {
    const slaPct = g.ticketCount > 0 ? Math.round((g.slaHits / g.ticketCount) * 100) : 0;
    toInsert.push({
      rowId: rowIdsByGroup.get(key)?.[0] ?? "",
      rowNo: 0,
      values: [
        randomUUID(), processId, g.mailDate, g.analystName, g.mailDate,
        g.ticketCount, g.gtinTotal, g.imageTotal, slaPct,
        batchId, importedByUserId,
      ],
    });
    groupKeys.push(key);
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO gs1_email_daily_actual
           (id, process_id, report_date, analyst_name, mail_date, mail_received,
            gtin_processed, image_count, sla_within_15min, data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
            mail_received     = VALUES(mail_received),
            gtin_processed    = VALUES(gtin_processed),
            image_count       = VALUES(image_count),
            sla_within_15min  = VALUES(sla_within_15min)`,
    rows: toInsert,
  });

  const failedFirstRowIds = new Set(inserted.errorUpdates.map((u) => u.rowId));
  const importedRowIds: string[] = [];
  let importedRows = 0;
  for (let i = 0; i < groupKeys.length; i++) {
    const key = groupKeys[i];
    const groupRowIds = rowIdsByGroup.get(key) ?? [];
    if (!failedFirstRowIds.has(toInsert[i].rowId)) {
      importedRows += groups.get(key)!.ticketCount;
      importedRowIds.push(...groupRowIds);
    } else {
      const msg = inserted.errorUpdates.find((u) => u.rowId === toInsert[i].rowId)?.message ?? "insert failed";
      for (const rowId of groupRowIds) {
        errors.push(`Row group ${key}: ${msg}`);
        errorUpdates.push({ rowId, message: msg.slice(0, 500) });
        errorRows++;
      }
    }
  }

  if (importedRowIds.length) {
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${importedRowIds.map(() => "?").join(",")})`,
      importedRowIds,
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
