import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Banknote,
  BriefcaseBusiness,
  Building2,
  Download,
  Filter,
  Gauge,
  ReceiptIndianRupee,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useProcessPnl } from "@/hooks/useProcessPnl";
import { downloadBpoPnlExport, useBpoProcessPnl } from "@/hooks/useBpoProcessPnl";
import { PnlExecutiveKpiStrip } from "@/components/finance/pnl/PnlExecutiveKpiStrip";
import { PnlWaterfallChart } from "@/components/finance/pnl/PnlWaterfallChart";
import { ProfitabilityTrendChart } from "@/components/finance/pnl/ProfitabilityTrendChart";
import { PnlDataQualityPanel } from "@/components/finance/pnl/PnlDataQualityPanel";
import { BpoPnlMatrixTable } from "@/components/finance/pnl/BpoPnlMatrixTable";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number | null | undefined, compact = false) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value ?? 0);
}

function percent(value: number | null | undefined) {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

function MixBar({ label, value, total }: { label: string; value: number; total: number }) {
  const width = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="font-bold text-slate-900">{formatCurrency(value, true)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-800" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function ProcessPnlPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const branchId = searchParams.get("branchId") ?? "";
  const clientId = searchParams.get("clientId") ?? "";
  const search = searchParams.get("search") ?? "";
  const [draftSearch, setDraftSearch] = useState(search);

  const filters = {
    period,
    branchId: branchId || undefined,
    clientId: clientId || undefined,
    search: search || undefined,
  };
  const bpoQuery = useBpoProcessPnl(filters);
  const { summaryQuery: legacySummaryQuery } = useProcessPnl(filters);
  const summary = bpoQuery.data;
  const rows = summary?.rows ?? [];
  const branches = Array.from(
    new Map(rows.filter((row) => row.branchId).map((row) => [row.branchId as string, row.branchName ?? "Unassigned"])).entries()
  );
  const clients = Array.from(
    new Map(rows.filter((row) => row.clientId).map((row) => [row.clientId as string, row.clientName ?? "Unmapped"])).entries()
  );

  function updateFilters(next: { period?: string; branchId?: string; clientId?: string; search?: string }) {
    const params = new URLSearchParams(searchParams);
    const entries = { period, branchId, clientId, search, ...next };
    Object.entries(entries).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    setSearchParams(params);
  }

  const kpiItems = summary
    ? [
        { label: "Recognized revenue", value: summary.kpis.recognizedRevenue, kind: "currency" as const, tone: "good" as const },
        { label: "Agent salary", value: summary.kpis.agentSalary, kind: "currency" as const },
        { label: "Agent salary / revenue", value: summary.kpis.agentSalaryPctRevenue ?? 0, kind: "percent" as const },
        { label: "Direct Service Cost", value: summary.kpis.dsc, kind: "currency" as const, tone: "warning" as const },
        { label: "DSC / revenue", value: summary.kpis.dscPctRevenue ?? 0, kind: "percent" as const },
        { label: "Branch Management Cost", value: summary.kpis.bmc, kind: "currency" as const, tone: "warning" as const },
        { label: "BMC / revenue", value: summary.kpis.bmcPctRevenue ?? 0, kind: "percent" as const },
        {
          label: "EBITDA",
          value: summary.kpis.ebitda,
          kind: "currency" as const,
          tone: summary.kpis.ebitda >= 0 ? ("good" as const) : ("danger" as const),
        },
        {
          label: "EBITDA margin",
          value: summary.kpis.ebitdaMarginPct ?? 0,
          kind: "percent" as const,
          tone: (summary.kpis.ebitdaMarginPct ?? 0) >= 0 ? ("good" as const) : ("danger" as const),
        },
        {
          label: "Operating profit",
          value: summary.kpis.operatingProfit,
          kind: "currency" as const,
          tone: summary.kpis.operatingProfit >= 0 ? ("good" as const) : ("danger" as const),
        },
        { label: "PBT", value: summary.kpis.pbt, kind: "currency" as const },
        { label: "PAT", value: summary.kpis.pat, kind: "currency" as const },
      ]
    : [];

  const totalRevenueMix = summary
    ? summary.revenueMix.baseRevenue
      + summary.revenueMix.minimumCommitment
      + summary.revenueMix.incentivesAndRewards
      + summary.revenueMix.trainingAndOtherRevenue
    : 0;
  const totalCostMix = summary
    ? summary.costMix.agentSalary
      + summary.costMix.dscPeople
      + summary.costMix.dscNonPeople
      + summary.costMix.bmcPeople
      + summary.costMix.bmcNonPeople
    : 0;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_28%),linear-gradient(180deg,_#f6f8f7_0%,_#ffffff_42%,_#f4f7fb_100%)]">
        <div className="mx-auto max-w-[1800px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
            <div className="grid gap-8 p-6 xl:grid-cols-[1.5fr_1fr] xl:p-8">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
                  <TrendingUp className="h-3.5 w-3.5" />
                  BPO Process P&amp;L Command Centre
                </div>
                <div>
                  <h1 className="max-w-4xl text-3xl font-black tracking-tight sm:text-4xl">
                    Complete commercial truth from mandate and delivery to EBITDA, PBT and PAT.
                  </h1>
                  <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300 sm:text-base">
                    Every process is evaluated through its own billing logic—seat, FTE, productive hour, login hour, talk minute, transaction, mandate, case, fixed fee or outcome—then reconciled with payroll, DSC, BMC, GRN/vendor actuals and approved budgets.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">
                    <Link to={`/finance/process-pnl/configuration?period=${period}`}>Configure contracts &amp; revenue logic</Link>
                  </Button>
                  <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                    <Link to={`/finance/branch-budget?period=${period}`}>Open branch budgets</Link>
                  </Button>
                  <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                    <Link to={`/finance/process-pnl/period-close?period=${period}`}>Period close &amp; sign-off</Link>
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => void downloadBpoPnlExport(filters)}
                  >
                    <Download className="mr-2 h-4 w-4" /> Export full P&amp;L
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="border-white/10 bg-white/5 text-white shadow-none">
                  <CardContent className="p-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Revenue model coverage</p>
                    <p className="mt-2 text-3xl font-black">{percent(summary?.kpis.revenueModelCoveragePct)}</p>
                    <p className="mt-2 text-xs text-slate-300">
                      {summary?.kpis.configuredProcesses ?? 0} of {summary?.kpis.totalProcesses ?? 0} processes configured
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none">
                  <CardContent className="p-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Revenue at risk</p>
                    <p className="mt-2 text-3xl font-black text-amber-200">{formatCurrency(summary?.kpis.revenueAtRisk, true)}</p>
                    <p className="mt-2 text-xs text-slate-300">Delivery, SLA and commercial leakage exposure</p>
                  </CardContent>
                </Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none">
                  <CardContent className="p-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Available budget</p>
                    <p className={`mt-2 text-3xl font-black ${(summary?.kpis.availableBudget ?? 0) >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                      {formatCurrency(summary?.kpis.availableBudget, true)}
                    </p>
                    <p className="mt-2 text-xs text-slate-300">After GRN reservations and consumption</p>
                  </CardContent>
                </Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none">
                  <CardContent className="p-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Loss-making processes</p>
                    <p className="mt-2 text-3xl font-black text-rose-200">{summary?.kpis.lossMakingProcesses ?? 0}</p>
                    <p className="mt-2 text-xs text-slate-300">Processes with negative EBITDA</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Filter className="h-4 w-4" /> Financial filters
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period</label>
                <Input type="month" value={period} onChange={(event) => updateFilters({ period: event.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Branch</label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={branchId} onChange={(event) => updateFilters({ branchId: event.target.value || undefined })}>
                  <option value="">All branches</option>
                  {branches.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Client</label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={clientId} onChange={(event) => updateFilters({ clientId: event.target.value || undefined })}>
                  <option value="">All clients</option>
                  {clients.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Search</label>
                <div className="flex gap-2">
                  <Input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Process, client, branch or cost centre" />
                  <Button onClick={() => updateFilters({ search: draftSearch || undefined })}>Apply</Button>
                </div>
              </div>
            </div>
          </section>

          {bpoQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-3xl" />)}
            </div>
          ) : (
            <PnlExecutiveKpiStrip items={kpiItems} />
          )}

          {summary ? (
            <div className="grid gap-5 xl:grid-cols-3">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Banknote className="h-4 w-4 text-emerald-600" /> Complete revenue bridge
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <MixBar label="Base billing" value={summary.revenueMix.baseRevenue} total={totalRevenueMix} />
                  <MixBar label="Minimum commitment top-up" value={summary.revenueMix.minimumCommitment} total={totalRevenueMix} />
                  <MixBar label="Incentives & rewards" value={summary.revenueMix.incentivesAndRewards} total={totalRevenueMix} />
                  <MixBar label="Training & other revenue" value={summary.revenueMix.trainingAndOtherRevenue} total={totalRevenueMix} />
                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs">
                    <div className="rounded-2xl bg-rose-50 p-3"><p className="text-rose-600">Penalty & SLA</p><p className="mt-1 font-bold text-rose-800">{formatCurrency(summary.revenueMix.penaltiesAndSla, true)}</p></div>
                    <div className="rounded-2xl bg-amber-50 p-3"><p className="text-amber-700">Credit notes</p><p className="mt-1 font-bold text-amber-900">{formatCurrency(summary.revenueMix.creditNotesAndOtherDeductions, true)}</p></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UsersRound className="h-4 w-4 text-amber-600" /> BPO cost stack
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <MixBar label="Agent salary" value={summary.costMix.agentSalary} total={totalCostMix} />
                  <MixBar label="DSC people" value={summary.costMix.dscPeople} total={totalCostMix} />
                  <MixBar label="DSC non-people" value={summary.costMix.dscNonPeople} total={totalCostMix} />
                  <MixBar label="BMC people" value={summary.costMix.bmcPeople} total={totalCostMix} />
                  <MixBar label="BMC non-people" value={summary.costMix.bmcNonPeople} total={totalCostMix} />
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    GRN/vendor actual included: <span className="font-bold text-slate-900">{formatCurrency(summary.kpis.grnVendorActual)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gauge className="h-4 w-4 text-violet-600" /> Commercial realization
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold text-emerald-700">Potential</p><p className="mt-1 text-xl font-black text-emerald-950">{formatCurrency(summary.kpis.grossPotentialRevenue, true)}</p></div>
                  <div className="rounded-2xl bg-sky-50 p-4"><p className="text-xs font-semibold text-sky-700">Earned</p><p className="mt-1 text-xl font-black text-sky-950">{formatCurrency(summary.kpis.earnedRevenue, true)}</p></div>
                  <div className="rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-semibold text-indigo-700">Invoiced</p><p className="mt-1 text-xl font-black text-indigo-950">{formatCurrency(summary.kpis.invoicedRevenue, true)}</p></div>
                  <div className="rounded-2xl bg-teal-50 p-4"><p className="text-xs font-semibold text-teal-700">Collected</p><p className="mt-1 text-xl font-black text-teal-950">{formatCurrency(summary.kpis.collectedRevenue, true)}</p></div>
                  <div className="rounded-2xl bg-amber-50 p-4"><p className="text-xs font-semibold text-amber-700">Unbilled</p><p className="mt-1 text-xl font-black text-amber-950">{formatCurrency(summary.kpis.unbilledRevenue, true)}</p></div>
                  <div className="rounded-2xl bg-rose-50 p-4"><p className="text-xs font-semibold text-rose-700">Outstanding</p><p className="mt-1 text-xl font-black text-rose-950">{formatCurrency(summary.kpis.outstandingReceivable, true)}</p></div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            {summary ? (
              <PnlWaterfallChart
                revenue={summary.kpis.recognizedRevenue}
                directCost={summary.kpis.agentSalary + summary.kpis.dsc}
                indirectCost={summary.kpis.bmc}
                profit={summary.kpis.ebitda}
              />
            ) : <Skeleton className="h-72 rounded-3xl" />}
            {summary ? <PnlDataQualityPanel alerts={summary.alerts} /> : <Skeleton className="h-72 rounded-3xl" />}
          </div>

          {legacySummaryQuery.data ? (
            <ProfitabilityTrendChart trend={legacySummaryQuery.data.trend} />
          ) : (
            <Skeleton className="h-96 rounded-3xl" />
          )}

          {bpoQuery.isLoading ? <Skeleton className="h-[620px] rounded-3xl" /> : <BpoPnlMatrixTable rows={rows} period={period} />}

          <section className="grid gap-4 lg:grid-cols-4">
            <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="p-5"><Building2 className="h-5 w-5 text-slate-500" /><p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">Active headcount</p><p className="mt-1 text-2xl font-black">{summary?.kpis.activeHeadcount ?? 0}</p></CardContent></Card>
            <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="p-5"><BriefcaseBusiness className="h-5 w-5 text-slate-500" /><p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">Agent headcount</p><p className="mt-1 text-2xl font-black">{summary?.kpis.agentHeadcount ?? 0}</p></CardContent></Card>
            <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="p-5"><ReceiptIndianRupee className="h-5 w-5 text-slate-500" /><p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">Approved budget</p><p className="mt-1 text-2xl font-black">{formatCurrency(summary?.kpis.approvedBudget, true)}</p></CardContent></Card>
            <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="p-5"><Gauge className="h-5 w-5 text-slate-500" /><p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">People cost / revenue</p><p className="mt-1 text-2xl font-black">{percent(summary?.kpis.peopleCostPctRevenue)}</p></CardContent></Card>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
