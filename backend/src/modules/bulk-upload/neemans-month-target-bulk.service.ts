import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { markRowsImported } from "./batch-row-status.js";
import { setNeemansTarget } from "../sales-upload/sales-upload.service.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";

/**
 * Neemans monthly target upload -- unlike the other 11 uploaders bridged
 * today, there is no bulk insertXxxRows to share: setNeemansTarget() is a
 * single-record upsert (one row per month, ON DUPLICATE KEY UPDATE), so
 * calling it once per staged row here is the file-upload shape of the
 * exact same, already-live write path -- not a second writer to the table.
 */

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function get(data: Record<string, unknown>, ...keys: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const k of keys) {
    const v = normalized[normalizeKey(k)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export async function importNeemansMonthTargetBatch(
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
    if (Number(staged[0]?.n ?? 0) === 0) {
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

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const importedIds: string[] = [];

  const outcomes = await mapWithConcurrency(batchRows, BULK_ROW_CONCURRENCY, async (row) => {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const month = get(data, "month");
    const totalTargetRaw = get(data, "totalTarget", "total_target", "target");
    const totalTarget = parseFloat(totalTargetRaw);
    if (!month || !Number.isFinite(totalTarget)) {
      const msg = `Row ${row.row_no}: "month" and a numeric "target" are required`;
      return { ok: false as const, rowId: row.id, msg };
    }

    try {
      const dailyTargetRaw = get(data, "dailyTarget", "daily_target");
      await setNeemansTarget(month, parseFloat(dailyTargetRaw) || 0, totalTarget);
      return { ok: true as const, rowId: row.id };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, rowId: row.id, msg: `Row ${row.row_no}: ${msg}` };
    }
  });

  for (const o of outcomes) {
    if (o.ok) { importedIds.push(o.rowId); }
    else { errors.push(o.msg); errorUpdates.push({ rowId: o.rowId, message: o.msg.slice(0, 500) }); }
  }

  if (importedIds.length) {
    await markRowsImported(importedIds);
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

  const importedRows = importedIds.length;
  const errorRows = errorUpdates.length;
  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ?,
        error_summary = ?, updated_at = NOW()
     WHERE id = ?`,
    [finalStatus, importedRows, errorRows, errors[0] ?? null, batchId],
  );

  return { importedRows, errorRows, errors };
}
