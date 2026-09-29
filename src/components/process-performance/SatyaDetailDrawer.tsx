import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR } from "./DashboardKit";
import { ComboTrend, fmtNum } from "./NeemansCharts";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";
import {
  callsMade, filtersQuery, fmtDMY, fmtInt, fmtRatio, outcomeLabel, ratio,
  type SatyaCounts, type SatyaDetail, type SatyaDetailType, type SatyaFilters,
} from "./satyaReportModel";

export interface SatyaDetailTarget { type: SatyaDetailType; key: string }

const TYPE_LABEL: Record<SatyaDetailType, string> = { agent: "Agent", beat: "Beat", warehouse: "Warehouse" };
const TYPE_BADGE: Record<SatyaDetailType, string> = {
  agent: "bg-violet-100 text-violet-700",
  beat: "bg-teal-100 text-teal-700",
  warehouse: "bg-amber-100 text-amber-700",
};

/** Per-table column definitions for the four multi-row tables in this drawer -- Excel-style
 * sort (click header) + filter (funnel icon) via useSortableRows / ColumnFilterHeader. Each
 * table keeps its own Col array, filter state and sort state (never shared across tables). */
interface DetailCol<T> {
  key: string; label: string;
  get: (r: T) => string | number | null | undefined;
  cell: (r: T) => ReactNode;
  className: string;
}

type DailyRow = SatyaDetail["daily"][number];
const DAILY_COLS: Array<DetailCol<DailyRow>> = [
  { key: "date", label: "Date", get: (r) => r.date, cell: (r) => fmtDMY(r.date), className: "px-3 py-1.5 font-medium text-slate-700" },
  { key: "allocation", label: "Allocation", get: (r) => r.allocation, cell: (r) => fmtInt(r.allocation), className: "px-3 py-1.5 text-right text-slate-600" },
  { key: "connected", label: "Connected", get: (r) => r.connected, cell: (r) => fmtInt(r.connected), className: "px-3 py-1.5 text-right text-slate-600" },
  { key: "orders", label: "Orders", get: (r) => r.orders, cell: (r) => fmtInt(r.orders), className: "px-3 py-1.5 text-right font-semibold text-slate-800" },
  { key: "revenue", label: "Revenue", get: (r) => r.revenue, cell: (r) => formatINR(r.revenue), className: "px-3 py-1.5 text-right text-slate-600" },
];
const DAILY_FILTER_COLS: Array<FilterColumn<DailyRow>> = DAILY_COLS.map((c) => ({ key: c.key, get: c.get }));
const dailyColGetter = (r: DailyRow, key: string) => DAILY_COLS.find((c) => c.key === key)?.get(r);

interface DispositionRow { disposition: string; subDisposition: string; count: number; share: number | null }
const DISPOSITION_COLS: Array<DetailCol<DispositionRow>> = [
  { key: "disposition", label: "Disposition", get: (r) => r.disposition, cell: (r) => r.disposition, className: "px-3 py-1.5 text-slate-500" },
  { key: "outcome", label: "Outcome", get: (r) => outcomeLabel(r.subDisposition), cell: (r) => outcomeLabel(r.subDisposition), className: "px-3 py-1.5 text-right font-medium text-slate-700" },
  { key: "count", label: "Count", get: (r) => r.count, cell: (r) => fmtInt(r.count), className: "px-3 py-1.5 text-right text-slate-600" },
  { key: "share", label: "Share", get: (r) => r.share, cell: (r) => fmtRatio(r.share), className: "px-3 py-1.5 text-right text-slate-500" },
];
const DISPOSITION_FILTER_COLS: Array<FilterColumn<DispositionRow>> = DISPOSITION_COLS.map((c) => ({ key: c.key, get: c.get }));
const dispositionColGetter = (r: DispositionRow, key: string) => DISPOSITION_COLS.find((c) => c.key === key)?.get(r);

