import type { RowDataPacket } from "mysql2";
import { num, numOrNull, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface KpiMonth {
  period: string;
  avgAchievementPct: number | null;
  metricsMeasured: number;
  atTarget: boolean | null;
  finalScore: number | null;
  rating: string | null;
}

export interface KpiSection {
  months: KpiMonth[];
  monthsWithData: number;
  monthsAtTarget: number;
  atTargetPct: number | null;
  best: { period: string; avgAchievementPct: number } | null;
  worst: { period: string; avgAchievementPct: number } | null;
}

/** Same rule as analytics/employee-360.service.ts fetchKpiMetrics. */
export function achievementPct(actual: number, target: number | null, direction: string | null): number | null {
  if (target === null || !(target > 0)) return null;
  if (String(direction ?? "").toLowerCase() === "lower_is_better") {
    return actual <= 0 ? 100 : Math.min(100, (target / actual) * 100);
  }
  return Math.min(100, (actual / target) * 100);
}

// The ORDER BY puts the newest config first and the loop below keeps only the first row per (period, metric).
// Plan assumption corrected: repo SQL has UNIQUE (process_id, metric_id), so today there is one row per pair and the current target applies to every month; the dedupe is a guard only.
const SCORE_SQL = `
  SELECT ks.period AS period, ks.metric_id AS metric_id, ks.actual_value AS actual_value,
         km.metric_name AS metric_name, km.direction AS direction,
         kpc.target_value AS target_value, kpc.effective_from AS effective_from
    FROM kpi_score ks
    JOIN kpi_metric_master km ON km.id = ks.metric_id
    LEFT JOIN employees e ON e.id = ks.employee_id
    LEFT JOIN kpi_process_config kpc ON kpc.metric_id = ks.metric_id AND kpc.process_id = e.process_id
   WHERE ks.employee_id = ? AND ks.period BETWEEN ? AND ?
   ORDER BY ks.period, ks.metric_id, kpc.effective_from DESC`;

// Optional: kpi_score_summary is empty on prod today, so it only decorates months, never defines them.
const SUMMARY_SQL = `
  SELECT DATE_FORMAT(p.period_start, '%Y-%m') AS period, s.final_score AS final_score,
         s.rating AS rating, s.status AS status
    FROM kpi_score_summary s
    JOIN kpi_score_period p ON p.id = s.period_id
   WHERE s.employee_id = ? AND p.period_start BETWEEN ? AND ?
   ORDER BY p.period_start`;

export async function loadKpiSection(db: SqlExecutor, w: DossierWindow): Promise<KpiSection> {
  const first = w.months[0]!;
  const last = w.months[w.months.length - 1]!;
  const [rows] = await db.execute<RowDataPacket[]>(SCORE_SQL, [w.employeeId, first, last]);

  const seen = new Set<string>();
  const byPeriod = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.period}|${r.metric_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pct = achievementPct(num(r.actual_value), numOrNull(r.target_value), r.direction ?? null);
    const list = byPeriod.get(String(r.period)) ?? [];
    if (pct !== null) list.push(pct);
    byPeriod.set(String(r.period), list);
  }

  const [sumRows] = await db.execute<RowDataPacket[]>(SUMMARY_SQL, [w.employeeId, w.start, w.end]);
  const summaryByPeriod = new Map<string, { finalScore: number | null; rating: string | null }>();
  for (const r of sumRows) {
    summaryByPeriod.set(String(r.period), { finalScore: numOrNull(r.final_score), rating: r.rating ?? null });
  }

  const periods = [...new Set([...byPeriod.keys(), ...summaryByPeriod.keys()])].sort();
  const months: KpiMonth[] = periods.map((period) => {
    const list = byPeriod.get(period) ?? [];
    const avg = list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null;
    const sum = summaryByPeriod.get(period);
    return {
      period,
      avgAchievementPct: avg,
      metricsMeasured: list.length,
      atTarget: avg === null ? null : avg >= 100,
      finalScore: sum?.finalScore ?? null,
      rating: sum?.rating ?? null,
    };
  });

  const measured = months.filter((m) => m.avgAchievementPct !== null);
  const atTarget = measured.filter((m) => m.atTarget).length;
  const sorted = [...measured].sort((a, b) => (b.avgAchievementPct as number) - (a.avgAchievementPct as number));
  const pick = (m: KpiMonth | undefined) =>
    m ? { period: m.period, avgAchievementPct: m.avgAchievementPct as number } : null;

  return {
    months,
    monthsWithData: measured.length,
    monthsAtTarget: atTarget,
    atTargetPct: measured.length ? round1((atTarget / measured.length) * 100) : null,
    best: pick(sorted[0]),
    worst: pick(sorted[sorted.length - 1]),
  };
}
