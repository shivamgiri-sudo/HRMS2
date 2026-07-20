import { useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PnlExecutiveKpiStrip } from "@/components/finance/pnl/PnlExecutiveKpiStrip";
import { useBpoProcessPnlDetail } from "@/hooks/useBpoProcessPnlDetail";
import { useProcessPnlSection } from "@/hooks/useProcessPnlDetail";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currency(value: number | null | undefined, compact = false) {
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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function moneyTone(value: number) {
  return value >= 0 ? "text-emerald-700" : "text-rose-700";
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
  columns: Array<{ key: string; label: string; align?: "left" | "right"; formatter?: (value: any, row: Record<string, any>) => string }>;
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
  const [searchParams] = useSearchParams();
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
            {period && <Badge variant="outline" className="text-xs">{period}</Badge>}
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
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Cost of service statement</h3>
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
                    <dd className="text-right font-medium text-slate-900">{currency(row.depreciation)}</dd>
                    <dt className="text-slate-500">Amortization</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.amortization)}</dd>
                    <dt className="text-slate-500">EBIT / Operating profit</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.ebit)}`}>{currency(row.ebit)}</dd>
                    <dt className="text-slate-500">Operating profit margin</dt>
                    <dd className="text-right font-medium text-slate-900">{percent(row.operatingProfitPct)}</dd>
                    <dt className="text-slate-500">Finance cost</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.financeCost)}</dd>
                    <dt className="text-slate-500">PBT</dt>
                    <dd className={`text-right font-medium ${moneyTone(row.pbt)}`}>{currency(row.pbt)}</dd>
                    <dt className="text-slate-500">Tax</dt>
                    <dd className="text-right font-medium text-slate-900">{currency(row.tax)}</dd>
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
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Client invoice register</h3>
                {revenueQuery.isLoading ? <Skeleton className="h-48 rounded-lg" /> : (
                  <DataTable
                    columns={[
                      { key: "invoice_number", label: "Invoice" },
                      { key: "invoice_date", label: "Date", formatter: (value) => date(value) },
                      { key: "status", label: "Status" },
                      { key: "net_amount", label: "Net amount", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "adjustments", label: "Adjustments", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "due_date", label: "Due date", formatter: (value) => date(value) },
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
                {peopleCostQuery.isLoading ? <Skeleton className="h-64 rounded-lg" /> : (
                  <DataTable
                    columns={[
                      { key: "employee_code", label: "Employee code" },
                      { key: "full_name", label: "Employee" },
                      { key: "designation_name", label: "Designation" },
                      { key: "gross_salary", label: "Gross salary", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "pf_employer", label: "Employer PF", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "esic_employer", label: "Employer ESIC", align: "right", formatter: (value) => currency(Number(value)) },
                      { key: "gratuity", label: "Gratuity", align: "right", formatter: (value) => currency(Number(value)) },
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
                        { key: "reference", label: "Reference" },
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
                      { key: "reference", label: "Reference" },
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
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