type BreakdownRow = { name: string; counts: SatyaCounts };
const BREAKDOWN_COLS: Array<DetailCol<BreakdownRow>> = [
  { key: "name", label: "Name", get: (r) => r.name, cell: (r) => r.name, className: "px-3 py-1.5 font-medium text-slate-700" },
  { key: "allocation", label: "Allocation", get: (r) => r.counts.allocation, cell: (r) => fmtInt(r.counts.allocation), className: "px-3 py-1.5 text-right text-slate-600" },
  { key: "connected", label: "Connected", get: (r) => r.counts.connected, cell: (r) => fmtInt(r.counts.connected), className: "px-3 py-1.5 text-right text-slate-600" },
  { key: "orders", label: "Orders", get: (r) => r.counts.orders, cell: (r) => fmtInt(r.counts.orders), className: "px-3 py-1.5 text-right font-semibold text-slate-800" },
  { key: "revenue", label: "Revenue", get: (r) => r.counts.revenue, cell: (r) => formatINR(r.counts.revenue), className: "px-3 py-1.5 text-right text-slate-600" },
];
const BREAKDOWN_FILTER_COLS: Array<FilterColumn<BreakdownRow>> = BREAKDOWN_COLS.map((c) => ({ key: c.key, get: c.get }));
const breakdownColGetter = (r: BreakdownRow, key: string) => BREAKDOWN_COLS.find((c) => c.key === key)?.get(r);

