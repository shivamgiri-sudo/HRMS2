import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, PhoneCall, PhoneMissed, Timer, Target, Users, TrendingUp, CalendarDays,
} from "lucide-react";
import { DashboardExportMenu, type ExportSlide } from "./DashboardKit";

interface Headline {
  totalRevenue: number;
  totalSaleCount: number;
  aov: number;
  totalCalls: number;
  connectedCalls: number;
  notConnectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
  activeAgents: number;
  totalTarget: number;
  totalMtdReported: number;
  achievementPct: number;
}

interface GroupRow {
  name: string;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  revenue: number;
  saleCount: number;
  target: number;
  achievementPct: number;
  aov: number;
}

interface AgentRow {
  empId: string | null;
  name: string;
  tlName: string;
  am: string;
  doj: string | null;
  bucket: string | null;
  status: string;
  target: number;
  mtdReported: number;
  totalCalls: number;
  connectedCalls: number;
  notConnectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
  saleCount: number;
  revenue: number;
  achievementPct: number;
  stage: "TQ" | "MQ" | "BQ" | "NA";
}

interface DashboardData {
  headline: Headline;
  byAm: GroupRow[];
  byTl: GroupRow[];
  agents: AgentRow[];
  topPerformers: AgentRow[];
  bottomPerformers: AgentRow[];
  packageTypeBreakdown: { packageType: string; count: number; revenue: number }[];
  dailyTrend: { date: string; revenue: number; saleCount: number; totalCalls: number; connectedCalls: number }[];
}

