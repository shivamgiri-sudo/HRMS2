import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR } from "./DashboardKit";
import {
  type HPAgentDetail, HP_API, fmtDate, fmtMdy, fmtN, weekBucket,
} from "./housingPremiumShared";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a", boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px" },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </section>
  );
}
const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight text-slate-800">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

/** Day/Week table row shape shared by both granularities so one set of Excel-style sort/filter columns covers both. */
interface DrawerPeriodRow { key: string; label: string; saleCount: number; revenue: number; calls: number; connected: number }
interface PeriodCol { key: string; label: string; get: (r: DrawerPeriodRow) => string | number | null; cell: (r: DrawerPeriodRow) => ReactNode; thClassName: string; tdClassName: string }

type HPOrder = HPAgentDetail["orders"][number];
interface OrderCol { key: string; label: string; get: (o: HPOrder) => string | number | null; cell: (o: HPOrder) => ReactNode; thClassName: string; tdClassName: string }
const ORDER_COLS: OrderCol[] = [
  { key: "orderId", label: "Order id", get: (o) => o.orderId, cell: (o) => o.orderId, thClassName: "px-3 py-2 font-semibold", tdClassName: "px-3 py-2 font-medium text-slate-700" },
  { key: "date", label: "Date", get: (o) => o.date, cell: (o) => fmtDate(o.date), thClassName: "px-3 py-2 font-semibold", tdClassName: "px-3 py-2 text-slate-600" },
  { key: "amount", label: "Amount", get: (o) => o.amount, cell: (o) => formatINR(o.amount), thClassName: "px-3 py-2 text-right font-semibold", tdClassName: "px-3 py-2 text-right text-slate-600" },
  { key: "partnerName", label: "Partner", get: (o) => o.partnerName, cell: (o) => o.partnerName, thClassName: "px-3 py-2 font-semibold", tdClassName: "px-3 py-2 text-slate-600" },
];
const ORDER_FILTER_COLS: Array<FilterColumn<HPOrder>> = ORDER_COLS.map((c) => ({ key: c.key, get: c.get }));
const orderColGetter = (o: HPOrder, key: string) => ORDER_COLS.find((c) => c.key === key)?.get(o);

