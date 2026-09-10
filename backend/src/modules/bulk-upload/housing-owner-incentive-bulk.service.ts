import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Housing Owner's own "Incentive" sheet -- per-agent monthly target/
 * achievement/incentive payout. See sql/1737's own comment for the
 * corruption this source has and why only clean cells are imported.
 */

export const HOUSING_OWNER_INCENTIVE_HEADERS = [
  "Agent Name", "Report_Period", "Band", "Partner Name", "Team leader",
  "Total Target Without GST", "Total Revenue without GST", "Achievement %",
  "Stage", "Status", "Target With GST", "Sale Value with GST", "Achieved %",
  "Monthly incentive", "Week1_Target", "Week1_Achievement", "Week1_Achi_Pct",
  "Week1_Min_Earning", "Week2_Target", "Week2_Achievement", "Week2_Achi_Pct",
  "Week2_Min_Earning", "Week3_Target", "Week3_Achievement", "Week3_Achi_Pct",
  "Week3_Min_Earning", "Final",
] as const;

/**
 * The source stores broken-formula cells as literal Excel error byte
 * codes -- "0x17" (#REF!), "0x2a" (#N/A), and their siblings -- instead of
 * a value. These are dropped to NULL, never guessed at or coerced to 0.
 */
const ERROR_CODES = new Set(["0x00", "0x07", "0x0f", "0x17", "0x1d", "0x24", "0x2a"]);

export function isErrorCode(raw: unknown): boolean {
  return typeof raw === "string" && ERROR_CODES.has(raw.trim().toLowerCase());
}

export function parseNullableDecimal(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "" || isErrorCode(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Achievement %/Achi% arrive as plain fractions (0.5 = 50%) in the real sample. */
export function parseNullablePctFraction(raw: unknown): number | null {
  const n = parseNullableDecimal(raw);
  if (n === null) return null;
  return Math.abs(n) <= 3 ? n * 100 : n;
}

export function cleanText(raw: unknown): string | null {
  if (isErrorCode(raw)) return null;
  const v = String(raw ?? "").trim();
  return v || null;
}

export function isValidPeriod(raw: unknown): raw is string {
  return typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw);
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importHousingOwnerIncentiveBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Housing Owner' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Housing Owner" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const agentName = cleanText(data["Agent Name"]);
    const reportPeriod = data["Report_Period"];
    if (!agentName || !isValidPeriod(reportPeriod)) {
      const msg = `Row ${row.row_no}: "Agent Name" and "Report_Period" (YYYY-MM) are both required -- together they are this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO housing_owner_incentive_raw
           (id, process_id, report_period, agent_name, band, partner_name, team_leader,
            total_target_no_gst, total_revenue_no_gst, achievement_pct, stage, status,
            target_with_gst, sale_value_with_gst, achieved_pct, monthly_incentive,
            week1_target, week1_achievement, week1_achi_pct, week1_min_earning,
            week2_target, week2_achievement, week2_achi_pct, week2_min_earning,
            week3_target, week3_achievement, week3_achi_pct, week3_min_earning,
            final_incentive, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            band = VALUES(band),
            status = VALUES(status),
            achievement_pct = VALUES(achievement_pct),
            monthly_incentive = VALUES(monthly_incentive),
            final_incentive = VALUES(final_incentive)`,
        [
          randomUUID(), processId, reportPeriod, agentName,
          cleanText(data["Band"]),
          cleanText(data["Partner Name"]),
          cleanText(data["Team leader"]),
          parseNullableDecimal(data["Total Target Without GST"]),
          parseNullableDecimal(data["Total Revenue without GST"]),
          parseNullablePctFraction(data["Achievement %"]),
          cleanText(data["Stage"]),
          cleanText(data["Status"]),
          parseNullableDecimal(data["Target With GST"]),
          parseNullableDecimal(data["Sale Value with GST"]),
          parseNullablePctFraction(data["Achieved %"]),
          parseNullableDecimal(data["Monthly incentive"]),
          parseNullableDecimal(data["Week1_Target"]),
          parseNullableDecimal(data["Week1_Achievement"]),
          parseNullablePctFraction(data["Week1_Achi_Pct"]),
          parseNullableDecimal(data["Week1_Min_Earning"]),
          parseNullableDecimal(data["Week2_Target"]),
          parseNullableDecimal(data["Week2_Achievement"]),
          parseNullablePctFraction(data["Week2_Achi_Pct"]),
          parseNullableDecimal(data["Week2_Min_Earning"]),
          parseNullableDecimal(data["Week3_Target"]),
          parseNullableDecimal(data["Week3_Achievement"]),
          parseNullablePctFraction(data["Week3_Achi_Pct"]),
          parseNullableDecimal(data["Week3_Min_Earning"]),
          parseNullableDecimal(data["Final"]),
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
