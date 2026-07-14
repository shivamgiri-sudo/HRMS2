import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, FileText, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useProcessPnlSection } from "@/hooks/useProcessPnlDetail";
import { PnlExecutiveKpiStrip } from "@/components/finance/pnl/PnlExecutiveKpiStrip";
import { MarginBridgeChart } from "@/components/finance/pnl/MarginBridgeChart";
import { ProfitabilityTrendChart } from "@/components/finance/pnl/ProfitabilityTrendChart";
import { WorkforceCostBridge } from "@/components/finance/pnl/WorkforceCostBridge";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function statusTone(status: string) {
  if (status === "profitable" || status === "matched") return "bg-emerald-100 text-emerald-700";
  if (status === "loss-making" || status === "exception") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-800";
}

function DataTable({
  columns,
  rows,
}: {
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, any>>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-4 py-3 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-3 ${column.align === "right" ? "text-right" : "text-left"} text-slate-700`}>
                    {String(row[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                  No rows are available for this section.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 rounded-3xl" />
      <Skeleton className={`${tall ? "h-[420px]" : "h-[260px]"} rounded-3xl`} />
    </div>
  );
}

export default function ProcessPnlDetailPage() {
  const { processId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const [activeTab, setActiveTab] = useState("overview");
  const filters = { period };

  const overviewQuery = useProcessPnlSection(processId, filters, "overview");
  const revenueQuery = useProcessPnlSection(processId, filters, "revenue", activeTab === "revenue");
  const workforceQuery = useProcessPnlSection(processId, filters, "workforce", activeTab === "workforce");
  const peopleCostQuery = useProcessPnlSection(
    processId,
    filters,
    "people-cost",
    activeTab === "workforce" || activeTab === "people-cost"
  );
  const directCostQuery = useProcessPnlSection(processId, filters, "direct-cost", activeTab === "direct-cost");
  const indirectAllocationQuery = useProcessPnlSection(
    processId,
    filters,
    "indirect-allocation",
    activeTab === "indirect"
  );
  const trendQuery = useProcessPnlSection(processId, filters, "trend", activeTab === "trend");
  const reconciliationQuery = useProcessPnlSection(
    processId,
    filters,
    "reconciliation",
    activeTab === "reconciliation"
  );
  const ledgerQuery = useProcessPnlSection(processId, filters, "ledger", activeTab === "ledger");

  if (overviewQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <Skeleton className="h-52 rounded-3xl" />
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-[520px] rounded-3xl" />
        </div>
      </DashboardLayout>
    );
  }

  const overview = overviewQuery.data;
  if (!overview) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-4xl px-4 py-10">
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-6 text-slate-600">
              <ShieldAlert className="h-5 w-5 text-rose-600" />
              This process does not have a usable P&L detail bundle for the selected period.
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const record = overview;

  const kpiItems = [
    { label: "Revenue", value: record.revenueMtd, kind: "currency" as const, tone: "good" as const },
    { label: "Direct cost", value: record.directCost, kind: "currency" as const },
    { label: "Indirect cost", value: record.indirectCost, kind: "currency" as const, tone: "warning" as const },
    {
      label: "Operating profit",
      value: record.operatingProfit,
      kind: "currency" as const,
      tone: record.operatingProfit >= 0 ? ("good" as const) : ("danger" as const),
    },
    { label: "OP margin", value: record.operatingMarginPct ?? 0, kind: "percent" as const },
    { label: "Revenue at risk", value: record.revenueAtRisk, kind: "currency" as const, tone: "warning" as const },
    { label: "Billable HC", value: record.billableHc, kind: "number" as const },
    { label: "Active HC", value: record.activeHc, kind: "number" as const },
  ];

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[linear-gradient(180deg,_#eff6f2_0%,_#ffffff_34%,_#f8fafc_100%)]">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_0.8fr]">
            <div className="space-y-4">
              <Link to={`/finance/process-pnl?period=${period}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
                <ArrowLeft className="h-4 w-4" />
                Back to command centre
              </Link>
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(record.processStatus)}`}>
                    {record.processStatus}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(record.reconciliationStatus)}`}>
                    {record.reconciliationStatus}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {record.financialStatus}
                  </span>
                </div>
                <h1 className="text-3xl font-black tracking-tight text-slate-950">{record.processName}</h1>
                <p className="mt-2 text-sm text-slate-600">
                  {record.clientName ?? "Unmapped client"} - {record.branchName ?? "Unassigned branch"} - Period {period}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="rounded-2xl border-emerald-100 bg-emerald-50 shadow-none">
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Forecast profit</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-950">{formatCurrency(record.monthEndProjectedProfit)}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-slate-200 bg-slate-50 shadow-none">
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-600">Outstanding receivable</p>
                    <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(record.outstandingReceivable)}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-amber-100 bg-amber-50 shadow-none">
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Data freshness</p>
                    <p className="mt-2 text-lg font-bold text-amber-950">{formatDate(record.freshness)}</p>
                  </CardContent>
                </Card>
              </div>
            </div>

            <MarginBridgeChart record={record} />
          </div>
        </section>

        <PnlExecutiveKpiStrip items={kpiItems} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <TabsList className="h-auto flex-wrap justify-start rounded-2xl bg-slate-100 p-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="workforce">Workforce</TabsTrigger>
            <TabsTrigger value="people-cost">People cost</TabsTrigger>
            <TabsTrigger value="direct-cost">Direct cost</TabsTrigger>
            <TabsTrigger value="indirect">Indirect</TabsTrigger>
            <TabsTrigger value="trend">Trend</TabsTrigger>
            <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Executive readout</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <div className="flex justify-between"><span>Contracted seats</span><span className="font-semibold">{record.contractedSeats ?? "-"}</span></div>
                  <div className="flex justify-between"><span>Required roster HC</span><span className="font-semibold">{record.requiredRosterHc}</span></div>
                  <div className="flex justify-between"><span>Actual buffer</span><span className="font-semibold">{record.actualBufferPct?.toFixed(1) ?? "0.0"}%</span></div>
                  <div className="flex justify-between"><span>Revenue per billable seat</span><span className="font-semibold">{formatCurrency(record.billableHc > 0 ? record.revenueMtd / record.billableHc : 0)}</span></div>
                  <div className="flex justify-between"><span>Loaded cost per billable seat</span><span className="font-semibold">{formatCurrency(record.billableHc > 0 ? record.totalCost / record.billableHc : 0)}</span></div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Driver ranking</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-emerald-700">Positive contributors</p>
                    {(overview.topPositiveContributors ?? []).map((item, index: number) => (
                      <div key={index} className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                        <p className="text-sm text-slate-700">{item.label}</p>
                        <p className="text-base font-semibold text-emerald-900">{formatCurrency(item.value)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-rose-700">Negative contributors</p>
                    {(overview.topNegativeContributors ?? []).map((item, index: number) => (
                      <div key={index} className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                        <p className="text-sm text-slate-700">{item.label}</p>
                        <p className="text-base font-semibold text-rose-900">{formatCurrency(item.value)}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="revenue" className="space-y-5">
            {!revenueQuery.data ? <SectionSkeleton /> : <>
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Revenue summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <div className="flex justify-between"><span>Recognized revenue</span><span className="font-semibold">{formatCurrency(revenueQuery.data.summary.recognizedRevenue)}</span></div>
                  <div className="flex justify-between"><span>Invoiced revenue</span><span className="font-semibold">{formatCurrency(revenueQuery.data.summary.invoicedRevenue)}</span></div>
                  <div className="flex justify-between"><span>Collected revenue</span><span className="font-semibold">{formatCurrency(revenueQuery.data.summary.collectedRevenue)}</span></div>
                  <div className="flex justify-between"><span>Outstanding receivable</span><span className="font-semibold">{formatCurrency(revenueQuery.data.summary.outstandingReceivable)}</span></div>
                  <div className="flex justify-between"><span>Forecast revenue</span><span className="font-semibold">{formatCurrency(revenueQuery.data.summary.forecastRevenue)}</span></div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Commercial contract</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                  <div><span className="block text-xs uppercase tracking-[0.16em] text-slate-500">Contract</span>{revenueQuery.data.contract?.contract_name ?? "Not configured"}</div>
                  <div><span className="block text-xs uppercase tracking-[0.16em] text-slate-500">Billing model</span>{revenueQuery.data.contract?.billing_type ?? record.billingModel ?? "Unknown"}</div>
                  <div><span className="block text-xs uppercase tracking-[0.16em] text-slate-500">Rate</span>{formatCurrency(Number(revenueQuery.data.contract?.billing_rate ?? 0))}</div>
                  <div><span className="block text-xs uppercase tracking-[0.16em] text-slate-500">Minimum commitment</span>{revenueQuery.data.contract?.monthly_minimum_commitment ?? "-"}</div>
                </CardContent>
              </Card>
            </div>
            <DataTable
              columns={[
                { key: "invoice_ref", label: "Invoice" },
                { key: "period_from", label: "From" },
                { key: "period_to", label: "To" },
                { key: "billable_units", label: "Units", align: "right" },
                { key: "rate", label: "Rate", align: "right" },
                { key: "net_amount", label: "Net amount", align: "right" },
                { key: "status", label: "Status" },
              ]}
              rows={revenueQuery.data.invoices}
            />
            </>}
          </TabsContent>

          <TabsContent value="workforce" className="space-y-5">
            {!workforceQuery.data || !peopleCostQuery.data ? <SectionSkeleton tall /> : <>
            <WorkforceCostBridge
              metrics={{
                ...workforceQuery.data.metrics,
                salaryMtd: peopleCostQuery.data.summary.salaryMtd,
                loadedCostPerBillableSeat: record.billableHc > 0 ? record.totalCost / record.billableHc : 0,
              }}
            />
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-950">Workforce deployment</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(workforceQuery.data.metrics).map(([key, value]) => (
                  <div key={key} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{key.replace(/([A-Z])/g, " $1")}</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{value ?? "-"}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <DataTable
              columns={[
                { key: "employee_code", label: "Employee code" },
                { key: "full_name", label: "Employee" },
                { key: "designation_name", label: "Designation" },
                { key: "date_of_joining", label: "Joined" },
                { key: "employment_status", label: "Status" },
              ]}
              rows={workforceQuery.data.employees}
            />
            </>}
          </TabsContent>

          <TabsContent value="people-cost" className="space-y-5">
            {!peopleCostQuery.data ? <SectionSkeleton tall /> : <>
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-950">People cost source</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm text-slate-700">
                <span>Loaded from {peopleCostQuery.data.source}</span>
                <span className="font-semibold">{formatCurrency(peopleCostQuery.data.summary.directPeopleCost)}</span>
              </CardContent>
            </Card>
            <DataTable
              columns={[
                { key: "employee_code", label: "Employee code" },
                { key: "full_name", label: "Employee" },
                { key: "designation_name", label: "Designation" },
                { key: "gross_salary", label: "Gross", align: "right" },
                { key: "pf_employer", label: "Employer PF", align: "right" },
                { key: "esic_employer", label: "Employer ESIC", align: "right" },
                { key: "loaded_cost", label: "Loaded cost", align: "right" },
              ]}
              rows={peopleCostQuery.data.employees}
            />
            </>}
          </TabsContent>

          <TabsContent value="direct-cost" className="space-y-5">
            {!directCostQuery.data ? <SectionSkeleton tall /> : <>
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-950">Direct non-people cost</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">People cost</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(directCostQuery.data.summary.directPeopleCost)}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Expense claims</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(directCostQuery.data.summary.directExpenseCost)}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Vendor and GRN cost</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(directCostQuery.data.summary.directVendorCost)}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Non-people cost</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(directCostQuery.data.summary.directNonPeopleCost)}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardContent className="flex items-center justify-between p-4 text-sm text-slate-700">
                <span>Total direct cost</span>
                <span className="text-xl font-semibold text-slate-950">{formatCurrency(directCostQuery.data.summary.directCost)}</span>
              </CardContent>
            </Card>
            <DataTable
              columns={[
                { key: "sourceType", label: "Source" },
                { key: "reference", label: "Reference" },
                { key: "entryDate", label: "Entry date" },
                { key: "category", label: "Category" },
                { key: "subCategory", label: "Sub-category" },
                { key: "vendorName", label: "Vendor" },
                { key: "amount", label: "Amount", align: "right" },
                { key: "status", label: "Status" },
                { key: "costClass", label: "Class" },
              ]}
              rows={directCostQuery.data.expenses}
            />
            </>}
          </TabsContent>

          <TabsContent value="indirect" className="space-y-5">
            {!indirectAllocationQuery.data ? <SectionSkeleton /> : <>
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-950">Branch overhead allocation</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Branch pool</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(indirectAllocationQuery.data.summary.branchPoolAmount)}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Process allocation</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(indirectAllocationQuery.data.summary.processAllocationAmount)}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Allocation share</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{indirectAllocationQuery.data.summary.processAllocationPct.toFixed(1)}%</p>
                </div>
              </CardContent>
            </Card>
            <DataTable
              columns={[
                { key: "category", label: "Category" },
                { key: "subCategory", label: "Sub-category" },
                { key: "branchPoolAmount", label: "Branch pool", align: "right" },
                { key: "processAllocationPct", label: "Allocation %", align: "right" },
                { key: "processAllocationAmount", label: "Allocated", align: "right" },
              ]}
              rows={indirectAllocationQuery.data.pools}
            />
            </>}
          </TabsContent>

          <TabsContent value="trend" className="space-y-5">
            {!trendQuery.data ? <SectionSkeleton tall /> : <ProfitabilityTrendChart trend={trendQuery.data.trend} />}
          </TabsContent>

          <TabsContent value="reconciliation" className="space-y-5">
            {!reconciliationQuery.data ? <SectionSkeleton /> : <>
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-950">Control checks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                  <span>Overall reconciliation</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(reconciliationQuery.data.status)}`}>
                    {reconciliationQuery.data.status}
                  </span>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Last fresh input: {formatDate(reconciliationQuery.data.freshness)}
                </div>
                {reconciliationQuery.data.issues.map((issue) => (
                  <div key={issue.code} className={`rounded-2xl border px-4 py-3 text-sm ${issue.severity === "critical" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    <p className="font-semibold">{issue.code}</p>
                    <p className="mt-1">{issue.message}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            </>}
          </TabsContent>

          <TabsContent value="ledger" className="space-y-5">
            {!ledgerQuery.data ? <SectionSkeleton tall /> : <>
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
                  <FileText className="h-4 w-4" />
                  Financial ledger view
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-slate-700 sm:grid-cols-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Revenue</p><p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(ledgerQuery.data.summary.revenue)}</p></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Direct cost</p><p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(ledgerQuery.data.summary.directCost)}</p></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Indirect cost</p><p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(ledgerQuery.data.summary.indirectCost)}</p></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Operating profit</p><p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(ledgerQuery.data.summary.operatingProfit)}</p></div>
              </CardContent>
            </Card>
            <DataTable
              columns={[
                { key: "entryType", label: "Type" },
                { key: "reference", label: "Reference" },
                { key: "entryDate", label: "Date" },
                { key: "amount", label: "Amount", align: "right" },
                { key: "status", label: "Status" },
              ]}
              rows={ledgerQuery.data.entries}
            />
            </>}
          </TabsContent>
        </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
