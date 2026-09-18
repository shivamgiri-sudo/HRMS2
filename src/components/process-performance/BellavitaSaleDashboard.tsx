import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, CreditCard, RotateCcw, TrendingUp, Users, CalendarDays, Wallet,
} from "lucide-react";
import { BellavitaAgentPerformance } from "./BellavitaAgentPerformance";
import { DashboardExportMenu, type ExportSlide } from "./DashboardKit";

interface DashboardData {
  headline: {
    turnover: number;
    saleCount: number;
    prepaidPct: number;
    rtoPct: number;
    aov: number;
    activeAgents: number;
    netTurnover: number;
    netSaleCount: number;
  };
  from: string;
  to: string;
  dateWiseTrend: Array<{ date: string; saleCount: number; turnover: number; paidCount: number; codCount: number; rtoCount: number }>;
  lobRevenue: Array<{
    lob: string; saleCount: number; turnover: number; target: number | null; achievementPct: number | null; targetNote?: string;
    codCount: number; paidCount: number; codPct: number; paidPct: number; rtoAmount: number; rtoCount: number; rtoPct: number;
    aov: number; netSaleCount: number; netRevenue: number;
  }>;
  lobGrandTotal: {
    saleCount: number; turnover: number; codCount: number; paidCount: number; codPct: number; paidPct: number;
    rtoAmount: number; rtoCount: number; rtoPct: number; aov: number; netSaleCount: number; netRevenue: number;
    target: number; achievementPct: number;
  };
  stateRevenue: Array<{ state: string; saleCount: number; turnover: number; rtoCount: number }>;
  topPerformers: Array<{ empId: string; empName: string; saleCount: number; turnover: number; rtoPct: number; prepaidPct: number; lob: string }>;
  topRtoStates: Array<{ state: string; saleCount: number; rtoPct: number }>;
}

const LOB_COLORS = ["#e11d48", "#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6"];

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
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-rose-500" />
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
 * Slide 1: the Sale Performance dashboard itself. Split out from the
 * BellavitaSaleDashboard shell below so the shell can own the shared
 * slide-switcher + date range and hand the same [from, to] to whichever
 * slide (this one, or Agent Performance) is active.
 */
