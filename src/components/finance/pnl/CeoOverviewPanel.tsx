import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useCeoOverview, type CeoBranchRow, type CeoOpportunity } from "@/hooks/useCeoOverview";

/**
 * The CEO view of the P&L.
 *
 * WHY THIS REPLACES THE OLD OVERVIEW
 * ----------------------------------
 * The previous tab showed twelve KPI tiles fed by bpoPnlService, whose input tables hold no rows,
 * so it reported Rs 0 for revenue, EBITDA and PAT in every month while the statement tab showed
 * Rs 344 lakh for the same period. A tab named "CEO Overview" that reports no revenue for a
 * company with 975 people on payroll is worse than no tab.
 *
 * WHAT A CEO NEEDS THAT A STATEMENT DOES NOT GIVE
 * -----------------------------------------------
 * Where to act. Every figure below is read from what actually happened — invoiced revenue, the
 * payroll run, GRN spend — and the panel ranks what is recoverable, with the evidence beside it.
 * Ordering matters: margin, then branch comparison, then opportunities. A CEO reads the first
 * screen and stops.
 *
 * Reliability is part of the design, not a footnote. An 82% operating margin sat in production
 * looking entirely plausible for a week, so a branch that cannot be read at face value carries a
 * flag rather than a confident number, and a margin that would be meaningless — Head Office bills
 * almost nothing and is a cost centre — renders as "n/a" instead of a percentage.
 */

const lakh = (v: number) => `₹${(v / 100000).toFixed(2)} L`;
const thousand = (v: number) => `₹${(v / 1000).toFixed(1)}k`;

