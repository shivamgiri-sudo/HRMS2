import type { RowDataPacket } from "mysql2";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import type { PnlQueryFilters } from "./process-pnl.types.js";
import { bpoPnlService, type BpoPnlRow } from "./bpo-pnl.service.js";

type BpoPnlSummary = Awaited<ReturnType<typeof bpoPnlService.getSummary>>;

type AllocationDriver =
  | "direct"
  | "active_hc"
  | "billable_hc"
  | "contracted_seats"
  | "revenue"
  | "floor_area"
  | "device_count"
  | "equal"
  | "manual";

type SupportedPnlBucket =
  | "dsc_non_people"
  | "bmc_non_people"
  | "depreciation"
  | "amortization"
  | "finance_cost"
  | "tax"
  | "capex"
  | "excluded";

interface AllocationViewRow extends RowDataPacket {
  process_id: string | null;
  branch_id: string | null;
  period_code: string;
  pnl_bucket: SupportedPnlBucket | string;
  pnl_cost_amount: number;
  allocation_count: number;
  freshness: string | null;
}

interface LegacyAttributionRow extends RowDataPacket {
  process_id: string | null;
  branch_id: string | null;
  cost_class: "direct" | "indirect" | string;
  amount: number;
}

interface AllocationPolicyRow extends RowDataPacket {
  branch_id: string;
  process_id: string | null;
  pool_type: string;
  allocation_driver: AllocationDriver;
  manual_allocation_pct: number | null;
}

interface BucketAmounts {
  dscNonPeople: number;
  bmcNonPeople: number;
  depreciation: number;
  amortization: number;
  financeCost: number;
  tax: number;
  excluded: number;
}

