import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Users, PhoneCall, Heart, TrendingUp, IndianRupee, Wallet, Timer, Map, Tag, Award,
} from "lucide-react";
import { DashboardExportMenu, type ExportSlide } from "./DashboardKit";

interface GroupRow { label: string; leads: number; connected: number; connectedPct: number; converted: number; conversionPct: number; saleValue: number }
interface DashboardData {
  headline: {
    totalLeads: number; connected: number; connectedPct: number; interested: number; interestedPct: number;
    converted: number; conversionPct: number; totalSaleValue: number; avgOrderValue: number;
    tatTracked: number; tatWithin: number; tatCompliancePct: number;
  };
  byLeadCloserStatus: { status: string; count: number; saleValue: number }[];
  byBusiness: GroupRow[];
  byBrand: GroupRow[];
  byEnquirySource: GroupRow[];
  byOrganicPaid: GroupRow[];
  byZone: GroupRow[];
  byAgent: GroupRow[];
  dailyTrend: { date: string; leads: number; saleValue: number }[];
  productivity: { agentsInRoster: number; agentsWithMetrics: number; note: string };
}

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500" />
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

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-slate-700">{title}</p>
      {children}
    </div>
  );
}

function GroupTable({ title, rows, icon: Icon }: { title: string; rows: GroupRow[]; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <SectionCard title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-semibold"><Icon className="mr-1 inline h-3.5 w-3.5" />Label</th>
              <th className="py-2 pr-3 text-right font-semibold">Leads</th>
              <th className="py-2 pr-3 text-right font-semibold">Connected%</th>
              <th className="py-2 pr-3 text-right font-semibold">Conversion%</th>
              <th className="py-2 pr-0 text-right font-semibold">Sale Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-3 font-medium text-slate-700">{r.label}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{r.leads}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{r.connectedPct}%</td>
                <td className={`py-2 pr-3 text-right font-semibold ${r.conversionPct >= 50 ? "text-emerald-600" : r.conversionPct > 0 ? "text-amber-600" : "text-slate-400"}`}>{r.conversionPct}%</td>
                <td className="py-2 pr-0 text-right font-semibold text-slate-800">{formatINR(r.saleValue)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-slate-400">No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/**
 * Birlanu's lead-to-sale CRM dashboard -- every number is a live aggregate
 * over db_masmis.birlanu_sale/birlanu_apr (via GET /api/process-performance/
 * birlanu-dashboard), the real ~85-column lead-intake-through-conversion
 * export uploaded via Uploader -> Sale / APR. Only 15 real rows exist in
 * each table as of this build (a small real upload, not yet a full
 * production feed) -- every section scales automatically as more is
 * uploaded. Productivity (APR) metrics are honestly reported as not yet
 * populated in the current upload rather than fabricated.
 */
export function BirlanuDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/birlanu-dashboard`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Birlanu dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Export slide for "Download Snap"/"Download Excel" — this dashboard has
   * no tabs and no date-range toolbar, so a single slide mirrors everything
   * already rendered below. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const { headline } = data;
    return [{
      title: "Overview",
      kpis: [
        { label: "Total Leads", value: headline.totalLeads.toLocaleString("en-IN") },
        { label: "Connected %", value: `${headline.connectedPct}%` },
        { label: "Interested %", value: `${headline.interestedPct}%` },
        { label: "Conversion %", value: `${headline.conversionPct}%` },
        { label: "Total Sale Value", value: formatINR(headline.totalSaleValue) },
        { label: "Avg Order Value", value: formatINR(headline.avgOrderValue) },
        { label: "TAT Compliance", value: headline.tatTracked ? `${headline.tatCompliancePct}%` : "—" },
      ],
      tables: [
        {
          title: "Lead Closer Status",
          columns: ["Status", "Count", "Sale Value"],
          rows: data.byLeadCloserStatus.map((s) => [statusLabel(s.status), s.count, formatINR(s.saleValue)]),
        },
        {
          title: "Daily Lead Volume & Sale Value",
          columns: ["Date", "Leads", "Sale Value"],
          rows: data.dailyTrend.map((r) => [formatShortDate(r.date), r.leads, formatINR(r.saleValue)]),
        },
        {
          title: "Business-wise (LOB)",
          columns: ["Label", "Leads", "Connected %", "Conversion %", "Sale Value"],
          rows: data.byBusiness.map((r) => [r.label, r.leads, `${r.connectedPct}%`, `${r.conversionPct}%`, formatINR(r.saleValue)]),
        },
        {
          title: "Brand-wise",
          columns: ["Label", "Leads", "Connected %", "Conversion %", "Sale Value"],
          rows: data.byBrand.map((r) => [r.label, r.leads, `${r.connectedPct}%`, `${r.conversionPct}%`, formatINR(r.saleValue)]),
        },
        {
          title: "Enquiry Source",
          columns: ["Label", "Leads", "Connected %", "Conversion %", "Sale Value"],
          rows: data.byEnquirySource.map((r) => [r.label, r.leads, `${r.connectedPct}%`, `${r.conversionPct}%`, formatINR(r.saleValue)]),
        },
        {
          title: "Organic vs Paid",
          columns: ["Label", "Leads", "Connected %", "Conversion %", "Sale Value"],
          rows: data.byOrganicPaid.map((r) => [r.label, r.leads, `${r.connectedPct}%`, `${r.conversionPct}%`, formatINR(r.saleValue)]),
        },
        {
          title: "Zone-wise",
          columns: ["Label", "Leads", "Connected %", "Conversion %", "Sale Value"],
          rows: data.byZone.map((r) => [r.label, r.leads, `${r.connectedPct}%`, `${r.conversionPct}%`, formatINR(r.saleValue)]),
        },
        {
          title: "Agent-wise Performance",
          columns: ["Label", "Leads", "Connected %", "Conversion %", "Sale Value"],
          rows: data.byAgent.map((r) => [r.label, r.leads, `${r.connectedPct}%`, `${r.conversionPct}%`, formatINR(r.saleValue)]),
        },
        {
          title: "Agent Productivity (APR)",
          columns: ["Agents in Roster", "Agents with Metrics"],
          rows: [[data.productivity.agentsInRoster, data.productivity.agentsWithMetrics]],
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
          reportTitle="Birlanu — Lead-to-Sale Performance"
          fileBaseName="Birlanu_Performance"
          slides={exportSlides}
          activeSlideTitle="Overview"
        />
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard icon={Users} label="Total Leads" value={headline.totalLeads.toLocaleString("en-IN")} tone="bg-indigo-50 text-indigo-600" />
        <KpiCard icon={PhoneCall} label="Connected %" value={`${headline.connectedPct}%`} sub={`${headline.connected} of ${headline.totalLeads}`} tone="bg-sky-50 text-sky-600" />
        <KpiCard icon={Heart} label="Interested %" value={`${headline.interestedPct}%`} sub={`${headline.interested} leads`} tone="bg-rose-50 text-rose-600" />
        <KpiCard icon={TrendingUp} label="Conversion %" value={`${headline.conversionPct}%`} sub={`${headline.converted} closed`} tone="bg-emerald-50 text-emerald-600" />
        <KpiCard icon={IndianRupee} label="Total Sale Value" value={formatINR(headline.totalSaleValue)} tone="bg-amber-50 text-amber-600" />
        <KpiCard icon={Wallet} label="Avg Order Value" value={formatINR(headline.avgOrderValue)} tone="bg-violet-50 text-violet-600" />
        <KpiCard icon={Timer} label="TAT Compliance" value={headline.tatTracked ? `${headline.tatCompliancePct}%` : "—"} sub={headline.tatTracked ? `${headline.tatWithin} of ${headline.tatTracked} tracked` : "not tracked"} tone="bg-teal-50 text-teal-600" />
      </div>

      {/* Lead closer funnel + daily trend */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Lead Closer Status">
          <div className="space-y-2">
            {data.byLeadCloserStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="font-medium text-slate-700">{statusLabel(s.status)}</span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-500">{s.count} leads</span>
                  <span className="font-semibold text-slate-800">{formatINR(s.saleValue)}</span>
                </span>
              </div>
            ))}
            {data.byLeadCloserStatus.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No data.</p>}
          </div>
        </SectionCard>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm lg:col-span-2">
          <p className="mb-3 text-sm font-semibold text-slate-700">Daily Lead Volume &amp; Sale Value</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.dailyTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => (name === "Sale Value" ? formatINR(value) : value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="leads" name="Leads" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="saleValue" name="Sale Value" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Business + Brand */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable title="Business-wise (LOB)" rows={data.byBusiness} icon={Tag} />
        <GroupTable title="Brand-wise" rows={data.byBrand} icon={Award} />
      </div>

      {/* Enquiry Source + Organic/Paid */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable title="Enquiry Source" rows={data.byEnquirySource} icon={PhoneCall} />
        <GroupTable title="Organic vs Paid" rows={data.byOrganicPaid} icon={TrendingUp} />
      </div>

      {/* Zone + Agent */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable title="Zone-wise" rows={data.byZone} icon={Map} />
        <GroupTable title="Agent-wise Performance" rows={data.byAgent} icon={Users} />
      </div>

      {/* Productivity / APR */}
      <SectionCard title="Agent Productivity (APR)">
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-2">
          <div><p className="text-lg font-bold text-slate-800">{data.productivity.agentsInRoster}</p><p className="text-[11px] text-slate-400">Agents in Roster</p></div>
          <div><p className="text-lg font-bold text-slate-800">{data.productivity.agentsWithMetrics}</p><p className="text-[11px] text-slate-400">With Metrics</p></div>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-400">{data.productivity.note}</p>
      </SectionCard>
    </div>
  );
}
