import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bella Vita Repeat LOB's own "Alignment" sheet -- found while auditing
 * every sheet of "Bella Vita Repeat LOB Mis Dashboard July26.xlsb", not
 * named in BELLAVITA Dashboard.docx's own SOP text, but real data with no
 * DB backing anywhere: an agent roster with TL assignment, DOJ and status.
 */

export const BELLA_REPEAT_ALIGNMENT_HEADERS = [
  "MAS_ID", "Agent_Name", "TL", "DOJ", "Agent_Period", "Status",
] as const;

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

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importBellaRepeatAlignmentBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Bella-Vita Organic' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];

  const toInsert: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Bella-Vita Organic" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const masId = String(data["MAS_ID"] ?? "").trim();
    if (!masId) {
      const msg = `Row ${row.row_no}: "MAS_ID" is required — it is the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, masId,
        String(data["Agent_Name"] ?? "").trim() || null,
        String(data["TL"] ?? "").trim() || null,
        parseDate(data["DOJ"]),
        String(data["Agent_Period"] ?? "").trim() || null,
        String(data["Status"] ?? "").trim() || null,
        batchId,
        importedByUserId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO bella_repeat_alignment
       (id, process_id, mas_employee_code, agent_name, team_leader, doj, agent_period, status,
        data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
        agent_name = VALUES(agent_name),
        team_leader = VALUES(team_leader),
        doj = VALUES(doj),
        agent_period = VALUES(agent_period),
        status = VALUES(status)`,
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

  return { importedRows, errorRows, errors };
}
