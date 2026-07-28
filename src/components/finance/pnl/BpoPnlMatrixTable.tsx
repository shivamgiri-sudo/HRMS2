import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CircleDollarSign } from "lucide-react";
import { Link } from "react-router-dom";
import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";
import { ProcessPnlMatrixTotals } from "@/components/finance/pnl/ProcessPnlMatrixTotals";
import {
  filterMatrixRows,
  getDefaultSort,
  getPresetColumns,
  sortMatrixRows,
  type ProcessPnlDensity,
  type ProcessPnlIssueFilter,
  type ProcessPnlMatrixPreset,
  type ProcessPnlStatusFilter,
} from "@/components/finance/pnl/processPnlMatrixConfig";

export interface BpoPnlMatrixTableProps {
  rows: BpoPnlRow[];
  period: string;
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
  search?: string;
  alerts?: unknown[];
}

const stickyOffsets = ["0px", "220px", "370px"];

export function BpoPnlMatrixTable({
  rows,
  period,
  preset,
  status,
  issue,
  density,
  search = "",
  alerts = [],
}: BpoPnlMatrixTableProps) {
  const columns = useMemo(() => getPresetColumns(preset), [preset]);
  const [sort, setSort] = useState(() => getDefaultSort(preset));

  useEffect(() => {
    setSort(getDefaultSort(preset));
  }, [preset]);

  const filteredRows = useMemo(
    () =>
      filterMatrixRows(rows, {
        preset,
        status,
        issue,
        density,
        sortKey: sort.sortKey,
        sortDirection: sort.sortDirection,
        search,
      }),
    [density, issue, preset, rows, search, sort.sortDirection, sort.sortKey, status],
  );
  const visibleRows = useMemo(
    () =>
      sortMatrixRows(filteredRows, {
        preset,
        status,
        issue,
        density,
        sortKey: sort.sortKey,
        sortDirection: sort.sortDirection,
        search,
      }),
    [density, filteredRows, issue, preset, search, sort.sortDirection, sort.sortKey, status],
  );

  const handleSort = (key: (typeof columns)[number]["key"]) => {
    setSort((current) => ({
      sortKey: key,
      sortDirection: current.sortKey === key && current.sortDirection === "desc" ? "asc" : "desc",
    }));
  };
  const padding = density === "compact" ? "px-3 py-2" : "px-3 py-3";
  const tableWidth = preset === "full" ? "min-w-[5200px]" : "min-w-[1400px]";

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
            <CircleDollarSign className="h-5 w-5 text-emerald-600" />
            Process-wise BPO P&amp;L matrix
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {preset === "full"
              ? "Audit-grade process accounting across commercial, revenue, cost, profitability, and budget controls."
              : "Working review of the active process set. Select a process for supporting ledgers."}
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-600">
          {visibleRows.length} processes{alerts.length > 0 ? ` | ${alerts.length} alerts` : ""}
        </div>
      </div>

      <div className="overflow-auto">
        <table className={`${tableWidth} w-full border-separate border-spacing-0 text-xs`}>
          <thead className="text-slate-600">
            <tr className="sticky top-0 z-30 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.12em]">
              {columns.map((column, index) => {
                const isSticky = column.sticky && index < stickyOffsets.length;
                const isSorted = sort.sortKey === column.key;
                const SortIcon = isSorted
                  ? sort.sortDirection === "asc"
                    ? ArrowUp
                    : ArrowDown
                  : ArrowUpDown;

                return (
                  <th
                    key={column.key}
                    className={`${column.widthClass ?? "min-w-[132px]"} ${padding} border-b border-r border-slate-200 ${
                      column.align === "left" ? "text-left" : "text-right"
                    } ${isSticky ? "sticky z-40 bg-slate-50" : ""}`}
                    style={isSticky ? { left: stickyOffsets[index] } : undefined}
                    aria-sort={isSorted ? (sort.sortDirection === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(column.key)}
                      className={`inline-flex w-full items-center gap-1 font-bold hover:text-slate-950 ${
                        column.align === "left" ? "justify-start" : "justify-end"
                      }`}
                    >
                      {column.label}
                      <SortIcon className={`h-3 w-3 ${isSorted ? "text-emerald-700" : "text-slate-400"}`} />
                    </button>
                  </th>
                );
              })}
            </tr>
            <ProcessPnlMatrixTotals columns={columns} rows={filteredRows} density={density} />
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row) => (
              <tr key={row.processId} className="group hover:bg-slate-50/70">
                {columns.map((column, index) => {
                  const isSticky = column.sticky && index < stickyOffsets.length;
                  const content =
                    column.key === "processName" ? (
                      <Link
                        to={`/finance/process-pnl/${row.processId}?period=${period}`}
                        className="font-bold text-slate-950 hover:text-emerald-700"
                      >
                        {column.render(row)}
                      </Link>
                    ) : (
                      column.render(row)
                    );

                  return (
                    <td
                      key={column.key}
                      className={`${column.widthClass ?? "min-w-[132px]"} ${padding} border-r border-slate-100 ${
                        column.align === "left" ? "text-left text-slate-700" : "text-right text-slate-800"
                      } ${isSticky ? "sticky z-10 bg-white group-hover:bg-slate-50" : ""}`}
                      style={isSticky ? { left: stickyOffsets[index] } : undefined}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-6 py-14 text-center text-sm text-slate-500">
                  No BPO P&amp;L data is available for the selected period and filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
