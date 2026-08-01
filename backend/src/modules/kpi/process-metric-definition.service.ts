import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Resolves which metrics a process measures, under the names that process uses.
 *
 * Today every configured process holds the identical three metrics with one
 * distinct target between all 97 of them, because kpi_metric_master.metric_code
 * is globally unique and nothing let a process name its own. This reads the
 * per-process definitions added by migration 1046.
 *
 * Canonical metrics (metric_id set) inherit unit and direction from
 * kpi_metric_master and can be rolled up across processes. Process-local ones
 * (local_code set) carry their own unit and direction and deliberately cannot —
 * a parameter that means something different per process must not be averaged
 * with one that does not.
 */

export type ProcessMetricDefinition = {
  id: string;
  processId: string;
  /** Canonical code when this maps to kpi_metric_master, else null. */
  metricCode: string | null;
  /** Process-local code when there is no canonical peer, else null. */
  localCode: string | null;
  /** What THIS process calls it — use for every label shown to a user. */
  displayName: string;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better" | null;
  displayOrder: number;
  weightage: number;
  isFatal: boolean;
  /** False for process-local metrics, which must stay out of cross-process aggregates. */
  comparableAcrossProcesses: boolean;
};

function toDefinition(row: RowDataPacket): ProcessMetricDefinition {
  const metricCode = (row.metric_code as string | null) ?? null;
  return {
    id: String(row.id),
    processId: String(row.process_id),
    metricCode,
    localCode: (row.local_code as string | null) ?? null,
    displayName: String(row.display_name),
    // A canonical metric's unit and direction live on kpi_metric_master; a
    // local one carries its own. Prefer the canonical values so a single edit
    // there stays authoritative.
    unit: (row.canonical_unit as string | null) ?? (row.unit as string | null) ?? null,
    direction:
      ((row.canonical_direction ?? row.direction) as ProcessMetricDefinition["direction"]) ?? null,
    displayOrder: Number(row.display_order ?? 100),
    weightage: Number(row.weightage ?? 100),
    isFatal: Boolean(row.is_fatal),
    comparableAcrossProcesses: metricCode !== null,
  };
}

/**
 * Definitions in force for a process on a given date.
 *
 * Effective-dated on purpose: renaming or retiring a parameter must not rewrite
 * what earlier periods were measured against, which is exactly the failure
 * kpi_master_config has today — it upserts in place, so changing a target
 * silently rewrites history.
 */
export async function getProcessMetricDefinitions(
  processId: string,
  asOf: string,
): Promise<ProcessMetricDefinition[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.process_id, d.local_code, d.display_name,
            d.unit, d.direction, d.display_order, d.weightage, d.is_fatal,
            m.metric_code                AS metric_code,
            m.unit                       AS canonical_unit,
            m.direction                  AS canonical_direction
       FROM process_metric_definition d
       LEFT JOIN kpi_metric_master m ON m.id = d.metric_id
      WHERE d.process_id = ?
        AND d.active_status = 1
        AND d.effective_from <= ?
        AND (d.effective_to IS NULL OR d.effective_to >= ?)
      ORDER BY d.display_order ASC, d.display_name ASC`,
    [processId, asOf, asOf],
  );
  return rows.map(toDefinition);
}

/**
 * Only the definitions that can legitimately be aggregated across processes.
 *
 * Used by org-wide and executive views. Filtering here rather than at each call
 * site means a new process-local parameter cannot quietly start contributing to
 * a company-wide average.
 */
export async function getComparableDefinitions(
  processId: string,
  asOf: string,
): Promise<ProcessMetricDefinition[]> {
  const all = await getProcessMetricDefinitions(processId, asOf);
  return all.filter((d) => d.comparableAcrossProcesses);
}
