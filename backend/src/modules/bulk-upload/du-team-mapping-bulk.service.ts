import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * DU Digital's Korea/Thailand "Team Details" sheet: Agent ID -> MAS employee
 * code directory. Not named in DU.docx's own SOP text, but real data with
 * no DB backing anywhere, found while auditing every sheet of the same two
 * workbooks already downloaded this session for DU APR (du-apr-daily-bulk.
 * service.ts). Some agent codes (Thailand's "DUT07"/"DUT12") have no
 * corresponding employees row -- likely local/contracted staff -- and are
 * kept as free text rather than forced to resolve.
 */

export const DU_TEAM_MAPPING_HEADERS = ["Agent_ID", "Agent_Name", "MAS_ID"] as const;

/**
 * "NA" appears as a literal Agent_ID in the real Thailand sample (for a row
 * whose Agent Name/MAS ID were still populated) -- treated as absent, same
 * as a blank cell, rather than stored as a literal identity value.
 */
export function normalizeAgentId(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v.toUpperCase() === "NA") return null;
  return v;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

async function importBatch(
  batchId: string,
  importedByUserId: string,
  dashboardLabel: "KOREA" | "THAILAND",
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'DU Digital' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "DU Digital" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const agentId = normalizeAgentId(data["Agent_ID"]);
    if (!agentId) {
      const msg = `Row ${row.row_no}: "Agent_ID" is required — it is the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO du_team_mapping
           (id, process_id, dashboard_label, agent_id, agent_name, mas_employee_code,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_name = VALUES(agent_name),
            mas_employee_code = VALUES(mas_employee_code)`,
        [
          randomUUID(), processId, dashboardLabel, agentId,
          String(data["Agent_Name"] ?? "").trim() || null,
          String(data["MAS_ID"] ?? "").trim() || null,
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

export async function importDuTeamMappingKoreaBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "KOREA");
}
export async function importDuTeamMappingThailandBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "THAILAND");
}
