import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Domestic Billing Approved Headcount bulk upload.
 * Upload type: DOMESTIC_BILLING_APPROVED_HC
 *
 * Each row declares an approved HC + FTE rate for a process/LOB in a given month.
 * INSERT INTO domestic_billing_approved_hc ON DUPLICATE KEY UPDATE so re-uploads
 * are idempotent (month + process + lob are the unique key).
 */

export const DOMESTIC_BILLING_APPROVED_HC_HEADERS = [
  "Month",
  "Process",
  "LOB",
  "Approved Headcount",
  "FTE Rate",
  "Planning Rule",
  "Active",
] as const;

const MONTH_NAMES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  january: "01", february: "02", march: "03", april: "04",
  june: "06", july: "07", august: "08", september: "09",
  october: "10", november: "11", december: "12",
};

/**
 * Normalise any reasonable month representation to YYYY-MM.
 *
 * Accepted inputs:
 *   "Sep-26"       → "2026-09"
 *   "Sep-2026"     → "2026-09"
 *   "2026-09"      → "2026-09"
 *   "Sep 2026"     → "2026-09"
 *   "September 2026" → "2026-09"
 */
export function normalizeMonth(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;

  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(v)) return v;

  // "Sep-26" or "Sep-2026"
  const m1 = /^([A-Za-z]{3,9})-(\d{2,4})$/.exec(v);
  if (m1) {
    const mon = MONTH_NAMES[m1[1].toLowerCase()];
    if (!mon) return null;
    const yr = m1[2].length === 2 ? `20${m1[2]}` : m1[2];
    return `${yr}-${mon}`;
  }

  // "Sep 2026" or "September 2026"
  const m2 = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(v);
  if (m2) {
    const mon = MONTH_NAMES[m2[1].toLowerCase()];
    if (!mon) return null;
    return `${m2[2]}-${mon}`;
  }

  return null;
}

export function parsePlanningRule(raw: unknown): "SUNDAY_OFF" | "ALL_DAYS" {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "SUNDAY_OFF") return "SUNDAY_OFF";
  return "ALL_DAYS";
}

export function parseActiveFlag(raw: unknown): 0 | 1 {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "TRUE" || v === "YES" || v === "1") return 1;
  return 0;
}

export function parseDecimal(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const v = String(raw).replace(/,/g, "").trim();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parsePositiveInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const v = String(raw).replace(/,/g, "").trim();
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importDomesticBillingApprovedHcBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; skippedRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, skippedRows: 0, errors: [] };

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const toInsert: ChunkInsertRow[] = [];
  let skippedRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? (JSON.parse(row.normalized_data) as Record<string, unknown>)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    // --- Parse fields ---
    const month = normalizeMonth(data["Month"]);
    const process = String(data["Process"] ?? "").trim() || null;
    const lob = String(data["LOB"] ?? "").trim() || null;
    const approvedHc = parsePositiveInt(data["Approved Headcount"]);
    const fteRate = parseDecimal(data["FTE Rate"]);
    const planningRule = parsePlanningRule(data["Planning Rule"]);
    const active = parseActiveFlag(data["Active"]);

    // --- Validation ---
    if (!month) {
      const msg = `Row ${row.row_no}: "Month" is required and could not be parsed (got: ${String(data["Month"] ?? "")})`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    if (!process) {
      const msg = `Row ${row.row_no}: "Process" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    if (!lob) {
      const msg = `Row ${row.row_no}: "LOB" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    if (approvedHc === null || approvedHc < 0) {
      const msg = `Row ${row.row_no}: "Approved Headcount" must be a non-negative integer`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    // --- Skip rule: Approved Headcount <= 0 when Active = 0 ---
    if (active === 0 && approvedHc <= 0) {
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'imported' WHERE id = ?`,
        [row.id],
      );
      skippedRows++;
      continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(),
        month,
        process,
        lob,
        approvedHc,
        fteRate ?? null,
        planningRule,
        active,
        batchId,
        importedByUserId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO domestic_billing_approved_hc
       (id, month, process, lob, approved_headcount, fte_rate, planning_rule, active,
        data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
      approved_headcount = VALUES(approved_headcount),
      fte_rate           = VALUES(fte_rate),
      planning_rule      = VALUES(planning_rule),
      active             = VALUES(active),
      updated_at         = NOW()`,
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  await db.execute(
    `UPDATE upload_batch
        SET batch_status   = IF(? > 0, 'failed', 'imported'),
            imported_rows  = ?,
            error_rows     = ?,
            updated_at     = NOW()
      WHERE id = ?`,
    [errorRows, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, skippedRows, errors };
}
