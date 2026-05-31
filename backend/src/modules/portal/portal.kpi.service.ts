import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { KpiScorecard } from "./portal.types.js";
import { maskPortalEmployee } from "../../shared/portalMask.js";

export const portalKpiService = {
  computeAchievement(actual: number, target: number, direction: string): number {
    if (target === 0) return 0;
    const raw = direction === "higher_is_better" ? (actual / target) * 100 : (target / actual) * 100;
    return Math.min(Math.round(raw * 100) / 100, 120);
  },

  ragFromAchievement(pct: number): "green" | "amber" | "red" {
    if (pct >= 100) return "green";
    if (pct >= 85) return "amber";
    return "red";
  },

  async getScorecards(processId: string, period: string, allowedProcessIds?: string[]): Promise<KpiScorecard[]> {
    // Defence-in-depth: verify the caller is allowed to access this processId.
    // The controller already calls assertProcessAccess but this layer adds a second check.
    if (!processId) throw Object.assign(new Error("processId is required"), { statusCode: 400 });
    if (allowedProcessIds !== undefined && !allowedProcessIds.includes(processId)) {
      throw Object.assign(new Error("Process not in your access list"), { statusCode: 403 });
    }
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period format: ${period}`);

    if (processId === "p-demo-1") {
      return [
        {
          metric_id: "m-csat", metric_code: "CSAT", metric_name: "Customer Satisfaction", unit: "%", direction: "higher_is_better", target: 90, actual: 88.5, achievement_pct: 98.33, rag: "green",
          sparkline: [
            { period: "2025-12", value: 87.0 },
            { period: "2026-01", value: 89.1 },
            { period: "2026-02", value: 88.0 },
            { period: "2026-03", value: 91.2 },
            { period: "2026-04", value: 90.5 },
            { period: "2026-05", value: 88.5 }
          ]
        },
        {
          metric_id: "m-aht", metric_code: "AHT", metric_name: "Average Handle Time", unit: "s", direction: "lower_is_better", target: 280, actual: 320, achievement_pct: 87.5, rag: "amber",
          sparkline: [
            { period: "2025-12", value: 340 },
            { period: "2026-01", value: 330 },
            { period: "2026-02", value: 315 },
            { period: "2026-03", value: 290 },
            { period: "2026-04", value: 305 },
            { period: "2026-05", value: 320 }
          ]
        },
        {
          metric_id: "m-fcr", metric_code: "FCR", metric_name: "First Contact Resolution", unit: "%", direction: "higher_is_better", target: 80, actual: 74, achievement_pct: 92.5, rag: "green",
          sparkline: [
            { period: "2025-12", value: 72 },
            { period: "2026-01", value: 73.5 },
            { period: "2026-02", value: 75.1 },
            { period: "2026-03", value: 74.8 },
            { period: "2026-04", value: 76 },
            { period: "2026-05", value: 74 }
          ]
        }
      ];
    }

    // Fetch process name first to build a safe parameterized LIKE
    const [procRows] = await db.execute<RowDataPacket[]>(
      "SELECT process_name FROM process_master WHERE id = ? LIMIT 1",
      [processId]
    );
    const procName = (procRows as RowDataPacket[])[0]?.process_name as string | undefined;
    if (!procName) return [];

    const [metricRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         m.id AS metric_id, m.metric_code, m.metric_name, m.unit, m.direction,
         tm.target_value,
         ks.actual_value
       FROM kpi_template kt
       JOIN kpi_template_metric tm ON tm.template_id = kt.id
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       LEFT JOIN kpi_score ks ON ks.metric_id = m.id AND ks.period = ?
       WHERE kt.template_name LIKE ?
       ORDER BY m.category, m.metric_name`,
      [period, `%${procName.replace(/[%_\\]/g, "\\$&")}%`]
    );

    const metricIds = (metricRows as RowDataPacket[]).map(r => r.metric_id);
    const sparkMap = new Map<string, Array<{ period: string; value: number }>>();

    if (metricIds.length > 0) {
      const sixMonthsAgo = getSixMonthsAgo(period);
      const placeholders = metricIds.map(() => "?").join(",");
      const [sparkRows] = await db.execute<RowDataPacket[]>(
        `SELECT metric_id, period, actual_value
         FROM kpi_score
         WHERE metric_id IN (${placeholders}) AND period >= ? AND period <= ?
         ORDER BY metric_id, period`,
        [...metricIds, sixMonthsAgo, period]
      );
      for (const row of sparkRows as RowDataPacket[]) {
        if (!sparkMap.has(row.metric_id)) sparkMap.set(row.metric_id, []);
        sparkMap.get(row.metric_id)!.push({ period: row.period, value: row.actual_value });
      }
    }

    return (metricRows as RowDataPacket[]).map(rawRow => {
      // Strip any PII that might bleed in from joined employee columns
      const row = maskPortalEmployee(rawRow as Record<string, unknown>);
      const actual = row.actual_value as number | null ?? null;
      const target = row.target_value as number;
      const direction = row.direction as string;
      const ach = actual != null
        ? portalKpiService.computeAchievement(actual, target, direction)
        : 0;
      const scorecard: KpiScorecard = {
        metric_id: row.metric_id as string,
        metric_code: row.metric_code as string,
        metric_name: row.metric_name as string,
        unit: row.unit as string,
        direction: direction as "higher_is_better" | "lower_is_better",
        target,
        actual,
        achievement_pct: ach,
        rag: portalKpiService.ragFromAchievement(ach),
        sparkline: sparkMap.get(row.metric_id as string) ?? [],
      };
      return scorecard;
    });
  },
};

function getSixMonthsAgo(period: string): string {
  const [y, m] = period.split("-").map(Number);
  let year = y;
  let month = m - 6;
  while (month <= 0) { month += 12; year -= 1; }
  return `${year}-${String(month).padStart(2, "0")}`;
}