function SaleDashboardSlide({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/bellavita-sale-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita sale dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    return [{
      title: "Sale Performance",
      kpis: [
        { label: "Turn Over", value: formatINR(data.headline.turnover) },
        { label: "Net Sale Amount", value: formatINR(data.headline.netTurnover) },
        { label: "Sale Count", value: data.headline.saleCount.toLocaleString("en-IN") },
        { label: "Prepaid %", value: `${data.headline.prepaidPct}%` },
        { label: "RTO %", value: `${data.headline.rtoPct}%` },
        { label: "AOV", value: formatINR(data.headline.aov) },
        { label: "Active Agents", value: String(data.headline.activeAgents) },
      ],
      tables: [
        {
          title: "LOB-wise Performance",
          columns: ["LOB", "Sale Count", "COD", "Paid", "COD%", "Paid%", "RTO Amount", "Revenue", "AOV", "RTO%", "Net Sale Count", "Net Revenue", "Target", "Gross Ach%"],
          rows: data.lobRevenue.map((r) => [
            r.lob, r.saleCount, r.codCount, r.paidCount, `${r.codPct}%`, `${r.paidPct}%`,
            formatINR(r.rtoAmount), formatINR(r.turnover), formatINR(r.aov), `${r.rtoPct}%`,
            r.netSaleCount, formatINR(r.netRevenue), r.target != null ? formatINR(r.target) : "—",
            r.achievementPct != null ? `${r.achievementPct}%` : "—",
          ]),
        },
        {
          title: "Top 10 States by Revenue",
          columns: ["State", "Sale Count", "Revenue", "RTO Count"],
          rows: data.stateRevenue.map((s) => [s.state, s.saleCount, formatINR(s.turnover), s.rtoCount]),
        },
        {
          title: "Top Performers",
          columns: ["Agent", "Emp ID", "LOB", "Revenue", "RTO%", "Prepaid%"],
          rows: data.topPerformers.map((p) => [p.empName, p.empId, p.lob, formatINR(p.turnover), `${p.rtoPct}%`, `${p.prepaidPct}%`]),
        },
        {
          title: "Top 5 High RTO % States",
          columns: ["State", "Sale Count", "RTO%"],
          rows: data.topRtoStates.map((s) => [s.state, s.saleCount, `${s.rtoPct}%`]),
        },
      ],
    }];
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <DashboardExportMenu
          reportTitle="Bellavita — Sale Performance"
          fileBaseName="Bellavita_Sale"
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle="Sale Performance"
        />
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <KpiCard icon={IndianRupee} label="Turn Over" value={formatINR(headline.turnover)} tone="bg-rose-50 text-rose-600" />
        <KpiCard icon={Wallet} label="Net Sale Amount" value={formatINR(headline.netTurnover)} sub={`${headline.netSaleCount.toLocaleString("en-IN")} orders, excl. RTO`} tone="bg-teal-50 text-teal-600" />
        <KpiCard icon={ShoppingBag} label="Sale Count" value={headline.saleCount.toLocaleString("en-IN")} tone="bg-sky-50 text-sky-600" />
        <KpiCard icon={CreditCard} label="Prepaid %" value={`${headline.prepaidPct}%`} tone="bg-emerald-50 text-emerald-600" />
        <KpiCard icon={RotateCcw} label="RTO %" value={`${headline.rtoPct}%`} tone="bg-amber-50 text-amber-600" />
        <KpiCard icon={TrendingUp} label="AOV" value={formatINR(headline.aov)} tone="bg-violet-50 text-violet-600" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} sub="in selected range" tone="bg-indigo-50 text-indigo-600" />
      </div>

      {/* Date-wise trend + LOB revenue */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm lg:col-span-2">
          <p className="mb-3 text-sm font-semibold text-slate-700">Date-wise Sale &amp; Turnover</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => (name === "Turnover" ? formatINR(value) : value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="turnover" name="Turnover" stroke="#e11d48" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">LOB-wise Revenue</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.lobRevenue} dataKey="turnover" nameKey="lob" cx="50%" cy="50%" outerRadius={80} label={(p: { lob?: string }) => p.lob ?? ""}>
                {data.lobRevenue.map((entry, i) => (
                  <Cell key={entry.lob} fill={LOB_COLORS[i % LOB_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => formatINR(value)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* COD vs Prepaid + RTO trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">COD vs Prepaid Orders</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="paidCount" name="Prepaid" stackId="pay" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="codCount" name="COD" stackId="pay" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">RTO Count Trend</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="rtoCount" name="RTO Count" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LOB-wise Performance */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">LOB-wise Performance</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-center text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">LOB</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Sale Count</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">COD</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Paid</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">COD%</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Paid%</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">RTO Amount</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Revenue</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">AOV</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">RTO%</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Net Sale Count</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Net Revenue</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Target</th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Gross Ach%</th>
              </tr>
            </thead>
            <tbody>
              {data.lobRevenue.map((r) => (
                <tr key={r.lob}>
                  <td className="border border-slate-200 px-3 py-2 font-medium text-slate-700">{r.lob}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.saleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.codCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.paidCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.codPct}%</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.paidPct}%</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{formatINR(r.rtoAmount)}</td>
                  <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800">{formatINR(r.turnover)}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{formatINR(r.aov)}</td>
                  <td className={`border border-slate-200 px-3 py-2 font-semibold ${r.rtoPct > 10 ? "text-red-600" : "text-slate-600"}`}>{r.rtoPct}%</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.netSaleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{formatINR(r.netRevenue)}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-500">{r.target != null ? formatINR(r.target) : "—"}</td>
                  <td className={`border border-slate-200 px-3 py-2 font-semibold ${r.achievementPct != null ? (r.achievementPct >= 100 ? "text-emerald-600" : r.achievementPct >= 70 ? "text-amber-600" : "text-red-600") : "text-slate-400"}`}>
                    {r.achievementPct != null ? `${r.achievementPct}%` : "—"}
                  </td>
                </tr>
              ))}
              {data.lobRevenue.length === 0 && (
                <tr><td colSpan={14} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
            {data.lobRevenue.length > 0 && (
              <tfoot>
                <tr className="font-semibold text-slate-800">
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">Grand Total</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.saleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.codCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.paidCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.codPct}%</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.paidPct}%</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.rtoAmount)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.turnover)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.aov)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.rtoPct}%</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.netSaleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.netRevenue)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.target)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.achievementPct}%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* State-wise revenue */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Top 10 States by Revenue</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.stateRevenue} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="state" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value: number) => formatINR(value)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Bar dataKey="turnover" name="Revenue" fill="#e11d48" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top performers + top RTO states */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Top 5 Performers</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 font-semibold">LOB</th>
                  <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                  <th className="py-2 pr-3 text-right font-semibold">RTO%</th>
                  <th className="py-2 pr-0 text-right font-semibold">Prepaid%</th>
                </tr>
              </thead>
              <tbody>
                {data.topPerformers.map((p) => (
                  <tr key={p.empId} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-700">{p.empName}</div>
                      <div className="text-[11px] text-slate-400">{p.empId}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">{p.lob}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(p.turnover)}</td>
                    <td className={`py-2.5 pr-3 text-right font-semibold ${p.rtoPct > 10 ? "text-red-600" : "text-slate-600"}`}>{p.rtoPct}%</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{p.prepaidPct}%</td>
                  </tr>
                ))}
                {data.topPerformers.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Top 5 High RTO % States</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">State</th>
                  <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                  <th className="py-2 pr-0 text-right font-semibold">RTO%</th>
                </tr>
              </thead>
              <tbody>
                {data.topRtoStates.map((s) => (
                  <tr key={s.state} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{s.state}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{s.saleCount}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-red-600">{s.rtoPct}%</td>
                  </tr>
                ))}
                {data.topRtoStates.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Bellavita's real dashboard shell — two slides sharing one date range:
 * "Dashboard" (Sale Performance, above) and "Agent Performance" (per-agent
 * table joining bb_sale + bb_apr, see BellavitaAgentPerformance.tsx).
 * Every number on both slides is a live aggregate over db_masmis.bb_sale/
 * bb_apr, via /api/process-performance/bellavita-sale-dashboard and
 * .../bellavita-agent-performance. KPI/layout choice was inspired by the
 * reference material the user supplied, but none of that file's own
 * numbers are used — only this app's own uploaded data. The one exception
 * is LOB Target vs Achievement: those target figures were given directly
 * by the user (not computed), since no target uploader exists for
 * Bellavita — see LOB_TARGETS in the backend service.
 */
export function BellavitaSaleDashboard() {
  const [slide, setSlide] = useState<"dashboard" | "agents">("dashboard");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSlide("dashboard")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${slide === "dashboard" ? "bg-rose-500 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setSlide("agents")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${slide === "agents" ? "bg-rose-500 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            Agent Performance
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {slide === "dashboard" ? <SaleDashboardSlide from={from} to={to} /> : <BellavitaAgentPerformance from={from} to={to} />}
    </div>
  );
}
