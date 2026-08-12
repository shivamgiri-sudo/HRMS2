import { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { downloadBpoPnlExport, useBpoProcessPnl } from "@/hooks/useBpoProcessPnl";
import { usePnlStatement, type PnlStatementViewBy } from "@/hooks/usePnlStatement";
import { CeoOverviewPanel } from "@/components/finance/pnl/CeoOverviewPanel";
import { PnlStatementView } from "@/components/finance/pnl/PnlStatementView";
import { PnlExecutiveKpiStrip } from "@/components/finance/pnl/PnlExecutiveKpiStrip";
import { BpoPnlMatrixTable } from "@/components/finance/pnl/BpoPnlMatrixTable";
import { ProcessPnlAlertsWorkspace } from "@/components/finance/pnl/ProcessPnlAlertsWorkspace";
import { ProcessPnlMatrixToolbar } from "@/components/finance/pnl/ProcessPnlMatrixToolbar";
import { getIssueCounts, type ProcessPnlDensity, type ProcessPnlIssueFilter, type ProcessPnlMatrixPreset, type ProcessPnlStatusFilter } from "@/components/finance/pnl/processPnlMatrixConfig";

const MATRIX_VIEW_STORAGE_KEY = "process-pnl-matrix:view";

const matrixPresets: ProcessPnlMatrixPreset[] = ["summary", "revenue", "cost", "profitability", "budget-risk", "full"];
const matrixStatusFilters: ProcessPnlStatusFilter[] = ["all", "profitable", "at-risk", "loss-making"];
const matrixIssueFilters: ProcessPnlIssueFilter[] = [
  "all",
  "revenue-at-risk",
  "delivery-missing",
  "budget-exceeded",
  "high-receivable",
  "accounting-fallback",
];
const matrixDensities: ProcessPnlDensity[] = ["comfortable", "compact"];

/**
 * The month the page opens on.
 *
 * It used to open on the CURRENT calendar month, which on 4 August meant August 2026: Rs 6.05 lakh
 * of invoicing, no payroll run at all, Rs 2.00 lakh of GRN. A CEO opening the P&L saw revenue
 * against no cost and concluded the arithmetic was broken, when the month had simply barely
 * started — payroll runs at month end and invoicing lags delivery.
 *
 * Opens on the previous month instead, which is the month a finance review is actually about.
 * The picker is unchanged, so any month is still one click away.
 */
function defaultPeriod() {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number | null | undefined, compact = false) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value ?? 0);
}

