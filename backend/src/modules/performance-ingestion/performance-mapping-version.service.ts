import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export async function approvePerformanceDatasetMapping(input: {
  idOrKey: string;
  userId: string;
  effectiveFrom: string;
}): Promise<void> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [datasets] = await connection.execute<RowDataPacket[]>(
      `SELECT id, mapping_json
         FROM performance_source_dataset
        WHERE (id = ? OR dataset_key = ?)
          AND active_status = 1
        LIMIT 1
        FOR UPDATE`,
      [input.idOrKey, input.idOrKey],
    );
    const dataset = datasets[0];
    if (!dataset) {
      throw Object.assign(new Error("Performance dataset not found"), { statusCode: 404 });
    }

    const [versions] = await connection.execute<RowDataPacket[]>(
      `SELECT version_no, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from
         FROM performance_mapping_version
        WHERE dataset_id = ?
        ORDER BY version_no DESC
        LIMIT 1
        FOR UPDATE`,
      [dataset.id],
    );
    const latest = versions[0];
    if (latest?.effective_from && input.effectiveFrom <= String(latest.effective_from)) {
      throw Object.assign(
        new Error(`Mapping effective date must be after ${String(latest.effective_from)}`),
        { statusCode: 409 },
      );
    }

    const version = Number(latest?.version_no ?? 0) + 1;
    await connection.execute(
      `UPDATE performance_mapping_version
          SET effective_to = DATE_SUB(?, INTERVAL 1 DAY)
        WHERE dataset_id = ?
          AND status = 'active'
          AND effective_to IS NULL`,
      [input.effectiveFrom, dataset.id],
    );
    await connection.execute(
      `INSERT INTO performance_mapping_version
         (id, dataset_id, version_no, mapping_json, effective_from, status,
          approved_by, approved_at, created_by)
       VALUES (UUID(), ?, ?, ?, ?, 'active', ?, NOW(), ?)`,
      [
        dataset.id,
        version,
        JSON.stringify(parseJson(dataset.mapping_json, {})),
        input.effectiveFrom,
        input.userId,
        input.userId,
      ],
    );
    await connection.execute(
      `UPDATE performance_source_dataset
          SET approval_status = 'active', approved_by = ?, approved_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [input.userId, dataset.id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
