import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, CreditCard, Wallet, TrendingUp, Users, CalendarDays,
  PhoneCall, PhoneOff, Search, Sparkles, Layers, Trophy, ListFilter,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar,
  localDateStr, currentMonthRange, formatINR, formatShortDate, formatDDMMYYYY,
} from "./DashboardKit";

interface DashboardData {
  headline: {
    turnover: number;
    saleCount: number;
    prepaidPct: number;
    codPct: number;
    aov: number;
    activeAgents: number;
    totalAllocation: number;
    sameDayConnectedPct: number;
  };
  from: string;
  to: string;
  dateWiseTrend: Array<{ date: string; saleCount: number; turnover: number; prepaidCount: number; codCount: number }>;
  campaignRevenue: Array<{
    campaign: string; saleCount: number; codCount: number; paidCount: number;
    codPct: number; paidPct: number; turnover: number;
  }>;
  tlRevenue: Array<{ tl: string; saleCount: number; turnover: number }>;
  topPerformers: Array<{ empId: string; empName: string; tl: string; campaign: string; saleCount: number; turnover: number; prepaidPct: number }>;
  allocationStatus: Array<{ status: string; count: number; pct: number }>;
  campaigns: string[];
  dateWiseBreakdown: Array<{
    date: string;
    byCampaign: Record<string, {
      codSaleCount: number; codAmount: number;
      paidSaleCount: number; paidAmount: number;
      totalSaleCount: number; totalAmount: number;
    }>;
    totalSaleCount: number;
    totalAmount: number;
  }>;
  agentPerformance: Array<{
    empId: string; empName: string; doj: string | null; tenureDays: number | null; bucket: string;
    tl: string; lob: string; saleCount: number; codCount: number; paidCount: number;
    codPct: number; paidPct: number; revenue: number; attendanceDays: number;
  }>;
}

const CAMPAIGN_COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#8b5cf6", "#e11d48"];

/**
 * GNC's real "Sale Performance" dashboard — every number here is a live
 * aggregate over db_masmis.gnc_sale/gnc_allocation/gnc_apr (the tables the
 * GNC uploaders write into), via GET /api/process-performance/
 * gnc-sale-dashboard. KPI/layout choice was inspired by the reference Excel
 * the user supplied (GNC_Overall_Sale_Performance_Dashboard), but none of
 * that file's own numbers are used — only this app's own uploaded data.
 *
 * "Ach%" (achievement vs mandate) and RTO%/state-wise revenue from that
 * reference file are deliberately omitted: no GNC target/mandate table
 * exists anywhere in this app, and db_masmis.gnc_sale has no RTO/final-
 * status or state column at all — showing them would mean fabricating a
 * number, which this project's rules forbid. Campaign-wise and TL-wise
 * revenue (both real populated columns) stand in for the dropped charts.
 */
type TabKey = "overall" | "agents";

