import { useEffect, useState, type ReactNode } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR } from "./DashboardKit";
import { TOOLTIP_PROPS, fmtDate, fmtN, fmtShortDay, secToHms } from "./lpCallShared";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

interface Detail {
  empId: string; name: string; from: string; to: string;
  kpis: { saleMade: number; revenue: number; allocation: number; connected: number; connectedPct: number; convPct: number; calls: number };
  daily: Array<{ date: string; allocation: number; connected: number; sales: number; revenue: number; loginSec: number; talkSec: number }>;
  subDispositions: Array<{ label: string; count: number }>;
  orders: Array<{ orderId: string; date: string; amount: number; payment: string; rto: boolean; rows: number }>;
}
type DailyRow = Detail["daily"][number];
type OrderRow = Detail["orders"][number];

const DAILY_FILTER_COLS: Array<FilterColumn<DailyRow>> = [
  { key: "date", get: (r) => r.date }, { key: "allocation", get: (r) => r.allocation }, { key: "connected", get: (r) => r.connected },
  { key: "sales", get: (r) => r.sales }, { key: "revenue", get: (r) => r.revenue },
  { key: "login", get: (r) => r.loginSec || null }, { key: "talk", get: (r) => r.talkSec || null },
];
const dailyColGetter = (r: DailyRow, key: string): string | number | null | undefined => {
  const c = DAILY_FILTER_COLS.find((x) => x.key === key); return c ? c.get(r) : undefined;
};
const ORDER_FILTER_COLS: Array<FilterColumn<OrderRow>> = [
  { key: "orderId", get: (r) => r.orderId }, { key: "date", get: (r) => r.date }, { key: "amount", get: (r) => r.amount },
  { key: "payment", get: (r) => r.payment || "—" }, { key: "rows", get: (r) => r.rows },
];
const orderColGetter = (r: OrderRow, key: string): string | number | null | undefined => {
  const c = ORDER_FILTER_COLS.find((x) => x.key === key); return c ? c.get(r) : undefined;
};

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

