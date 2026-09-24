import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR, formatShortDate } from "./DashboardKit";

const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a", boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px" },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

interface AgentDetail {
  empId: string; empName: string; teamLeader: string; lob: string; tenureDays: number | null;
  overall: {
    attendanceDays: number; loginHours: number; breakHours: number; talkHours: number; achtSeconds: number;
    saleCount: number; codCount: number; paidCount: number; codPct: number; paidPct: number;
    rtoCount: number; rtoPct: number; revenue: number; avgSale: number;
  };
  daily: Array<{
    date: string; saleCount: number; revenue: number; codCount: number; paidCount: number; rtoCount: number;
    loginHours: number; breakHours: number; talkHours: number; attendanceDays: number;
  }>;
}

/** Same "day-of-month 1-7 -> W-1, 8-14 -> W-2, ..." convention this app's
 * other week-wise views already use (HousingOwnerDashboard, satyaReportModel). */
function weekBucket(iso: string): { key: string; label: string } {
  const day = Number(iso.slice(8, 10));
  const monthKey = iso.slice(0, 7);
  const weekNum = Math.ceil(day / 7);
  const startDay = (weekNum - 1) * 7 + 1;
  const daysInMonth = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();
  const endDay = Math.min(startDay + 6, daysInMonth);
  const monLabel = new Date(iso).toLocaleDateString("en-IN", { month: "short" });
  return { key: `${monthKey}-W${weekNum}`, label: `W-${weekNum} (${startDay}-${endDay} ${monLabel})` };
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

/**
 * Row-click drill-down for Bellavita's Agent Performance table -- that
 * agent's own overall totals plus a day-by-day / week-by-week breakdown,
 * fetched from a dedicated endpoint (never the already-loaded list row),
 * per this app's Drill-Down Mandate.
 */
export function BellavitaAgentDetailDrawer({
  empId, from, to, onClose,
}: { empId: string; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<AgentDetail | null>(null);
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
      .get<{ success: boolean; data: AgentDetail }>(`/api/process-performance/bellavita-agent-performance/agent-detail?empId=${encodeURIComponent(empId)}&from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load this agent's detail."); });
    return () => { cancelled = true; };
  }, [empId, from, to]);

  /** Week bucket sums straight off the already-fetched day rows -- no extra fetch. */
  const weeklyRows = useMemo(() => {
    const map = new Map<string, {
      label: string; saleCount: number; revenue: number; codCount: number; paidCount: number;
      rtoCount: number; loginHours: number; talkHours: number; attendanceDays: number;
    }>();
    for (const d of data?.daily ?? []) {
      const { key, label } = weekBucket(d.date);
      const cur = map.get(key) ?? { label, saleCount: 0, revenue: 0, codCount: 0, paidCount: 0, rtoCount: 0, loginHours: 0, talkHours: 0, attendanceDays: 0 };
      cur.saleCount += d.saleCount;
      cur.revenue += d.revenue;
      cur.codCount += d.codCount;
      cur.paidCount += d.paidCount;
      cur.rtoCount += d.rtoCount;
      cur.loginHours += d.loginHours;
      cur.talkHours += d.talkHours;
      cur.attendanceDays += d.attendanceDays;
      map.set(key, cur);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({
      key, ...v,
      rtoPct: v.saleCount > 0 ? Math.round((v.rtoCount / v.saleCount) * 10000) / 100 : 0,
    }));
  }, [data]);

  const rows = period === "day" ? data?.daily ?? [] : weeklyRows;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Agent date-wise and week-wise performance">
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-rose-600 via-pink-600 to-rose-700 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">Bellavita · Agent performance</p>
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="TL" value={data.teamLeader} />
                  <Stat label="LOB" value={data.lob} />
                  <Stat label="Tenure" value={data.tenureDays !== null ? `${data.tenureDays}d` : "—"} />
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Overall performance (this range)</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Sale Count" value={String(data.overall.saleCount)} />
                  <Stat label="Revenue" value={formatINR(data.overall.revenue)} />
                  <Stat label="Avg Sale" value={formatINR(data.overall.avgSale)} />
                  <Stat label="COD / Paid" value={`${data.overall.codCount} / ${data.overall.paidCount}`} sub={`${data.overall.codPct}% / ${data.overall.paidPct}%`} />
                  <Stat label="RTO %" value={`${data.overall.rtoPct}%`} sub={`${data.overall.rtoCount} orders`} />
                  <Stat label="Attendance" value={`${data.overall.attendanceDays}d`} />
                  <Stat label="Login / Talk" value={`${data.overall.loginHours}h / ${data.overall.talkHours}h`} />
                  <Stat label="ACHT" value={`${data.overall.achtSeconds}s`} />
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{period === "day" ? "Day by day" : "Week by week"}</p>
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
                </div>
                {rows.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <ComposedChart data={rows} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey={period === "day" ? "date" : "label"} tickFormatter={period === "day" ? (d: string) => formatShortDate(d) : undefined} tick={{ fontSize: 9 }} />
                        <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                        <Tooltip {...TOOLTIP_PROPS} labelFormatter={period === "day" ? (v) => formatShortDate(String(v)) : undefined} />
                        <Bar yAxisId="l" dataKey="revenue" name="Revenue" fill="#fecdd3" radius={[3, 3, 0, 0]} />
                        <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#e11d48" strokeWidth={2} dot={{ r: period === "day" ? 2 : 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-center text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <th className="px-3 py-2 font-semibold">{period === "day" ? "Date" : "Week"}</th>
                            <th className="px-3 py-2 font-semibold">Sale Count</th>
                            <th className="px-3 py-2 font-semibold">Revenue</th>
                            <th className="px-3 py-2 font-semibold">COD</th>
                            <th className="px-3 py-2 font-semibold">Paid</th>
                            <th className="px-3 py-2 font-semibold">RTO%</th>
                            <th className="px-3 py-2 font-semibold">Login Hrs</th>
                            <th className="px-3 py-2 font-semibold">Talk Hrs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {period === "day" ? data.daily.map((d) => (
                            <tr key={d.date} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{formatShortDate(d.date)}</td>
                              <td className="px-3 py-2 text-slate-600">{d.saleCount}</td>
                              <td className="px-3 py-2 font-semibold text-slate-800">{formatINR(d.revenue)}</td>
                              <td className="px-3 py-2 text-amber-600">{d.codCount}</td>
                              <td className="px-3 py-2 text-emerald-600">{d.paidCount}</td>
                              <td className={`px-3 py-2 font-semibold ${d.saleCount > 0 && d.rtoCount / d.saleCount > 0.1 ? "text-red-600" : "text-slate-600"}`}>
                                {d.saleCount > 0 ? `${Math.round((d.rtoCount / d.saleCount) * 10000) / 100}%` : "—"}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{d.loginHours}</td>
                              <td className="px-3 py-2 text-slate-600">{d.talkHours}</td>
                            </tr>
                          )) : weeklyRows.map((w) => (
                            <tr key={w.key} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{w.label}</td>
                              <td className="px-3 py-2 text-slate-600">{w.saleCount}</td>
                              <td className="px-3 py-2 font-semibold text-slate-800">{formatINR(w.revenue)}</td>
                              <td className="px-3 py-2 text-amber-600">{w.codCount}</td>
                              <td className="px-3 py-2 text-emerald-600">{w.paidCount}</td>
                              <td className={`px-3 py-2 font-semibold ${w.rtoPct > 10 ? "text-red-600" : "text-slate-600"}`}>{w.rtoPct}%</td>
                              <td className="px-3 py-2 text-slate-600">{Math.round(w.loginHours * 100) / 100}</td>
                              <td className="px-3 py-2 text-slate-600">{Math.round(w.talkHours * 100) / 100}</td>
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