export function HousingPremiumAgentDrawer({
  agent, from, to, onClose,
}: { agent: string; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<HPAgentDetail | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);
  const [period, setPeriod] = useState<"day" | "week">("day");

  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    hrmsApi
      .get<{ success: boolean; data: HPAgentDetail }>(`${HP_API}/agent-detail?agent=${encodeURIComponent(agent)}&from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the agent detail."); });
    return () => { cancelled = true; };
  }, [agent, from, to]);

  const totals = data ? data.daily.reduce((s, d) => ({ sales: s.sales + d.saleCount, revenue: s.revenue + d.revenue, calls: s.calls + d.calls, connected: s.connected + d.connected }), { sales: 0, revenue: 0, calls: 0, connected: 0 }) : null;

  /** Week bucket sums straight off the already-fetched day rows -- no extra fetch. */
  const weeklyRows = useMemo(() => {
    const map = new Map<string, { label: string; saleCount: number; revenue: number; calls: number; connected: number }>();
    for (const d of data?.daily ?? []) {
      const { key, label } = weekBucket(d.date);
      const cur = map.get(key) ?? { label, saleCount: 0, revenue: 0, calls: 0, connected: 0 };
      cur.saleCount += d.saleCount;
      cur.revenue += d.revenue;
      cur.calls += d.calls;
      cur.connected += d.connected;
      map.set(key, cur);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, ...v }));
  }, [data]);

  /** Day/Week table: Excel-style sort + filter. Sort/filter on the raw `key` (ISO date or week-bucket key, both chronological) rather than the formatted `label`, so ordering stays correct. */
  const periodRows = useMemo<DrawerPeriodRow[]>(() => {
    if (period === "day") return (data?.daily ?? []).map((d) => ({ key: d.date, label: fmtDate(d.date), saleCount: d.saleCount, revenue: d.revenue, calls: d.calls, connected: d.connected }));
    return weeklyRows.map((w) => ({ key: w.key, label: w.label, saleCount: w.saleCount, revenue: w.revenue, calls: w.calls, connected: w.connected }));
  }, [period, data, weeklyRows]);
  const periodCols = useMemo<PeriodCol[]>(() => ([
    { key: "period", label: period === "day" ? "Date" : "Week", get: (r) => r.key, cell: (r) => r.label, thClassName: "px-3 py-2 font-semibold", tdClassName: "px-3 py-2 font-medium text-slate-700" },
    { key: "saleCount", label: "Sales", get: (r) => r.saleCount, cell: (r) => fmtN(r.saleCount), thClassName: "px-3 py-2 text-right font-semibold", tdClassName: "px-3 py-2 text-right text-slate-600" },
    { key: "revenue", label: "Revenue", get: (r) => r.revenue, cell: (r) => formatINR(r.revenue), thClassName: "px-3 py-2 text-right font-semibold", tdClassName: "px-3 py-2 text-right font-semibold text-slate-800" },
    { key: "calls", label: "Calls", get: (r) => r.calls, cell: (r) => fmtN(r.calls), thClassName: "px-3 py-2 text-right font-semibold", tdClassName: "px-3 py-2 text-right text-slate-600" },
    { key: "connected", label: "Connected", get: (r) => r.connected, cell: (r) => fmtN(r.connected), thClassName: "px-3 py-2 text-right font-semibold", tdClassName: "px-3 py-2 text-right text-slate-600" },
  ]), [period]);
  const periodFilterCols = useMemo<Array<FilterColumn<DrawerPeriodRow>>>(() => periodCols.map((c) => ({ key: c.key, get: c.get })), [periodCols]);
  const periodColGetter = (r: DrawerPeriodRow, key: string) => periodCols.find((c) => c.key === key)?.get(r);
  const periodFilters = useColumnFilters(periodRows, periodFilterCols);
  const { sorted: sortedPeriodRows, sortKey: periodSortKey, sortDir: periodSortDir, toggleSort: togglePeriodSort } = useSortableRows(periodFilters.filtered, periodColGetter);

  /** Orders table: Excel-style sort + filter. */
  const orderFilters = useColumnFilters(data?.orders ?? [], ORDER_FILTER_COLS);
  const { sorted: sortedOrders, sortKey: orderSortKey, sortDir: orderSortDir, toggleSort: toggleOrderSort } = useSortableRows(orderFilters.filtered, orderColGetter);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Agent detail">
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-indigo-700 via-blue-700 to-indigo-800 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">Housing Premium · Agent</p>
            <h3 className="truncate text-lg font-bold">{data?.name ?? agent}</h3>
            <p className="mt-0.5 text-[11px] text-white/80">{fmtDate(from)} to {fmtDate(to)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!data && !error && <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {data && (
            <>
              <Section title="Roster">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="Emp ID" value={data.empId || "—"} />
                  <Stat label="TL" value={data.tlName} />
                  <Stat label="Center" value={data.center} />
                  <Stat label="DOJ" value={fmtMdy(data.doj)} />
                  <Stat label="Tenure" value={data.tenureDays !== null ? `${data.tenureDays}d` : "—"} sub={data.bucket} />
                  <Stat label="Status" value={data.status} />
                </div>
              </Section>

              <Section title="This range">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Monthly target" value={formatINR(data.target)} />
                  <Stat label="Roster achievement" value={formatINR(data.uploadedAchievement)} sub="as uploaded" />
                  <Stat label="Sales" value={fmtN(totals?.sales ?? 0)} sub={formatINR(totals?.revenue ?? 0)} />
                  <Stat label="Calls" value={fmtN(totals?.calls ?? 0)} sub={`${totals?.connected ?? 0} connected`} />
                </div>
              </Section>

              <Section title="Day by day">
                {data.daily.length === 0 ? <None /> : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex rounded-lg bg-slate-100 p-1">
                        <button
                          type="button" onClick={() => setPeriod("day")}
                          className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${period === "day" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
                        >
                          Day-wise
                        </button>
                        <button
                          type="button" onClick={() => setPeriod("week")}
                          className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${period === "week" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
                        >
                          Week-wise
                        </button>
                      </div>
                      {periodFilters.activeCount > 0 && (
                        <button type="button" onClick={periodFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
                          Clear {periodFilters.activeCount} filter{periodFilters.activeCount > 1 ? "s" : ""}
                        </button>
                      )}
                    </div>
                    {period === "day" ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <ComposedChart data={[...data.daily].sort((a, b) => a.date.localeCompare(b.date))} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d).slice(0, 5)} tick={{ fontSize: 9 }} />
                          <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                          <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
                          <Bar yAxisId="l" dataKey="revenue" name="Revenue" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
                          <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sales" stroke="#4f46e5" strokeWidth={2} dot={{ r: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : (
                      <ResponsiveContainer width="100%" height={180}>
                        <ComposedChart data={weeklyRows} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                          <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                          <Tooltip {...TOOLTIP_PROPS} />
                          <Bar yAxisId="l" dataKey="revenue" name="Revenue" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
                          <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sales" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            {periodCols.map((c) => (
                              <FilterSortTh
                                key={c.key} label={c.label} columnKey={c.key} sortKey={periodSortKey} sortDir={periodSortDir} onSort={togglePeriodSort}
                                filters={periodFilters} className={c.thClassName}
                              />
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedPeriodRows.map((r) => (
                            <tr key={r.key} className="border-t border-slate-50">
                              {periodCols.map((c) => <td key={c.key} className={c.tdClassName}>{c.cell(r)}</td>)}
                            </tr>
                          ))}
                          {sortedPeriodRows.length === 0 && (
                            <tr><td colSpan={periodCols.length} className="px-3 py-4 text-center text-slate-400">No rows match the current filters.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Section>

              <Section title={`Orders (${data.orders.length})`}>
                {data.orders.length === 0 ? <None /> : (
                  <>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            {ORDER_COLS.map((c) => (
                              <FilterSortTh
                                key={c.key} label={c.label} columnKey={c.key} sortKey={orderSortKey} sortDir={orderSortDir} onSort={toggleOrderSort}
                                filters={orderFilters} className={c.thClassName}
                              />
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedOrders.map((o, i) => (
                            <tr key={`${o.orderId}-${i}`} className="border-t border-slate-50">
                              {ORDER_COLS.map((c) => <td key={c.key} className={c.tdClassName}>{c.cell(o)}</td>)}
                            </tr>
                          ))}
                          {sortedOrders.length === 0 && (
                            <tr><td colSpan={ORDER_COLS.length} className="px-3 py-4 text-center text-slate-400">No rows match the current filters.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {orderFilters.activeCount > 0 && (
                      <div className="mt-1.5 flex justify-end">
                        <button type="button" onClick={orderFilters.clearAll} className="text-[10px] font-semibold text-indigo-600 hover:underline">
                          Clear {orderFilters.activeCount} filter{orderFilters.activeCount > 1 ? "s" : ""}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
