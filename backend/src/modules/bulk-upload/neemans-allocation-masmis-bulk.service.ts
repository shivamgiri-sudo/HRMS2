import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Neemans' real "Allocation" export -- writes into the SAME already-live
 * db_masmis.neemans_allocation table (56,377 real rows) the separate My
 * Dashboards tool already uses. Live schema matches the doc exactly.
 * Alias-based header resolution, same as that repo's own controller.
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
  const num = parseFloat(v);
  return Number.isFinite(num) ? num : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importNeemansAllocationMasmisBatch(
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

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const phone = get(data, "phone", "phone_number", "mobile");
    if (!phone) {
      const msg = `Row ${row.row_no}: "phone" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.neemans_allocation
           (phone, email, customer_name, product_title, amount, type, date, agent,
            calling_status, sub_scenario1, sub_scenario2, call_id, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          phone, n(data, "email", "email_id", "emailid"),
          n(data, "customerName", "customername", "customer_name", "name"),
          n(data, "productTitle", "producttitle", "product_title", "line_items", "lineitems", "product"),
          parseNullableDecimal(get(data, "amount", "value", "total", "cart_value")),
          n(data, "type"), n(data, "date"), n(data, "agent", "agent_name", "agentname"),
          n(data, "callingStatus", "callingstatus", "calling_status", "status"),
          n(data, "subScenario1", "subscenario1", "sub_scenario1", "subscenario_1", "scenario1"),
          n(data, "subScenario2", "subscenario2", "sub_scenario2", "subscenario_2", "scenario2"),
          n(data, "callId", "callid", "call_id", "id"),
          null, batchId,
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
       VALUES (?, 'neemans_allocation', ?, ?, NULL)`,
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

  return { importedRows, errorRows, errors };
}
