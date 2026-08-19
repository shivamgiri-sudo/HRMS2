import { useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import type { PnlStatement, PnlStatementViewBy } from "@/hooks/usePnlStatement";
import { useRefreshRunningSalarySnapshot } from "@/hooks/usePnlStatement";
import { useWorkforceAccess } from "@/hooks/useUserRole";

/** Mirrors PNL_WRITE_ROLES on the refresh endpoint; the backend enforces it regardless. */
const PNL_REFRESH_ROLES = ["super_admin", "admin", "finance", "finance_head", "accounts_head", "payroll_head"];

/** Today in IST — the same day boundary the snapshot's as_of_date is written against. */
function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const SECTION_LABELS: Record<string, string> = {
  headcount: "Headcount",
  revenue: "Revenue",
  cost: "Cost",
  profitability: "Profitability",
};

function formatValue(value: number | null, format: string) {
  if (value === null || value === undefined) return "—";
  if (format === "PERCENTAGE") return `${value.toFixed(2)}%`;
  if (format === "COUNT") return new Intl.NumberFormat("en-IN").format(Math.round(value));
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

export function PnlStatementView({
  statement,
  isLoading,
  isError,
  onRetry,
  viewBy,
  onViewByChange,
  period,
}: {
  statement: PnlStatement | undefined;
  isLoading: boolean;
  /** True when the underlying query failed. Without this, a failed fetch and a genuinely
   *  empty period both fell into "No data available", so a 401/500 looked identical to a
   *  quiet month. */
  isError?: boolean;
  onRetry?: () => void;
  viewBy: PnlStatementViewBy;
  onViewByChange: (viewBy: PnlStatementViewBy) => void;
  /** Period the statement is showing (YYYY-MM). Required to refresh its people cost. */
  period?: string;
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const { hasAnyRole } = useWorkforceAccess();
  const refresh = useRefreshRunningSalarySnapshot();

  const asOf = statement?.peopleCostAsOf ?? null;
  const isStale = !!asOf && asOf < istToday();
  const canRefresh = hasAnyRole(...PNL_REFRESH_ROLES);

  function exportCsv() {
    if (!statement) return;
    const headers = ["P&L Component", ...statement.columns.map((c) => c.name), "Total"];
    const lines = [headers.map((h) => `"${h}"`).join(",")];
    for (const row of statement.rows) {
      const values = statement.columns.map((col) => {
        const cell = row.values?.[col.id];
        return cell != null ? String(Number(cell).toFixed(2)) : "0";
      });
      const total = values.reduce((s, v) => s + Number(v), 0).toFixed(2);
      lines.push([`"${row.displayName}"`, ...values, total].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pnl-statement-${period ?? "export"}-${viewBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleSection(section: string) {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">View by</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={viewBy}
          onChange={(event) => onViewByChange(event.target.value as PnlStatementViewBy)}
        >
          <option value="process">Process</option>
          <option value="branch">Branch</option>
          <option value="lob">LOB</option>
        </select>

        {/* People cost is a stored snapshot read beside live revenue. Its age decides
            whether Operating Profit means anything, so it is stated, not implied. */}
        <div className="ml-auto flex items-center gap-2">
          {asOf ? (
            <span
              className={`text-xs font-medium ${isStale ? "text-amber-700" : "text-slate-500"}`}
              title={isStale ? "Salary earned since this date is not in the statement" : undefined}
            >
              People cost as of {asOf}{isStale ? " — out of date" : ""}
            </span>
          ) : (
            <span className="text-xs font-medium text-amber-700" title="Agent, DSC and BMC people cost read zero until a snapshot exists, which overstates Operating Profit">
              No people-cost snapshot for this period
            </span>
          )}

          <button
            type="button"
            onClick={exportCsv}
            disabled={!statement}
            title="Export P&L Statement as CSV"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />Export CSV
          </button>
          {canRefresh && (
            <button
              type="button"
              onClick={() => period && refresh.mutate({ period })}
              disabled={!period || refresh.isPending}
              title={period ? "Recomputes earned-to-date salary per employee" : "Select a period first"}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
              {refresh.isPending ? "Refreshing…" : "Refresh people cost"}
            </button>
          )}
        </div>
      </div>

      {refresh.isPending && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          Recomputing earned salary for every active employee in the period. This runs six at a time
          and can take several minutes on a large branch — you can leave this tab open.
        </div>
      )}

      {refresh.isError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          Refresh failed: {(refresh.error as Error)?.message || "the request did not complete"}.
        </div>
      )}

      {refresh.isSuccess && refresh.data && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
          Snapshot updated to {refresh.data.asOfDate} — {refresh.data.snapshotted} of{" "}
          {refresh.data.employeesConsidered} employees costed
          {refresh.data.skipped > 0 && `, ${refresh.data.skipped} with no earnings skipped`}
          {refresh.data.failed > 0 && `, ${refresh.data.failed} failed`}.
          {(refresh.data.skipped > 0 || refresh.data.failed > 0) &&
            " Uncosted staff are excluded from people cost, so Operating Profit is overstated by whatever they would have cost."}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center rounded-3xl border border-slate-200 bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : isError ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-600">
          Could not load the statement for this period.{" "}
          {onRetry && <button type="button" className="underline" onClick={onRetry}>Retry</button>}
        </div>
      ) : !statement || statement.rows.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No data available for this period and view.
        </div>
      ) : (
        <>
        {statement.revenueBasis && (
          <p className="px-4 pb-2 text-[11px] text-slate-500">
            {statement.revenueBasis === "invoiced"
              ? "Revenue basis: this month is closed, so Recognised Revenue is what was actually invoiced."
              : "Revenue basis: this month is still running, so Recognised Revenue is the planned figure — invoicing lags delivery and is shown separately below it."}
          </p>
        )}
        <div className="overflow-auto rounded-3xl border border-slate-200 bg-white">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="sticky left-0 z-10 min-w-[220px] bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  P&amp;L Component
                </th>
                {statement.columns.map((column) => {
                  // A column whose people cost covers only part of its headcount overstates
                  // Operating Profit by whatever the uncovered staff would have cost. That gap is
                  // invisible in the numbers themselves — every figure still adds up — so it has to
                  // be stated on the column that carries it.
                  const coverage = column.peopleCostCoveragePct;
                  const underCovered = coverage !== undefined && coverage < 100;
                  return (
                    <th
                      key={column.id}
                      className="min-w-[140px] px-4 py-2 text-right text-xs font-semibold text-slate-600"
                      title={column.branchName ?? undefined}
                    >
                      {column.name}
                      {underCovered && (
                        <span
                          className={`mt-1 block text-[10px] font-medium ${
                            coverage === 0 ? "text-rose-600" : "text-amber-600"
                          }`}
                          title={`Salary cost covers ${column.peopleCostCoveredEmployees} of ${column.peopleCostActiveEmployees} active employees. Operating Profit is overstated until the rest have attendance and salary data for this month.`}
                        >
                          ⚠ {coverage}% salary covered
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const sections: JSX.Element[] = [];
                let currentSection: string | null = null;
                for (const row of statement.rows) {
                  if (row.section !== currentSection) {
                    currentSection = row.section;
                    sections.push(
                      <tr key={`section-${row.section}-${sections.length}`} className="border-b border-slate-100 bg-slate-50/60">
                        <td
                          colSpan={statement.columns.length + 1}
                          className="cursor-pointer select-none px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                          onClick={() => toggleSection(row.section)}
                        >
                          {collapsedSections.has(row.section) ? "▸" : "▾"} {SECTION_LABELS[row.section] ?? row.section}
                        </td>
                      </tr>
                    );
                  }
                  if (collapsedSections.has(row.section)) continue;
                  /*
                   * A row with a parent EXPLAINS the line above it — Invoiced Revenue and
                   * Contracted Revenue both restate Recognised Revenue on a different basis.
                   * The statement is a flat list, so without indenting and muting these the
                   * Revenue section shows the same money on five consecutive lines and reads
                   * as though it had been counted five times. Indent, mute, and prefix with a
                   * turned corner so they are unmistakably sub-lines, not additions.
                   */
                  const isChild = Boolean(row.parentComponentKey);
                  sections.push(
                    <tr key={row.componentKey} className={`border-b border-slate-100 last:border-0 ${row.isSubtotal ? "bg-slate-50/40 font-semibold" : ""}`}>
                      <td className={`sticky left-0 z-10 bg-white py-2 pr-4 ${isChild ? "pl-10 text-slate-500" : "px-4 text-slate-700"}`}>
                        {isChild && <span className="mr-1.5 text-slate-300">↳</span>}
                        {row.displayName}
                      </td>
                      {statement.columns.map((column) => (
                        <td key={column.id} className={`px-4 py-2 text-right tabular-nums ${isChild ? "text-slate-500" : "text-slate-700"}`}>
                          {formatValue(row.values[column.id], row.format)}
                        </td>
                      ))}
                    </tr>
                  );
                }
                return sections;
              })()}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
