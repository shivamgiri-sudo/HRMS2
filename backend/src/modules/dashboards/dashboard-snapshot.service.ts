import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

import { logSourceFailure } from "../../shared/apiResponse.js";
import type { DashboardScope } from "../../shared/dashboardScope.js";
import { executeMetricByCode, getAllMetricCodes } from "./dashboard-definition.service.js";

/**
 * Writes dashboard_metric_snapshot, the table every trend arrow reads from.
 *
 * The table has never been written to. getMetricTrend consequently returns
 * `previousValue: null` for every metric on every dashboard, which is why no tile has ever
 * shown a period-on-period comparison. Seeding the catalog does not fix that on its own —
 * a trend needs history, and history only exists if something records it.
 *
 * Snapshots are stored under the same keys getMetricTrend reads:
 *   BRANCH  + branch_id   when the viewer's scope names a branch
 *   PROCESS + process_id  when it names a process
 *   ORG     + NULL        otherwise
 *
 * That mapping mirrors wrapEnriched, which passes scope.branchIds[0] / scope.processIds[0]
 * to enrichMetric. A snapshot written under any other key would be invisible to the reader.
 */

export type SnapshotScopeKind = "ORG" | "BRANCH" | "PROCESS";

export type SnapshotTarget = {
  scopeType: SnapshotScopeKind;
  scopeId: string | null;
  /** For logging only. */
  label: string;
  scope: DashboardScope;
};

export type SnapshotRunResult = {
  snapshotDate: string;
  targets: number;
  written: number;
  skippedNoValue: number;
  failed: number;
  failures: Array<{ metricCode: string; scope: string; reason: string }>;
};

/** Today in the database's own timezone, so snapshot_date matches CURDATE() comparisons. */
async function databaseToday(): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT CURDATE() AS d");
  return String((rows as RowDataPacket[])[0]?.d ?? "").slice(0, 10);
}

function orgScope(): DashboardScope {
  return {
    level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [],
    userId: "snapshot-writer", role: "super_admin",
  };
}

/**
 * The scopes worth recording: org-wide, every active branch that has staff, and every
 * active process that has staff.
 *
 * Empty branches and processes are excluded deliberately. A snapshot of a metric over zero
 * employees records a real 0, and next month that 0 becomes the baseline a genuine value is
 * compared against — manufacturing a "+100%" trend out of an org unit that never existed.
 */
export async function resolveSnapshotTargets(
  kinds: readonly SnapshotScopeKind[] = ["ORG", "BRANCH", "PROCESS"],
): Promise<SnapshotTarget[]> {
  const targets: SnapshotTarget[] = [];

  if (kinds.includes("ORG")) {
    targets.push({ scopeType: "ORG", scopeId: null, label: "ORG", scope: orgScope() });
  }

  if (kinds.includes("BRANCH")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.id, b.branch_name
         FROM branch_master b
        WHERE b.active_status = 1
          AND EXISTS (SELECT 1 FROM employees e
                       WHERE e.branch_id = b.id AND e.active_status = 1)
        ORDER BY b.branch_name`,
    );
    for (const row of rows as RowDataPacket[]) {
      targets.push({
        scopeType: "BRANCH",
        scopeId: String(row.id),
        label: `BRANCH ${row.branch_name}`,
        scope: {
          level: "BRANCH_ALL", branchIds: [String(row.id)], processIds: [], employeeIds: [],
          userId: "snapshot-writer", role: "branch_head",
        },
      });
    }
  }

  if (kinds.includes("PROCESS")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.id, p.process_name
         FROM process_master p
        WHERE p.active_status = 1
          AND EXISTS (SELECT 1 FROM employees e
                       WHERE e.process_id = p.id AND e.active_status = 1)
        ORDER BY p.process_name`,
    );
    for (const row of rows as RowDataPacket[]) {
      targets.push({
        scopeType: "PROCESS",
        scopeId: String(row.id),
        label: `PROCESS ${row.process_name}`,
        scope: {
          level: "PROCESS_ALL", branchIds: [], processIds: [String(row.id)], employeeIds: [],
          userId: "snapshot-writer", role: "process_manager",
        },
      });
    }
  }

  return targets;
}

