import { createHash, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import { bpoPnlAllocationOverlayService } from "./bpo-pnl-allocation-overlay.service.js";
import { bpoPnlService, type BpoPnlRow } from "./bpo-pnl.service.js";
import { processLobService } from "./process-lob.service.js";
import { processPnlGovernanceService } from "./process-pnl.governance.service.js";
import { processPnlService } from "./process-pnl.service.js";
import type { PnlQueryFilters } from "./process-pnl.types.js";
import { cacheInstance as pnlSummaryCache } from "../../lib/cache/quality-cache.js";

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

/**
 * Revenue-at-risk, or an explanation of why there is no figure.
 *
 * `revenueAtRisk` sums `process_revenue_daily.revenue_at_risk` across the P&L rows (see
 * getRevenueDailyMap in process-pnl.service.ts). That table holds ZERO rows in production
 * and its only writer is a manual POST /api/business-command/revenue-risk/generate-daily
 * — nothing schedules it. Summing an empty set yields 0, so the CEO dashboard rendered a
 * confident "Revenue Gap MTD: Rs 0" for a pipeline that has never run once.
 *
 * Same judgement as the TAT Breached / Name Mismatch tiles removed from that dashboard on
 * 31-Jul-2026: a false zero on an executive dashboard is worse than a blank one. A zero is
 * reported only when the source actually returned rows saying zero.
 */
export function resolveRevenueAtRisk(
  total: number,
  sourceRowCount: number,
): { revenueAtRisk: number | null; revenueAtRiskUnavailable: string | null } {
  if (!(sourceRowCount > 0)) {
    return {
      revenueAtRisk: null,
      revenueAtRiskUnavailable:
        "Revenue at risk has not been generated for this period — process_revenue_daily "
        + "holds no rows. The feed is produced on demand by "
        + "POST /api/business-command/revenue-risk/generate-daily, not on a schedule.",
    };
  }
  return { revenueAtRisk: n(total), revenueAtRiskUnavailable: null };
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Exported so pnl-statement.service.ts can normalize a period the same way before calling
// getCachedAllocationSummary directly (bypassing getSummary()'s trend fan-out — see PERF FIX
// comment there, 2026-09-02). Behavior unchanged; only visibility widened.
export function normalizePeriod(value?: string) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : currentPeriod();
}

// bpoPnlAllocationOverlayService.getSummary() runs the full org-wide GRN/
// vendor-cost allocation engine — measured ~31-33s for a SINGLE period on a
// genuinely cold cache. getTrend() below calls it once per trend month (6 by
// default) and getSummary() calls it again directly for the current period
// (which getTrend's last month already recomputes, since
// shiftPeriod(period, 0) === period) — one dashboard load was triggering 7
// of these computations.
//
// Self-audit correction (see plan doc): the ~31-33s figure was originally
// attributed to "the allocation engine is just expensive" and left
// uninvestigated past that. It's actually dominated by
// process-pnl.service.ts's buildComputationContext(), which ran 10
// independent DB pulls sequentially — fixed there directly (parallelized,
// cold-call cost dropped to ~18.9s). That function already has its own
// cache (computationCache, 60s TTL, with in-flight-promise dedup) that this
// session's original fix here didn't know about when it shipped — this
// cache's TTL was 90s, exceeding that 60s window and silently serving data
// staler than the underlying system's own designed freshness guarantee.
// Aligned to 60s to match. This outer cache still has a real purpose on top
// of computationCache: it also covers the allocation-overlay math
// (buildAllocationMaps, the GRN/vendor-cost layer) that computationCache
// does not, and collapses getTrend's redundant current-period call.
//
// Deliberately NOT used by listProcesses/getPeriodClose/recalculate/
// lockPeriod below — recalculate() explicitly calls
// processPnlService.invalidateCaches() because it exists to force a fresh
// computation, and lockPeriod/getPeriodClose are governance actions that
// need authoritative, uncached data. Only getTrend/getSummary (the
// dashboard-display path) use this cache.
// OPEN QUESTION (not yet confirmed by finance/dashboard owner): 60s TTL was
// chosen to align with process-pnl.service.ts's own computationCache (also
// 60s), not from a stated staleness requirement. Unlike the general dashboard
// cache above, this fronts revenue/EBITDA/cost figures shown to CEO/finance
// roles — a wrong-but-cached number for up to 60s is a different risk than a
// slow-but-fresh one, and whether that's acceptable should be a stated
// decision, not an implicit one made when fixing an unrelated perf issue.
// Exported so bpo-pnl.routes.ts's /pnl/bpo/summary (Process Matrix) can share this exact cache
// instead of calling bpoPnlAllocationOverlayService.getSummary() directly and uncached — before
// this, the two front doors (this cached path, serving /pnl/summary and /pnl/period-close, vs
// the uncached one) could disagree for up to 60s even though both compute from the identical
// underlying rows. Return shape is unchanged (ReturnType<typeof bpoPnlAllocationOverlayService.
// getSummary>), so this is a pure caching change, not a response-shape change.
/**
 * How many revenue-risk rows exist for the period at all. Distinguishes "the risk engine
 * ran and found nothing" from "the risk engine has never run", which sum() cannot.
 */
async function countRevenueRiskRows(period: string): Promise<number> {
  if (!(await tableExists("process_revenue_daily"))) return 0;
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year!, month!, 0).getDate();
  const rows = await queryRows<RowDataPacket>(
    `SELECT COUNT(*) AS source_rows
       FROM process_revenue_daily
      WHERE revenue_date BETWEEN ? AND ?`,
    [`${period}-01`, `${period}-${String(lastDay).padStart(2, "0")}`],
  );
  return Number((rows[0] as { source_rows?: unknown } | undefined)?.source_rows ?? 0);
}