interface LegacyAmounts {
  direct: number;
  bmc: number;
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

const emptyBuckets = (): BucketAmounts => ({
  dscNonPeople: 0,
  bmcNonPeople: 0,
  depreciation: 0,
  amortization: 0,
  financeCost: 0,
  tax: 0,
  excluded: 0,
});

const emptyLegacy = (): LegacyAmounts => ({ direct: 0, bmc: 0 });

function addBucket(target: BucketAmounts, bucket: string, amount: number) {
  switch (bucket) {
    case "dsc_non_people": target.dscNonPeople += amount; break;
    case "bmc_non_people": target.bmcNonPeople += amount; break;
    case "depreciation": target.depreciation += amount; break;
    case "amortization": target.amortization += amount; break;
    case "finance_cost": target.financeCost += amount; break;
    case "tax": target.tax += amount; break;
    case "capex":
    case "excluded": target.excluded += amount; break;
    default: target.bmcNonPeople += amount; break;
  }
}

function driverValue(row: BpoPnlRow, driver: AllocationDriver) {
  switch (driver) {
    case "billable_hc": return n(row.billableHc);
    case "contracted_seats": return n(row.contractedSeats);
    case "revenue": return n(row.recognizedRevenue);
    case "equal": return 1;
    case "active_hc":
    default: return n(row.activeHc);
  }
}

function findPolicy(
  policies: AllocationPolicyRow[],
  branchId: string,
  poolType: string,
  processId?: string
) {
  return policies.find((policy) =>
    String(policy.branch_id) === branchId
    && policy.pool_type === poolType
    && (processId ? String(policy.process_id ?? "") === processId : !policy.process_id)
  );
}

function allocateBranchPool(
  rows: BpoPnlRow[],
  branchId: string,
  poolType: string,
  amount: number,
  policies: AllocationPolicyRow[]
) {
  const branchRows = rows.filter((row) => row.branchId === branchId);
  const result = new Map<string, number>();
  if (branchRows.length === 0 || amount === 0) return result;

  const processPolicies = branchRows.map((row) => findPolicy(policies, branchId, poolType, row.processId));
  const hasManual = processPolicies.some((policy) => policy?.allocation_driver === "manual");
  if (hasManual) {
    branchRows.forEach((row, index) => {
      result.set(row.processId, amount * (n(processPolicies[index]?.manual_allocation_pct) / 100));
    });
    return result;
  }

  const branchPolicy = findPolicy(policies, branchId, poolType);
  const driver = branchPolicy?.allocation_driver ?? "active_hc";
  const values = branchRows.map((row) => driverValue(row, driver));
  const total = values.reduce((sum, value) => sum + value, 0);
  branchRows.forEach((row, index) => {
    result.set(row.processId, total > 0 ? amount * (values[index] / total) : amount / branchRows.length);
  });
  return result;
}

async function allocationPolicies(period: string) {
  if (!(await tableExists("pnl_allocation_policy"))) return [] as AllocationPolicyRow[];
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const start = `${period}-01`;
  const end = `${period}-${String(lastDay).padStart(2, "0")}`;
  return queryRows<AllocationPolicyRow>(
    `SELECT branch_id, process_id, pool_type, allocation_driver, manual_allocation_pct
       FROM pnl_allocation_policy
      WHERE status = 'approved'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY branch_id, pool_type, process_id`,
    [end, start]
  ).catch(() => []);
}

async function newAllocationRows(period: string) {
  return queryRows<AllocationViewRow>(
    `SELECT process_id, branch_id, period_code, pnl_bucket,
            pnl_cost_amount, allocation_count, freshness
       FROM vw_process_pnl_grn_allocation
      WHERE period_code = ?`,
    [period]
  ).catch(() => []);
}

async function legacyAllocatedGrnRows(period: string) {
  const vendorRows = await queryRows<LegacyAttributionRow>(
    `SELECT
        COALESCE(vpt.process_id, ccm.process_id) AS process_id,
        vpt.branch_id,
        COALESCE(vpt.cost_class,
          CASE WHEN COALESCE(vpt.process_id, ccm.process_id) IS NOT NULL THEN 'direct' ELSE 'indirect' END
        ) AS cost_class,
        SUM(COALESCE(vpt.pnl_cost_amount, vpt.due_amount, 0)) AS amount
       FROM vendor_payment_tracking vpt
       JOIN grn_request g ON g.id = vpt.grn_request_id
       JOIN (
         SELECT grn_request_id
           FROM grn_cost_allocation
          WHERE lifecycle_status = 'consumed'
          GROUP BY grn_request_id
       ) allocated ON allocated.grn_request_id = g.id
       LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
      WHERE COALESCE(
              vpt.recognition_period,
              DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')
            ) = ?
        AND LOWER(REPLACE(COALESCE(vpt.payment_status, ''), '_', ' ')) IN (
          'payment pending','pending','approved','posted','scheduled','payment scheduled',
          'partially paid','paid','closed'
        )
      GROUP BY process_id, vpt.branch_id, cost_class`,
    [period]
  ).catch(() => []);

  const grnRows = await queryRows<LegacyAttributionRow>(
    `SELECT
        COALESCE(g.process_id, ccm.process_id) AS process_id,
        g.branch_id,
        COALESCE(g.cost_class,
          CASE WHEN COALESCE(g.process_id, ccm.process_id) IS NOT NULL THEN 'direct' ELSE 'indirect' END
        ) AS cost_class,
        SUM(COALESCE(g.pnl_cost_amount, g.amount, 0)) AS amount
       FROM grn_request g
       JOIN (
         SELECT grn_request_id
           FROM grn_cost_allocation
          WHERE lifecycle_status = 'consumed'
          GROUP BY grn_request_id
       ) allocated ON allocated.grn_request_id = g.id
       LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
       LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
      WHERE vpt.id IS NULL
        AND COALESCE(
              g.recognition_period,
              DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m')
            ) = ?
        AND LOWER(REPLACE(COALESCE(g.status, ''), '_', ' ')) IN (
          'approved','finance head approved','pending accounts payment','payment scheduled',
          'partially paid','paid','posted'
        )
      GROUP BY process_id, g.branch_id, cost_class`,
    [period]
  ).catch(() => []);

  return [...vendorRows, ...grnRows];
}

async function buildAllocationMaps(rows: BpoPnlRow[], period: string) {
  const [allocations, legacyRows, policies] = await Promise.all([
    newAllocationRows(period),
    legacyAllocatedGrnRows(period),
    allocationPolicies(period),
  ]);
  const bucketsByProcess = new Map<string, BucketAmounts>();
  const legacyByProcess = new Map<string, LegacyAmounts>();
  const branchBucketPools = new Map<string, number>();
  const legacyBranchPools = new Map<string, number>();
  let latestFreshness: string | null = null;

  for (const allocation of allocations) {
    const amount = n(allocation.pnl_cost_amount);
    latestFreshness = [latestFreshness, allocation.freshness]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    if (allocation.process_id) {
      const current = bucketsByProcess.get(String(allocation.process_id)) ?? emptyBuckets();
      addBucket(current, String(allocation.pnl_bucket), amount);
      bucketsByProcess.set(String(allocation.process_id), current);
    } else if (allocation.branch_id) {
      const key = `${allocation.branch_id}|${allocation.pnl_bucket}`;
      branchBucketPools.set(key, (branchBucketPools.get(key) ?? 0) + amount);
    }
  }

  for (const legacy of legacyRows) {
    const amount = n(legacy.amount);
    if (legacy.process_id && String(legacy.cost_class) === "direct") {
      const current = legacyByProcess.get(String(legacy.process_id)) ?? emptyLegacy();
      current.direct += amount;
      legacyByProcess.set(String(legacy.process_id), current);
    } else if (legacy.branch_id && String(legacy.cost_class) === "indirect") {
      const key = String(legacy.branch_id);
      legacyBranchPools.set(key, (legacyBranchPools.get(key) ?? 0) + amount);
    }
  }

  for (const [key, amount] of branchBucketPools.entries()) {
    const separator = key.indexOf("|");
    const branchId = key.slice(0, separator);
    const bucket = key.slice(separator + 1);
    const poolType = bucket === "bmc_non_people" ? "bmc_non_people" : "shared_service";
    for (const [processId, allocated] of allocateBranchPool(rows, branchId, poolType, amount, policies)) {
      const current = bucketsByProcess.get(processId) ?? emptyBuckets();
      addBucket(current, bucket, allocated);
      bucketsByProcess.set(processId, current);
    }
  }

  for (const [branchId, amount] of legacyBranchPools.entries()) {
    for (const [processId, allocated] of allocateBranchPool(rows, branchId, "bmc_non_people", amount, policies)) {
      const current = legacyByProcess.get(processId) ?? emptyLegacy();
      current.bmc += allocated;
      legacyByProcess.set(processId, current);
    }
  }

  return { bucketsByProcess, legacyByProcess, latestFreshness, allocationCount: allocations.length };
}

function adjustedRow(
  row: BpoPnlRow,
  buckets: BucketAmounts,
  legacy: LegacyAmounts,
  freshness: string | null
): BpoPnlRow {
  const dscNonPeople = row.dscNonPeople - legacy.direct + buckets.dscNonPeople;
  const bmcNonPeople = row.bmcNonPeople - legacy.bmc + buckets.bmcNonPeople;
  const dsc = row.dscPeople + dscNonPeople;
  const bmc = row.bmcPeople + bmcNonPeople;
  const originalCoreCost = row.agentSalary + row.dsc + row.bmc;
  const otherOperatingNet = row.totalOperatingCost - originalCoreCost;
  const directServiceCost = row.agentSalary + dsc;
  const totalOperatingCost = row.agentSalary + dsc + bmc + otherOperatingNet;
  const contribution = row.recognizedRevenue - directServiceCost;
  const ebitda = row.recognizedRevenue - totalOperatingCost;
  const depreciation = row.depreciation + buckets.depreciation;
  const amortization = row.amortization + buckets.amortization;
  const ebit = ebitda - depreciation - amortization;
  const financeCost = row.financeCost + buckets.financeCost;
  const existingBelowEbitExFinance = row.pbt - (row.ebit - row.financeCost);
  const pbt = ebit - financeCost + existingBelowEbitExFinance;
  const tax = row.tax + buckets.tax;
  const pat = pbt - tax;
  const includedNewGrn = buckets.dscNonPeople + buckets.bmcNonPeople
    + buckets.depreciation + buckets.amortization + buckets.financeCost + buckets.tax;
  const removedLegacyGrn = legacy.direct + legacy.bmc;
  const grnVendorActual = row.grnVendorActual - removedLegacyGrn + includedNewGrn;
  const processStatus: BpoPnlRow["processStatus"] = ebitda < 0
    ? "loss-making"
    : row.recognizedRevenue <= 0 || row.revenueAtRisk > 0 || (row.deliveryAttainmentPct != null && row.deliveryAttainmentPct < 90)
    ? "at-risk"
    : "profitable";

  return {
    ...row,
    dscNonPeople,
    dsc,
    dscPctRevenue: pct(dsc, row.recognizedRevenue),
    bmcNonPeople,
    bmc,
    bmcPctRevenue: pct(bmc, row.recognizedRevenue),
    grnVendorActual,
    contribution,
    contributionMarginPct: pct(contribution, row.recognizedRevenue),
    ebitda,
    ebitdaMarginPct: pct(ebitda, row.recognizedRevenue),
    depreciation,
    amortization,
    ebit,
    operatingProfit: ebit,
    operatingProfitPct: pct(ebit, row.recognizedRevenue),
    financeCost,
    pbt,
    tax,
    pat,
    totalOperatingCost,
    totalCostPctRevenue: pct(totalOperatingCost + depreciation + amortization, row.recognizedRevenue),
    loadedCostPerBillableSeat: n(row.billableHc) > 0 ? totalOperatingCost / n(row.billableHc) : null,
    ebitdaVariance: row.ebitdaBudget == null ? null : ebitda - row.ebitdaBudget,
    processStatus,
    freshness: [row.freshness, freshness].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
  };
}

function sum(rows: BpoPnlRow[], field: keyof BpoPnlRow) {
  return rows.reduce((total, row) => total + n(row[field]), 0);
}

function applySummaryTotals(summary: BpoPnlSummary, rows: BpoPnlRow[]): BpoPnlSummary {
  const revenue = sum(rows, "recognizedRevenue");
  const ebitda = sum(rows, "ebitda");
  const operatingProfit = sum(rows, "operatingProfit");
  const alerts: BpoPnlSummary["alerts"] = summary.alerts.filter((alert) => alert.code !== "NEGATIVE_EBITDA");
  for (const row of rows.filter((item) => item.ebitda < 0)) {
    alerts.push({
      type: "critical",
      code: "NEGATIVE_EBITDA",
      title: "Negative EBITDA",
      detail: `${row.processName} is EBITDA negative after allocation-level GRN attribution.`,
      processId: row.processId,
      processName: row.processName,
      impact: Math.abs(row.ebitda),
    });
  }

  return {
    ...summary,
    kpis: {
      ...summary.kpis,
      agentSalary: sum(rows, "agentSalary"),
      agentSalaryPctRevenue: pct(sum(rows, "agentSalary"), revenue),
      dsc: sum(rows, "dsc"),
      dscPctRevenue: pct(sum(rows, "dsc"), revenue),
      bmc: sum(rows, "bmc"),
      bmcPctRevenue: pct(sum(rows, "bmc"), revenue),
      grnVendorActual: sum(rows, "grnVendorActual"),
      totalPeopleCost: sum(rows, "totalPeopleCost"),
      peopleCostPctRevenue: pct(sum(rows, "totalPeopleCost"), revenue),
      contribution: sum(rows, "contribution"),
      ebitda,
      ebitdaMarginPct: pct(ebitda, revenue),
      operatingProfit,
      operatingProfitPct: pct(operatingProfit, revenue),
      pbt: sum(rows, "pbt"),
      pat: sum(rows, "pat"),
      lossMakingProcesses: rows.filter((row) => row.processStatus === "loss-making").length,
    },
    costMix: {
      ...summary.costMix,
      dscNonPeople: sum(rows, "dscNonPeople"),
      bmcNonPeople: sum(rows, "bmcNonPeople"),
      depreciation: sum(rows, "depreciation"),
      amortization: sum(rows, "amortization"),
      financeCost: sum(rows, "financeCost"),
      tax: sum(rows, "tax"),
    },
    alerts,
    rows,
  };
}

export const bpoPnlAllocationOverlayService = {
  async getSummary(filters: Partial<PnlQueryFilters>) {
    const summary = await bpoPnlService.getSummary(filters);
    if (!(await tableExists("grn_cost_allocation"))) return summary;
    const maps = await buildAllocationMaps(summary.rows, summary.period);
    if (maps.allocationCount === 0) return summary;
    const rows = summary.rows.map((row) => adjustedRow(
      row,
      maps.bucketsByProcess.get(row.processId) ?? emptyBuckets(),
      maps.legacyByProcess.get(row.processId) ?? emptyLegacy(),
      maps.latestFreshness
    ));
    return applySummaryTotals(summary, rows);
  },

  async getProcessDetail(processId: string, filters: Partial<PnlQueryFilters>) {
    const [detail, summary] = await Promise.all([
      bpoPnlService.getProcessDetail(processId, filters),
      this.getSummary({ ...filters, processId }),
    ]);
    const row = summary.rows.find((item) => item.processId === processId) ?? detail.row;
    return {
      ...detail,
      row,
      costStack: {
        ...detail.costStack,
        dscNonPeople: row.dscNonPeople,
        bmcNonPeople: row.bmcNonPeople,
        grnVendorActual: row.grnVendorActual,
        depreciation: row.depreciation,
        amortization: row.amortization,
        financeCost: row.financeCost,
        tax: row.tax,
      },
      allocationAccurate: true,
    };
  },

  async exportCsv(filters: Partial<PnlQueryFilters>) {
    const summary = await this.getSummary(filters);
    const headers = [
      "Process", "Client", "Branch", "Cost Centre", "Billing Model", "Mandated Seats", "Active HC", "Agent HC",
      "Planned Units", "Delivered Units", "Billable Units", "Delivery %", "Potential Revenue", "Earned Revenue",
      "Recognized Revenue", "Invoiced Revenue", "Collected Revenue", "Outstanding", "Unbilled Revenue",
      "Agent Salary", "Agent Salary %", "DSC", "DSC %", "BMC", "BMC %", "GRN Allocation Actual",
      "EBITDA", "EBITDA %", "EBIT", "Operating Profit %", "PBT", "PAT", "Approved Budget",
      "Reserved Budget", "Consumed Budget", "Available Budget", "Status",
    ];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [
      headers.map(escape).join(","),
      ...summary.rows.map((row) => [
        row.processName, row.clientName, row.branchName, row.costCentreCode, row.billingModels.join(" + "),
        row.mandatedSeats, row.activeHc, row.agentHeadcount, row.plannedDeliveryUnits, row.deliveredUnits,
        row.billableUnits, row.deliveryAttainmentPct?.toFixed(2), row.grossPotentialRevenue.toFixed(2),
        row.earnedRevenue.toFixed(2), row.recognizedRevenue.toFixed(2), row.invoicedRevenue.toFixed(2),
        row.collectedRevenue.toFixed(2), row.outstandingReceivable.toFixed(2), row.unbilledRevenue.toFixed(2),
        row.agentSalary.toFixed(2), row.agentSalaryPctRevenue?.toFixed(2), row.dsc.toFixed(2),
        row.dscPctRevenue?.toFixed(2), row.bmc.toFixed(2), row.bmcPctRevenue?.toFixed(2),
        row.grnVendorActual.toFixed(2), row.ebitda.toFixed(2), row.ebitdaMarginPct?.toFixed(2),
        row.ebit.toFixed(2), row.operatingProfitPct?.toFixed(2), row.pbt.toFixed(2), row.pat.toFixed(2),
        row.approvedBudget.toFixed(2), row.reservedBudget.toFixed(2), row.consumedBudget.toFixed(2),
        row.availableBudget.toFixed(2), row.processStatus,
      ].map(escape).join(",")),
    ].join("\n");
  },
};
