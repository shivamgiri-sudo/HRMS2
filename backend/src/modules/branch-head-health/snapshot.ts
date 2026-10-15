import crypto from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { PillarScore } from "./score.js";

export async function writeSnapshot(
  branchId: string,
  date: string,
  score: number,
  pillars: PillarScore[],
  metrics: Record<string, number>,
): Promise<void> {
  await db.execute(
    `INSERT INTO branch_health_snapshot (id, branch_id, snap_date, score, pillars_json, metrics_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE score = VALUES(score), pillars_json = VALUES(pillars_json), metrics_json = VALUES(metrics_json)`,
    [crypto.randomUUID(), branchId, date, score, JSON.stringify(pillars), JSON.stringify(metrics)],
  );
}

export async function readTrend(
  branchId: string,
  metric: string,
  days: number,
): Promise<Array<{ date: string; value: number | null }>> {
  const n = Math.max(1, Math.min(366, Math.floor(Number(days)) || 1));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(snap_date, '%Y-%m-%d') AS snap_date,
            JSON_UNQUOTE(JSON_EXTRACT(metrics_json, ?)) AS value
       FROM branch_health_snapshot
      WHERE branch_id = ? AND snap_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY snap_date ASC`,
    [`$."${metric.replace(/["\\]/g, "")}"`, branchId, n],
  );
  return rows.map((r) => {
    const v = r.value === null || r.value === undefined ? null : Number(r.value);
    return { date: String(r.snap_date), value: v !== null && Number.isFinite(v) ? v : null };
  });
}