export async function getCachedAllocationSummary(filters: Partial<PnlQueryFilters>) {
  const key = `pnl-allocation-summary:v1:${filters.period ?? ""}:${filters.branchId ?? ""}:${filters.processId ?? ""}:${filters.clientId ?? ""}:${filters.search ?? ""}`;
  return pnlSummaryCache.getOrSet(
    key,
    () => bpoPnlAllocationOverlayService.getSummary(filters) as Promise<Record<string, unknown>>,
    60,
  ) as ReturnType<typeof bpoPnlAllocationOverlayService.getSummary>;
}

export function shiftPeriod(period: string, delta: number) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function snapshotHash(summary: unknown, rows: unknown[]) {
  return createHash("sha256")
    .update(JSON.stringify({ summary, rows }))
    .digest("hex");
}

function sum(rows: BpoPnlRow[], field: keyof BpoPnlRow) {
  return rows.reduce((total, row) => total + n(row[field]), 0);
}

function branchAllocationDrivers(rows: BpoPnlRow[]) {
  const grouped = new Map<string, {
    branchId: string | null;
    branchName: string;
    revenue: number;
    bmc: number;
    activeHc: number;
  }>();
  for (const row of rows) {
    const key = row.branchId ?? "unassigned";
    const current = grouped.get(key) ?? {
      branchId: row.branchId,
      branchName: row.branchName ?? "Unassigned branch",
      revenue: 0,
      bmc: 0,
      activeHc: 0,
    };
    current.revenue += row.recognizedRevenue;
    current.bmc += row.bmc;
    current.activeHc += row.activeHc;
    grouped.set(key, current);
  }
  const totalBmc = [...grouped.values()].reduce((total, row) => total + row.bmc, 0);
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      sharePct: totalBmc > 0 ? (row.bmc / totalBmc) * 100 : 0,
    }))
    .sort((left, right) => right.bmc - left.bmc);
}

