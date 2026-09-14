import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PnlExecutiveKpiStrip } from "@/components/finance/pnl/PnlExecutiveKpiStrip";
import { useBpoProcessPnlDetail } from "@/hooks/useBpoProcessPnlDetail";
import { useProcessPnlSection } from "@/hooks/useProcessPnlDetail";
import { ManualAdjustmentsPanel } from "@/components/finance/pnl/ManualAdjustmentsPanel";
import { formatDateDDMMYYYY } from "@/lib/date-format";

/**
 * The month this page opens on when the URL carries none.
 *
 * Matches defaultPeriod() in ProcessPnlPage, deliberately. That page opens on the PREVIOUS month
 * and explains why: the current month has invoicing but no payroll run yet, so a reader sees
 * revenue against no cost and concludes the arithmetic is broken. The same is true here, and
 * this page defaulted to the current month instead.
 *
 * Every in-app link passes ?period=, so the two only diverged on a bookmarked or shared
 * /finance/process-pnl/<id> — which is exactly when nobody is around to explain the half-elapsed
 * month. Same rule in both places now.
 */
function currentPeriod() {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currency(value: number | null | undefined, compact = false) {
  // Most call sites are currency(Number(x)), and Number(undefined) is NaN — which `?? 0` does
  // not catch, so a missing column formatted as the literal "₹NaN". A value that is absent is
  // still rendered as ₹0 (unchanged); only a non-numeric one is reported as unknown.
  if (value != null && !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value ?? 0);
}

function number(value: number | null | undefined) {
  return value == null ? "-" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function percent(value: number | null | undefined) {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

function date(value: string | null | undefined) {
  if (!value) return "Not available";
  // MySQL hands back "YYYY-MM-DD HH:MM:SS", which Safari refuses — new Date() returns Invalid
  // Date and the raw string was rendered instead. Same normalisation grn-format.ts already does,
  // now delegated to the shared @/lib/date-format helper; an unparseable value still falls back
  // to the raw string here rather than the shared helper's own "—" placeholder.
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return formatDateDDMMYYYY(parsed);
}

function moneyTone(value: number) {
  return value >= 0 ? "text-emerald-700" : "text-rose-700";
}

/**
 * ₹0 with no data behind it reads as "genuinely zero" — a real fact about performance — when it
 * actually means "nobody has ever entered this cost" (process_pnl_cost_component holds zero rows
 * in production today; see pnl-cost-component-flags.ts). Those are different claims, so an
 * unconfigured cost type gets its own badge instead of a bare currency figure.
 */
function CostFigure({ value, hasData }: { value: number; hasData: boolean }) {
  if (!hasData) {
    return (
      <span
        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"
        title="No row has ever been entered in process_pnl_cost_component for this cost type/period — this is not a confirmed ₹0, it has simply never been configured."
      >
        Not yet configured
      </span>
    );
  }
  return <span className="text-slate-900">{currency(value)}</span>;
}

function statusTone(status: string) {
  if (status === "profitable" || status === "configured" || status === "matched") return "bg-emerald-100 text-emerald-700";
  if (status === "loss-making" || status === "exception") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-800";
}

function DataTable({
  columns,
  rows,
}: {
  columns: Array<{ key: string; label: string; align?: "left" | "right"; formatter?: (value: any, row: Record<string, any>) => React.ReactNode }>;
  rows: Array<Record<string, any>>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`whitespace-nowrap px-3 py-2 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row, index) => (
              <tr key={String(row.id ?? row.reference ?? index)} className="hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td key={column.key} className={`whitespace-nowrap px-3 py-1.5 text-slate-700 ${column.align === "right" ? "text-right" : "text-left"}`}>
                    {column.formatter ? column.formatter(row[column.key], row) : String(row[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">No rows are available for this section.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProcessPnlDetailPage() {
  const { processId = "" } = useParams();
  // setSearchParams was never destructured, yet the period arrows below call it — so both
  // buttons threw ReferenceError on click rather than moving the period. tsc caught it as
  // TS2552, but the frontend typecheck gates the Build job in ci.yml, and Build is skipped
  // whenever typecheck fails, so nothing downstream reported it.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const period = searchParams.get("period") ?? currentPeriod();
  const [activeTab, setActiveTab] = useState("statement");
  const detailQuery = useBpoProcessPnlDetail(processId, { period });
  const revenueQuery = useProcessPnlSection(processId, { period }, "revenue", activeTab === "revenue");
  const peopleCostQuery = useProcessPnlSection(processId, { period }, "people-cost", activeTab === "costs");
  const directCostQuery = useProcessPnlSection(processId, { period }, "direct-cost", activeTab === "costs" || activeTab === "grn-budget");
  const indirectQuery = useProcessPnlSection(processId, { period }, "indirect-allocation", activeTab === "costs" || activeTab === "grn-budget");
  const ledgerQuery = useProcessPnlSection(processId, { period }, "ledger", activeTab === "ledger");
  const reconciliationQuery = useProcessPnlSection(processId, { period }, "reconciliation", activeTab === "reconciliation");
  // costCentreId lives on the detail's row (BpoPnlRow), not on BpoProcessPnlDetail itself.
  // Read off the wrong level it was always undefined, so the reward/penalty query below was
  // never scoped to this process's cost centre.
  const costCentreId = detailQuery.data?.row?.costCentreId ?? null;
  const rpQuery = useQuery({
    queryKey: ["pnl-reward-penalty", period, costCentreId],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (costCentreId) params.set("costCentreId", costCentreId);
      const res = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/reward-penalty?${params.toString()}`
      );
      return res.data;
    },
    enabled: activeTab === "revenue" && !!period,
    staleTime: 30_000,
  });

  if (detailQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-3 px-4 py-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-24" />
          <Skeleton className="h-[580px]" />
        </div>
      </DashboardLayout>
    );
  }

  const detail = detailQuery.data;
  if (!detail) {
    return (
      <DashboardLayout>
        <div className="px-4 py-6">
          <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-slate-700">
            <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
            This process does not have a usable P&amp;L record for {period}.
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const row = detail.row;
  const kpiItems = [
    { label: "Recognized revenue", value: row.recognizedRevenue, kind: "currency" as const, tone: "good" as const },
    { label: "Agent salary", value: row.agentSalary, kind: "currency" as const },
    { label: "Agent salary / revenue", value: row.agentSalaryPctRevenue ?? 0, kind: "percent" as const },
    { label: "DSC", value: row.dsc, kind: "currency" as const, tone: "warning" as const },
    { label: "BMC", value: row.bmc, kind: "currency" as const, tone: "warning" as const },
    { label: "EBITDA", value: row.ebitda, kind: "currency" as const, tone: row.ebitda >= 0 ? ("good" as const) : ("danger" as const) },
    { label: "EBITDA margin", value: row.ebitdaMarginPct ?? 0, kind: "percent" as const },
    { label: "Operating profit", value: row.operatingProfit, kind: "currency" as const, tone: row.operatingProfit >= 0 ? ("good" as const) : ("danger" as const) },
    { label: "PBT", value: row.pbt, kind: "currency" as const },
    { label: "PAT", value: row.pat, kind: "currency" as const },
  ];

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        {/* 48px slim header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => navigate(-1)}>
              ← Back
            </Button>
            <span className="text-sm font-semibold">{row.processName}</span>
            {period && (
              <div className="flex items-center gap-0.5">
                <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Previous month"
                  onClick={() => setSearchParams((p) => { const n = new URLSearchParams(p); n.set("period", shiftMonth(period, -1)); return n; })}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Badge variant="outline" className="text-xs">{period}</Badge>
                <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Next month"
                  disabled={period >= currentPeriod()}
                  onClick={() => setSearchParams((p) => { const n = new URLSearchParams(p); n.set("period", shiftMonth(period, 1)); return n; })}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
          <PnlExecutiveKpiStrip items={kpiItems} />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="mx-0 h-8">
              <TabsTrigger value="statement" className="h-7 text-xs">P&amp;L statement</TabsTrigger>
              <TabsTrigger value="revenue" className="h-7 text-xs">Revenue</TabsTrigger>
              <TabsTrigger value="costs" className="h-7 text-xs">Costs</TabsTrigger>
              <TabsTrigger value="grn-budget" className="h-7 text-xs">GRN &amp; budget</TabsTrigger>
              <TabsTrigger value="ledger" className="h-7 text-xs">Ledger</TabsTrigger>
              <TabsTrigger value="reconciliation" className="h-7 text-xs">Reconciliation</TabsTrigger>
              <TabsTrigger value="adjustments" className="h-7 text-xs">
                Manual Adjustments
                {(detail.manualAdjustment?.pendingCount ?? 0) > 0 && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                    {detail.manualAdjustment!.pendingCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── STATEMENT TAB ── */}
            <TabsContent value="statement" className="space-y-3">
              <div className="grid gap-3 xl:grid-cols-3">
                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Commercial revenue statement</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Gross potential revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.grossPotentialRevenue)}</dd>
                    <dt className="text-slate-500">Base earned revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.baseEarnedRevenue)}</dd>
                    <dt className="text-slate-500">Minimum commitment top-up</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.minimumCommitmentTopUp)}</dd>
                    <dt className="text-slate-500">Incentives, rewards &amp; other additions</dt>
                    <dd className="text-right font-medium text-emerald-700">{currency(row.incentiveRevenue + row.rewardRevenue + row.trainingRevenue + row.otherRevenueIncrease)}</dd>
                    <dt className="text-slate-500">Penalties, SLA &amp; credit notes</dt>
                    <dd className="text-right font-medium text-rose-700">{currency(row.penalty + row.slaDeduction + row.creditNote + row.otherRevenueDecrease)}</dd>
                    <dt className="text-slate-500">Net earned revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.earnedRevenue)}</dd>
                    <dt className="text-slate-500">Recognized revenue</dt>
                    <dd className="text-right font-medium text-emerald-700">{currency(row.recognizedRevenue)}</dd>
                    <dt className="text-slate-500">Invoiced revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.invoicedRevenue)}</dd>
                    <dt className="text-slate-500">Collected revenue</dt>
                    <dd className="text-right font-medium text-sky-700">{currency(row.collectedRevenue)}</dd>
                    <dt className="text-slate-500">Outstanding receivable</dt>
                    <dd className="text-right font-medium text-rose-700">{currency(row.outstandingReceivable)}</dd>
                    <dt className="text-slate-500">Unbilled revenue</dt>
                    <dd className="text-right font-medium text-amber-700">{currency(row.unbilledRevenue)}</dd>
                  </dl>
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cost of service statement · Agent / DSC / BMC
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Agent salary</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.agentSalary)}</dd>
                    <dt className="text-slate-500">Agent salary / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.agentSalaryPctRevenue)}</dd>
                    <dt className="text-slate-500">DSC people</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.dscPeople)}</dd>
                    <dt className="text-slate-500">DSC non-people</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.dscNonPeople)}</dd>
                    <dt className="text-slate-500">Total DSC</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.dsc)}</dd>
                    <dt className="text-slate-500">DSC / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.dscPctRevenue)}</dd>
                    <dt className="text-slate-500">BMC people allocation</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.bmcPeople)}</dd>
                    <dt className="text-slate-500">BMC non-people allocation</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.bmcNonPeople)}</dd>
                    <dt className="text-slate-500">Total BMC</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.bmc)}</dd>
                    <dt className="text-slate-500">BMC / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.bmcPctRevenue)}</dd>
                    <dt className="text-slate-500">GRN/vendor actual</dt>
                    <dd className="text-right font-medium text-amber-800">{currency(row.grnVendorActual)}</dd>
                    <dt className="text-slate-500">Total people cost / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.peopleCostPctRevenue)}</dd>
                  </dl>
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Profitability waterfall</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Contribution</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.contribution)}`}>{currency(row.contribution)}</dd>
                    <dt className="text-slate-500">Contribution margin</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.contributionMarginPct)}</dd>
                    <dt className="text-slate-500">EBITDA</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.ebitda)}`}>{currency(row.ebitda)}</dd>
                    <dt className="text-slate-500">EBITDA margin</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.ebitdaMarginPct ?? 0)}`}>{percent(row.ebitdaMarginPct)}</dd>
                    <dt className="text-slate-500">Depreciation</dt>
                    <dd className="text-right font-medium"><CostFigure value={row.depreciation} hasData={detail.costComponentFlags.hasDepreciationData} /></dd>
                    <dt className="text-slate-500">Amortization</dt>
                    <dd className="text-right font-medium"><CostFigure value={row.amortization} hasData={detail.costComponentFlags.hasAmortizationData} /></dd>
                    <dt className="text-slate-500">EBIT / Operating profit</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.ebit)}`}>{currency(row.ebit)}</dd>
                    <dt className="text-slate-500">Operating profit margin</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.operatingProfitPct)}</dd>
                    <dt className="text-slate-500">Finance cost</dt>
                    <dd className="text-right font-medium"><CostFigure value={row.financeCost} hasData={detail.costComponentFlags.hasFinanceCostData} /></dd>
                    <dt className="text-slate-500">PBT</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.pbt)}`}>{currency(row.pbt)}</dd>
                    <dt className="text-slate-500">Tax</dt>
                    <dd className="text-right font-medium"><CostFigure value={row.tax} hasData={detail.costComponentFlags.hasTaxData} /></dd>
                    <dt className="text-slate-500">PAT</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.pat)}`}>{currency(row.pat)}</dd>
                  </dl>
                </section>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery and workforce productivity</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Mandated seats</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.mandatedSeats)}</dd>
                    <dt className="text-slate-500">Required productive HC</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.requiredProductiveHc)}</dd>
                    <dt className="text-slate-500">Required roster HC</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.requiredRosterHc)}</dd>
                    <dt className="text-slate-500">Active HC</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.activeHc)}</dd>
                    <dt className="text-slate-500">Agent HC</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.agentHeadcount)}</dd>
                    <dt className="text-slate-500">Support HC</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.supportHeadcount)}</dd>
                    <dt className="text-slate-500">Planned delivery units</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.plannedDeliveryUnits)}</dd>
                    <dt className="text-slate-500">Delivered units</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.deliveredUnits)}</dd>
                    <dt className="text-slate-500">Accepted units</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.acceptedUnits)}</dd>
                    <dt className="text-slate-500">Billable units</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.billableUnits)}</dd>
                    <dt className="text-slate-500">Delivery attainment</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.deliveryAttainmentPct)}</dd>
                    <dt className="text-slate-500">Acceptance rate</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.acceptancePct)}</dd>
                  </dl>
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Unit economics</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Average agent salary</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.averageAgentSalary)}</dd>
                    <dt className="text-slate-500">Revenue per agent</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.revenuePerAgent)}</dd>
                    <dt className="text-slate-500">Revenue per active employee</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.revenuePerActiveEmployee)}</dd>
                    <dt className="text-slate-500">Revenue per contracted seat</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.revenuePerContractedSeat)}</dd>
                    <dt className="text-slate-500">Loaded cost per billable seat</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.loadedCostPerBillableSeat)}</dd>
                    <dt className="text-slate-500">Total cost / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.totalCostPctRevenue)}</dd>
                  </dl>
                </section>
              </div>
            </TabsContent>

            {/* ── REVENUE TAB ── */}
            <TabsContent value="revenue" className="space-y-3">
              <div className="grid gap-3 xl:grid-cols-2">
                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Approved billing rules</h3>
                  <DataTable
                    columns={[
                      { key: "rule_name", label: "Rule" },
                      { key: "billing_model", label: "Model", formatter: (value) => String(value ?? "").replaceAll("_", " ") },
                      { key: "metric_key", label: "Metric" },
                      { key: "rate_amount", label: "Rate", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "monthly_minimum_commitment", label: "Minimum", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "mandated_seats", label: "Seats", align: "right" },
                    ]}
                    rows={detail.revenueRules}
                  />
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery actuals</h3>
                  <DataTable
                    columns={[
                      { key: "metric_key", label: "Metric" },
                      { key: "planned_units", label: "Plan", align: "right", formatter: (value) => number(Number(value)) },
                      { key: "delivered_units", label: "Delivered", align: "right", formatter: (value) => number(Number(value)) },
                      { key: "accepted_units", label: "Accepted", align: "right", formatter: (value) => number(Number(value)) },
                      { key: "billable_units", label: "Billable", align: "right", formatter: (value) => number(Number(value)) },
                      { key: "data_source", label: "Source" },
                    ]}
                    rows={detail.deliveryActuals}
                  />
                </section>
              </div>

              <section className="rounded-lg border p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue additions and deductions</h3>
                <DataTable
                  columns={[
                    { key: "component_type", label: "Component", formatter: (value) => String(value ?? "").replaceAll("_", " ") },
                    { key: "direction", label: "Direction" },
                    { key: "description", label: "Description" },
                    { key: "units", label: "Units", align: "right" },
                    { key: "rate", label: "Rate", align: "right", formatter: (value) => value == null ? "-" : currency(Number(value)) },
                    { key: "amount_inr", label: "Amount", align: "right", formatter: (value, item) => `${item.direction === "decrease" ? "-" : "+"}${currency(Number(value))}` },
                    { key: "invoice_reference", label: "Invoice ref" },
                  ]}
                  rows={detail.revenueComponents}
                />
              </section>

              <section className="rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rewards &amp; penalties (this cost centre)</h3>
                  <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 px-2 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Legacy</Badge>
                </div>
                {/* This is the ORIGINAL reward/penalty mechanism (cost_centre_reward_penalty):
                    approved rows are already blended into the "Recognized revenue" and "Net earned
                    revenue" figures shown above and in the Adjusted Total on the Manual Adjustments
                    tab — they are not a separate line here, just a read-only view of what already
                    moved revenue. It is a different mechanism from Manual Adjustments (which is
                    approval-gated and shown as its own separate Adjusted Total, never blended). The
                    two do not combine automatically; check both if a revenue figure looks off. */}
                <p className="mb-2 text-[11px] text-amber-700">
                  Legacy mechanism — approved rows here already sit inside "Recognized revenue" above
                  (no separate line). Distinct from the "Manual Adjustments" tab, which is approval-gated
                  and shown separately as its own Adjusted Total.
                </p>
                {rpQuery.isLoading ? <Skeleton className="h-24 rounded-lg" /> : (
                  <DataTable
                    columns={[
                      { key: "cost_centre_name", label: "Cost centre" },
                      { key: "entry_type", label: "Type", formatter: (v) => String(v) === "reward" ? "Reward" : "Penalty" },
                      { key: "description", label: "Description" },
                      { key: "client_reference", label: "Client ref", formatter: (v) => String(v ?? "—") },
                      { key: "amount_inr", label: "Amount", align: "right", formatter: (v, row) => `${row.entry_type === "reward" ? "+" : "-"}${currency(Number(v))}` },
                      { key: "approval_status", label: "Status" },
                    ]}
                    rows={rpQuery.data ?? []}
                  />
                )}
              </section>

              <section className="rounded-lg border p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Client invoice register</h3>
                {revenueQuery.isLoading ? <Skeleton className="h-48 rounded-lg" /> : (
                  /* Columns are the ones billing_invoice actually returns (see getRevenue in
                     process-pnl.service.ts). This table used to ask for invoice_number,
                     invoice_date and due_date — none of which that SELECT emits — so the
                     Invoice column showed "-" and both date columns read "Not available" on
                     every row, which looks like missing data rather than a wrong key. There is
                     no due-date column on billing_invoice at all; Sent and Paid are the real
                     lifecycle stamps, so they take its place rather than inventing one. */
                  <DataTable
                    columns={[
                      { key: "invoice_ref", label: "Invoice" },
                      {
                        key: "period_from",
                        label: "Billing period",
                        formatter: (value, row) => `${date(value)} → ${date(row.period_to)}`,
                      },
                      { key: "status", label: "Status" },
                      { key: "net_amount", label: "Net amount", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "adjustments", label: "Adjustments", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "sent_at", label: "Sent", formatter: (value) => date(value) },
                      { key: "paid_at", label: "Paid", formatter: (value) => date(value) },
                    ]}
                    rows={revenueQuery.data?.invoices ?? []}
                  />
                )}
              </section>
            </TabsContent>

            {/* ── COSTS TAB ── */}
            <TabsContent value="costs" className="space-y-3">
              <div className="grid gap-3 xl:grid-cols-3">
                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Agent salary</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Agent headcount</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.agentHeadcount)}</dd>
                    <dt className="text-slate-500">Agent salary</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.agentSalary)}</dd>
                    <dt className="text-slate-500">Average agent salary</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.averageAgentSalary)}</dd>
                    <dt className="text-slate-500">Salary / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.agentSalaryPctRevenue)}</dd>
                  </dl>
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Direct Service Cost</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Support headcount</dt>
                    <dd className="text-right font-medium text-slate-900">{number(row.supportHeadcount)}</dd>
                    <dt className="text-slate-500">DSC people</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.dscPeople)}</dd>
                    <dt className="text-slate-500">DSC non-people</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.dscNonPeople)}</dd>
                    <dt className="text-slate-500">Total DSC</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.dsc)}</dd>
                    <dt className="text-slate-500">DSC / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.dscPctRevenue)}</dd>
                  </dl>
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Branch Management Cost</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Shared people allocation</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.bmcPeople)}</dd>
                    <dt className="text-slate-500">Shared non-people allocation</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.bmcNonPeople)}</dd>
                    <dt className="text-slate-500">Total BMC</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.bmc)}</dd>
                    <dt className="text-slate-500">BMC / revenue</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.bmcPctRevenue)}</dd>
                  </dl>
                </section>
              </div>

              <section className="rounded-lg border p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Employee-level loaded payroll</h3>
                {/* getPeopleCost answers from salary_prep_line when a payroll run exists for the
                    period, and otherwise falls back to employee_salary_assignment — which returns
                    only a monthly loaded_cost, with no statutory breakdown at all. The four
                    statutory columns were rendered unconditionally, so every row of a
                    not-yet-run month read "₹NaN" four times. They are shown only when the
                    source can actually supply them, and the fallback says what it is. */}
                {peopleCostQuery.data?.source === "employee_salary_assignment" && (
                  <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    No payroll run exists for {period} yet. These are contracted figures from each
                    employee's salary assignment (annual CTC ÷ 12), not processed payroll, so the
                    statutory split is not available.
                  </p>
                )}
                {peopleCostQuery.isLoading ? <Skeleton className="h-64 rounded-lg" /> : (
                  <DataTable
                    columns={[
                      { key: "employee_code", label: "Employee code" },
                      { key: "full_name", label: "Employee" },
                      { key: "designation_name", label: "Designation" },
                      ...(peopleCostQuery.data?.source === "salary_prep_line" ? [
                        { key: "gross_salary", label: "Gross salary", align: "right" as const, formatter: (value: unknown) => currency(Number(value)) },
                        { key: "pf_employer", label: "Employer PF", align: "right" as const, formatter: (value: unknown) => currency(Number(value)) },
                        { key: "esic_employer", label: "Employer ESIC", align: "right" as const, formatter: (value: unknown) => currency(Number(value)) },
                        { key: "gratuity", label: "Gratuity", align: "right" as const, formatter: (value: unknown) => currency(Number(value)) },
                      ] : []),
                      { key: "loaded_cost", label: "Loaded cost", align: "right", formatter: (value) => currency(Number(value)) },
                    ]}
                    rows={peopleCostQuery.data?.employees ?? []}
                  />
                )}
              </section>

              <div className="grid gap-3 xl:grid-cols-2">
                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Direct expense and vendor ledger</h3>
                  {directCostQuery.isLoading ? <Skeleton className="h-64 rounded-lg" /> : (
                    <DataTable
                      columns={[
                        {
                          key: "reference",
                          label: "Reference",
                          formatter: (value, row) => {
                            const isGrn = String(row.sourceType ?? "").includes("grn");
                            if (isGrn && row.id) {
                              return (
                                <a
                                  href={`/finance/grn?grn=${row.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-700 underline hover:text-blue-900"
                                >
                                  {String(value ?? "-")}
                                </a>
                              );
                            }
                            return String(value ?? "-");
                          },
                        },
                        { key: "entryDate", label: "Date", formatter: (value) => date(value) },
                        { key: "category", label: "Head" },
                        { key: "subCategory", label: "Sub-head" },
                        { key: "vendorName", label: "Vendor" },
                        { key: "amount", label: "Amount", align: "right", formatter: (value) => currency(Number(value)) },
                        { key: "status", label: "Status" },
                      ]}
                      rows={directCostQuery.data?.expenses ?? []}
                    />
                  )}
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">BMC allocation pools</h3>
                  {indirectQuery.isLoading ? <Skeleton className="h-64 rounded-lg" /> : (
                    <DataTable
                      columns={[
                        { key: "category", label: "Head" },
                        { key: "subCategory", label: "Sub-head" },
                        { key: "branchPoolAmount", label: "Branch pool", align: "right", formatter: (value) => currency(Number(value)) },
                        { key: "processAllocationPct", label: "Allocation %", align: "right", formatter: (value) => percent(Number(value)) },
                        { key: "processAllocationAmount", label: "Process allocation", align: "right", formatter: (value) => currency(Number(value)) },
                      ]}
                      rows={indirectQuery.data?.pools ?? []}
                    />
                  )}
                </section>
              </div>
            </TabsContent>

            {/* ── GRN & BUDGET TAB ── */}
            <TabsContent value="grn-budget" className="space-y-3">
              <div className="grid gap-3 xl:grid-cols-2">
                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Budget lifecycle</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Approved allocated budget</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.approvedBudget)}</dd>
                    <dt className="text-slate-500">Reserved by approved/pending GRNs</dt>
                    <dd className="text-right font-medium text-amber-700">{currency(row.reservedBudget)}</dd>
                    <dt className="text-slate-500">Consumed by Finance-approved GRNs</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.consumedBudget)}</dd>
                    <dt className="text-slate-500">Available balance</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.availableBudget)}`}>{currency(row.availableBudget)}</dd>
                    <dt className="text-slate-500">Budget utilization</dt>
                    <dd className={`text-right font-medium ${(row.budgetUtilizationPct ?? 0) > 100 ? "text-rose-700" : "text-slate-900"}`}>{percent(row.budgetUtilizationPct)}</dd>
                  </dl>
                </section>

                <section className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">GRN/vendor impact</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">GRN/vendor P&amp;L actual</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.grnVendorActual)}</dd>
                    <dt className="text-slate-500">DSC non-people</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.dscNonPeople)}</dd>
                    <dt className="text-slate-500">BMC non-people allocation</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.bmcNonPeople)}</dd>
                    <dt className="text-slate-500">Available budget after commitment</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.availableBudget)}`}>{currency(row.availableBudget)}</dd>
                    <dt className="text-slate-500">EBITDA variance to target</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.ebitdaVariance ?? 0)}`}>{row.ebitdaVariance == null ? "No EBITDA budget" : currency(row.ebitdaVariance)}</dd>
                  </dl>
                </section>
              </div>

              <section className="rounded-lg border p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">GRN and vendor expense detail</h3>
                {directCostQuery.isLoading ? <Skeleton className="h-80 rounded-lg" /> : (
                  <DataTable
                    columns={[
                      { key: "sourceType", label: "Source", formatter: (value) => String(value ?? "").replaceAll("_", " ") },
                      {
                        key: "reference",
                        label: "Reference",
                        formatter: (value, row) => {
                          const isGrn = String(row.sourceType ?? "").includes("grn");
                          if (isGrn && row.id) {
                            return (
                              <a
                                href={`/finance/grn?grn=${row.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 underline hover:text-blue-900"
                              >
                                {String(value ?? "-")}
                              </a>
                            );
                          }
                          return String(value ?? "-");
                        },
                      },
                      { key: "entryDate", label: "Recognition date", formatter: (value) => date(value) },
                      { key: "category", label: "Head" },
                      { key: "subCategory", label: "Sub-head" },
                      { key: "vendorName", label: "Vendor" },
                      { key: "costClass", label: "Cost class" },
                      { key: "amount", label: "P&L amount", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "status", label: "Status" },
                    ]}
                    rows={directCostQuery.data?.expenses ?? []}
                  />
                )}
              </section>
            </TabsContent>

            {/* ── LEDGER TAB ── */}
            <TabsContent value="ledger" className="space-y-3">
              <section className="rounded-lg border p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Process P&amp;L ledger</h3>
                {ledgerQuery.isLoading ? <Skeleton className="h-96 rounded-lg" /> : (
                  <DataTable
                    columns={[
                      { key: "entryType", label: "Entry type", formatter: (value) => String(value ?? "").replaceAll("_", " ") },
                      { key: "reference", label: "Reference" },
                      { key: "entryDate", label: "Date", formatter: (value) => date(value) },
                      { key: "amount", label: "Amount", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "status", label: "Status" },
                      { key: "note", label: "Note" },
                    ]}
                    rows={ledgerQuery.data?.entries ?? []}
                  />
                )}
              </section>
            </TabsContent>

            {/* ── RECONCILIATION TAB ── */}
            <TabsContent value="reconciliation" className="space-y-3">
              <section className="rounded-lg border p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Finance reconciliation and controls</h3>
                {reconciliationQuery.isLoading ? <Skeleton className="h-56 rounded-lg" /> : (
                  <div className="space-y-2">
                    <div className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone(reconciliationQuery.data?.status ?? "pending")}`}>
                      {reconciliationQuery.data?.status ?? "pending"}
                    </div>
                    {(reconciliationQuery.data?.issues ?? []).map((issue) => (
                      <div key={issue.code} className={`rounded-lg border px-3 py-2 ${issue.severity === "critical" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-950">
                          {issue.severity === "critical"
                            ? <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
                            : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                          {issue.code.replaceAll("_", " ")}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">{issue.message}</p>
                      </div>
                    ))}
                    {(reconciliationQuery.data?.issues ?? []).length === 0 && (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> All configured financial controls are reconciled for this process.
                      </div>
                    )}
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value="adjustments" className="space-y-3">
              <ManualAdjustmentsPanel
                processId={processId}
                processName={row.processName}
                period={period}
                systemRevenue={row.recognizedRevenue}
                adjustedTotal={detail.manualAdjustment}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
