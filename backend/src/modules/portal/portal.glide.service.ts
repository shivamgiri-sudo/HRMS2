import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { GlidePath, GlidePathsResult, GlidePoint, PortalKpiMetric } from "./portal.types.js";
import type { SetGlideInput } from "./portal.validation.js";
import { portalKpiEngine } from "./portal.kpi-engine.service.js";

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
  async getGlidePaths(processId: string, period: string): Promise<GlidePathsResult> {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period format: ${period}`);

    if (processId === "p-demo-1") {
      return {
        hasConfiguredMetrics: true,
        paths: [
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
        ],
      };
    }

    // "Configured" used to mean "has a kpi_template row whose name matches this
    // process" -- but a live check found kpi_template_metric (the join table linking a
    // template to its metrics) has ZERO rows for every client on this database, which
    // made that join permanently empty and every process's glide paths permanently
    // "unconfigured" regardless of what an admin actually committed to.
    //
    // "Configured" now means "this process has at least one glide_path_commitment row"
    // instead -- the one piece of this feature that has a real, working write path
    // (portal.controller.ts's setGlideCommitment, called from the admin's Glide Paths
    // tab). Metric identity/target/direction for each configured metric comes straight
    // from kpi_metric_master keyed off the metric_ids that actually have commitments,
    // since kpi_template_metric can't supply target_value either while it stays empty --
    // target is therefore read from the metric's own row where available, else left null
    // (rendered as "no target set" rather than guessed).
    const [ownMetricRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT metric_id FROM glide_path_commitment WHERE process_id = ?`,
      [processId]
    );
    const ownMetricIds = (ownMetricRows as RowDataPacket[]).map(r => r.metric_id as string);
    const hasConfiguredMetrics = ownMetricIds.length > 0;
    if (!hasConfiguredMetrics) return { hasConfiguredMetrics: false, paths: [] };

    const ownPlaceholders = ownMetricIds.map(() => "?").join(",");
    const [metricRows] = await db.execute<RowDataPacket[]>(
      `SELECT id AS metric_id, metric_code, metric_name, unit, direction
         FROM kpi_metric_master
        WHERE id IN (${ownPlaceholders})`,
      ownMetricIds
    );

    if ((metricRows as RowDataPacket[]).length === 0) return { hasConfiguredMetrics, paths: [] };

    const metricIds = (metricRows as RowDataPacket[]).map(r => r.metric_id);
    const placeholders = metricIds.map(() => "?").join(",");

    // kpi_score (actuals against a target) is empty for every client -- there was no real
    // "actual value for this period" source at all until portal.kpi-engine.service.ts was
    // wired in here (mirroring the exact same fix already applied to portal.kpi.service.ts
    // for the Performance tab: that engine computes real ATT/ABN/LAT/LVE/RET/HDY/DQ values
    // per process per month directly from attendance_daily_record/leave_request/employees,
    // tables verified populated for every real client). kpi_score itself is left queried
    // (not removed) as a second source for any metric_code the engine does not compute,
    // so this starts working automatically the moment kpi_score is ever populated too,
    // without another code change -- same "leave the real query in place" reasoning the
    // prior version of this comment already used, just no longer the ONLY source.
    const threeMonthsAgo = offsetMonth(period, -3);
    const [actualRows] = await db.execute<RowDataPacket[]>(
      `SELECT metric_id, period, actual_value FROM kpi_score
       WHERE metric_id IN (${placeholders}) AND period >= ? AND period <= ?
       ORDER BY metric_id, period`,
      [...metricIds, threeMonthsAgo, period]
    );

    // Engine lookup keyed by metric_code (ATT/ABN/LAT/...), not metric_id -- the engine has
    // no notion of kpi_metric_master's UUIDs, it computes by code. Matched against
    // whichever of THIS process's committed metrics happen to have a code the engine
    // knows; any committed metric with a different code (custom/dialler metrics like
    // AGENT_OCCUPANCY_PCT) simply falls through to kpi_score/null exactly as before --
    // this is additive, not a replacement path.
    //
    // Live-checked: kpi_metric_master has NO row whose metric_code is literally "ATT"
    // (or ABN/LAT/LVE/RET/HDY/DQ) -- those codes are internal to the engine's own
    // computation and were never registered as catalog entries an admin could pick from
    // the Glide Paths admin form. The one real catalog entry for the same real-world
    // concept is ATTENDANCE_PCT (family: performance, category: hr) -- the SAME alias
    // portal.kpi-engine.service.ts's own resolveMetricConfig already declares for the
    // opposite direction (reading FROM kpi_process_config). Reversed here so a commitment
    // made against the real, pickable ATTENDANCE_PCT catalog entry resolves to the
    // engine's real ATT computation instead of permanently reading null.
    const CATALOG_CODE_TO_ENGINE_CODE: Record<string, string> = { ATTENDANCE_PCT: "ATT" };
    const engineResult = await portalKpiEngine.computeProcessKpiResult(processId, period).catch(() => null);
    const engineByCode = new Map<string, PortalKpiMetric>();
    if (engineResult) {
      for (const m of engineResult.metrics) engineByCode.set(m.metric_code, m);
    }
    const resolveEngineMetric = (catalogMetricCode: string): PortalKpiMetric | undefined =>
      engineByCode.get(CATALOG_CODE_TO_ENGINE_CODE[catalogMetricCode] ?? catalogMetricCode);

    const threeMonthsAhead = offsetMonth(period, 3);
    const [commitRows] = await db.execute<RowDataPacket[]>(
      `SELECT metric_id, month, committed_value FROM glide_path_commitment
       WHERE process_id = ? AND metric_id IN (${placeholders})
         AND month > ? AND month <= ?
       ORDER BY metric_id, month`,
      [processId, ...metricIds, period, threeMonthsAhead]
    );

    const paths: GlidePath[] = (metricRows as RowDataPacket[]).map(metric => {
      const actuals = (actualRows as RowDataPacket[]).filter(r => r.metric_id === metric.metric_id);
      const commits = (commitRows as RowDataPacket[]).filter(r => r.metric_id === metric.metric_id);
      const engineMetric = resolveEngineMetric(metric.metric_code);
      // The engine's own sparkline already carries real period->value pairs for this
      // metric_code (up to 6 trailing months); indexed by period for the same lookup
      // pattern the kpi_score rows use just below.
      const engineActualByPeriod = new Map<string, number>();
      if (engineMetric) {
        for (const point of engineMetric.sparkline) engineActualByPeriod.set(point.period, point.value);
      }

      // Real target only where one genuinely exists: the engine's own resolveMetricConfig
      // (FALLBACK_METRICS / portal_kpi_config / kpi_process_config, in that precedence)
      // for a metric_code it computes; still null for any committed metric outside the
      // engine's 7 codes, same "no target set" honesty the prior version of this file used
      // (kpi_template_metric, the table that would otherwise carry a target_value per
      // process+metric, remains empty for every client -- this is the only real source).
      const target = engineMetric?.target ?? null;

      const months = buildMonthRange(threeMonthsAgo, threeMonthsAhead);
      const points: GlidePoint[] = months.map(m => ({
        month: m,
        // Engine value takes precedence when available for this exact month (it is real,
        // derived data); kpi_score is the fallback for any metric the engine doesn't
        // compute, exactly as it was the ONLY source before this change.
        actual: engineActualByPeriod.get(m) ?? actuals.find(a => a.period === m)?.actual_value ?? null,
        committed: commits.find(c => c.month === m)?.committed_value ?? null,
        target,
      }));

      const currentActual = engineActualByPeriod.get(period) ?? actuals.find(a => a.period === period)?.actual_value ?? null;
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
        target,
        points,
        behind_commitment: behind,
      };
    });
    return { hasConfiguredMetrics, paths };
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