export function GncSaleDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [tab, setTab] = useState<TabKey>("overall");
  const [agentSearch, setAgentSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/gnc-sale-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the GNC sale dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agentPerformance ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.empName.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q) || a.tl.toLowerCase().includes(q));
  }, [data, agentSearch]);

  if (loading && !data) return <Spinner />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>
    );
  }
  if (!data) return null;

  const { headline } = data;

  const TABS: Array<{ key: TabKey; label: string }> = [
    { key: "overall", label: "Overall" },
    { key: "agents", label: "Agent-wise Performance" },
  ];

  return (
    <div className="space-y-5">
      <DashboardHero
        icon={Sparkles} eyebrow="GNC · Process Performance" title="Sale Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-emerald-600 via-teal-600 to-emerald-700"
      />

      <DateRangeToolbar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
      />

      {tab === "overall" && (
      <>
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={ShoppingBag} label="Sale Count" value={headline.saleCount.toLocaleString("en-IN")} tone="sky" />
        <KpiCard icon={IndianRupee} label="Amount" value={formatINR(headline.turnover)} tone="emerald" />
        <KpiCard icon={CreditCard} label="Prepaid %" value={`${headline.prepaidPct}%`} tone="teal" />
        <KpiCard icon={Wallet} label="COD %" value={`${headline.codPct}%`} tone="amber" />
        <KpiCard icon={TrendingUp} label="AOV" value={formatINR(headline.aov)} tone="violet" />
        <KpiCard icon={Users} label="Active" value={String(headline.activeAgents)} sub="agents in range" tone="indigo" />
        <KpiCard icon={PhoneCall} label="Total Allocation" value={headline.totalAllocation.toLocaleString("en-IN")} tone="rose" />
        <KpiCard icon={PhoneOff} label="Same Day Connected %" value={`${headline.sameDayConnectedPct}%`} tone="cyan" />
      </div>

      {/* Date-wise trend + Campaign revenue */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <SectionCard icon={TrendingUp} title="Date-wise Sale & Turnover" tone="emerald">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gncSaleFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#059669" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => (name === "Turnover" ? formatINR(value) : value)}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Area yAxisId="right" type="monotone" dataKey="turnover" name="Turnover" stroke="#059669" strokeWidth={2.5} fill="url(#gncSaleFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>
        </div>

        <SectionCard icon={Layers} title="Campaign-wise Revenue" tone="teal">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.campaignRevenue} dataKey="turnover" nameKey="campaign" cx="50%" cy="50%" innerRadius={44} outerRadius={82} paddingAngle={2} label={(p: { campaign?: string }) => p.campaign ?? ""}>
                {data.campaignRevenue.map((entry, i) => (
                  <Cell key={entry.campaign} fill={CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length]} stroke="white" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => formatINR(value)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {/* COD vs Prepaid + Allocation connect status */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Wallet} title="COD vs Prepaid Orders" tone="amber">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="prepaidCount" name="Prepaid" stackId="pay" fill="#059669" radius={[0, 0, 0, 0]} />
              <Bar dataKey="codCount" name="COD" stackId="pay" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard icon={PhoneOff} title="Allocation Connect Status" tone="cyan">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 text-right font-semibold">Count</th>
                  <th className="py-2 pr-0 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.allocationStatus.map((s) => (
                  <tr key={s.status} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/70">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{s.status}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{s.count.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{s.pct}%</td>
                  </tr>
                ))}
                {data.allocationStatus.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* TL-wise revenue */}
      <SectionCard icon={Trophy} title="TL-wise Revenue" tone="violet">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.tlRevenue} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="tl" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value: number) => formatINR(value)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            <Bar dataKey="turnover" name="Revenue" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Top performers */}
      <SectionCard icon={Trophy} title="Top 5 Performers" tone="amber">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Agent</th>
                <th className="py-2 pr-3 font-semibold">TL</th>
                <th className="py-2 pr-3 font-semibold">Campaign</th>
                <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                <th className="py-2 pr-0 text-right font-semibold">Prepaid%</th>
              </tr>
            </thead>
            <tbody>
              {data.topPerformers.map((p, i) => (
                <tr key={p.empId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        i === 0 ? "bg-amber-400 text-white" : i === 1 ? "bg-slate-300 text-white" : i === 2 ? "bg-orange-300 text-white" : "bg-slate-100 text-slate-400"
                      }`}>{i + 1}</span>
                      <div>
                        <div className="font-medium text-slate-700">{p.empName}</div>
                        <div className="text-[11px] text-slate-400">{p.empId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-500">{p.tl}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{p.campaign}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{p.saleCount}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(p.turnover)}</td>
                  <td className="py-2.5 pr-0 text-right text-slate-600">{p.prepaidPct}%</td>
                </tr>
              ))}
              {data.topPerformers.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* LOB-wise summary */}
      <SectionCard
        icon={Layers} title="LOB-wise Summary" tone="teal"
        footnote="Mandate/Target and Achv% columns from the reference sheet are not shown — no real GNC target/mandate data source exists in this app yet."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">LOB</th>
                <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">COD</th>
                <th className="py-2 pr-3 text-right font-semibold">Paid</th>
                <th className="py-2 pr-3 text-right font-semibold">COD %</th>
                <th className="py-2 pr-3 text-right font-semibold">Paid %</th>
                <th className="py-2 pr-0 text-right font-semibold">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.campaignRevenue.map((c) => (
                <tr key={c.campaign} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-teal-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{c.campaign}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{c.saleCount}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{c.codCount}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{c.paidCount}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{c.codPct}%</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{c.paidPct}%</td>
                  <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{formatINR(c.turnover)}</td>
                </tr>
              ))}
              {data.campaignRevenue.length > 0 && (
                <tr className="bg-slate-50 font-bold text-slate-800">
                  <td className="py-2.5 pr-3">Grand Total</td>
                  <td className="py-2.5 pr-3 text-right">{data.campaignRevenue.reduce((s, c) => s + c.saleCount, 0)}</td>
                  <td className="py-2.5 pr-3 text-right">{data.campaignRevenue.reduce((s, c) => s + c.codCount, 0)}</td>
                  <td className="py-2.5 pr-3 text-right">{data.campaignRevenue.reduce((s, c) => s + c.paidCount, 0)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    {(() => { const t = data.campaignRevenue.reduce((s, c) => s + c.saleCount, 0); const cod = data.campaignRevenue.reduce((s, c) => s + c.codCount, 0); return t > 0 ? `${Math.round((cod / t) * 10000) / 100}%` : "0%"; })()}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    {(() => { const t = data.campaignRevenue.reduce((s, c) => s + c.saleCount, 0); const paid = data.campaignRevenue.reduce((s, c) => s + c.paidCount, 0); return t > 0 ? `${Math.round((paid / t) * 10000) / 100}%` : "0%"; })()}
                  </td>
                  <td className="py-2.5 pr-0 text-right">{formatINR(data.campaignRevenue.reduce((s, c) => s + c.turnover, 0))}</td>
                </tr>
              )}
              {data.campaignRevenue.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Date-wise breakdown (Sale / Top line by LOB x payment mode) */}
      <SectionCard
        icon={CalendarDays} title="Date & Campaign-wise Overall Sale" tone="indigo"
        footnote="RTO/RTD & Net Sale Amount columns from the reference sheet are not shown — db_masmis.gnc_sale has no RTO/return-status column to compute them from."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th rowSpan={2} className="py-2 pr-3 font-semibold align-bottom">Date</th>
                {data.campaigns.map((c) => (
                  <th key={c} colSpan={2} className="border-l border-slate-100 py-1 text-center font-semibold">{c}</th>
                ))}
                <th colSpan={2} className="border-l border-slate-100 py-1 text-center font-semibold">Grand Total</th>
              </tr>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                {data.campaigns.map((c) => (
                  <Fragment key={c}>
                    <th className="border-l border-slate-100 py-1 pr-2 text-right font-semibold">Sale</th>
                    <th className="py-1 pr-2 text-right font-semibold">Amount</th>
                  </Fragment>
                ))}
                <th className="border-l border-slate-100 py-1 pr-2 text-right font-semibold">Sale</th>
                <th className="py-1 pr-0 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.dateWiseBreakdown.map((row) => (
                <tr key={row.date} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3 font-medium text-slate-700">{formatShortDate(row.date)}</td>
                  {data.campaigns.map((c) => {
                    const cell = row.byCampaign[c];
                    return (
                      <Fragment key={c}>
                        <td className="border-l border-slate-100 py-2 pr-2 text-right text-slate-600">{cell?.totalSaleCount ?? 0}</td>
                        <td className="py-2 pr-2 text-right text-slate-600">{cell ? formatINR(cell.totalAmount) : "₹0"}</td>
                      </Fragment>
                    );
                  })}
                  <td className="border-l border-slate-100 py-2 pr-2 text-right font-semibold text-slate-800">{row.totalSaleCount}</td>
                  <td className="py-2 pr-0 text-right font-semibold text-slate-800">{formatINR(row.totalAmount)}</td>
                </tr>
              ))}
              {data.dateWiseBreakdown.length === 0 && (
                <tr><td colSpan={2 + data.campaigns.length * 2 + 2} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      </>
      )}

      {tab === "agents" && (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agent name, ID or TL..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />
            {filteredAgents.length} of {data.agentPerformance.length} agents
          </span>
        </div>

        <SectionCard icon={Users} title="Agent-wise Performance" tone="indigo"
          footnote="Target/Achv%/TQ-MQ-BQ and every RTO column from the reference sheet are not shown — no real GNC target/mandate source exists, and db_masmis.gnc_sale has no RTO/return-status column."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">EMP Id</th>
                  <th className="py-2 pr-3 font-semibold">Agent Name</th>
                  <th className="py-2 pr-3 font-semibold">DOJ</th>
                  <th className="py-2 pr-3 text-right font-semibold">Tenure</th>
                  <th className="py-2 pr-3 font-semibold">Bucket</th>
                  <th className="py-2 pr-3 font-semibold">TL Name</th>
                  <th className="py-2 pr-3 font-semibold">LOB</th>
                  <th className="py-2 pr-3 text-right font-semibold">Sale Made</th>
                  <th className="py-2 pr-3 text-right font-semibold">COD</th>
                  <th className="py-2 pr-3 text-right font-semibold">Paid</th>
                  <th className="py-2 pr-3 text-right font-semibold">COD %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Paid %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                  <th className="py-2 pr-0 text-right font-semibold">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={a.empId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40">
                    <td className="py-2.5 pr-3 text-slate-500">{a.empId}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{a.empName}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{formatDDMMYYYY(a.doj)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.tenureDays ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        a.bucket === "180 Above" ? "bg-emerald-100 text-emerald-700"
                        : a.bucket === "121-180" ? "bg-teal-100 text-teal-700"
                        : a.bucket === "91-120" ? "bg-sky-100 text-sky-700"
                        : a.bucket === "0-30" ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                      }`}>{a.bucket}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">{a.tl}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{a.lob}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.saleCount}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.codCount}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.paidCount}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.codPct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.paidPct}%</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.revenue)}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{a.attendanceDays}</td>
                  </tr>
                ))}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={14} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}
    </div>
  );
}