type OrderDetailRow = SatyaDetail["orders"][number];
const ORDER_COLS: Array<DetailCol<OrderDetailRow>> = [
  { key: "date", label: "Date", get: (r) => r.date, cell: (r) => fmtDMY(r.date), className: "px-3 py-1.5 text-slate-600" },
  { key: "shop", label: "Shop", get: (r) => r.shop, cell: (r) => r.shop, className: "px-3 py-1.5 text-right font-medium text-slate-700" },
  { key: "beat", label: "Beat", get: (r) => r.beat, cell: (r) => r.beat, className: "px-3 py-1.5 text-right text-slate-500" },
  { key: "agent", label: "Agent", get: (r) => r.agent, cell: (r) => r.agent, className: "px-3 py-1.5 text-right text-slate-500" },
  { key: "roster", label: "Roster", get: (r) => r.roster, cell: (r) => r.roster, className: "px-3 py-1.5 text-right text-slate-500" },
  { key: "amount", label: "Amount", get: (r) => r.amount, cell: (r) => formatINR(r.amount), className: "px-3 py-1.5 text-right font-semibold text-slate-800" },
];
const ORDER_FILTER_COLS: Array<FilterColumn<OrderDetailRow>> = ORDER_COLS.map((c) => ({ key: c.key, get: c.get }));
const orderColGetter = (r: OrderDetailRow, key: string) => ORDER_COLS.find((c) => c.key === key)?.get(r);

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{children}</p>;
}
/** Section title + an optional "Clear N filter(s)" button for a table that has an active column filter. */
function TableSectionHeader({ title, activeCount, onClear }: { title: string; activeCount: number; onClear: () => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {activeCount > 0 && (
        <button type="button" onClick={onClear} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
          Clear {activeCount} filter{activeCount > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
function None({ text = "None" }: { text?: string }) {
  return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-400">{text}</p>;
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <p className="text-lg font-bold leading-tight text-slate-800">{value}</p>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

/**
 * Slide-over for one agent / beat / warehouse row. Fetches its own detail
 * (GET /satya-retail-report/detail) with the same filters as the list it was
 * opened from, so the totals here equal the row that was clicked.
 */
export function SatyaDetailDrawer({
  target, filters, onClose,
}: { target: SatyaDetailTarget | null; filters: SatyaFilters; onClose: () => void }) {
  const [detail, setDetail] = useState<SatyaDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setDetail(null);
    setError("");
    setLoading(true);
    hrmsApi
      .get<{ success: boolean; data: SatyaDetail }>(
        `/api/process-performance/satya-retail-report/detail?type=${target.type}&key=${encodeURIComponent(target.key)}&${filtersQuery(filters)}`,
        90000,
      )
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the detail."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, filters]);

  const c = detail?.counts;

  // Excel-style: every header sorts (click) and filters (funnel icon); filters AND together, then the sort applies.
  // Independent filter + sort state per table -- never shared across tables or with the parent dashboard.
  const dailyFilters = useColumnFilters(detail?.daily ?? [], DAILY_FILTER_COLS);
  const { sorted: sortedDaily, sortKey: dailySortKey, sortDir: dailySortDir, toggleSort: toggleDailySort } = useSortableRows(dailyFilters.filtered, dailyColGetter);

  const dispositionRows = useMemo<DispositionRow[]>(() => {
    if (!detail) return [];
    return detail.dispositions.map((d) => ({ ...d, share: ratio(d.count, detail.counts.allocation) }));
  }, [detail]);
  const dispositionFilters = useColumnFilters(dispositionRows, DISPOSITION_FILTER_COLS);
  const { sorted: sortedDispositions, sortKey: dispositionSortKey, sortDir: dispositionSortDir, toggleSort: toggleDispositionSort } = useSortableRows(dispositionFilters.filtered, dispositionColGetter);

  const breakdownFilters = useColumnFilters(detail?.breakdown ?? [], BREAKDOWN_FILTER_COLS);
  const { sorted: sortedBreakdown, sortKey: breakdownSortKey, sortDir: breakdownSortDir, toggleSort: toggleBreakdownSort } = useSortableRows(breakdownFilters.filtered, breakdownColGetter);

  const orderFilters = useColumnFilters(detail?.orders ?? [], ORDER_FILTER_COLS);
  const { sorted: sortedOrders, sortKey: orderSortKey, sortDir: orderSortDir, toggleSort: toggleOrderSort } = useSortableRows(orderFilters.filtered, orderColGetter);

  return (
    <Sheet open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-1 border-b border-slate-100 bg-gradient-to-br from-amber-50 to-white p-5 pr-12 text-left">
          <div className="flex flex-wrap items-center gap-2">
            {target && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TYPE_BADGE[target.type]}`}>{TYPE_LABEL[target.type]}</span>}
            <span className="text-[11px] text-slate-400">
              {fmtDMY(filters.from)} – {fmtDMY(filters.to)}
              {filters.warehouse ? ` · ${filters.warehouse}` : ""}{filters.roster ? ` · ${filters.roster}` : ""}
            </span>
          </div>
          <SheetTitle className="text-lg font-bold text-slate-900">{detail?.title ?? target?.key ?? "Details"}</SheetTitle>
          <SheetDescription className="text-xs text-slate-500">
            {detail ? `${detail.subtitle} · active ${fmtDMY(detail.firstDate)} – ${fmtDMY(detail.lastDate)}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading details…
            </div>
          )}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {detail && c && (
            <>
              <section>
                <SectionLabel>Summary</SectionLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Allocation" value={fmtInt(c.allocation)} sub={`${fmtInt(c.morning)} morning · ${fmtInt(c.absentee)} absentee`} />
                  <Stat label="Calls made" value={fmtInt(callsMade(c))} sub={`${fmtInt(c.unique)} unique · ${fmtInt(c.repeat)} repeat`} />
                  <Stat label="Connected" value={fmtInt(c.connected)} sub={`${fmtRatio(ratio(c.connected, c.connected + c.notConnected))} of dialled`} />
                  <Stat label="Not connected" value={fmtInt(c.notConnected)} sub={c.pending ? `${fmtInt(c.pending)} pending` : undefined} />
                  <Stat label="Orders placed" value={fmtInt(c.orders)} sub={`${fmtInt(c.ordersUnique)} unique · ${fmtInt(c.orders - c.ordersUnique)} repeat`} />
                  <Stat label="Conversion" value={fmtRatio(ratio(c.orders, callsMade(c)))} sub="orders ÷ calls made" />
                  <Stat label="Order revenue" value={formatINR(c.revenue)} />
                  <Stat label="Avg order value" value={c.orders ? formatINR(Math.round(c.revenue / c.orders)) : "—"} />
                </div>
              </section>

              <section>
                <TableSectionHeader title="Daily activity" activeCount={dailyFilters.activeCount} onClear={dailyFilters.clearAll} />
                {detail.daily.length === 0 ? <None /> : (
                  <>
                    <ComboTrend
                      height={190}
                      data={detail.daily}
                      series={[
                        { key: "allocation", name: "Allocation", kind: "bar", color: "#f59e0b" },
                        { key: "connected", name: "Connected", kind: "line", color: "#10b981" },
                        { key: "orders", name: "Orders", kind: "line", color: "#7c3aed" },
                      ]}
                    />
                    <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-100">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            {DAILY_COLS.map((col) => (
                              <FilterSortTh
                                key={col.key} label={col.label} columnKey={col.key}
                                sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters}
                                className={`px-3 py-2 font-semibold ${col.key === "date" ? "" : "text-right"}`}
                              />
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDaily.map((d) => (
                            <tr key={d.date} className="border-b border-slate-50 last:border-0">
                              {DAILY_COLS.map((col) => <td key={col.key} className={col.className}>{col.cell(d)}</td>)}
                            </tr>
                          ))}
                          {sortedDaily.length === 0 && (
                            <tr><td colSpan={DAILY_COLS.length} className="px-3 py-6 text-center text-slate-400">No days match the filters.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>

              <section>
                <TableSectionHeader title="Call outcomes" activeCount={dispositionFilters.activeCount} onClear={dispositionFilters.clearAll} />
                {detail.dispositions.length === 0 ? <None /> : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                          {DISPOSITION_COLS.map((col) => (
                            <FilterSortTh
                              key={col.key} label={col.label} columnKey={col.key}
                              sortKey={dispositionSortKey} sortDir={dispositionSortDir} onSort={toggleDispositionSort} filters={dispositionFilters}
                              className={`px-3 py-2 font-semibold ${col.key === "disposition" ? "" : "text-right"}`}
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDispositions.map((d) => (
                          <tr key={`${d.disposition}|${d.subDisposition}`} className="border-b border-slate-50 last:border-0">
                            {DISPOSITION_COLS.map((col) => <td key={col.key} className={col.className}>{col.cell(d)}</td>)}
                          </tr>
                        ))}
                        {sortedDispositions.length === 0 && (
                          <tr><td colSpan={DISPOSITION_COLS.length} className="px-3 py-6 text-center text-slate-400">No outcomes match the filters.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <TableSectionHeader title={detail.breakdownLabel} activeCount={breakdownFilters.activeCount} onClear={breakdownFilters.clearAll} />
                {detail.breakdown.length === 0 ? <None /> : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                          {BREAKDOWN_COLS.map((col) => (
                            <FilterSortTh
                              key={col.key} label={col.key === "name" ? (detail.type === "beat" ? "Agent" : "Beat") : col.label} columnKey={col.key}
                              sortKey={breakdownSortKey} sortDir={breakdownSortDir} onSort={toggleBreakdownSort} filters={breakdownFilters}
                              className={`px-3 py-2 font-semibold ${col.key === "name" ? "" : "text-right"}`}
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBreakdown.map((b) => (
                          <tr key={b.name} className="border-b border-slate-50 last:border-0">
                            {BREAKDOWN_COLS.map((col) => <td key={col.key} className={col.className}>{col.cell(b)}</td>)}
                          </tr>
                        ))}
                        {sortedBreakdown.length === 0 && (
                          <tr><td colSpan={BREAKDOWN_COLS.length} className="px-3 py-6 text-center text-slate-400">No rows match the filters.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <TableSectionHeader title={`Orders placed (${fmtNum(detail.ordersTotal)})`} activeCount={orderFilters.activeCount} onClear={orderFilters.clearAll} />
                {detail.orders.length === 0 ? <None text="No orders in this range" /> : (
                  <>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            {ORDER_COLS.map((col) => (
                              <FilterSortTh
                                key={col.key} label={col.label} columnKey={col.key}
                                sortKey={orderSortKey} sortDir={orderSortDir} onSort={toggleOrderSort} filters={orderFilters}
                                className={`px-3 py-2 font-semibold ${col.key === "date" ? "" : "text-right"}`}
                              />
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedOrders.map((o, i) => (
                            <tr key={`${o.date}-${o.shop}-${i}`} className="border-b border-slate-50 last:border-0">
                              {ORDER_COLS.map((col) => <td key={col.key} className={col.className}>{col.cell(o)}</td>)}
                            </tr>
                          ))}
                          {sortedOrders.length === 0 && (
                            <tr><td colSpan={ORDER_COLS.length} className="px-3 py-6 text-center text-slate-400">No orders match the filters.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {detail.ordersTotal > detail.orders.length && (
                      <p className="mt-1.5 text-[11px] text-slate-400">Showing the latest {detail.orders.length} of {fmtNum(detail.ordersTotal)} orders.</p>
                    )}
                  </>
                )}
              </section>

              <section>
                <SectionLabel>Dial attempts (call log)</SectionLabel>
                {detail.calls.attempts === 0 ? <None text="No dial attempts logged" /> : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Attempts" value={fmtInt(detail.calls.attempts)} />
                    <Stat label="Connected" value={fmtInt(detail.calls.connected)} sub={fmtRatio(ratio(detail.calls.connected, detail.calls.attempts))} />
                    <Stat label="Order-placing calls" value={fmtInt(detail.calls.orderCalls)} />
                    <Stat label="Avg attempt no." value={String(detail.calls.avgAttempt)} />
                  </div>
                )}
              </section>

              <section>
                <SectionLabel>Documents &amp; approvals</SectionLabel>
                <None />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
