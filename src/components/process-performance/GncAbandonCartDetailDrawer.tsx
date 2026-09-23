import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatINR, formatShortDate } from "./DashboardKit";

export interface DrawerSeries {
  /** Unique per series -- used as the React key, so two series reading the same field (e.g. "Overall Unique attempted" and "Same Day Unique Attempt", both real, both sourced from the same real column) still need distinct `key`s. */
  key: string;
  /** Row field to read; defaults to `key` when the label differs from the underlying field name. */
  dataKey?: string;
  label: string; fmt: "int" | "currency" | "pct"; color: string;
}

const fmtVal = (v: unknown, fmt: DrawerSeries["fmt"]): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (fmt === "currency") return formatINR(n);
  if (fmt === "pct") return `${n}%`;
  return n.toLocaleString("en-IN");
};

/** Shared "View details" drawer for every chart/KPI across GNC's dashboards
 * (Abandon Cart, Chat, ...) -- reads the same day/week rows the on-screen
 * chart already has in memory (each dashboard fetches full daily+weekly
 * granularity up front), so no second API call. Per this app's Drill-Down
 * Mandate: a right-side slide-over, not a page or modal, with Week-wise and
 * Date-wise sections shown separately. */
export function GncDetailDrawer({
  title, eyebrow = "GNC · Week-wise & Date-wise", gradient = "from-pink-700 via-rose-700 to-pink-800", series, dailyRows, weeklyRows, onClose,
}: {
  title: string;
  eyebrow?: string;
  gradient?: string;
  series: DrawerSeries[];
  dailyRows: Array<Record<string, string | number>>;
  weeklyRows: Array<Record<string, string | number>>;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${title} — date-wise and week-wise`}>
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className={`flex items-start justify-between gap-3 bg-gradient-to-br ${gradient} px-5 py-4 text-white`}>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">{eyebrow}</p>
            <h3 className="truncate text-lg font-bold">{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Trend</p>
            {dailyRows.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={dailyRows} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={(v: string) => formatShortDate(v)} tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip
                    labelFormatter={(v: unknown) => formatShortDate(String(v))}
                    formatter={(value: number, name: string) => {
                      const s = series.find((x) => x.label === name);
                      return [s ? fmtVal(value, s.fmt) : value, name];
                    }}
                    contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {series.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.dataKey ?? s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise</p>
            {weeklyRows.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-center text-xs">
                  <thead>
                    <tr className="bg-rose-800 text-[11px] uppercase tracking-wide text-white">
                      <th className="px-3 py-2 text-left font-bold text-white">Week</th>
                      {series.map((s) => <th key={s.key} className="px-3 py-2 font-bold text-white">{s.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyRows.map((r, i) => (
                      <tr key={String(r.label)} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-rose-50/30" : "bg-white"}`}>
                        <td className="px-3 py-2 text-left font-medium text-slate-700">{String(r.label)}</td>
                        {series.map((s) => <td key={s.key} className="px-3 py-2 font-semibold text-slate-700">{fmtVal(r[s.dataKey ?? s.key], s.fmt)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Date-wise</p>
            {dailyRows.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>
            ) : (
              <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-center text-xs">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-pink-800 text-[11px] uppercase tracking-wide text-white">
                      <th className="px-3 py-2 text-left font-bold text-white">Date</th>
                      {series.map((s) => <th key={s.key} className="px-3 py-2 font-bold text-white">{s.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...dailyRows].reverse().map((r, i) => (
                      <tr key={String(r.date)} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-pink-50/30" : "bg-white"}`}>
                        <td className="px-3 py-2 text-left font-medium text-slate-700">{formatShortDate(String(r.date))}</td>
                        {series.map((s) => <td key={s.key} className="px-3 py-2 text-slate-600">{fmtVal(r[s.dataKey ?? s.key], s.fmt)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
