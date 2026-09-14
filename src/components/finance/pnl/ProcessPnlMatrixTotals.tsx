import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";
import type { ProcessPnlColumnDefinition } from "@/components/finance/pnl/processPnlMatrixConfig";

interface ProcessPnlMatrixTotalsProps {
  columns: ProcessPnlColumnDefinition[];
  rows: BpoPnlRow[];
  density: "comfortable" | "compact";
}

const stickyOffsets = ["0px", "220px", "370px", "500px"];

export function ProcessPnlMatrixTotals({ columns, rows, density }: ProcessPnlMatrixTotalsProps) {
  const padding = density === "compact" ? "px-3 py-2" : "px-3 py-3";

  return (
    <tr className="sticky top-[41px] z-20 bg-slate-100 text-xs font-bold text-slate-800 shadow-sm">
      {columns.map((column, index) => {
        const isSticky = column.sticky && index < stickyOffsets.length;
        const value = index === 0 ? `Totals (${rows.length})` : column.total?.(rows) ?? "-";

        return (
          <td
            key={column.key}
            className={`${column.widthClass ?? "min-w-[132px]"} ${padding} border-b border-r border-slate-200 ${
              column.align === "left" ? "text-left" : "text-right"
            } ${isSticky ? "sticky z-30 bg-slate-100" : ""}`}
            style={isSticky ? { left: stickyOffsets[index] } : undefined}
          >
            {value}
          </td>
        );
      })}
    </tr>
  );
}
