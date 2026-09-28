import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { KpiScorecard, PortalKpiMetric } from "./portal.types.js";
import { maskPortalEmployee } from "../../shared/portalMask.js";
import { getKpiScorecardsForProcessId } from "../process-performance/kpi-scorecard.service.js";
import { portalKpiEngine } from "./portal.kpi-engine.service.js";
import { getProcessOperationsForPortal } from "../process-operations/process-operations.service.js";

const UNIT_LABEL: Record<string, string> = { percent: "%", percentage: "%", seconds: "s", currency: "₹", count: "", ratio: "x" };

/** 'YYYY-MM' -> the {from, to} range this metric family's real source
 * (kpi_daily_actual) understands: the period's own month plus 6 months back,
 * matching this file's own getSixMonthsAgo used by the legacy kpi_score path,
 * so both paths' sparklines cover the same window. */
function periodToRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const to = new Date(y, m, 0); // last day of the period's month
  const from = new Date(y, m - 1 - 6, 1); // first day, 6 months back
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
}

export const portalKpiService = {
  /**
   * Adapts portal.kpi-engine.service.ts's PortalKpiMetric[] into this file's KpiScorecard[]
   * shape so the Performance tab's existing rendering (KpiScorecardGrid.tsx,
   * PerformanceKpiStrip in PortalProcessDashboard.tsx) needs no changes at all.
   *
   * metric_id has no real UUID counterpart in the engine's world (it computes from
   * attendance/leave/employees, not from kpi_metric_master), so metric_code is used as
   * metric_id too -- it is unique per process's result set and stable across requests,
   * which is all the frontend actually needs it for (a React key, and Sparkline's
   * fallback-to-metric_code already anticipates exactly this).
   *
   * Never throws: a schema difference (e.g. attendance_daily_record missing a column on
   * some environment) must fall through to the legacy path below, not break the whole
   * Performance tab. Returns null on any failure so the caller's `if (engineMetrics)`
   * check treats it the same as "engine had nothing to say", not "engine succeeded with
   * zero metrics" (an empty array IS a meaningful engine result -- see the achievement_pct
   * mapping below for why null/no_data still produces a real row, not an omitted one).
   */
  async tryKpiEngine(processId: string, period: string): Promise<KpiScorecard[] | null> {
    try {
      const metrics: PortalKpiMetric[] = await portalKpiEngine.computeKpisForProcess(processId, period);
      return metrics.map((m): KpiScorecard => ({
        metric_id: m.metric_code,
        metric_code: m.metric_code,
        metric_name: m.metric_name,
        unit: UNIT_LABEL[m.unit] ?? m.unit,
        direction: m.direction,
        target: m.target,
        actual: m.actual,
        achievement_pct: m.achievement_pct,
        rag: m.rag,
        sparkline: m.sparkline,
      }));
    } catch {
      return null;
    }
  },

  /**
   * Pulls real, already-computed operational/quality metrics (AHT, QA_QUALITY_PCT,
   * SLA%, funnel/conversion rates, etc.) from process-operations.service.ts's
   * "operations"/"conversion"/"quality"/"risk"/"conduct" sections into the Performance
   * tab as ADDITIONAL scorecards, alongside (never replacing) the 7 attendance-derived
   * ones from tryKpiEngine above.
   *
   * Found during a follow-up audit: the internal ProcessOperationsPage.tsx shows ~57
   * real metric codes for every process, but only the 7 attendance ones ever reached the
   * client's KPI/Performance scorecard -- everything else was visible only as a flat tile
   * on the Operations/Quality tabs, never as a scored, RAG'd, target-tracked KPI. A client
   * asking "why doesn't my Performance tab show QA scores" had no wrong answer to give.
   *
   * Only metrics with BOTH a real value AND a real configured target are included --
   * KpiScorecard.target is non-nullable by design (see its own comment: a fabricated
   * target is worse than omitting the row), and the Operations/Quality tabs already show
   * every metric including the "no target set" ones, so nothing is lost by excluding them
   * here specifically. Never throws, same reason tryKpiEngine doesn't: a schema hiccup on
   * process-operations' side must never break the whole Performance tab.
   */
  async tryOperationsMetrics(processId: string): Promise<KpiScorecard[]> {
    try {
      const result = await getProcessOperationsForPortal(processId, 180);
      if (!result) return [];
      const eligibleKeys = new Set(["operations", "conversion", "quality", "risk", "conduct"]);
      const readings = result.sections
        .filter((s) => eligibleKeys.has(s.key))
        .flatMap((s) => s.metrics)
        .filter((m) => m.value != null && m.targetValue != null);

      return readings.map((m): KpiScorecard => {
        const direction = (m.direction === "lower_is_better" ? "lower_is_better" : "higher_is_better") as "higher_is_better" | "lower_is_better";
        const ach = portalKpiService.computeAchievement(m.value!, m.targetValue!, direction);
        return {
          metric_id: m.metricKey,
          metric_code: m.metricKey,
          metric_name: m.label,
          unit: UNIT_LABEL[m.unit ?? ""] ?? (m.unit ?? ""),
          direction,
          target: m.targetValue!,
          actual: m.value,
          achievement_pct: ach,
          rag: portalKpiService.ragFromAchievement(ach),
          sparkline: m.trend
            .filter((p): p is { date: string; value: number; numerator: number | null; denominator: number | null } => p.value != null)
            .map((p) => ({ period: p.date, value: p.value })),
        };
      });
    } catch {
      return [];
    }
  },

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

    // Sheet-registered processes (BLABLIBLU/Reginald/Finnable/GS1 today) read from the
    // real kpi_daily_actual pipeline instead of the legacy kpi_template/kpi_score path
    // below -- null means "not one of these", so every other process's existing
    // behaviour is untouched.
    const registryRows = await getKpiScorecardsForProcessId(processId, periodToRange(period));
    if (registryRows) {
      const registryScorecards = registryRows.map((r): KpiScorecard => {
        // availability !== 'ok' means no real reading -- rag "no_data" and a null
        // achievement, never a fabricated 0%, which a client cannot tell apart
        // from a metric that IS measured and IS failing badly.
        const hasReading = r.availability === "ok" && r.actual != null;
        const ach = hasReading
          ? portalKpiService.computeAchievement(r.actual!, r.target, r.direction)
          : null;
        return {
          metric_id: r.metricKey,
          metric_code: r.metricKey,
          metric_name: r.label,
          unit: UNIT_LABEL[r.unit] ?? "",
          direction: r.direction,
          target: r.target,
          actual: r.actual,
          achievement_pct: ach,
          rag: ach == null ? "no_data" : portalKpiService.ragFromAchievement(ach),
          sparkline: r.trend
            .filter((p): p is { period: string; value: number } => p.value != null),
        };
      });
      // Additive merge: real operational/quality metrics (AHT, QA_QUALITY_PCT, etc.)
      // alongside the registry's own KPIs, deduped by metric_code so an operations
      // metric can never silently overwrite one the registry already scored.
      const opsScorecards = await portalKpiService.tryOperationsMetrics(processId);
      const seenCodes = new Set(registryScorecards.map((s) => s.metric_code));
      return [...registryScorecards, ...opsScorecards.filter((s) => !seenCodes.has(s.metric_code))];
    }

    // portal.kpi-engine.service.ts computes real KPIs (attendance, absenteeism, lateness,
    // leave, retention, data-completeness) straight from attendance_daily_record/
    // leave_request/employees -- tables verified populated for every real client, unlike
    // the registry above (hardcoded to 4 named processes) or the kpi_template/
    // kpi_template_metric path below (both tables have ZERO rows for every client on this
    // database, confirmed live 2026-09-19 -- that path has therefore always returned []
    // for every process not in the 4-process registry, silently, since the day it shipped).
    //
    // Tried here, after the registry and before the legacy path, so a process already
    // served correctly by either of those is completely unaffected: the legacy path below
    // is unreachable dead code today (kpi_template_metric is empty), so trying the engine
    // first can only ever turn an existing "always empty" result into real data, never
    // regress a process that currently shows something.
    const engineMetrics = await portalKpiService.tryKpiEngine(processId, period);
    if (engineMetrics && engineMetrics.length > 0) {
      // Same additive merge as the registry branch above -- real operational/quality
      // metrics alongside the engine's 7 attendance-derived ones, deduped by metric_code.
      const opsScorecards = await portalKpiService.tryOperationsMetrics(processId);
      const seenCodes = new Set(engineMetrics.map((s) => s.metric_code));
      return [...engineMetrics, ...opsScorecards.filter((s) => !seenCodes.has(s.metric_code))];
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
      // null, not 0: this process has a KPI template assigned but no kpi_score
      // row for this period yet -- that is "not scored", not "scored at zero".
      const ach = actual != null
        ? portalKpiService.computeAchievement(actual, target, direction)
        : null;
      const scorecard: KpiScorecard = {
        metric_id: row.metric_id as string,
        metric_code: row.metric_code as string,
        metric_name: row.metric_name as string,
        unit: row.unit as string,
        direction: direction as "higher_is_better" | "lower_is_better",
        target,
        actual,
        achievement_pct: ach,
        rag: ach == null ? "no_data" : portalKpiService.ragFromAchievement(ach),
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
