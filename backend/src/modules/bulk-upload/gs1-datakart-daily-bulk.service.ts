import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { markRowsImported } from "./batch-row-status.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * GS1 India — DataKart task processing daily actuals.
 *
 * gs1_datakart_daily_actual is one row PER ANALYST PER DAY (unique key (process_id,
 * report_date, analyst_name, task_date)). The real export ("GS1.xlsx", "Data Kart" sheet)
 * is a raw per-TASK log -- 942 rows, not pre-aggregated. This importer groups the staged
 * raw task rows by (Date, Name) in memory and writes one upserted daily row per group,
 * same fix as gs1-email-daily-bulk.service.ts and for the same reason: nobody could
 * produce the old imagined "Report Date/Analyst Name/Task Count/..." format from the
 * real tool, so this pipeline had zero rows live.
 *
 * within_tat: the real export's own "SLA" and "TAT" columns are both 100% blank across
 * all 942 rows (verified live against the actual file) -- there is no TAT-compliance
 * signal to derive from this data at all. Rather than fabricate a threshold against
 * "Duration"/"Complete time" with no stated SLA to compare it to, within_tat is left at
 * the column's own default (0, "not computed") for bulk-uploaded rows. If GS1 later
 * starts recording an actual TAT/SLA column, wire it in then.
 *
 * Upload type: GS1_DATAKART_DAILY
 * Target table: gs1_datakart_daily_actual
 * UNIQUE key: (process_id, report_date, analyst_name, task_date)
 */

export const GS1_DATAKART_DAILY_HEADERS = [
  "Date", "GCP", "GTIN Count", "Time", "Complete time", "Type", "Move", "Category",
  "Sub category", "Remark", "Date of completion", "Date of exported", "Datakart type",
  "Name", "Duration", "SLA", "Month's", "Month", "Data Type", "TAT",
] as const;

/** Handles "2-Sep-26" (real export's sheet_to_csv-rendered date) and common fallbacks. */
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

/** Real export values seen live: "Within TAT" / "In TAT" both mean compliant. Blank/absent
 * (the whole real file, currently) means "no signal" and is excluded from the percentage
 * rather than counted as a miss. */
export function isWithinTat(raw: unknown): boolean | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return v === "within tat" || v === "in tat" || v === "yes" || v === "1" || v === "true";
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

interface DailyGroup {
  taskDate: string;
  analystName: string;
  taskCount: number;
  gtinTotal: number;
  tatKnown: number;
  tatHits: number;
  rowNos: number[];
}

export async function importGs1DatakartDailyBatch(
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

      const taskDate = parseDate(data["Date"]);
      const analystName = String(data["Name"] ?? "").trim();
      if (!taskDate || !analystName) {
        const msg = `Row ${row.row_no}: "Date" and "Name" are required`;
        errors.push(msg);
        errorUpdates.push({ rowId: row.id, message: msg });
        errorRows++;
        continue;
      }

      const key = `${taskDate}|${analystName}`;
      const g = groups.get(key) ?? {
        taskDate, analystName, taskCount: 0, gtinTotal: 0, tatKnown: 0, tatHits: 0, rowNos: [],
      };
      g.taskCount += 1;
      g.gtinTotal += parseCount(data["GTIN Count"]);
      const tat = isWithinTat(data["TAT"]);
      if (tat !== null) {
        g.tatKnown += 1;
        if (tat) g.tatHits += 1;
      }
      g.rowNos.push(row.row_no);
      groups.set(key, g);
      rowIdsByGroup.set(key, [...(rowIdsByGroup.get(key) ?? []), row.id]);
    }
  }

  // One insert per analyst-day group (already collapsed from raw rows).
  // Convert to chunkedMasmisInsert so all groups go in one multi-row INSERT pass.
  const toInsert: ChunkInsertRow[] = [];
  const groupKeys: string[] = [];
  for (const [key, g] of groups) {
    const tatPct = g.tatKnown > 0 ? Math.round((g.tatHits / g.tatKnown) * 100) : 0;
    // rowId is the first raw row of the group — used by chunkedMasmisInsert for error attribution
    toInsert.push({
      rowId: rowIdsByGroup.get(key)?.[0] ?? "",
      rowNo: g.rowNos[0] ?? 0,
      values: [
        randomUUID(), processId, g.taskDate, g.analystName, g.taskDate,
        g.taskCount, g.gtinTotal, tatPct,
        batchId, importedByUserId,
      ],
    });
    groupKeys.push(key);
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO gs1_datakart_daily_actual
           (id, process_id, report_date, analyst_name, task_date,
            task_count, gtin_count, within_tat, data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
            task_count = VALUES(task_count),
            gtin_count = VALUES(gtin_count),
            within_tat = VALUES(within_tat)`,
    rows: toInsert,
  });

  // Map any insert-level errors back to all raw rowIds in the failed group
  const failedFirstRowIds = new Set(inserted.errorUpdates.map((u) => u.rowId));
  const importedRowIds: string[] = [];
  let importedRows = 0;
  for (let i = 0; i < groupKeys.length; i++) {
    const key = groupKeys[i];
    const groupRowIds = rowIdsByGroup.get(key) ?? [];
    if (!failedFirstRowIds.has(toInsert[i].rowId)) {
      importedRows += groups.get(key)!.taskCount;
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
    await markRowsImported(importedRowIds);
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
