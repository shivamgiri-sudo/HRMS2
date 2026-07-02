import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ProcessCard, HeadlineMetric } from "./portal.types.js";

const HEADLINE_METRICS = ["CSAT", "AHT", "FCR"];

function computeRag(achievementPct: number): "green" | "amber" | "red" {
  if (achievementPct >= 100) return "green";
  if (achievementPct >= 85) return "amber";
  return "red";
}

function computeAchievement(actual: number, target: number, direction: string): number {
  if (target === 0) return 0;
  const raw = direction === "higher_is_better" ? (actual / target) * 100 : (target / actual) * 100;
  return Math.min(Math.round(raw * 100) / 100, 120);
}

export const portalOverviewService = {
  async getOverview(processIds: string[]): Promise<ProcessCard[]> {
    if (processIds.includes("p-demo-1")) {
      return [
        {
          process_id: "p-demo-1",
          process_name: "Customer Support L2",
          client_name: "Airtel India",
          rag: "amber",
          headline_metrics: [
            { metric_code: "CSAT", metric_name: "Customer Satisfaction", unit: "%", actual: 88.5, target: 90.0, achievement_pct: 98.33, rag: "green" },
            { metric_code: "AHT", metric_name: "Average Handle Time", unit: "s", actual: 320, target: 280, achievement_pct: 87.5, rag: "amber" },
            { metric_code: "FCR", metric_name: "First Contact Resolution", unit: "%", actual: 74.0, target: 80.0, achievement_pct: 92.5, rag: "green" }
          ],
          last_updated: new Date().toISOString()
        }
      ];
    }
    if (processIds.length === 0) return [];

    const placeholders = processIds.map(() => "?").join(",");
    const currentPeriod = new Date().toISOString().slice(0, 7);

    const [scoreRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         p.id AS process_id,
         p.process_name,
         cm.client_name,
         m.metric_code,
         m.metric_name,
         m.unit,
         m.direction,
         tm.target_value,
         ks.actual_value,
         ks.created_at AS last_updated
       FROM process_master p
       JOIN client_master cm ON cm.id = p.client_id
       JOIN kpi_assignment ka ON ka.designation_id IS NULL AND ka.department_id IS NULL AND ka.employee_id IS NULL
       JOIN kpi_template_metric tm ON tm.template_id = ka.template_id
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       LEFT JOIN kpi_score ks ON ks.metric_id = m.id AND ks.period = ?
       WHERE p.id IN (${placeholders}) AND p.active_status = 1
       ORDER BY p.id, m.metric_code`,
      [currentPeriod, ...processIds]
    );

    const processMap = new Map<string, ProcessCard>();
    for (const row of scoreRows as RowDataPacket[]) {
      if (!processMap.has(row.process_id)) {
        processMap.set(row.process_id, {
          process_id: row.process_id,
          process_name: row.process_name,
          client_name: row.client_name,
          rag: "green",
          headline_metrics: [],
          last_updated: null,
        });
      }
      const card = processMap.get(row.process_id)!;
      if (row.last_updated && (!card.last_updated || row.last_updated > card.last_updated)) {
        card.last_updated = row.last_updated;
      }
      if (HEADLINE_METRICS.includes(row.metric_code)) {
        const ach = row.actual_value != null
          ? computeAchievement(row.actual_value, row.target_value, row.direction)
          : 0;
        const rag = computeRag(ach);
        card.headline_metrics.push({
          metric_code: row.metric_code,
          metric_name: row.metric_name,
          unit: row.unit,
          actual: row.actual_value,
          target: row.target_value,
          achievement_pct: ach,
          rag,
        });
        if (rag === "red") card.rag = "red";
        else if (rag === "amber" && card.rag !== "red") card.rag = "amber";
      }
    }

    const cards = Array.from(processMap.values());
    const order = { red: 0, amber: 1, green: 2 };
    return cards.sort((a, b) => order[a.rag] - order[b.rag]);
  },
};
