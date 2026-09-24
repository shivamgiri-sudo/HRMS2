import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR, formatShortDate, formatDDMMYYYY, localDateStr } from "./DashboardKit";

const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a", boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px" },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

interface AgentDetail {
  empId: string; empName: string; tl: string; lob: string; doj: string | null;
  tenureDays: number | null; bucket: string; from: string; to: string;
  totals: { saleCount: number; codCount: number; paidCount: number; revenue: number; aov: number };
  daily: Array<{ date: string; saleCount: number; codCount: number; paidCount: number; revenue: number; present: boolean | null }>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight text-slate-800">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

/** Row-click drill-down for GNC's Agent-wise Performance table -- that
 * agent's own day-by-day Sale Made / COD / Paid / Revenue, fetched from a
 * dedicated GET endpoint (never the list payload), per this app's
 * Drill-Down Mandate. */
export function GncAgentDrawer({
  empId, from, to, onClose,
}: { empId: string; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<AgentDetail | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  /** Mon-Sun weeks built from the same real daily rows the Day-by-day table
   * shows -- no separate fetch. Days present counts only dates with a real
   * gnc_apr attendance row (present === true), matching that column's own
   * "—" for days with no attendance record. */
  const weekly = useMemo(() => {
    if (!data) return [];
    const weeks = new Map<string, {
      label: string; saleCount: number; codCount: number; paidCount: number; revenue: number; daysPresent: number;
    }>();
    for (const d of data.daily) {
      const dt = new Date(`${d.date}T00:00:00`);
      const diffToMon = (dt.getDay() + 6) % 7;
      const monday = new Date(dt);
      monday.setDate(monday.getDate() - diffToMon);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      const key = localDateStr(monday);
      const w = weeks.get(key) ?? { label: `${formatShortDate(key)} – ${formatShortDate(localDateStr(sunday))}`, saleCount: 0, codCount: 0, paidCount: 0, revenue: 0, daysPresent: 0 };
      w.saleCount += d.saleCount;
      w.codCount += d.codCount;
      w.paidCount += d.paidCount;
      w.revenue += d.revenue;
      if (d.present) w.daysPresent += 1;
      weeks.set(key, w);
    }
    return [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, w]) => w);
  }, [data]);

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
      .get<{ success: boolean; data: AgentDetail }>(`/api/process-performance/gnc-sale-dashboard/agent-detail?empId=${encodeURIComponent(empId)}&from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load this agent's detail."); });
    return () => { cancelled = true; };
  }, [empId, from, to]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Agent date-wise performance">
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-emerald-700 via-teal-700 to-emerald-800 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">GNC · Agent date-wise performance</p>
            <h3 className="truncate text-lg font-bold">{data?.empName ?? empId}</h3>
            <p className="mt-0.5 text-[11px] text-white/80">{empId} · {formatShortDate(from)} to {formatShortDate(to)}</p>
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
              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Roster</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="TL" value={data.tl} />
                  <Stat label="LOB" value={data.lob} />
                  <Stat label="DOJ" value={formatDDMMYYYY(data.doj)} sub={data.tenureDays !== null ? `${data.tenureDays}d tenure` : undefined} />
                  <Stat label="Bucket" value={data.bucket} />
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">This range</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Sale Made" value={String(data.totals.saleCount)} />
                  <Stat label="Revenue" value={formatINR(data.totals.revenue)} />
                  <Stat label="AOV" value={formatINR(data.totals.aov)} />
                  <Stat label="COD / Paid" value={`${data.totals.codCount} / ${data.totals.paidCount}`} />
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Week by week</p>
                {weekly.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-center text-xs">
                      <thead>
                        <tr className="bg-emerald-800 text-[11px] uppercase tracking-wide text-white">
                          <th className="px-3 py-2 text-left font-bold">Week</th>
                          <th className="px-3 py-2 font-bold">Sale Made</th>
                          <th className="px-3 py-2 font-bold">COD</th>
                          <th className="px-3 py-2 font-bold">Paid</th>
                          <th className="px-3 py-2 font-bold">Revenue</th>
                          <th className="px-3 py-2 font-bold">Days Present</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weekly.map((w, i) => (
                          <tr key={w.label} className={`border-t border-slate-50 ${i % 2 === 1 ? "bg-emerald-50/30" : "bg-white"}`}>
                            <td className="px-3 py-2 text-left font-medium text-slate-700">{w.label}</td>
                            <td className="px-3 py-2 text-slate-600">{w.saleCount}</td>
                            <td className="px-3 py-2 text-amber-600">{w.codCount}</td>
                            <td className="px-3 py-2 text-emerald-600">{w.paidCount}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800">{formatINR(w.revenue)}</td>
                            <td className="px-3 py-2 text-slate-600">{w.daysPresent}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Day by day</p>
                {data.daily.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <ComposedChart data={data.daily} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="date" tickFormatter={(d) => formatShortDate(d)} tick={{ fontSize: 9 }} />
                        <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                        <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => formatShortDate(String(v))} />
                        <Bar yAxisId="l" dataKey="revenue" name="Revenue" fill="#a7f3d0" radius={[3, 3, 0, 0]} />
                        <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale Made" stroke="#047857" strokeWidth={2} dot={{ r: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-center text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <th className="px-3 py-2 font-semibold">Date</th>
                            <th className="px-3 py-2 font-semibold">Sale Made</th>
                            <th className="px-3 py-2 font-semibold">COD</th>
                            <th className="px-3 py-2 font-semibold">Paid</th>
                            <th className="px-3 py-2 font-semibold">Revenue</th>
                            <th className="px-3 py-2 font-semibold">Present</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.daily.map((d) => (
                            <tr key={d.date} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{formatShortDate(d.date)}</td>
                              <td className="px-3 py-2 text-slate-600">{d.saleCount}</td>
                              <td className="px-3 py-2 text-amber-600">{d.codCount}</td>
                              <td className="px-3 py-2 text-emerald-600">{d.paidCount}</td>
                              <td className="px-3 py-2 font-semibold text-slate-800">{formatINR(d.revenue)}</td>
                              <td className="px-3 py-2">
                                {d.present === null
                                  ? <span className="text-slate-300">—</span>
                                  : d.present
                                    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Present</span>
                                    : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Absent</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
