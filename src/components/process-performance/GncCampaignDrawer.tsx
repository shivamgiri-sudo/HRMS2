import { useEffect, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR, formatShortDate } from "./DashboardKit";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

type CampaignDailyRow = CampaignDetail["daily"][number];
const CAMPAIGN_DAILY_FILTER_COLS: Array<FilterColumn<CampaignDailyRow>> = [
  { key: "date", get: (d) => d.date }, { key: "saleCount", get: (d) => d.saleCount }, { key: "codCount", get: (d) => d.codCount },
  { key: "paidCount", get: (d) => d.paidCount }, { key: "revenue", get: (d) => d.revenue }, { key: "conversionPct", get: (d) => d.conversionPct },
];
const campaignDailyColGetter = (d: CampaignDailyRow, key: string) => CAMPAIGN_DAILY_FILTER_COLS.find((c) => c.key === key)?.get(d);

const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a", boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px" },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

interface CampaignDetail {
  campaign: string; from: string; to: string;
  totals: { saleCount: number; codCount: number; paidCount: number; revenue: number; aov: number; conversionPct: number | null };
  daily: Array<{ date: string; saleCount: number; codCount: number; paidCount: number; revenue: number; conversionPct: number | null }>;
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

/** Row-click drill-down for GNC's LOB-wise Summary table -- that LOB's own
 * day-by-day Sale Made / COD / Paid / Revenue / Conversion%, fetched from a
 * dedicated GET endpoint (never the list payload), per this app's
 * Drill-Down Mandate. Mirrors GncAgentDrawer's styling exactly. */
export function GncCampaignDrawer({
  campaign, from, to, onClose,
}: { campaign: string; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

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
      .get<{ success: boolean; data: CampaignDetail }>(`/api/process-performance/gnc-sale-dashboard/campaign-detail?campaign=${encodeURIComponent(campaign)}&from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load this LOB's detail."); });
    return () => { cancelled = true; };
  }, [campaign, from, to]);

  const dailyFilters = useColumnFilters(data?.daily ?? [], CAMPAIGN_DAILY_FILTER_COLS);
  const { sorted: sortedDaily, sortKey: dailySortKey, sortDir: dailySortDir, toggleSort: toggleDailySort } = useSortableRows(dailyFilters.filtered, campaignDailyColGetter);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="LOB date-wise performance">
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-emerald-700 via-teal-700 to-emerald-800 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">GNC · LOB date-wise performance</p>
            <h3 className="truncate text-lg font-bold">{campaign}</h3>
            <p className="mt-0.5 text-[11px] text-white/80">{formatShortDate(from)} to {formatShortDate(to)}</p>
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
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">This range</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Sale Made" value={String(data.totals.saleCount)} />
                  <Stat label="Revenue" value={formatINR(data.totals.revenue)} />
                  <Stat label="AOV" value={formatINR(data.totals.aov)} />
                  <Stat label="COD / Paid" value={`${data.totals.codCount} / ${data.totals.paidCount}`} />
                </div>
                {data.totals.conversionPct !== null && (
                  <div className="grid grid-cols-1">
                    <Stat label="Conversion % (Achi%)" value={`${data.totals.conversionPct}%`} sub="Sale Count ÷ addressable contacts" />
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
                    {dailyFilters.activeCount > 0 && (
                      <div className="flex justify-end">
                        <button type="button" onClick={dailyFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
                          Clear {dailyFilters.activeCount} filter{dailyFilters.activeCount > 1 ? "s" : ""}
                        </button>
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-center text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <FilterSortTh label="Date" columnKey="date" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Sale Made" columnKey="saleCount" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="COD" columnKey="codCount" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Paid" columnKey="paidCount" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Revenue" columnKey="revenue" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 font-semibold" />
                            <FilterSortTh label="Conv%" columnKey="conversionPct" sortKey={dailySortKey} sortDir={dailySortDir} onSort={toggleDailySort} filters={dailyFilters} className="px-3 py-2 font-semibold" />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDaily.map((d) => (
                            <tr key={d.date} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{formatShortDate(d.date)}</td>
                              <td className="px-3 py-2 text-slate-600">{d.saleCount}</td>
                              <td className="px-3 py-2 text-amber-600">{d.codCount}</td>
                              <td className="px-3 py-2 text-emerald-600">{d.paidCount}</td>
                              <td className="px-3 py-2 font-semibold text-slate-800">{formatINR(d.revenue)}</td>
                              <td className="px-3 py-2 text-slate-600">{d.conversionPct !== null ? `${d.conversionPct}%` : <span className="text-slate-300">—</span>}</td>
                            </tr>
                          ))}
                          {sortedDaily.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-400">No dates match the current filters.</td></tr>}
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