async function lobEnabledProcessIds(period: string) {
  if (!(await tableExists("process_lob_master"))) return [] as string[];
  const [year, month] = period.split("-").map(Number);
  const end = `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const rows = await queryRows<RowDataPacket>(
    `SELECT process_id
       FROM process_lob_master
      WHERE active_status = 1
        AND approval_status = 'approved'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      GROUP BY process_id
     HAVING SUM(CASE WHEN lob_code <> 'DEFAULT' THEN 1 ELSE 0 END) > 0
         OR COUNT(*) > 1`,
    [end, `${period}-01`]
  );
  return rows.map((row) => String(row.process_id));
}

async function lobCloseChecks(period: string) {
  const processIds = await lobEnabledProcessIds(period);
  const diagnostics = await Promise.all(
    processIds.map((processId) => processLobService.getDiagnostics(processId, period))
  );
  return {
    processIds,
    diagnostics,
    blockers: diagnostics.flatMap((item) =>
      item.blockers.map((blocker) => ({ ...blocker, processId: item.processId }))
    ),
  };
}

function canonicalCloseView(base: any, summary: any, lobChecks: Awaited<ReturnType<typeof lobCloseChecks>>, snapshot?: any) {
  const rows = summary.rows as BpoPnlRow[];
  const strictClose = process.env.PNL_CLOSE_STRICT !== "false";
  const qualityBlockers: Array<{ code: string; message: string; processId?: string }> = [
    ...lobChecks.blockers,
  ];
  if (strictClose && n(summary.kpis.revenueModelCoveragePct) < 100) {
    qualityBlockers.push({
      code: "REVENUE_MODEL_COVERAGE_INCOMPLETE",
      message: `Approved revenue-rule coverage is ${n(summary.kpis.revenueModelCoveragePct).toFixed(1)}%, not 100%`,
    });
  }
  const criticalAlerts = (summary.alerts ?? []).filter((alert: any) => alert.type === "critical");
  if (strictClose && criticalAlerts.length) {
    qualityBlockers.push({
      code: "CRITICAL_PNL_ALERTS",
      message: `${criticalAlerts.length} critical P&L alert(s) remain unresolved`,
    });
  }
  const pendingAdjustments = (base.adjustments ?? []).filter(
    (item: any) => ["draft", "pending"].includes(String(item.approval_status ?? item.status ?? ""))
  );
  if (pendingAdjustments.length) {
    qualityBlockers.push({
      code: "PENDING_ADJUSTMENTS",
      message: `${pendingAdjustments.length} adjustment(s) are pending approval`,
    });
  }

  const availableActions = {
    ...base.availableActions,
    canLock: Boolean(base.availableActions?.canLock && qualityBlockers.length === 0),
  };
  return {
    ...base,
    calculationEngine: "bpo_allocation_v2",
    lockedSnapshot: snapshot
      ? {
          id: snapshot.id,
          version: Number(snapshot.snapshot_version),
          sourceHash: snapshot.source_hash,
          lockedAt: snapshot.locked_at,
          lockedBy: snapshot.locked_by,
        }
      : null,
    summary: summary.kpis,
    revenueMix: summary.revenueMix,
    costMix: summary.costMix,
    alertCounts: {
      critical: (summary.alerts ?? []).filter((item: any) => item.type === "critical").length,
      warning: (summary.alerts ?? []).filter((item: any) => item.type === "warning").length,
      info: (summary.alerts ?? []).filter((item: any) => item.type === "info").length,
    },
    topAlerts: (summary.alerts ?? []).slice(0, 8),
    processCounts: {
      total: rows.length,
      profitable: rows.filter((row) => row.processStatus === "profitable").length,
      atRisk: rows.filter((row) => row.processStatus === "at-risk").length,
      lossMaking: rows.filter((row) => row.processStatus === "loss-making").length,
      pendingReconciliation: rows.filter((row) => row.revenueDataStatus !== "configured").length,
    },
    lossMakingProcesses: rows
      .filter((row) => row.processStatus === "loss-making")
      .sort((left, right) => left.ebitda - right.ebitda)
      .slice(0, 10),
    allocationDrivers: branchAllocationDrivers(rows),
    qualityGates: {
      strictClose,
      lobEnabledProcesses: lobChecks.processIds.length,
      revenueModelCoveragePct: n(summary.kpis.revenueModelCoveragePct),
      blockerCount: qualityBlockers.length,
      blockers: qualityBlockers,
      passed: qualityBlockers.length === 0,
    },
    availableActions,
    rows,
    lastCalculatedAt: summary.generatedAt,
  };
}

async function latestSnapshot(periodCode: string) {
  if (!(await tableExists("pnl_period_snapshot"))) return null;
  const rows = await queryRows<RowDataPacket>(
    `SELECT s.*
       FROM pnl_period_snapshot s
      WHERE s.period_code = ? AND s.status = 'locked'
      ORDER BY s.snapshot_version DESC
      LIMIT 1`,
    [periodCode]
  );
  return rows[0] ?? null;
}

async function snapshotRows(snapshotId: string) {
  const rows = await queryRows<RowDataPacket>(
    `SELECT row_json
       FROM pnl_period_snapshot_row
      WHERE snapshot_id = ? AND row_type = 'process'
      ORDER BY process_id`,
    [snapshotId]
  );
  return rows.map((row) => parseJson<BpoPnlRow>(row.row_json));
}

export const canonicalPnlService = {
  async getTrend(filters: Partial<PnlQueryFilters>, months = 6) {
    const period = normalizePeriod(filters.period);
    const periodCodes = Array.from({ length: Math.max(1, Math.min(12, months)) }, (_, index) =>
      shiftPeriod(period, index - (Math.max(1, Math.min(12, months)) - 1))
    );
    const summaries = await Promise.all(
      periodCodes.map((item) =>
        getCachedAllocationSummary({ ...filters, period: item })
      )
    );
    return summaries.map((summary) => ({
      month: summary.period,
      revenue: n(summary.kpis.recognizedRevenue),
      directCost: n(summary.kpis.agentSalary) + n(summary.kpis.dsc),
      indirectCost: n(summary.kpis.bmc),
      operatingProfit: n(summary.kpis.operatingProfit),
      ebitda: n(summary.kpis.ebitda),
      pbt: n(summary.kpis.pbt),
      pat: n(summary.kpis.pat),
    }));
  },

  async getSummary(filters: Partial<PnlQueryFilters>) {
    const period = normalizePeriod(filters.period);
    const [summary, trend, revenueRiskRows] = await Promise.all([
      getCachedAllocationSummary({ ...filters, period }),
      this.getTrend({ ...filters, period }),
      countRevenueRiskRows(period),
    ]);
    const rows = summary.rows as BpoPnlRow[];
    const mostProfitable = [...rows].sort((left, right) => right.ebitda - left.ebitda)[0];
    return {
      ...summary,
      calculationEngine: "bpo_allocation_v2",
      kpis: {
        ...summary.kpis,
        organisationRevenue: n(summary.kpis.recognizedRevenue),
        totalDirectCost: n(summary.kpis.agentSalary) + n(summary.kpis.dsc),
        totalIndirectCost: n(summary.kpis.bmc),
        operatingMarginPct: summary.kpis.operatingProfitPct,
        mostProfitableProcess: mostProfitable
          ? {
              processId: mostProfitable.processId,
              processName: mostProfitable.processName,
              value: mostProfitable.ebitda,
            }
          : null,
        ...resolveRevenueAtRisk(sum(rows, "revenueAtRisk"), revenueRiskRows),
        receivableRisk: sum(rows, "outstandingReceivable"),
        monthEndProjectedProfit: n(summary.kpis.ebitda),
        billableHeadcount: sum(rows, "billableHc"),
        activeHeadcount: sum(rows, "activeHc"),
      },
      trend,
    };
  },

  async listProcesses(filters: Partial<PnlQueryFilters>) {
    const summary = await bpoPnlAllocationOverlayService.getSummary({
      ...filters,
      period: normalizePeriod(filters.period),
    });
    return summary.rows;
  },

  async getProcessDetail(processId: string, filters: Partial<PnlQueryFilters>) {
    return bpoPnlAllocationOverlayService.getProcessDetail(processId, {
      ...filters,
      period: normalizePeriod(filters.period),
    });
  },

  async getProcessTrend(processId: string, filters: Partial<PnlQueryFilters>) {
    const trend = await this.getTrend({ ...filters, processId });
    return { processId, trend, calculationEngine: "bpo_allocation_v2" };
  },

  async exportCsv(filters: Partial<PnlQueryFilters>) {
    return bpoPnlAllocationOverlayService.exportCsv({
      ...filters,
      period: normalizePeriod(filters.period),
    });
  },

  async getPeriodClose(periodCode?: string, userRoles?: string[], fallbackRole?: string) {
    const period = normalizePeriod(periodCode);
    const base = await processPnlGovernanceService.getPeriodClose(period, userRoles, fallbackRole);
    const snapshot = await latestSnapshot(period);
    if (snapshot && String(base.period?.status ?? "") === "locked") {
      const storedSummary = parseJson<any>(snapshot.summary_json);
      const rows = await snapshotRows(String(snapshot.id));
      return canonicalCloseView(
        base,
        { ...storedSummary, rows },
        { processIds: [], diagnostics: [], blockers: [] },
        snapshot
      );
    }
    const [summary, lobChecks] = await Promise.all([
      bpoPnlAllocationOverlayService.getSummary({ period }),
      lobCloseChecks(period),
    ]);
    return canonicalCloseView(base, summary, lobChecks);
  },

  async recalculate(periodCode?: string) {
    const period = normalizePeriod(periodCode);
    const rows = await queryRows<RowDataPacket>(
      "SELECT status FROM finance_period WHERE period_code = ? LIMIT 1",
      [period]
    );
    if (String(rows[0]?.status ?? "") === "locked") {
      throw Object.assign(new Error("Locked period cannot be recalculated"), { statusCode: 400 });
    }
    processPnlService.invalidateCaches();
    bpoPnlService.invalidateCaches();
    const summary = await this.getSummary({ period });
    return {
      period,
      calculationEngine: "bpo_allocation_v2",
      generatedAt: summary.generatedAt,
      processCount: summary.rows.length,
      revenue: summary.kpis.recognizedRevenue,
      ebitda: summary.kpis.ebitda,
      operatingProfit: summary.kpis.operatingProfit,
      alertCount: summary.alerts.length,
    };
  },

  async lockPeriod(periodId: string, actorUserId: string) {
    if (!(await tableExists("pnl_period_snapshot")) || !(await tableExists("pnl_period_snapshot_row"))) {
      throw Object.assign(new Error("P&L snapshot tables are missing. Run migration 421 first."), { statusCode: 503 });
    }
    const periodRows = await queryRows<RowDataPacket>(
      "SELECT id, period_code, status FROM finance_period WHERE id = ? LIMIT 1",
      [periodId]
    );
    const periodRow = periodRows[0];
    if (!periodRow) throw Object.assign(new Error("Finance period not found"), { statusCode: 404 });
    const period = String(periodRow.period_code);
    if (String(periodRow.status) === "locked") {
      const snapshot = await latestSnapshot(period);
      return { success: true, alreadyLocked: true, snapshotId: snapshot?.id ?? null };
    }

    const base = await processPnlGovernanceService.getPeriodClose(period, [], "super_admin");
    const [summary, lobChecks] = await Promise.all([
      bpoPnlAllocationOverlayService.getSummary({ period }),
      lobCloseChecks(period),
    ]);
    const closeView = canonicalCloseView(base, summary, lobChecks);
    if (!closeView.availableActions.canLock || !closeView.qualityGates.passed) {
      throw Object.assign(
        new Error(`Period cannot be locked: ${closeView.qualityGates.blockers.map((item: any) => item.message).join(" | ") || "required signoffs are incomplete"}`),
        { statusCode: 400, blockers: closeView.qualityGates.blockers }
      );
    }

    const lobRows: any[] = [];
    for (const processId of lobChecks.processIds) {
      const lobSummary = await processLobService.getProcessSummary(processId, period);
      if (!lobSummary.reconciliation.isReconciled) {
        throw Object.assign(new Error(`LOB P&L does not reconcile for process ${processId}`), {
          statusCode: 400,
          reconciliation: lobSummary.reconciliation,
        });
      }
      lobRows.push(...lobSummary.rows);
    }

    const summaryForSnapshot = {
      period: summary.period,
      filters: summary.filters,
      kpis: summary.kpis,
      revenueMix: summary.revenueMix,
      costMix: summary.costMix,
      alerts: summary.alerts,
      generatedAt: summary.generatedAt,
      calculationEngine: "bpo_allocation_v2",
    };
    const sourceHash = snapshotHash(summaryForSnapshot, [...summary.rows, ...lobRows]);
    const connection = await db.getConnection();
    let snapshotId = "";
    try {
      await connection.beginTransaction();
      const [lockedPeriods] = await connection.execute<RowDataPacket[]>(
        "SELECT id, status FROM finance_period WHERE id = ? FOR UPDATE",
        [periodId]
      );
      if (!lockedPeriods[0]) throw new Error("Finance period not found");
      if (String(lockedPeriods[0].status) === "locked") {
        await connection.rollback();
        const snapshot = await latestSnapshot(period);
        return { success: true, alreadyLocked: true, snapshotId: snapshot?.id ?? null };
      }
      const [signedRows] = await connection.execute<RowDataPacket[]>(
        `SELECT signoff_role
           FROM pnl_period_signoff
          WHERE finance_period_id = ? AND status = 'signed'
          FOR UPDATE`,
        [periodId]
      );
      const signed = new Set(signedRows.map((row) => String(row.signoff_role)));
      const required = ["finance_preparer", "finance_head", "accounts_head", "ceo"];
      if (!required.every((role) => signed.has(role))) {
        throw new Error("Finance Preparer, Finance Head, Accounts Head and CEO signoffs are required before locking");
      }
      const [pendingAdjustments] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) count
           FROM pnl_adjustment_journal
          WHERE period_code = ? AND approval_status IN ('draft','pending')`,
        [period]
      );
      if (n(pendingAdjustments[0]?.count) > 0) {
        throw new Error("Pending P&L adjustments must be approved or rejected before locking");
      }
      const [versionRows] = await connection.execute<RowDataPacket[]>(
        "SELECT COALESCE(MAX(snapshot_version),0) + 1 next_version FROM pnl_period_snapshot WHERE finance_period_id = ? FOR UPDATE",
        [periodId]
      );
      const version = n(versionRows[0]?.next_version) || 1;
      snapshotId = randomUUID();
      await connection.execute(
        `INSERT INTO pnl_period_snapshot
          (id, finance_period_id, period_code, snapshot_version, calculation_engine,
           source_hash, summary_json, status, locked_by, locked_at)
         VALUES (?, ?, ?, ?, 'bpo_allocation_v2', ?, ?, 'locked', ?, NOW())`,
        [snapshotId, periodId, period, version, sourceHash, JSON.stringify(summaryForSnapshot), actorUserId]
      );
      for (const row of summary.rows as BpoPnlRow[]) {
        await connection.execute(
          `INSERT INTO pnl_period_snapshot_row
            (id, snapshot_id, branch_id, client_id, process_id, process_lob_id, row_type, row_json)
           VALUES (?, ?, ?, ?, ?, NULL, 'process', ?)`,
          [randomUUID(), snapshotId, row.branchId, row.clientId, row.processId, JSON.stringify(row)]
        );
      }
      for (const row of lobRows) {
        await connection.execute(
          `INSERT INTO pnl_period_snapshot_row
            (id, snapshot_id, branch_id, client_id, process_id, process_lob_id, row_type, row_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            snapshotId,
            row.branchId ?? null,
            row.clientId ?? null,
            row.processId,
            row.processLobId ?? null,
            row.rowType === "unallocated" ? "unallocated" : "lob",
            JSON.stringify(row),
          ]
        );
      }
      await connection.execute(
        `UPDATE finance_period
            SET status = 'locked', locked_at = NOW(), locked_by = ?
          WHERE id = ? AND status <> 'locked'`,
        [actorUserId, periodId]
      );
      await connection.commit();
      return { success: true, snapshotId, sourceHash, calculationEngine: "bpo_allocation_v2" };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
