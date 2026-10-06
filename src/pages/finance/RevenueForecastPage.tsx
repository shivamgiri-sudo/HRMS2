/**
 * Revenue Forecast (/finance/revenue-forecast) — owner requirement 2026-10-06.
 *
 * By the 26th of each month the Branch Head forecasts next month's revenue for every cost centre,
 * line by line. Finance Head AND Payroll Head approve; the approved forecast is OPEN and the P&L
 * counts it as revenue. After invoicing the Branch Head closes it with actuals and the P&L switches
 * to the closed amount; the table shows forecast vs closed. Backend: revenue-forecast.routes.ts.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHasRole } from "@/hooks/useUserRole";
import { useRevenueForecastList, type ApprovalState, type ForecastListRow } from "@/hooks/useRevenueForecast";
import { ForecastSheet, type SheetMode } from "@/components/finance/forecast/ForecastSheet";
import { FORECAST_STATUS_FILTERS, ForecastStatusBadge, money } from "@/components/finance/forecast/forecastUi";

/** Next month in IST — the month a Branch Head forecasts by the 26th. */
function nextPeriod(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 7);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Tile({ label, value, hint, tone = "slate" }: { label: string; value: string; hint?: string; tone?: "slate" | "blue" | "emerald" | "amber" | "rose" }) {
  const tones = {
    slate: "border-slate-200 bg-white", blue: "border-blue-200 bg-blue-50/70", emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70", rose: "border-rose-200 bg-rose-50/70",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{value}</p>
      {hint ? <p className="text-[11px] text-slate-600">{hint}</p> : null}
    </div>
  );
}

const approvalMark = (s: ApprovalState | null) => (s === "approved" ? "Approved" : s === "rejected" ? "Rejected" : s === "pending" ? "Pending" : "—");
const approvalTone = (s: ApprovalState | null) => (s === "approved" ? "text-emerald-700" : s === "rejected" ? "text-rose-700" : "text-slate-600");

