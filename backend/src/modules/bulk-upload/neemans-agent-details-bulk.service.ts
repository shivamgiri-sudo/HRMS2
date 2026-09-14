import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Neemans' agent roster -- writes into the SAME already-live
 * db_masmis.nms_Agent_Details table (22 real rows) the separate My
 * Dashboards tool already uses. No unique key on emp_id in the live schema
 * (confirmed via SHOW COLUMNS), so this follows the same insert-only,
 * no-dedup convention as every other table in this upload family --
 * re-uploading the same agent adds a second row rather than updating one,
 * matching what the live table itself already allows.
 *
 * No real Excel export of this table has been seen (an internal roster
 * sheet, not a system-generated report), so the header aliases below are a
 * best-effort guess. Same remediation playbook as every other uploader
 * this session if a real file's headers differ: read the real error, add
 * the real header as an alias.
 */

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}
function n(data: Record<string, unknown>, ...keys: string[]): string | null {
  const v = get(data, ...keys);
  return v || null;
}
function parseNullableDecimal(v: string): number | null {
  const num = parseFloat(v.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

/** "YYYY-MM-DD" / "D-Mon-YY" / "M/D/YYYY" -> "YYYY-MM-DD" for a DATE column.
 * Same three formats already confirmed real across GNC's own uploaders. */
const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
export function parseAgentDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "-" || v === "0") return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/.exec(v);
  if (m) {
    const mon = MONTH_ABBREVIATIONS[m[2].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${mon}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importNeemansAgentDetailsBatch(
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
  let importedRows = 0;
  let errorRows = 0;

  const createdByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const empId = get(data, "Emp ID", "EmpId", "emp_id", "empId", "ID");
    const name = get(data, "Name", "name", "Agent Name", "AgentName");
    if (!empId || !name) {
      const msg = `Row ${row.row_no}: "emp_id" and "name" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.nms_Agent_Details
           (emp_id, daildesk_id, name, lob, tl, doj, fhd, status, dol, created_by, monthly_target)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empId,
          n(data, "DialDesk ID", "DailDesk ID", "daildesk_id", "DialDeskId"),
          name,
          n(data, "LOB", "lob"),
          n(data, "TL", "tl", "Team Leader", "TeamLeader"),
          parseAgentDate(get(data, "DOJ", "doj", "Date of Joining")),
          parseAgentDate(get(data, "FHD", "fhd", "First Half Day")),
          n(data, "Status", "status") ?? "Active",
          parseAgentDate(get(data, "DOL", "dol", "Date of Leaving")),
          createdByInt,
          parseNullableDecimal(get(data, "Monthly Target", "monthly_target", "Target", "target")),
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

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'nms_Agent_Details', ?, ?, NULL)`,
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
