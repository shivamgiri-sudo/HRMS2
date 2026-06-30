// backend/src/modules/kpi/kpi-org-summary.service.ts
// Org-wide KPI summary across all processes — for CEO / COO / Super Admin dashboards.
// Derives scores from kpi_daily_actual (same source as the leaderboard query) so the
// per-process weighted score is consistent with individual rankings.

import { db } from "../../db/mysql.js";

export interface ProcessKpiSummary {
  processId: string;
  processName: string;
  branchName: string;
  agentCount: number;
  avgScore: number;
  topScore: number;
  bottomScore: number;
  sRating: number; // >=100
  aRating: number; // 90–99
  bRating: number; // 75–89
  cRating: number; // 60–74
  dRating: number; // <60
}

export interface OrgKpiSummary {
  orgAvgScore: number;
  totalAgentsScored: number;
  periodLabel: string;
  processSummaries: ProcessKpiSummary[];
  topProcess: { processName: string; avgScore: number } | null;
  bottomProcess: { processName: string; avgScore: number } | null;
}

export async function getOrgKpiSummary(periodDate: string): Promise<OrgKpiSummary> {
  // Accept either "YYYY-MM" or a full date string; normalise to "YYYY-MM"
  const yearMonth =
    periodDate.length === 7 ? periodDate : periodDate.substring(0, 7);

  // Step 1: compute a weighted score per employee using the same formula as the
  // leaderboard (kpi_daily_actual × kpi_process_config weights).
  const [empRows] = await db.execute<any[]>(
    `SELECT
       e.id               AS employee_id,
       e.process_id,
       pm.process_name,
       b.branch_name,
       ROUND(
         SUM(
           (
             CASE WHEN m.direction = 'lower_is_better'
                  THEN LEAST(kpc.target_value / NULLIF(kda.actual_value, 0), 1.2)
                  ELSE LEAST(kda.actual_value / NULLIF(kpc.target_value, 0), 1.2)
             END * 100
           ) * kpc.weightage
         ) / NULLIF(SUM(kpc.weightage), 0), 2
       ) AS weighted_score_pct
     FROM kpi_daily_actual kda
     JOIN employees e
       ON e.id = kda.employee_id
      AND e.active_status = 1
     JOIN kpi_process_config kpc
       ON kpc.process_id = e.process_id
      AND kpc.metric_id  = kda.metric_id
     JOIN kpi_metric_master m
       ON m.id = kda.metric_id
     JOIN process_master pm
       ON pm.id = e.process_id
      AND pm.active_status = 1
     LEFT JOIN branches b
       ON b.id = e.branch_id
     WHERE DATE_FORMAT(kda.score_date, '%Y-%m') = ?
     GROUP BY e.id, e.process_id, pm.process_name, b.branch_name`,
    [yearMonth]
  );

  // Step 2: aggregate per-process from employee rows in application code.
  // This keeps the query simple and avoids a double-aggregation SQL layer.
  const processMap = new Map<
    string,
    {
      processName: string;
      branchName: string;
      scores: number[];
    }
  >();

  for (const row of empRows as any[]) {
    const pid = row.process_id as string;
    const score = Number(row.weighted_score_pct ?? 0);
    if (!processMap.has(pid)) {
      processMap.set(pid, {
        processName: row.process_name as string,
        branchName: (row.branch_name as string) ?? "—",
        scores: [],
      });
    }
    processMap.get(pid)!.scores.push(score);
  }

  const processSummaries: ProcessKpiSummary[] = Array.from(
    processMap.entries()
  )
    .map(([processId, { processName, branchName, scores }]) => {
      const agentCount = scores.length;
      const avgScore =
        agentCount > 0
          ? Math.round(
              (scores.reduce((a, b) => a + b, 0) / agentCount) * 100
            ) / 100
          : 0;
      const topScore = agentCount > 0 ? Math.max(...scores) : 0;
      const bottomScore = agentCount > 0 ? Math.min(...scores) : 0;
      const sRating = scores.filter((s) => s >= 100).length;
      const aRating = scores.filter((s) => s >= 90 && s < 100).length;
      const bRating = scores.filter((s) => s >= 75 && s < 90).length;
      const cRating = scores.filter((s) => s >= 60 && s < 75).length;
      const dRating = scores.filter((s) => s < 60).length;
      return {
        processId,
        processName,
        branchName,
        agentCount,
        avgScore,
        topScore,
        bottomScore,
        sRating,
        aRating,
        bRating,
        cRating,
        dRating,
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore);

  const orgAvgScore =
    processSummaries.length > 0
      ? Math.round(
          (processSummaries.reduce((sum, p) => sum + p.avgScore, 0) /
            processSummaries.length) *
            100
        ) / 100
      : 0;

  return {
    orgAvgScore,
    totalAgentsScored: processSummaries.reduce(
      (sum, p) => sum + p.agentCount,
      0
    ),
    periodLabel: yearMonth,
    processSummaries,
    topProcess:
      processSummaries.length > 0
        ? {
            processName: processSummaries[0].processName,
            avgScore: processSummaries[0].avgScore,
          }
        : null,
    bottomProcess:
      processSummaries.length > 0
        ? {
            processName:
              processSummaries[processSummaries.length - 1].processName,
            avgScore: processSummaries[processSummaries.length - 1].avgScore,
          }
        : null,
  };
}
