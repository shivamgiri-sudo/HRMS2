import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Filter, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProcessPnl, processPnlExportUrl } from "@/hooks/useProcessPnl";
import { PnlExecutiveKpiStrip } from "@/components/finance/pnl/PnlExecutiveKpiStrip";
import { ProcessProfitabilityTable } from "@/components/finance/pnl/ProcessProfitabilityTable";
import { PnlWaterfallChart } from "@/components/finance/pnl/PnlWaterfallChart";
import { ProfitabilityTrendChart } from "@/components/finance/pnl/ProfitabilityTrendChart";
import { PnlDataQualityPanel } from "@/components/finance/pnl/PnlDataQualityPanel";

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

export default function ProcessPnlPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const branchId = searchParams.get("branchId") ?? "";
  const clientId = searchParams.get("clientId") ?? "";
  const search = searchParams.get("search") ?? "";

  const [draftSearch, setDraftSearch] = useState(search);
  const { summaryQuery, processesQuery } = useProcessPnl({
    period,
    branchId: branchId || undefined,
    clientId: clientId || undefined,
    search: search || undefined,
  });

  const summary = summaryQuery.data;
  const processes = processesQuery.data ?? [];
  const branches = Array.from(
    new Map(processes.filter((row) => row.branchId).map((row) => [row.branchId as string, row.branchName ?? "Unassigned"])).entries()
  );
  const clients = Array.from(
    new Map(processes.filter((row) => row.clientId).map((row) => [row.clientId as string, row.clientName ?? "Unmapped"])).entries()
  );

  function updateFilters(next: { period?: string; branchId?: string; clientId?: string; search?: string }) {
    const params = new URLSearchParams(searchParams);
    const entries = {
      period,
      branchId,
      clientId,
      search,
      ...next,
    };

    Object.entries(entries).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });

    setSearchParams(params);
  }

  const kpiItems = summary
    ? [
        { label: "Organisation revenue", value: summary.kpis.organisationRevenue, kind: "currency" as const, tone: "good" as const },
        { label: "Total direct cost", value: summary.kpis.totalDirectCost, kind: "currency" as const },
        { label: "Total indirect cost", value: summary.kpis.totalIndirectCost, kind: "currency" as const, tone: "warning" as const },
        {
          label: "Operating profit",
          value: summary.kpis.operatingProfit,
          kind: "currency" as const,
          tone: summary.kpis.operatingProfit >= 0 ? ("good" as const) : ("danger" as const),
        },
        {
          label: "Operating margin",
          value: summary.kpis.operatingMarginPct ?? 0,
          kind: "percent" as const,
          tone: (summary.kpis.operatingMarginPct ?? 0) >= 10 ? ("good" as const) : ("warning" as const),
        },
        { label: "Billable headcount", value: summary.kpis.billableHeadcount, kind: "number" as const },
        {
          label: "Revenue at risk",
          value: summary.kpis.revenueAtRisk,
          kind: "currency" as const,
          tone: summary.kpis.revenueAtRisk > 0 ? ("warning" as const) : ("good" as const),
        },
        {
          label: "Projected month-end profit",
          value: summary.kpis.monthEndProjectedProfit,
          kind: "currency" as const,
          tone: summary.kpis.monthEndProjectedProfit >= 0 ? ("good" as const) : ("danger" as const),
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_28%),linear-gradient(180deg,_#f6f8f7_0%,_#ffffff_42%,_#f4f7fb_100%)]">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.6fr_0.9fr] lg:p-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
                <TrendingUp className="h-3.5 w-3.5" />
                Process P&L Command Centre
              </div>
              <div>
                <h1 className="max-w-3xl text-3xl font-black tracking-tight sm:text-4xl">
                  Finance can now read profitability process by process, not spreadsheet by spreadsheet.
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  Revenue, people cost, non-people cost, branch overhead allocation, receivable exposure and month-end profit are stitched into one command surface for CEO, Finance Head and Accounts.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">
                  <Link to={summary?.kpis.mostProfitableProcess ? `/finance/process-pnl/${summary.kpis.mostProfitableProcess.processId}?period=${period}` : "#"}>
                    Open best-performing process
                  </Link>
                </Button>
                <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                  <Link to={`/finance/process-pnl/configuration?period=${period}`}>Configure contracts and plans</Link>
                </Button>
                <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                  <Link to={`/finance/process-pnl/period-close?period=${period}`}>Open period close</Link>
                </Button>
                <Button
                  variant="outline"
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => window.open(processPnlExportUrl({ period, branchId: branchId || undefined, clientId: clientId || undefined, search: search || undefined }), "_blank")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export current view
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              <Card className="border-white/10 bg-white/5 text-white shadow-none">
                <CardContent className="p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Most profitable process</p>
                  <p className="mt-3 text-2xl font-bold">
                    {summary?.kpis.mostProfitableProcess?.processName ?? "No process data"}
                  </p>
                  <p className="mt-2 text-sm text-emerald-200">
                    {summary?.kpis.mostProfitableProcess ? formatCurrency(summary.kpis.mostProfitableProcess.value) : "Waiting for live financial inputs"}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5 text-white shadow-none">
                <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Loss-making processes</p>
                    <p className="mt-2 text-3xl font-black">{summary?.kpis.lossMakingProcesses ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Active headcount</p>
                    <p className="mt-2 text-3xl font-black">{summary?.kpis.activeHeadcount ?? 0}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Filter className="h-4 w-4" />
            Financial filters
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Period</label>
              <Input type="month" value={period} onChange={(event) => updateFilters({ period: event.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Branch</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={branchId}
                onChange={(event) => updateFilters({ branchId: event.target.value || undefined })}
              >
                <option value="">All branches</option>
                {branches.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Client</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={clientId}
                onChange={(event) => updateFilters({ clientId: event.target.value || undefined })}
              >
                <option value="">All clients</option>
                {clients.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Search</label>
              <div className="flex gap-2">
                <Input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Process, code or branch" />
                <Button onClick={() => updateFilters({ search: draftSearch || undefined })}>Apply</Button>
              </div>
            </div>
          </div>
        </section>

        {summaryQuery.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-3xl" />
            ))}
          </div>
        ) : (
          <PnlExecutiveKpiStrip items={kpiItems} />
        )}

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          {summary ? (
            <PnlWaterfallChart
              revenue={summary.kpis.organisationRevenue}
              directCost={summary.kpis.totalDirectCost}
              indirectCost={summary.kpis.totalIndirectCost}
              profit={summary.kpis.operatingProfit}
            />
          ) : (
            <Skeleton className="h-72 rounded-3xl" />
          )}

          {summary ? <PnlDataQualityPanel alerts={summary.alerts} /> : <Skeleton className="h-72 rounded-3xl" />}
        </div>

        {summary ? <ProfitabilityTrendChart trend={summary.trend} /> : <Skeleton className="h-96 rounded-3xl" />}

        {processesQuery.isLoading ? (
          <Skeleton className="h-[420px] rounded-3xl" />
        ) : (
          <ProcessProfitabilityTable rows={processes} period={period} />
        )}
      </div>
    </div>
  );
}
