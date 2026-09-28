import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR } from "./DashboardKit";
import {
  type HPAgentDetail, HP_API, fmtDate, fmtMdy, fmtN, weekBucket,
} from "./housingPremiumShared";

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
                    <div className="mb-2 inline-flex rounded-lg bg-slate-100 p-1">
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
                            <th className="px-3 py-2 font-semibold">{period === "day" ? "Date" : "Week"}</th>
                            <th className="px-3 py-2 text-right font-semibold">Sales</th>
                            <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                            <th className="px-3 py-2 text-right font-semibold">Calls</th>
                            <th className="px-3 py-2 text-right font-semibold">Connected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {period === "day" ? data.daily.map((d) => (
                            <tr key={d.date} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{fmtDate(d.date)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(d.saleCount)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-800">{formatINR(d.revenue)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(d.calls)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(d.connected)}</td>
                            </tr>
                          )) : weeklyRows.map((w) => (
                            <tr key={w.key} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{w.label}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(w.saleCount)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-800">{formatINR(w.revenue)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(w.calls)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtN(w.connected)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Section>

              <Section title={`Orders (${data.orders.length})`}>
                {data.orders.length === 0 ? <None /> : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-semibold">Order id</th>
                          <th className="px-3 py-2 font-semibold">Date</th>
                          <th className="px-3 py-2 text-right font-semibold">Amount</th>
                          <th className="px-3 py-2 font-semibold">Partner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.orders.map((o, i) => (
                          <tr key={`${o.orderId}-${i}`} className="border-t border-slate-50">
                            <td className="px-3 py-2 font-medium text-slate-700">{o.orderId}</td>
                            <td className="px-3 py-2 text-slate-600">{fmtDate(o.date)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{formatINR(o.amount)}</td>
                            <td className="px-3 py-2 text-slate-600">{o.partnerName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
