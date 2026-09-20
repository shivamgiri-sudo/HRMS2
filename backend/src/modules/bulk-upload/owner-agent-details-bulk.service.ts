import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Housing Owner's "Owner Agent Details" roster -- writes into
 * db_masmis.owner_agent_details (sql/1766). Columns confirmed directly
 * against the real file the user supplied
 * (C:\Users\MAS60358\Desktop\Housing Premium\Owner_AgentDetails.xlsx):
 * SNo, CRMID, Overall, TLName, DOJ, Status, Ageing, Bucket, MonthlyTarget,
 * Without GST Target, PerDayTarget, MTD, MAS, Name, AM -- a target/incentive
 * tracking sheet, not a plain roster; the first version of this service
 * guessed at "Emp ID"/"Name" with no sample and never matched (the real
 * identity column is "MAS", the MAS employee code). "Name" and "Overall"
 * both carry name-like values in the one real sample seen and are stored
 * as separate columns rather than guessed to be duplicates.
 *
 * Deliberately a different, company-specific shape from
 * pre-agent-details-bulk.service.ts -- the two real files are not parallel.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function n(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}
function parseNullableDecimal(v: string): number | null {
  const num = parseFloat(v.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importOwnerAgentDetailsBatch(
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

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const toInsert: ChunkInsertRow[] = [];

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const masId = getByColumn(data, "MAS");
    if (!masId) {
      const msg = `Row ${row.row_no}: "MAS" (employee code) is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id, rowNo: row.row_no,
      values: [
        n(data, "SNo"), n(data, "CRMID"), n(data, "Overall"), n(data, "TLName", "TL Name"),
        n(data, "DOJ"), n(data, "Status") ?? "Active", n(data, "Ageing"), n(data, "Bucket"),
        parseNullableDecimal(getByColumn(data, "MonthlyTarget", "Monthly Target")),
        parseNullableDecimal(getByColumn(data, "Without GST Target")),
        parseNullableDecimal(getByColumn(data, "PerDayTarget", "Per Day Target")),
        parseNullableDecimal(getByColumn(data, "MTD")),
        masId, n(data, "Name"), n(data, "AM"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.owner_agent_details
       (sno, crm_id, overall, tl_name, doj, status, ageing, bucket, monthly_target,
        without_gst_target, per_day_target, mtd, mas_id, name, am, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'owner_agent_details', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
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