export default function RevenueForecastPage() {
  const [period, setPeriod] = useState(nextPeriod());
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<{ row: ForecastListRow; mode: SheetMode; stage?: "finance_head" | "payroll_head" } | null>(null);
  const list = useRevenueForecastList(period);

  const isSuperAdmin = useHasRole("super_admin");
  const canWrite = useHasRole("super_admin", "branch_head", "branch_admin");
  const isFinanceHead = useHasRole("finance_head");
  const isPayrollHead = useHasRole("payroll_head");
  const canReopen = useHasRole("super_admin", "finance_head");

  const rows = list.data?.rows ?? [];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "overdue" ? !r.overdue : filter !== "all" && r.status !== filter) return false;
      return !q || `${r.costCentreCode} ${r.costCentreName} ${r.branchName}`.toLowerCase().includes(q);
    });
  }, [rows, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, overdue: rows.filter((r) => r.overdue).length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const sum = (pick: (r: ForecastListRow) => number | null) => rows.reduce((t, r) => t + (pick(r) ?? 0), 0);
  const openTotal = sum((r) => (r.status === "approved" ? r.forecastAmount : 0));
  const closedRows = rows.filter((r) => r.status === "closed");
  const closedTotal = closedRows.reduce((t, r) => t + (r.closedAmount ?? 0), 0);
  const closedVariance = closedRows.reduce((t, r) => t + (r.variance ?? 0), 0);
  const inPnl = openTotal + closedTotal;

  /** The approval this user owes on a row, if any. */
  function myStage(r: ForecastListRow): "finance_head" | "payroll_head" | null {
    if (r.status !== "submitted") return null;
    if ((isFinanceHead || isSuperAdmin) && r.financeHeadStatus === "pending") return "finance_head";
    if ((isPayrollHead || isSuperAdmin) && r.payrollHeadStatus === "pending") return "payroll_head";
    return null;
  }
  const awaitingMe = rows.filter((r) => myStage(r)).length;

  function actionsFor(r: ForecastListRow) {
    const out: Array<{ label: string; mode: SheetMode; primary?: boolean; stage?: "finance_head" | "payroll_head" }> = [];
    const stage = myStage(r);
    if (stage) out.push({ label: isSuperAdmin && !isFinanceHead && !isPayrollHead ? `Review (${stage === "finance_head" ? "FH" : "PH"})` : "Review", mode: "review", primary: true, stage });
    if (canWrite && (r.status === "missing" || r.status === "draft" || r.status === "rejected")) out.push({ label: r.status === "missing" ? "Forecast" : "Edit", mode: "edit", primary: !stage });
    if (canWrite && r.status === "approved") out.push({ label: "Close with actuals", mode: "close", primary: true });
    if (canReopen && r.status === "closed") out.push({ label: "Reopen", mode: "reopen" });
    if (r.forecastId && !out.some((a) => a.mode === "review")) out.push({ label: "View", mode: "view" });
    return out;
  }

  const due = list.data?.dueDate;
  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Revenue Forecast</h1>
            <p className="max-w-3xl text-xs text-slate-600">
              Forecast each cost centre&apos;s revenue for the month — seats at each rate, metric-based lines, fixed amounts, rewards and penalties.
              Finance Head and Payroll Head approve; the P&amp;L counts the open forecast until you close it with actuals.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <MonthYearPicker value={period} onChange={(v) => v && setPeriod(v)} yearsBack={1} yearsForward={1} />
            <Button size="icon" variant="ghost" aria-label="Refresh" onClick={() => void list.refetch()}>
              <RefreshCw className={`h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} aria-hidden />
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 border-b bg-slate-50/60 px-4 py-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Due date" value={due ? formatDate(due) : "—"} hint={counts.overdue ? `${counts.overdue} overdue` : "On track"} tone={counts.overdue ? "rose" : "slate"} />
          <Tile label="Cost centres" value={String(rows.length)} hint={`${counts.missing ?? 0} not started`} />
          <Tile label="Awaiting approval" value={String(counts.submitted ?? 0)} hint={awaitingMe ? `${awaitingMe} need your approval` : undefined} tone={awaitingMe ? "amber" : "slate"} />
          <Tile label="Open in P&L" value={money(openTotal)} hint={`${counts.approved ?? 0} forecasts`} tone="blue" />
          <Tile label="Closed in P&L" value={money(closedTotal)} hint={`${closedVariance >= 0 ? "+" : ""}${money(closedVariance)} vs forecast`} tone="emerald" />
          <Tile label="Revenue in P&L" value={money(inPnl)} hint="Open forecast + closed actual" />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {FORECAST_STATUS_FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${filter === f.value ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-400"}`}>
                {f.label} <span className="tabular-nums opacity-80">{counts[f.value] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" aria-hidden />
            <Input aria-label="Search cost centre or branch" className="h-8 w-64 pl-8 text-xs" placeholder="Search cost centre or branch" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-4 pb-6">
          {list.isLoading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading cost centres…</div>
          ) : list.isError ? (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <AlertTriangle className="h-4 w-4" aria-hidden /> Could not load forecasts: {(list.error as Error)?.message}
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => void list.refetch()}>Retry</Button>
            </div>
          ) : visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-600">{rows.length ? "No cost centre matches this filter." : "No active cost centres in your scope."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost centre</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Finance Head</TableHead>
                  <TableHead>Payroll Head</TableHead>
                  <TableHead className="text-right">Forecast</TableHead>
                  <TableHead className="text-right">Closed</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.costCentreId} className="hover:bg-slate-50">
                    <TableCell>
                      <p className="font-medium text-slate-900">{r.costCentreCode}</p>
                      <p className="text-xs text-slate-600">{r.costCentreName}{r.lineCount ? ` · ${r.lineCount} line${r.lineCount === 1 ? "" : "s"}` : ""}</p>
                    </TableCell>
                    <TableCell className="text-xs">{r.branchName ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <ForecastStatusBadge status={r.status} />
                        {r.overdue ? <span className="text-[11px] font-semibold text-rose-700">Overdue</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className={`text-xs ${approvalTone(r.financeHeadStatus)}`}>{r.status === "missing" || r.status === "draft" ? "—" : approvalMark(r.financeHeadStatus)}</TableCell>
                    <TableCell className={`text-xs ${approvalTone(r.payrollHeadStatus)}`}>{r.status === "missing" || r.status === "draft" ? "—" : approvalMark(r.payrollHeadStatus)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.forecastAmount === null ? "—" : money(r.forecastAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.closedAmount === null ? "—" : money(r.closedAmount)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${r.variance === null ? "" : r.variance < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                      {r.variance === null ? "—" : `${r.variance >= 0 ? "+" : ""}${money(r.variance)}`}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {actionsFor(r).map((a) => (
                          <Button key={a.label} size="sm" variant={a.primary ? "default" : "outline"} className="h-8 text-xs"
                            onClick={() => setSheet({ row: r, mode: a.mode, stage: a.stage })}>
                            {a.label}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      <ForecastSheet open={Boolean(sheet)} onOpenChange={(o) => !o && setSheet(null)} mode={sheet?.mode ?? "view"} row={sheet?.row ?? null} period={period} reviewStage={sheet?.stage} />
    </DashboardLayout>
  );
}