const PKG_COLORS = ["#2563eb", "#0ea5e9", "#0891b2", "#059669", "#65a30d", "#d97706", "#dc2626", "#9333ea", "#db2777", "#475569"];

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const formatSecs = (s: number) => {
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}h ${m}m ${sec}s`;
};
const pkgLabel = (p: string) => p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC and rolls the date back a day for a viewer ahead of UTC
 * (e.g. IST, UTC+5:30) — midnight local time becomes the previous day's
 * evening in UTC. Same fix already applied to the Bellavita dashboard. */
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

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-500" />
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

function StageBadge({ stage }: { stage: AgentRow["stage"] }) {
  const styles: Record<AgentRow["stage"], string> = {
    TQ: "bg-emerald-50 text-emerald-700",
    MQ: "bg-amber-50 text-amber-700",
    BQ: "bg-red-50 text-red-700",
    NA: "bg-slate-100 text-slate-500",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[stage]}`}>{stage}</span>;
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-slate-700">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 pr-3 text-right font-semibold">Calls</th>
              <th className="py-2 pr-3 text-right font-semibold">Connected%</th>
              <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
              <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
              <th className="py-2 pr-3 text-right font-semibold">Target</th>
              <th className="py-2 pr-0 text-right font-semibold">Ach%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-slate-50 last:border-0">
                <td className="py-2.5 pr-3 font-medium text-slate-700">{r.name}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.totalCalls.toLocaleString("en-IN")}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.connectedPct.toFixed(1)}%</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.saleCount}</td>
                <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                <td className="py-2.5 pr-3 text-right text-slate-500">{r.target > 0 ? formatINR(r.target) : "—"}</td>
                <td className={`py-2.5 pr-0 text-right font-semibold ${r.achievementPct >= 80 ? "text-emerald-600" : r.achievementPct >= 50 ? "text-amber-600" : "text-red-600"}`}>
                  {r.target > 0 ? `${r.achievementPct.toFixed(0)}%` : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-slate-400">No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerformerTable({ title, rows, tone }: { title: string; rows: AgentRow[]; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-slate-700">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-semibold">Agent</th>
              <th className="py-2 pr-3 font-semibold">TL</th>
              <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
              <th className="py-2 pr-0 text-right font-semibold">Ach%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-slate-50 last:border-0">
                <td className="py-2.5 pr-3 font-medium text-slate-700">{r.name}</td>
                <td className="py-2.5 pr-3 text-slate-500">{r.tlName}</td>
                <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                <td className={`py-2.5 pr-0 text-right font-semibold ${tone}`}>{r.achievementPct.toFixed(0)}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Housing Owner dashboard, real data only — every figure is a live
 * aggregate over db_masmis.owner_sale, Owner_cdr and owner_agent_details
 * (via GET /api/process-performance/housing-owner-dashboard), joined
 * client-side by agent name since the three source tables use slightly
 * different name spellings for the same person. Layout mirrors the
 * reference "Dashboard" / "Agent Wise Performance" / "Top 5 Bottom 5"
 * sheets, but shows none of that file's own numbers -- only this app's
 * own uploaded data. owner_agent_details already carries real
 * monthly_target/mtd per agent, so Achievement% here is computed
 * genuinely (revenue / target), unlike Bellavita where no target
 * uploader exists.
 */
export function HousingOwnerDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/housing-owner-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Housing Owner dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  /** Single export slide for "Download Snap"/"Download Excel" — this
   * dashboard has no tabs, so the whole page's KPIs/tables become one
   * slide, built from the same data already rendered on screen. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const { headline } = data;
    const slide: ExportSlide = {
      title: "Housing Owner Performance",
      kpis: [
        { label: "Revenue", value: formatINR(headline.totalRevenue) },
        { label: "Sale Count", value: headline.totalSaleCount.toLocaleString("en-IN") },
        { label: "AOV", value: formatINR(headline.aov) },
        { label: "Total Calls", value: headline.totalCalls.toLocaleString("en-IN") },
        { label: "Connected %", value: `${headline.connectedPct.toFixed(1)}%` },
        { label: "Avg Talk Time", value: formatSecs(headline.avgTalkTimeSec) },
        { label: "Achievement %", value: `${headline.achievementPct.toFixed(1)}%` },
        { label: "Active Agents", value: String(headline.activeAgents) },
      ],
      tables: [
        {
          title: "AM-wise Performance",
          columns: ["Name", "Calls", "Connected %", "Sale Count", "Revenue", "Target", "Achievement %"],
          rows: data.byAm.map((r) => [
            r.name, r.totalCalls.toLocaleString("en-IN"), `${r.connectedPct.toFixed(1)}%`, r.saleCount, formatINR(r.revenue),
            r.target > 0 ? formatINR(r.target) : "—", r.target > 0 ? `${r.achievementPct.toFixed(0)}%` : "—",
          ]),
        },
        {
          title: "TL-wise Performance",
          columns: ["Name", "Calls", "Connected %", "Sale Count", "Revenue", "Target", "Achievement %"],
          rows: data.byTl.map((r) => [
            r.name, r.totalCalls.toLocaleString("en-IN"), `${r.connectedPct.toFixed(1)}%`, r.saleCount, formatINR(r.revenue),
            r.target > 0 ? formatINR(r.target) : "—", r.target > 0 ? `${r.achievementPct.toFixed(0)}%` : "—",
          ]),
        },
        {
          title: "Top 5 Performers (by Achievement %)",
          columns: ["Agent", "TL", "Revenue", "Achievement %"],
          rows: data.topPerformers.map((r) => [r.name, r.tlName, formatINR(r.revenue), `${r.achievementPct.toFixed(0)}%`]),
        },
        {
          title: "Bottom 5 Performers (by Achievement %)",
          columns: ["Agent", "TL", "Revenue", "Achievement %"],
          rows: data.bottomPerformers.map((r) => [r.name, r.tlName, formatINR(r.revenue), `${r.achievementPct.toFixed(0)}%`]),
        },
        {
          title: "Agent-wise Performance",
          columns: [
            "Agent", "Emp ID", "TL", "AM", "Bucket", "Status", "Target", "Total Calls", "Connected %",
            "Avg Talk", "Sale Count", "Revenue", "Achievement %", "Stage",
          ],
          rows: data.agents.map((a) => [
            a.name, a.empId ?? "—", a.tlName, a.am, a.bucket ?? "—", a.status,
            a.target > 0 ? formatINR(a.target) : "—", a.totalCalls.toLocaleString("en-IN"), `${a.connectedPct.toFixed(1)}%`,
            a.avgTalkTimeSec > 0 ? formatSecs(a.avgTalkTimeSec) : "—", a.saleCount, formatINR(a.revenue),
            a.target > 0 ? `${a.achievementPct.toFixed(0)}%` : "—", a.stage,
          ]),
        },
      ],
    };
    return [slide];
  }, [data]);

  const dateFilter = (
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
  );

  if (loading && !data) {
    return (
      <div className="space-y-5">
        {dateFilter}
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-5">
        {dateFilter}
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="Housing Owner — Performance"
          fileBaseName="Housing_Owner_Performance"
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle="Housing Owner Performance"
        />
        {dateFilter}
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(headline.totalRevenue)} sub="in selected range" tone="bg-blue-50 text-blue-600" />
        <KpiCard icon={ShoppingBag} label="Sale Count" value={headline.totalSaleCount.toLocaleString("en-IN")} tone="bg-sky-50 text-sky-600" />
        <KpiCard icon={TrendingUp} label="AOV" value={formatINR(headline.aov)} tone="bg-cyan-50 text-cyan-600" />
        <KpiCard icon={PhoneCall} label="Total Calls" value={headline.totalCalls.toLocaleString("en-IN")} tone="bg-indigo-50 text-indigo-600" />
        <KpiCard icon={PhoneMissed} label="Connected %" value={`${headline.connectedPct.toFixed(1)}%`} sub={`${headline.connectedCalls.toLocaleString("en-IN")} of ${headline.totalCalls.toLocaleString("en-IN")}`} tone="bg-emerald-50 text-emerald-600" />
        <KpiCard icon={Timer} label="Avg Talk Time" value={formatSecs(headline.avgTalkTimeSec)} tone="bg-violet-50 text-violet-600" />
        <KpiCard icon={Target} label="Achievement %" value={`${headline.achievementPct.toFixed(1)}%`} sub={`vs ${formatINR(headline.totalTarget)} monthly target`} tone="bg-amber-50 text-amber-600" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} tone="bg-rose-50 text-rose-600" />
      </div>

      {/* Daily trend + package type */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm lg:col-span-2">
          <p className="mb-3 text-sm font-semibold text-slate-700">Day-wise Revenue &amp; Calls</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.dailyTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => (name === "Revenue" ? formatINR(value) : value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="connectedCalls" name="Connected Calls" stroke="#059669" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Revenue by Package Type</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.packageTypeBreakdown} dataKey="revenue" nameKey="packageType" cx="50%" cy="50%" outerRadius={80} label={false}>
                {data.packageTypeBreakdown.map((entry, i) => (
                  <Cell key={entry.packageType} fill={PKG_COLORS[i % PKG_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, _n: string, item: { payload?: { packageType?: string } }) => [formatINR(value), pkgLabel(item?.payload?.packageType ?? "")]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => pkgLabel(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AM-wise + TL-wise */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable title="AM-wise Performance" rows={data.byAm} />
        <GroupTable title="TL-wise Performance" rows={data.byTl} />
      </div>

      {/* Top / Bottom performers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PerformerTable title="Top 5 Performers (by Achievement %)" rows={data.topPerformers} tone="text-emerald-600" />
        <PerformerTable title="Bottom 5 Performers (by Achievement %)" rows={data.bottomPerformers} tone="text-red-600" />
      </div>

      {/* Full agent-wise table */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Agent-wise Performance ({data.agents.length} agents)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Agent</th>
                <th className="py-2 pr-3 font-semibold">TL</th>
                <th className="py-2 pr-3 font-semibold">AM</th>
                <th className="py-2 pr-3 font-semibold">Bucket</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 text-right font-semibold">Target</th>
                <th className="py-2 pr-3 text-right font-semibold">Total Calls</th>
                <th className="py-2 pr-3 text-right font-semibold">Connected%</th>
                <th className="py-2 pr-3 text-right font-semibold">Avg Talk</th>
                <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                <th className="py-2 pr-3 text-right font-semibold">Ach%</th>
                <th className="py-2 pr-0 text-center font-semibold">Stage</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.name} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-slate-700">{a.name}</div>
                    {a.empId && <div className="text-[11px] text-slate-400">{a.empId}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-slate-500">{a.tlName}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{a.am}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{a.bucket ?? "—"}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.status === "Active" ? "bg-emerald-50 text-emerald-700" : a.status === "Inactive" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-slate-500">{a.target > 0 ? formatINR(a.target) : "—"}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{a.totalCalls.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{a.connectedPct.toFixed(1)}%</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{a.avgTalkTimeSec > 0 ? formatSecs(a.avgTalkTimeSec) : "—"}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.saleCount}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.revenue)}</td>
                  <td className={`py-2.5 pr-3 text-right font-semibold ${a.achievementPct >= 80 ? "text-emerald-600" : a.achievementPct >= 50 ? "text-amber-600" : "text-red-600"}`}>
                    {a.target > 0 ? `${a.achievementPct.toFixed(0)}%` : "—"}
                  </td>
                  <td className="py-2.5 pr-0 text-center"><StageBadge stage={a.stage} /></td>
                </tr>
              ))}
              {data.agents.length === 0 && (
                <tr><td colSpan={13} className="py-6 text-center text-slate-400">No agent data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
