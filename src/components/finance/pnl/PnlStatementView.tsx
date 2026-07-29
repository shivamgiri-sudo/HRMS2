import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { PnlStatement, PnlStatementViewBy } from "@/hooks/usePnlStatement";

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
  viewBy,
  onViewByChange,
}: {
  statement: PnlStatement | undefined;
  isLoading: boolean;
  viewBy: PnlStatementViewBy;
  onViewByChange: (viewBy: PnlStatementViewBy) => void;
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

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
      <div className="flex items-center gap-2">
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
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center rounded-3xl border border-slate-200 bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : !statement || statement.rows.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No data available for this period and view.
        </div>
      ) : (
        <div className="overflow-auto rounded-3xl border border-slate-200 bg-white">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="sticky left-0 z-10 min-w-[220px] bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  P&amp;L Component
                </th>
                {statement.columns.map((column) => (
                  <th key={column.id} className="min-w-[140px] px-4 py-2 text-right text-xs font-semibold text-slate-600" title={column.branchName ?? undefined}>
                    {column.name}
                  </th>
                ))}
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
                  sections.push(
                    <tr key={row.componentKey} className={`border-b border-slate-100 last:border-0 ${row.isSubtotal ? "bg-slate-50/40 font-semibold" : ""}`}>
                      <td className="sticky left-0 z-10 bg-white px-4 py-2 text-slate-700">
                        {row.displayName}
                      </td>
                      {statement.columns.map((column) => (
                        <td key={column.id} className="px-4 py-2 text-right tabular-nums text-slate-700">
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
      )}
    </div>
  );
}
