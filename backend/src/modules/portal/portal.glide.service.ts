import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { GlidePath, GlidePoint } from "./portal.types.js";
import type { SetGlideInput } from "./portal.validation.js";

function offsetMonth(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  let year = y;
  let month = m + months;
  while (month > 12) { month -= 12; year += 1; }
  while (month <= 0) { month += 12; year -= 1; }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function buildMonthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let cur = from;
  while (cur <= to) {
    months.push(cur);
    cur = offsetMonth(cur, 1);
  }
  return months;
}

export const portalGlideService = {
  async getGlidePaths(processId: string, period: string): Promise<GlidePath[]> {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period format: ${period}`);

    if (processId === "p-demo-1") {
      return [
        {
          metric_id: "m-csat", metric_code: "CSAT", metric_name: "Customer Satisfaction", unit: "%", direction: "higher_is_better", target: 90,
          points: [
            { month: "2026-02", actual: 88, committed: 87.5, target: 90 },
            { month: "2026-03", actual: 91.2, committed: 88.0, target: 90 },
            { month: "2026-04", actual: 90.5, committed: 89.0, target: 90 },
            { month: "2026-05", actual: 88.5, committed: 89.5, target: 90 },
            { month: "2026-06", actual: null, committed: 90.0, target: 90 },
            { month: "2026-07", actual: null, committed: 90.0, target: 90 },
          ],
          behind_commitment: true
        }
      ];
    }

    const [procRows] = await db.execute<RowDataPacket[]>(
      "SELECT process_name FROM process_master WHERE id = ? LIMIT 1",
      [processId]
    );
    const procName = (procRows as RowDataPacket[])[0]?.process_name as string | undefined;
    if (!procName) return [];

    const [metricRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         m.id AS metric_id, m.metric_code, m.metric_name, m.unit, m.direction,
         tm.target_value
       FROM kpi_template kt
       JOIN kpi_template_metric tm ON tm.template_id = kt.id
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       LEFT JOIN kpi_score ks ON ks.metric_id = m.id AND ks.period = ?
       WHERE kt.template_name LIKE ?
       AND (
         ks.actual_value IS NULL
         OR (m.direction = 'higher_is_better' AND ks.actual_value < tm.target_value)
         OR (m.direction = 'lower_is_better'  AND ks.actual_value > tm.target_value)
       )`,
      [period, `%${procName.replace(/[%_\\]/g, "\\$&")}%`]
    );

    if ((metricRows as RowDataPacket[]).length === 0) return [];

    const metricIds = (metricRows as RowDataPacket[]).map(r => r.metric_id);
    const placeholders = metricIds.map(() => "?").join(",");

    const threeMonthsAgo = offsetMonth(period, -3);
    const [actualRows] = await db.execute<RowDataPacket[]>(
      `SELECT metric_id, period, actual_value FROM kpi_score
       WHERE metric_id IN (${placeholders}) AND period >= ? AND period <= ?
       ORDER BY metric_id, period`,
      [...metricIds, threeMonthsAgo, period]
    );

    const threeMonthsAhead = offsetMonth(period, 3);
    const [commitRows] = await db.execute<RowDataPacket[]>(
      `SELECT metric_id, month, committed_value FROM glide_path_commitment
       WHERE process_id = ? AND metric_id IN (${placeholders})
         AND month > ? AND month <= ?
       ORDER BY metric_id, month`,
      [processId, ...metricIds, period, threeMonthsAhead]
    );

    return (metricRows as RowDataPacket[]).map(metric => {
      const actuals = (actualRows as RowDataPacket[]).filter(r => r.metric_id === metric.metric_id);
      const commits = (commitRows as RowDataPacket[]).filter(r => r.metric_id === metric.metric_id);

      const months = buildMonthRange(threeMonthsAgo, threeMonthsAhead);
      const points: GlidePoint[] = months.map(m => ({
        month: m,
        actual: actuals.find(a => a.period === m)?.actual_value ?? null,
        committed: commits.find(c => c.month === m)?.committed_value ?? null,
        target: metric.target_value,
      }));

      const currentActual = actuals.find(a => a.period === period)?.actual_value ?? null;
      const currentCommit = commits.find(c => c.month === period)?.committed_value ?? null;
      const behind = currentActual != null && currentCommit != null && currentCommit !== 0
        && Math.abs(currentActual - currentCommit) / Math.abs(currentCommit) > 0.05
        && (metric.direction === "higher_is_better" ? currentActual < currentCommit : currentActual > currentCommit);

      return {
        metric_id: metric.metric_id,
        metric_code: metric.metric_code,
        metric_name: metric.metric_name,
        unit: metric.unit,
        direction: metric.direction,
        target: metric.target_value,
        points,
        behind_commitment: behind,
      };
    });
  },

  async setCommitment(input: SetGlideInput, userId: string): Promise<void> {
    if (input.processId === "p-demo-1") return;
    await db.execute(
      `INSERT INTO glide_path_commitment (id, process_id, metric_id, month, committed_value, committed_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE committed_value = VALUES(committed_value), committed_by = VALUES(committed_by)`,
      [randomUUID(), input.processId, input.metricId, input.month, input.committedValue, userId]
    );
  },
};