export function BellavitaCartAgentDrawer({
  apiPath, empId, from, to, onClose,
}: { apiPath: string; empId: string; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    hrmsApi
      .get<{ success: boolean; data: Detail }>(`${apiPath}/agent-detail?empId=${encodeURIComponent(empId)}&from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the agent detail."); });
    return () => { cancelled = true; };
  }, [apiPath, empId, from, to]);

  const dailyFilters = useColumnFilters(data?.daily ?? [], DAILY_FILTER_COLS);
  const { sorted: sortedDaily, sortKey: dailySortKey, sortDir: dailySortDir, toggleSort: toggleDailySort } = useSortableRows(dailyFilters.filtered, dailyColGetter);
  const orderFilters = useColumnFilters(data?.orders ?? [], ORDER_FILTER_COLS);
  const { sorted: sortedOrders, sortKey: orderSortKey, sortDir: orderSortDir, toggleSort: toggleOrderSort } = useSortableRows(orderFilters.filtered, orderColGetter);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Agent detail">
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-fuchsia-600 via-rose-500 to-fuchsia-700 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">Abandon Cart · Agent</p>
            <h3 className="truncate text-lg font-bold">{data?.name ?? empId}</h3>
            <p className="mt-0.5 text-[11px] text-white/80">{empId} · {fmtDate(from)} to {fmtDate(to)}</p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!data && !error && <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {data && (
            <>
              <Section title="Summary">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="Sales (unique orders)" value={fmtN(data.kpis.saleMade)} />
                  <Stat label="Revenue" value={formatINR(data.kpis.revenue)} />
                  <Stat label="Allocation" value={fmtN(data.kpis.allocation)} sub="unique carts" />
                  <Stat label="Connected" value={fmtN(data.kpis.connected)} sub={`${data.kpis.connectedPct}% of allocation`} />
                  <Stat label="Conversion" value={`${data.kpis.convPct}%`} sub="sales / allocation" />
                  <Stat label="Answered calls / chats" value={fmtN(data.kpis.calls)} />
                </div>
              </Section>

              <Section title="Day by day">
                {data.daily.length === 0 ? <None /> : (
                  <>
                    <ResponsiveContainer width="100%" height={190}>
                      <ComposedChart data={data.daily} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 9 }} />
                        <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                        <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
                        <Bar yAxisId="l" dataKey="allocation" name="Allocation" fill="#fbcfe8" radius={[3, 3, 0, 0]} />
                        <Line yAxisId="r" type="monotone" dataKey="sales" name="Sales" stroke="#e11d48" strokeWidth={2} dot={{ r: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    {dailyFilters.activeCount > 0 && (
                      <div className="flex justify-end">
                        <button type="button" onClick={dailyFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
                          Clear {dailyFilters.activeCount} filter{dailyFilters.activeCount > 1 ? "s" : ""}
                        </button>
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <FilterSortTh label="Date" columnKey="date" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Alloc." columnKey="allocation" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 text-right font-semibold" />
                            <FilterSortTh label="Connected" columnKey="connected" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 text-right font-semibold" />
                            <FilterSortTh label="Sales" columnKey="sales" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 text-right font-semibold" />
                            <FilterSortTh label="Revenue" columnKey="revenue" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 text-right font-semibold" />
                            <FilterSortTh label="Login" columnKey="login" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 text-right font-semibold" />
                            <FilterSortTh label="Talk" columnKey="talk" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 text-right font-semibold" />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDaily.map((d) => (
                            <tr key={d.date} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{fmtDate(d.date)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(d.allocation)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(d.connected)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-800">{fmtN(d.sales)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{formatINR(d.revenue)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{d.loginSec ? secToHms(d.loginSec) : "—"}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{d.talkSec ? secToHms(d.talkSec) : "—"}</td>
                            </tr>
                          ))}
                          {sortedDaily.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">No dates match the current filters.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Section>

              <Section title="Call outcomes (sub-disposition)">
                {data.subDispositions.length === 0 ? <None /> : (
                  <ul className="space-y-2">
                    {data.subDispositions.map((s) => {
                      const top = data.subDispositions[0].count || 1;
                      return (
                        <li key={s.label}>
                          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                            <span className="truncate text-slate-600">{s.label}</span>
                            <span className="shrink-0 font-semibold text-slate-700">{fmtN(s.count)}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-fuchsia-500" style={{ width: `${(s.count / top) * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              <Section title={`Sale orders (latest ${data.orders.length})`}>
                {data.orders.length === 0 ? <None /> : (
                  <>
                    {orderFilters.activeCount > 0 && (
                      <div className="mb-2 flex justify-end">
                        <button type="button" onClick={orderFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
                          Clear {orderFilters.activeCount} filter{orderFilters.activeCount > 1 ? "s" : ""}
                        </button>
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <FilterSortTh label="Order id" columnKey="orderId" sortKey={orderSortKey} sortDir={orderSortDir} onSort={toggleOrderSort} filters={orderFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Date" columnKey="date" sortKey={orderSortKey} sortDir={orderSortDir} onSort={toggleOrderSort} filters={orderFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Amount" columnKey="amount" sortKey={orderSortKey} sortDir={orderSortDir} onSort={toggleOrderSort} filters={orderFilters} className="px-3 py-2 text-right font-semibold" />
                            <FilterSortTh label="Payment" columnKey="payment" sortKey={orderSortKey} sortDir={orderSortDir} onSort={toggleOrderSort} filters={orderFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Rows" columnKey="rows" sortKey={orderSortKey} sortDir={orderSortDir} onSort={toggleOrderSort} filters={orderFilters} className="px-3 py-2 text-right font-semibold" />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedOrders.map((o) => (
                            <tr key={o.orderId} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{o.orderId}</td>
                              <td className="px-3 py-2 text-slate-600">{fmtDate(o.date)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{formatINR(o.amount)}</td>
                              <td className="px-3 py-2">
                                <span className="uppercase text-slate-600">{o.payment || "—"}</span>
                                {o.rto && <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">RTO</span>}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500">{o.rows}</td>
                            </tr>
                          ))}
                          {sortedOrders.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">No orders match the current filters.</td></tr>}
                        </tbody>
                      </table>
                    </div>
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