const SEVERITY: Record<CeoOpportunity["severity"], { bar: string; text: string; chip: string }> = {
  critical: { bar: "bg-rose-600", text: "text-rose-700 dark:text-rose-400", chip: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  warning: { bar: "bg-amber-600", text: "text-amber-700 dark:text-amber-400", chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  settled: { bar: "bg-emerald-700", text: "text-emerald-700 dark:text-emerald-400", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
};

/** Margin colour is a judgement, so it lives in one place rather than being inlined per cell. */
function marginTone(pct: number | null, flagged: boolean) {
  if (flagged) return "text-rose-700 dark:text-rose-400";
  if (pct === null) return "text-slate-400";
  if (pct >= 15) return "text-emerald-700 dark:text-emerald-400";
  if (pct >= 8) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}
function marginBar(pct: number | null, flagged: boolean) {
  if (flagged) return "bg-rose-600";
  if (pct === null) return "bg-slate-300";
  if (pct >= 15) return "bg-emerald-700";
  if (pct >= 8) return "bg-amber-600";
  return "bg-rose-600";
}

export interface CeoOverviewPanelProps {
  period: string;
  /** Branch chosen on the page's own filter bar; empty means all branches. */
  branchId?: string;
  onBranchChange?: (branchId: string) => void;
}

export function CeoOverviewPanel({ period, branchId, onBranchChange }: CeoOverviewPanelProps) {
  const { data, isLoading, error } = useCeoOverview(period, branchId);
  const [compare, setCompare] = useState<"avg" | "budget">("avg");

  /** Company-average margin, used as the comparison baseline. Excludes the rows that would skew
   *  it: cost centres, closed branches, and any branch flagged as missing a cost line. */
  const avgMargin = useMemo(() => {
    const trading = (data?.branches ?? []).filter(
      (b) => !b.isCostCentre && !b.isClosed && !b.flag && b.marginPct !== null,
    );
    if (trading.length === 0) return null;
    return trading.reduce((total, b) => total + (b.marginPct ?? 0), 0) / trading.length;
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        Could not load the overview for {period}.
      </div>
    );
  }

  const { revenue, peopleCost, indirectCost, operatingProfit, marginPct, staffPaid, revenuePerHead } = data;
  const width = (part: number) => (revenue > 0 ? Math.max(0, Math.min(100, (part / revenue) * 100)) : 0);

  return (
    <div className="flex flex-col gap-4">

      {/* Verdict: the number a CEO reads first, with the waterfall that explains it */}
      <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[minmax(200px,0.9fr)_2fr] dark:border-slate-800 dark:bg-slate-900">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Operating margin</div>
          <div className={`mt-1 text-[44px] font-semibold leading-none tabular-nums ${marginTone(marginPct, false)}`}>
            {marginPct === null ? "—" : marginPct.toFixed(1)}
            <span className="text-2xl text-slate-500">%</span>
          </div>
          <div className="mt-2 text-[13px] text-slate-600 dark:text-slate-400">
            {lakh(operatingProfit)} on {lakh(revenue)}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
              {staffPaid.toLocaleString("en-IN")} paid
            </span>
            {data.opportunities.filter((o) => o.severity !== "settled").length > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {data.opportunities.filter((o) => o.severity !== "settled").length} to act on
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {[
            { name: "Invoiced revenue", value: revenue, w: 100, fill: "bg-teal-700" },
            { name: "People cost", value: peopleCost, w: width(peopleCost), fill: "bg-teal-700/45" },
            { name: "Indirect cost", value: indirectCost, w: width(indirectCost), fill: "bg-teal-700/25" },
            { name: "Operating profit", value: operatingProfit, w: width(operatingProfit), fill: "bg-emerald-700", bold: true },
          ].map((row) => (
            <div key={row.name} className="grid grid-cols-[132px_1fr_96px] items-center gap-3 text-[13px]">
              <span className={row.bold ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-400"}>
                {row.name}
              </span>
              <div className="h-5 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div className={`h-full rounded ${row.fill}`} style={{ width: `${row.w}%` }} />
              </div>
              <span className={`text-right tabular-nums ${row.bold ? "font-semibold" : ""}`}>{lakh(row.value)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Branch comparison */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold">Branch comparison</h3>
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500" htmlFor="ceoCompare">
              Compare with
            </label>
            <select
              id="ceoCompare"
              value={compare}
              onChange={(e) => setCompare(e.target.value as "avg" | "budget")}
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="avg">Company average</option>
              <option value="budget">Budget</option>
            </select>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13.5px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10.5px] uppercase tracking-wider text-slate-500 dark:border-slate-800">
                <th className="px-3 py-2 text-left font-semibold">Branch</th>
                <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                <th className="px-3 py-2 text-right font-semibold">People</th>
                <th className="px-3 py-2 text-right font-semibold">Staff</th>
                <th className="px-3 py-2 text-right font-semibold">Indirect</th>
                <th className="px-3 py-2 text-right font-semibold">Op. profit</th>
                <th className="px-3 py-2 text-right font-semibold">Margin</th>
                <th className="px-3 py-2 text-right font-semibold">Rev / head</th>
              </tr>
            </thead>
            <tbody>
              {data.branches.map((b) => (
                <BranchRow
                  key={b.branchId ?? b.branchName}
                  row={b}
                  compare={compare}
                  avgMargin={avgMargin}
                  onSelect={onBranchChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Where profit is recoverable */}
      {data.opportunities.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold">Where operating profit can be lifted</h3>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {data.opportunities.length} found
            </span>
          </header>
          <div className="flex flex-col">
            {data.opportunities.map((o) => (
              <article
                key={o.id}
                className="grid grid-cols-[5px_1fr] gap-3.5 border-b border-slate-100 p-4 last:border-b-0 sm:grid-cols-[5px_1fr_140px] dark:border-slate-800"
              >
                <div className={`min-h-[40px] self-stretch rounded ${SEVERITY[o.severity].bar}`} aria-hidden="true" />
                <div>
                  <h4 className="text-sm font-semibold">{o.title}</h4>
                  <p className="mt-1 max-w-[70ch] text-[13px] text-slate-600 dark:text-slate-400">{o.detail}</p>
                  <p className="mt-1.5 max-w-[70ch] text-[12.5px] text-slate-600 dark:text-slate-400">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Action</span> — {o.action}
                  </p>
                </div>
                <div className="sm:text-right">
                  <div className={`text-[19px] font-semibold tabular-nums ${SEVERITY[o.severity].text}`}>{o.value}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{o.valueUnit}</div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="text-[12.5px] text-slate-500">
        Invoiced revenue and GRN spend from the db_bill mirror; people cost from the payroll run for
        this month, not a recomputed snapshot. Revenue per head is monthly, per paid employee.
      </p>
    </div>
  );
}

function BranchRow({
  row, compare, avgMargin, onSelect,
}: {
  row: CeoBranchRow;
  compare: "avg" | "budget";
  avgMargin: number | null;
  onSelect?: (branchId: string) => void;
}) {
  const flagged = Boolean(row.flag);
  let footnote: JSX.Element | null = null;
  if (compare === "budget" && row.budget > 0) {
    const delta = row.budget - row.indirectCost;
    footnote = (
      <span className={delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
        {delta >= 0 ? "under" : "over"} budget {lakh(Math.abs(delta))}
      </span>
    );
  } else if (compare === "avg" && row.marginPct !== null && avgMargin !== null && !flagged) {
    const delta = row.marginPct - avgMargin;
    footnote = (
      <span className={delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
        {delta >= 0 ? "+" : ""}{delta.toFixed(1)} pts vs avg
      </span>
    );
  }

  return (
    <tr
      className={`border-b border-slate-50 last:border-b-0 dark:border-slate-800/60 ${onSelect && row.branchId ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" : ""}`}
      onClick={() => row.branchId && onSelect?.(row.branchId)}
    >
      <td className="px-3 py-2.5">
        <span className="font-medium">{row.branchName}</span>
        {row.flag && (
          <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {row.flag}
          </span>
        )}
        {row.isClosed && (
          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            closed
          </span>
        )}
        {row.isCostCentre && !row.isClosed && (
          <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
            cost centre
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{lakh(row.revenue)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{lakh(row.peopleCost)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{row.staffPaid.toLocaleString("en-IN")}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{lakh(row.indirectCost)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${row.operatingProfit < 0 ? "text-rose-700 dark:text-rose-400" : ""}`}>
        {lakh(row.operatingProfit)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="mr-2 inline-block h-[7px] w-16 overflow-hidden rounded bg-slate-100 align-middle dark:bg-slate-800">
          <span
            className={`block h-full rounded ${marginBar(row.marginPct, flagged)}`}
            style={{ width: `${Math.max(0, Math.min(100, row.marginPct ?? 0))}%` }}
          />
        </span>
        <span className={`tabular-nums font-semibold ${marginTone(row.marginPct, flagged)}`}>
          {row.marginPct === null ? "n/a" : `${row.marginPct.toFixed(1)}%`}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {row.revenuePerHead === null ? "—" : thousand(row.revenuePerHead)}
        {footnote && <div className="text-[11px] font-normal">{footnote}</div>}
      </td>
    </tr>
  );
}
