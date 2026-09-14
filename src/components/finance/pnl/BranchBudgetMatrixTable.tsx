import { useMemo, useState } from "react";
import { Grid3x3, Pin, PinOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePinnedOffsets } from "@/hooks/useColumnPinning";
import type { BranchBudgetLineRecord, CostCentreOption } from "@/hooks/useBranchBudget";

const ROW_LABEL_WIDTH = 280;
const COLUMN_WIDTH = 150;

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function amountForCostCentre(line: BranchBudgetLineRecord, costCentreId: string): number {
  if (line.planning_level === "cost_centre") {
    return line.cost_centre_id === costCentreId ? Number(line.gross_amount) : 0;
  }
  const allocation = line.allocations?.find((a) => a.cost_centre_id === costCentreId);
  return allocation ? Number(allocation.gross_amount) : 0;
}

export interface BranchBudgetMatrixTableProps {
  lines: BranchBudgetLineRecord[];
  costCentres: CostCentreOption[];
  pinnedIds: Set<string>;
  onTogglePin: (costCentreId: string) => void;
  onOpenLine: (line: BranchBudgetLineRecord) => void;
}

export function BranchBudgetMatrixTable({
  lines,
  costCentres,
  pinnedIds,
  onTogglePin,
  onOpenLine,
}: BranchBudgetMatrixTableProps) {
  const orderedCostCentres = useMemo(
    () => [
      ...costCentres.filter((cc) => pinnedIds.has(cc.id)),
      ...costCentres.filter((cc) => !pinnedIds.has(cc.id)),
    ],
    [costCentres, pinnedIds]
  );
  const widthByColumnId = useMemo(
    () => Object.fromEntries(orderedCostCentres.map((cc) => [cc.id, COLUMN_WIDTH])),
    [orderedCostCentres]
  );
  const pinnedOffsets = usePinnedOffsets(
    orderedCostCentres.filter((cc) => pinnedIds.has(cc.id)).map((cc) => cc.id),
    widthByColumnId
  );

  const totalsByCostCentre = useMemo(() => {
    const totals = new Map<string, number>();
    for (const cc of costCentres) {
      totals.set(cc.id, lines.reduce((sum, line) => sum + amountForCostCentre(line, cc.id), 0));
    }
    return totals;
  }, [lines, costCentres]);
  const grandTotal = lines.reduce((sum, line) => sum + Number(line.gross_amount), 0);

  const tableWidth = ROW_LABEL_WIDTH + orderedCostCentres.length * COLUMN_WIDTH + COLUMN_WIDTH;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
            <Grid3x3 className="h-5 w-5 text-emerald-600" />
            Branch Budget grid matrix
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Every budget line as a row, every active cost centre as a column. Pin a column to keep it visible while scrolling. Read-only — edit lines in Plan Builder.
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-600">
          {lines.length} line(s) x {costCentres.length} cost centre(s)
        </div>
      </div>

      <div className="overflow-auto">
        <table
          className="w-full border-separate border-spacing-0 text-xs"
          style={{ minWidth: `${tableWidth}px` }}
        >
          <thead className="text-slate-600">
            <tr className="sticky top-0 z-30 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.12em]">
              <th
                className="sticky z-40 min-w-[280px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left"
                style={{ left: 0, width: ROW_LABEL_WIDTH }}
              >
                Head / Sub-head / Item
              </th>
              {orderedCostCentres.map((cc) => {
                const pinned = pinnedIds.has(cc.id);
                return (
                  <th
                    key={cc.id}
                    className={`min-w-[150px] border-b border-r border-slate-200 px-3 py-3 text-right ${
                      pinned ? "sticky z-40 bg-slate-50" : ""
                    }`}
                    style={pinned ? { left: ROW_LABEL_WIDTH + pinnedOffsets[cc.id] } : undefined}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title={pinned ? "Unpin column" : "Pin column"}
                        aria-label={`${pinned ? "Unpin" : "Pin"} ${cc.costCentreName}`}
                        onClick={() => onTogglePin(cc.id)}
                        className="text-slate-400 hover:text-emerald-700"
                      >
                        {pinned ? <Pin className="h-3 w-3 fill-current" /> : <PinOff className="h-3 w-3" />}
                      </button>
                      <span className="truncate">{cc.costCentreName}</span>
                    </div>
                  </th>
                );
              })}
              <th
                className="sticky right-0 z-40 min-w-[150px] border-b border-l-2 border-slate-300 bg-slate-100 px-3 py-3 text-right"
              >
                Branch Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {lines.map((line) => (
              <tr key={line.id} className="group hover:bg-slate-50/70">
                <td
                  className="sticky z-10 min-w-[280px] border-r border-slate-100 bg-white px-3 py-2 text-left group-hover:bg-slate-50"
                  style={{ left: 0, width: ROW_LABEL_WIDTH }}
                >
                  <button type="button" onClick={() => onOpenLine(line)} className="text-left hover:text-emerald-700">
                    <p className="font-semibold text-slate-900">{line.item_name}</p>
                    <p className="text-[10px] text-slate-500">
                      {line.head}
                      {line.sub_head ? ` / ${line.sub_head}` : ""}
                    </p>
                  </button>
                  {line.planning_level === "cost_centre" && (
                    <Badge variant="outline" className="mt-1 text-[9px]">Direct</Badge>
                  )}
                </td>
                {orderedCostCentres.map((cc) => {
                  const pinned = pinnedIds.has(cc.id);
                  const amount = amountForCostCentre(line, cc.id);
                  return (
                    <td
                      key={cc.id}
                      className={`min-w-[150px] border-r border-slate-100 px-3 py-2 text-right ${
                        amount === 0 ? "text-slate-300" : "text-slate-800"
                      } ${pinned ? "sticky z-10 bg-white group-hover:bg-slate-50" : ""}`}
                      style={pinned ? { left: ROW_LABEL_WIDTH + pinnedOffsets[cc.id] } : undefined}
                    >
                      {amount === 0 ? "-" : money(amount)}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 min-w-[150px] border-l-2 border-slate-200 bg-slate-50/80 px-3 py-2 text-right font-semibold text-slate-900 group-hover:bg-slate-100">
                  {money(Number(line.gross_amount))}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={orderedCostCentres.length + 2} className="px-6 py-14 text-center text-sm text-slate-500">
                  No budget lines yet — add lines in Plan Builder.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 text-[11px] font-bold text-slate-900">
              <td className="sticky z-20 border-t-2 border-slate-300 bg-slate-100 px-3 py-2 text-left" style={{ left: 0, width: ROW_LABEL_WIDTH }}>
                Column total
              </td>
              {orderedCostCentres.map((cc) => {
                const pinned = pinnedIds.has(cc.id);
                return (
                  <td
                    key={cc.id}
                    className={`border-t-2 border-slate-300 px-3 py-2 text-right ${pinned ? "sticky z-20 bg-slate-100" : ""}`}
                    style={pinned ? { left: ROW_LABEL_WIDTH + pinnedOffsets[cc.id] } : undefined}
                  >
                    {money(totalsByCostCentre.get(cc.id) ?? 0)}
                  </td>
                );
              })}
              <td className="sticky right-0 z-20 border-l-2 border-t-2 border-slate-300 bg-slate-200 px-3 py-2 text-right">
                {money(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
