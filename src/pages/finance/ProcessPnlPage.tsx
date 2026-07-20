import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        {/* Slim header */}
        <div
          className="flex items-center justify-between border-b px-4 h-12 shrink-0"
          aria-label="Complete commercial truth from mandate and delivery to EBITDA, PBT and PAT"
        >
          <h1 className="text-sm font-semibold">Process P&amp;L</h1>
          <div className="flex items-center gap-3">
            {summary && (
              <>
                <span className="text-xs text-slate-500">
                  Revenue: <b className="text-slate-900">{formatCurrency(summary.kpis.recognizedRevenue, true)}</b>
                </span>
                {(summary.kpis.lossMakingProcesses ?? 0) > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    At risk: {summary.kpis.lossMakingProcesses}
                  </Badge>
                )}
              </>
            )}
            <Button size="sm" variant="outline" onClick={() => void downloadBpoPnlExport(filters)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/finance/branch-budget?period=${period}`}>Branch budget</Link>
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 shrink-0">
          <Input
            type="month"
            value={period}
            onChange={(e) => updateFilters({ period: e.target.value })}
            className="h-7 w-36 text-xs"
          />
          <select
            className="flex h-7 rounded-md border border-input bg-background px-2 py-0 text-xs"
            value={branchId}
            onChange={(e) => updateFilters({ branchId: e.target.value || undefined })}
          >
            <option value="">All branches</option>
            {branches.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="flex h-7 rounded-md border border-input bg-background px-2 py-0 text-xs"
            value={clientId}
            onChange={(e) => updateFilters({ clientId: e.target.value || undefined })}
          >
            <option value="">All clients</option>
            {clients.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Input
            className="h-7 w-44 text-xs"
            placeholder="Search process..."
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => updateFilters({ search: draftSearch || undefined })}
          >
            Apply
          </Button>
        </div>

        {/* 3-tab layout */}
        <Tabs defaultValue="matrix" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 w-fit shrink-0">
            <TabsTrigger value="matrix">Process Matrix</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="kpis">KPI Strip</TabsTrigger>
          </TabsList>

          <TabsContent value="matrix" className="flex-1 overflow-auto px-4 py-3 m-0">
            {bpoQuery.isLoading ? (
              <Skeleton className="h-[620px] rounded-3xl" />
            ) : (
              <BpoPnlMatrixTable rows={rows} period={period} />
            )}
          </TabsContent>

          <TabsContent value="charts" className="flex-1 overflow-auto px-4 py-3 m-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {summary ? (
                <PnlWaterfallChart
                  revenue={summary.kpis.recognizedRevenue}
                  directCost={summary.kpis.agentSalary + summary.kpis.dsc}
                  indirectCost={summary.kpis.bmc}
                  profit={summary.kpis.ebitda}
                />
              ) : (
                <Skeleton className="h-72 rounded-3xl" />
              )}
              {summary ? (
                <PnlDataQualityPanel alerts={summary.alerts} />
              ) : (
                <Skeleton className="h-72 rounded-3xl" />
              )}
            </div>
            <div className="mt-4">
              {legacySummaryQuery.data ? (
                <ProfitabilityTrendChart trend={legacySummaryQuery.data.trend} />
              ) : (
                <Skeleton className="h-96 rounded-3xl" />
              )}
            </div>
          </TabsContent>

          <TabsContent value="kpis" className="flex-1 overflow-auto px-4 py-3 m-0">
            {bpoQuery.isLoading ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 12 }).map((_, index) => (
                  <Skeleton key={index} className="h-28 rounded-3xl" />
                ))}
              </div>
            ) : (
              <PnlExecutiveKpiStrip items={kpiItems} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