export default function ProcessPnlPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? defaultPeriod();
  const branchId = searchParams.get("branchId") ?? "";
  const clientId = searchParams.get("clientId") ?? "";
  const search = searchParams.get("search") ?? "";
  const [draftSearch, setDraftSearch] = useState(search);
  const [activeTab, setActiveTab] = useState<"overview" | "matrix" | "statement" | "alerts">("overview");
  const [statementViewBy, setStatementViewBy] = useState<PnlStatementViewBy>("process");
  const [matrixPreset, setMatrixPreset] = useState<ProcessPnlMatrixPreset>("summary");
  const [statusFilter, setStatusFilter] = useState<ProcessPnlStatusFilter>("all");
  const [issueFilter, setIssueFilter] = useState<ProcessPnlIssueFilter>("all");
  const [matrixDensity, setMatrixDensity] = useState<ProcessPnlDensity>("comfortable");
  const [matrixViewReady, setMatrixViewReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(MATRIX_VIEW_STORAGE_KEY) ?? "null") as Partial<{
        preset: ProcessPnlMatrixPreset;
        status: ProcessPnlStatusFilter;
        issue: ProcessPnlIssueFilter;
        density: ProcessPnlDensity;
      }> | null;
      if (saved?.preset && matrixPresets.includes(saved.preset)) setMatrixPreset(saved.preset);
      if (saved?.status && matrixStatusFilters.includes(saved.status)) setStatusFilter(saved.status);
      if (saved?.issue && matrixIssueFilters.includes(saved.issue)) setIssueFilter(saved.issue);
      if (saved?.density && matrixDensities.includes(saved.density)) setMatrixDensity(saved.density);
    } catch {
      // Ignore malformed or unavailable browser storage and use defaults.
    }
    setMatrixViewReady(true);
  }, []);

  useEffect(() => {
    if (!matrixViewReady) return;
    try {
      window.localStorage.setItem(MATRIX_VIEW_STORAGE_KEY, JSON.stringify({
        preset: matrixPreset,
        status: statusFilter,
        issue: issueFilter,
        density: matrixDensity,
      }));
    } catch {
      console.debug("Unable to persist matrix view preferences");
    }
  }, [matrixDensity, matrixPreset, matrixViewReady, issueFilter, statusFilter]);

  const filters = {
    period,
    branchId: branchId || undefined,
    clientId: clientId || undefined,
    search: search || undefined,
  };
  const bpoQuery = useBpoProcessPnl(filters);
  const statementQuery = usePnlStatement(filters, statementViewBy);
  const summary = bpoQuery.data;
  const rows = summary?.rows ?? [];
  /*
   * Filter options accumulate; they are never rebuilt from the filtered rows alone.
   *
   * `rows` is the API response for the CURRENT filters, so deriving the dropdowns from it made
   * them self-narrowing: choosing Mumbai collapsed the branch list to ["All branches", "Mumbai"],
   * and reaching Pune meant going back through "All branches" and waiting out the query twice —
   * on a page whose own comment records it taking 16-23s.
   *
   * Everything seen since the page mounted stays selectable. An option that no longer matches
   * any row simply returns nothing when chosen, which is the same outcome as any other empty
   * filter, and far better than being unable to select it at all.
   */
  const seenBranches = useRef(new Map<string, string>());
  const seenClients = useRef(new Map<string, string>());
  for (const row of rows) {
    if (row.branchId) seenBranches.current.set(row.branchId as string, row.branchName ?? "Unassigned");
    if (row.clientId) seenClients.current.set(row.clientId as string, row.clientName ?? "Unmapped");
  }
  const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
  const branches = Array.from(seenBranches.current.entries()).sort(byLabel);
  const clients = Array.from(seenClients.current.entries()).sort(byLabel);

  function updateFilters(next: { period?: string; branchId?: string; clientId?: string; search?: string }) {
    const params = new URLSearchParams(searchParams);
    const entries = { period, branchId, clientId, search, ...next };
    Object.entries(entries).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    setSearchParams(params);
  }

  /*
   * FALLBACK: use the statement's figures when the process engine has nothing to say.
   *
   * The headline KPIs come from bpoPnlService, which is driven by process_revenue_rule,
   * process_delivery_actual, process_revenue_component and process_monthly_plan. All four hold
   * ZERO rows today, so it returns headcount and nothing else — 975 active staff in June against
   * Rs 0 revenue, Rs 0 EBITDA, Rs 0 PAT — identically in every month, including the open one.
   *
   * Rs 0 is not the cautious answer here, it is a false one: June invoiced Rs 344.26 lakh, and
   * the statement knows it. A tab named "CEO Overview" that reports no revenue for a company
   * with 975 people on payroll is worse than one that reports the real figure from a second
   * source, so when the process engine returns nothing we fall back to the statement.
   *
   * Never silently: `kpiSource` drives a badge saying where the numbers came from. Otherwise
   * this quietly hides that the process-level configuration was never done, and nobody ever
   * fills those four tables in.
   */
  const statementTotal = (componentKey: string): number | null => {
    const rows = statementQuery.data?.rows;
    const columns = statementQuery.data?.columns;
    if (!rows || !columns) return null;
    const row = rows.find((r) => r.componentKey === componentKey);
    if (!row) return null;
    return columns.reduce((total, column) => total + Number(row.values[column.id] ?? 0), 0);
  };

  const bpoHasMoney = Boolean(summary) && [
    summary?.kpis.recognizedRevenue, summary?.kpis.agentSalary,
    summary?.kpis.dsc, summary?.kpis.bmc,
  ].some((v) => Math.abs(Number(v ?? 0)) > 0.5);

  const fallbackRevenue = statementTotal("recognized_revenue");
  const useStatementFallback = Boolean(summary) && !bpoHasMoney
    && fallbackRevenue !== null && Math.abs(fallbackRevenue) > 0.5;
  const kpiSource: "process" | "statement" = useStatementFallback ? "statement" : "process";

  const pct = (part: number | null, whole: number | null) =>
    part !== null && whole !== null && whole !== 0 ? (part / whole) * 100 : 0;

  /*
   * Component keys, verified against finance_pnl_component_master rather than assumed. The cost
   * lines are total_dsc / total_bmc — there is no plain "dsc" or "bmc" component, and reading
   * those would have yielded 0, showing full revenue against no support cost and a hugely
   * overstated Operating Profit. Operating Profit uses total_cost, which already includes IDC,
   * instead of adding the three people lines and quietly dropping it.
   */
  const agentSalaryV = useStatementFallback ? (statementTotal("agent_salary") ?? 0) : summary?.kpis.agentSalary ?? 0;
  const dscV = useStatementFallback ? (statementTotal("total_dsc") ?? 0) : summary?.kpis.dsc ?? 0;
  const bmcV = useStatementFallback ? (statementTotal("total_bmc") ?? 0) : summary?.kpis.bmc ?? 0;
  const revenueV = useStatementFallback ? (fallbackRevenue ?? 0) : summary?.kpis.recognizedRevenue ?? 0;
  const opV = useStatementFallback
    ? revenueV - (statementTotal("total_cost") ?? 0)
    : summary?.kpis.operatingProfit ?? 0;

  const kpiItems = summary
    ? [
        { label: "Recognized revenue", value: revenueV, kind: "currency" as const, tone: "good" as const },
        { label: "Agent salary", value: agentSalaryV, kind: "currency" as const },
        { label: "Agent salary / revenue", value: useStatementFallback ? pct(agentSalaryV, revenueV) : summary.kpis.agentSalaryPctRevenue ?? 0, kind: "percent" as const },
        { label: "Direct Service Cost", value: dscV, kind: "currency" as const, tone: "warning" as const },
        { label: "DSC / revenue", value: useStatementFallback ? pct(dscV, revenueV) : summary.kpis.dscPctRevenue ?? 0, kind: "percent" as const },
        { label: "Branch Management Cost", value: bmcV, kind: "currency" as const, tone: "warning" as const },
        { label: "BMC / revenue", value: useStatementFallback ? pct(bmcV, revenueV) : summary.kpis.bmcPctRevenue ?? 0, kind: "percent" as const },
        // EBITDA and its margin come from the engine the fallback exists BECAUSE it returns
        // nothing, so under the fallback they are ~0 while Revenue and Operating Profit beside
        // them are real. That is the same contradiction the PBT/PAT note below was written to
        // avoid, one tile to the left: a strip reading "Revenue Rs 3.44 Cr, Operating profit
        // positive, EBITDA Rs 0, EBITDA margin 0.0%". Omitted under the fallback for the same
        // reason, rather than printed as a confident zero.
        ...(useStatementFallback ? [] : [
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
        ]),
        {
          label: "Operating profit",
          value: opV,
          kind: "currency" as const,
          tone: opV >= 0 ? ("good" as const) : ("danger" as const),
        },
        // PBT and PAT need finance cost and tax, which the statement fallback has no source for.
        // Showing them as Rs 0 beside a real Operating Profit would read as "we made a profit and
        // then lost all of it", so they are omitted entirely when the fallback is in use.
        ...(useStatementFallback ? [] : [
          { label: "PBT", value: summary.kpis.pbt, kind: "currency" as const },
          { label: "PAT", value: summary.kpis.pat, kind: "currency" as const },
        ]),
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
                  Revenue: <b className="text-slate-900">{formatCurrency(revenueV, true)}</b>
                </span>
                {kpiSource === "statement" && (
                  // Never switch engines silently: without this the process-level configuration
                  // looks complete because the numbers look right.
                  <span
                    className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200"
                    title="Process-level revenue rules, delivery actuals, revenue components and monthly plans hold no rows, so the process engine reports zero. These figures come from the P&L Statement (invoiced revenue and payroll) instead. Configure the process tables to drive them from delivery."
                  >
                    from P&amp;L Statement
                  </span>
                )}
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
          <MonthYearPicker
            value={period}
            onChange={(v) => updateFilters({ period: v })}
            className="w-52"
          />
          <select
            className="flex h-8 rounded-md border border-input bg-background px-2 py-0 text-xs"
            value={branchId}
            onChange={(e) => updateFilters({ branchId: e.target.value || undefined })}
          >
            <option value="">All branches</option>
            {branches.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="flex h-8 rounded-md border border-input bg-background px-2 py-0 text-xs"
            value={clientId}
            onChange={(e) => updateFilters({ clientId: e.target.value || undefined })}
          >
            <option value="">All clients</option>
            {clients.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Input
            className="h-8 w-48 text-xs"
            placeholder="Search process..."
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => updateFilters({ search: draftSearch || undefined })}
          >
            Apply
          </Button>
        </div>

        {/* Always-visible KPI strip */}
        <div className="border-b px-4 py-2 shrink-0 overflow-x-auto">
          {bpoQuery.isLoading ? (
            <div className="flex gap-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-36 rounded-xl shrink-0" />)}
            </div>
          ) : (
            <PnlExecutiveKpiStrip items={kpiItems} compact />
          )}
        </div>

        {/* Tab layout: CEO Overview (default) + Process Matrix + Alerts & Reconciliation */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 w-fit shrink-0">
            <TabsTrigger value="overview">CEO Overview</TabsTrigger>
            <TabsTrigger value="matrix">Process Matrix</TabsTrigger>
            <TabsTrigger value="statement">P&amp;L Statement</TabsTrigger>
            <TabsTrigger value="alerts">Alerts &amp; Reconciliation</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-auto px-4 py-3 m-0">
            {/*
              NOT gated on bpoQuery. That query takes 16-23 seconds and this tab no longer reads a
              single field from it — but it was still waiting on it, so the whole view sat behind
              skeletons for twenty seconds and looked like it had never been rebuilt at all.
              CeoOverviewPanel fetches its own data in about two seconds and renders its own
              loading state.
            */}
            {(
              <div className="flex flex-col gap-5">
                {/*
                  The CEO view, read from what actually happened — invoiced revenue, the payroll
                  run and GRN spend.

                  The process-level command centre is deliberately NOT rendered here, after being
                  measured rather than assumed.

                  bpoPnlService now falls back to invoiced revenue, which fixed a real artefact —
                  it had been reporting Rs 242 lakh of cost against Rs 0 revenue once the
                  information_schema fix revived the cost side. But PROCESS is not a grain this
                  data supports yet:

                    revenue   Rs 249.30L of Rs 370.84L, across 18 of 66 processes
                    indirect  Rs  62.02L of Rs  77.00L
                    people    most processes, but zero-paid and no-process staff fall outside

                  Three lines each covering a different subset of the business subtract to a figure
                  belonging to no real entity, and it would sit on this page disagreeing with the
                  branch view by Rs 121 lakh. Branch works as a grain precisely because revenue,
                  payroll and spend each resolve to a branch for essentially all of their value.

                  The fix is process_id mapping on cost centres and employees — data, not more
                  plumbing. CeoCommandCenter.tsx is untouched and still mounted nowhere else, so
                  remounting it here is a one-line change once that mapping exists.
                */}
                <CeoOverviewPanel
                  period={period}
                  branchId={branchId || undefined}
                  onBranchChange={(id) => updateFilters({ branchId: id })}
                />

              </div>
            )}
          </TabsContent>

          <TabsContent value="matrix" className="flex-1 overflow-auto px-4 py-3 m-0">
            <ProcessPnlMatrixToolbar
              preset={matrixPreset}
              status={statusFilter}
              issue={issueFilter}
              density={matrixDensity}
              issueCounts={getIssueCounts(rows)}
              onPresetChange={setMatrixPreset}
              onStatusChange={setStatusFilter}
              onIssueChange={setIssueFilter}
              onDensityChange={setMatrixDensity}
            />
            {bpoQuery.isLoading ? (
              <Skeleton className="h-96 rounded-3xl" />
            ) : (
              <BpoPnlMatrixTable
                rows={rows}
                period={period}
                preset={matrixPreset}
                status={statusFilter}
                issue={issueFilter}
                density={matrixDensity}
                search={search}
                alerts={summary?.alerts}
              />
            )}
          </TabsContent>

          <TabsContent value="statement" className="flex-1 overflow-auto px-4 py-3 m-0">
            <PnlStatementView
              statement={statementQuery.data}
              isLoading={statementQuery.isLoading}
              viewBy={statementViewBy}
              onViewByChange={setStatementViewBy}
              period={filters.period}
            />
          </TabsContent>

          <TabsContent value="alerts" className="flex-1 overflow-auto px-4 py-3 m-0">
            {bpoQuery.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-28 rounded-md" />
                <div className="grid gap-4 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-72 rounded-md" />)}
                </div>
              </div>
            ) : summary ? (
              <ProcessPnlAlertsWorkspace alerts={summary.alerts} period={period} rows={rows} />
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
