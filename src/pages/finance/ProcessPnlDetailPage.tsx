import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeIndianRupee,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  DatabaseZap,
  FileSpreadsheet,
  Gauge,
  ReceiptIndianRupee,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-right text-sm font-bold ${tone ?? "text-slate-950"}`}>{value}</span>
    </div>
  );
}

function DataTable({
  columns,
  rows,
}: {
  columns: Array<{ key: string; label: string; align?: "left" | "right"; formatter?: (value: any, row: Record<string, any>) => string }>;
  rows: Array<Record<string, any>>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`whitespace-nowrap px-4 py-3 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row, index) => (
              <tr key={String(row.id ?? row.reference ?? index)} className="hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td key={column.key} className={`whitespace-nowrap px-4 py-3 text-slate-700 ${column.align === "right" ? "text-right" : "text-left"}`}>
                    {column.formatter ? column.formatter(row[column.key], row) : String(row[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">No rows are available for this section.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatementCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-950">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function ProcessPnlDetailPage() {
  const { processId = "" } = useParams();
  const [searchParams] = useSearchParams();
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
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <Skeleton className="h-64 rounded-[32px]" />
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-[620px] rounded-3xl" />
        </div>
      </DashboardLayout>
    );
  }

  const detail = detailQuery.data;
  if (!detail) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-4xl px-4 py-10">
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-6 text-slate-600">
              <ShieldAlert className="h-5 w-5 text-rose-600" />
              This process does not have a usable P&amp;L record for {period}.
            </CardContent>
          </Card>
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

  const dataIcon = row.revenueDataStatus === "configured"
    ? <CheckCircle2 className="h-4 w-4" />
    : row.revenueDataStatus === "configured_no_delivery"
    ? <AlertTriangle className="h-4 w-4" />
    : <DatabaseZap className="h-4 w-4" />;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_25%),linear-gradient(180deg,_#f2f8f5_0%,_#ffffff_34%,_#f8fafc_100%)]">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <div className="grid gap-6 p-6 xl:grid-cols-[1.45fr_0.85fr] xl:p-8">
              <div className="space-y-5">
                <Link to={`/finance/process-pnl?period=${period}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white">
                  <ArrowLeft className="h-4 w-4" /> Back to BPO P&amp;L command centre
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(row.processStatus)}`}>{row.processStatus}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${statusTone(row.revenueDataStatus)}`}>
                    {dataIcon} {row.revenueDataStatus.replaceAll("_", " ")}
                  </span>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">Period {period}</span>
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{row.processName}</h1>
                  <p className="mt-2 text-sm text-slate-300 sm:text-base">
                    {row.clientName ?? "Unmapped client"} · {row.branchName ?? "Unassigned branch"} · Cost centre {row.costCentreCode ?? "not mapped"}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Billing: {row.billingModels.length ? row.billingModels.join(" + ").replaceAll("_", " ") : "not configured"}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Mandated seats</p><p className="mt-2 text-2xl font-black">{number(row.mandatedSeats)}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Active HC</p><p className="mt-2 text-2xl font-black">{number(row.activeHc)}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Delivery</p><p className="mt-2 text-2xl font-black">{percent(row.deliveryAttainmentPct)}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Last refreshed</p><p className="mt-2 text-lg font-bold">{date(row.freshness)}</p></div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <Card className="border-white/10 bg-white/5 text-white shadow-none">
                  <CardContent className="p-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Revenue realization</p>
                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-slate-300">Potential</span><span className="font-bold">{currency(row.grossPotentialRevenue, true)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Earned</span><span className="font-bold">{currency(row.earnedRevenue, true)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Recognized</span><span className="font-bold text-emerald-200">{currency(row.recognizedRevenue, true)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Collected</span><span className="font-bold text-sky-200">{currency(row.collectedRevenue, true)}</span></div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none">
                  <CardContent className="p-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Budget control</p>
                    <p className={`mt-3 text-3xl font-black ${row.availableBudget >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{currency(row.availableBudget, true)}</p>
                    <p className="mt-2 text-xs text-slate-300">Available after {currency(row.reservedBudget, true)} reserved and {currency(row.consumedBudget, true)} consumed</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>

          <PnlExecutiveKpiStrip items={kpiItems} />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
            <TabsList className="h-auto flex-wrap justify-start rounded-2xl bg-white p-1 shadow-sm">
              <TabsTrigger value="statement">P&amp;L statement</TabsTrigger>
              <TabsTrigger value="revenue">Revenue engine</TabsTrigger>
              <TabsTrigger value="costs">Agent / DSC / BMC</TabsTrigger>
              <TabsTrigger value="grn-budget">GRN &amp; budget</TabsTrigger>
              <TabsTrigger value="ledger">Ledger</TabsTrigger>
              <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
            </TabsList>

            <TabsContent value="statement" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-3">
                <StatementCard title="Commercial revenue statement" icon={<Banknote className="h-4 w-4 text-emerald-600" />}>
                  <MetricRow label="Gross potential revenue" value={currency(row.grossPotentialRevenue)} />
                  <MetricRow label="Base earned revenue" value={currency(row.baseEarnedRevenue)} />
                  <MetricRow label="Minimum commitment top-up" value={currency(row.minimumCommitmentTopUp)} />
                  <MetricRow label="Incentives, rewards & other additions" value={currency(row.incentiveRevenue + row.rewardRevenue + row.trainingRevenue + row.otherRevenueIncrease)} tone="text-emerald-700" />
                  <MetricRow label="Penalties, SLA & credit notes" value={currency(row.penalty + row.slaDeduction + row.creditNote + row.otherRevenueDecrease)} tone="text-rose-700" />
                  <MetricRow label="Net earned revenue" value={currency(row.earnedRevenue)} />
                  <MetricRow label="Recognized revenue" value={currency(row.recognizedRevenue)} tone="text-emerald-700" />
                  <MetricRow label="Invoiced revenue" value={currency(row.invoicedRevenue)} />
                  <MetricRow label="Collected revenue" value={currency(row.collectedRevenue)} tone="text-sky-700" />
                  <MetricRow label="Outstanding receivable" value={currency(row.outstandingReceivable)} tone="text-rose-700" />
                  <MetricRow label="Unbilled revenue" value={currency(row.unbilledRevenue)} tone="text-amber-700" />
                </StatementCard>

                <StatementCard title="Cost of service statement" icon={<UsersRound className="h-4 w-4 text-amber-600" />}>
                  <MetricRow label="Agent salary" value={currency(row.agentSalary)} />
                  <MetricRow label="Agent salary / revenue" value={percent(row.agentSalaryPctRevenue)} />
                  <MetricRow label="DSC people" value={currency(row.dscPeople)} />
                  <MetricRow label="DSC non-people" value={currency(row.dscNonPeople)} />
                  <MetricRow label="Total DSC" value={currency(row.dsc)} />
                  <MetricRow label="DSC / revenue" value={percent(row.dscPctRevenue)} />
                  <MetricRow label="BMC people allocation" value={currency(row.bmcPeople)} />
                  <MetricRow label="BMC non-people allocation" value={currency(row.bmcNonPeople)} />
                  <MetricRow label="Total BMC" value={currency(row.bmc)} />
                  <MetricRow label="BMC / revenue" value={percent(row.bmcPctRevenue)} />
                  <MetricRow label="GRN/vendor actual" value={currency(row.grnVendorActual)} tone="text-amber-800" />
                  <MetricRow label="Total people cost / revenue" value={percent(row.peopleCostPctRevenue)} />
                </StatementCard>

                <StatementCard title="Profitability waterfall" icon={<Gauge className="h-4 w-4 text-violet-600" />}>
                  <MetricRow label="Contribution" value={currency(row.contribution)} tone={moneyTone(row.contribution)} />
                  <MetricRow label="Contribution margin" value={percent(row.contributionMarginPct)} />
                  <MetricRow label="EBITDA" value={currency(row.ebitda)} tone={moneyTone(row.ebitda)} />
                  <MetricRow label="EBITDA margin" value={percent(row.ebitdaMarginPct)} tone={moneyTone(row.ebitdaMarginPct ?? 0)} />
                  <MetricRow label="Depreciation" value={currency(row.depreciation)} />
                  <MetricRow label="Amortization" value={currency(row.amortization)} />
                  <MetricRow label="EBIT / Operating profit" value={currency(row.ebit)} tone={moneyTone(row.ebit)} />
                  <MetricRow label="Operating profit margin" value={percent(row.operatingProfitPct)} />
                  <MetricRow label="Finance cost" value={currency(row.financeCost)} />
                  <MetricRow label="PBT" value={currency(row.pbt)} tone={moneyTone(row.pbt)} />
                  <MetricRow label="Tax" value={currency(row.tax)} />
                  <MetricRow label="PAT" value={currency(row.pat)} tone={moneyTone(row.pat)} />
                </StatementCard>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <StatementCard title="Delivery and workforce productivity" icon={<BriefcaseBusiness className="h-4 w-4 text-sky-600" />}>
                  <div className="grid gap-x-8 md:grid-cols-2">
                    <div>
                      <MetricRow label="Mandated seats" value={number(row.mandatedSeats)} />
                      <MetricRow label="Required productive HC" value={number(row.requiredProductiveHc)} />
                      <MetricRow label="Required roster HC" value={number(row.requiredRosterHc)} />
                      <MetricRow label="Active HC" value={number(row.activeHc)} />
                      <MetricRow label="Agent HC" value={number(row.agentHeadcount)} />
                      <MetricRow label="Support HC" value={number(row.supportHeadcount)} />
                    </div>
                    <div>
                      <MetricRow label="Planned delivery units" value={number(row.plannedDeliveryUnits)} />
                      <MetricRow label="Delivered units" value={number(row.deliveredUnits)} />
                      <MetricRow label="Accepted units" value={number(row.acceptedUnits)} />
                      <MetricRow label="Billable units" value={number(row.billableUnits)} />
                      <MetricRow label="Delivery attainment" value={percent(row.deliveryAttainmentPct)} />
                      <MetricRow label="Acceptance rate" value={percent(row.acceptancePct)} />
                    </div>
                  </div>
                </StatementCard>

                <StatementCard title="Unit economics" icon={<BadgeIndianRupee className="h-4 w-4 text-indigo-600" />}>
                  <div className="grid gap-x-8 md:grid-cols-2">
                    <div>
                      <MetricRow label="Average agent salary" value={currency(row.averageAgentSalary)} />
                      <MetricRow label="Revenue per agent" value={currency(row.revenuePerAgent)} />
                      <MetricRow label="Revenue per active employee" value={currency(row.revenuePerActiveEmployee)} />
                    </div>
                    <div>
                      <MetricRow label="Revenue per contracted seat" value={currency(row.revenuePerContractedSeat)} />
                      <MetricRow label="Loaded cost per billable seat" value={currency(row.loadedCostPerBillableSeat)} />
                      <MetricRow label="Total cost / revenue" value={percent(row.totalCostPctRevenue)} />
                    </div>
                  </div>
                </StatementCard>
              </div>
            </TabsContent>

            <TabsContent value="revenue" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                <StatementCard title="Approved billing rules" icon={<CircleDollarSign className="h-4 w-4 text-emerald-600" />}>
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
                </StatementCard>

                <StatementCard title="Delivery actuals" icon={<FileSpreadsheet className="h-4 w-4 text-sky-600" />}>
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
                </StatementCard>
              </div>

              <StatementCard title="Revenue additions and deductions" icon={<ReceiptIndianRupee className="h-4 w-4 text-violet-600" />}>
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
              </StatementCard>

              <StatementCard title="Client invoice register" icon={<Banknote className="h-4 w-4 text-emerald-600" />}>
                {revenueQuery.isLoading ? <Skeleton className="h-64 rounded-2xl" /> : (
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
              </StatementCard>
            </TabsContent>

            <TabsContent value="costs" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-3">
                <StatementCard title="Agent salary" icon={<UsersRound className="h-4 w-4 text-emerald-600" />}>
                  <MetricRow label="Agent headcount" value={number(row.agentHeadcount)} />
                  <MetricRow label="Agent salary" value={currency(row.agentSalary)} />
                  <MetricRow label="Average agent salary" value={currency(row.averageAgentSalary)} />
                  <MetricRow label="Salary / revenue" value={percent(row.agentSalaryPctRevenue)} />
                </StatementCard>
                <StatementCard title="Direct Service Cost" icon={<BriefcaseBusiness className="h-4 w-4 text-amber-600" />}>
                  <MetricRow label="Support headcount" value={number(row.supportHeadcount)} />
                  <MetricRow label="DSC people" value={currency(row.dscPeople)} />
                  <MetricRow label="DSC non-people" value={currency(row.dscNonPeople)} />
                  <MetricRow label="Total DSC" value={currency(row.dsc)} />
                  <MetricRow label="DSC / revenue" value={percent(row.dscPctRevenue)} />
                </StatementCard>
                <StatementCard title="Branch Management Cost" icon={<Building2 className="h-4 w-4 text-indigo-600" />}>
                  <MetricRow label="Shared people allocation" value={currency(row.bmcPeople)} />
                  <MetricRow label="Shared non-people allocation" value={currency(row.bmcNonPeople)} />
                  <MetricRow label="Total BMC" value={currency(row.bmc)} />
                  <MetricRow label="BMC / revenue" value={percent(row.bmcPctRevenue)} />
                </StatementCard>
              </div>

              <StatementCard title="Employee-level loaded payroll" icon={<UsersRound className="h-4 w-4 text-sky-600" />}>
                {peopleCostQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
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
              </StatementCard>

              <div className="grid gap-5 xl:grid-cols-2">
                <StatementCard title="Direct expense and vendor ledger" icon={<ReceiptIndianRupee className="h-4 w-4 text-amber-600" />}>
                  {directCostQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
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
                </StatementCard>
                <StatementCard title="BMC allocation pools" icon={<Building2 className="h-4 w-4 text-indigo-600" />}>
                  {indirectQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
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
                </StatementCard>
              </div>
            </TabsContent>

            <TabsContent value="grn-budget" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                <StatementCard title="Budget lifecycle" icon={<Gauge className="h-4 w-4 text-indigo-600" />}>
                  <MetricRow label="Approved allocated budget" value={currency(row.approvedBudget)} />
                  <MetricRow label="Reserved by approved/pending GRNs" value={currency(row.reservedBudget)} tone="text-amber-700" />
                  <MetricRow label="Consumed by Finance-approved GRNs" value={currency(row.consumedBudget)} />
                  <MetricRow label="Available balance" value={currency(row.availableBudget)} tone={moneyTone(row.availableBudget)} />
                  <MetricRow label="Budget utilization" value={percent(row.budgetUtilizationPct)} tone={(row.budgetUtilizationPct ?? 0) > 100 ? "text-rose-700" : undefined} />
                </StatementCard>
                <StatementCard title="GRN/vendor impact" icon={<ReceiptIndianRupee className="h-4 w-4 text-amber-600" />}>
                  <MetricRow label="GRN/vendor P&L actual" value={currency(row.grnVendorActual)} />
                  <MetricRow label="DSC non-people" value={currency(row.dscNonPeople)} />
                  <MetricRow label="BMC non-people allocation" value={currency(row.bmcNonPeople)} />
                  <MetricRow label="Available budget after commitment" value={currency(row.availableBudget)} tone={moneyTone(row.availableBudget)} />
                  <MetricRow label="EBITDA variance to target" value={row.ebitdaVariance == null ? "No EBITDA budget" : currency(row.ebitdaVariance)} tone={moneyTone(row.ebitdaVariance ?? 0)} />
                </StatementCard>
              </div>

              <StatementCard title="GRN and vendor expense detail" icon={<FileSpreadsheet className="h-4 w-4 text-sky-600" />}>
                {directCostQuery.isLoading ? <Skeleton className="h-96 rounded-2xl" /> : (
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
              </StatementCard>
            </TabsContent>

            <TabsContent value="ledger" className="space-y-5">
              <StatementCard title="Process P&L ledger" icon={<FileSpreadsheet className="h-4 w-4 text-slate-600" />}>
                {ledgerQuery.isLoading ? <Skeleton className="h-[480px] rounded-2xl" /> : (
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
              </StatementCard>
            </TabsContent>

            <TabsContent value="reconciliation" className="space-y-5">
              <StatementCard title="Finance reconciliation and controls" icon={<ShieldAlert className="h-4 w-4 text-rose-600" />}>
                {reconciliationQuery.isLoading ? <Skeleton className="h-72 rounded-2xl" /> : (
                  <div className="space-y-3">
                    <div className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone(reconciliationQuery.data?.status ?? "pending")}`}>
                      {reconciliationQuery.data?.status ?? "pending"}
                    </div>
                    {(reconciliationQuery.data?.issues ?? []).map((issue) => (
                      <div key={issue.code} className={`rounded-2xl border px-4 py-3 ${issue.severity === "critical" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                          {issue.severity === "critical" ? <ShieldAlert className="h-4 w-4 text-rose-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                          {issue.code.replaceAll("_", " ")}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{issue.message}</p>
                      </div>
                    ))}
                    {(reconciliationQuery.data?.issues ?? []).length === 0 && (
                      <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> All configured financial controls are reconciled for this process.
                      </div>
                    )}
                  </div>
                )}
              </StatementCard>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
