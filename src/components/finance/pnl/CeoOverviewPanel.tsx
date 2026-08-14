import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useCeoOverview, type CeoBranchRow, type CeoFocus, type CeoOpportunity } from "@/hooks/useCeoOverview";
import { FilterMultiSelect } from "./FilterMultiSelect";

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
  /*
   * All three filters are lists. The question this panel answers is comparative — "Noida and
   * Noida-2 against Ahmedabad", "these four processes only" — and asking it one branch at a time
   * is several page loads with no comparison at the end.
   *
   * The page-level `branchId` in the URL stays a single value, because the Matrix and Statement
   * tabs read it and neither understands a list. So the two are kept in step where they can be:
   * this panel adopts the page's branch when it changes, and pushes its own selection back only
   * when exactly one branch is ticked. Selecting several narrows THIS tab and clears the page
   * filter rather than sending a list somewhere that would silently use only the first id.
   */
  const [branchIds, setBranchIds] = useState<string[]>(branchId ? [branchId] : []);
  const [processIds, setProcessIds] = useState<string[]>([]);
  const [costCentreIds, setCostCentreIds] = useState<string[]>([]);
  const [compare, setCompare] = useState<"avg" | "budget">("avg");

  useEffect(() => {
    setBranchIds((current) => {
      if (!branchId) return current.length <= 1 ? [] : current;
      return current.length === 1 && current[0] === branchId ? current : [branchId];
    });
  }, [branchId]);

  const selectBranches = (ids: string[]) => {
    setBranchIds(ids);
    onBranchChange?.(ids.length === 1 ? ids[0] : "");
  };

  const { data, isLoading, error } = useCeoOverview(period, { branchIds, processIds, costCentreIds });
  const narrowed = branchIds.length > 0 || processIds.length > 0 || costCentreIds.length > 0;

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
  const branchOptions = (data.options.branches ?? []).map((b) => ({ value: b.id, label: b.name }));
  const hiddenHeads = data.closedBranchesHidden.reduce((total, b) => total + b.staffPaid, 0);
  const width = (part: number) => (revenue > 0 ? Math.max(0, Math.min(100, (part / revenue) * 100)) : 0);

  const trendMax = Math.max(1, ...data.trend.map((t) => Math.abs(t.marginPct ?? 0)));

  return (
    <div className="flex flex-col gap-4">

      {/* Filters. Every option is drawn from data that exists for this period — an option that
          leads to an empty page is indistinguishable from a broken one. */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <FilterMultiSelect
          label="Branch"
          allLabel="All branches"
          options={branchOptions}
          selected={branchIds}
          onChange={selectBranches}
        />
        <FilterMultiSelect
          label="Process"
          allLabel="All processes"
          options={data.options.processes.map((p) => ({ value: p.id, label: p.name }))}
          selected={processIds}
          onChange={setProcessIds}
        />
        <FilterMultiSelect
          label="Cost centre"
          allLabel="All cost centres"
          options={data.options.costCentres.map((c) => ({ value: c.id, label: c.code }))}
          selected={costCentreIds}
          onChange={setCostCentreIds}
        />
        <Filter label="Compare with" id="ceoCompare" value={compare} onChange={(v) => setCompare(v as "avg" | "budget")}>
          <option value="avg">Company average</option>
          <option value="budget">Budget</option>
        </Filter>
        {narrowed && (
          <button
            type="button"
            onClick={() => { setProcessIds([]); setCostCentreIds([]); selectBranches([]); }}
            className="ml-auto rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
          >
            Clear filters
          </button>
        )}
      </section>

      {/*
        Read before the numbers, not after them.

        MAS bills in arrears: June 2026's ₹372.07 L was assembled from invoices dated June
        (₹218.32 L) plus invoices dated July (₹150.08 L). Opened on 7 August, July therefore showed
        NOIDA at ₹1.31 L of revenue against ₹80.36 L of payroll — a ₹96.9 L loss on a branch that
        had billed ₹127.40 L the month before. One of its seventeen cost centres had been invoiced.

        The figures are NOT adjusted; there is nothing honest to adjust them to. What was missing
        was the label saying which of the two you are looking at.
      */}
      {data.billing.incomplete && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/25">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {period} is still being invoiced
            </h3>
            <span className="text-[12.5px] text-amber-800 dark:text-amber-300">
              {data.billing.lines} invoice line{data.billing.lines === 1 ? "" : "s"} against a
              {" "}{Math.round(data.billing.baselineLines)}-line average for the three months before it
              {data.billing.pctOfBaseline !== null && ` · ${data.billing.pctOfBaseline.toFixed(0)}%`}
            </span>
          </div>
          <p className="mt-1.5 max-w-[85ch] text-[13px] text-slate-700 dark:text-slate-300">
            Invoices are raised in arrears, so a large part of this month is normally billed during the
            next one. Revenue below is what has actually been invoiced — treat the margins as
            incomplete rather than as a fall in trading, and read them again once billing closes.
          </p>
          {data.billing.gaps.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1">
              {data.billing.gaps.map((gap) => (
                <li key={gap.branchName} className="text-[13px] text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{gap.branchName}</span>
                  {" "}has invoiced {lakh(gap.currentRevenue)} against a recent monthly average of{" "}
                  {lakh(gap.baselineRevenue)} — its cost is complete, its revenue is not, so its
                  margin here is understated.
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Headline figures */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Operating margin</div>
          <div className={`mt-1 text-[26px] font-semibold leading-tight tabular-nums ${marginTone(marginPct, false)}`}>
            {marginPct === null ? "—" : `${marginPct.toFixed(1)}%`}
          </div>
          <div className="mt-1 text-xs text-slate-500">{lakh(operatingProfit)} operating profit</div>
          <div className="mt-2 flex h-7 items-end gap-1" aria-hidden="true">
            {data.trend.map((t) => (
              <span
                key={t.period}
                title={`${t.period}: ${t.marginPct === null ? "—" : t.marginPct.toFixed(1) + "%"}`}
                className={`flex-1 rounded-t ${t.period === period ? "bg-teal-700" : "bg-slate-200 dark:bg-slate-700"}`}
                style={{ height: `${Math.max(8, (Math.abs(t.marginPct ?? 0) / trendMax) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {data.trend.map((t) => `${t.period.slice(5)} ${t.marginPct === null ? "—" : t.marginPct.toFixed(0) + "%"}`).join(" · ")}
          </div>
        </article>
        <Kpi label="Invoiced revenue" value={lakh(revenue)} detail={`${data.branches.length} branch${data.branches.length === 1 ? "" : "es"}`} />
        <Kpi label="People cost" value={lakh(peopleCost)}
          detail={`${revenue > 0 ? ((peopleCost / revenue) * 100).toFixed(1) : "—"}% of revenue · ${staffPaid.toLocaleString("en-IN")} paid`} />
        <Kpi label="Indirect cost" value={lakh(indirectCost)}
          detail={`${revenue > 0 ? ((indirectCost / revenue) * 100).toFixed(1) : "—"}% of revenue`} />
        <Kpi label="Revenue per head" value={revenuePerHead === null ? "—" : thousand(revenuePerHead)}
          detail="per paid employee, per month" />
      </section>

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
          <span className="text-[12.5px] text-slate-500">ranked by operating profit</span>
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
                {compare === "budget" && <th className="px-3 py-2 text-right font-semibold text-blue-700">Budget</th>}
                {compare === "budget" && <th className="px-3 py-2 text-right font-semibold text-slate-500">vs Budget</th>}
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

        {/* Set aside, not deleted. branch_master holds 45 branches and 5 are active; the closed ones
            that reach this month carry headcount and ₹0 in every money column. Hiding them without
            saying so would make 234 people vanish from a page that is partly about them — the
            "branches carry staff with no salary" finding below still names every one. */}
        {data.closedBranchesHidden.length > 0 && (
          <p className="border-t border-slate-100 px-5 py-2.5 text-[12.5px] text-slate-500 dark:border-slate-800">
            {data.closedBranchesHidden.length} closed branch
            {data.closedBranchesHidden.length === 1 ? " is" : "es are"} not listed — no revenue, no
            payroll and no spend this month
            {hiddenHeads > 0 && `, though ${hiddenHeads.toLocaleString("en-IN")} people still sit against them in the payroll run`}
            : {data.closedBranchesHidden.map((b) => b.branchName).join(", ")}.
          </p>
        )}
      </section>

      {/* The P&L for whatever the filter narrowed to, with its caveats attached.

          Process is not a grain the data supports across the board — only 18 of 66 processes carry
          revenue — which is why the company view stays at branch level. But for a well-mapped one
          it holds up completely, and withholding a real answer because other rows are incomplete
          would be its own kind of dishonesty. So it is shown WITH what qualifies it. */}
      {data.focus && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold">
              {data.focus.label}
              <span className="ml-2 font-normal text-slate-500">
                {data.focus.kind === "process" ? "process" : "cost centre"} P&amp;L
              </span>
            </h3>
            <span className="text-[12.5px] text-slate-500">{period}</span>
          </header>
          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <FocusCell label="Invoiced revenue" value={lakh(data.focus.revenue)}
                detail={`${data.focus.invoiceLines} invoice line${data.focus.invoiceLines === 1 ? "" : "s"}`} />
              <FocusCell label="People cost" value={lakh(data.focus.peopleCost)}
                detail={`${data.focus.staffPaid.toLocaleString("en-IN")} paid${data.focus.staffZeroPaid > 0 ? ` · ${data.focus.staffZeroPaid} at zero` : ""}`} />
              <FocusCell label="Indirect cost" value={lakh(data.focus.indirectCost)}
                detail={data.focus.budget > 0
                  ? `${lakh(Math.abs(data.focus.budget - data.focus.indirectCost))} ${data.focus.budget >= data.focus.indirectCost ? "under" : "over"} budget`
                  : "no budget recorded"} />
              <FocusCell label="Operating profit" value={lakh(data.focus.operatingProfit)}
                detail={data.focus.marginPct === null ? "no revenue to measure against" : `${data.focus.marginPct.toFixed(1)}% margin`}
                tone={marginTone(data.focus.marginPct, false)} />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FocusCell label="Revenue per head" value={data.focus.revenuePerHead === null ? "—" : thousand(data.focus.revenuePerHead)}
                detail="per paid employee, per month" />
              <FocusCell label="Cost per head" value={data.focus.costPerHead === null ? "—" : thousand(data.focus.costPerHead)}
                detail="loaded, including employer PF and ESIC" />
            </div>

            {data.focus.notes.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                  Before you read the margin
                </div>
                <ul className="mt-1.5 flex list-disc flex-col gap-1.5 pl-4 text-[13px] text-slate-700 dark:text-slate-300">
                  {data.focus.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Where profit is recoverable. Suppressed under a filter: comparing one branch against
          itself finds nothing, and an empty panel would read as a clean bill of health. */}
      {narrowed && (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-[13px] text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          Opportunities are ranked across the whole company. Clear the filters to see them.
        </p>
      )}
      {!narrowed && data.opportunities.length > 0 && (
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

function FocusCell({
  label, value, detail, tone,
}: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold leading-tight tabular-nums ${tone ?? ""}`}>{value}</div>
      <div className="mt-0.5 text-[11.5px] text-slate-500">{detail}</div>
    </div>
  );
}

function Filter({
  label, id, value, onChange, children,
}: {
  label: string; id: string; value: string;
  onChange: (value: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] dark:border-slate-700 dark:bg-slate-800"
      >
        {children}
      </select>
    </div>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-[26px] font-semibold leading-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </article>
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
      {compare === "budget" && (
        <td className="px-3 py-2.5 text-right tabular-nums text-blue-700">
          {row.budget > 0 ? lakh(row.budget) : "—"}
        </td>
      )}
      {compare === "budget" && (() => {
        if (row.budget <= 0) return <td className="px-3 py-2.5 text-right text-slate-400">—</td>;
        const vb = row.indirectCost - row.budget;
        return (
          <td className={`px-3 py-2.5 text-right tabular-nums text-[12px] font-semibold ${vb > 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {vb > 0 ? "+" : ""}{lakh(vb)}
          </td>
        );
      })()}
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