/**
 * Most recent earlier snapshot for the same metric and scope, used to stamp previous_value
 * and trend at write time.
 *
 * Strictly earlier than today, so re-running the writer on the same day compares against
 * yesterday rather than against the row it is about to replace — which would otherwise
 * report every metric as perfectly stable.
 */
async function previousSnapshot(
  metricCode: string,
  scopeType: SnapshotScopeKind,
  scopeId: string | null,
  snapshotDate: string,
): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT value FROM dashboard_metric_snapshot
      WHERE metric_code = ? AND scope_type = ?
        AND ${scopeId === null ? "scope_id IS NULL" : "scope_id = ?"}
        AND snapshot_date < ?
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    scopeId === null ? [metricCode, scopeType, snapshotDate] : [metricCode, scopeType, scopeId, snapshotDate],
  );
  const raw = (rows as RowDataPacket[])[0]?.value;
  if (raw === undefined || raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function trendFrom(current: number, previous: number | null): "up" | "down" | "stable" | null {
  if (previous === null || previous === 0) return null;
  const changePct = ((current - previous) / Math.abs(previous)) * 100;
  // Same 0.5% deadband getMetricTrend applies, so a stored trend and a computed one agree.
  return changePct > 0.5 ? "up" : changePct < -0.5 ? "down" : "stable";
}

/**
 * Computes and stores one day's snapshot for every metric across the requested scopes.
 *
 * A metric that cannot be computed for a scope is recorded as a failure and skipped — never
 * written as 0. Writing 0 for a broken query would look identical to a genuine zero and
 * would poison the next day's comparison.
 */
export async function writeDashboardSnapshots(options: {
  kinds?: readonly SnapshotScopeKind[];
  metricCodes?: readonly string[];
  onProgress?: (done: number, total: number, label: string) => void;
} = {}): Promise<SnapshotRunResult> {
  const snapshotDate = await databaseToday();
  const targets = await resolveSnapshotTargets(options.kinds);
  const metricCodes = options.metricCodes?.length
    ? getAllMetricCodes().filter((code) => options.metricCodes!.includes(code))
    : getAllMetricCodes();

  const result: SnapshotRunResult = {
    snapshotDate, targets: targets.length, written: 0, skippedNoValue: 0, failed: 0, failures: [],
  };

  const total = targets.length * metricCodes.length;
  let done = 0;

  for (const target of targets) {
    for (const metricCode of metricCodes) {
      done += 1;
      options.onProgress?.(done, total, `${target.label} / ${metricCode}`);
      try {
        const metric = await executeMetricByCode(metricCode, target.scope);
        const value = metric?.value;
        if (value === null || value === undefined || !Number.isFinite(Number(value))) {
          // No value is a legitimate outcome (empty source, or a failed query already
          // reported through errorCode). Either way there is nothing truthful to store.
          result.skippedNoValue += 1;
          continue;
        }
        const numeric = Number(value);
        const previous = await previousSnapshot(metricCode, target.scopeType, target.scopeId, snapshotDate);

        // scope_id NULL does not participate in the unique key (MySQL treats NULLs as
        // distinct), so ORG rows are replaced explicitly.
        if (target.scopeId === null) {
          await db.execute(
            `DELETE FROM dashboard_metric_snapshot
              WHERE metric_code = ? AND scope_type = 'ORG' AND scope_id IS NULL AND snapshot_date = ?`,
            [metricCode, snapshotDate],
          );
        }

        await db.execute(
          `INSERT INTO dashboard_metric_snapshot
             (id, metric_code, scope_type, scope_id, snapshot_date, value, previous_value, trend)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             value          = VALUES(value),
             previous_value = VALUES(previous_value),
             trend          = VALUES(trend),
             computed_at    = CURRENT_TIMESTAMP`,
          [metricCode, target.scopeType, target.scopeId, snapshotDate, numeric, previous, trendFrom(numeric, previous)],
        );
        result.written += 1;
      } catch (err) {
        result.failed += 1;
        result.failures.push({
          metricCode, scope: target.label, reason: (err as Error).message.slice(0, 160),
        });
        logSourceFailure("dashboard-snapshot", err, { metricCode, scope: target.label });
      }
    }
  }

  return result;
}
