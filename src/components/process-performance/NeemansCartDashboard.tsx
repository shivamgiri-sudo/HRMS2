import { useCallback, useEffect, useState } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { IndianRupee, ShoppingCart, Users, TrendingUp, UserCog, CalendarDays } from "lucide-react";

interface DashboardData {
  headline: {
    totalCarts: number;
    totalCartValue: number;
    avgCartValue: number;
    uniqueCustomers: number;
    activeAgents: number;
  };
  from: string;
  to: string;
  dateWiseTrend: Array<{ date: string; cartCount: number; cartValue: number }>;
  dispositionBreakdown: Array<{ disposition: string; count: number; value: number; pct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  agentPerformance: Array<{ agent: string; cartCount: number; cartValue: number; topDisposition: string }>;
}

/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC and rolls the date back a day for a viewer ahead of UTC
 * (e.g. IST, UTC+5:30) — midnight local time becomes the previous day's
 * evening in UTC. */
function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 1st of the current month .. today — same default the backend falls
 * back to on its own, kept in sync so the pickers show what's actually
 * being queried on first load rather than an empty/different range. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDateStr(now);
  return { from, to };
}

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-violet-500" />
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, tone,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={`mb-2 inline-flex rounded-xl p-2 ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

/**
 * Neemans' "Abandoned Cart" dashboard — every number here is a live
 * aggregate over db_masmis.neemans_cart (the table NEEMANS_CART_MASMIS
 * writes into), via GET /api/process-performance/neemans-cart-dashboard.
 * As of build time that table holds 0 rows (registered but never used by
 * any upload yet), so every section below renders its own real empty
 * state until a Cart export is uploaded through the Neemans Cart Data
 * uploader — nothing here is a placeholder or a fabricated number.
 *
 * disposition/status are grouped by whatever distinct values the real
 * uploaded data contains, not a hardcoded "Converted/Recovered" mapping —
 * with no live rows yet there is no confirmed value domain to map from.
 */
export function NeemansCartDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/neemans-cart-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Neemans cart dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <Spinner />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>
    );
  }
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CalendarDays className="h-4 w-4 text-slate-400" />
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          value={to}
          min={from}
          max={localDateStr(new Date())}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"
        />
        <button
          type="button"
          onClick={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
        >
          This Month
        </button>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={ShoppingCart} label="Abandoned Carts" value={headline.totalCarts.toLocaleString("en-IN")} tone="bg-violet-50 text-violet-600" />
        <KpiCard icon={IndianRupee} label="Total Cart Value" value={formatINR(headline.totalCartValue)} tone="bg-emerald-50 text-emerald-600" />
        <KpiCard icon={TrendingUp} label="Avg. Cart Value" value={formatINR(headline.avgCartValue)} tone="bg-sky-50 text-sky-600" />
        <KpiCard icon={Users} label="Unique Customers" value={headline.uniqueCustomers.toLocaleString("en-IN")} tone="bg-amber-50 text-amber-600" />
        <KpiCard icon={UserCog} label="Active Agents" value={headline.activeAgents.toLocaleString("en-IN")} sub="worked a cart in range" tone="bg-indigo-50 text-indigo-600" />
      </div>

      {/* Date-wise trend */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Date-wise Cart Count &amp; Value</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
            <Tooltip
              labelFormatter={(v: unknown) => formatShortDate(String(v))}
              formatter={(value: number, name: string) => (name === "Cart Value" ? formatINR(value) : value)}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="cartCount" name="Cart Count" stroke="#7c3aed" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="cartValue" name="Cart Value" stroke="#059669" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {data.dateWiseTrend.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">No cart data for this period.</p>
        )}
      </div>

      {/* Disposition + Status breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Disposition-wise Breakdown</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Disposition</th>
                  <th className="py-2 pr-3 text-right font-semibold">Count</th>
                  <th className="py-2 pr-3 text-right font-semibold">Value</th>
                  <th className="py-2 pr-0 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.dispositionBreakdown.map((d) => (
                  <tr key={d.disposition} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{d.disposition}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{d.count.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(d.value)}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{d.pct}%</td>
                  </tr>
                ))}
                {data.dispositionBreakdown.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Status-wise Breakdown</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.statusBreakdown} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="status" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="count" name="Carts" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {data.statusBreakdown.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">No data for this period.</p>
          )}
        </div>
      </div>

      {/* Agent-wise performance */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Agent-wise Cart Handling</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Agent</th>
                <th className="py-2 pr-3 text-right font-semibold">Carts Handled</th>
                <th className="py-2 pr-3 text-right font-semibold">Cart Value</th>
                <th className="py-2 pr-0 font-semibold">Top Disposition</th>
              </tr>
            </thead>
            <tbody>
              {data.agentPerformance.map((a) => (
                <tr key={a.agent} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{a.cartCount.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.cartValue)}</td>
                  <td className="py-2.5 pr-0 text-slate-500">{a.topDisposition}</td>
                </tr>
              ))}
              {data.agentPerformance.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
