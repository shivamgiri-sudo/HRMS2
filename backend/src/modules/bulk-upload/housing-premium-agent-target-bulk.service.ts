import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Housing Premium's own "Team Details" sheet -- found while auditing every
 * sheet of the same real workbook already downloaded this session for Sale
 * Raw (housing-premium-sale-raw-bulk.service.ts), not named in Housing
 * Premium's own SOP text, but real data with no DB backing anywhere:
 * per-agent monthly sales target, achievement and TL assignment.
 *
 * The sheet carries no date column of its own -- Report_Period must be
 * supplied at upload time. An "InActive" agent's Target/Achievement %
 * columns hold a literal "-" placeholder in the real sample, meaning "no
 * target set", not zero -- parsed to null, not 0.
 */

export const HOUSING_PREMIUM_AGENT_TARGET_HEADERS = [
  "Emp_ID", "Report_Period", "Agent_Name", "TL_Name", "Center", "DOJ",
  "Tenure", "Tenure_Bucket", "Target", "Achievement", "Ach_Pct", "Status",
] as const;

/** The real sample uses a literal "-" for "not applicable" -- parsed to null, never 0. */
export function parseNullableAmount(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "-") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Ach_Pct in the real sample is a plain fraction (0.949825 = 94.98%), same
 * convention as this session's DU APR utilization -- multiplied into a
 * percentage here, not stored as a bare fraction.
 */
export function parseAchPct(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "-") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 3 ? n * 100 : n;
}

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
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  return null;
}

/** Report_Period must be a plain YYYY-MM the uploader supplies, not derived from any cell. */
export function parseReportPeriod(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importHousingPremiumAgentTargetBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Housing Premium' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Housing Premium" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const empId = String(data["Emp_ID"] ?? "").trim();
    const reportPeriod = parseReportPeriod(data["Report_Period"]);
    if (!empId || !reportPeriod) {
      const msg = `Row ${row.row_no}: "Emp_ID" and "Report_Period" (YYYY-MM) are both required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO housing_premium_agent_target
           (id, process_id, report_period, mas_employee_code, agent_name, tl_name, center,
            doj, tenure_days, tenure_bucket, target_amount, achievement_amount, achievement_pct,
            status, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_name = VALUES(agent_name),
            tl_name = VALUES(tl_name),
            center = VALUES(center),
            doj = VALUES(doj),
            tenure_days = VALUES(tenure_days),
            tenure_bucket = VALUES(tenure_bucket),
            target_amount = VALUES(target_amount),
            achievement_amount = VALUES(achievement_amount),
            achievement_pct = VALUES(achievement_pct),
            status = VALUES(status)`,
        [
          randomUUID(), processId, reportPeriod, empId,
          String(data["Agent_Name"] ?? "").trim() || null,
          String(data["TL_Name"] ?? "").trim() || null,
          String(data["Center"] ?? "").trim() || null,
          parseDate(data["DOJ"]),
          parseNullableInt(data["Tenure"]),
          String(data["Tenure_Bucket"] ?? "").trim() || null,
          parseNullableAmount(data["Target"]),
          parseNullableAmount(data["Achievement"]),
          parseAchPct(data["Ach_Pct"]),
          String(data["Status"] ?? "").trim() || null,
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
